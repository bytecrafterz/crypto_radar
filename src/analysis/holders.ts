/**
 * Holders y concentracion.
 *
 * Detalle importante que marca la diferencia: antes de calcular la
 * concentracion hay que descontar el pool de liquidez, las direcciones de
 * quemado y los custodios. Si no se hace, el "top 10" sale siempre en torno
 * al 90% y el dato no sirve para decidir nada.
 */
import type { Chain, DiscoveredPair, HolderReport, HolderEntry } from '../core/types.js';
import { child } from '../core/logger.js';
import { nonHolderAddresses, burnAddresses, getFilters } from '../core/config.js';
import { env } from '../core/env.js';
import * as solana from '../sources/solanaRpc.js';
import * as base from '../sources/baseRpc.js';
import { formatUnits } from '../core/util.js';

const log = child('holders');

function tagFor(
  address: string,
  chain: Chain,
  pairAddress: string,
  deployer: string | null,
): string {
  const cmp = chain === 'base' ? address.toLowerCase() : address;
  const pool = chain === 'base' ? pairAddress.toLowerCase() : pairAddress;

  if (cmp === pool) return 'pool';
  if (burnAddresses(chain).has(cmp)) return 'quemado';
  if (deployer && cmp === (chain === 'base' ? deployer.toLowerCase() : deployer)) return 'creador';
  if (nonHolderAddresses(chain).has(cmp)) return 'contrato';
  return 'wallet';
}

/** Calcula la concentracion sobre los holders REALES. */
function computeConcentration(
  entries: HolderEntry[],
  deployer: string | null,
  chain: Chain,
): {
  top10Pct: number | null;
  top20Pct: number | null;
  largestRealPct: number | null;
  deployerPct: number | null;
} {
  const real = entries.filter((e) => e.tag === 'wallet' || e.tag === 'creador');
  if (real.length === 0) {
    return { top10Pct: null, top20Pct: null, largestRealPct: null, deployerPct: null };
  }

  const sorted = [...real].sort((a, b) => b.pct - a.pct);
  const sum = (arr: HolderEntry[]) => arr.reduce((acc, e) => acc + e.pct, 0);

  let deployerPct: number | null = null;
  if (deployer) {
    const cmp = chain === 'base' ? deployer.toLowerCase() : deployer;
    const found = entries.find(
      (e) => (chain === 'base' ? e.address.toLowerCase() : e.address) === cmp,
    );
    deployerPct = found ? found.pct : 0;
  }

  return {
    top10Pct: Math.round(sum(sorted.slice(0, 10)) * 100) / 100,
    top20Pct: Math.round(sum(sorted.slice(0, 20)) * 100) / 100,
    largestRealPct: Math.round(sorted[0].pct * 100) / 100,
    deployerPct,
  };
}

// --------------------------------------------------------------------------
//  SOLANA
// --------------------------------------------------------------------------

export async function analyzeSolanaHolders(
  pair: DiscoveredPair,
  deployer: string | null,
): Promise<HolderReport> {
  const filters = getFilters();
  const topN = filters.enrichment.top_holders_to_store;

  const supplyInfo = await solana.getTokenSupply(pair.tokenAddress);
  const totalSupply = supplyInfo ? BigInt(supplyInfo.amount) : 0n;
  const decimals = supplyInfo?.decimals ?? 0;

  if (totalSupply === 0n) {
    return {
      chain: 'solana',
      tokenAddress: pair.tokenAddress,
      holdersCount: null,
      top10Pct: null,
      top20Pct: null,
      largestRealPct: null,
      deployerPct: null,
      holders: [],
      partial: true,
      note: 'No se pudo leer el suministro del token.',
    };
  }

  // Camino preferido: lista completa via Helius (permite contar holders reales).
  const full = await solana.getAllHoldersHelius(pair.tokenAddress);

  let entries: HolderEntry[] = [];
  let holdersCount: number | null = null;
  let partial = true;
  let note: string | null = null;

  if (full && full.length > 0) {
    holdersCount = full.length;
    partial = false;
    entries = full.slice(0, Math.max(topN, 20)).map((h) => ({
      address: h.owner,
      balance: h.amount.toString(),
      pct: Number((h.amount * 10000n) / totalSupply) / 100,
      tag: tagFor(h.owner, 'solana', pair.pairAddress, deployer),
    }));
    note = `Lista completa de holders (${full.length} direcciones).`;
  } else {
    // Camino gratuito: las 20 mayores cuentas en una sola llamada RPC.
    const largest = await solana.getTokenLargestAccounts(pair.tokenAddress);
    if (largest.length === 0) {
      return {
        chain: 'solana',
        tokenAddress: pair.tokenAddress,
        holdersCount: null,
        top10Pct: null,
        top20Pct: null,
        largestRealPct: null,
        deployerPct: null,
        holders: [],
        partial: true,
        note: 'El RPC no devolvio las mayores cuentas del token.',
      };
    }

    entries = largest.map((a) => {
      const owner = a.owner ?? a.tokenAccount;
      let amount = 0n;
      try {
        amount = BigInt(a.amount);
      } catch {
        amount = 0n;
      }
      return {
        address: owner,
        balance: amount.toString(),
        pct: Number((amount * 10000n) / totalSupply) / 100,
        tag: tagFor(owner, 'solana', pair.pairAddress, deployer),
      };
    });

    // El total de holders solo se puede contar con la API DAS de Helius.
    holdersCount = await solana.getHolderCountHelius(pair.tokenAddress);
    if (holdersCount !== null) {
      note = `Top 20 analizado, ${holdersCount} holders en total.`;
    } else if (env.hasHelius) {
      note = 'Top 20 analizado. No se pudo contar el total de holders (la API no respondio).';
    } else {
      note = 'Solo top 20 (sin clave de Helius no se puede contar el total de holders).';
    }
  }

  const conc = computeConcentration(entries, deployer, 'solana');
  const pooled = entries.filter((e) => e.tag !== 'wallet' && e.tag !== 'creador');
  if (pooled.length > 0) {
    const pooledPct = pooled.reduce((a, e) => a + e.pct, 0);
    note = `${note ?? ''} Se descontaron ${pooled.length} direcciones que no son holders reales (${pooledPct.toFixed(1)}% del suministro: pool, quemado o contratos).`.trim();
  }

  return {
    chain: 'solana',
    tokenAddress: pair.tokenAddress,
    holdersCount,
    ...conc,
    holders: entries.slice(0, topN),
    partial,
    note,
  };
}

// --------------------------------------------------------------------------
//  BASE
// --------------------------------------------------------------------------

/**
 * En Base no existe una lista de holders en la cadena: hay que reconstruirla
 * sumando todos los eventos Transfer desde que existe el token. Como los
 * tokens que analizamos son nuevos, tienen pocos eventos y esto es viable
 * con el plan gratuito.
 */
export async function analyzeBaseHolders(
  pair: DiscoveredPair,
  deployer: string | null,
  deployBlock: number | null,
): Promise<HolderReport> {
  const filters = getFilters();
  const topN = filters.enrichment.top_holders_to_store;

  const erc20 = await base.getErc20Info(pair.tokenAddress);
  const totalSupply = erc20.totalSupply;
  const decimals = erc20.decimals ?? 18;

  if (!totalSupply || totalSupply === 0n) {
    return {
      chain: 'base',
      tokenAddress: pair.tokenAddress,
      holdersCount: null,
      top10Pct: null,
      top20Pct: null,
      largestRealPct: null,
      deployerPct: null,
      holders: [],
      partial: true,
      note: 'No se pudo leer el suministro total del contrato.',
    };
  }

  const currentBlock = await base.getBlockNumber();
  if (currentBlock === null) {
    return {
      chain: 'base',
      tokenAddress: pair.tokenAddress,
      holdersCount: null,
      top10Pct: null,
      top20Pct: null,
      largestRealPct: null,
      deployerPct: null,
      holders: [],
      partial: true,
      note: 'El RPC de Base no respondio al pedir el bloque actual.',
    };
  }

  const maxLookback = filters.enrichment.base_max_blocks_lookback;
  const fromBlock = deployBlock ?? Math.max(0, currentBlock - maxLookback);
  const blocksToRead = currentBlock - fromBlock;
  const chunkSize = filters.enrichment.base_log_chunk_blocks;
  // +1 para que el ultimo tramo entre completo: si no, un rango que encaja
  // justo se marcaria como parcial sin serlo.
  const maxChunks = Math.ceil(blocksToRead / chunkSize) + 1;

  const lectura = await base.getTransferLogs(
    pair.tokenAddress,
    fromBlock,
    currentBlock,
    chunkSize,
    maxChunks,
  );
  const logs = lectura.logs;

  if (logs.length === 0) {
    return {
      chain: 'base',
      tokenAddress: pair.tokenAddress,
      holdersCount: null,
      top10Pct: null,
      top20Pct: null,
      largestRealPct: null,
      deployerPct: null,
      holders: [],
      partial: true,
      note: 'No se encontraron eventos de transferencia en el rango consultado.',
    };
  }

  const transfers = base.decodeTransfers(logs);
  const balances = base.balancesFromTransfers(transfers);

  // Para poder decir que la lista es EXACTA hacen falta dos cosas: haber
  // empezado en el bloque de creacion Y haber leido todos los tramos sin
  // huecos. Con un solo tramo perdido, un traspaso grande puede no aparecer
  // y la concentracion sale mal. Antes solo se miraba el bloque de inicio.
  const exact = deployBlock !== null && lectura.complete;

  const sorted = [...balances.entries()].sort((a, b) => (b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0));

  const entries: HolderEntry[] = sorted.slice(0, Math.max(topN, 20)).map(([address, balance]) => ({
    address,
    balance: balance.toString(),
    pct: Number((balance * 10000n) / totalSupply) / 100,
    tag: tagFor(address, 'base', pair.pairAddress, deployer),
  }));

  const conc = computeConcentration(entries, deployer, 'base');
  const pooled = entries.filter((e) => e.tag !== 'wallet' && e.tag !== 'creador');
  const pooledPct = pooled.reduce((a, e) => a + e.pct, 0);

  const note = [
    exact
      ? `Lista reconstruida desde la creacion del token (${transfers.length} transferencias).`
      : !lectura.complete
        ? `Lista INCOMPLETA: no se pudieron leer ${lectura.blocksMissing} bloques de ${blocksToRead} (${transfers.length} transferencias leidas). Los porcentajes pueden estar mal.`
        : `Lista reconstruida sobre los ultimos ${blocksToRead} bloques (${transfers.length} transferencias): puede ser aproximada.`,
    pooled.length > 0
      ? `Se descontaron ${pooled.length} direcciones que no son holders reales (${pooledPct.toFixed(1)}% del suministro).`
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return {
    chain: 'base',
    tokenAddress: pair.tokenAddress,
    holdersCount: balances.size,
    ...conc,
    holders: entries.slice(0, topN),
    partial: !exact,
    note,
  };
}

export async function analyzeHolders(
  pair: DiscoveredPair,
  deployer: string | null,
  deployBlock: number | null,
): Promise<HolderReport> {
  try {
    return pair.chain === 'solana'
      ? await analyzeSolanaHolders(pair, deployer)
      : await analyzeBaseHolders(pair, deployer, deployBlock);
  } catch (err) {
    log.error({ token: pair.tokenAddress, err: String(err) }, 'fallo el analisis de holders');
    return {
      chain: pair.chain,
      tokenAddress: pair.tokenAddress,
      holdersCount: null,
      top10Pct: null,
      top20Pct: null,
      largestRealPct: null,
      deployerPct: null,
      holders: [],
      partial: true,
      note: `Error analizando holders: ${String(err)}`,
    };
  }
}

/** Formatea un saldo en unidades legibles del token. */
export function displayBalance(balance: string, decimals: number): number {
  try {
    return formatUnits(BigInt(balance), decimals);
  } catch {
    return 0;
  }
}
