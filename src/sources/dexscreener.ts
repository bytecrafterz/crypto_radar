/**
 * DexScreener - GRATIS, sin clave de API.
 * Cubre Solana y Base. Es la fuente principal de precio, liquidez,
 * volumen y numero de operaciones.
 *
 * Documentacion: https://docs.dexscreener.com/api/reference
 * Limite publicado: 300 peticiones/min en /latest/dex/*, 60/min en perfiles.
 * Nosotros nos quedamos muy por debajo (ver PROVIDER_LIMITS en core/http.ts).
 */
import { request } from '../core/http.js';
import type { Chain, DiscoveredPair } from '../core/types.js';
import { numOrNull } from '../core/util.js';
import { child } from '../core/logger.js';

const log = child('dexscreener');
const BASE = 'https://api.dexscreener.com';

const CHAIN_IDS: Record<Chain, string> = { solana: 'solana', base: 'base' };
const CHAIN_BY_ID: Record<string, Chain> = { solana: 'solana', base: 'base' };

interface DsToken {
  address: string;
  name?: string;
  symbol?: string;
}

interface DsPair {
  chainId: string;
  dexId: string;
  url?: string;
  pairAddress: string;
  baseToken: DsToken;
  quoteToken: DsToken;
  priceUsd?: string;
  priceNative?: string;
  txns?: Record<string, { buys?: number; sells?: number }>;
  volume?: Record<string, number>;
  priceChange?: Record<string, number>;
  liquidity?: { usd?: number; base?: number; quote?: number };
  fdv?: number;
  marketCap?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: Array<{ label?: string; url: string }>;
    socials?: Array<{ type?: string; platform?: string; handle?: string; url?: string }>;
  };
}

function pickSocial(pair: DsPair, kind: string): string | null {
  const socials = pair.info?.socials ?? [];
  for (const s of socials) {
    const type = (s.type ?? s.platform ?? '').toLowerCase();
    if (type === kind) return s.url ?? (s.handle ? `https://${kind}.com/${s.handle}` : null);
  }
  return null;
}

/** Convierte la respuesta de DexScreener a nuestro formato interno. */
export function normalizePair(pair: DsPair): DiscoveredPair | null {
  const chain = CHAIN_BY_ID[pair.chainId];
  if (!chain) return null;
  if (!pair.baseToken?.address || !pair.pairAddress) return null;

  return {
    chain,
    tokenAddress: pair.baseToken.address,
    pairAddress: pair.pairAddress,
    dex: pair.dexId ?? 'desconocido',
    symbol: pair.baseToken.symbol ?? '???',
    name: pair.baseToken.name ?? pair.baseToken.symbol ?? '???',
    quoteSymbol: pair.quoteToken?.symbol ?? '???',
    quoteAddress: pair.quoteToken?.address ?? null,
    priceUsd: numOrNull(pair.priceUsd),
    liquidityUsd: numOrNull(pair.liquidity?.usd),
    fdvUsd: numOrNull(pair.fdv),
    marketCapUsd: numOrNull(pair.marketCap ?? pair.fdv),
    volumeH24: numOrNull(pair.volume?.h24),
    volumeH6: numOrNull(pair.volume?.h6),
    volumeH1: numOrNull(pair.volume?.h1),
    volumeM5: numOrNull(pair.volume?.m5),
    txnsH24Buys: numOrNull(pair.txns?.h24?.buys),
    txnsH24Sells: numOrNull(pair.txns?.h24?.sells),
    txnsH1Buys: numOrNull(pair.txns?.h1?.buys),
    txnsH1Sells: numOrNull(pair.txns?.h1?.sells),
    txnsM5Buys: numOrNull(pair.txns?.m5?.buys),
    txnsM5Sells: numOrNull(pair.txns?.m5?.sells),
    priceChangeM5: numOrNull(pair.priceChange?.m5),
    priceChangeH1: numOrNull(pair.priceChange?.h1),
    priceChangeH6: numOrNull(pair.priceChange?.h6),
    priceChangeH24: numOrNull(pair.priceChange?.h24),
    pairCreatedAt: numOrNull(pair.pairCreatedAt),
    website: pair.info?.websites?.[0]?.url ?? null,
    twitter: pickSocial(pair, 'twitter'),
    telegram: pickSocial(pair, 'telegram'),
    discord: pickSocial(pair, 'discord'),
    imageUrl: pair.info?.imageUrl ?? null,
    source: 'dexscreener',
  };
}

/** De todos los pares de un token, nos quedamos con el de mas liquidez. */
function bestPair(pairs: DsPair[]): DsPair | null {
  let best: DsPair | null = null;
  for (const p of pairs) {
    const liq = p.liquidity?.usd ?? 0;
    if (!best || liq > (best.liquidity?.usd ?? 0)) best = p;
  }
  return best;
}

/**
 * Perfiles de tokens recien anadidos. Es el "radar" mas barato que existe:
 * una sola peticion devuelve los ultimos tokens con presencia en DexScreener.
 */
export async function getLatestProfiles(): Promise<Array<{ chain: Chain; address: string }>> {
  const res = await request<Array<{ chainId: string; tokenAddress: string }>>(
    `${BASE}/token-profiles/latest/v1`,
    { provider: 'dexscreener', retries: 2 },
  );
  if (!Array.isArray(res)) return [];
  const out: Array<{ chain: Chain; address: string }> = [];
  for (const item of res) {
    const chain = CHAIN_BY_ID[item?.chainId ?? ''];
    if (chain && item.tokenAddress) out.push({ chain, address: item.tokenAddress });
  }
  return out;
}

/** Tokens con "boost" reciente: suelen ser lanzamientos que buscan visibilidad. */
export async function getLatestBoosts(): Promise<Array<{ chain: Chain; address: string }>> {
  const res = await request<Array<{ chainId: string; tokenAddress: string }>>(
    `${BASE}/token-boosts/latest/v1`,
    { provider: 'dexscreener', retries: 1 },
  ).catch(() => null);
  if (!Array.isArray(res)) return [];
  const out: Array<{ chain: Chain; address: string }> = [];
  for (const item of res) {
    const chain = CHAIN_BY_ID[item?.chainId ?? ''];
    if (chain && item.tokenAddress) out.push({ chain, address: item.tokenAddress });
  }
  return out;
}

/**
 * Datos completos de hasta 30 tokens en una sola peticion.
 * Devuelve el mejor par (mas liquidez) de cada token.
 */
export async function getTokens(chain: Chain, addresses: string[]): Promise<DiscoveredPair[]> {
  if (addresses.length === 0) return [];
  const chainId = CHAIN_IDS[chain];
  const list = addresses.slice(0, 30).join(',');
  const res = await request<{ pairs?: DsPair[] } | DsPair[]>(
    `${BASE}/tokens/v1/${chainId}/${list}`,
    { provider: 'dexscreener', retries: 2, allow404: true },
  ).catch((err) => {
    log.warn({ err: String(err) }, 'fallo consultando tokens');
    return null;
  });

  const pairs: DsPair[] = Array.isArray(res) ? res : (res?.pairs ?? []);
  if (pairs.length === 0) return [];

  // Agrupamos por token y nos quedamos con el par de mas liquidez.
  const byToken = new Map<string, DsPair[]>();
  for (const p of pairs) {
    if (!p?.baseToken?.address) continue;
    const key = p.baseToken.address;
    const arr = byToken.get(key);
    if (arr) arr.push(p);
    else byToken.set(key, [p]);
  }

  const out: DiscoveredPair[] = [];
  for (const group of byToken.values()) {
    const best = bestPair(group);
    if (!best) continue;
    const norm = normalizePair(best);
    if (norm) out.push(norm);
  }
  return out;
}

/** Datos de un solo token. */
export async function getToken(chain: Chain, address: string): Promise<DiscoveredPair | null> {
  const list = await getTokens(chain, [address]);
  return list[0] ?? null;
}

/** Datos de un par concreto (mas fiable cuando ya conocemos el pool). */
export async function getPair(chain: Chain, pairAddress: string): Promise<DiscoveredPair | null> {
  const chainId = CHAIN_IDS[chain];
  const res = await request<{ pairs?: DsPair[] | null; pair?: DsPair | null }>(
    `${BASE}/latest/dex/pairs/${chainId}/${pairAddress}`,
    { provider: 'dexscreener', retries: 2, allow404: true },
  ).catch(() => null);
  const pair = res?.pair ?? res?.pairs?.[0] ?? null;
  return pair ? normalizePair(pair) : null;
}

/**
 * Busqueda. La usamos como red de seguridad para descubrir pares nuevos
 * por moneda de cotizacion (SOL, WETH, USDC...).
 */
export async function search(query: string): Promise<DiscoveredPair[]> {
  const res = await request<{ pairs?: DsPair[] }>(
    `${BASE}/latest/dex/search?q=${encodeURIComponent(query)}`,
    { provider: 'dexscreener', retries: 1 },
  ).catch(() => null);
  const pairs = res?.pairs ?? [];
  const out: DiscoveredPair[] = [];
  for (const p of pairs) {
    const norm = normalizePair(p);
    if (norm) out.push(norm);
  }
  return out;
}
