/**
 * Historico de alertas, paginado y filtrable por tipo.
 */
import { query, queryOne } from '../../core/db.js';
import { iso, num, paginacion } from './comun.js';

const TIPOS = ['oportunidad', 'peligro', 'convergencia'];

export async function datosAlertas(q: Record<string, string | undefined>) {
  const { page, size, offset } = paginacion(q, 25);
  const tipo = TIPOS.includes(q.tipo ?? '') ? q.tipo! : null;

  const [filas, total, porTipo] = await Promise.all([
    query<{
      id: number; ts: Date; kind: string; opportunity: unknown; risk: unknown; sent_ok: boolean;
      channels: Array<{ channel: string; ok: boolean; error?: string }> | null;
      symbol: string | null; chain: string; address: string;
    }>(
      `SELECT a.id, a.ts, a.kind, a.opportunity, a.risk, a.sent_ok, a.channels,
              t.symbol, t.chain, t.address
         FROM alerts a JOIN tokens t ON t.id = a.token_id
        WHERE ($3::text IS NULL OR a.kind = $3)
        ORDER BY a.ts DESC, a.id DESC
        LIMIT $1 OFFSET $2`,
      [size, offset, tipo],
    ),
    queryOne<{ n: number }>('SELECT COUNT(*)::int AS n FROM alerts WHERE ($1::text IS NULL OR kind = $1)', [tipo]),
    query<{ kind: string; n: number }>('SELECT kind, COUNT(*)::int AS n FROM alerts GROUP BY kind'),
  ]);

  return {
    items: filas.map((a) => ({
      id: a.id,
      ts: iso(a.ts),
      kind: a.kind,
      symbol: a.symbol,
      chain: a.chain,
      address: a.address,
      opportunity: num(a.opportunity),
      risk: num(a.risk),
      sentOk: a.sent_ok,
      canales: (a.channels ?? []).map((c) => ({ canal: c.channel, ok: c.ok, error: c.error ?? null })),
    })),
    total: total?.n ?? 0,
    page,
    size,
    porTipo: Object.fromEntries(porTipo.map((t) => [t.kind, t.n])) as Record<string, number>,
  };
}
