/**
 * Contexto general del mercado.
 *
 * El mismo comportamiento en un token NO significa lo mismo cuando el mercado
 * entero sube que cuando esta cayendo. Una subida del 15% con SOL plano es una
 * senal propia del token; la misma subida con SOL subiendo un 12% es, en gran
 * parte, marea general.
 *
 * Este modulo mide el estado del mercado con las dos monedas de referencia de
 * las cadenas que vigilamos (SOL y ETH) y devuelve un contexto que el motor de
 * puntuacion usa para exigir mas o menos segun el momento.
 */
import * as dexscreener from '../sources/dexscreener.js';
import { child } from '../core/logger.js';
import { safeNum } from '../core/util.js';

const log = child('mercado');

/** SOL envuelto: su par principal contra USDC marca el pulso de Solana. */
const WSOL = 'So11111111111111111111111111111111111111112';
/** WETH en Base: misma funcion para la cadena Base. */
const WETH_BASE = '0x4200000000000000000000000000000000000006';

export type MarketRegime = 'fuerte' | 'neutral' | 'debil';

export interface MarketContext {
  regime: MarketRegime;
  /** Variacion en 24 h de las monedas de referencia. */
  solChangeH24: number | null;
  ethChangeH24: number | null;
  /** Variacion en 6 h, para detectar giros recientes. */
  solChangeH6: number | null;
  ethChangeH6: number | null;
  /** Media ponderada que resume el estado (-100..100). */
  pulse: number;
  /** Texto en espanol para explicarlo en la alerta. */
  note: string;
  /** true si no se pudo medir y se asume neutral. */
  unknown: boolean;
}

const NEUTRAL: MarketContext = {
  regime: 'neutral',
  solChangeH24: null,
  ethChangeH24: null,
  solChangeH6: null,
  ethChangeH6: null,
  pulse: 0,
  note: 'No se pudo medir el estado general del mercado; se trata como neutral.',
  unknown: true,
};

let cache: { at: number; value: MarketContext } | null = null;
const CACHE_MS = 10 * 60 * 1000; // el pulso del mercado no cambia cada minuto

/**
 * Estado del mercado. Se cachea 10 minutos: es un dato de contexto, no hace
 * falta pedirlo por cada token analizado.
 */
export async function getMarketContext(): Promise<MarketContext> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.value;

  try {
    const [sol, eth] = await Promise.all([
      dexscreener.getToken('solana', WSOL),
      dexscreener.getToken('base', WETH_BASE),
    ]);

    if (!sol && !eth) {
      cache = { at: Date.now(), value: NEUTRAL };
      return NEUTRAL;
    }

    const solH24 = sol?.priceChangeH24 ?? null;
    const ethH24 = eth?.priceChangeH24 ?? null;
    const solH6 = sol?.priceChangeH6 ?? null;
    const ethH6 = eth?.priceChangeH6 ?? null;

    // Media de las referencias disponibles. La ventana de 6 h pesa menos:
    // sirve para captar giros, no para mandar sobre la tendencia del dia.
    const h24 = promedio([solH24, ethH24]);
    const h6 = promedio([solH6, ethH6]);
    const pulse = h24 === null && h6 === null ? 0 : safeNum(h24, 0) * 0.7 + safeNum(h6, 0) * 0.3;

    const regime: MarketRegime = pulse >= 3 ? 'fuerte' : pulse <= -3 ? 'debil' : 'neutral';

    const value: MarketContext = {
      regime,
      solChangeH24: solH24,
      ethChangeH24: ethH24,
      solChangeH6: solH6,
      ethChangeH6: ethH6,
      pulse: Math.round(pulse * 100) / 100,
      note: describir(regime, solH24, ethH24),
      unknown: false,
    };

    cache = { at: Date.now(), value };
    log.info({ regime, pulse: value.pulse, solH24, ethH24 }, 'contexto de mercado actualizado');
    return value;
  } catch (err) {
    log.warn({ err: String(err) }, 'no se pudo medir el mercado, se asume neutral');
    cache = { at: Date.now(), value: NEUTRAL };
    return NEUTRAL;
  }
}

function promedio(valores: Array<number | null>): number | null {
  const validos = valores.filter((v): v is number => v !== null && Number.isFinite(v));
  if (validos.length === 0) return null;
  return validos.reduce((a, b) => a + b, 0) / validos.length;
}

function describir(regime: MarketRegime, sol: number | null, eth: number | null): string {
  const detalle = [
    sol !== null ? `SOL ${sol > 0 ? '+' : ''}${sol.toFixed(1)}%` : null,
    eth !== null ? `ETH ${eth > 0 ? '+' : ''}${eth.toFixed(1)}%` : null,
  ]
    .filter(Boolean)
    .join(', ');

  if (regime === 'fuerte') {
    return `Mercado general al alza (${detalle} en 24 h): parte de la subida de cualquier token viene de la marea general.`;
  }
  if (regime === 'debil') {
    return `Mercado general a la baja (${detalle} en 24 h): un token que sube a contracorriente es mas destacable, pero el riesgo de arrastre es mayor.`;
  }
  return `Mercado general estable (${detalle} en 24 h).`;
}

/** Fuerza el refresco. Solo se usa en pruebas. */
export function resetMarketCache(): void {
  cache = null;
}
