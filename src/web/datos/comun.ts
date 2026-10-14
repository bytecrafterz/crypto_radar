/**
 * Lo que comparten todos los datos del panel.
 *
 * El panel es una aplicacion aparte (carpeta web/) que pide los datos en
 * JSON. Aqui no se genera HTML: cada funcion devuelve objetos planos, con
 * los numeros ya convertidos (PostgreSQL entrega los NUMERIC como texto) y
 * las fechas como texto ISO, que es lo que viaja bien en JSON.
 */

/** Una pagina de resultados, siempre con el total para poder paginar. */
export interface Pagina<T> {
  items: T[];
  total: number;
  page: number;
  size: number;
}

/** Numero o null, venga como venga de la base de datos. */
export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Fecha en ISO, o null. */
export function iso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/**
 * Pagina y tamano pedidos, dentro de limites razonables.
 * Un tamano sin tope dejaria pedir la tabla entera de una vez.
 */
export function paginacion(
  q: Record<string, string | undefined>,
  porDefecto = 25,
): { page: number; size: number; offset: number } {
  const page = Math.max(1, Math.floor(Number(q.page ?? '1')) || 1);
  const size = Math.min(100, Math.max(5, Math.floor(Number(q.size ?? porDefecto)) || porDefecto));
  return { page, size, offset: (page - 1) * size };
}

export const explorer = (chain: string, address: string): string =>
  chain === 'solana'
    ? `https://solscan.io/token/${encodeURIComponent(address)}`
    : `https://basescan.org/token/${encodeURIComponent(address)}`;

export const addressExplorer = (chain: string, address: string): string =>
  chain === 'solana'
    ? `https://solscan.io/account/${encodeURIComponent(address)}`
    : `https://basescan.org/address/${encodeURIComponent(address)}`;

/**
 * Enlace de compra con la direccion exacta del contrato dentro de la URL.
 *
 * El mismo que va en las alertas, para que el panel y el aviso no digan
 * cosas distintas. Lleva la direccion incrustada precisamente para que no
 * haya que buscar el token por su nombre: cuando uno funciona aparecen
 * copias con el mismo nombre y el mismo icono creadas para engañar, y
 * buscar por nombre es como se acaba comprando la falsa.
 */
export function enlaceCompra(
  chain: string,
  address: string,
  dex?: string | null,
  pairAddress?: string | null,
): { url: string; nombre: string } {
  // Ver la explicacion larga en src/worker/alerts.ts: en Solana Jupiter
  // agrega todos los mercados, pero en Base Uniswap solo opera sus pools.
  if (chain === 'solana') {
    return { url: `https://jup.ag/swap/SOL-${encodeURIComponent(address)}`, nombre: 'Jupiter' };
  }
  if ((dex ?? '').toLowerCase().includes('uniswap')) {
    return {
      url: `https://app.uniswap.org/swap?chain=base&outputCurrency=${encodeURIComponent(address)}`,
      nombre: 'Uniswap',
    };
  }
  return {
    url: `https://dexscreener.com/base/${encodeURIComponent(pairAddress ?? address)}`,
    nombre: 'su mercado',
  };
}

/** Fila de token tal como la usan los listados. */
export interface TokenFila {
  chain: string;
  address: string;
  symbol: string | null;
  name: string | null;
  status: string;
  dex: string | null;
  opportunity: number | null;
  risk: number | null;
  liquidity: number | null;
  marketCap: number | null;
  firstSeen: string | null;
}

export function filaToken(t: {
  chain: string; address: string; symbol: string | null; name: string | null; status: string;
  dex: string | null; last_opportunity: unknown; last_risk: unknown; last_liquidity_usd: unknown;
  last_market_cap_usd: unknown; first_seen: unknown;
}): TokenFila {
  return {
    chain: t.chain,
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    status: t.status,
    dex: t.dex,
    opportunity: num(t.last_opportunity),
    risk: num(t.last_risk),
    liquidity: num(t.last_liquidity_usd),
    marketCap: num(t.last_market_cap_usd),
    firstSeen: iso(t.first_seen),
  };
}
