/**
 * Paginas del panel web.
 */
import { renderAciertoRobot3 } from './robot3-page.js';
import { bloqueTelegramToken } from './telegram-page.js';
import { query, getState } from '../core/db.js';
import { estadoDeLasTareas } from '../worker/vigilante.js';
import * as repo from '../core/repo.js';
import type { StoredToken } from '../core/repo.js';
import { getUsage } from '../core/http.js';
import { getFilters, getScoring } from '../core/config.js';
import { env, checkEnv } from '../core/env.js';
import { activeChannels } from '../worker/notify.js';
import * as tracking from '../core/tracking.js';
import {
  page,
  statCard,
  scoreBar,
  statusBadge,
  chainBadge,
  boolBadge,
  riskBadge,
} from './layout.js';
import { lineChart, barList } from './charts.js';
import { escapeHtml, fmtUsd, fmtNum, fmtPct, fmtAge, shortAddr, safeUrl } from '../core/util.js';

const dt = (d: Date | null | undefined): string =>
  d ? d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' }) : 'n/d';

const explorer = (chain: string, address: string): string =>
  chain === 'solana'
    ? `https://solscan.io/token/${encodeURIComponent(address)}`
    : `https://basescan.org/token/${encodeURIComponent(address)}`;

const addressExplorer = (chain: string, address: string): string =>
  chain === 'solana'
    ? `https://solscan.io/account/${encodeURIComponent(address)}`
    : `https://basescan.org/address/${encodeURIComponent(address)}`;

/**
 * Enlace de compra con la direccion exacta del contrato dentro de la URL.
 *
 * El mismo que va en las alertas de Discord, para que el panel y el aviso no
 * digan cosas distintas. Lleva la direccion incrustada precisamente para que
 * no haya que buscar el token por su nombre: cuando uno funciona aparecen
 * copias con el mismo nombre y el mismo icono creadas para engañar, y buscar
 * por nombre es como se acaba comprando la falsa.
 */
const swapLink = (
  chain: string,
  address: string,
  dex?: string | null,
  pairAddress?: string | null,
): string => {
  // Ver la explicacion larga en src/worker/alerts.ts: en Solana Jupiter
  // agrega todos los mercados, pero en Base Uniswap solo opera sus pools.
  if (chain === 'solana') return `https://jup.ag/swap/SOL-${encodeURIComponent(address)}`;
  if ((dex ?? '').toLowerCase().includes('uniswap')) {
    return `https://app.uniswap.org/swap?chain=base&outputCurrency=${encodeURIComponent(address)}`;
  }
  return `https://dexscreener.com/base/${encodeURIComponent(pairAddress ?? address)}`;
};

const swapName = (chain: string, dex?: string | null): string => {
  if (chain === 'solana') return 'Jupiter';
  return (dex ?? '').toLowerCase().includes('uniswap') ? 'Uniswap' : 'su mercado';
};

// --------------------------------------------------------------------------
//  Login
// --------------------------------------------------------------------------

export function renderLogin(error?: string): string {
  return page(
    { title: 'Acceso', showNav: false },
    `<div class="login">
      <h1>Crypto Radar</h1>
      ${error ? `<div class="note danger">${escapeHtml(error)}</div>` : ''}
      <form method="post" action="/entrar">
        <input type="password" name="password" placeholder="Contrasena" autofocus required>
        <button type="submit">Entrar</button>
      </form>
    </div>`,
  );
}

// --------------------------------------------------------------------------
//  Resumen
// --------------------------------------------------------------------------

export async function renderDashboard(): Promise<string> {
  const [stats, alerts, top, activity] = await Promise.all([
    repo.getDashboardStats(),
    repo.recentAlerts(8),
    repo.listTokens({ orderBy: 'oportunidad', limit: 10, minOpportunity: 40 }),
    repo.recentActivity(12),
  ]);

  const topRows =
    top.length === 0
      ? '<tr><td colspan="7" class="empty">Todavia no hay tokens puntuados. El sistema necesita unos minutos desde el arranque.</td></tr>'
      : top
          .map(
            (t) => `<tr>
        <td><a href="/token/${t.chain}/${encodeURIComponent(t.address)}"><b>${escapeHtml(t.symbol ?? '???')}</b></a>
            <div class="dim small">${escapeHtml((t.name ?? '').slice(0, 28))}</div></td>
        <td>${chainBadge(t.chain)}</td>
        <td>${scoreBar(t.last_opportunity, 'op')}</td>
        <td>${scoreBar(t.last_risk, 'risk')}</td>
        <td class="num">${fmtUsd(t.last_liquidity_usd)}</td>
        <td class="num">${fmtUsd(t.last_market_cap_usd)}</td>
        <td class="dim small nowrap">${fmtAge(Date.now() - t.first_seen.getTime())}</td>
      </tr>`,
          )
          .join('');

  const alertRows =
    alerts.length === 0
      ? '<div class="empty">Aun no se ha enviado ninguna alerta.</div>'
      : alerts
          .map(
            (a) => `<div style="padding:9px 0;border-bottom:1px solid var(--border)">
        <div class="fila-alerta">
          <span class="badge ${a.kind === 'peligro' ? 'red' : 'green'}">${escapeHtml(a.kind)}</span>
          <a href="/token/${a.chain}/${encodeURIComponent(a.address)}"><b>${escapeHtml(a.symbol ?? '???')}</b></a>
          <span class="dim small fecha">${dt(a.ts)}</span>
        </div>
        <div class="dim small">Oportunidad ${a.opportunity ?? '-'} · Riesgo ${a.risk ?? '-'}${a.sent_ok ? '' : ' · <span style="color:var(--yellow)">no entregada</span>'}</div>
      </div>`,
          )
          .join('');

  const activityRows =
    activity.length === 0
      ? '<div class="empty">Sin actividad registrada.</div>'
      : activity
          .map(
            (a) => `<div style="padding:7px 0;border-bottom:1px solid var(--border);font-size:12px">
        <span class="badge ${a.level === 'error' ? 'red' : a.level === 'warn' ? 'yellow' : 'gray'}">${escapeHtml(a.area)}</span>
        ${escapeHtml(a.message)}
        <div class="dim">${dt(a.ts)}</div>
      </div>`,
          )
          .join('');

  return page(
    { title: 'Resumen', active: 'resumen' },
    `<h1>Resumen</h1>
     <p class="sub">Estado del radar en tiempo real.</p>

     <div class="grid stats">
       ${statCard('Detectados hoy', fmtNum(stats.tokensToday), `${fmtNum(stats.totalTokens)} en total`)}
       ${statCard('Analizados a fondo', fmtNum(stats.enrichedToday), 'hoy')}
       ${statCard('Alertas enviadas', fmtNum(stats.alertsToday), 'hoy')}
       ${statCard('En seguimiento', fmtNum(stats.tracked), 'ahora mismo')}
       ${statCard('Descartados', fmtNum(stats.discardedToday), 'hoy, por el filtro')}
     </div>

     <h2>Mejores oportunidades</h2>
     <div class="table-wrap">
       <table>
         <thead><tr><th>Token</th><th>Cadena</th><th>Oportunidad</th><th>Riesgo</th>
           <th class="num">Liquidez</th><th class="num">Capitalizacion</th><th>Detectado</th></tr></thead>
         <tbody>${topRows}</tbody>
       </table>
     </div>

     <div class="grid two" style="margin-top:24px">
       <div class="card"><h3>Ultimas alertas</h3>${alertRows}</div>
       <div class="card"><h3>Actividad del sistema</h3>${activityRows}</div>
     </div>`,
  );
}

// --------------------------------------------------------------------------
//  Listado de tokens
// --------------------------------------------------------------------------

export async function renderTokens(params: Record<string, string>): Promise<string> {
  const pageNum = Math.max(1, Number(params.p ?? '1') || 1);
  const perPage = 50;

  const filters: repo.TokenListFilters = {
    chain: params.chain || undefined,
    status: params.status || undefined,
    search: params.q || undefined,
    minOpportunity: params.minop ? Number(params.minop) : undefined,
    maxRisk: params.maxrisk ? Number(params.maxrisk) : undefined,
    orderBy: (params.orden as repo.TokenListFilters['orderBy']) || 'reciente',
    limit: perPage,
    offset: (pageNum - 1) * perPage,
  };

  const [tokens, total] = await Promise.all([repo.listTokens(filters), repo.countTokens(filters)]);

  const rows =
    tokens.length === 0
      ? '<tr><td colspan="9" class="empty">Ningun token coincide con estos filtros.</td></tr>'
      : tokens
          .map(
            (t) => `<tr>
        <td><a href="/token/${t.chain}/${encodeURIComponent(t.address)}"><b>${escapeHtml(t.symbol ?? '???')}</b></a>
            <div class="dim small">${escapeHtml((t.name ?? '').slice(0, 26))}</div></td>
        <td>${chainBadge(t.chain)}</td>
        <td>${statusBadge(t.status)}</td>
        <td>${scoreBar(t.last_opportunity, 'op')}</td>
        <td>${scoreBar(t.last_risk, 'risk')}</td>
        <td class="num">${fmtUsd(t.last_liquidity_usd)}</td>
        <td class="num">${fmtUsd(t.last_market_cap_usd)}</td>
        <td class="dim small">${escapeHtml(t.dex ?? '-')}</td>
        <td class="dim small nowrap">${dt(t.first_seen)}</td>
      </tr>`,
          )
          .join('');

  const qs = (extra: Record<string, string | number>) => {
    const merged: Record<string, string> = { ...params };
    for (const [k, v] of Object.entries(extra)) merged[k] = String(v);
    return `?${new URLSearchParams(merged).toString()}`;
  };

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  return page(
    { title: 'Tokens', active: 'tokens' },
    `<h1>Tokens detectados</h1>
     <p class="sub">${fmtNum(total)} tokens guardados con estos filtros.</p>

     <form class="filters" method="get" action="/tokens">
       <label class="field">Buscar
         <input type="text" name="q" value="${escapeHtml(params.q ?? '')}" placeholder="simbolo o direccion">
       </label>
       <label class="field">Cadena
         <select name="chain">
           <option value="">Todas</option>
           <option value="solana" ${params.chain === 'solana' ? 'selected' : ''}>Solana</option>
           <option value="base" ${params.chain === 'base' ? 'selected' : ''}>Base</option>
         </select>
       </label>
       <label class="field">Estado
         <select name="status">
           <option value="">Todos</option>
           ${['nuevo', 'vigilado', 'alertado', 'peligro', 'descartado', 'archivado']
             .map((s) => `<option value="${s}" ${params.status === s ? 'selected' : ''}>${s}</option>`)
             .join('')}
         </select>
       </label>
       <label class="field">Oportunidad min.
         <input type="number" name="minop" value="${escapeHtml(params.minop ?? '')}" min="0" max="100" style="width:90px">
       </label>
       <label class="field">Riesgo max.
         <input type="number" name="maxrisk" value="${escapeHtml(params.maxrisk ?? '')}" min="0" max="100" style="width:90px">
       </label>
       <label class="field">Ordenar por
         <select name="orden">
           <option value="reciente" ${params.orden === 'reciente' ? 'selected' : ''}>Mas reciente</option>
           <option value="oportunidad" ${params.orden === 'oportunidad' ? 'selected' : ''}>Oportunidad</option>
           <option value="riesgo" ${params.orden === 'riesgo' ? 'selected' : ''}>Riesgo</option>
           <option value="liquidez" ${params.orden === 'liquidez' ? 'selected' : ''}>Liquidez</option>
         </select>
       </label>
       <button type="submit">Filtrar</button>
       <a href="/tokens"><button type="button" class="ghost">Limpiar</button></a>
     </form>

     <div class="table-wrap">
       <table>
         <thead><tr><th>Token</th><th>Cadena</th><th>Estado</th><th>Oportunidad</th><th>Riesgo</th>
           <th class="num">Liquidez</th><th class="num">Cap</th><th>DEX</th><th>Detectado</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>
     </div>

     <div class="pager">
       ${pageNum > 1 ? `<a href="${qs({ p: pageNum - 1 })}">← Anterior</a>` : ''}
       <span class="dim small" style="padding:6px 12px">Pagina ${pageNum} de ${totalPages}</span>
       ${pageNum < totalPages ? `<a href="${qs({ p: pageNum + 1 })}">Siguiente →</a>` : ''}
     </div>`,
  );
}

// --------------------------------------------------------------------------
//  Ficha de token
// --------------------------------------------------------------------------

export async function renderTokenDetail(chain: string, address: string): Promise<string | null> {
  const token = await repo.getToken(chain as StoredToken['chain'], address);
  if (!token) return null;

  const [security, holders, deployer, score, suspicious, series, horizons, secChanges, telegram] = await Promise.all([
    repo.getLatestSecurity(token.id),
    repo.getLatestHolders(token.id),
    repo.getLatestDeployer(token.id),
    repo.getLatestScore(token.id),
    repo.getSuspicious(token.id, 25),
    repo.getSnapshotSeries(token.id, 72),
    tracking.getHorizons(token.id),
    tracking.getSecurityChanges(token.id),
    bloqueTelegramToken(token.chain, token.address),
  ]);

  const opReasons = (score?.opportunity_reasons ?? []) as Array<{ text: string; points: number }>;
  const riskReasons = (score?.risk_reasons ?? []) as Array<{ text: string; points: number }>;
  const missing = (score?.missing_data ?? []) as string[];
  const topHolders = (holders?.top_holders ?? []) as Array<{
    address: string;
    pct: number;
    tag: string;
  }>;
  const notes = (security?.notes ?? []) as string[];
  const sources = (security?.sources ?? []) as string[];
  const failed = (security?.failed_sources ?? []) as string[];

  const priceChart = lineChart(
    series.map((s) => ({ ts: s.ts, value: s.price_usd })),
    { color: '#58a6ff', fill: true, label: 'precio', formatter: (v) => `$${v.toPrecision(3)}` },
  );
  const liqChart = lineChart(
    series.map((s) => ({ ts: s.ts, value: s.liquidity_usd })),
    { color: '#3fb950', fill: true, label: 'liquidez' },
  );
  const holdersChart = lineChart(
    series.map((s) => ({ ts: s.ts, value: s.holders_count })),
    { color: '#bc8cff', label: 'holders', formatter: (v) => fmtNum(v) },
  );

  const isSolana = token.chain === 'solana';

  const securityBlock = !security
    ? '<div class="empty small">Este token todavia no ha pasado el analisis profundo.</div>'
    : `<dl class="kv">
        ${
          isSolana
            ? `<dt>Mint authority</dt><dd>${boolBadge(security.mint_authority_active as boolean, true, ['ACTIVA', 'revocada'])}</dd>
               <dt>Freeze authority</dt><dd>${boolBadge(security.freeze_authority_active as boolean, true, ['ACTIVA', 'revocada'])}</dd>
               <dt>Token-2022</dt><dd>${security.is_token_2022 ? 'si' : 'no'}${security.has_extensions ? ' (con extensiones)' : ''}</dd>`
            : `<dt>Owner con permisos</dt><dd>${boolBadge(security.owner_can_modify as boolean, true, ['si', 'no'])}</dd>
               <dt>Contrato verificado</dt><dd>${boolBadge(security.is_verified as boolean | null, false, ['si', 'no'])}</dd>
               <dt>Honeypot</dt><dd>${boolBadge(security.is_honeypot as boolean | null, true, ['SI', 'no'])}</dd>
               <dt>Blacklist</dt><dd>${boolBadge(security.has_blacklist as boolean, true, ['si', 'no'])}</dd>
               <dt>Proxy</dt><dd>${boolBadge(security.is_proxy as boolean, true, ['si', 'no'])}</dd>
               <dt>Comisiones</dt><dd>${security.buy_tax_pct ?? '?'}% / ${security.sell_tax_pct ?? '?'}%</dd>`
        }
        <dt>Liquidez bloqueada</dt><dd>${security.lp_locked_pct !== null ? `${Number(security.lp_locked_pct).toFixed(1)}%` : 'n/d'}</dd>
        <dt>Liquidez quemada</dt><dd>${security.lp_burned_pct !== null ? `${Number(security.lp_burned_pct).toFixed(1)}%` : 'n/d'}</dd>
      </dl>
      ${
        notes.length > 0
          ? `<h3 style="margin-top:16px">Comprobaciones</h3>
             <ul class="reasons">${notes.map((n) => `<li><span>${escapeHtml(n)}</span></li>`).join('')}</ul>`
          : ''
      }
      <div class="dim small" style="margin-top:12px">
        Fuentes consultadas: ${sources.length > 0 ? escapeHtml(sources.join(', ')) : 'ninguna'}${failed.length > 0 ? ` · Sin respuesta: ${escapeHtml(failed.join(', '))}` : ''}
      </div>`;

  const holdersBlock = !holders
    ? '<div class="empty small">Sin datos de holders todavia.</div>'
    : `<dl class="kv">
        <dt>Holders totales</dt><dd>${holders.holders_count !== null ? fmtNum(holders.holders_count as number) : 'n/d'}</dd>
        <dt>Top 10 real</dt><dd>${holders.top10_pct !== null ? `${Number(holders.top10_pct).toFixed(1)}%` : 'n/d'}</dd>
        <dt>Top 20 real</dt><dd>${holders.top20_pct !== null ? `${Number(holders.top20_pct).toFixed(1)}%` : 'n/d'}</dd>
        <dt>Mayor wallet</dt><dd>${holders.largest_real_pct !== null ? `${Number(holders.largest_real_pct).toFixed(1)}%` : 'n/d'}</dd>
        <dt>Creador conserva</dt><dd>${holders.deployer_pct !== null ? `${Number(holders.deployer_pct).toFixed(1)}%` : 'n/d'}</dd>
      </dl>
      ${holders.note ? `<div class="note small">${escapeHtml(holders.note as string)}</div>` : ''}
      ${
        topHolders.length > 0
          ? `<div class="table-wrap" style="margin-top:12px">
              <table><thead><tr><th>#</th><th>Direccion</th><th>Tipo</th><th class="num">%</th></tr></thead>
              <tbody>${topHolders
                .map(
                  (h, i) => `<tr>
                    <td class="dim">${i + 1}</td>
                    <td class="mono small"><a href="${addressExplorer(token.chain, h.address)}" target="_blank" rel="noopener">${escapeHtml(shortAddr(h.address, 8, 6))}</a></td>
                    <td><span class="badge ${h.tag === 'wallet' ? 'gray' : h.tag === 'creador' ? 'red' : 'blue'}">${escapeHtml(h.tag)}</span></td>
                    <td class="num">${h.pct.toFixed(2)}%</td>
                  </tr>`,
                )
                .join('')}</tbody></table>
             </div>`
          : ''
      }`;

  const deployerBlock = !deployer?.deployer
    ? '<div class="empty small">No se ha podido identificar al creador.</div>'
    : `<dl class="kv">
        <dt>Direccion</dt><dd class="mono small"><a href="${addressExplorer(token.chain, deployer.deployer as string)}" target="_blank" rel="noopener">${escapeHtml(shortAddr(deployer.deployer as string, 8, 6))}</a></dd>
        <dt>Tokens anteriores</dt><dd>${deployer.prior_token_count ?? 0}</dd>
        <dt>Historial</dt><dd>${
          deployer.history_verdict === 'bad'
            ? '<span class="badge red">malo</span>'
            : deployer.history_verdict === 'good'
              ? '<span class="badge green">bueno</span>'
              : '<span class="badge gray">desconocido</span>'
        }</dd>
        ${deployer.funded_by ? `<dt>Financiado por</dt><dd class="mono small">${escapeHtml(shortAddr(deployer.funded_by as string, 8, 6))}</dd>` : ''}
      </dl>
      ${deployer.note ? `<div class="note small">${escapeHtml(deployer.note as string)}</div>` : ''}`;

  const suspiciousBlock =
    suspicious.length === 0
      ? '<div class="empty small">No se han detectado movimientos sospechosos.</div>'
      : `<ul class="reasons">${suspicious
          .map(
            (s) => `<li>
              <span class="badge ${s.severity === 'danger' ? 'red' : s.severity === 'warn' ? 'yellow' : 'gray'}">${escapeHtml(s.kind)}</span>
              <span>${escapeHtml(s.detail)}<div class="dim small">${dt(s.ts)}</div></span>
            </li>`,
          )
          .join('')}</ul>`;

  return page(
    { title: token.symbol ?? 'Token', active: 'tokens' },
    `<div class="tokenhead">
       <div>
         <div class="sym">${escapeHtml(token.symbol ?? '???')}</div>
         <div class="muted">${escapeHtml(token.name ?? '')}</div>
       </div>
       <div style="margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap">
         ${chainBadge(token.chain)} ${statusBadge(token.status)}
         <span class="badge gray">${escapeHtml(token.dex ?? 'dex')}</span>
       </div>
     </div>

     <div class="mono small dim">${escapeHtml(token.address)}</div>

     <div class="links">
       <a class="comprar" href="${swapLink(token.chain, token.address, token.dex, token.pair_address)}" target="_blank" rel="noopener">Comprar en ${swapName(token.chain, token.dex)}</a>
       <a href="https://dexscreener.com/${token.chain}/${encodeURIComponent(token.pair_address ?? '')}" target="_blank" rel="noopener">DexScreener</a>
       <a href="${explorer(token.chain, token.address)}" target="_blank" rel="noopener">Explorador</a>
       ${safeUrl(token.twitter) ? `<a href="${escapeHtml(safeUrl(token.twitter))}" target="_blank" rel="noopener noreferrer">X</a>` : ''}
       ${safeUrl(token.telegram) ? `<a href="${escapeHtml(safeUrl(token.telegram))}" target="_blank" rel="noopener noreferrer">Telegram</a>` : ''}
       ${safeUrl(token.website) ? `<a href="${escapeHtml(safeUrl(token.website))}" target="_blank" rel="noopener noreferrer">Web</a>` : ''}
     </div>

     <div class="grid stats">
       ${statCard('Oportunidad', String(token.last_opportunity ?? '-'), (score?.opportunity_label as string) ?? '')}
       ${statCard('Riesgo', String(token.last_risk ?? '-'), (score?.risk_label as string) ?? '')}
       ${statCard('Precio', token.last_price_usd !== null ? `$${Number(token.last_price_usd).toPrecision(4)}` : 'n/d', `maximo $${token.peak_price_usd !== null ? Number(token.peak_price_usd).toPrecision(4) : '-'}`)}
       ${statCard('Liquidez', fmtUsd(token.last_liquidity_usd), `maxima ${fmtUsd(token.peak_liquidity_usd)}`)}
       ${statCard('Capitalizacion', fmtUsd(token.last_market_cap_usd), `maxima ${fmtUsd(token.peak_market_cap_usd)}`)}
       ${statCard('Detectado', fmtAge(Date.now() - token.first_seen.getTime()), dt(token.first_seen))}
     </div>

     ${
       missing.length > 0
         ? `<div class="note warn">No se pudo comprobar: ${escapeHtml(missing.join(', '))}. La puntuacion se calcula con lo que si se pudo verificar.</div>`
         : ''
     }

     <div class="grid two" style="margin-top:20px">
       <div class="card">
         <h3>Por que es interesante</h3>
         ${
           opReasons.length === 0
             ? '<div class="empty small">Sin motivos registrados.</div>'
             : `<ul class="reasons">${opReasons
                 .map(
                   (r) => `<li><span class="pts" style="color:var(--green)">+${r.points}</span><span>${escapeHtml(r.text)}</span></li>`,
                 )
                 .join('')}</ul>`
         }
       </div>
       <div class="card">
         <h3>Riesgos detectados</h3>
         ${
           riskReasons.length === 0
             ? '<div class="empty small">No se han detectado riesgos.</div>'
             : `<ul class="reasons">${riskReasons
                 .map(
                   (r) => `<li><span class="pts" style="color:var(--red)">+${r.points}</span><span>${escapeHtml(r.text)}</span></li>`,
                 )
                 .join('')}</ul>`
         }
       </div>
     </div>

     ${
       (score?.critical_vetoes as Array<{ code: string; text: string }> | undefined)?.length
         ? `<div class="note danger"><b>🚫 VETOS CRITICOS</b><ul style="margin:8px 0 0;padding-left:18px">
              ${(score!.critical_vetoes as Array<{ code: string; text: string }>)
                .map((v) => `<li>${escapeHtml(v.text)}</li>`)
                .join('')}
            </ul></div>`
         : ''
     }
     ${
       score?.evaluable === false
         ? '<div class="note warn"><b>NO EVALUABLE</b> — faltan comprobaciones criticas. El sistema no puede afirmar que este token sea seguro.</div>'
         : ''
     }
     ${
       score?.execution
         ? `<div class="note"><b>Coste real de operar</b><br>${escapeHtml((score.execution as { note: string }).note)}</div>`
         : ''
     }

     ${telegram}

     ${
       horizons.length > 0
         ? `<h2>Que paso despues</h2>
            <p class="sub small">Mediciones tomadas en el momento exacto de cada horizonte. El
               resultado neto descuenta lo que costaria entrar y salir.</p>
            <div class="table-wrap"><table>
              <thead><tr><th>Momento</th><th class="num">Multiplo</th><th class="num">Neto</th>
                <th class="num">Liquidez</th><th>Capturado</th></tr></thead>
              <tbody>${horizons
                .map((h) => {
                  const etiqueta: Record<string, string> = { m5: '5 min', m15: '15 min', h1: '1 hora', h6: '6 horas', h24: '24 horas', d7: '7 dias' };
                  const mult = h.price_multiple !== null ? Number(h.price_multiple) : null;
                  const neto = h.net_multiple !== null ? Number(h.net_multiple) : null;
                  const color = (v: number | null) => (v === null ? 'var(--muted)' : v >= 1 ? 'var(--green)' : 'var(--red)');
                  return `<tr>
                    <td><b>${etiqueta[h.horizon] ?? h.horizon}</b></td>
                    <td class="num" style="color:${color(mult)}">${mult !== null ? mult.toFixed(2) + 'x' : '-'}</td>
                    <td class="num" style="color:${color(neto)}">${neto !== null ? neto.toFixed(2) + 'x' : '-'}</td>
                    <td class="num">${fmtUsd(h.liquidity_usd)}</td>
                    <td class="dim small">${dt(h.captured_at)}</td>
                  </tr>`;
                })
                .join('')}</tbody>
            </table></div>`
         : ''
     }

     ${
       secChanges.length > 0
         ? `<h2>Cambios detectados despues de la deteccion</h2>
            <div class="card"><ul class="reasons">${secChanges
              .map(
                (c) => `<li><span class="badge ${c.severity === 'danger' ? 'red' : 'yellow'}">${escapeHtml(c.field)}</span>
                  <span>${escapeHtml(c.detail)}<div class="dim small">${dt(c.ts)}</div></span></li>`,
              )
              .join('')}</ul></div>`
         : ''
     }

     <h2>Evolucion</h2>
     <div class="grid three">
       <div class="card"><h3>Precio</h3>${priceChart}</div>
       <div class="card"><h3>Liquidez</h3>${liqChart}</div>
       <div class="card"><h3>Holders</h3>${holdersChart}</div>
     </div>

     <div class="grid two" style="margin-top:20px">
       <div class="card"><h3>Seguridad</h3>${securityBlock}</div>
       <div class="card"><h3>Holders y concentracion</h3>${holdersBlock}</div>
     </div>

     <div class="grid two" style="margin-top:14px">
       <div class="card"><h3>Creador</h3>${deployerBlock}</div>
       <div class="card"><h3>Movimientos sospechosos</h3>${suspiciousBlock}</div>
     </div>`,
  );
}

// --------------------------------------------------------------------------
//  Alertas
// --------------------------------------------------------------------------

export async function renderAlerts(): Promise<string> {
  const alerts = await repo.recentAlerts(120);

  const rows =
    alerts.length === 0
      ? '<tr><td colspan="6" class="empty">Aun no se ha enviado ninguna alerta.</td></tr>'
      : alerts
          .map(
            (a) => `<tr>
        <td class="dim small nowrap">${dt(a.ts)}</td>
        <td><span class="badge ${a.kind === 'peligro' ? 'red' : 'green'}">${escapeHtml(a.kind)}</span></td>
        <td><a href="/token/${a.chain}/${encodeURIComponent(a.address)}"><b>${escapeHtml(a.symbol ?? '???')}</b></a></td>
        <td>${chainBadge(a.chain)}</td>
        <td class="num">${a.opportunity ?? '-'} / ${a.risk ?? '-'}</td>
        <td>${
          (a.channels ?? []).length > 0
            ? (a.channels ?? [])
                .map(
                  (c) =>
                    `<span class="badge ${c.ok ? 'green' : 'red'}" title="${escapeHtml(c.error ?? '')}">${escapeHtml(c.channel)}</span>`,
                )
                .join(' ')
            : a.sent_ok
              ? '<span class="badge green">entregada</span>'
              : '<span class="badge yellow">no entregada</span>'
        }</td>
      </tr>`,
          )
          .join('');

  return page(
    { title: 'Alertas', active: 'alertas' },
    `<h1>Alertas enviadas</h1>
     <p class="sub">Historico completo de avisos, entregados o no.</p>
     <div class="table-wrap">
       <table>
         <thead><tr><th>Fecha</th><th>Tipo</th><th>Token</th><th>Cadena</th>
           <th class="num">Oport. / Riesgo</th><th>Entrega</th></tr></thead>
         <tbody>${rows}</tbody>
       </table>
     </div>`,
  );
}

// --------------------------------------------------------------------------
//  Resultados (base del backtesting)
// --------------------------------------------------------------------------

export async function renderResults(): Promise<string> {
  const aciertoRobot3 = await renderAciertoRobot3();
  const [outcomes, byScore, best] = await Promise.all([
    query<{ outcome: string; count: number; avg_peak: number | null }>(
      `SELECT outcome, COUNT(*)::int AS count, AVG(peak_multiple) AS avg_peak
         FROM token_outcomes GROUP BY outcome ORDER BY count DESC`,
    ),
    query<{ bucket: string; total: number; exitos: number; rugs: number; avg_peak: number | null }>(
      `SELECT
          CASE
            WHEN score_at_detection >= 80 THEN '80-100'
            WHEN score_at_detection >= 65 THEN '65-79'
            WHEN score_at_detection >= 50 THEN '50-64'
            ELSE 'menos de 50'
          END AS bucket,
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE outcome = 'exito')::int AS exitos,
          COUNT(*) FILTER (WHERE outcome = 'rug')::int AS rugs,
          AVG(peak_multiple) AS avg_peak
        FROM token_outcomes
        WHERE score_at_detection IS NOT NULL
        GROUP BY bucket
        ORDER BY bucket DESC`,
    ),
    query<{
      symbol: string | null;
      chain: string;
      address: string;
      peak_multiple: number | null;
      outcome: string;
      score_at_detection: number | null;
    }>(
      `SELECT t.symbol, t.chain, t.address, o.peak_multiple, o.outcome, o.score_at_detection
         FROM token_outcomes o JOIN tokens t ON t.id = o.token_id
        ORDER BY o.peak_multiple DESC NULLS LAST LIMIT 20`,
    ),
  ]);

  const totalClosed = outcomes.reduce((a, o) => a + o.count, 0);

  // Comparacion honesta: los tokens con nota alta contra TODOS los analizados.
  // Si el sistema no bate a la media, no esta aportando nada.
  const [comparativa, latencia] = await Promise.all([
    query<{
      grupo: string;
      tokens: number;
      media_multiplo: number | null;
      media_neto: number | null;
      pct_exito: number | null;
    }>(
      `WITH base AS (
         SELECT t.id, s.opportunity,
                (SELECT price_multiple FROM token_horizons h
                  WHERE h.token_id = t.id AND h.horizon = 'h24' LIMIT 1) AS mult,
                (SELECT net_multiple FROM token_horizons h
                  WHERE h.token_id = t.id AND h.horizon = 'h24' LIMIT 1) AS neto
           FROM tokens t
           JOIN LATERAL (SELECT opportunity FROM scores WHERE token_id = t.id
                          ORDER BY ts ASC LIMIT 1) s ON true
          WHERE t.enriched_at IS NOT NULL
       )
       SELECT 'Puntuacion alta (>=65)' AS grupo, COUNT(*)::int AS tokens,
              ROUND(AVG(mult)::numeric, 2) AS media_multiplo,
              ROUND(AVG(neto)::numeric, 2) AS media_neto,
              ROUND((COUNT(*) FILTER (WHERE mult >= 1.5)::numeric / NULLIF(COUNT(*), 0) * 100), 0) AS pct_exito
         FROM base WHERE opportunity >= 65 AND mult IS NOT NULL
       UNION ALL
       SELECT 'Puntuacion baja (<50)', COUNT(*)::int,
              ROUND(AVG(mult)::numeric, 2), ROUND(AVG(neto)::numeric, 2),
              ROUND((COUNT(*) FILTER (WHERE mult >= 1.5)::numeric / NULLIF(COUNT(*), 0) * 100), 0)
         FROM base WHERE opportunity < 50 AND mult IS NOT NULL
       UNION ALL
       SELECT 'TODOS (equivale a elegir al azar)', COUNT(*)::int,
              ROUND(AVG(mult)::numeric, 2), ROUND(AVG(neto)::numeric, 2),
              ROUND((COUNT(*) FILTER (WHERE mult >= 1.5)::numeric / NULLIF(COUNT(*), 0) * 100), 0)
         FROM base WHERE mult IS NOT NULL`,
    ),
    tracking.getLatencyStats(),
  ]);

  const comparativaRows =
    comparativa.every((c) => c.tokens === 0)
      ? '<tr><td colspan="5" class="empty">Todavia no hay mediciones a 24 h. Hacen falta unos dias de funcionamiento.</td></tr>'
      : comparativa
          .map(
            (c) => `<tr>
              <td><b>${escapeHtml(c.grupo)}</b></td>
              <td class="num">${c.tokens}</td>
              <td class="num">${c.media_multiplo !== null ? Number(c.media_multiplo).toFixed(2) + 'x' : '-'}</td>
              <td class="num">${c.media_neto !== null ? Number(c.media_neto).toFixed(2) + 'x' : '-'}</td>
              <td class="num">${c.pct_exito !== null ? Number(c.pct_exito).toFixed(0) + '%' : '-'}</td>
            </tr>`,
          )
          .join('');

  const outcomeColors: Record<string, string> = {
    exito: 'var(--green)',
    neutro: 'var(--muted)',
    fracaso: 'var(--orange)',
    rug: 'var(--red)',
  };

  const bucketRows =
    byScore.length === 0
      ? '<tr><td colspan="5" class="empty">Todavia no hay tokens cerrados. Cada token se cierra tras su periodo de seguimiento.</td></tr>'
      : byScore
          .map(
            (b) => `<tr>
        <td><b>${escapeHtml(b.bucket)}</b></td>
        <td class="num">${b.total}</td>
        <td class="num" style="color:var(--green)">${b.exitos} (${((b.exitos / b.total) * 100).toFixed(0)}%)</td>
        <td class="num" style="color:var(--red)">${b.rugs} (${((b.rugs / b.total) * 100).toFixed(0)}%)</td>
        <td class="num">${b.avg_peak !== null ? `${Number(b.avg_peak).toFixed(2)}x` : '-'}</td>
      </tr>`,
          )
          .join('');

  const bestRows =
    best.length === 0
      ? '<tr><td colspan="5" class="empty">Sin datos todavia.</td></tr>'
      : best
          .map(
            (b) => `<tr>
        <td><a href="/token/${b.chain}/${encodeURIComponent(b.address)}"><b>${escapeHtml(b.symbol ?? '???')}</b></a></td>
        <td>${chainBadge(b.chain)}</td>
        <td class="num">${b.score_at_detection ?? '-'}</td>
        <td class="num">${b.peak_multiple !== null ? `${Number(b.peak_multiple).toFixed(2)}x` : '-'}</td>
        <td><span class="badge ${b.outcome === 'exito' ? 'green' : b.outcome === 'rug' ? 'red' : 'gray'}">${escapeHtml(b.outcome)}</span></td>
      </tr>`,
          )
          .join('');

  return page(
    { title: 'Resultados', active: 'resultados' },
    `<h1>Resultados</h1>
     <p class="sub">Que paso realmente con los tokens detectados. Esta es la base del backtesting:
        cuantos mas dias funcione el sistema, mas fiables son estos numeros.</p>

     ${
       totalClosed === 0
         ? `<div class="note">Todavia no hay tokens cerrados. Cada token se sigue durante varios dias y,
              al terminar, se calcula automaticamente su resultado. Los datos se estan guardando desde el primer momento.</div>`
         : ''
     }

     <div class="grid two">
       <div class="card">
         <h3>Resultado de los tokens cerrados (${totalClosed})</h3>
         ${barList(
           outcomes.map((o) => ({
             label: o.outcome,
             value: o.count,
             color: outcomeColors[o.outcome] ?? 'var(--blue)',
           })),
         )}
       </div>
       <div class="card">
         <h3>Que significa cada resultado</h3>
         <dl class="kv" style="grid-template-columns:auto 1fr">
           <dt><span class="badge green">exito</span></dt><dd style="text-align:left">Llego a multiplicar por 2 o mas su capitalizacion.</dd>
           <dt><span class="badge gray">neutro</span></dt><dd style="text-align:left">Se movio poco respecto al momento de la deteccion.</dd>
           <dt><span class="badge orange">fracaso</span></dt><dd style="text-align:left">Perdio mas de la mitad de su valor.</dd>
           <dt><span class="badge red">rug</span></dt><dd style="text-align:left">Se retiro casi toda la liquidez.</dd>
         </dl>
       </div>
     </div>

     <h2>¿Aciertan mas las notas altas que elegir al azar?</h2>
     <p class="sub small">Esta es la prueba que de verdad importa. Compara los tokens con nota alta
        contra el conjunto completo de analizados, que equivale a elegir al azar entre lo detectado.
        La columna <b>neto</b> descuenta lo que costaria entrar y salir.</p>
     <div class="table-wrap">
       <table>
         <thead><tr><th>Grupo</th><th class="num">Tokens</th><th class="num">Multiplo medio 24 h</th>
           <th class="num">Neto tras costes</th><th class="num">% que sube 1,5x</th></tr></thead>
         <tbody>${comparativaRows}</tbody>
       </table>
     </div>

     <h2>Velocidad del sistema</h2>
     ${
       latencia && latencia.muestras > 0
         ? `<div class="grid stats">
              ${statCard('Latencia mediana', `${latencia.mediana_total_s ?? '-'} s`, 'de la creacion del par a la alerta')}
              ${statCard('Percentil 90', `${latencia.p90_total_s ?? '-'} s`, '9 de cada 10 alertas por debajo')}
              ${statCard('Analisis', `${latencia.mediana_analisis_s ?? '-'} s`, 'lo que tarda el analisis completo')}
              ${statCard('Muestras', String(latencia.muestras), 'alertas medidas')}
            </div>`
         : '<div class="note">Todavia no hay alertas enviadas con latencia medida. El dato aparece en cuanto se envie la primera.</div>'
     }

     <h2>Acierto segun la puntuacion en el momento de detectarlo</h2>
     <p class="sub small">Si el sistema funciona, los tramos altos deben concentrar mas exitos y menos rugs.
        Con estos datos puedes ajustar los umbrales en <code>config/filters.yaml</code>.</p>
     <div class="table-wrap">
       <table>
         <thead><tr><th>Puntuacion</th><th class="num">Tokens</th><th class="num">Exitos</th>
           <th class="num">Rugs</th><th class="num">Maximo medio</th></tr></thead>
         <tbody>${bucketRows}</tbody>
       </table>
     </div>

     ${aciertoRobot3}

     <h2>Los que mas subieron</h2>
     <div class="table-wrap">
       <table>
         <thead><tr><th>Token</th><th>Cadena</th><th class="num">Puntuacion</th>
           <th class="num">Maximo</th><th>Resultado</th></tr></thead>
         <tbody>${bestRows}</tbody>
       </table>
     </div>`,
  );
}

// --------------------------------------------------------------------------
//  Sistema
// --------------------------------------------------------------------------

export async function renderSystem(): Promise<string> {
  // Los avisos se pueden pausar desde el propio panel. Antes solo se podia
  // con los comandos del bot de Telegram, que con Discord por webhook no
  // existen: el usuario se quedaba sin forma de silenciar su movil.
  const pausado = await getState<boolean>('alertas_pausadas', false);
  const filters = getFilters();
  const scoring = getScoring();
  const usage = getUsage();
  const warnings = checkEnv();
  const activity = await repo.recentActivity(60);
  const tareas = await estadoDeLasTareas();

  const usageRows =
    usage.length === 0
      ? '<tr><td colspan="5" class="empty">Sin llamadas registradas todavia en esta sesion.</td></tr>'
      : usage
          .sort((a, b) => b.callsToday - a.callsToday)
          .map(
            (u) => `<tr>
        <td><b>${escapeHtml(u.provider)}</b></td>
        <td class="num">${fmtNum(u.callsToday)}</td>
        <td class="num">${u.dailyLimit > 0 ? fmtNum(u.dailyLimit) : 'sin limite'}</td>
        <td class="num">${u.rps}/s</td>
        <td>${
          u.circuitOpen
            ? '<span class="badge red">caido</span>'
            : u.throttled
              ? '<span class="badge yellow">esperando</span>'
              : u.total429 > 0
                ? `<span class="badge gray">${u.total429} esperas</span>`
                : '<span class="badge green">ok</span>'
        }</td>
      </tr>`,
          )
          .join('');

  const activityRows =
    activity.length === 0
      ? '<div class="empty small">Sin actividad registrada.</div>'
      : activity
          .map(
            (a) => `<div style="padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
        <span class="badge ${a.level === 'error' ? 'red' : a.level === 'warn' ? 'yellow' : 'gray'}">${escapeHtml(a.area)}</span>
        ${escapeHtml(a.message)}
        <span class="dim" style="float:right">${dt(a.ts)}</span>
      </div>`,
          )
          .join('');

  return page(
    { title: 'Sistema', active: 'sistema' },
    `<h1>Sistema</h1>
     <p class="sub">Configuracion activa y consumo de los servicios gratuitos.</p>

     <h2>Estado de los robots</h2>
     <p class="sub small">
       Cada tarea deja constancia de su ultima vuelta. Si alguna se queda
       callada mas de lo que deberia, el sistema avisa por Discord en vez de
       quedarse parado aparentando que funciona.
     </p>
     ${(() => {
       const cuenta = (ms: number | null): string => {
         if (ms === null) return 'aun no ha dado su primera vuelta';
         const min = Math.round(ms / 60000);
         if (min < 1) return 'hace menos de un minuto';
         if (min < 60) return 'hace ' + min + ' min';
         const h = Math.round(min / 60);
         return h < 48 ? 'hace ' + h + ' h' : 'hace ' + Math.round(h / 24) + ' dias';
       };
       const caidas = tareas.filter((t) => t.caida);
       const cabecera = caidas.length === 0
         ? '<div class="note">Todas las tareas estan al dia.</div>'
         : '<div class="note warn"><b>' + caidas.length + ' tarea(s) sin dar senales:</b> ' +
           caidas.map((c) => escapeHtml(c.nombre)).join(', ') + '</div>';
       return cabecera + '<div class="table-wrap"><table><thead><tr>' +
         '<th>Tarea</th><th>Ultima vuelta</th><th>Estado</th>' +
         '</tr></thead><tbody>' +
         tareas.map((t) =>
           '<tr><td><b>' + escapeHtml(t.nombre) + '</b></td>' +
           '<td>' + cuenta(t.callada_ms) + '</td>' +
           '<td>' + (t.caida
             ? '<span class="badge red">parada</span>'
             : t.ultimoLatido === null
               ? '<span class="badge gray">arrancando</span>'
               : '<span class="badge green">al dia</span>') + '</td></tr>').join('') +
         '</tbody></table></div>';
     })()}

     <div class="card" style="margin-bottom:16px">
       <h3>Avisos por Discord ${pausado ? '<span class="badge red">pausados</span>' : '<span class="badge green">activos</span>'}</h3>
       <p style="margin:6px 0 12px">${
         pausado
           ? 'No se esta enviando ningun aviso. El sistema sigue detectando, analizando y guardandolo todo: solo deja de escribirte.'
           : 'Recibiras las oportunidades y los avisos de peligro en Discord.'
       }</p>
       <form method="post" action="/avisos">
         <input type="hidden" name="accion" value="${pausado ? 'reanudar' : 'pausar'}">
         <button type="submit" class="btn">${pausado ? 'Reanudar los avisos' : 'Pausar los avisos'}</button>
       </form>
     </div>

     ${
       warnings.length > 0
         ? `<div class="note warn"><b>Avisos de configuracion</b><ul style="margin:8px 0 0;padding-left:18px">
             ${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}
            </ul></div>`
         : '<div class="note">Configuracion completa: todas las claves necesarias estan puestas.</div>'
     }

     <div class="grid two">
       <div class="card">
         <h3>Fuentes en uso</h3>
         <dl class="kv">
           <dt>Solana</dt><dd>${env.hasHelius ? 'Helius (con clave)' : 'RPC publico'}</dd>
           <dt>Base</dt><dd>${env.hasAlchemy ? 'Alchemy (con clave)' : 'RPC publico'}</dd>
           <dt>Basescan</dt><dd>${env.basescanKey ? 'con clave' : 'sin clave'}</dd>
           <dt>Mercado</dt><dd>DexScreener + GeckoTerminal</dd>
           <dt>Seguridad</dt><dd>GoPlus, RugCheck, Honeypot.is</dd>
           <dt>Canales de aviso</dt><dd>${
             activeChannels().length > 0
               ? activeChannels()
                   .map((c) => `<span class="badge green">${escapeHtml(c)}</span>`)
                   .join(' ')
               : '<span class="badge red">ninguno</span>'
           }</dd>
         </dl>
         <div class="dim small" style="margin-top:10px">
           Los avisos se envian por todos los canales configurados a la vez. Si uno falla,
           los demas siguen funcionando.
         </div>
       </div>
       <div class="card">
         <h3>Filtros activos</h3>
         <dl class="kv">
           <dt>Cadenas</dt><dd>${filters.discovery.chains.join(', ')}</dd>
           <dt>Deteccion cada</dt><dd>${filters.discovery.interval_seconds} s</dd>
           <dt>Liquidez</dt><dd>${fmtUsd(filters.prefilter.min_liquidity_usd)} – ${fmtUsd(filters.prefilter.max_liquidity_usd)}</dd>
           <dt>Volumen 24 h min.</dt><dd>${fmtUsd(filters.prefilter.min_volume_h24_usd)}</dd>
           <dt>Antiguedad max.</dt><dd>${filters.prefilter.max_pair_age_hours} h</dd>
           <dt>Analisis por hora</dt><dd>${filters.enrichment.max_per_hour}</dd>
           <dt>Oportunidad min. alerta</dt><dd>${filters.alerts.min_opportunity_score}</dd>
           <dt>Riesgo max. alerta</dt><dd>${filters.alerts.max_risk_score}</dd>
           <dt>Riesgo que veta</dt><dd>${scoring.risk_veto_threshold}</dd>
         </dl>
         <div class="dim small" style="margin-top:10px">
           Se editan en <code>config/filters.yaml</code> y <code>config/scoring.yaml</code>.
           Se recargan solos en menos de un minuto, sin reiniciar.
         </div>
       </div>
     </div>

     <h2>Consumo de APIs (desde el ultimo arranque)</h2>
     <div class="table-wrap">
       <table>
         <thead><tr><th>Servicio</th><th class="num">Llamadas hoy</th><th class="num">Limite diario</th>
           <th class="num">Ritmo</th><th>Estado</th></tr></thead>
         <tbody>${usageRows}</tbody>
       </table>
     </div>

     <h2>Registro de actividad</h2>
     <div class="card">${activityRows}</div>`,
  );
}
