/**
 * Alertas: decidir si avisar y como redactar el aviso.
 *
 * El mensaje siempre explica POR QUE se envia. Un aviso sin motivos
 * no sirve para tomar una decision.
 */
import type { TokenAnalysis, SuspiciousEvent } from '../core/types.js';
import { child } from '../core/logger.js';
import { getFilters } from '../core/config.js';
import { logActivity, queryOne } from '../core/db.js';
import * as repo from '../core/repo.js';
import { isPaused } from './telegram.js';
import { notify } from './notify.js';
import * as tracking from '../core/tracking.js';
import { fmtUsd, fmtPct, fmtNum, escapeHtml, fmtAge, safeUrl } from '../core/util.js';

const log = child('alertas');

const CHAIN_NAME: Record<string, string> = { solana: 'Solana', base: 'Base' };

function explorerLink(chain: string, address: string): string {
  return chain === 'solana'
    ? `https://solscan.io/token/${address}`
    : `https://basescan.org/token/${address}`;
}

function dexLink(chain: string, pairAddress: string): string {
  return `https://dexscreener.com/${chain}/${pairAddress}`;
}

/**
 * Enlace de compra que lleva ya puesta la direccion exacta del contrato.
 *
 * POR QUE ESTO IMPORTA TANTO
 * Cuando un token empieza a funcionar, aparecen copias con el mismo nombre y
 * el mismo icono creadas para engañar. Es gratis hacerlo y se tarda un
 * minuto. Si el usuario busca el token por su NOMBRE en el buscador de su
 * cartera, es facilisimo que acabe comprando una falsificacion.
 *
 * La direccion del contrato es unica y no se puede falsificar. Metiendola en
 * la URL, el enlace abre el token correcto y solo ese: no hay nada que
 * buscar y por tanto nada que confundir.
 */
export function swapLink(
  chain: string,
  tokenAddress: string,
  dex: string | null,
  pairAddress: string | null,
): string {
  // Solana: Jupiter es un agregador, no un mercado. Busca por su cuenta en
  // TODOS los mercados de Solana (PumpSwap, Meteora, Raydium, Orca...) y usa
  // el que corresponda. Ademas antes de avisar ya hemos comprobado con el
  // propio Jupiter que existe ruta, asi que si la alerta salio, se puede
  // operar.
  if (chain === 'solana') return `https://jup.ag/swap/SOL-${tokenAddress}`;

  // Base no funciona igual: Uniswap solo opera SUS pools. Un token que este
  // en Aerodrome o en Bankr no aparece alli, y mandarla a Uniswap seria
  // mandarla a un sitio donde ese token no se vende.
  const d = (dex ?? '').toLowerCase();
  if (d.includes('uniswap')) {
    return `https://app.uniswap.org/swap?chain=base&outputCurrency=${tokenAddress}`;
  }

  // Para el resto, DexScreener sobre la pool exacta: siempre apunta al
  // mercado real donde ese token se esta operando de verdad.
  return pairAddress
    ? `https://dexscreener.com/base/${pairAddress}`
    : `https://dexscreener.com/base/${tokenAddress}`;
}

/** Donde le abre el enlace, para que sepa que esperar antes de pulsar. */
function swapName(chain: string, dex: string | null): string {
  if (chain === 'solana') return 'Jupiter';
  return (dex ?? '').toLowerCase().includes('uniswap') ? 'Uniswap' : 'su mercado';
}

function riskEmoji(risk: number): string {
  if (risk < 20) return '🟢';
  if (risk < 45) return '🟡';
  if (risk < 70) return '🟠';
  return '🔴';
}

function opportunityEmoji(op: number): string {
  if (op >= 85) return '🚀';
  if (op >= 70) return '⭐';
  if (op >= 55) return '👀';
  return '·';
}

// --------------------------------------------------------------------------
//  Redaccion del mensaje
// --------------------------------------------------------------------------

/**
 * Lo que el Robot 2 sabe de un token, para el aviso del Robot 1.
 *
 * Los tres robots tienen que funcionar como un solo sistema. Si de un token
 * que avisa el Robot 1 ya se esta hablando en Telegram, es informacion que
 * el cliente quiere tener delante, resumida en espanol, sin tener que ir a
 * buscarla al panel.
 */
export async function lineasTelegram(chain: string, address: string): Promise<string[]> {
  const f = await queryOne<{ menciones: number; canales: number; resumen: string | null }>(
    `SELECT COUNT(*)::int AS menciones, COUNT(DISTINCT me.channel_id)::int AS canales,
            (SELECT m.resumen_es FROM tg_mentions x JOIN tg_messages m ON m.id = x.message_id
              WHERE x.chain = $1 AND x.address = $2 AND m.resumen_es IS NOT NULL
              ORDER BY (m.clasificacion = 'informacion') DESC, x.posted_at DESC LIMIT 1) AS resumen
       FROM tg_mentions me WHERE me.chain = $1 AND me.address = $2`,
    [chain, address],
  ).catch(() => null);
  if (!f || f.menciones === 0) return [];
  const lineas = [`📣 <b>En Telegram</b>: ${f.menciones} mencion(es) en ${f.canales} canal(es).`];
  if (f.resumen) lineas.push(`<i>${escapeHtml(f.resumen)}</i>`);
  return lineas;
}

export function buildOpportunityMessage(a: TokenAnalysis, telegram: string[] = []): string {
  const { pair, security, holders, deployer, score, suspicious } = a;
  if (!score) return '';

  const lines: string[] = [];
  const age = pair.pairCreatedAt ? fmtAge(Date.now() - pair.pairCreatedAt) : 'desconocida';

  lines.push(
    `${opportunityEmoji(score.opportunity)} <b>${escapeHtml(pair.symbol)}</b> · ${CHAIN_NAME[pair.chain] ?? pair.chain} · ${escapeHtml(pair.dex)}`,
  );
  lines.push(`<i>${escapeHtml(pair.name)}</i>`);
  lines.push('');

  // --- Puntuaciones -------------------------------------------------------
  const semaforo = score.light === 'verde' ? '🟢 VERDE' : score.light === 'amarillo' ? '🟡 AMARILLO' : '🔴 ROJO';
  lines.push(
    `<b>Oportunidad ${score.opportunity}/100</b> (${score.opportunityLabel})   ${riskEmoji(score.risk)} <b>Riesgo ${score.risk}/100</b> (${score.riskLabel})`,
  );
  lines.push(`Estado: <b>${semaforo}</b>`);
  lines.push('');

  // Vetos criticos: si hay alguno, es lo primero que hay que ver.
  if (score.criticalVetoes.length > 0) {
    lines.push('<b>🚫 VETOS CRITICOS</b>');
    for (const v of score.criticalVetoes) lines.push(`🚫 ${escapeHtml(v.text)}`);
    lines.push('');
  }
  if (!score.evaluable) {
    lines.push('<b>⚠️ NO EVALUABLE</b>: faltan comprobaciones criticas, no se puede afirmar que sea seguro.');
    lines.push('');
  }

  // --- Mercado ------------------------------------------------------------
  lines.push('<b>Mercado</b>');
  lines.push(`Precio: ${pair.priceUsd !== null ? `$${pair.priceUsd.toPrecision(4)}` : 'n/d'}   Cap: ${fmtUsd(pair.marketCapUsd)}`);
  lines.push(`Liquidez: ${fmtUsd(pair.liquidityUsd)}   Volumen 24 h: ${fmtUsd(pair.volumeH24)}`);
  lines.push(
    `Compras/ventas 1 h: ${fmtNum(pair.txnsH1Buys)} / ${fmtNum(pair.txnsH1Sells)}   Precio 1 h: ${fmtPct(pair.priceChangeH1)}`,
  );
  lines.push(`Edad del par: ${age}`);
  if (score.execution) {
    lines.push(
      `Coste de entrar y salir: <b>${score.execution.roundTripPct.toFixed(2)}%</b> con ${score.execution.tradeUsd} USD (maximo razonable ${score.execution.maxTradeUsd} USD)`,
    );
  }
  lines.push('');

  // --- Seguridad ----------------------------------------------------------
  if (security) {
    lines.push('<b>Seguridad</b>');
    if (pair.chain === 'solana') {
      lines.push(`Mint authority: ${security.mintAuthorityActive ? '⚠️ ACTIVA' : '✅ revocada'}`);
      lines.push(`Freeze authority: ${security.freezeAuthorityActive ? '⚠️ ACTIVA' : '✅ revocada'}`);
    } else {
      lines.push(`Owner del contrato: ${security.ownerCanModify ? '⚠️ conserva permisos' : '✅ sin permisos peligrosos'}`);
      lines.push(`Contrato verificado: ${security.isVerified === null ? 'n/d' : security.isVerified ? '✅ si' : '⚠️ no'}`);
      if (security.isHoneypot !== null) {
        lines.push(`Honeypot: ${security.isHoneypot ? '🔴 SI, no se puede vender' : '✅ la venta funciona'}`);
      }
      if (security.buyTaxPct !== null || security.sellTaxPct !== null) {
        lines.push(
          `Comisiones: ${(security.buyTaxPct ?? 0).toFixed(1)}% compra / ${(security.sellTaxPct ?? 0).toFixed(1)}% venta`,
        );
      }
    }

    const lpSecured = (security.lpLockedPct ?? 0) + (security.lpBurnedPct ?? 0);
    const lpKnown = security.lpLockedPct !== null || security.lpBurnedPct !== null;
    lines.push(
      `Liquidez: ${!lpKnown ? '❔ no confirmado' : lpSecured >= 90 ? `✅ asegurada al ${lpSecured.toFixed(0)}%` : `⚠️ solo ${lpSecured.toFixed(0)}% bloqueada`}`,
    );
    lines.push('');
  }

  // --- Holders ------------------------------------------------------------
  if (holders) {
    lines.push('<b>Holders</b>');
    if (holders.holdersCount !== null) lines.push(`Total: ${fmtNum(holders.holdersCount)}`);
    if (holders.top10Pct !== null) {
      lines.push(`Top 10 real: ${holders.top10Pct.toFixed(1)}% (sin pool ni quemado)`);
    }
    if (holders.deployerPct !== null) {
      lines.push(`El creador conserva: ${holders.deployerPct.toFixed(1)}%`);
    }
    if (a.holderGrowthPerHour !== null) {
      lines.push(`Crecimiento: ${a.holderGrowthPerHour.toFixed(0)} holders/hora`);
    }
    lines.push('');
  }

  // --- Motivos ------------------------------------------------------------
  const topOps = score.opportunityReasons.slice(0, 4);
  if (topOps.length > 0) {
    lines.push('<b>Por que es interesante</b>');
    for (const r of topOps) lines.push(`✅ ${escapeHtml(r.text)}`);
    lines.push('');
  }

  const topRisks = score.riskReasons.slice(0, 4);
  if (topRisks.length > 0) {
    lines.push('<b>Riesgos detectados</b>');
    for (const r of topRisks) lines.push(`⚠️ ${escapeHtml(r.text)}`);
    lines.push('');
  }

  const dangers = suspicious.filter((s) => s.severity === 'danger');
  if (dangers.length > 0) {
    lines.push('<b>Senales sospechosas</b>');
    for (const d of dangers) lines.push(`🔴 ${escapeHtml(d.detail)}`);
    lines.push('');
  }

  if (score.missingData.length > 0) {
    lines.push(`<i>No se pudo comprobar: ${escapeHtml(score.missingData.join(', '))}.</i>`);
    lines.push('');
  }

  // --- Enlaces ------------------------------------------------------------
  // El de comprar va el primero y separado: es el que evita que acabe
  // comprando una copia falsa por buscar el token por su nombre.
  lines.push(
    `👉 <b><a href="${swapLink(pair.chain, pair.tokenAddress, pair.dex, pair.pairAddress)}">COMPRAR ESTE TOKEN en ${swapName(pair.chain, pair.dex)}</a></b>`,
  );
  lines.push(
    '<i>Este enlace ya lleva la direccion correcta. No busques el token por su nombre: hay copias falsas.</i>',
  );
  lines.push('');
  lines.push(`<code>${escapeHtml(pair.tokenAddress)}</code>`);
  const links = [
    `<a href="${dexLink(pair.chain, pair.pairAddress)}">DexScreener</a>`,
    `<a href="${explorerLink(pair.chain, pair.tokenAddress)}">Explorador</a>`,
  ];
  const tw = safeUrl(pair.twitter);
  const tg = safeUrl(pair.telegram);
  const web = safeUrl(pair.website);
  if (tw) links.push(`<a href="${escapeHtml(tw)}">X</a>`);
  if (tg) links.push(`<a href="${escapeHtml(tg)}">Telegram</a>`);
  if (web) links.push(`<a href="${escapeHtml(web)}">Web</a>`);
  lines.push(links.join(' · '));

  if (deployer?.deployer) {
    lines.push('');
    lines.push(`<i>Creador: ${escapeHtml(deployer.deployer)}</i>`);
  }

  // Lo que sabe el Robot 2 de este token, si sabe algo.
  if (telegram.length > 0) {
    lines.push('');
    lines.push(...telegram);
  }

  lines.push('');
  lines.push('<i>Esto es informacion, no una recomendacion de compra.</i>');

  return lines.join('\n');
}

export function buildDangerMessage(a: TokenAnalysis, events: SuspiciousEvent[]): string {
  const { pair, score } = a;
  const lines: string[] = [];

  lines.push(`🔴 <b>AVISO · ${escapeHtml(pair.symbol)}</b> · ${CHAIN_NAME[pair.chain] ?? pair.chain}`);
  lines.push('');
  for (const e of events) lines.push(`• ${escapeHtml(e.detail)}`);
  lines.push('');
  lines.push(`Liquidez actual: ${fmtUsd(pair.liquidityUsd)}   Precio 1 h: ${fmtPct(pair.priceChangeH1)}`);
  if (score) lines.push(`Riesgo: ${score.risk}/100 (${score.riskLabel})`);
  lines.push('');
  lines.push(`<code>${escapeHtml(pair.tokenAddress)}</code>`);
  // En un aviso de peligro lo que puede necesitar es SALIR, no entrar.
  lines.push(
    `<a href="${swapLink(pair.chain, pair.tokenAddress, pair.dex, pair.pairAddress)}">Abrir en ${swapName(pair.chain, pair.dex)}</a> · ` +
      `<a href="${dexLink(pair.chain, pair.pairAddress)}">Ver en DexScreener</a>`,
  );

  return lines.join('\n');
}

// --------------------------------------------------------------------------
//  Decision de envio
// --------------------------------------------------------------------------

export type AlertKind = 'nuevo' | 'seguimiento';

/** Decide si toca avisar de una oportunidad y, en su caso, lo envia. */
export async function maybeAlert(
  tokenId: number,
  analysis: TokenAnalysis,
  kind: AlertKind,
): Promise<boolean> {
  const filters = getFilters();
  const score = analysis.score;
  if (!score) return false;

  // 1. Avisos de peligro: van aunque el token no fuese una oportunidad.
  const dangers = analysis.suspicious.filter((s) => s.severity === 'danger');
  if (filters.alerts.send_danger_alerts && dangers.length > 0 && kind === 'seguimiento') {
    const last = await repo.lastAlertFor(tokenId, 'peligro');
    const cooled = !last || Date.now() - last.getTime() > filters.alerts.cooldown_minutes * 60_000;

    // Avisar de que se hunde un token del que nunca le hablamos no le sirve
    // de nada: no lo tiene. El aviso util es el del token que si le enviamos.
    const relevante =
      !filters.alerts.danger_only_for_alerted ||
      (await repo.wasAlertedAsOpportunity(tokenId));

    // Estos avisos no tenian ningun tope: bastaban unos cuantos tokens
    // cayendo a la vez para llenarle el movil.
    const peligrosHora = await repo.dangerAlertsInLastHour();
    const peligrosDia = await repo.alertsToday('peligro');
    // Misma idea que en las oportunidades: la cuota se reparte por horas
    // para que no se agote de madrugada y quede margen el resto del dia.
    const cuotaPeligro = Math.ceil(
      (filters.alerts.max_danger_alerts_per_day * (new Date().getHours() + 1)) / 24,
    );
    const hayHueco =
      peligrosHora < filters.alerts.max_danger_alerts_per_hour &&
      peligrosDia < filters.alerts.max_danger_alerts_per_day &&
      peligrosDia < cuotaPeligro;

    if (!relevante && cooled) {
      log.debug({ symbol: analysis.pair.symbol }, 'peligro omitido: nunca se envio como oportunidad');
    }
    if (relevante && cooled && !hayHueco) {
      log.info({ peligrosHora, peligrosDia }, 'limite de avisos de peligro alcanzado');
    }

    if (cooled && relevante && hayHueco) {
      const message = buildDangerMessage(analysis, dangers);
      const paused = await isPaused();
      const result = paused
        ? { ok: false, error: 'Alertas pausadas', results: [] }
        : await notify(message, { subject: `Crypto Radar · AVISO ${analysis.pair.symbol}` });
      await repo.saveAlert(
        tokenId,
        'peligro',
        score.opportunity,
        score.risk,
        message,
        result.ok,
        result.error,
        result.results,
      );
      if (result.ok) {
        log.warn({ symbol: analysis.pair.symbol }, 'aviso de peligro enviado');
        await logActivity('warn', 'alertas', `Aviso de peligro enviado para ${analysis.pair.symbol}.`);
      }
      return result.ok;
    }
  }

  // 2. Oportunidades.
  if (score.vetoed) return false;
  if (score.opportunity < filters.alerts.min_opportunity_score) return false;
  if (score.risk > filters.alerts.max_risk_score) return false;

  const last = await repo.lastAlertFor(tokenId, 'oportunidad');
  if (last && Date.now() - last.getTime() < filters.alerts.cooldown_minutes * 60_000) return false;

  const sentThisHour = await repo.alertsInLastHour();
  if (sentThisHour >= filters.alerts.max_alerts_per_hour) {
    log.info({ sentThisHour }, 'limite de alertas por hora alcanzado');
    return false;
  }

  // Tope diario, REPARTIDO A LO LARGO DEL DIA.
  //
  // POR QUE NO BASTA UN TOPE PLANO
  // Con un tope plano de 10 al dia, el sistema gastaba la cuota entera de
  // madrugada con los primeros tokens que pasaban el corte, y luego se
  // quedaba mudo 22 horas. Un dia real: los 10 avisos salieron entre las
  // 00:00 y las 02:00, y por la tarde se descartaron en silencio un token
  // de oportunidad 82 con riesgo 12, otro de 77, y dos mas por encima de
  // 73. Es decir, se enviaba lo mediocre y se tiraba lo bueno, solo por
  // llegar antes.
  //
  // La cuota crece con las horas: a mediodia se ha liberado algo mas de la
  // mitad, y siempre queda margen para lo que aparezca por la tarde.
  const sentToday = await repo.alertsToday('oportunidad');
  const horaDelDia = new Date().getHours();
  const cuotaHastaAhora = Math.ceil(
    (filters.alerts.max_alerts_per_day * (horaDelDia + 1)) / 24,
  );

  if (sentToday >= filters.alerts.max_alerts_per_day) {
    log.info({ sentToday }, 'limite de alertas por dia alcanzado');
    return false;
  }
  if (sentToday >= cuotaHastaAhora) {
    log.info(
      { sentToday, cuotaHastaAhora, horaDelDia },
      'cuota de esta franja horaria agotada; se guarda margen para el resto del dia',
    );
    return false;
  }

  const paused = await isPaused();
  const message = buildOpportunityMessage(analysis, await lineasTelegram(analysis.pair.chain, analysis.pair.tokenAddress));
  const result = paused
    ? { ok: false, error: 'Alertas pausadas por el usuario', results: [] }
    : await notify(message, {
        subject: `Crypto Radar · ${analysis.pair.symbol} (oportunidad ${score.opportunity})`,
      });

  await repo.saveAlert(
    tokenId,
    'oportunidad',
    score.opportunity,
    score.risk,
    message,
    result.ok,
    result.error,
    result.results,
  );

  if (result.ok) {
    await repo.markAlerted(tokenId);
    const lat = await tracking.markFirstAlertAndLatency(tokenId);
    if (lat?.total_ms) {
      log.info({ segundos: Math.round(lat.total_ms / 1000) }, 'latencia total de la senal');
    }
    log.info(
      { symbol: analysis.pair.symbol, oportunidad: score.opportunity, riesgo: score.risk },
      'alerta de oportunidad enviada',
    );
    await logActivity(
      'info',
      'alertas',
      `Alerta enviada: ${analysis.pair.symbol} (oportunidad ${score.opportunity}, riesgo ${score.risk}).`,
    );
  }

  return result.ok;
}
