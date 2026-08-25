/**
 * Trazabilidad del sistema: latencia, horizontes y cambios de condiciones.
 *
 * Responde a tres preguntas concretas del cliente:
 *   - cuanto tarda el sistema de verdad (medido, no estimado)
 *   - que paso con cada token a 5 min, 15 min, 1 h, 6 h y 24 h
 *   - que condiciones cambiaron DESPUES de haber enviado la senal
 */
import { query, queryOne, exec } from './db.js';
import type { StoredToken } from './repo.js';

export interface LatencyBreakdown {
  creacion_a_deteccion_ms: number | null;
  deteccion_a_analisis_ms: number | null;
  analisis_ms: number | null;
  analisis_a_alerta_ms: number | null;
  total_ms: number | null;
}

export async function markAnalysisStart(tokenId: number): Promise<void> {
  await exec('UPDATE tokens SET analysis_started_at = now() WHERE id = $1', [tokenId]);
}

export async function markAnalysisFinish(tokenId: number): Promise<void> {
  await exec('UPDATE tokens SET analysis_finished_at = now() WHERE id = $1', [tokenId]);
}

/** Registra la primera alerta y calcula el desglose de tiempos por etapa. */
export async function markFirstAlertAndLatency(tokenId: number): Promise<LatencyBreakdown | null> {
  const row = await queryOne<{
    pair_created_at: Date | null;
    first_seen: Date;
    analysis_started_at: Date | null;
    analysis_finished_at: Date | null;
    first_alert_at: Date | null;
  }>(
    `UPDATE tokens SET first_alert_at = COALESCE(first_alert_at, now())
      WHERE id = $1
      RETURNING pair_created_at, first_seen, analysis_started_at, analysis_finished_at, first_alert_at`,
    [tokenId],
  );
  if (!row) return null;

  const ms = (a: Date | null | undefined, b: Date | null | undefined): number | null =>
    a && b ? b.getTime() - a.getTime() : null;

  const breakdown: LatencyBreakdown = {
    creacion_a_deteccion_ms: ms(row.pair_created_at, row.first_seen),
    deteccion_a_analisis_ms: ms(row.first_seen, row.analysis_started_at),
    analisis_ms: ms(row.analysis_started_at, row.analysis_finished_at),
    analisis_a_alerta_ms: ms(row.analysis_finished_at, row.first_alert_at),
    total_ms: ms(row.pair_created_at, row.first_alert_at),
  };

  await exec('UPDATE tokens SET latency_ms = $2 WHERE id = $1', [tokenId, JSON.stringify(breakdown)]);
  return breakdown;
}

export async function getLatencyStats(): Promise<{
  muestras: number;
  mediana_total_s: number | null;
  p90_total_s: number | null;
  mediana_analisis_s: number | null;
} | null> {
  return queryOne(
    `SELECT
       COUNT(*)::int AS muestras,
       ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY (latency_ms->>'total_ms')::numeric) / 1000)::numeric, 1) AS mediana_total_s,
       ROUND((percentile_cont(0.9) WITHIN GROUP (ORDER BY (latency_ms->>'total_ms')::numeric) / 1000)::numeric, 1) AS p90_total_s,
       ROUND((percentile_cont(0.5) WITHIN GROUP (ORDER BY (latency_ms->>'analisis_ms')::numeric) / 1000)::numeric, 1) AS mediana_analisis_s
     FROM tokens
     WHERE latency_ms IS NOT NULL AND (latency_ms->>'total_ms') IS NOT NULL`,
  );
}

// --------------------------------------------------------------------------
//  Horizontes: que paso a los 5 min, 15 min, 1 h, 6 h, 24 h y 7 dias
// --------------------------------------------------------------------------

export const HORIZONS: Array<{ label: string; minutes: number }> = [
  { label: 'm5', minutes: 5 },
  { label: 'm15', minutes: 15 },
  { label: 'h1', minutes: 60 },
  { label: 'h6', minutes: 360 },
  { label: 'h24', minutes: 1440 },
  { label: 'd7', minutes: 10080 },
];

export interface HorizonInput {
  priceUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  holdersCount: number | null;
  /** Coste estimado de entrar y salir, en %. */
  roundTripPct: number | null;
}

/**
 * Guarda la medicion de los horizontes que toquen.
 * Estas fotos NO se pueden reconstruir despues: o se capturan cuando toca,
 * o el dato se pierde para siempre. Por eso se hace desde el primer dia.
 */
export async function captureHorizons(
  token: StoredToken,
  current: HorizonInput,
): Promise<string[]> {
  const minutesSince = (Date.now() - token.first_seen.getTime()) / 60_000;

  const yaHechos = await query<{ horizon: string }>(
    'SELECT horizon FROM token_horizons WHERE token_id = $1',
    [token.id],
  );
  const hechos = new Set(yaHechos.map((r) => r.horizon));
  const capturados: string[] = [];

  for (const h of HORIZONS) {
    if (hechos.has(h.label)) continue;
    if (minutesSince < h.minutes) continue;
    // Margen de tolerancia. Tiene que cumplir dos cosas a la vez:
    //  - ser mayor que el intervalo de seguimiento, o nunca se captura
    //  - NO llegar al siguiente horizonte, o m5, m15 y h1 se grabarian con la
    //    misma medicion y los tres saldrian identicos
    const siguiente = HORIZONS.find((x) => x.minutes > h.minutes);
    const techo = siguiente ? siguiente.minutes : h.minutes * 1.5;
    const margen = Math.min(Math.max(h.minutes * 0.5, 6), techo - h.minutes);
    if (minutesSince > h.minutes + margen) continue;

    const precioInicial = token.first_price_usd ? Number(token.first_price_usd) : null;
    const capInicial = token.first_market_cap_usd ? Number(token.first_market_cap_usd) : null;

    const priceMultiple =
      precioInicial && precioInicial > 0 && current.priceUsd ? current.priceUsd / precioInicial : null;
    const capMultiple =
      capInicial && capInicial > 0 && current.marketCapUsd ? current.marketCapUsd / capInicial : null;

    // Resultado realista: se descuenta lo que costaria entrar y salir.
    // El coste no puede pasar del 100%: como mucho se pierde todo, nunca mas.
    const coste = Math.min((current.roundTripPct ?? 0) / 100, 1);
    const netMultiple =
      priceMultiple !== null ? Math.max(0, priceMultiple * (1 - coste)) : null;

    await exec(
      `INSERT INTO token_horizons (
         token_id, horizon, minutes_after, price_usd, liquidity_usd, market_cap_usd,
         holders_count, price_multiple, cap_multiple, net_multiple
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (token_id, horizon) DO NOTHING`,
      [
        token.id,
        h.label,
        Math.round(minutesSince * 100) / 100,
        current.priceUsd,
        current.liquidityUsd,
        current.marketCapUsd,
        current.holdersCount,
        priceMultiple,
        capMultiple,
        netMultiple,
      ],
    );
    capturados.push(h.label);
  }

  return capturados;
}

export async function getHorizons(tokenId: number): Promise<
  Array<{
    horizon: string;
    minutes_after: number | null;
    price_multiple: number | null;
    net_multiple: number | null;
    liquidity_usd: number | null;
    captured_at: Date;
  }>
> {
  return query(
    `SELECT horizon, minutes_after, price_multiple, net_multiple, liquidity_usd, captured_at
       FROM token_horizons WHERE token_id = $1 ORDER BY minutes_after ASC`,
    [tokenId],
  );
}

// --------------------------------------------------------------------------
//  Cambios de condiciones despues de la senal
// --------------------------------------------------------------------------

export async function saveSecurityChange(
  tokenId: number,
  field: string,
  before: string | null,
  after: string | null,
  severity: 'info' | 'warn' | 'danger',
  detail: string,
): Promise<void> {
  await exec(
    `INSERT INTO security_changes (token_id, field, before_val, after_val, severity, detail)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [tokenId, field, before, after, severity, detail],
  );
}

export async function getSecurityChanges(
  tokenId: number,
): Promise<Array<{ ts: Date; field: string; severity: string; detail: string }>> {
  return query(
    'SELECT ts, field, severity, detail FROM security_changes WHERE token_id = $1 ORDER BY ts DESC LIMIT 20',
    [tokenId],
  );
}

/** Marca una oportunidad como ya no valida, dejando escrito el motivo. */
export async function invalidate(tokenId: number, reason: string): Promise<void> {
  await exec(
    `UPDATE tokens
        SET invalidated_at = now(), invalidation_reason = $2, light = 'rojo'
      WHERE id = $1 AND invalidated_at IS NULL`,
    [tokenId, reason],
  );
}

export async function updateLight(tokenId: number, light: string, evaluable: boolean): Promise<void> {
  await exec('UPDATE tokens SET light = $2, evaluable = $3 WHERE id = $1', [tokenId, light, evaluable]);
}
