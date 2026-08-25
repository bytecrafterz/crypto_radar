/**
 * Etapa 3: seguimiento de los tokens ya analizados.
 *
 * Vuelve a medir cada token cada pocos minutos y detecta lo que cambia:
 * retiradas de liquidez, desplomes, presion vendedora y volumen artificial.
 * De aqui salen los avisos de peligro y el historico para el backtesting.
 */
import type { SecurityReport, HolderReport, DeployerReport, TokenAnalysis } from '../core/types.js';
import { child } from '../core/logger.js';
import { getFilters } from '../core/config.js';
import { logActivity } from '../core/db.js';
import * as repo from '../core/repo.js';
import type { StoredToken } from '../core/repo.js';
import { analyzeManipulation } from '../analysis/manipulation.js';
import { computeScore } from '../scoring/engine.js';
import { getMarketContext } from '../analysis/market.js';
import * as tracking from '../core/tracking.js';
import { compareSecurity, compareHolders } from '../analysis/changes.js';
import { analyzeSecurity } from '../analysis/security.js';
import { analyzeHolders } from '../analysis/holders.js';
import { estimateForConfiguredSize } from '../analysis/execution.js';
import { refreshPair } from './enrichment.js';
import { maybeAlert } from './alerts.js';

const log = child('seguimiento');

// --------------------------------------------------------------------------
//  Reconstruccion de los informes guardados
// --------------------------------------------------------------------------

function toSecurity(row: Record<string, unknown> | null, chain: string, address: string): SecurityReport | null {
  if (!row) return null;
  const b = (k: string): boolean => row[k] === true;
  const n = (k: string): number | null => (typeof row[k] === 'number' ? (row[k] as number) : null);
  const s = (k: string): string | null => (typeof row[k] === 'string' ? (row[k] as string) : null);

  return {
    chain: chain as SecurityReport['chain'],
    tokenAddress: address,
    mintAuthorityActive: b('mint_authority_active'),
    mintAuthority: s('mint_authority'),
    freezeAuthorityActive: b('freeze_authority_active'),
    freezeAuthority: s('freeze_authority'),
    isToken2022: b('is_token_2022'),
    hasToken2022Extensions: b('has_extensions'),
    ownerCanModify: b('owner_can_modify'),
    ownerAddress: s('owner_address'),
    hasBlacklist: b('has_blacklist'),
    hasMintFunction: b('has_mint_function'),
    isProxy: b('is_proxy'),
    isVerified: row.is_verified === null ? null : b('is_verified'),
    buyTaxPct: n('buy_tax_pct'),
    sellTaxPct: n('sell_tax_pct'),
    taxModifiable: b('tax_modifiable'),
    isHoneypot: row.is_honeypot === null ? null : b('is_honeypot'),
    canSell: row.can_sell === null || row.can_sell === undefined ? null : b('can_sell'),
    roundTripLossPct: n('round_trip_loss_pct'),
    lpLockedPct: n('lp_locked_pct'),
    lpBurnedPct: n('lp_burned_pct'),
    lpLockerName: s('lp_locker_name'),
    totalSupply: s('total_supply'),
    decimals: null,
    notes: Array.isArray(row.notes) ? (row.notes as string[]) : [],
    sources: Array.isArray(row.sources) ? (row.sources as string[]) : [],
    failedSources: Array.isArray(row.failed_sources) ? (row.failed_sources as string[]) : [],
  };
}

function toHolders(row: Record<string, unknown> | null, chain: string, address: string): HolderReport | null {
  if (!row) return null;
  const n = (k: string): number | null => (typeof row[k] === 'number' ? (row[k] as number) : null);
  return {
    chain: chain as HolderReport['chain'],
    tokenAddress: address,
    holdersCount: n('holders_count'),
    top10Pct: n('top10_pct'),
    top20Pct: n('top20_pct'),
    largestRealPct: n('largest_real_pct'),
    deployerPct: n('deployer_pct'),
    holders: Array.isArray(row.top_holders) ? (row.top_holders as HolderReport['holders']) : [],
    partial: row.partial === true,
    note: typeof row.note === 'string' ? row.note : null,
  };
}

function toDeployer(row: Record<string, unknown> | null, chain: string, address: string): DeployerReport | null {
  if (!row) return null;
  return {
    chain: chain as DeployerReport['chain'],
    tokenAddress: address,
    deployer: typeof row.deployer === 'string' ? row.deployer : null,
    deployTxHash: typeof row.deploy_tx === 'string' ? row.deploy_tx : null,
    deployedAt: row.deployed_at instanceof Date ? row.deployed_at.getTime() : null,
    priorTokens: Array.isArray(row.prior_tokens) ? (row.prior_tokens as DeployerReport['priorTokens']) : [],
    priorTokenCount: typeof row.prior_token_count === 'number' ? row.prior_token_count : 0,
    historyVerdict: (row.history_verdict as DeployerReport['historyVerdict']) ?? 'unknown',
    fundedBy: typeof row.funded_by === 'string' ? row.funded_by : null,
    note: typeof row.note === 'string' ? row.note : null,
  };
}

// --------------------------------------------------------------------------
//  Seguimiento
// --------------------------------------------------------------------------

/**
 * Tokens que no han devuelto datos de mercado, y desde cuando.
 *
 * No se archiva a la primera: un 429 de DexScreener dura minutos y afectaria a
 * TODOS los tokens vigilados a la vez, archivandolos permanentemente. Solo se
 * cierra un token si sigue sin dar datos despues de varios intentos separados
 * en el tiempo, que es lo que de verdad significa "el pool ya no existe".
 */
const sinDatos = new Map<number, { desde: number; intentos: number }>();
const FALLOS_PARA_ARCHIVAR = 3;
const MINUTOS_PARA_ARCHIVAR = 30;

async function monitorToken(token: StoredToken): Promise<boolean> {
  const pair = await refreshPair(token);
  if (!pair) {
    const previo = sinDatos.get(token.id) ?? { desde: Date.now(), intentos: 0 };
    previo.intentos++;
    sinDatos.set(token.id, previo);

    const minutos = (Date.now() - previo.desde) / 60_000;
    const seguro = previo.intentos >= FALLOS_PARA_ARCHIVAR && minutos >= MINUTOS_PARA_ARCHIVAR;

    if (!seguro) {
      log.warn(
        { symbol: token.symbol, intentos: previo.intentos, minutos: Math.round(minutos) },
        'sin datos de mercado; puede ser un fallo pasajero, se reintentara',
      );
      return false;
    }

    log.warn(
      { symbol: token.symbol, intentos: previo.intentos },
      'sin datos de mercado de forma sostenida: el pool ya no existe, se archiva',
    );
    sinDatos.delete(token.id);
    await repo.computeOutcome(token);
    return false;
  }

  // Volvio a responder: se olvida el historial de fallos.
  sinDatos.delete(token.id);

  await repo.upsertToken(pair);

  const history = await repo.getRecentSnapshots(token.id, 60);

  const [securityRow, holdersRow, deployerRow] = await Promise.all([
    repo.getLatestSecurity(token.id),
    repo.getLatestHolders(token.id),
    repo.getLatestDeployer(token.id),
  ]);

  let security = toSecurity(securityRow, token.chain, token.address);
  let holders = toHolders(holdersRow, token.chain, token.address);
  const deployer = toDeployer(deployerRow, token.chain, token.address);

  // --- Re-verificacion periodica de condiciones criticas ------------------
  // Un token seguro en el minuto 1 puede dejar de serlo en el minuto 10.
  const inv = getFilters().invalidation;
  const recheckMin = inv?.recheck_security_minutes ?? 30;
  const ultimaRevision = securityRow?.ts instanceof Date ? securityRow.ts.getTime() : 0;
  const tocaRevisar = Date.now() - ultimaRevision > recheckMin * 60_000;

  if (tocaRevisar) {
    const nuevaSeguridad = await analyzeSecurity(pair).catch(() => null);
    if (nuevaSeguridad) {
      const cambios = compareSecurity(security, nuevaSeguridad);
      for (const c of cambios) {
        await tracking.saveSecurityChange(token.id, c.field, c.before, c.after, c.severity, c.detail);
        log.warn({ symbol: token.symbol, campo: c.field }, 'cambio de condiciones detectado');
      }
      await repo.saveSecurity(token.id, nuevaSeguridad);
      security = nuevaSeguridad;

      // Un cambio grave invalida la oportunidad de inmediato.
      const graves = cambios.filter((c) => c.severity === 'danger');
      if (graves.length > 0) {
        await tracking.invalidate(token.id, graves[0].detail);
      }
    }

    // Holders: detecta que el creador vende o que la concentracion sube.
    const nuevosHolders = await analyzeHolders(pair, deployer?.deployer ?? null, null).catch(() => null);
    if (nuevosHolders && nuevosHolders.top10Pct !== null) {
      const eventosHolders = compareHolders(holders, nuevosHolders);
      if (eventosHolders.length > 0) await repo.saveSuspicious(token.id, eventosHolders);
      await repo.saveHolders(token.id, nuevosHolders);
      holders = nuevosHolders;
    }
  }

  // Solo senales baratas: el seguimiento se ejecuta muy a menudo.
  const suspicious = await analyzeManipulation({
    pair,
    holders,
    history,
    deployBlock: null,
    deep: false,
  });
  await repo.saveSuspicious(token.id, suspicious);

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

  // 'seguimiento' es lo que marca el reloj del planificador (ver
  // getTokensToMonitor): las mediciones de la deteccion no cuentan.
  await repo.insertSnapshot(token.id, pair, {
    holdersCount: holders?.holdersCount ?? null,
    top10Pct: holders?.top10Pct ?? null,
    source: 'seguimiento',
  });

  // Cambio de liquidez respecto al maximo historico.
  let peakLiquidity = 0;
  for (const s of history) peakLiquidity = Math.max(peakLiquidity, s.liquidity_usd ?? 0);
  const liquidityChangePct =
    peakLiquidity > 0 && pair.liquidityUsd !== null
      ? ((pair.liquidityUsd - peakLiquidity) / peakLiquidity) * 100
      : null;

  const analysis: TokenAnalysis = {
    pair,
    security,
    holders,
    deployer,
    suspicious,
    score,
    liquidityChangePct,
    holderGrowthPerHour: holderGrowth,
  };

  const dangers = suspicious.filter((s) => s.severity === 'danger');
  if (dangers.length > 0 && token.status !== 'peligro') {
    await repo.setStatus(token.id, 'peligro');
  }

  // --- Horizontes: que paso a 5 min, 15 min, 1 h, 6 h, 24 h ---------------
  const exec = estimateForConfiguredSize(pair.liquidityUsd);
  const capturados = await tracking.captureHorizons(token, {
    priceUsd: pair.priceUsd,
    liquidityUsd: pair.liquidityUsd,
    marketCapUsd: pair.marketCapUsd,
    holdersCount: holders?.holdersCount ?? null,
    roundTripPct: exec?.roundTripPct ?? null,
  });
  if (capturados.length > 0) {
    log.info({ symbol: token.symbol, horizontes: capturados }, 'mediciones de horizonte guardadas');
  }

  // --- Semaforo y validez -------------------------------------------------
  await tracking.updateLight(token.id, score.light, score.evaluable);

  const horas = (Date.now() - token.first_seen.getTime()) / 3_600_000;
  const picoLiquidez = Math.max(peakLiquidity, pair.liquidityUsd ?? 0);
  const motivoInvalidacion =
    score.criticalVetoes.length > 0
      ? score.criticalVetoes[0].text
      : inv && horas > (inv.max_hours_valid ?? 24)
        ? `Han pasado mas de ${inv.max_hours_valid} horas desde la deteccion: deja de considerarse una oportunidad reciente.`
        : inv &&
            picoLiquidez > 0 &&
            (pair.liquidityUsd ?? 0) < picoLiquidez * ((inv.min_liquidity_pct_of_peak ?? 60) / 100)
          ? 'La liquidez ha caido muy por debajo de su maximo: la oportunidad ya no es operable en las mismas condiciones.'
          : null;

  if (motivoInvalidacion) await tracking.invalidate(token.id, motivoInvalidacion);

  await maybeAlert(token.id, analysis, 'seguimiento');
  return true;
}

export async function runMonitor(): Promise<{ revisados: number; archivados: number }> {
  const filters = getFilters();
  const m = filters.monitoring;

  const tokens = await repo.getTokensToMonitor(
    m.interval_minutes,
    m.slow_interval_minutes,
    m.intensive_hours,
    Math.min(m.max_tracked_tokens, 25),
  );

  let revisados = 0;
  for (const token of tokens) {
    try {
      const ok = await monitorToken(token);
      if (ok) revisados++;
    } catch (err) {
      log.error({ token: token.address, err: String(err) }, 'fallo el seguimiento del token');
    }
  }

  // Cierre de los tokens cuyo periodo de vigilancia ha terminado.
  const toArchive = await repo.getTokensToArchive(20);
  let archivados = 0;
  for (const token of toArchive) {
    try {
      await repo.computeOutcome(token);
      archivados++;
    } catch (err) {
      log.error({ token: token.address, err: String(err) }, 'fallo el cierre del token');
    }
  }

  if (revisados > 0 || archivados > 0) {
    log.info({ revisados, archivados }, 'vuelta de seguimiento completada');
  }
  if (archivados > 0) {
    await logActivity('info', 'seguimiento', `${archivados} token(s) archivados con su resultado final calculado.`);
  }

  return { revisados, archivados };
}
