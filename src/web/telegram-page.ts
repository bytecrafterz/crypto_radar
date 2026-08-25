/**
 * Pestana Telegram del panel: que esta viendo el Robot 2.
 *
 * La idea es que se pueda comprobar de un vistazo si el radar de
 * informacion esta aportando algo o no. Por eso lo que manda en la tabla
 * de fuentes no es cuantos tokens menciona cada canal, sino cuantas veces
 * llego ANTES del movimiento: un canal que publica cien tokens cuando ya
 * han subido no vale nada, y aqui se ve.
 */
import { query, queryOne } from '../core/db.js';
import { page } from './layout.js';
import { escapeHtml } from '../core/util.js';

interface Resumen {
  canales: number;
  mensajes: number;
  descartados: number;
  candidatos: number;
  menciones: number;
  tokens: number;
}

interface FilaFuente {
  title: string | null;
  username: string | null;
  mensajes: number;
  menciones: number;
  primeras: number;
  adelantadas: number;
  anticipacion_med: number | null;
}

interface FilaMencion {
  symbol: string | null;
  chain: string;
  address: string;
  canal: string | null;
  posted_at: Date;
  resuelto_por: string;
  es_primera: boolean;
  anticipacion_seg: number | null;
  opportunity: number | null;
  risk: number | null;
}

interface FilaMensaje {
  posted_at: Date;
  canal: string | null;
  text: string | null;
  triage: string | null;
  triage_motivo: string | null;
}

function minutos(seg: number | null): string {
  if (seg === null) return '<span class="dim">pendiente</span>';
  if (seg === 0) return '<span class="dim">sin movimiento</span>';
  const m = Math.round(seg / 60);
  return m > 0
    ? `<span style="color:var(--green)">+${m} min antes</span>`
    : `<span style="color:var(--red)">${Math.abs(m)} min tarde</span>`;
}

export async function renderTelegram(): Promise<string> {
  const resumen =
    (await queryOne<Resumen>(
      `SELECT (SELECT COUNT(*)::int FROM tg_channels WHERE active)                     AS canales,
              (SELECT COUNT(*)::int FROM tg_messages)                                  AS mensajes,
              (SELECT COUNT(*)::int FROM tg_messages WHERE triage = 'descartado')      AS descartados,
              (SELECT COUNT(*)::int FROM tg_messages WHERE triage = 'candidato')       AS candidatos,
              (SELECT COUNT(*)::int FROM tg_mentions)                                  AS menciones,
              (SELECT COUNT(DISTINCT address)::int FROM tg_mentions)                   AS tokens`,
    )) ?? { canales: 0, mensajes: 0, descartados: 0, candidatos: 0, menciones: 0, tokens: 0 };

  const fuentes = await query<FilaFuente>(
    `SELECT c.title, c.username,
            COUNT(DISTINCT m.id)::int                                          AS mensajes,
            COUNT(DISTINCT me.id)::int                                         AS menciones,
            COUNT(*) FILTER (WHERE me.es_primera)::int                         AS primeras,
            COUNT(*) FILTER (WHERE me.anticipacion_seg > 0)::int               AS adelantadas,
            AVG(me.anticipacion_seg) FILTER (WHERE me.anticipacion_seg <> 0)::int AS anticipacion_med
       FROM tg_channels c
       LEFT JOIN tg_messages m ON m.channel_id = c.id
       LEFT JOIN tg_mentions me ON me.channel_id = c.id
      GROUP BY c.id, c.title, c.username
      ORDER BY COUNT(*) FILTER (WHERE me.anticipacion_seg > 0) DESC, COUNT(DISTINCT me.id) DESC
      LIMIT 40`,
  );

  const menciones = await query<FilaMencion>(
    `SELECT t.symbol, me.chain, me.address, c.title AS canal, me.posted_at,
            me.resuelto_por, me.es_primera, me.anticipacion_seg,
            t.last_opportunity AS opportunity, t.last_risk AS risk
       FROM tg_mentions me
       JOIN tg_channels c ON c.id = me.channel_id
       LEFT JOIN tokens t ON t.chain = me.chain AND t.address = me.address
      ORDER BY me.posted_at DESC LIMIT 60`,
  );

  const mensajes = await query<FilaMensaje>(
    `SELECT m.posted_at, c.title AS canal, m.text, m.triage, m.triage_motivo
       FROM tg_messages m JOIN tg_channels c ON c.id = m.channel_id
      ORDER BY m.posted_at DESC LIMIT 40`,
  );

  const pctDescarte =
    resumen.mensajes > 0 ? Math.round((resumen.descartados / resumen.mensajes) * 100) : 0;

  const stat = (etiqueta: string, valor: string | number, pista = '') =>
    `<div class="card stat"><div class="label">${etiqueta}</div>
       <div class="value">${valor}</div>
       ${pista ? `<div class="hint">${pista}</div>` : ''}</div>`;

  const filasFuentes =
    fuentes.length === 0
      ? '<tr><td colspan="6" class="empty">Ningun canal vigilado todavia.</td></tr>'
      : fuentes
          .map((f) => {
            const tasa =
              f.menciones > 0 ? Math.round((f.adelantadas / f.menciones) * 100) : null;
            const color =
              tasa === null ? 'gray' : tasa >= 50 ? 'green' : tasa >= 25 ? 'yellow' : 'red';
            return `<tr>
              <td><b>${escapeHtml(f.title ?? f.username ?? 'sin nombre')}</b></td>
              <td class="num">${f.mensajes}</td>
              <td class="num">${f.menciones}</td>
              <td class="num">${f.primeras}</td>
              <td class="num">${f.adelantadas}</td>
              <td>${tasa === null ? '<span class="dim">sin datos</span>' : `<span class="badge ${color}">${tasa}%</span>`}</td>
            </tr>`;
          })
          .join('');

  const filasMenciones =
    menciones.length === 0
      ? '<tr><td colspan="6" class="empty">Todavia no se ha identificado ningun token.</td></tr>'
      : menciones
          .map(
            (m) => `<tr>
              <td><a href="/token/${m.chain}/${encodeURIComponent(m.address)}"><b>${escapeHtml(m.symbol ?? '?')}</b></a>
                  ${m.es_primera ? '<span class="badge blue">1a vez</span>' : ''}</td>
              <td>${escapeHtml(m.canal ?? '')}</td>
              <td><span class="badge gray">${escapeHtml(m.resuelto_por)}</span></td>
              <td>${minutos(m.anticipacion_seg)}</td>
              <td class="num">${m.opportunity ?? '<span class="dim">-</span>'}</td>
              <td class="num">${m.risk ?? '<span class="dim">-</span>'}</td>
            </tr>`,
          )
          .join('');

  const filasMensajes =
    mensajes.length === 0
      ? '<div class="empty">Sin mensajes todavia.</div>'
      : mensajes
          .map(
            (m) => `<div style="padding:9px 0;border-bottom:1px solid var(--border)">
              <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
                <span class="badge ${m.triage === 'candidato' ? 'green' : 'gray'}">${escapeHtml(m.triage ?? 'pendiente')}</span>
                <span class="dim small">${escapeHtml(m.canal ?? '')}</span>
              </div>
              <div class="small" style="margin-top:4px">${escapeHtml((m.text ?? '').slice(0, 200))}</div>
              <div class="dim small">${escapeHtml(m.triage_motivo ?? '')}</div>
            </div>`,
          )
          .join('');

  return page(
    { title: 'Telegram', active: 'telegram' },
    `<h1>Telegram</h1>
     <p class="sub">Lo que el Robot 2 esta leyendo y que ha sacado en claro.</p>

     <div class="grid stats">
       ${stat('Canales', resumen.canales, 'vigilados ahora')}
       ${stat('Mensajes', resumen.mensajes.toLocaleString('es-ES'), 'guardados en bruto')}
       ${stat('Descartados', `${pctDescarte}%`, 'ruido filtrado')}
       ${stat('Tokens', resumen.tokens, 'identificados')}
     </div>

     <h2>Fuentes</h2>
     <p class="sub small">
       Lo que importa no es cuantos tokens menciona un canal, sino cuantas veces
       llego <b>antes</b> del movimiento. Un canal que publica cuando el precio ya
       subio no esta descubriendo nada.
     </p>
     <div class="table-wrap">
       <table>
         <thead><tr>
           <th>Canal</th><th class="num">Mensajes</th><th class="num">Menciones</th>
           <th class="num">Primero</th><th class="num">Se adelanto</th><th>Acierto</th>
         </tr></thead>
         <tbody>${filasFuentes}</tbody>
       </table>
     </div>

     <h2>Tokens detectados por Telegram</h2>
     <div class="table-wrap">
       <table>
         <thead><tr>
           <th>Token</th><th>Canal</th><th>Como</th>
           <th>Anticipacion</th><th class="num">Oportunidad</th><th class="num">Riesgo</th>
         </tr></thead>
         <tbody>${filasMenciones}</tbody>
       </table>
     </div>

     <div class="grid two" style="margin-top:24px">
       <div class="card">
         <h3>Ultimos mensajes</h3>
         ${filasMensajes}
       </div>
     </div>`,
  );
}
