/**
 * Datos de la portada: el estado del radar de un vistazo.
 */
import { query } from '../../core/db.js';
import * as repo from '../../core/repo.js';
import { filaToken, iso, num } from './comun.js';

export async function datosResumen() {
  const [stats, alertas, top, actividad, porHora] = await Promise.all([
    repo.getDashboardStats(),
    repo.recentAlerts(8),
    repo.listTokens({
      orderBy: 'oportunidad',
      limit: 10,
      minOpportunity: 40,
      since: new Date(Date.now() - 24 * 3_600_000),
      active: true,
    }),
    repo.recentActivity(10),
    // Ritmo del radar en las ultimas 24 horas COMPLETAS: si se para la
    // deteccion, se ve aqui antes que en ningun otro sitio. La hora en curso
    // no entra: acaba de empezar y en el grafico parecia un desplome. Dos
    // recuentos agrupados en vez de uno por hora: la tabla de tokens tiene
    // cientos de miles de filas.
    Promise.all([
      query<{ hora: Date; n: number }>(
        `SELECT date_trunc('hour', first_seen) AS hora, COUNT(*)::int AS n FROM tokens
          WHERE first_seen >= date_trunc('hour', now()) - interval '24 hours'
            AND first_seen < date_trunc('hour', now()) GROUP BY 1`,
      ),
      query<{ hora: Date; n: number }>(
        `SELECT date_trunc('hour', enriched_at) AS hora, COUNT(*)::int AS n FROM tokens
          WHERE enriched_at >= date_trunc('hour', now()) - interval '24 hours'
            AND enriched_at < date_trunc('hour', now()) GROUP BY 1`,
      ),
    ]).then(([det, ana]) => {
      const actual = new Date();
      actual.setMinutes(0, 0, 0);
      const clave = (d: Date) => new Date(d).toISOString();
      const mapaDet = new Map(det.map((r) => [clave(r.hora), r.n]));
      const mapaAna = new Map(ana.map((r) => [clave(r.hora), r.n]));
      return Array.from({ length: 24 }, (_, i) => {
        const hora = new Date(actual.getTime() - (24 - i) * 3_600_000);
        return { hora, detectados: mapaDet.get(clave(hora)) ?? 0, analizados: mapaAna.get(clave(hora)) ?? 0 };
      });
    }),
  ]);

  return {
    stats,
    top: top.map(filaToken),
    alertas: alertas.map((a) => ({
      id: a.id,
      ts: iso(a.ts),
      kind: a.kind,
      symbol: a.symbol,
      chain: a.chain,
      address: a.address,
      opportunity: num(a.opportunity),
      risk: num(a.risk),
      sentOk: a.sent_ok,
    })),
    actividad: actividad.map((a) => ({ ts: iso(a.ts), level: a.level, area: a.area, message: a.message })),
    porHora: porHora.map((h) => ({ ts: iso(h.hora), detectados: h.detectados, analizados: h.analizados })),
  };
}
