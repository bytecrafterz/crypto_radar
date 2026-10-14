/**
 * Lo que decide el Robot 3.
 *
 * Cada veredicto viaja con sus componentes separadas a proposito: el
 * sentido del Robot 3 es que se vea POR QUE se llego a la conclusion. Un
 * token con 90 de social y 100 de riesgo no es un "60 regular": es un
 * descarte con mucho ruido, y hay que poder distinguirlo.
 */
import { query, queryOne } from '../../core/db.js';
import { umbralesActuales } from '../../robot3/umbrales.js';
import { iso, num, paginacion } from './comun.js';

const NIVELES = ['rojo', 'naranja', 'amarillo', 'descartado'];

export async function datosConvergenciaResumen() {
  const [porNivel, tot] = await Promise.all([
    query<{ nivel: string; n: number }>('SELECT nivel, COUNT(*)::int AS n FROM tg_candidatos GROUP BY nivel'),
    queryOne<{ evaluados: number; avisados: number }>(
      `SELECT COUNT(*)::int AS evaluados, COUNT(*) FILTER (WHERE enviado_at IS NOT NULL)::int AS avisados
         FROM tg_candidatos`,
    ),
  ]);
  return {
    porNivel: Object.fromEntries(NIVELES.map((n) => [n, porNivel.find((x) => x.nivel === n)?.n ?? 0])) as Record<string, number>,
    evaluados: tot?.evaluados ?? 0,
    avisados: tot?.avisados ?? 0,
    umbrales: umbralesActuales(),
  };
}

export async function datosVeredictos(q: Record<string, string | undefined>) {
  const { page, size, offset } = paginacion(q, 12);
  const nivel = NIVELES.includes(q.nivel ?? '') ? q.nivel! : null;
  const [filas, total] = await Promise.all([
    query<{
      chain: string; address: string; symbol: string | null; nivel: string;
      fuentes_total: number; fuentes_indep: number; anticipacion_seg: number | null;
      score_social: number; score_fuentes: number; score_evidencia: number;
      score_tecnica: number; score_riesgo: number; vetado: boolean;
      enviado_at: Date | null; creado_at: Date;
      detalle: {
        contradicciones?: string[]; confirmaciones?: string[];
        resumenes?: Array<{ texto: string; canal: string | null; clase: string | null }>;
      } | null;
      historial: Array<{ ts: string; nivel: string }> | null;
      en_seguimiento: boolean | null; precio_inicial: unknown; precio_actual: unknown;
    }>(
      `SELECT c.chain, c.address, t.symbol, c.nivel,
              c.fuentes_total, c.fuentes_indep, c.anticipacion_seg,
              c.score_social, c.score_fuentes, c.score_evidencia,
              c.score_tecnica, c.score_riesgo, c.vetado,
              c.enviado_at, c.creado_at, c.detalle,
              (SELECT json_agg(json_build_object('ts', h.ts, 'nivel', h.nivel) ORDER BY h.ts)
                 FROM tg_candidatos_historial h WHERE h.candidato_id = c.id) AS historial,
              (SELECT h.precio_usd FROM tg_candidatos_historial h
                WHERE h.candidato_id = c.id AND h.precio_usd IS NOT NULL
                ORDER BY h.ts LIMIT 1) AS precio_inicial,
              t.last_price_usd AS precio_actual,
              t.tracked_until > now() AS en_seguimiento
         FROM tg_candidatos c
         LEFT JOIN tokens t ON t.chain = c.chain AND t.address = c.address
        WHERE ($3::text IS NULL OR c.nivel = $3)
        ORDER BY CASE c.nivel WHEN 'rojo' THEN 0 WHEN 'naranja' THEN 1 WHEN 'amarillo' THEN 2 ELSE 3 END,
                 c.creado_at DESC, c.id DESC
        LIMIT $1 OFFSET $2`,
      [size, offset, nivel],
    ),
    queryOne<{ n: number }>('SELECT COUNT(*)::int AS n FROM tg_candidatos WHERE ($1::text IS NULL OR nivel = $1)', [nivel]),
  ]);

  return {
    items: filas.map((f) => {
      const ini = num(f.precio_inicial);
      const act = num(f.precio_actual);
      return {
        chain: f.chain,
        address: f.address,
        symbol: f.symbol,
        nivel: f.nivel,
        fuentesTotal: f.fuentes_total,
        fuentesIndep: f.fuentes_indep,
        anticipacionSeg: num(f.anticipacion_seg),
        social: f.score_social,
        fuentes: f.score_fuentes,
        evidencia: f.score_evidencia,
        tecnica: f.score_tecnica,
        riesgo: f.score_riesgo,
        vetado: f.vetado,
        avisado: f.enviado_at !== null,
        enSeguimiento: f.en_seguimiento === true,
        creado: iso(f.creado_at),
        cambioPrecioPct: ini && act ? ((act - ini) / ini) * 100 : null,
        historial: (f.historial ?? []).slice(-4).map((h) => ({ ts: iso(h.ts), nivel: h.nivel })),
        resumenes: (f.detalle?.resumenes ?? []).slice(0, 2),
        confirmaciones: f.detalle?.confirmaciones ?? [],
        contradicciones: f.detalle?.contradicciones ?? [],
      };
    }),
    total: total?.n ?? 0,
    page,
    size,
  };
}

/**
 * Cuanto acierta el Robot 3, para la pagina de Resultados: que hizo el
 * precio en las 24 horas siguientes a que un token llegara a cada nivel, y
 * si salen mejor los tokens de los que se habla en Telegram.
 */
export async function datosAciertoRobot3() {
  const [porNivel, grupos] = await Promise.all([
    query<{ nivel: string; n: number; mediana_max: unknown; suben50: number; caen50: number }>(
      `WITH entradas AS (
         SELECT DISTINCT ON (h.candidato_id, h.nivel)
                h.candidato_id, h.nivel, h.ts, h.precio_usd, t.id AS token_id
           FROM tg_candidatos_historial h
           JOIN tg_candidatos c ON c.id = h.candidato_id
           JOIN tokens t ON t.chain = c.chain AND t.address = c.address
          WHERE h.precio_usd > 0 AND h.ts < now() - interval '24 hours'
          ORDER BY h.candidato_id, h.nivel, h.ts
       ),
       res AS (
         SELECT e.nivel, e.precio_usd,
                (SELECT MAX(s.price_usd) FROM token_snapshots s
                  WHERE s.token_id = e.token_id AND s.ts > e.ts AND s.ts <= e.ts + interval '24 hours') AS maximo,
                (SELECT MIN(s.price_usd) FROM token_snapshots s
                  WHERE s.token_id = e.token_id AND s.ts > e.ts AND s.ts <= e.ts + interval '24 hours') AS minimo
           FROM entradas e
       )
       SELECT nivel, COUNT(*)::int AS n,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY (maximo / precio_usd - 1) * 100) AS mediana_max,
              COUNT(*) FILTER (WHERE maximo >= precio_usd * 1.5)::int AS suben50,
              COUNT(*) FILTER (WHERE minimo <= precio_usd * 0.5)::int AS caen50
         FROM res WHERE maximo IS NOT NULL
        GROUP BY nivel`,
    ),
    query<{ con_telegram: boolean; n: number; exitos: number; rugs: number; pico_medio: unknown }>(
      `SELECT EXISTS (SELECT 1 FROM tg_mentions me
                       WHERE me.chain = t.chain AND me.address = t.address) AS con_telegram,
              COUNT(*)::int AS n,
              COUNT(*) FILTER (WHERE o.outcome = 'exito')::int AS exitos,
              COUNT(*) FILTER (WHERE o.outcome = 'rug')::int AS rugs,
              AVG(o.peak_multiple) AS pico_medio
         FROM token_outcomes o JOIN tokens t ON t.id = o.token_id
        GROUP BY 1`,
    ),
  ]);

  return {
    porNivel: NIVELES.map((n) => {
      const f = porNivel.find((x) => x.nivel === n);
      return f
        ? { nivel: n, n: f.n, medianaMaxPct: num(f.mediana_max), suben50: f.suben50, caen50: f.caen50 }
        : { nivel: n, n: 0, medianaMaxPct: null, suben50: 0, caen50: 0 };
    }),
    grupos: [true, false].map((tg) => {
      const g = grupos.find((x) => x.con_telegram === tg);
      return {
        conTelegram: tg,
        n: g?.n ?? 0,
        exitos: g?.exitos ?? 0,
        rugs: g?.rugs ?? 0,
        picoMedio: num(g?.pico_medio),
      };
    }),
  };
}
