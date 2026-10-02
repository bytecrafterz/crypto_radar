/**
 * Acceso a datos: todo lo que se guarda y se lee de la base de datos.
 * Cualquier dato que ve el sistema queda registrado aqui desde el primer dia,
 * que es lo que permite hacer backtesting mas adelante.
 */
import { query, queryOne, exec } from './db.js';
import type {
  Chain,
  DiscoveredPair,
  SecurityReport,
  HolderReport,
  DeployerReport,
  ScoreResult,
  SuspiciousEvent,
} from './types.js';
import type { SnapshotLite } from '../analysis/manipulation.js';

export interface StoredToken {
  id: number;
  chain: Chain;
  address: string;
  pair_address: string | null;
  symbol: string | null;
  name: string | null;
  dex: string | null;
  deployer: string | null;
  status: string;
  first_seen: Date;
  last_seen: Date;
  pair_created_at: Date | null;
  enriched_at: Date | null;
  alerted_at: Date | null;
  tracked_until: Date | null;
  last_opportunity: number | null;
  last_risk: number | null;
  first_liquidity_usd: number | null;
  first_market_cap_usd: number | null;
  first_price_usd: number | null;
  peak_liquidity_usd: number | null;
  peak_market_cap_usd: number | null;
  peak_price_usd: number | null;
  last_price_usd: number | null;
  last_liquidity_usd: number | null;
  last_market_cap_usd: number | null;
  website: string | null;
  twitter: string | null;
  telegram: string | null;
  discord: string | null;
  image_url: string | null;
  quote_symbol: string | null;
  discard_reason: string | null;
}

// --------------------------------------------------------------------------
//  Tokens
// --------------------------------------------------------------------------

/** Crea el token si no existe y actualiza sus datos si ya estaba. */
export async function upsertToken(pair: DiscoveredPair): Promise<StoredToken> {
  const pairCreated = pair.pairCreatedAt ? new Date(pair.pairCreatedAt) : null;

  const row = await queryOne<StoredToken>(
    `INSERT INTO tokens (
        chain, address, pair_address, symbol, name, dex, quote_symbol,
        pair_created_at, website, twitter, telegram, discord, image_url,
        first_liquidity_usd, first_market_cap_usd, first_price_usd,
        peak_liquidity_usd, peak_market_cap_usd, peak_price_usd,
        last_liquidity_usd, last_market_cap_usd, last_price_usd
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$14,$15,$16,$14,$15,$16)
     ON CONFLICT (chain, address) DO UPDATE SET
        last_seen           = now(),
        pair_address        = COALESCE(EXCLUDED.pair_address, tokens.pair_address),
        symbol              = COALESCE(EXCLUDED.symbol, tokens.symbol),
        name                = COALESCE(EXCLUDED.name, tokens.name),
        dex                 = COALESCE(EXCLUDED.dex, tokens.dex),
        quote_symbol        = COALESCE(EXCLUDED.quote_symbol, tokens.quote_symbol),
        pair_created_at     = COALESCE(tokens.pair_created_at, EXCLUDED.pair_created_at),
        website             = COALESCE(EXCLUDED.website, tokens.website),
        twitter             = COALESCE(EXCLUDED.twitter, tokens.twitter),
        telegram            = COALESCE(EXCLUDED.telegram, tokens.telegram),
        discord             = COALESCE(EXCLUDED.discord, tokens.discord),
        image_url           = COALESCE(EXCLUDED.image_url, tokens.image_url),
        last_liquidity_usd  = EXCLUDED.last_liquidity_usd,
        last_market_cap_usd = EXCLUDED.last_market_cap_usd,
        last_price_usd      = EXCLUDED.last_price_usd,
        peak_liquidity_usd  = GREATEST(COALESCE(tokens.peak_liquidity_usd, 0), COALESCE(EXCLUDED.last_liquidity_usd, 0)),
        peak_market_cap_usd = GREATEST(COALESCE(tokens.peak_market_cap_usd, 0), COALESCE(EXCLUDED.last_market_cap_usd, 0)),
        peak_price_usd      = GREATEST(COALESCE(tokens.peak_price_usd, 0), COALESCE(EXCLUDED.last_price_usd, 0))
     RETURNING *`,
    [
      pair.chain,
      pair.tokenAddress,
      pair.pairAddress,
      pair.symbol,
      pair.name,
      pair.dex,
      pair.quoteSymbol,
      pairCreated,
      pair.website,
      pair.twitter,
      pair.telegram,
      pair.discord,
      pair.imageUrl,
      pair.liquidityUsd,
      pair.marketCapUsd,
      pair.priceUsd,
    ],
  );

  if (!row) throw new Error('No se pudo guardar el token');
  return row;
}

export async function getToken(chain: Chain, address: string): Promise<StoredToken | null> {
  return queryOne<StoredToken>('SELECT * FROM tokens WHERE chain = $1 AND address = $2', [
    chain,
    address,
  ]);
}

export async function getTokenById(id: number): Promise<StoredToken | null> {
  return queryOne<StoredToken>('SELECT * FROM tokens WHERE id = $1', [id]);
}

export async function setStatus(
  tokenId: number,
  status: string,
  discardReason?: string,
): Promise<void> {
  await exec('UPDATE tokens SET status = $2, discard_reason = $3 WHERE id = $1', [
    tokenId,
    status,
    discardReason ?? null,
  ]);
}

export async function setDeployer(tokenId: number, deployer: string | null): Promise<void> {
  if (!deployer) return;
  await exec('UPDATE tokens SET deployer = $2 WHERE id = $1', [tokenId, deployer]);
}

export async function markEnriched(tokenId: number, trackUntil: Date): Promise<void> {
  await exec('UPDATE tokens SET enriched_at = now(), tracked_until = $2 WHERE id = $1', [
    tokenId,
    trackUntil,
  ]);
}

export async function markAlerted(tokenId: number): Promise<void> {
  await exec("UPDATE tokens SET alerted_at = now(), status = 'alertado' WHERE id = $1", [tokenId]);
}

export async function updateScores(
  tokenId: number,
  opportunity: number,
  risk: number,
): Promise<void> {
  await exec('UPDATE tokens SET last_opportunity = $2, last_risk = $3 WHERE id = $1', [
    tokenId,
    opportunity,
    risk,
  ]);
}

// --------------------------------------------------------------------------
//  Mediciones de mercado
// --------------------------------------------------------------------------

export async function insertSnapshot(
  tokenId: number,
  pair: DiscoveredPair,
  extra: {
    holdersCount?: number | null;
    top10Pct?: number | null;
    /** Quien escribe la medicion. 'seguimiento' es lo que marca el reloj. */
    source?: string;
  } = {},
): Promise<void> {
  await exec(
    `INSERT INTO token_snapshots (
       token_id, price_usd, market_cap_usd, fdv_usd, liquidity_usd,
       volume_m5, volume_h1, volume_h6, volume_h24,
       txns_m5_buys, txns_m5_sells, txns_h1_buys, txns_h1_sells,
       txns_h24_buys, txns_h24_sells,
       price_change_m5, price_change_h1, price_change_h6, price_change_h24,
       holders_count, top10_pct, source
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)`,
    [
      tokenId,
      pair.priceUsd,
      pair.marketCapUsd,
      pair.fdvUsd,
      pair.liquidityUsd,
      pair.volumeM5,
      pair.volumeH1,
      pair.volumeH6,
      pair.volumeH24,
      pair.txnsM5Buys,
      pair.txnsM5Sells,
      pair.txnsH1Buys,
      pair.txnsH1Sells,
      pair.txnsH24Buys,
      pair.txnsH24Sells,
      pair.priceChangeM5,
      pair.priceChangeH1,
      pair.priceChangeH6,
      pair.priceChangeH24,
      extra.holdersCount ?? null,
      extra.top10Pct ?? null,
      extra.source ?? pair.source,
    ],
  );
}

export async function getRecentSnapshots(tokenId: number, limit = 50): Promise<SnapshotLite[]> {
  return query<SnapshotLite>(
    `SELECT ts, price_usd, liquidity_usd, market_cap_usd, volume_h1, volume_h24,
            holders_count, txns_h1_buys, txns_h1_sells
       FROM token_snapshots
      WHERE token_id = $1
      ORDER BY ts DESC
      LIMIT $2`,
    [tokenId, limit],
  );
}

export async function getSnapshotSeries(
  tokenId: number,
  hours = 24,
): Promise<Array<{ ts: Date; price_usd: number | null; liquidity_usd: number | null; market_cap_usd: number | null; holders_count: number | null }>> {
  return query(
    `SELECT ts, price_usd, liquidity_usd, market_cap_usd, holders_count
       FROM token_snapshots
      WHERE token_id = $1 AND ts > now() - ($2 || ' hours')::interval
      ORDER BY ts ASC`,
    [tokenId, String(hours)],
  );
}

/** Crecimiento de holders por hora usando el historico guardado. */
export async function getHolderGrowthPerHour(tokenId: number): Promise<number | null> {
  const rows = await query<{ ts: Date; holders_count: number }>(
    `SELECT ts, holders_count FROM token_snapshots
      WHERE token_id = $1 AND holders_count IS NOT NULL
      ORDER BY ts DESC LIMIT 30`,
    [tokenId],
  );
  if (rows.length < 2) return null;

  const newest = rows[0];
  const oldest = rows[rows.length - 1];
  const hours = (newest.ts.getTime() - oldest.ts.getTime()) / 3_600_000;
  if (hours < 0.15) return null; // menos de 9 minutos: no es representativo

  return (newest.holders_count - oldest.holders_count) / hours;
}

// --------------------------------------------------------------------------
//  Informes
// --------------------------------------------------------------------------

export async function saveSecurity(tokenId: number, r: SecurityReport): Promise<void> {
  await exec(
    `INSERT INTO security_reports (
       token_id, mint_authority_active, mint_authority, freeze_authority_active, freeze_authority,
       is_token_2022, has_extensions, owner_can_modify, owner_address, has_blacklist,
       has_mint_function, is_proxy, is_verified, buy_tax_pct, sell_tax_pct, tax_modifiable,
       is_honeypot, lp_locked_pct, lp_burned_pct, lp_locker_name, total_supply,
       notes, sources, failed_sources, can_sell, round_trip_loss_pct
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
    [
      tokenId,
      r.mintAuthorityActive,
      r.mintAuthority,
      r.freezeAuthorityActive,
      r.freezeAuthority,
      r.isToken2022,
      r.hasToken2022Extensions,
      r.ownerCanModify,
      r.ownerAddress,
      r.hasBlacklist,
      r.hasMintFunction,
      r.isProxy,
      r.isVerified,
      r.buyTaxPct,
      r.sellTaxPct,
      r.taxModifiable,
      r.isHoneypot,
      r.lpLockedPct,
      r.lpBurnedPct,
      r.lpLockerName,
      r.totalSupply,
      JSON.stringify(r.notes),
      JSON.stringify(r.sources),
      JSON.stringify(r.failedSources),
      r.canSell,
      r.roundTripLossPct,
    ],
  );

  if (r.decimals !== null) {
    await exec('UPDATE tokens SET decimals = COALESCE(decimals, $2) WHERE id = $1', [
      tokenId,
      r.decimals,
    ]);
  }
}

export async function getLatestSecurity(tokenId: number): Promise<Record<string, unknown> | null> {
  return queryOne('SELECT * FROM security_reports WHERE token_id = $1 ORDER BY ts DESC LIMIT 1', [
    tokenId,
  ]);
}

export async function saveHolders(tokenId: number, r: HolderReport): Promise<void> {
  await exec(
    `INSERT INTO holder_snapshots (
       token_id, holders_count, top10_pct, top20_pct, largest_real_pct,
       deployer_pct, partial, note, top_holders
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      tokenId,
      r.holdersCount,
      r.top10Pct,
      r.top20Pct,
      r.largestRealPct,
      r.deployerPct,
      r.partial,
      r.note,
      JSON.stringify(r.holders),
    ],
  );
}

export async function getLatestHolders(tokenId: number): Promise<Record<string, unknown> | null> {
  return queryOne('SELECT * FROM holder_snapshots WHERE token_id = $1 ORDER BY ts DESC LIMIT 1', [
    tokenId,
  ]);
}

export async function saveDeployer(tokenId: number, r: DeployerReport): Promise<void> {
  await exec(
    `INSERT INTO deployer_reports (
       token_id, deployer, deploy_tx, deployed_at, prior_token_count,
       prior_tokens, history_verdict, funded_by, note
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      tokenId,
      r.deployer,
      r.deployTxHash,
      r.deployedAt ? new Date(r.deployedAt) : null,
      r.priorTokenCount,
      JSON.stringify(r.priorTokens),
      r.historyVerdict,
      r.fundedBy,
      r.note,
    ],
  );
  await setDeployer(tokenId, r.deployer);
}

export async function getLatestDeployer(tokenId: number): Promise<Record<string, unknown> | null> {
  return queryOne('SELECT * FROM deployer_reports WHERE token_id = $1 ORDER BY ts DESC LIMIT 1', [
    tokenId,
  ]);
}

export async function saveScore(tokenId: number, s: ScoreResult): Promise<void> {
  await exec(
    `INSERT INTO scores (
       token_id, opportunity, risk, opportunity_label, risk_label, vetoed,
       opportunity_reasons, risk_reasons, missing_data,
       critical_vetoes, evaluable, light, execution
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      tokenId,
      s.opportunity,
      s.risk,
      s.opportunityLabel,
      s.riskLabel,
      s.vetoed,
      JSON.stringify(s.opportunityReasons),
      JSON.stringify(s.riskReasons),
      JSON.stringify(s.missingData),
      JSON.stringify(s.criticalVetoes ?? []),
      s.evaluable ?? null,
      s.light ?? null,
      s.execution ? JSON.stringify(s.execution) : null,
    ],
  );
  await updateScores(tokenId, s.opportunity, s.risk);
}

export async function getLatestScore(tokenId: number): Promise<Record<string, unknown> | null> {
  return queryOne('SELECT * FROM scores WHERE token_id = $1 ORDER BY ts DESC LIMIT 1', [tokenId]);
}

export async function saveSuspicious(tokenId: number, events: SuspiciousEvent[]): Promise<void> {
  for (const e of events) {
    // No repetimos el mismo tipo de evento dentro de la misma hora.
    const recent = await queryOne<{ id: number }>(
      `SELECT id FROM suspicious_events
        WHERE token_id = $1 AND kind = $2 AND ts > now() - interval '1 hour'
        LIMIT 1`,
      [tokenId, e.kind],
    );
    if (recent) continue;

    await exec(
      'INSERT INTO suspicious_events (token_id, kind, severity, detail, data) VALUES ($1,$2,$3,$4,$5)',
      [tokenId, e.kind, e.severity, e.detail, e.data ? JSON.stringify(e.data) : null],
    );
  }
}

export async function getSuspicious(
  tokenId: number,
  limit = 20,
): Promise<Array<{ ts: Date; kind: string; severity: string; detail: string }>> {
  return query(
    'SELECT ts, kind, severity, detail FROM suspicious_events WHERE token_id = $1 ORDER BY ts DESC LIMIT $2',
    [tokenId, limit],
  );
}

// --------------------------------------------------------------------------
//  Alertas
// --------------------------------------------------------------------------

export async function saveAlert(
  tokenId: number,
  kind: string,
  opportunity: number | null,
  risk: number | null,
  message: string,
  sentOk: boolean,
  error?: string,
  channels?: Array<{ channel: string; ok: boolean; error?: string }>,
): Promise<void> {
  await exec(
    `INSERT INTO alerts (token_id, kind, opportunity, risk, message, sent_ok, error, channels)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      tokenId,
      kind,
      opportunity,
      risk,
      message,
      sentOk,
      error ?? null,
      JSON.stringify(channels ?? []),
    ],
  );
}

export async function alertsInLastHour(): Promise<number> {
  const row = await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM alerts WHERE ts > now() - interval '1 hour' AND kind = 'oportunidad'",
  );
  return row?.count ?? 0;
}

/**
 * Alertas enviadas HOY de un tipo concreto.
 *
 * El tope por hora no basta: 12 a la hora permiten casi 300 al dia, que es
 * justo lo contrario de lo que se le prometio al usuario. El tope diario es
 * el que de verdad protege su movil.
 */
export async function alertsToday(kind: string): Promise<number> {
  const row = await queryOne<{ count: number }>(
    // Dia natural, no ventana movil de 24 h. Con la ventana movil, una rafaga
    // de alertas dejaba el sistema mudo durante el dia siguiente entero,
    // porque las viejas seguian contando dentro de la ventana. Ademas
    // "10 al dia" se entiende como "se reinicia cada noche", que es lo que
    // hace esto.
    "SELECT COUNT(*)::int AS count FROM alerts WHERE ts >= date_trunc('day', now()) AND kind = $1",
    [kind],
  );
  return row?.count ?? 0;
}

/** Avisos de peligro de la ultima hora. Antes no tenian ningun tope. */
export async function dangerAlertsInLastHour(): Promise<number> {
  const row = await queryOne<{ count: number }>(
    "SELECT COUNT(*)::int AS count FROM alerts WHERE ts > now() - interval '1 hour' AND kind = 'peligro'",
  );
  return row?.count ?? 0;
}

/**
 * ¿Se le llego a enviar este token como oportunidad, del Robot 1 o de alta
 * convergencia del Robot 3?
 *
 * Importa para los avisos de peligro: advertir de que se hunde un token del
 * que nunca le hablamos no le sirve de nada, porque no lo tiene. El aviso
 * util es el del token que si le enviamos y que por tanto podria haber
 * comprado.
 */
export async function wasAlertedAsOpportunity(tokenId: number): Promise<boolean> {
  const row = await queryOne<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM alerts WHERE token_id = $1 AND kind IN ('oportunidad', 'convergencia') AND sent_ok = true",
    [tokenId],
  );
  return (row?.n ?? 0) > 0;
}

export async function lastAlertFor(tokenId: number, kind?: string): Promise<Date | null> {
  const row = kind
    ? await queryOne<{ ts: Date }>(
        'SELECT ts FROM alerts WHERE token_id = $1 AND kind = $2 ORDER BY ts DESC LIMIT 1',
        [tokenId, kind],
      )
    : await queryOne<{ ts: Date }>(
        'SELECT ts FROM alerts WHERE token_id = $1 ORDER BY ts DESC LIMIT 1',
        [tokenId],
      );
  return row?.ts ?? null;
}

export async function recentAlerts(limit = 50): Promise<
  Array<{
    id: number;
    ts: Date;
    kind: string;
    opportunity: number | null;
    risk: number | null;
    message: string;
    sent_ok: boolean;
    channels: Array<{ channel: string; ok: boolean; error?: string }>;
    symbol: string | null;
    chain: string;
    address: string;
  }>
> {
  return query(
    `SELECT a.id, a.ts, a.kind, a.opportunity, a.risk, a.message, a.sent_ok, a.channels,
            t.symbol, t.chain, t.address
       FROM alerts a JOIN tokens t ON t.id = a.token_id
      ORDER BY a.ts DESC LIMIT $1`,
    [limit],
  );
}

// --------------------------------------------------------------------------
//  Colas de trabajo
// --------------------------------------------------------------------------

/** Tokens pendientes de analisis profundo, los mas recientes primero. */
export async function getPendingEnrichment(limit: number): Promise<StoredToken[]> {
  return query<StoredToken>(
    `SELECT * FROM tokens
      WHERE status = 'nuevo' AND enriched_at IS NULL
      ORDER BY first_seen DESC
      LIMIT $1`,
    [limit],
  );
}

export async function countEnrichedSince(interval: string): Promise<number> {
  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM tokens WHERE enriched_at > now() - $1::interval`,
    [interval],
  );
  return row?.count ?? 0;
}

/** Tokens en seguimiento que toca volver a medir. */
export async function getTokensToMonitor(
  intensiveMinutes: number,
  slowMinutes: number,
  intensiveHours: number,
  limit: number,
): Promise<StoredToken[]> {
  // OJO: solo cuentan los snapshots escritos POR EL SEGUIMIENTO.
  // La deteccion tambien inserta snapshots (cada 45 s para los tokens
  // vigilados), y si se contaran aqui un token que aparece en trending nunca
  // venceria y dejaria de re-analizarse para siempre.
  return query<StoredToken>(
    `SELECT t.* FROM tokens t
      WHERE t.tracked_until > now()
        AND t.status <> 'archivado'
        AND (
          SELECT COALESCE(MAX(s.ts), 'epoch'::timestamptz) FROM token_snapshots s
           WHERE s.token_id = t.id AND s.source = 'seguimiento'
        ) < now() - (
          CASE WHEN t.first_seen > now() - ($3 || ' hours')::interval
               THEN ($1 || ' minutes')::interval
               ELSE ($2 || ' minutes')::interval
          END
        )
      ORDER BY t.last_opportunity DESC NULLS LAST, t.first_seen DESC
      LIMIT $4`,
    [String(intensiveMinutes), String(slowMinutes), String(intensiveHours), limit],
  );
}

/** Tokens cuyo seguimiento ha terminado y hay que cerrar. */
export async function getTokensToArchive(limit = 50): Promise<StoredToken[]> {
  return query<StoredToken>(
    `SELECT * FROM tokens
      WHERE tracked_until IS NOT NULL AND tracked_until < now() AND status <> 'archivado'
      LIMIT $1`,
    [limit],
  );
}

// --------------------------------------------------------------------------
//  Resultado final (backtesting)
// --------------------------------------------------------------------------

/**
 * Cierra un token: calcula que paso con el desde que lo detectamos.
 * Es la base del modulo de backtesting.
 *
 * Las escrituras van en UNA transaccion: si el proceso muere a mitad, antes
 * quedaba el resultado insertado pero el token sin archivar, y en la siguiente
 * vuelta se recalculaba sumando otra vez a wallet_stats.
 */
export async function computeOutcome(token: StoredToken): Promise<void> {
  const snapshots = await query<{
    ts: Date;
    market_cap_usd: number | null;
    liquidity_usd: number | null;
    price_usd: number | null;
  }>(
    'SELECT ts, market_cap_usd, liquidity_usd, price_usd FROM token_snapshots WHERE token_id = $1 ORDER BY ts ASC',
    [token.id],
  );

  if (snapshots.length === 0) {
    await exec("UPDATE tokens SET status = 'archivado' WHERE id = $1", [token.id]);
    return;
  }

  const first = snapshots[0];
  const last = snapshots[snapshots.length - 1];
  const entryCap = first.market_cap_usd ?? 0;

  let peakCap = 0;
  let peakAt = first.ts;
  let peakLiquidity = 0;
  for (const s of snapshots) {
    const cap = s.market_cap_usd ?? 0;
    if (cap > peakCap) {
      peakCap = cap;
      peakAt = s.ts;
    }
    peakLiquidity = Math.max(peakLiquidity, s.liquidity_usd ?? 0);
  }

  const finalCap = last.market_cap_usd ?? 0;

  /**
   * Tope de los multiplos.
   *
   * La columna admite hasta 10^8 y sin tope la fila entera se rechazaba
   * con "numeric field overflow", asi que el resultado de ese token no se
   * guardaba nunca. Pasaba de verdad: 49 resultados perdidos en una sola
   * manana, y en silencio, porque el error se quedaba en el registro de
   * la base de datos y no en el del radar.
   *
   * Ocurre cuando el token se detecto con una capitalizacion casi nula:
   * dividir por algo cercano a cero dispara el multiplo a millones. Un
   * numero asi no es un resultado, es un artefacto de haber entrado
   * demasiado pronto, y recortarlo conserva lo unico que importa, que es
   * que subio muchisimo.
   */
  const TOPE_MULTIPLO = 99_999_999;
  const acotar = (v: number | null): number | null =>
    v === null || !Number.isFinite(v) ? null : Math.min(v, TOPE_MULTIPLO);

  const peakMultiple = acotar(entryCap > 0 ? peakCap / entryCap : null);
  const finalMultiple = acotar(entryCap > 0 ? finalCap / entryCap : null);
  const maxDrawdown = peakCap > 0 ? ((peakCap - finalCap) / peakCap) * 100 : null;
  const minutesToPeak = (peakAt.getTime() - first.ts.getTime()) / 60_000;
  const hoursTracked = (last.ts.getTime() - first.ts.getTime()) / 3_600_000;

  const finalLiquidity = last.liquidity_usd ?? 0;
  const rugged = peakLiquidity > 0 && finalLiquidity < peakLiquidity * 0.15;

  let outcome: string;
  if (rugged) outcome = 'rug';
  else if (peakMultiple !== null && peakMultiple >= 2) outcome = 'exito';
  else if (finalMultiple !== null && finalMultiple < 0.5) outcome = 'fracaso';
  else outcome = 'neutro';

  await exec(
    `INSERT INTO token_outcomes (
       token_id, hours_tracked, entry_market_cap, peak_market_cap, final_market_cap,
       peak_multiple, final_multiple, max_drawdown_pct, minutes_to_peak,
       rugged, rug_reason, outcome, score_at_detection, risk_at_detection
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (token_id) DO UPDATE SET
       evaluated_at = now(), hours_tracked = EXCLUDED.hours_tracked,
       peak_market_cap = EXCLUDED.peak_market_cap, final_market_cap = EXCLUDED.final_market_cap,
       peak_multiple = EXCLUDED.peak_multiple, final_multiple = EXCLUDED.final_multiple,
       max_drawdown_pct = EXCLUDED.max_drawdown_pct, rugged = EXCLUDED.rugged,
       outcome = EXCLUDED.outcome`,
    [
      token.id,
      hoursTracked,
      entryCap,
      peakCap,
      finalCap,
      peakMultiple,
      finalMultiple,
      maxDrawdown,
      minutesToPeak,
      rugged,
      rugged ? 'La liquidez final es menos del 15% de la maxima alcanzada.' : null,
      outcome,
      token.last_opportunity,
      token.last_risk,
    ],
  );

  await exec("UPDATE tokens SET status = 'archivado' WHERE id = $1", [token.id]);

  // Actualizamos la reputacion de las wallets que compraron temprano.
  await exec(
    `UPDATE wallet_stats ws SET
       tokens_success = ws.tokens_success + CASE WHEN $2 = 'exito' THEN 1 ELSE 0 END,
       tokens_rugged  = ws.tokens_rugged  + CASE WHEN $2 = 'rug'   THEN 1 ELSE 0 END,
       updated_at = now()
     FROM wallet_activity wa
     WHERE wa.token_id = $1 AND wa.chain = ws.chain AND wa.wallet = ws.wallet`,
    [token.id, outcome],
  );
}

/** Registra una wallet vista en un token (base de la reputacion futura). */
export async function recordWalletActivity(
  chain: Chain,
  wallet: string,
  tokenId: number,
  role: string,
  balancePct: number | null,
  minutesAfterLaunch: number | null,
): Promise<void> {
  await exec(
    `INSERT INTO wallet_activity (chain, wallet, token_id, role, balance_pct, minutes_after_launch)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (chain, wallet, token_id, role) DO UPDATE SET balance_pct = EXCLUDED.balance_pct`,
    [chain, wallet, tokenId, role, balancePct, minutesAfterLaunch],
  );

  await exec(
    `INSERT INTO wallet_stats (chain, wallet, tokens_seen)
     VALUES ($1,$2,1)
     ON CONFLICT (chain, wallet) DO UPDATE SET
       tokens_seen = wallet_stats.tokens_seen + 1, updated_at = now()`,
    [chain, wallet],
  );
}

// --------------------------------------------------------------------------
//  Consultas del panel
// --------------------------------------------------------------------------

export interface TokenListFilters {
  chain?: string;
  status?: string;
  minOpportunity?: number;
  maxRisk?: number;
  search?: string;
  onlyAlerted?: boolean;
  limit?: number;
  offset?: number;
  orderBy?: 'reciente' | 'oportunidad' | 'riesgo' | 'liquidez';
}

export async function listTokens(f: TokenListFilters = {}): Promise<StoredToken[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (clause: string, value: unknown) => {
    params.push(value);
    where.push(clause.replace('?', `$${params.length}`));
  };

  if (f.chain) add('chain = ?', f.chain);
  if (f.status) add('status = ?', f.status);
  if (f.minOpportunity !== undefined) add('last_opportunity >= ?', f.minOpportunity);
  if (f.maxRisk !== undefined) add('last_risk <= ?', f.maxRisk);
  if (f.onlyAlerted) where.push('alerted_at IS NOT NULL');
  if (f.search) {
    params.push(`%${f.search}%`);
    where.push(`(symbol ILIKE $${params.length} OR name ILIKE $${params.length} OR address ILIKE $${params.length})`);
  }

  const order =
    f.orderBy === 'oportunidad'
      ? 'last_opportunity DESC NULLS LAST'
      : f.orderBy === 'riesgo'
        ? 'last_risk DESC NULLS LAST'
        : f.orderBy === 'liquidez'
          ? 'last_liquidity_usd DESC NULLS LAST'
          : 'first_seen DESC';

  params.push(f.limit ?? 50);
  const limitParam = `$${params.length}`;
  params.push(f.offset ?? 0);
  const offsetParam = `$${params.length}`;

  return query<StoredToken>(
    `SELECT * FROM tokens
      ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${order}
      LIMIT ${limitParam} OFFSET ${offsetParam}`,
    params,
  );
}

export async function countTokens(f: TokenListFilters = {}): Promise<number> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (f.chain) {
    params.push(f.chain);
    where.push(`chain = $${params.length}`);
  }
  if (f.status) {
    params.push(f.status);
    where.push(`status = $${params.length}`);
  }
  if (f.onlyAlerted) where.push('alerted_at IS NOT NULL');

  const row = await queryOne<{ count: number }>(
    `SELECT COUNT(*)::int AS count FROM tokens ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}`,
    params,
  );
  return row?.count ?? 0;
}

export interface DashboardStats {
  totalTokens: number;
  tokensToday: number;
  alertsToday: number;
  tracked: number;
  enrichedToday: number;
  bySolana: number;
  byBase: number;
  outcomes: Array<{ outcome: string; count: number }>;
  discardedToday: number;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const [totals, outcomes] = await Promise.all([
    queryOne<{
      total: number;
      today: number;
      alerts_today: number;
      tracked: number;
      enriched_today: number;
      solana: number;
      base: number;
      discarded_today: number;
    }>(
      `SELECT
         (SELECT COUNT(*)::int FROM tokens) AS total,
         (SELECT COUNT(*)::int FROM tokens WHERE first_seen > CURRENT_DATE) AS today,
         (SELECT COUNT(*)::int FROM alerts WHERE ts > CURRENT_DATE) AS alerts_today,
         (SELECT COUNT(*)::int FROM tokens WHERE tracked_until > now()) AS tracked,
         (SELECT COUNT(*)::int FROM tokens WHERE enriched_at > CURRENT_DATE) AS enriched_today,
         (SELECT COUNT(*)::int FROM tokens WHERE chain = 'solana') AS solana,
         (SELECT COUNT(*)::int FROM tokens WHERE chain = 'base') AS base,
         (SELECT COUNT(*)::int FROM tokens WHERE status = 'descartado' AND last_seen > CURRENT_DATE) AS discarded_today`,
    ),
    query<{ outcome: string; count: number }>(
      'SELECT outcome, COUNT(*)::int AS count FROM token_outcomes GROUP BY outcome ORDER BY count DESC',
    ),
  ]);

  return {
    totalTokens: totals?.total ?? 0,
    tokensToday: totals?.today ?? 0,
    alertsToday: totals?.alerts_today ?? 0,
    tracked: totals?.tracked ?? 0,
    enrichedToday: totals?.enriched_today ?? 0,
    bySolana: totals?.solana ?? 0,
    byBase: totals?.base ?? 0,
    outcomes,
    discardedToday: totals?.discarded_today ?? 0,
  };
}

export async function recentActivity(limit = 40): Promise<
  Array<{ ts: Date; level: string; area: string; message: string }>
> {
  return query('SELECT ts, level, area, message FROM activity_log ORDER BY ts DESC LIMIT $1', [
    limit,
  ]);
}
