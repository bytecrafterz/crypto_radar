/**
 * Filtro barato (etapa 1).
 *
 * Solo se gastan llamadas caras (RPC, holders, seguridad) en los tokens que
 * superan este filtro. Normalmente descarta entre el 90% y el 95% de lo que
 * aparece, y es lo que permite que el sistema funcione con planes gratuitos.
 */
import type { DiscoveredPair } from '../core/types.js';
import { getFilters } from '../core/config.js';
import { safeNum } from '../core/util.js';

export interface PrefilterResult {
  pass: boolean;
  reason: string | null;
}

const PASS: PrefilterResult = { pass: true, reason: null };
const fail = (reason: string): PrefilterResult => ({ pass: false, reason });

export function prefilter(pair: DiscoveredPair): PrefilterResult {
  const f = getFilters().prefilter;
  const now = Date.now();

  // --- Edad del par -------------------------------------------------------
  if (pair.pairCreatedAt) {
    const ageMinutes = (now - pair.pairCreatedAt) / 60_000;
    if (ageMinutes > f.max_pair_age_hours * 60) {
      return fail(`Demasiado antiguo (${(ageMinutes / 60).toFixed(1)} h).`);
    }
    if (ageMinutes < f.min_pair_age_minutes) {
      return fail(`Demasiado reciente (${ageMinutes.toFixed(1)} min): aun no hay datos suficientes.`);
    }
  }

  // --- Moneda del par -----------------------------------------------------
  const allowed = f.quote_whitelist?.[pair.chain];
  if (allowed && allowed.length > 0) {
    const quote = (pair.quoteSymbol ?? '').toUpperCase();
    if (quote !== '???' && !allowed.includes(quote)) {
      return fail(`Par contra ${pair.quoteSymbol}, fuera de la lista permitida.`);
    }
  }

  // --- Liquidez -----------------------------------------------------------
  const liquidity = safeNum(pair.liquidityUsd, 0);
  if (liquidity < f.min_liquidity_usd) {
    return fail(`Liquidez insuficiente (${liquidity.toFixed(0)} USD).`);
  }
  if (liquidity > f.max_liquidity_usd) {
    return fail(`Liquidez demasiado alta (${liquidity.toFixed(0)} USD): ya no es etapa temprana.`);
  }

  // --- Volumen y operaciones ---------------------------------------------
  const volume24 = safeNum(pair.volumeH24, 0);
  if (volume24 < f.min_volume_h24_usd) {
    return fail(`Volumen insuficiente en 24 h (${volume24.toFixed(0)} USD).`);
  }

  const txnsH1 = safeNum(pair.txnsH1Buys, 0) + safeNum(pair.txnsH1Sells, 0);
  if (txnsH1 < f.min_txns_h1) {
    return fail(`Muy pocas operaciones en la ultima hora (${txnsH1}).`);
  }

  const buys24 = safeNum(pair.txnsH24Buys, 0);
  if (buys24 > 0 && buys24 < f.min_buys_h24) {
    return fail(`Muy pocos compradores en 24 h (${buys24}).`);
  }

  // --- Volumen frente a liquidez -----------------------------------------
  if (liquidity > 0) {
    const ratio = volume24 / liquidity;
    if (ratio > f.max_volume_liquidity_ratio) {
      return fail(`Volumen ${ratio.toFixed(0)} veces la liquidez: casi seguro volumen inflado.`);
    }
  }

  // --- Capitalizacion -----------------------------------------------------
  const marketCap = safeNum(pair.marketCapUsd, 0);
  if (f.max_market_cap_usd > 0 && marketCap > f.max_market_cap_usd) {
    return fail(`Capitalizacion demasiado alta (${marketCap.toFixed(0)} USD).`);
  }

  return PASS;
}
