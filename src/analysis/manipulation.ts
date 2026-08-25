/**
 * Movimientos sospechosos, bots y posibles manipulaciones.
 *
 * Todo esto es analisis propio sobre datos publicos: no existe ninguna API
 * que te diga "esto es manipulacion". Cada senal se marca con un nivel
 * (info / aviso / peligro) y nunca como una certeza.
 */
import type { DiscoveredPair, HolderReport, SuspiciousEvent } from '../core/types.js';
import { child } from '../core/logger.js';
import { getFilters } from '../core/config.js';
import { env } from '../core/env.js';
import * as base from '../sources/baseRpc.js';
import * as solana from '../sources/solanaRpc.js';
import { safeNum } from '../core/util.js';

const log = child('manipulacion');

/** Fila del historico de mediciones que usamos para comparar. */
export interface SnapshotLite {
  ts: Date;
  price_usd: number | null;
  liquidity_usd: number | null;
  market_cap_usd: number | null;
  volume_h1: number | null;
  volume_h24: number | null;
  holders_count: number | null;
  txns_h1_buys: number | null;
  txns_h1_sells: number | null;
}

// --------------------------------------------------------------------------
//  Senales calculadas sobre los datos de mercado (sin coste extra)
// --------------------------------------------------------------------------

/** Presion vendedora extrema. */
export function detectSellPressure(pair: DiscoveredPair): SuspiciousEvent | null {
  const buys = safeNum(pair.txnsH1Buys, 0);
  const sells = safeNum(pair.txnsH1Sells, 0);
  if (buys + sells < 20) return null;
  if (sells <= buys * 2) return null;

  return {
    kind: 'sell_pressure',
    severity: sells > buys * 4 ? 'danger' : 'warn',
    detail: `En la ultima hora hay ${sells} ventas frente a ${buys} compras (${(sells / Math.max(buys, 1)).toFixed(1)} a 1).`,
    data: { buys, sells },
  };
}

/**
 * Volumen alto sin crecimiento de holders: el clasico volumen inflado.
 * Necesita al menos dos mediciones para compararse.
 */
export function detectVolumeWithoutHolders(
  pair: DiscoveredPair,
  history: SnapshotLite[],
): SuspiciousEvent | null {
  if (history.length < 2) return null;

  const oldest = history[history.length - 1];
  const newest = history[0];
  if (oldest.holders_count === null || newest.holders_count === null) return null;

  const holderDelta = newest.holders_count - oldest.holders_count;
  const volume = safeNum(pair.volumeH1, 0);
  const liquidity = safeNum(pair.liquidityUsd, 1);

  // Mucho volumen respecto a la liquidez pero casi nadie nuevo comprando.
  if (volume > liquidity * 3 && holderDelta <= 2) {
    return {
      kind: 'volume_without_holders',
      severity: 'danger',
      detail: `Volumen de ${volume.toFixed(0)} USD en 1 h con la liquidez en ${liquidity.toFixed(0)} USD, pero solo ${holderDelta} holders nuevos. Muy probable volumen artificial.`,
      data: { volume, liquidity, holderDelta },
    };
  }
  return null;
}

/** Relacion volumen/liquidez imposible de sostener por operaciones reales. */
export function detectWashTradingByRatio(pair: DiscoveredPair): SuspiciousEvent | null {
  const volume = safeNum(pair.volumeH24, 0);
  const liquidity = safeNum(pair.liquidityUsd, 0);
  if (liquidity <= 0 || volume <= 0) return null;

  const ratio = volume / liquidity;
  if (ratio < 40) return null;

  return {
    kind: 'wash_trading',
    severity: ratio > 100 ? 'danger' : 'warn',
    detail: `El volumen de 24 h es ${ratio.toFixed(0)} veces la liquidez del pool. Un ratio asi casi siempre indica operaciones repetidas para inflar el volumen.`,
    data: { ratio, volume, liquidity },
  };
}

/**
 * Retirada de liquidez.
 *
 * OJO con la trampa: la liquidez que publican los agregadores esta en USD, y en
 * un pool de producto constante ese valor BAJA SOLO cuando baja el precio, sin
 * que nadie haya retirado nada. Concretamente el valor del pool es proporcional
 * a la raiz cuadrada del precio:
 *
 *     valor = 2 * raiz(k * precio)   ->   valor2/valor1 = raiz(precio2/precio1)
 *
 * Asi que una caida de precio del 40% reduce la liquidez publicada un ~22%
 * por pura matematica. Sin descontar eso, cualquier bajada fuerte se anunciaba
 * como "han retirado la liquidez", que es una alerta falsa grave.
 */
export function detectLiquidityRemoval(
  pair: DiscoveredPair,
  history: SnapshotLite[],
): SuspiciousEvent | null {
  if (history.length === 0) return null;
  const filters = getFilters();

  // Maximo historico de liquidez y el precio que habia en ese momento.
  let peak = 0;
  let peakPrice = 0;
  for (const s of history) {
    const liq = safeNum(s.liquidity_usd, 0);
    if (liq > peak) {
      peak = liq;
      peakPrice = safeNum(s.price_usd, 0);
    }
  }

  const current = safeNum(pair.liquidityUsd, 0);
  const currentPrice = safeNum(pair.priceUsd, 0);
  if (peak <= 0) return null;

  // Cuanta liquidez DEBERIA quedar solo por el movimiento del precio.
  const esperada =
    peakPrice > 0 && currentPrice > 0 ? peak * Math.sqrt(currentPrice / peakPrice) : peak;

  // Caida que no explica el precio: eso si es retirada de verdad.
  const dropReal = esperada > 0 ? ((esperada - current) / esperada) * 100 : 0;
  const dropBruta = ((peak - current) / peak) * 100;

  if (dropReal < filters.monitoring.liquidity_drop_alert_pct) return null;

  const explicaPrecio = dropBruta - dropReal;

  return {
    kind: 'liquidity_removed',
    severity: dropReal > 50 ? 'danger' : 'warn',
    detail:
      `Se ha retirado liquidez: queda un ${dropReal.toFixed(1)}% menos de la que deberia haber. ` +
      `De ${peak.toFixed(0)} USD a ${current.toFixed(0)} USD` +
      (explicaPrecio > 2
        ? ` (de la bajada total, un ${explicaPrecio.toFixed(1)}% lo explica la caida de precio y el resto es retirada).`
        : '.'),
    data: { peak, current, esperada, dropReal, dropBruta },
  };
}

/** Desplome de precio en poco tiempo. */
export function detectPriceCrash(pair: DiscoveredPair): SuspiciousEvent | null {
  const filters = getFilters();
  const m5 = pair.priceChangeM5;
  if (m5 === null) return null;
  if (m5 > -filters.monitoring.price_crash_alert_pct) return null;

  return {
    kind: 'price_crash',
    severity: 'danger',
    detail: `El precio ha caido un ${Math.abs(m5).toFixed(1)}% en 5 minutos.`,
    data: { priceChangeM5: m5 },
  };
}

// --------------------------------------------------------------------------
//  Senales que requieren leer la cadena
// --------------------------------------------------------------------------

/**
 * Compras agrupadas en el mismo bloque (Base).
 * Cuando varias wallets distintas reciben el token en el mismo bloque,
 * o son bots sniper o es una compra coordinada del equipo.
 */
export async function detectSniperClusterBase(
  pair: DiscoveredPair,
  deployBlock: number | null,
): Promise<SuspiciousEvent | null> {
  const currentBlock = await base.getBlockNumber();
  if (currentBlock === null) return null;

  const from = deployBlock ?? Math.max(0, currentBlock - 3000);
  const to = Math.min(currentBlock, from + 300); // primeros ~10 minutos

  const { logs } = await base.getTransferLogs(pair.tokenAddress, from, to, 300, 2);
  if (logs.length === 0) return null;

  const transfers = base.decodeTransfers(logs);
  const pool = pair.pairAddress.toLowerCase();

  // Agrupamos por bloque las compras (salidas desde el pool hacia wallets).
  const byBlock = new Map<number, Set<string>>();
  for (const t of transfers) {
    if (t.from !== pool) continue;
    const set = byBlock.get(t.blockNumber) ?? new Set<string>();
    set.add(t.to);
    byBlock.set(t.blockNumber, set);
  }

  let worstBlock = 0;
  let worstCount = 0;
  for (const [block, buyers] of byBlock) {
    if (buyers.size > worstCount) {
      worstCount = buyers.size;
      worstBlock = block;
    }
  }

  if (worstCount < 4) return null;

  return {
    kind: 'sniper_cluster',
    severity: worstCount >= 8 ? 'danger' : 'warn',
    detail: `${worstCount} wallets distintas compraron en el mismo bloque (${worstBlock}). Patron tipico de bots sniper o compra coordinada.`,
    data: { block: worstBlock, buyers: worstCount },
  };
}

/**
 * Transferencias repetidas entre las mismas direcciones (Base).
 * Es la huella del wash trading manual.
 */
export async function detectWashTradingBase(
  pair: DiscoveredPair,
  deployBlock: number | null,
): Promise<SuspiciousEvent | null> {
  const currentBlock = await base.getBlockNumber();
  if (currentBlock === null) return null;

  const from = Math.max(deployBlock ?? 0, currentBlock - 2000);
  const { logs } = await base.getTransferLogs(pair.tokenAddress, from, currentBlock, 1000, 2);
  if (logs.length < 20) return null;

  const transfers = base.decodeTransfers(logs);
  const pool = pair.pairAddress.toLowerCase();

  // Contamos cuantas veces cada wallet compra Y vende.
  const bought = new Map<string, number>();
  const sold = new Map<string, number>();
  for (const t of transfers) {
    if (t.from === pool) bought.set(t.to, (bought.get(t.to) ?? 0) + 1);
    if (t.to === pool) sold.set(t.from, (sold.get(t.from) ?? 0) + 1);
  }

  let roundTrippers = 0;
  let maxCycles = 0;
  for (const [addr, buys] of bought) {
    const sells = sold.get(addr) ?? 0;
    const cycles = Math.min(buys, sells);
    if (cycles >= 3) {
      roundTrippers++;
      maxCycles = Math.max(maxCycles, cycles);
    }
  }

  if (roundTrippers < 2) return null;

  return {
    kind: 'wash_trading',
    severity: roundTrippers >= 5 ? 'danger' : 'warn',
    detail: `${roundTrippers} wallets compran y venden repetidamente el mismo token (hasta ${maxCycles} ciclos). Es el patron habitual del volumen inflado.`,
    data: { roundTrippers, maxCycles },
  };
}

/**
 * Compras agrupadas en Solana. Solo con clave de Helius, porque necesita
 * transacciones ya interpretadas.
 */
export async function detectSniperClusterSolana(
  pair: DiscoveredPair,
): Promise<SuspiciousEvent | null> {
  if (!env.hasHelius) return null;

  const txs = await solana.getEnrichedTransactions(pair.tokenAddress, { limit: 100 });
  if (!txs || txs.length === 0) return null;

  // Agrupamos por segundo: en Solana los bloques van muy rapido.
  const bySecond = new Map<number, Set<string>>();
  for (const tx of txs) {
    const received = tx.tokenTransfers?.some(
      (t) => t.mint === pair.tokenAddress && (t.tokenAmount ?? 0) > 0,
    );
    if (!received) continue;
    const set = bySecond.get(tx.timestamp) ?? new Set<string>();
    set.add(tx.feePayer);
    bySecond.set(tx.timestamp, set);
  }

  let worstCount = 0;
  let worstTs = 0;
  for (const [ts, wallets] of bySecond) {
    if (wallets.size > worstCount) {
      worstCount = wallets.size;
      worstTs = ts;
    }
  }

  if (worstCount < 5) return null;

  return {
    kind: 'sniper_cluster',
    severity: worstCount >= 10 ? 'danger' : 'warn',
    detail: `${worstCount} wallets distintas operaron el token en el mismo segundo. Patron tipico de bots.`,
    data: { timestamp: worstTs, wallets: worstCount },
  };
}

/**
 * Wallets con saldos casi identicos entre los mayores holders:
 * huella de un reparto artificial hecho por el equipo.
 */
export function detectIdenticalBalances(holders: HolderReport | null): SuspiciousEvent | null {
  if (!holders) return null;
  const wallets = holders.holders.filter((h) => h.tag === 'wallet');
  if (wallets.length < 5) return null;

  // Agrupamos por porcentaje redondeado a 2 decimales.
  const groups = new Map<string, number>();
  for (const w of wallets) {
    const key = w.pct.toFixed(2);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }

  let maxGroup = 0;
  let groupPct = '';
  for (const [pct, count] of groups) {
    if (count > maxGroup) {
      maxGroup = count;
      groupPct = pct;
    }
  }

  if (maxGroup < 4) return null;

  return {
    kind: 'bot_pattern',
    severity: maxGroup >= 6 ? 'danger' : 'warn',
    detail: `${maxGroup} wallets tienen exactamente el mismo porcentaje del suministro (${groupPct}%). Reparto artificial entre wallets controladas por la misma persona.`,
    data: { count: maxGroup, pct: groupPct },
  };
}

// --------------------------------------------------------------------------
//  Orquestador
// --------------------------------------------------------------------------

export interface ManipulationInput {
  pair: DiscoveredPair;
  holders: HolderReport | null;
  history: SnapshotLite[];
  deployBlock: number | null;
  /** Analisis profundo (lee la cadena). Se activa solo en el enriquecimiento. */
  deep: boolean;
}

export async function analyzeManipulation(input: ManipulationInput): Promise<SuspiciousEvent[]> {
  const { pair, holders, history, deployBlock, deep } = input;
  const events: SuspiciousEvent[] = [];

  // Senales baratas: siempre.
  const cheap = [
    detectSellPressure(pair),
    detectWashTradingByRatio(pair),
    detectVolumeWithoutHolders(pair, history),
    detectLiquidityRemoval(pair, history),
    detectPriceCrash(pair),
    detectIdenticalBalances(holders),
  ];
  for (const e of cheap) if (e) events.push(e);

  if (!deep) return dedupe(events);

  // Senales que leen la cadena: solo en el analisis profundo.
  try {
    if (pair.chain === 'base') {
      const [sniper, wash] = await Promise.all([
        detectSniperClusterBase(pair, deployBlock),
        detectWashTradingBase(pair, deployBlock),
      ]);
      if (sniper) events.push(sniper);
      if (wash) events.push(wash);
    } else {
      const sniper = await detectSniperClusterSolana(pair);
      if (sniper) events.push(sniper);
    }
  } catch (err) {
    log.warn({ token: pair.tokenAddress, err: String(err) }, 'fallo el analisis profundo de manipulacion');
  }

  return dedupe(events);
}

/** Nos quedamos con la senal mas grave de cada tipo. */
function dedupe(events: SuspiciousEvent[]): SuspiciousEvent[] {
  const order = { info: 0, warn: 1, danger: 2 } as const;
  const best = new Map<string, SuspiciousEvent>();
  for (const e of events) {
    const prev = best.get(e.kind);
    if (!prev || order[e.severity] > order[prev.severity]) best.set(e.kind, e);
  }
  return [...best.values()];
}
