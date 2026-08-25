/**
 * GeckoTerminal - GRATIS, sin clave de API.
 * Su endpoint "new_pools" es el mejor detector gratuito de pools recien
 * creadas, y sirve tanto para Solana como para Base.
 *
 * Documentacion: https://api.geckoterminal.com/docs/index.html
 * Limite publicado: 30 peticiones/min. Usamos 0,5/s con margen de sobra.
 */
import { request } from '../core/http.js';
import type { Chain, DiscoveredPair } from '../core/types.js';
import { numOrNull } from '../core/util.js';
import { child } from '../core/logger.js';

const log = child('geckoterminal');
const BASE = 'https://api.geckoterminal.com/api/v2';
const HEADERS = { accept: 'application/json;version=20230302' };

const NETWORKS: Record<Chain, string> = { solana: 'solana', base: 'base' };

interface GtRelationship {
  data?: { id?: string; type?: string };
}

interface GtPool {
  id: string;
  type: string;
  attributes: {
    name?: string;
    address?: string;
    base_token_price_usd?: string | null;
    quote_token_price_usd?: string | null;
    pool_created_at?: string | null;
    reserve_in_usd?: string | null;
    fdv_usd?: string | null;
    market_cap_usd?: string | null;
    price_change_percentage?: Record<string, string | null>;
    transactions?: Record<string, { buys?: number; sells?: number; buyers?: number; sellers?: number }>;
    volume_usd?: Record<string, string | null>;
  };
  relationships?: {
    base_token?: GtRelationship;
    quote_token?: GtRelationship;
    dex?: GtRelationship;
  };
}

interface GtIncluded {
  id: string;
  type: string;
  attributes?: { address?: string; name?: string; symbol?: string };
}

/** Los ids vienen como "solana_<direccion>" o "base_0x...". */
function addressFromId(id: string | undefined): string | null {
  if (!id) return null;
  const idx = id.indexOf('_');
  return idx === -1 ? id : id.slice(idx + 1);
}

function toPair(
  chain: Chain,
  pool: GtPool,
  included: Map<string, GtIncluded>,
): DiscoveredPair | null {
  const baseId = pool.relationships?.base_token?.data?.id;
  const quoteId = pool.relationships?.quote_token?.data?.id;
  const tokenAddress = addressFromId(baseId);
  const pairAddress = pool.attributes?.address;
  if (!tokenAddress || !pairAddress) return null;

  const baseTok = baseId ? included.get(baseId) : undefined;
  const quoteTok = quoteId ? included.get(quoteId) : undefined;
  const attrs = pool.attributes;
  const tx = attrs.transactions ?? {};
  const vol = attrs.volume_usd ?? {};
  const chg = attrs.price_change_percentage ?? {};

  const dexId = pool.relationships?.dex?.data?.id ?? 'desconocido';
  const createdAt = attrs.pool_created_at ? Date.parse(attrs.pool_created_at) : null;

  return {
    chain,
    tokenAddress,
    pairAddress,
    dex: dexId,
    symbol: baseTok?.attributes?.symbol ?? attrs.name?.split(' / ')[0] ?? '???',
    name: baseTok?.attributes?.name ?? baseTok?.attributes?.symbol ?? '???',
    quoteSymbol: quoteTok?.attributes?.symbol ?? attrs.name?.split(' / ')[1] ?? '???',
    quoteAddress: addressFromId(quoteId),
    priceUsd: numOrNull(attrs.base_token_price_usd),
    liquidityUsd: numOrNull(attrs.reserve_in_usd),
    fdvUsd: numOrNull(attrs.fdv_usd),
    marketCapUsd: numOrNull(attrs.market_cap_usd) ?? numOrNull(attrs.fdv_usd),
    volumeH24: numOrNull(vol.h24),
    volumeH6: numOrNull(vol.h6),
    volumeH1: numOrNull(vol.h1),
    volumeM5: numOrNull(vol.m5),
    txnsH24Buys: numOrNull(tx.h24?.buys),
    txnsH24Sells: numOrNull(tx.h24?.sells),
    txnsH1Buys: numOrNull(tx.h1?.buys),
    txnsH1Sells: numOrNull(tx.h1?.sells),
    txnsM5Buys: numOrNull(tx.m5?.buys),
    txnsM5Sells: numOrNull(tx.m5?.sells),
    priceChangeM5: numOrNull(chg.m5),
    priceChangeH1: numOrNull(chg.h1),
    priceChangeH6: numOrNull(chg.h6),
    priceChangeH24: numOrNull(chg.h24),
    pairCreatedAt: Number.isFinite(createdAt) ? createdAt : null,
    website: null,
    twitter: null,
    telegram: null,
    discord: null,
    imageUrl: null,
    source: 'geckoterminal',
  };
}

async function fetchPools(chain: Chain, path: string, page = 1): Promise<DiscoveredPair[]> {
  const network = NETWORKS[chain];
  const url = `${BASE}/networks/${network}/${path}?include=base_token,quote_token,dex&page=${page}`;
  const res = await request<{ data?: GtPool[]; included?: GtIncluded[] }>(url, {
    provider: 'geckoterminal',
    headers: HEADERS,
    retries: 2,
  }).catch((err) => {
    log.warn({ chain, path, err: String(err) }, 'fallo consultando pools');
    return null;
  });

  if (!res?.data) return [];
  const included = new Map<string, GtIncluded>();
  for (const inc of res.included ?? []) included.set(inc.id, inc);

  const out: DiscoveredPair[] = [];
  for (const pool of res.data) {
    const pair = toPair(chain, pool, included);
    if (pair) out.push(pair);
  }
  return out;
}

/** Pools creadas recientemente. Es nuestro detector principal. */
export const getNewPools = (chain: Chain, page = 1) => fetchPools(chain, 'new_pools', page);

/** Pools con mas movimiento ahora mismo: capta tokens que "despiertan". */
export const getTrendingPools = (chain: Chain) => fetchPools(chain, 'trending_pools');

/** Datos de un pool concreto. */
export async function getPool(chain: Chain, poolAddress: string): Promise<DiscoveredPair | null> {
  const network = NETWORKS[chain];
  const url = `${BASE}/networks/${network}/pools/${poolAddress}?include=base_token,quote_token,dex`;
  const res = await request<{ data?: GtPool; included?: GtIncluded[] }>(url, {
    provider: 'geckoterminal',
    headers: HEADERS,
    retries: 1,
    allow404: true,
  }).catch(() => null);
  if (!res?.data) return null;
  const included = new Map<string, GtIncluded>();
  for (const inc of res.included ?? []) included.set(inc.id, inc);
  return toPair(chain, res.data, included);
}

/**
 * Historico OHLCV gratuito. Se usa en el backtesting para reconstruir
 * lo que paso con un token despues de detectarlo.
 */
export async function getOhlcv(
  chain: Chain,
  poolAddress: string,
  timeframe: 'minute' | 'hour' | 'day' = 'hour',
  aggregate = 1,
  limit = 100,
): Promise<Array<{ ts: number; open: number; high: number; low: number; close: number; volume: number }>> {
  const network = NETWORKS[chain];
  const url = `${BASE}/networks/${network}/pools/${poolAddress}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}`;
  const res = await request<{ data?: { attributes?: { ohlcv_list?: number[][] } } }>(url, {
    provider: 'geckoterminal',
    headers: HEADERS,
    retries: 1,
    allow404: true,
  }).catch(() => null);
  const list = res?.data?.attributes?.ohlcv_list ?? [];
  return list.map((row) => ({
    ts: (row[0] ?? 0) * 1000,
    open: row[1] ?? 0,
    high: row[2] ?? 0,
    low: row[3] ?? 0,
    close: row[4] ?? 0,
    volume: row[5] ?? 0,
  }));
}
