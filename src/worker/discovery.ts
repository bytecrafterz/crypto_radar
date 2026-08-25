/**
 * Etapa 0: descubrimiento de tokens y pools nuevos.
 *
 * Usa dos fuentes gratuitas y sin clave, y las cruza:
 *   - GeckoTerminal /new_pools : pools recien creadas (deteccion pura)
 *   - DexScreener perfiles y boosts : tokens que empiezan a moverse
 *
 * Todo lo que se ve se guarda, pase o no el filtro. Asi tienes historico
 * desde el primer dia, incluido lo descartado y por que.
 */
import type { Chain, DiscoveredPair } from '../core/types.js';
import { child } from '../core/logger.js';
import { getFilters } from '../core/config.js';
import { logActivity } from '../core/db.js';
import * as repo from '../core/repo.js';
import * as dexscreener from '../sources/dexscreener.js';
import * as geckoterminal from '../sources/geckoterminal.js';
import { prefilter } from './prefilter.js';

const log = child('deteccion');

export interface DiscoveryStats {
  seen: number;
  nuevos: number;
  aceptados: number;
  descartados: number;
  errores: number;
}

/** Une los pares de varias fuentes quedandose con el mas completo. */
function mergePairs(lists: DiscoveredPair[][]): DiscoveredPair[] {
  const byKey = new Map<string, DiscoveredPair>();

  for (const list of lists) {
    for (const pair of list) {
      const key = `${pair.chain}:${pair.tokenAddress}`;
      const prev = byKey.get(key);
      if (!prev) {
        byKey.set(key, pair);
        continue;
      }
      // Nos quedamos con el que tenga mas datos rellenos.
      const score = (p: DiscoveredPair) =>
        [p.liquidityUsd, p.volumeH24, p.marketCapUsd, p.pairCreatedAt, p.txnsH1Buys, p.website].filter(
          (v) => v !== null && v !== undefined,
        ).length;
      if (score(pair) > score(prev)) {
        byKey.set(key, { ...prev, ...pair });
      } else {
        // Completamos huecos del que ya teniamos.
        byKey.set(key, {
          ...pair,
          ...prev,
          website: prev.website ?? pair.website,
          twitter: prev.twitter ?? pair.twitter,
          telegram: prev.telegram ?? pair.telegram,
          discord: prev.discord ?? pair.discord,
          pairCreatedAt: prev.pairCreatedAt ?? pair.pairCreatedAt,
        });
      }
    }
  }

  return [...byKey.values()];
}

async function discoverChain(chain: Chain, sources: string[]): Promise<DiscoveredPair[]> {
  const lists: DiscoveredPair[][] = [];

  if (sources.includes('geckoterminal')) {
    try {
      const [newPools, trending] = await Promise.all([
        geckoterminal.getNewPools(chain),
        geckoterminal.getTrendingPools(chain),
      ]);
      lists.push(newPools, trending);
    } catch (err) {
      log.warn({ chain, err: String(err) }, 'GeckoTerminal fallo');
    }
  }

  if (sources.includes('dexscreener')) {
    try {
      const [profiles, boosts] = await Promise.all([
        dexscreener.getLatestProfiles(),
        dexscreener.getLatestBoosts(),
      ]);

      const addresses = [...new Set([...profiles, ...boosts].filter((p) => p.chain === chain).map((p) => p.address))];

      // DexScreener acepta hasta 30 direcciones por peticion.
      for (let i = 0; i < addresses.length; i += 30) {
        const batch = addresses.slice(i, i + 30);
        const pairs = await dexscreener.getTokens(chain, batch);
        lists.push(pairs);
      }
    } catch (err) {
      log.warn({ chain, err: String(err) }, 'DexScreener fallo');
    }
  }

  return mergePairs(lists);
}

/** Una vuelta completa de deteccion. */
export async function runDiscovery(): Promise<DiscoveryStats> {
  const filters = getFilters();
  const chains = filters.discovery.chains as Chain[];
  const sources = filters.discovery.sources;

  const stats: DiscoveryStats = { seen: 0, nuevos: 0, aceptados: 0, descartados: 0, errores: 0 };

  for (const chain of chains) {
    let pairs: DiscoveredPair[] = [];
    try {
      pairs = await discoverChain(chain, sources);
    } catch (err) {
      stats.errores++;
      log.error({ chain, err: String(err) }, 'fallo la deteccion en esta cadena');
      continue;
    }

    stats.seen += pairs.length;

    for (const pair of pairs) {
      try {
        const existing = await repo.getToken(chain, pair.tokenAddress);
        const isNew = existing === null;

        const stored = await repo.upsertToken(pair);
        if (isNew) stats.nuevos++;

        // Guardamos una medicion siempre que sea nuevo o este en seguimiento.
        const tracked = stored.tracked_until !== null && stored.tracked_until > new Date();
        if (isNew || tracked) {
          await repo.insertSnapshot(stored.id, pair);
        }

        // El filtro solo decide sobre tokens que aun no se han analizado.
        if (stored.enriched_at !== null) continue;

        const verdict = prefilter(pair);
        if (verdict.pass) {
          stats.aceptados++;
          if (stored.status !== 'nuevo') await repo.setStatus(stored.id, 'nuevo');
          if (isNew) {
            log.info(
              { chain, symbol: pair.symbol, liq: pair.liquidityUsd },
              'candidato aceptado para analisis',
            );
          }
        } else {
          stats.descartados++;
          if (stored.status === 'nuevo' || isNew) {
            await repo.setStatus(stored.id, 'descartado', verdict.reason ?? undefined);
          }
        }
      } catch (err) {
        stats.errores++;
        log.warn({ chain, token: pair.tokenAddress, err: String(err) }, 'error procesando candidato');
      }
    }
  }

  if (stats.nuevos > 0 || stats.aceptados > 0) {
    await logActivity(
      'info',
      'deteccion',
      `Vuelta completada: ${stats.seen} pares vistos, ${stats.nuevos} nuevos, ${stats.aceptados} aceptados, ${stats.descartados} descartados.`,
      stats,
    );
  }

  log.info(stats, 'vuelta de deteccion completada');
  return stats;
}
