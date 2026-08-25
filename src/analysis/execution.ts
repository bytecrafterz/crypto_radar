/**
 * Ejecucion realista: cuanto mueve el precio nuestra propia operacion.
 *
 * El precio que muestra un agregador es el precio TEORICO (spot). El precio al
 * que realmente se compra o se vende es peor, y cuanto menos liquidez tiene el
 * pool, peor es. Sin esto, una "oportunidad" con 6.000 USD de liquidez parece
 * igual de buena que una con 200.000, y no lo es en absoluto.
 *
 * MATEMATICA
 * Los pools de Raydium, Orca, Uniswap V2 y Aerodrome son de producto constante
 * (x * y = k). Comprando con una cantidad dx de la moneda de cotizacion:
 *
 *     precio efectivo / precio spot - 1  =  dx / x
 *
 * donde x es la reserva de la moneda de cotizacion. Los agregadores publican la
 * liquidez TOTAL del pool (las dos patas), asi que x ~ liquidez / 2.
 *
 *     impacto ~ 2 * importe / liquidez
 *
 * Es una aproximacion, y se declara como tal: no tiene en cuenta comisiones del
 * pool ni pools concentrados (V3), donde el impacto real puede ser menor cerca
 * del precio actual y mucho peor fuera del rango.
 */
import { getFilters } from '../core/config.js';

export interface ExecutionEstimate {
  /** Importe simulado en USD. */
  tradeUsd: number;
  liquidityUsd: number;
  /** Cuanto mueve el precio la compra, en %. */
  buyImpactPct: number;
  /** Cuanto mueve el precio la venta posterior, en %. */
  sellImpactPct: number;
  /** Coste total estimado de entrar y salir, en % (sin contar comisiones del dex). */
  roundTripPct: number;
  /** Importe maximo que se puede mover sin superar el impacto objetivo. */
  maxTradeUsd: number;
  /** true si con este tamano la operacion no es razonable. */
  tooIlliquid: boolean;
  /** Explicacion en espanol lista para mostrar. */
  note: string;
}

/**
 * Estima el impacto de entrar y salir con un importe dado.
 * `targetImpactPct` es el impacto que se considera aceptable en una pata.
 */
export function estimateExecution(
  liquidityUsd: number | null,
  tradeUsd: number,
  targetImpactPct = 2,
): ExecutionEstimate | null {
  if (!liquidityUsd || liquidityUsd <= 0 || tradeUsd <= 0) return null;

  // Reserva de la moneda de cotizacion: la mitad del pool.
  const quoteReserve = liquidityUsd / 2;

  // Por encima del 100% la formula deja de tener sentido fisico (no se puede
  // perder mas del importe). Se acota para no publicar cifras absurdas como
  // "4.000.000% de impacto" cuando la liquidez es practicamente cero.
  const tope = (v: number) => Math.min(v, 100);

  const buyImpactPct = tope((tradeUsd / quoteReserve) * 100);
  // Al vender, la reserva ha cambiado; se aproxima con el mismo orden de magnitud.
  const sellImpactPct = tope((tradeUsd / (quoteReserve + tradeUsd)) * 100);
  const roundTripPct = tope(buyImpactPct + sellImpactPct);

  const maxTradeUsd = (targetImpactPct / 100) * quoteReserve;

  // Por encima del 10% de ida y vuelta la operacion deja de tener sentido:
  // el token tendria que subir un 10% solo para volver al punto de partida.
  const tooIlliquid = roundTripPct > 10;

  const note = tooIlliquid
    ? `Con ${Math.round(liquidityUsd).toLocaleString('es-ES')} USD de liquidez, entrar y salir con ${Math.round(tradeUsd)} USD costaria alrededor de un ${roundTripPct.toFixed(1)}% solo por mover el precio. Para no pasar del ${targetImpactPct}% habria que quedarse en unos ${Math.round(maxTradeUsd)} USD.`
    : `Con ${Math.round(liquidityUsd).toLocaleString('es-ES')} USD de liquidez, una entrada de ${Math.round(tradeUsd)} USD mueve el precio alrededor de un ${buyImpactPct.toFixed(2)}% (ida y vuelta ~${roundTripPct.toFixed(2)}%). Margen razonable hasta unos ${Math.round(maxTradeUsd)} USD.`;

  return {
    tradeUsd,
    liquidityUsd,
    buyImpactPct: Math.round(buyImpactPct * 100) / 100,
    sellImpactPct: Math.round(sellImpactPct * 100) / 100,
    roundTripPct: Math.round(roundTripPct * 100) / 100,
    maxTradeUsd: Math.round(maxTradeUsd),
    tooIlliquid,
    note,
  };
}

/** Estimacion con el tamano de posicion configurado por el usuario. */
export function estimateForConfiguredSize(liquidityUsd: number | null): ExecutionEstimate | null {
  const f = getFilters();
  const size = f.execution?.position_size_usd ?? 200;
  const target = f.execution?.max_impact_pct ?? 2;
  return estimateExecution(liquidityUsd, size, target);
}
