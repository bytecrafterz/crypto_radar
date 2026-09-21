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
  /** Menciones que de verdad se pudieron comprobar. */
  medibles: number;
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
  anticipacion_veredicto: string | null;
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

function minutos(seg: number | null, veredicto?: string | null): string {
  if (seg === null) return '<span class="dim">pendiente</span>';
  // "No se pudo medir" no es lo mismo que "no se movio". Pasa con las
  // menciones del historico: son de antes de que vigilaramos el token,
  // asi que no habia con que compararlas.
  if (veredicto === 'sin_datos') return '<span class="dim">no se pudo medir</span>';
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
    // Cada tabla se cuenta POR SEPARADO y luego se juntan los resultados.
    //
    // Antes se unian las dos a la vez contra los canales, y eso multiplica
    // una por otra: un canal con 5.000 mensajes y 500 menciones generaba
    // 2.500.000 filas intermedias solo para contarlas. El COUNT(DISTINCT)
    // devolvia el numero correcto, asi que el error no se veia mientras
    // hubo pocos datos; con 56.000 mensajes la pagina dejo de responder.
    `WITH msg AS (
            SELECT channel_id, COUNT(*)::int AS mensajes
              FROM tg_messages GROUP BY channel_id
          ),
          men AS (
            SELECT channel_id,
                   COUNT(*)::int                                              AS menciones,
                   COUNT(*) FILTER (WHERE es_primera)::int                    AS primeras,
                   COUNT(*) FILTER (WHERE anticipacion_seg > 0)::int          AS adelantadas,
                   COUNT(*) FILTER (WHERE anticipacion_veredicto IS NOT NULL
                                      AND anticipacion_veredicto <> 'sin_datos')::int AS medibles,
                   AVG(anticipacion_seg) FILTER (WHERE anticipacion_seg <> 0)::int    AS anticipacion_med
              FROM tg_mentions GROUP BY channel_id
          )
     SELECT c.title, c.username,
            COALESCE(msg.mensajes, 0)    AS mensajes,
            COALESCE(men.menciones, 0)   AS menciones,
            COALESCE(men.primeras, 0)    AS primeras,
            COALESCE(men.adelantadas, 0) AS adelantadas,
            COALESCE(men.medibles, 0)    AS medibles,
            men.anticipacion_med         AS anticipacion_med
       FROM tg_channels c
       LEFT JOIN msg ON msg.channel_id = c.id
       LEFT JOIN men ON men.channel_id = c.id
      ORDER BY COALESCE(men.adelantadas, 0) DESC, COALESCE(men.menciones, 0) DESC
      LIMIT 40`,
  );

  const menciones = await query<FilaMencion>(
    `SELECT t.symbol, me.chain, me.address, c.title AS canal, me.posted_at,
            me.resuelto_por, me.es_primera, me.anticipacion_seg,
            me.anticipacion_veredicto,
            t.last_opportunity AS opportunity, t.last_risk AS risk
       FROM tg_mentions me
       JOIN tg_channels c ON c.id = me.channel_id
       LEFT JOIN tokens t ON t.chain = me.chain AND t.address = me.address
      ORDER BY me.posted_at DESC LIMIT 60`,
  );

  const descubiertos = await query<{
    username: string; title: string; miembros: number | null;
    score: number; estado: string; descubierto_por: string; motivo_score: string;
  }>(
    `SELECT username, title, miembros, score, estado, descubierto_por, motivo_score
       FROM tg_canales_descubiertos
      ORDER BY CASE estado WHEN 'unido' THEN 0 WHEN 'candidato' THEN 1 ELSE 2 END,
               score DESC, miembros DESC NULLS LAST
      LIMIT 30`,
  );

  const porEstado = await query<{ estado: string; n: number }>(
    'SELECT estado, COUNT(*)::int AS n FROM tg_canales_descubiertos GROUP BY estado',
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
            // El acierto se mide sobre lo que se pudo comprobar. Dividir
            // por todas las menciones hundia a los canales por su propio
            // historico, que es imposible de medir.
            const tasa =
              f.medibles > 0 ? Math.round((f.adelantadas / f.medibles) * 100) : null;
            const color =
              tasa === null ? 'gray' : tasa >= 50 ? 'green' : tasa >= 25 ? 'yellow' : 'red';
            return `<tr>
              <td><b>${escapeHtml(f.title ?? f.username ?? 'sin nombre')}</b></td>
              <td class="num">${f.mensajes}</td>
              <td class="num">${f.menciones}</td>
              <td class="num">${f.primeras}</td>
              <td class="num">${f.adelantadas}<span class="dim small"> de ${f.medibles}</span></td>
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
              <td>${minutos(m.anticipacion_seg, m.anticipacion_veredicto)}</td>
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

     <h2>Canales encontrados solo</h2>
     <p class="sub small">
       El sistema busca sus propias fuentes: por palabras clave en tres idiomas,
       por los enlaces que los canales se pasan entre ellos y siguiendo los
       reenvios. Encuentra muchos mas de los que conviene seguir, asi que los
       apunta y solo entra en los mejores, como maximo tres al dia.
     </p>
     <div class="grid stats" style="margin-bottom:14px">
       ${['unido', 'candidato', 'rechazado', 'abandonado']
         .map((e) => {
           const f = porEstado.find((x) => x.estado === e);
           const etq = { unido: 'Dentro', candidato: 'Localizados', rechazado: 'Descartados', abandonado: 'Abandonados' }[e];
           return `<div class="card stat"><div class="label">${etq}</div>
                   <div class="value">${f?.n ?? 0}</div></div>`;
         })
         .join('')}
     </div>
     <div class="table-wrap">
       <table>
         <thead><tr>
           <th>Canal</th><th class="num">Miembros</th><th class="num">Nota</th>
           <th>Como se encontro</th><th>Estado</th>
         </tr></thead>
         <tbody>${
           descubiertos.length === 0
             ? '<tr><td colspan="5" class="empty">Todavia no ha encontrado ninguno.</td></tr>'
             : descubiertos
                 .map((d) => {
                   const color = d.estado === 'unido' ? 'green'
                     : d.estado === 'candidato' ? 'blue'
                     : d.estado === 'abandonado' ? 'yellow' : 'gray';
                   return `<tr>
                     <td><b>@${escapeHtml(d.username ?? '')}</b>
                         <div class="dim small">${escapeHtml((d.title ?? '').slice(0, 34))}</div></td>
                     <td class="num">${d.miembros ? d.miembros.toLocaleString('es-ES') : '<span class="dim">?</span>'}</td>
                     <td class="num">${d.score}</td>
                     <td class="small">${escapeHtml(d.descubierto_por)}
                         <div class="dim small">${escapeHtml((d.motivo_score ?? '').slice(0, 40))}</div></td>
                     <td><span class="badge ${color}">${escapeHtml(d.estado)}</span></td>
                   </tr>`;
                 })
                 .join('')
         }</tbody>
       </table>
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
