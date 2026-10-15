/**
 * Listado de tokens, con filtros y paginado en el servidor.
 */
import * as repo from '../../core/repo.js';
import { filaToken, paginacion, type Pagina, type TokenFila } from './comun.js';

const ORDENES = ['reciente', 'oportunidad', 'riesgo', 'liquidez'] as const;

export async function datosTokens(q: Record<string, string | undefined>): Promise<Pagina<TokenFila>> {
  const { page, size, offset } = paginacion(q, 25);
  const orden = ORDENES.includes(q.orden as (typeof ORDENES)[number])
    ? (q.orden as (typeof ORDENES)[number])
    : 'reciente';

  const filtros: repo.TokenListFilters = {
    chain: q.chain === 'solana' || q.chain === 'base' ? q.chain : undefined,
    status: q.status || undefined,
    search: q.q?.trim() || undefined,
    minOpportunity: q.minop ? Number(q.minop) : undefined,
    maxRisk: q.maxrisk ? Number(q.maxrisk) : undefined,
    analyzedToday: q.periodo === 'hoy',
    orderBy: orden,
    limit: size,
    offset,
  };

  const [tokens, total] = await Promise.all([repo.listTokens(filtros), repo.countTokens(filtros)]);
  return { items: tokens.map(filaToken), total, page, size };
}
