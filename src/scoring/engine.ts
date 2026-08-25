/**
 * Motor de puntuacion.
 *
 * Produce DOS notas independientes:
 *   - riesgo (0-100): cuanto peligro hay
 *   - oportunidad (0-100): cuanto interes tiene
 *
 * Nunca se mezclan en un solo numero: un token puede ser muy interesante
 * y muy peligroso a la vez, y esconder eso detras de una media seria enganoso.
 *
 * Cada punto que se suma deja escrito su motivo en espanol. Eso es lo que
 * aparece luego en la alerta de Telegram y en el panel.
 */
import type {
  DiscoveredPair,
  SecurityReport,
  HolderReport,
  DeployerReport,
  SuspiciousEvent,
  ScoreResult,
  ScoreReason,
} from '../core/types.js';
import { getScoring, getFilters, type RuleConfig } from '../core/config.js';
import { estimateForConfiguredSize } from '../analysis/execution.js';
import { clamp, ramp, safeNum } from '../core/util.js';
import type { MarketContext } from '../analysis/market.js';

export interface ScoreInput {
  pair: DiscoveredPair;
  security: SecurityReport | null;
  holders: HolderReport | null;
  deployer: DeployerReport | null;
  suspicious: SuspiciousEvent[];
  /** Holders nuevos por hora, si hay historico suficiente. */
  holderGrowthPerHour: number | null;
  /** Estado general del mercado. Si falta, se puntua sin contexto. */
  market?: MarketContext | null;
}

/** Acumulador de puntos con su explicacion. */
class Accumulator {
  readonly reasons: ScoreReason[] = [];
  private total = 0;

  add(code: string, points: number, text: string): void {
    if (points <= 0) return;
    const rounded = Math.round(points * 10) / 10;
    this.total += rounded;
    this.reasons.push({ code, points: rounded, text });
  }

  get raw(): number {
    return this.total;
  }

  get value(): number {
    return clamp(Math.round(this.total * 10) / 10, 0, 100);
  }

  /**
   * Nota sobre el maximo alcanzable, en porcentaje.
   * Se usa para la oportunidad: si se sumaran los puntos en bruto,
   * casi cualquier token decente llegaria a 100 y la nota no distinguiria
   * entre "bueno" y "excepcional".
   */
  normalized(maxPoints: number): number {
    if (maxPoints <= 0) return this.value;
    return clamp(Math.round((this.total / maxPoints) * 1000) / 10, 0, 100);
  }

  /** Motivos ordenados de mayor a menor peso. */
  sorted(): ScoreReason[] {
    return [...this.reasons].sort((a, b) => b.points - a.points);
  }
}

function rule(rules: Record<string, RuleConfig>, key: string): RuleConfig | null {
  const r = rules[key];
  if (!r || r.enabled === false) return null;
  return r;
}

const numProp = (r: RuleConfig, key: string, fallback: number): number => {
  const v = r[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
};

/** Puntos maximos que puede sumar la oportunidad con las reglas activas. */
function maxOpportunityPoints(rules: Record<string, RuleConfig>): number {
  let total = 0;
  for (const r of Object.values(rules)) {
    if (r?.enabled === false) continue;
    if (typeof r?.points === 'number') total += r.points;
  }
  return total;
}

function labelFor(value: number, labels: Array<{ max: number; label: string }>): string {
  for (const l of labels) {
    if (value <= l.max) return l.label;
  }
  return labels.length > 0 ? labels[labels.length - 1].label : 'DESCONOCIDO';
}

// --------------------------------------------------------------------------
//  RIESGO
// --------------------------------------------------------------------------

function scoreRisk(input: ScoreInput, missing: string[]): Accumulator {
  const cfg = getScoring();
  const R = cfg.risk;
  const acc = new Accumulator();
  const { pair, security, holders, deployer, suspicious } = input;

  // --- Seguridad del token ------------------------------------------------
  if (!security) {
    missing.push('analisis de seguridad');
  } else {
    let r: RuleConfig | null;

    if ((r = rule(R, 'mint_authority_active')) && security.mintAuthorityActive) {
      acc.add('mint_authority_active', r.points, r.reason);
    }
    if ((r = rule(R, 'freeze_authority_active')) && security.freezeAuthorityActive) {
      acc.add('freeze_authority_active', r.points, r.reason);
    }
    if ((r = rule(R, 'token2022_extensions')) && security.hasToken2022Extensions) {
      acc.add('token2022_extensions', r.points, r.reason);
    }
    if ((r = rule(R, 'owner_can_modify')) && security.ownerCanModify) {
      acc.add('owner_can_modify', r.points, r.reason);
    }
    if ((r = rule(R, 'blacklist_function')) && security.hasBlacklist) {
      acc.add('blacklist_function', r.points, r.reason);
    }
    if ((r = rule(R, 'honeypot')) && security.isHoneypot === true) {
      acc.add('honeypot', r.points, r.reason);
    }
    if ((r = rule(R, 'proxy_contract')) && security.isProxy) {
      acc.add('proxy_contract', r.points, r.reason);
    }
    if ((r = rule(R, 'not_verified')) && security.isVerified === false) {
      acc.add('not_verified', r.points, r.reason);
    }

    // Comisiones altas o modificables.
    if ((r = rule(R, 'high_or_mutable_tax'))) {
      const warn = numProp(r, 'tax_warn_pct', 10);
      const buy = security.buyTaxPct ?? 0;
      const sell = security.sellTaxPct ?? 0;
      const worst = Math.max(buy, sell);
      if (worst >= warn) {
        acc.add(
          'high_or_mutable_tax',
          r.points,
          `Comisiones altas: ${buy.toFixed(1)}% al comprar y ${sell.toFixed(1)}% al vender.`,
        );
      } else if (security.taxModifiable) {
        acc.add('high_or_mutable_tax', r.points * 0.6, r.reason);
      }
    }

    // Liquidez bloqueada o quemada.
    const lpSecured = (security.lpLockedPct ?? 0) + (security.lpBurnedPct ?? 0);
    const lpKnown = security.lpLockedPct !== null || security.lpBurnedPct !== null;

    if (!lpKnown) {
      missing.push('estado de la liquidez (bloqueada o quemada)');
      if ((r = rule(R, 'lp_not_locked'))) {
        // No sabemos: penalizamos a la mitad, no al maximo.
        acc.add(
          'lp_unknown',
          r.points * 0.5,
          'No se pudo confirmar si la liquidez esta bloqueada o quemada.',
        );
      }
    } else if (lpSecured < 1) {
      if ((r = rule(R, 'lp_not_locked'))) acc.add('lp_not_locked', r.points, r.reason);
    } else if ((r = rule(R, 'lp_partially_locked'))) {
      const threshold = numProp(r, 'threshold_pct', 80);
      if (lpSecured < threshold) {
        acc.add(
          'lp_partially_locked',
          r.points,
          `Solo el ${lpSecured.toFixed(1)}% de la liquidez esta bloqueada o quemada.`,
        );
      }
    }
  }

  // --- Concentracion ------------------------------------------------------
  if (!holders || holders.top10Pct === null) {
    missing.push('concentracion de holders');
  } else {
    let r: RuleConfig | null;

    if ((r = rule(R, 'top10_concentration'))) {
      const warn = numProp(r, 'warn_pct', 45);
      const max = numProp(r, 'max_pct', 80);
      const factor = ramp(holders.top10Pct, warn, max);
      if (factor > 0) {
        acc.add(
          'top10_concentration',
          r.points * factor,
          `Las 10 mayores wallets concentran el ${holders.top10Pct.toFixed(1)}% del suministro (sin contar pool ni quemado).`,
        );
      }
    }

    if ((r = rule(R, 'single_holder_dominant')) && holders.largestRealPct !== null) {
      const warn = numProp(r, 'warn_pct', 15);
      if (holders.largestRealPct >= warn) {
        const factor = ramp(holders.largestRealPct, warn, warn * 3);
        acc.add(
          'single_holder_dominant',
          r.points * Math.max(0.5, factor),
          `Una sola wallet tiene el ${holders.largestRealPct.toFixed(1)}% del suministro.`,
        );
      }
    }

    if ((r = rule(R, 'deployer_holds')) && holders.deployerPct !== null) {
      const warn = numProp(r, 'warn_pct', 5);
      if (holders.deployerPct >= warn) {
        const factor = ramp(holders.deployerPct, warn, warn * 5);
        acc.add(
          'deployer_holds',
          r.points * Math.max(0.5, factor),
          `El creador conserva el ${holders.deployerPct.toFixed(1)}% del suministro.`,
        );
      }
    }
  }

  // --- Creador ------------------------------------------------------------
  if (!deployer || !deployer.deployer) {
    missing.push('identificacion del creador');
  } else {
    let r: RuleConfig | null;

    if ((r = rule(R, 'deployer_bad_history')) && deployer.historyVerdict === 'bad') {
      const bad = deployer.priorTokens.filter((t) => t.outcome === 'rug' || t.outcome === 'fracaso');
      acc.add(
        'deployer_bad_history',
        r.points,
        `El creador ya lanzo ${bad.length || deployer.priorTokenCount} token(s) que acabaron mal.`,
      );
    }

    if ((r = rule(R, 'deployer_serial'))) {
      const min = numProp(r, 'min_tokens', 4);
      if (deployer.priorTokenCount >= min) {
        acc.add(
          'deployer_serial',
          r.points,
          `El creador ha lanzado ${deployer.priorTokenCount} tokens antes: patron de fabrica de tokens.`,
        );
      }
    }
  }

  // --- Mercado ------------------------------------------------------------
  let r: RuleConfig | null;

  if ((r = rule(R, 'low_liquidity'))) {
    const floor = numProp(r, 'floor_usd', 8000);
    const liq = safeNum(pair.liquidityUsd, 0);
    if (pair.liquidityUsd === null || liq <= 0) {
      // Sin liquidez no hay nada que comprar ni forma de salir: es el peor caso,
      // no la ausencia de un problema.
      missing.push('liquidez del pool');
      acc.add(
        'low_liquidity',
        r.points,
        'No hay liquidez medible en el pool: no se podria entrar ni salir.',
      );
    } else if (liq < floor) {
      const factor = 1 - ramp(liq, 0, floor);
      acc.add(
        'low_liquidity',
        r.points * factor,
        `Liquidez muy baja (${liq.toFixed(0)} USD): cualquier venta mueve mucho el precio.`,
      );
    }
  }

  if ((r = rule(R, 'sell_pressure_extreme'))) {
    const ratioLimit = numProp(r, 'ratio', 2);
    const buys = safeNum(pair.txnsH1Buys, 0);
    const sells = safeNum(pair.txnsH1Sells, 0);
    if (buys + sells >= 20 && sells > buys * ratioLimit) {
      acc.add(
        'sell_pressure_extreme',
        r.points,
        `Mucha mas venta que compra en la ultima hora: ${sells} ventas frente a ${buys} compras.`,
      );
    }
  }

  if ((r = rule(R, 'no_social'))) {
    if (!pair.website && !pair.twitter && !pair.telegram && !pair.discord) {
      acc.add('no_social', r.points, r.reason);
    }
  }

  // --- Senales sospechosas ------------------------------------------------
  for (const event of suspicious) {
    const key =
      event.kind === 'sniper_cluster'
        ? 'sniper_cluster'
        : event.kind === 'wash_trading' || event.kind === 'bot_pattern'
          ? 'wash_trading'
          : event.kind === 'volume_without_holders'
            ? 'volume_without_holders'
            : event.kind === 'liquidity_removed'
              ? 'liquidity_removed'
              : null;

    if (!key) continue;
    const cfgRule = rule(R, key);
    if (!cfgRule) continue;

    const weight = event.severity === 'danger' ? 1 : event.severity === 'warn' ? 0.6 : 0.3;
    acc.add(`${key}:${event.kind}`, cfgRule.points * weight, event.detail);
  }


  // --- Contexto general del mercado ---------------------------------------
  // Un token nuevo remando contra un mercado que cae tiene mas papeletas de
  // fallar, aunque el token en si este limpio.
  const mkt = input.market ?? null;
  const mcfg = cfg.market_context;
  if (mkt && !mkt.unknown && mcfg?.enabled && mkt.regime === 'debil') {
    const puntos = mcfg.riesgo_mercado_debil ?? 0;
    if (puntos > 0) acc.add('market_downtrend', puntos, mkt.note);
  }

  return acc;
}

// --------------------------------------------------------------------------
//  OPORTUNIDAD
// --------------------------------------------------------------------------

function scoreOpportunity(input: ScoreInput): Accumulator {
  const cfg = getScoring();
  const O = cfg.opportunity;
  const acc = new Accumulator();
  const { pair, security, holders, deployer, suspicious, holderGrowthPerHour } = input;

  let r: RuleConfig | null;

  if ((r = rule(O, 'base_score'))) {
    acc.add('base_score', r.points, r.reason);
  }

  // --- Seguridad limpia ---------------------------------------------------
  if (security) {
    const clean =
      !security.mintAuthorityActive &&
      !security.freezeAuthorityActive &&
      !security.hasBlacklist &&
      !security.ownerCanModify &&
      security.isHoneypot !== true;

    if ((r = rule(O, 'clean_security')) && clean) {
      acc.add('clean_security', r.points, r.reason);
    }

    const lpSecured = (security.lpLockedPct ?? 0) + (security.lpBurnedPct ?? 0);
    if ((r = rule(O, 'lp_locked_or_burned')) && lpSecured >= 80) {
      acc.add(
        'lp_locked_or_burned',
        r.points,
        `Liquidez asegurada al ${lpSecured.toFixed(0)}%${security.lpLockerName ? ` (${security.lpLockerName})` : ''}.`,
      );
    }
  }

  // --- Liquidez sana ------------------------------------------------------
  if ((r = rule(O, 'healthy_liquidity'))) {
    const min = numProp(r, 'min_usd', 15000);
    const good = numProp(r, 'good_usd', 60000);
    const liq = safeNum(pair.liquidityUsd, 0);
    const factor = ramp(liq, min, good);
    if (factor > 0) {
      acc.add('healthy_liquidity', r.points * factor, `Liquidez de ${liq.toFixed(0)} USD.`);
    }
  }

  // --- Crecimiento de holders --------------------------------------------
  if ((r = rule(O, 'holder_growth'))) {
    if (holderGrowthPerHour === null) {
      // Sin historico todavia: no penalizamos, simplemente no suma.
    } else {
      const min = numProp(r, 'min_new_per_hour', 20);
      const good = numProp(r, 'good_new_per_hour', 120);
      const factor = ramp(holderGrowthPerHour, min, good);
      if (factor > 0) {
        acc.add(
          'holder_growth',
          r.points * factor,
          `Los holders crecen a ritmo de ${holderGrowthPerHour.toFixed(0)} por hora.`,
        );
      }
    }
  }

  // --- Presion compradora -------------------------------------------------
  if ((r = rule(O, 'buy_pressure'))) {
    const buys = safeNum(pair.txnsH1Buys, 0);
    const sells = safeNum(pair.txnsH1Sells, 0);
    if (buys + sells >= 15 && sells > 0) {
      const ratio = buys / sells;
      const min = numProp(r, 'min_ratio', 1.2);
      const good = numProp(r, 'good_ratio', 2.5);
      const factor = ramp(ratio, min, good);
      if (factor > 0) {
        acc.add(
          'buy_pressure',
          r.points * factor,
          `Mas compras que ventas: ${buys} compras frente a ${sells} ventas (${ratio.toFixed(1)} a 1).`,
        );
      }
    }
  }

  // --- Volumen acelerando -------------------------------------------------
  if ((r = rule(O, 'volume_growth'))) {
    const h1 = safeNum(pair.volumeH1, 0);
    const h24 = safeNum(pair.volumeH24, 0);
    if (h24 > 0 && h1 > 0) {
      const share = h1 / h24;
      const min = numProp(r, 'min_ratio', 0.15);
      const factor = ramp(share, min, min * 3);
      if (factor > 0) {
        acc.add(
          'volume_growth',
          r.points * factor,
          `La ultima hora concentra el ${(share * 100).toFixed(0)}% del volumen de 24 h: el interes esta subiendo.`,
        );
      }
    }
  }

  // --- Reparto del suministro --------------------------------------------
  if ((r = rule(O, 'distributed_holders')) && holders?.top10Pct !== null && holders) {
    const good = numProp(r, 'good_top10_pct', 25);
    const factor = 1 - ramp(holders.top10Pct as number, good, good * 2.5);
    if (factor > 0) {
      acc.add(
        'distributed_holders',
        r.points * factor,
        `Suministro bien repartido: el top 10 real solo tiene el ${(holders.top10Pct as number).toFixed(1)}%.`,
      );
    }
  }

  // --- Creador ------------------------------------------------------------
  if (deployer?.deployer) {
    const deployerPct = holders?.deployerPct ?? null;
    if ((r = rule(O, 'deployer_clean'))) {
      if (deployer.historyVerdict !== 'bad' && (deployerPct === null || deployerPct < 3)) {
        acc.add(
          'deployer_clean',
          r.points,
          deployerPct === null
            ? 'El creador no tiene historial malo conocido.'
            : `El creador solo conserva el ${deployerPct.toFixed(1)}% del suministro y no tiene historial malo.`,
        );
      }
    }
    if ((r = rule(O, 'deployer_good_history')) && deployer.historyVerdict === 'good') {
      acc.add('deployer_good_history', r.points, r.reason);
    }
  }

  // --- Comunidad ----------------------------------------------------------
  if ((r = rule(O, 'has_socials'))) {
    const links = [pair.website, pair.twitter, pair.telegram, pair.discord].filter(Boolean).length;
    if (links >= 2) {
      acc.add('has_socials', r.points, `El proyecto publica ${links} enlaces oficiales (web y redes).`);
    } else if (links === 1) {
      acc.add('has_socials', r.points * 0.5, 'El proyecto publica un enlace oficial.');
    }
  }

  // --- Tendencia de precio ------------------------------------------------
  if ((r = rule(O, 'price_uptrend'))) {
    const min = numProp(r, 'min_pct_h1', 5);
    const h1 = pair.priceChangeH1;
    if (h1 !== null && h1 >= min) {
      const factor = ramp(h1, min, min * 8);
      acc.add('price_uptrend', r.points * Math.max(0.4, factor), `El precio sube un ${h1.toFixed(1)}% en la ultima hora.`);
    }
  }

  // --- Sin senales sospechosas -------------------------------------------
  if ((r = rule(O, 'no_suspicious_activity'))) {
    const serious = suspicious.filter((s) => s.severity !== 'info');
    if (serious.length === 0) {
      acc.add('no_suspicious_activity', r.points, r.reason);
    }
  }

  // --- Fuerza relativa frente al mercado ----------------------------------
  // Separa lo que sube por si mismo de lo que sube porque sube todo.
  const mkt = input.market ?? null;
  const mcfg = cfg.market_context;
  if (mkt && !mkt.unknown && mcfg?.enabled) {
    const bonus = mcfg.bonus_fuerza_relativa ?? 0;
    const minimo = mcfg.fuerza_relativa_min_pct ?? 10;
    const tokenH24 = pair.priceChangeH24;
    const mercadoH24 =
      mkt.solChangeH24 !== null && mkt.ethChangeH24 !== null
        ? (mkt.solChangeH24 + mkt.ethChangeH24) / 2
        : (mkt.solChangeH24 ?? mkt.ethChangeH24);

    if (bonus > 0 && tokenH24 !== null && mercadoH24 !== null) {
      const ventaja = tokenH24 - mercadoH24;
      if (ventaja >= minimo) {
        const factor = ramp(ventaja, minimo, minimo * 5);
        acc.add(
          'fuerza_relativa',
          bonus * Math.max(0.5, factor),
          `Sube un ${ventaja.toFixed(1)}% mas que el mercado general: el movimiento es suyo, no marea general.`,
        );
      }
    }
  }
  return acc;

}

// --------------------------------------------------------------------------
//  API publica
// --------------------------------------------------------------------------

export function computeScore(input: ScoreInput): ScoreResult {
  const cfg = getScoring();
  const missing: string[] = [];

  const risk = scoreRisk(input, missing);
  const opportunity = scoreOpportunity(input);

  const riskValue = risk.value;

  // El riesgo es absoluto: un honeypot por si solo ya debe ser critico.
  // La oportunidad se mide contra el maximo alcanzable, para que la nota
  // distinga de verdad entre un token correcto y uno excepcional.
  const bonusFuerza = cfg.market_context?.enabled ? (cfg.market_context.bonus_fuerza_relativa ?? 0) : 0;
  let opportunityValue = opportunity.normalized(maxOpportunityPoints(cfg.opportunity) + bonusFuerza);

  // Un riesgo muy alto rebaja la oportunidad: no tiene sentido presentar
  // como buena ocasion algo que probablemente sea una trampa.
  if (riskValue >= 50) {
    const penalty = ramp(riskValue, 50, 100);
    opportunityValue = clamp(Math.round(opportunityValue * (1 - penalty * 0.6) * 10) / 10, 0, 100);
  }

  // El contexto de mercado ajusta la exigencia final: con el mercado en alza
  // parte del movimiento del token es marea general y merece menos credito.
  const mcfg = cfg.market_context;
  const mkt = input.market ?? null;
  if (mkt && !mkt.unknown && mcfg?.enabled) {
    const factor =
      mkt.regime === 'fuerte'
        ? (mcfg.factor_mercado_fuerte ?? 1)
        : mkt.regime === 'debil'
          ? (mcfg.factor_mercado_debil ?? 1)
          : (mcfg.factor_mercado_neutral ?? 1);
    opportunityValue = clamp(Math.round(opportunityValue * factor * 10) / 10, 0, 100);
  }

  // --- Ejecucion realista -------------------------------------------------
  // El precio que se ve no es el precio al que se puede operar.
  //
  // En Solana se prefiere SIEMPRE la medicion real de Jupiter sobre la formula
  // teorica: comprobado contra tokens reales, la formula de producto constante
  // se equivoca entre 3 y 21 puntos en los pools de curva (Pump.fun y
  // similares), que son la mayoria de los tokens nuevos de Solana.
  const estimado = estimateForConfiguredSize(input.pair.liquidityUsd);
  const medido = input.security?.roundTripLossPct ?? null;
  const topeVeto = getFilters().execution?.veto_round_trip_pct ?? 10;
  const tamano = getFilters().execution?.position_size_usd ?? 200;

  // La medicion real MANDA sobre la formula, y vale incluso cuando no hay
  // estimacion teorica: si el agregador ha cotizado la operacion de verdad,
  // el token se puede operar aunque la liquidez publicada sea cero o falte.
  let exec = estimado;
  if (medido !== null) {
    const real = Math.max(0, medido);
    exec = {
      tradeUsd: estimado?.tradeUsd ?? tamano,
      liquidityUsd: estimado?.liquidityUsd ?? 0,
      buyImpactPct: estimado?.buyImpactPct ?? real / 2,
      sellImpactPct: estimado?.sellImpactPct ?? real / 2,
      roundTripPct: real,
      // Cuanto se podria mover manteniendo el coste dentro del limite.
      maxTradeUsd:
        real > 0
          ? Math.max(1, Math.round(((estimado?.tradeUsd ?? tamano) * topeVeto) / real))
          : (estimado?.maxTradeUsd ?? tamano),
      tooIlliquid: real > topeVeto,
      note:
        `Coste real medido con una cotizacion de Jupiter: entrar y salir con ` +
        `${estimado?.tradeUsd ?? tamano} USD costaria un ${real.toFixed(2)}%.`,
    };
  }

  // --- Vetos criticos -----------------------------------------------------
  // No suman riesgo: bloquean. Un contrato del que no se puede salir no es
  // "menos buena oportunidad", es directamente no una oportunidad.
  const vetoCfg = cfg.critical_vetoes;
  const criticalVetoes: Array<{ code: string; text: string }> = [];

  if (vetoCfg?.enabled) {
    const codigos = new Set(vetoCfg.codes ?? []);
    for (const r of risk.reasons) {
      // Los codigos compuestos ("wash_trading:bot_pattern") cuentan por su raiz.
      const raiz = r.code.split(':')[0];
      if (codigos.has(raiz) || codigos.has(r.code)) {
        criticalVetoes.push({ code: raiz, text: r.text });
      }
    }
    if (codigos.has('no_operable') && exec && exec.roundTripPct > (getFilters().execution?.veto_round_trip_pct ?? 10)) {
      criticalVetoes.push({ code: 'no_operable', text: exec.note });
    }

    // Comprobado con una cotizacion real: si no hay forma de vender, no hay
    // oportunidad posible por muy bien que puntue todo lo demas.
    if (codigos.has('sin_ruta_de_venta') && input.security?.canSell === false) {
      criticalVetoes.push({
        code: 'sin_ruta_de_venta',
        text: 'No existe ninguna ruta para VENDER este token. Se puede comprar pero no salir.',
      });
    }
  }

  // --- Evaluabilidad: "no lo se" es una respuesta valida -------------------
  const evalCfg = cfg.evaluability;
  let evaluable = true;
  if (evalCfg?.enabled) {
    const faltanCriticas = (evalCfg.required ?? []).some((req) => missing.includes(req));
    const demasiadas = missing.length > (evalCfg.max_missing ?? 3);
    // Sin estimacion de ejecucion no se puede afirmar que la posicion sea viable.
    const sinEjecucion = exec === null;
    if (sinEjecucion && !missing.includes('viabilidad de la operacion')) {
      missing.push('viabilidad de la operacion');
    }
    evaluable = !faltanCriticas && !demasiadas && !sinEjecucion;
  }

  // --- Semaforo -----------------------------------------------------------
  const tl = cfg.traffic_light;
  const light: 'verde' | 'amarillo' | 'rojo' =
    criticalVetoes.length > 0 || riskValue >= (tl?.rojo_desde_riesgo ?? 70)
      ? 'rojo'
      : !evaluable || riskValue >= (tl?.amarillo_desde_riesgo ?? 45)
        ? 'amarillo'
        : 'verde';

  // Se veta por riesgo agregado, por veto critico o por no ser evaluable.
  const vetoed =
    riskValue >= cfg.risk_veto_threshold || criticalVetoes.length > 0 || !evaluable;

  return {
    opportunity: opportunityValue,
    risk: riskValue,
    criticalVetoes,
    evaluable,
    light,
    execution: exec
      ? { tradeUsd: exec.tradeUsd, roundTripPct: exec.roundTripPct, maxTradeUsd: exec.maxTradeUsd, note: exec.note }
      : null,
    opportunityLabel: labelFor(opportunityValue, cfg.opportunity_labels ?? []),
    riskLabel: labelFor(riskValue, cfg.risk_labels ?? []),
    vetoed,
    opportunityReasons: opportunity.sorted(),
    riskReasons: risk.sorted(),
    missingData: [...new Set(missing)],
  };
}

/** Resumen corto: los N motivos con mas peso, para la alerta. */
export function topReasons(reasons: ScoreReason[], n = 4): string[] {
  return reasons.slice(0, n).map((r) => r.text);
}
