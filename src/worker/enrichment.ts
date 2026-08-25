/**
 * Etapa 2: analisis profundo de los tokens que superaron el filtro.
 *
 * Aqui es donde se gastan las llamadas caras, por eso esta limitado por hora
 * y por dia en filters.yaml. El orden importa: primero el creador (barato y
 * necesario para etiquetar holders), luego seguridad y holders, y por ultimo
 * las senales de manipulacion.
 */
import type { DiscoveredPair, TokenAnalysis } from '../core/types.js';
import { child } from '../core/logger.js';
import { getFilters } from '../core/config.js';
import { logActivity } from '../core/db.js';
import * as repo from '../core/repo.js';
import type { StoredToken } from '../core/repo.js';
import * as dexscreener from '../sources/dexscreener.js';
import * as geckoterminal from '../sources/geckoterminal.js';
import * as base from '../sources/baseRpc.js';
import { analyzeSecurity } from '../analysis/security.js';
import { analyzeHolders } from '../analysis/holders.js';
import { analyzeDeployer } from '../analysis/deployer.js';
import { analyzeManipulation } from '../analysis/manipulation.js';
import { computeScore } from '../scoring/engine.js';
import { getMarketContext } from '../analysis/market.js';
import * as tracking from '../core/tracking.js';
import { maybeAlert } from './alerts.js';

const log = child('analisis');

/** Vuelve a pedir los datos de mercado para trabajar con cifras frescas. */
export async function refreshPair(token: StoredToken): Promise<DiscoveredPair | null> {
  const fromDex = await dexscreener
    .getToken(token.chain, token.address)
    .catch(() => null);
  if (fromDex) return fromDex;

  if (token.pair_address) {
    const fromGecko = await geckoterminal
      .getPool(token.chain, token.pair_address)
      .catch(() => null);
    if (fromGecko) return fromGecko;
  }
  return null;
}

/** Analisis completo de un token. */
export async function enrichToken(token: StoredToken): Promise<TokenAnalysis | null> {
  const pair = await refreshPair(token);
  if (!pair) {
    log.warn({ token: token.address }, 'no se pudieron refrescar los datos de mercado');
    await repo.setStatus(token.id, 'descartado', 'No hay datos de mercado disponibles.');
    return null;
  }

  log.info({ chain: pair.chain, symbol: pair.symbol }, 'analizando a fondo');
  await tracking.markAnalysisStart(token.id);

  // 1. Creador. Se hace primero porque hace falta para etiquetar holders.
  const deployer = await analyzeDeployer(pair);
  await repo.saveDeployer(token.id, deployer);

  // En Base necesitamos el bloque de creacion para reconstruir los holders
  // desde el principio. Si no, la lista sale aproximada.
  let deployBlock: number | null = null;
  if (pair.chain === 'base') {
    if (deployer.deployTxHash) {
      deployBlock = await base.getTransactionBlock(deployer.deployTxHash).catch(() => null);
    }
    // Sin Basescan no hay hash de creacion, asi que se busca en la cadena.
    if (deployBlock === null) {
      deployBlock = await base.findDeploymentBlock(pair.tokenAddress).catch(() => null);
    }
  }

  // 2. Seguridad y holders en paralelo: usan proveedores distintos.
  const [security, holders] = await Promise.all([
    analyzeSecurity(pair).catch((err) => {
      log.error({ token: pair.tokenAddress, err: String(err) }, 'fallo el analisis de seguridad');
      return null;
    }),
    analyzeHolders(pair, deployer.deployer, deployBlock),
  ]);

  if (security) await repo.saveSecurity(token.id, security);
  await repo.saveHolders(token.id, holders);

  // 3. Senales de manipulacion (incluye lectura de cadena).
  const history = await repo.getRecentSnapshots(token.id, 50);
  const suspicious = await analyzeManipulation({
    pair,
    holders,
    history,
    deployBlock,
    deep: true,
  });
  await repo.saveSuspicious(token.id, suspicious);

  // 4. Puntuacion.
  const holderGrowth = await repo.getHolderGrowthPerHour(token.id);
  const market = await getMarketContext();
  const score = computeScore({
    pair,
    security,
    holders,
    deployer,
    suspicious,
    holderGrowthPerHour: holderGrowth,
    market,
  });
  await repo.saveScore(token.id, score);
  await tracking.markAnalysisFinish(token.id);
  await tracking.updateLight(token.id, score.light, score.evaluable);

  // 5. Guardamos la medicion con los datos de holders ya calculados.
  await repo.insertSnapshot(token.id, pair, {
    holdersCount: holders.holdersCount,
    top10Pct: holders.top10Pct,
  });

  // 6. Registramos las wallets vistas: base de la reputacion futura.
  const launchMs = pair.pairCreatedAt ?? token.pair_created_at?.getTime() ?? null;
  const minutesAfter = launchMs ? (Date.now() - launchMs) / 60_000 : null;
  for (const h of holders.holders) {
    if (h.tag !== 'wallet' && h.tag !== 'creador') continue;
    await repo
      .recordWalletActivity(
        pair.chain,
        h.address,
        token.id,
        h.tag === 'creador' ? 'creador' : 'top_holder',
        h.pct,
        minutesAfter,
      )
      .catch(() => {});
  }

  // 7. Estado y seguimiento.
  const filters = getFilters();
  const trackUntil = new Date(Date.now() + filters.monitoring.total_days * 86_400_000);
  await repo.markEnriched(token.id, trackUntil);

  const status = score.vetoed ? 'peligro' : score.opportunity >= filters.alerts.min_opportunity_score ? 'vigilado' : 'vigilado';
  await repo.setStatus(token.id, status);

  const analysis: TokenAnalysis = {
    pair,
    security,
    holders,
    deployer,
    suspicious,
    score,
    liquidityChangePct: null,
    holderGrowthPerHour: holderGrowth,
  };

  log.info(
    {
      symbol: pair.symbol,
      oportunidad: score.opportunity,
      riesgo: score.risk,
      etiqueta: score.opportunityLabel,
    },
    'analisis terminado',
  );

  // 8. Alerta si procede.
  await maybeAlert(token.id, analysis, 'nuevo');

  return analysis;
}

/** Procesa la cola de tokens pendientes respetando los limites configurados. */
export async function runEnrichment(): Promise<{ procesados: number; saltados: number }> {
  const filters = getFilters();

  const [lastHour, lastDay] = await Promise.all([
    repo.countEnrichedSince('1 hour'),
    repo.countEnrichedSince('1 day'),
  ]);

  const hourRoom = Math.max(0, filters.enrichment.max_per_hour - lastHour);
  const dayRoom = Math.max(0, filters.enrichment.max_per_day - lastDay);
  const room = Math.min(hourRoom, dayRoom);

  if (room === 0) {
    log.info({ lastHour, lastDay }, 'limite de analisis alcanzado, se espera a la siguiente ventana');
    await logActivity(
      'warn',
      'analisis',
      `Limite de analisis alcanzado (${lastHour} en la ultima hora, ${lastDay} hoy). Se reanudara solo.`,
    );
    return { procesados: 0, saltados: 0 };
  }

  // Como maximo 5 por vuelta, para no bloquear el resto del sistema.
  const pending = await repo.getPendingEnrichment(Math.min(room, 5));
  let procesados = 0;
  let saltados = 0;

  for (const token of pending) {
    try {
      const result = await enrichToken(token);
      if (result) procesados++;
      else saltados++;
    } catch (err) {
      saltados++;
      log.error({ token: token.address, err: String(err) }, 'fallo el analisis del token');
      await repo.setStatus(token.id, 'descartado', `Error en el analisis: ${String(err)}`);
    }
  }

  return { procesados, saltados };
}
