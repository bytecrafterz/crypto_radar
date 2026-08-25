/**
 * Resolver: de lo que dice el mensaje a un token concreto.
 *
 * EL PROBLEMA
 * La mitad de los mensajes nombran un ticker ($PEPE) y no una direccion.
 * Pero los tickers NO son unicos: cualquiera puede lanzar un token y
 * llamarlo $PEPE. Ahora mismo hay decenas.
 *
 * Si el sistema elige mal, todo lo que viene despues queda envenenado: se
 * analiza un token del que nadie hablaba, se mide su precio, se le atribuye
 * la reputacion a un canal por algo que no dijo. Y lo peor es que no se
 * nota: los numeros salen, solo que son de otra moneda.
 *
 * REGLA
 * Si hay direccion en el mensaje, se usa y punto. Si solo hay ticker y
 * queda cualquier duda, se descarta. Preferimos perder una senal buena
 * antes que meter una equivocada.
 */
import * as dexscreener from '../sources/dexscreener.js';
import { child } from '../core/logger.js';
import type { Chain } from '../core/types.js';

const log = child('resolver');

/**
 * Liquidez minima para que un candidato cuente.
 *
 * Los tokens abandonados con 50 dolares dentro contaminan las busquedas
 * por ticker: son decenas y ninguno es del que se esta hablando.
 */
const LIQUIDEZ_MINIMA_USD = 5000;

/**
 * Cuanto mas grande tiene que ser el mejor candidato frente al segundo
 * para considerarlo claro.
 *
 * Si el primero tiene 10 veces mas liquidez que el segundo, casi con
 * seguridad es del que se habla. Si tienen tamano parecido, no hay forma
 * de saberlo y no se adivina.
 */
const FACTOR_DOMINANCIA = 10;

export type Resolucion =
  | { ok: true; chain: Chain; address: string; symbol: string; via: 'contrato' | 'ticker' }
  | { ok: false; motivo: string };

/**
 * Resuelve a partir de una direccion encontrada en el mensaje.
 * Es el camino fiable: la direccion identifica el token sin ambiguedad.
 */
/**
 * Direcciones que nunca son un token del que merezca la pena hablar.
 *
 * La direccion cero y las de quemado aparecen en los mensajes todo el
 * rato ("liquidity sent to 0x000...dead"), y DexScreener responde a la
 * direccion cero con el ETH nativo, asi que sin esta lista el sistema
 * acabaria analizando ETH cada vez que alguien menciona una quema.
 */
const DIRECCIONES_SENTINELA = new Set([
  '0x0000000000000000000000000000000000000000',
  '0x000000000000000000000000000000000000dead',
  '0xdead000000000000000042069420694206942069',
  '11111111111111111111111111111111',
  'so11111111111111111111111111111111111111112', // WSOL
]);

export async function porDireccion(chain: Chain, address: string): Promise<Resolucion> {
  if (DIRECCIONES_SENTINELA.has(address.toLowerCase())) {
    return {
      ok: false,
      motivo: 'es una direccion de sistema o de quemado, no un token analizable',
    };
  }

  const pair = await dexscreener.getToken(chain, address).catch(() => null);
  if (!pair) {
    return { ok: false, motivo: 'la direccion no corresponde a ningun token con mercado' };
  }

  // COMPROBACION IMPRESCINDIBLE
  // DexScreener no siempre devuelve el token que se le pidio: ante una
  // direccion que no reconoce puede responder con el otro lado del par
  // (WETH, SOL...) o con algo aproximado. Sin esta comprobacion, pedir la
  // direccion cero devolvia "ETH" tan tranquilamente, y el sistema habria
  // seguido adelante analizando un token que nadie menciono.
  if (pair.tokenAddress?.toLowerCase() !== address.toLowerCase()) {
    log.warn(
      { pedido: address, devuelto: pair.tokenAddress },
      'DexScreener devolvio un token distinto al pedido',
    );
    return {
      ok: false,
      motivo: 'la direccion no corresponde a ningun token con mercado',
    };
  }

  return { ok: true, chain, address, symbol: pair.symbol, via: 'contrato' };
}

/**
 * Resuelve a partir de un ticker. Camino inseguro por naturaleza.
 */
export async function porTicker(ticker: string): Promise<Resolucion> {
  const limpio = ticker.replace(/^\$/, '').trim();
  if (limpio.length < 2) {
    return { ok: false, motivo: 'ticker demasiado corto' };
  }

  const encontrados = await dexscreener.search(limpio).catch(() => []);
  if (encontrados.length === 0) {
    return { ok: false, motivo: `ningun token encontrado para ${ticker}` };
  }

  // Solo cadenas que el radar sabe analizar, y solo con liquidez real.
  const validos = encontrados
    .filter((p) => p.chain === 'solana' || p.chain === 'base')
    .filter((p) => (p.liquidityUsd ?? 0) >= LIQUIDEZ_MINIMA_USD)
    // El simbolo tiene que coincidir de verdad: la busqueda de DexScreener
    // tambien devuelve coincidencias por nombre, que no sirven.
    .filter((p) => p.symbol?.toLowerCase() === limpio.toLowerCase())
    .sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));

  if (validos.length === 0) {
    return {
      ok: false,
      motivo: `${ticker}: hay resultados pero ninguno con liquidez suficiente en Solana o Base`,
    };
  }

  const primero = validos[0];
  const segundo = validos[1];

  // Un solo candidato: claro.
  if (!segundo) {
    return {
      ok: true, chain: primero.chain, address: primero.tokenAddress,
      symbol: primero.symbol, via: 'ticker',
    };
  }

  // Varios candidatos: solo vale si uno domina claramente.
  const liqA = primero.liquidityUsd ?? 0;
  const liqB = segundo.liquidityUsd ?? 0;

  if (liqB > 0 && liqA / liqB < FACTOR_DOMINANCIA) {
    log.debug({ ticker, candidatos: validos.length }, 'ticker ambiguo, se descarta');
    return {
      ok: false,
      motivo:
        `${ticker} es ambiguo: hay ${validos.length} tokens con ese simbolo y ` +
        `tamano parecido. Sin la direccion no se puede saber cual es.`,
    };
  }

  return {
    ok: true, chain: primero.chain, address: primero.tokenAddress,
    symbol: primero.symbol, via: 'ticker',
  };
}
