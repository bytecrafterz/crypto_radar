/**
 * Jupiter - GRATIS, sin clave. Solo Solana.
 *
 * POR QUE ESTA ESTO AQUI
 * En Base simulamos una compra y una venta reales con Honeypot.is. En Solana
 * eso no existe: la red no permite simular una venta de un token que no tienes,
 * porque no se puede inventar el saldo de una cuenta como si se hace en EVM.
 *
 * Lo mas cercano posible es preguntarle a Jupiter, que es el agregador por el
 * que pasa practicamente todo el volumen de Solana. Se le piden dos
 * cotizaciones encadenadas:
 *
 *   1. comprar el token con una cantidad concreta de SOL
 *   2. vender EXACTAMENTE lo que devolveria esa compra
 *
 * De ahi salen tres cosas que antes no teniamos:
 *
 *   - si existe ruta de VENTA. Si Jupiter no encuentra ninguna, ese token no
 *     se puede vender: es la senal de honeypot mas fuerte disponible en Solana.
 *   - cuanto se recupera al hacer ida y vuelta, que incluye el impacto en el
 *     precio, las comisiones de los pools Y las comisiones de transferencia de
 *     Token-2022, porque Jupiter las tiene en cuenta al calcular la ruta.
 *   - si vender sale desproporcionadamente peor que comprar, que es justo el
 *     comportamiento de un token con comision de venta abusiva.
 *
 * No es una simulacion de la transaccion real, y no se presenta como tal.
 * Es una cotizacion real sobre la liquidez real.
 */
import { request } from '../core/http.js';
import { child } from '../core/logger.js';
import { numOrNull } from '../core/util.js';

const log = child('jupiter');

/** El endpoint v6 clasico dejo de responder; este es el vigente. */
const API = 'https://lite-api.jup.ag/swap/v1';

export const WSOL = 'So11111111111111111111111111111111111111112';

interface JupQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan?: Array<{ swapInfo?: { label?: string; ammKey?: string } }>;
}

export interface Quote {
  inAmount: bigint;
  outAmount: bigint;
  priceImpactPct: number;
  /** Nombres de los pools por los que pasaria la operacion. */
  route: string[];
}

/**
 * Cotizacion de un intercambio. Devuelve null si no hay ruta posible,
 * que es informacion en si misma.
 */
export async function getQuote(
  inputMint: string,
  outputMint: string,
  amount: bigint,
  slippageBps = 300,
): Promise<Quote | null> {
  const url =
    `${API}/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
    `&amount=${amount.toString()}&slippageBps=${slippageBps}`;

  const res = await request<JupQuote>(url, {
    provider: 'jupiter',
    retries: 1,
    timeoutMs: 12_000,
    // Sin ruta, Jupiter responde 400 o 404. No es un fallo del sistema:
    // significa que ese intercambio no se puede hacer.
    allow404: true,
  }).catch((err) => {
    const msg = err instanceof Error ? err.message : String(err);
    // Un 400 con "no route" es una respuesta valida, no un error.
    if (/40[04]/.test(msg)) return null;
    log.warn({ inputMint, outputMint, err: msg }, 'Jupiter no respondio');
    return null;
  });

  if (!res?.outAmount) return null;

  let inA: bigint;
  let outA: bigint;
  try {
    inA = BigInt(res.inAmount);
    outA = BigInt(res.outAmount);
  } catch {
    return null;
  }
  if (outA <= 0n) return null;

  return {
    inAmount: inA,
    outAmount: outA,
    priceImpactPct: Math.abs(numOrNull(res.priceImpactPct) ?? 0) * 100,
    route: (res.routePlan ?? [])
      .map((r) => r.swapInfo?.label ?? '')
      .filter((l) => l !== ''),
  };
}

export interface SellCheck {
  /** ¿Se puede comprar? */
  canBuy: boolean;
  /** ¿Se puede vender? null = no se pudo comprobar. */
  canSell: boolean | null;
  /** Porcentaje del SOL invertido que se recuperaria al vender de inmediato. */
  recoveredPct: number | null;
  /** Lo que se pierde en la ida y vuelta, en %. */
  roundTripLossPct: number | null;
  buyImpactPct: number | null;
  sellImpactPct: number | null;
  /** Pools por los que pasaria la compra. */
  route: string[];
  /** true si hay indicios claros de que no se puede salir. */
  looksLikeHoneypot: boolean;
  note: string;
}

const NO_COMPROBADO: SellCheck = {
  canBuy: false,
  canSell: null,
  recoveredPct: null,
  roundTripLossPct: null,
  buyImpactPct: null,
  sellImpactPct: null,
  route: [],
  looksLikeHoneypot: false,
  note: 'No se pudo comprobar si el token se puede vender (Jupiter no respondio).',
};

/**
 * Comprueba de verdad si se puede salir del token.
 *
 * `solLamports` es la cantidad de SOL con la que se simula la compra.
 * Se usa el tamano de posicion configurado, porque el impacto depende del
 * importe: un token puede ser vendible con 50 USD e imposible con 5.000.
 */
export async function checkSellRoundTrip(
  mint: string,
  solLamports: bigint,
): Promise<SellCheck> {
  // 1. ¿Se puede comprar?
  const compra = await getQuote(WSOL, mint, solLamports);

  if (!compra) {
    return {
      ...NO_COMPROBADO,
      canBuy: false,
      note: 'Jupiter no encuentra ruta de COMPRA para este token con ese importe.',
    };
  }

  // 2. ¿Se puede vender exactamente lo que daria esa compra?
  const venta = await getQuote(mint, WSOL, compra.outAmount);

  if (!venta) {
    // Comprar si, vender no. Es la senal mas fuerte que se puede obtener.
    return {
      canBuy: true,
      canSell: false,
      recoveredPct: 0,
      roundTripLossPct: 100,
      buyImpactPct: compra.priceImpactPct,
      sellImpactPct: null,
      route: compra.route,
      looksLikeHoneypot: true,
      note:
        'PELIGRO: Jupiter encuentra ruta para COMPRAR pero ninguna para VENDER. ' +
        'Es el comportamiento tipico de un honeypot: entras y no puedes salir.',
    };
  }

  const recovered = Number((venta.outAmount * 10000n) / solLamports) / 100;
  const perdida = 100 - recovered;

  // Una perdida enorme en ida y vuelta significa que salir es inviable,
  // aunque tecnicamente exista ruta.
  const inviable = perdida >= 50;

  const note = inviable
    ? `PELIGRO: al comprar y vender de inmediato solo se recuperaria el ${recovered.toFixed(1)}% ` +
      `(se perderia el ${perdida.toFixed(1)}%). Tecnicamente se puede vender, pero salir es inviable.`
    : `Venta comprobada con Jupiter: al comprar y vender de inmediato se recuperaria el ` +
      `${recovered.toFixed(1)}% (coste de ida y vuelta ${perdida.toFixed(1)}%). ` +
      `Impacto en el precio: ${compra.priceImpactPct.toFixed(2)}% al comprar, ` +
      `${venta.priceImpactPct.toFixed(2)}% al vender.`;

  return {
    canBuy: true,
    canSell: true,
    recoveredPct: Math.round(recovered * 100) / 100,
    roundTripLossPct: Math.round(perdida * 100) / 100,
    buyImpactPct: Math.round(compra.priceImpactPct * 100) / 100,
    sellImpactPct: Math.round(venta.priceImpactPct * 100) / 100,
    route: compra.route,
    looksLikeHoneypot: inviable,
    note,
  };
}

// --------------------------------------------------------------------------
//  Precio de SOL, para convertir el tamano de posicion a lamports
// --------------------------------------------------------------------------

let cachePrecio: { at: number; precio: number } | null = null;
const CACHE_MS = 10 * 60 * 1000;

/**
 * Cuantos lamports equivalen a un importe en dolares.
 * El precio de SOL se cachea 10 minutos: es contexto, no hace falta pedirlo
 * en cada token analizado.
 */
export async function solLamportsForUsd(usd: number): Promise<bigint | null> {
  if (!cachePrecio || Date.now() - cachePrecio.at > CACHE_MS) {
    const { getToken } = await import('./dexscreener.js');
    const sol = await getToken('solana', WSOL).catch(() => null);
    if (!sol?.priceUsd || sol.priceUsd <= 0) return cachePrecio ? BigInt(Math.round((usd / cachePrecio.precio) * 1e9)) : null;
    cachePrecio = { at: Date.now(), precio: sol.priceUsd };
  }
  return BigInt(Math.round((usd / cachePrecio.precio) * 1e9));
}
