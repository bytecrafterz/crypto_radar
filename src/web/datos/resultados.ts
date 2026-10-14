/**
 * Que paso de verdad con los tokens detectados: la base del backtesting.
 */
import { query } from '../../core/db.js';
import * as tracking from '../../core/tracking.js';
import { num } from './comun.js';
import { datosAciertoRobot3 } from './convergencia.js';

export async function datosResultados() {
  const [resultados, porNota, mejores, comparativa, latencia, robot3] = await Promise.all([
    // MEDIANAS, NO MEDIAS
    // Hay tokens que se detectan con un precio de practicamente cero y luego
    // salen "multiplicados por 99.999.999": la media de un grupo la decide
    // ese unico caso absurdo (un "maximo medio" de 175.000x). La mediana dice
    // lo que le paso al token tipico del grupo.
    query<{ outcome: string; count: number; mediana_pico: unknown }>(
      `SELECT outcome, COUNT(*)::int AS count,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY peak_multiple) AS mediana_pico
         FROM token_outcomes GROUP BY outcome ORDER BY count DESC`,
    ),
    query<{ bucket: string; total: number; exitos: number; rugs: number; mediana_pico: unknown }>(
      `SELECT CASE WHEN score_at_detection >= 80 THEN '80-100'
                   WHEN score_at_detection >= 65 THEN '65-79'
                   WHEN score_at_detection >= 50 THEN '50-64'
                   ELSE 'menos de 50' END AS bucket,
              COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE outcome = 'exito')::int AS exitos,
              COUNT(*) FILTER (WHERE outcome = 'rug')::int AS rugs,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY peak_multiple) AS mediana_pico
         FROM token_outcomes
        WHERE score_at_detection IS NOT NULL
        GROUP BY bucket
        ORDER BY bucket DESC`,
    ),
    query<{ symbol: string | null; chain: string; address: string; peak_multiple: unknown; outcome: string; score_at_detection: unknown }>(
      `SELECT t.symbol, t.chain, t.address, o.peak_multiple, o.outcome, o.score_at_detection
         FROM token_outcomes o JOIN tokens t ON t.id = o.token_id
        -- Fuera los picos imposibles. Mas de 1.000x en dias no se ha visto en
        -- un token real: sale de un precio roto (un pool manipulado casi sin
        -- liquidez o una deteccion con valor de casi cero), y casi todos
        -- acaban en rug. Lo que se ensena es lo que de verdad pudo aprovecharse.
        WHERE o.outcome <> 'rug' AND o.peak_multiple <= 1000
          AND COALESCE(o.entry_market_cap, 0) >= 1000
        ORDER BY o.peak_multiple DESC NULLS LAST LIMIT 20`,
    ),
    // Comparacion honesta: los tokens con nota alta contra TODOS los
    // analizados. Si el sistema no bate a la media, no esta aportando nada.
    query<{ grupo: string; tokens: number; mediana_multiplo: unknown; mediana_neto: unknown; pct_exito: unknown }>(
      `WITH base AS (
         SELECT t.id, s.opportunity,
                (SELECT price_multiple FROM token_horizons h WHERE h.token_id = t.id AND h.horizon = 'h24' LIMIT 1) AS mult,
                (SELECT net_multiple FROM token_horizons h WHERE h.token_id = t.id AND h.horizon = 'h24' LIMIT 1) AS neto
           FROM tokens t
           JOIN LATERAL (SELECT opportunity FROM scores WHERE token_id = t.id ORDER BY ts ASC LIMIT 1) s ON true
          WHERE t.enriched_at IS NOT NULL
       )
       SELECT 'Puntuacion alta (>=65)' AS grupo, COUNT(*)::int AS tokens,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY mult) AS mediana_multiplo,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY neto) AS mediana_neto,
              ROUND((COUNT(*) FILTER (WHERE mult >= 1.5)::numeric / NULLIF(COUNT(*), 0) * 100), 0) AS pct_exito
         FROM base WHERE opportunity >= 65 AND mult IS NOT NULL
       UNION ALL
       SELECT 'Puntuacion baja (<50)', COUNT(*)::int,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY mult), percentile_cont(0.5) WITHIN GROUP (ORDER BY neto),
              ROUND((COUNT(*) FILTER (WHERE mult >= 1.5)::numeric / NULLIF(COUNT(*), 0) * 100), 0)
         FROM base WHERE opportunity < 50 AND mult IS NOT NULL
       UNION ALL
       SELECT 'Todos (equivale a elegir al azar)', COUNT(*)::int,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY mult), percentile_cont(0.5) WITHIN GROUP (ORDER BY neto),
              ROUND((COUNT(*) FILTER (WHERE mult >= 1.5)::numeric / NULLIF(COUNT(*), 0) * 100), 0)
         FROM base WHERE mult IS NOT NULL`,
    ),
    tracking.getLatencyStats(),
    datosAciertoRobot3(),
  ]);

  return {
    resultados: resultados.map((r) => ({ outcome: r.outcome, n: r.count, picoMediano: num(r.mediana_pico) })),
    porNota: porNota.map((b) => ({ tramo: b.bucket, total: b.total, exitos: b.exitos, rugs: b.rugs, picoMediano: num(b.mediana_pico) })),
    mejores: mejores.map((b) => ({
      symbol: b.symbol, chain: b.chain, address: b.address,
      pico: num(b.peak_multiple), outcome: b.outcome, nota: num(b.score_at_detection),
    })),
    comparativa: comparativa.map((c) => ({
      grupo: c.grupo, tokens: c.tokens, multiplo: num(c.mediana_multiplo), neto: num(c.mediana_neto), pctExito: num(c.pct_exito),
    })),
    latencia: latencia && latencia.muestras > 0
      ? {
          muestras: latencia.muestras,
          mediana: num(latencia.mediana_total_s),
          p90: num(latencia.p90_total_s),
          analisis: num(latencia.mediana_analisis_s),
        }
      : null,
    robot3,
  };
}
