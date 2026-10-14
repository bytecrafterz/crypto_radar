/**
 * Ficha completa de un token: lo que saben los tres robots de el.
 */
import * as repo from '../../core/repo.js';
import type { StoredToken } from '../../core/repo.js';
import * as tracking from '../../core/tracking.js';
import { safeUrl } from '../../core/util.js';
import { addressExplorer, enlaceCompra, explorer, iso, num } from './comun.js';
import { datosTelegramToken } from './telegram.js';

const HORIZONTES: Record<string, string> = {
  m5: '5 min', m15: '15 min', h1: '1 hora', h6: '6 horas', h24: '24 horas', d7: '7 dias',
};

const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

export async function datosToken(chain: string, address: string) {
  const token = await repo.getToken(chain as StoredToken['chain'], address);
  if (!token) return null;

  // Un token de hace mas de tres dias ya no tiene nada en las ultimas 72
  // horas (el seguimiento acaba antes) y el grafico salia vacio. Se ensenan
  // entonces las 72 horas que siguen a la deteccion, que es cuando llegan los
  // avisos y se mueve el precio.
  const HORAS_SERIE = 72;
  const serieDesdeDeteccion = Date.now() - token.first_seen.getTime() > HORAS_SERIE * 3_600_000;

  const [security, holders, deployer, score, suspicious, series, horizons, cambios, telegram] =
    await Promise.all([
      repo.getLatestSecurity(token.id),
      repo.getLatestHolders(token.id),
      repo.getLatestDeployer(token.id),
      repo.getLatestScore(token.id),
      repo.getSuspicious(token.id, 25),
      repo.getSnapshotSeries(token.id, HORAS_SERIE, serieDesdeDeteccion ? token.first_seen : undefined),
      tracking.getHorizons(token.id),
      tracking.getSecurityChanges(token.id),
      datosTelegramToken(token.chain, token.address),
    ]);

  const compra = enlaceCompra(token.chain, token.address, token.dex, token.pair_address);
  const topHolders = (holders?.top_holders ?? []) as Array<{ address: string; pct: number; tag: string }>;
  const execution = score?.execution as { note?: string } | null | undefined;

  return {
    token: {
      chain: token.chain,
      address: token.address,
      pairAddress: token.pair_address,
      symbol: token.symbol,
      name: token.name,
      status: token.status,
      dex: token.dex,
      opportunity: num(token.last_opportunity),
      risk: num(token.last_risk),
      price: num(token.last_price_usd),
      peakPrice: num(token.peak_price_usd),
      liquidity: num(token.last_liquidity_usd),
      peakLiquidity: num(token.peak_liquidity_usd),
      marketCap: num(token.last_market_cap_usd),
      peakMarketCap: num(token.peak_market_cap_usd),
      firstSeen: iso(token.first_seen),
    },
    enlaces: {
      compra: compra.url,
      compraNombre: compra.nombre,
      dexscreener: `https://dexscreener.com/${token.chain}/${encodeURIComponent(token.pair_address ?? token.address)}`,
      explorador: explorer(token.chain, token.address),
      twitter: safeUrl(token.twitter),
      telegram: safeUrl(token.telegram),
      web: safeUrl(token.website),
    },
    puntuacion: score
      ? {
          opportunityLabel: (score.opportunity_label as string | null) ?? null,
          riskLabel: (score.risk_label as string | null) ?? null,
          motivosOportunidad: (score.opportunity_reasons ?? []) as Array<{ text: string; points: number }>,
          motivosRiesgo: (score.risk_reasons ?? []) as Array<{ text: string; points: number }>,
          faltan: (score.missing_data ?? []) as string[],
          vetos: ((score.critical_vetoes ?? []) as Array<{ text: string }>).map((v) => v.text),
          evaluable: score.evaluable !== false,
          costeOperar: execution?.note ?? null,
        }
      : null,
    seguridad: security
      ? {
          mintActiva: bool(security.mint_authority_active),
          freezeActiva: bool(security.freeze_authority_active),
          token2022: bool(security.is_token_2022),
          extensiones: bool(security.has_extensions),
          ownerPuedeModificar: bool(security.owner_can_modify),
          verificado: bool(security.is_verified),
          honeypot: bool(security.is_honeypot),
          blacklist: bool(security.has_blacklist),
          proxy: bool(security.is_proxy),
          impuestoCompra: num(security.buy_tax_pct),
          impuestoVenta: num(security.sell_tax_pct),
          liquidezBloqueada: num(security.lp_locked_pct),
          liquidezQuemada: num(security.lp_burned_pct),
          notas: (security.notes ?? []) as string[],
          fuentes: (security.sources ?? []) as string[],
          fallidas: (security.failed_sources ?? []) as string[],
        }
      : null,
    holders: holders
      ? {
          total: num(holders.holders_count),
          top10: num(holders.top10_pct),
          top20: num(holders.top20_pct),
          mayor: num(holders.largest_real_pct),
          creador: num(holders.deployer_pct),
          nota: (holders.note as string | null) ?? null,
          top: topHolders.map((h) => ({
            address: h.address,
            pct: Number(h.pct),
            tag: h.tag,
            explorador: addressExplorer(token.chain, h.address),
          })),
        }
      : null,
    creador: deployer?.deployer
      ? {
          address: deployer.deployer as string,
          explorador: addressExplorer(token.chain, deployer.deployer as string),
          tokensPrevios: num(deployer.prior_token_count) ?? 0,
          historial: (deployer.history_verdict as string | null) ?? 'unknown',
          financiadoPor: (deployer.funded_by as string | null) ?? null,
          nota: (deployer.note as string | null) ?? null,
        }
      : null,
    sospechosos: suspicious.map((s) => ({ ts: iso(s.ts), kind: s.kind, severity: s.severity, detail: s.detail })),
    serieDesdeDeteccion,
    serie: series.map((s) => ({
      ts: iso(s.ts),
      price: num(s.price_usd),
      liquidity: num(s.liquidity_usd),
      holders: num(s.holders_count),
    })),
    horizontes: horizons.map((h) => ({
      horizonte: HORIZONTES[h.horizon] ?? h.horizon,
      multiplo: num(h.price_multiple),
      neto: num(h.net_multiple),
      liquidez: num(h.liquidity_usd),
      capturado: iso(h.captured_at),
    })),
    cambios: cambios.map((c) => ({ ts: iso(c.ts), campo: c.field, severity: c.severity, detail: c.detail })),
    telegram,
  };
}
