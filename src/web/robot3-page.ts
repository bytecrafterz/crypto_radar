/**
 * Pestana Convergencia: lo que decide el Robot 3.
 *
 * LO IMPORTANTE DE ESTA PAGINA
 * No hay una nota unica. Cada veredicto se muestra con sus componentes
 * separadas a proposito, porque el sentido del Robot 3 es que se pueda
 * ver POR QUE se llego a la conclusion: si el token es bueno y ademas
 * hay informacion, o si es malo pero hay mucho ruido alrededor.
 *
 * Un numero unico escondería justo eso. Un token con 90 de social y 100
 * de riesgo no es un "60 regular": es un descarte con mucho ruido, y hay
 * que poder distinguirlo de un token mediocre del que nadie habla.
 */
import { query, queryOne } from '../core/db.js';
import { umbralesActuales } from '../robot3/umbrales.js';
import { page } from './layout.js';
import { escapeHtml } from '../core/util.js';

interface Fila {
  chain: string;
  address: string;
  symbol: string | null;
  nivel: string;
  fuentes_total: number;
  fuentes_indep: number;
  anticipacion_seg: number | null;
  score_social: number;
  score_fuentes: number;
  score_evidencia: number;
  score_tecnica: number;
  score_riesgo: number;
  vetado: boolean;
  enviado_at: Date | null;
  creado_at: Date;
  primera_mencion: Date;
  detalle: {
    motivo?: string;
    contradicciones?: string[];
    confirmaciones?: string[];
    resumenes?: Array<{ texto: string; canal: string | null; clase: string | null }>;
  } | null;
  historial: Array<{ ts: string; nivel: string; nivel_antes: string | null }> | null;
  en_seguimiento: boolean | null;
  precio_inicial: number | null;
  precio_actual: number | null;
}

/** Hace cuanto, en palabras. */
function haceCuanto(ts: string | Date): string {
  const min = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60_000));
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} dias`;
}

const COLOR: Record<string, string> = {
  rojo: 'red', naranja: 'yellow', amarillo: 'blue', descartado: 'gray',
};

const ETIQUETA: Record<string, string> = {
  rojo: 'Convergencia fuerte',
  naranja: 'Convergencia',
  amarillo: 'Seguimiento',
  descartado: 'Descartado',
};

/** Barra de una componente. Se ve la nota y su peso de un vistazo. */
function barra(etq: string, valor: number, invertir = false): string {
  const v = Math.max(0, Math.min(100, valor));
  const color = invertir
    ? v >= 70 ? 'var(--red)' : v >= 40 ? 'var(--yellow)' : 'var(--green)'
    : v >= 70 ? 'var(--green)' : v >= 40 ? 'var(--yellow)' : 'var(--muted)';
  return `<div style="margin-bottom:5px">
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--muted)">
      <span>${etq}</span><span style="color:var(--text)">${v}</span></div>
    <div style="height:4px;background:var(--border);border-radius:2px;overflow:hidden">
      <div style="height:100%;width:${v}%;background:${color}"></div></div>
  </div>`;
}

function anticipacion(seg: number | null): string {
  if (seg === null) return '<span class="dim">sin medir</span>';
  if (seg === 0) return '<span class="dim">sin movimiento</span>';
  const m = Math.round(seg / 60);
  return m > 0
    ? `<span style="color:var(--green)">se adelanto ${m} min</span>`
    : `<span style="color:var(--red)">llego ${Math.abs(m)} min tarde</span>`;
}

export async function renderRobot3(): Promise<string> {
  const filas = await query<Fila>(
    `SELECT c.chain, c.address, t.symbol, c.nivel,
            c.fuentes_total, c.fuentes_indep, c.anticipacion_seg,
            c.score_social, c.score_fuentes, c.score_evidencia,
            c.score_tecnica, c.score_riesgo, c.vetado,
            c.enviado_at, c.creado_at, c.primera_mencion, c.detalle,
            (SELECT json_agg(json_build_object('ts', h.ts, 'nivel', h.nivel, 'nivel_antes', h.nivel_antes)
                             ORDER BY h.ts)
               FROM tg_candidatos_historial h WHERE h.candidato_id = c.id) AS historial,
            (SELECT h.precio_usd FROM tg_candidatos_historial h
              WHERE h.candidato_id = c.id AND h.precio_usd IS NOT NULL
              ORDER BY h.ts LIMIT 1) AS precio_inicial,
            t.last_price_usd AS precio_actual,
            t.tracked_until > now() AS en_seguimiento
       FROM tg_candidatos c
       LEFT JOIN tokens t ON t.chain = c.chain AND t.address = c.address
      ORDER BY CASE c.nivel WHEN 'rojo' THEN 0 WHEN 'naranja' THEN 1
                            WHEN 'amarillo' THEN 2 ELSE 3 END,
               c.creado_at DESC
      LIMIT 60`,
  );

  const porNivel = await query<{ nivel: string; n: number }>(
    'SELECT nivel, COUNT(*)::int AS n FROM tg_candidatos GROUP BY nivel',
  );

  const tot =
    (await queryOne<{ evaluados: number; avisados: number }>(
      `SELECT COUNT(*)::int AS evaluados,
              COUNT(*) FILTER (WHERE enviado_at IS NOT NULL)::int AS avisados
         FROM tg_candidatos`,
    )) ?? { evaluados: 0, avisados: 0 };

  const cuenta = (n: string) => porNivel.find((x) => x.nivel === n)?.n ?? 0;

  /** Como ha ido cambiando el nivel y el precio desde el primer veredicto. */
  const evolucion = (f: Fila): string => {
    const partes: string[] = [];
    const h = f.historial ?? [];
    if (h.length > 1) {
      partes.push(
        h.slice(-3).map((x) => `${ETIQUETA[x.nivel] ?? x.nivel} <span class="dim">(${haceCuanto(x.ts)})</span>`)
          .join(' &rarr; '),
      );
    }
    if (f.precio_inicial && f.precio_actual) {
      const pct = ((Number(f.precio_actual) - Number(f.precio_inicial)) / Number(f.precio_inicial)) * 100;
      const color = pct >= 0 ? 'var(--green)' : 'var(--red)';
      partes.push(`precio desde el veredicto: <b style="color:${color}">${pct >= 0 ? '+' : ''}${pct.toFixed(0)}%</b>`);
    }
    return partes.length ? `<div class="small" style="margin-top:3px">${partes.join(' · ')}</div>` : '';
  };

  /** Lo que dijeron los mensajes, en espanol, y lo que se comprobo en la cadena. */
  const razonamiento = (f: Fila): string => {
    const d = f.detalle;
    if (!d) return '';
    const res = (d.resumenes ?? []).slice(0, 2)
      .map((r) => `<div class="small">&ldquo;${escapeHtml(r.texto)}&rdquo;
                     <span class="dim">${r.canal ? '@' + escapeHtml(r.canal) : ''}${r.clase ? ' · ' + escapeHtml(r.clase) : ''}</span></div>`)
      .join('');
    const ok = (d.confirmaciones ?? []).map((c) => `<div class="small" style="color:var(--green)">&#10003; ${escapeHtml(c)}</div>`).join('');
    const mal = (d.contradicciones ?? []).map((c) => `<div class="small" style="color:var(--red)">&#10007; ${escapeHtml(c)}</div>`).join('');
    if (!res && !ok && !mal) return '';
    return `<div style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)">
      ${res ? `<div class="dim small" style="margin-bottom:3px">Lo que dicen los mensajes</div>${res}` : ''}
      ${ok || mal ? `<div class="dim small" style="margin:6px 0 3px">Comprobado contra la cadena</div>${ok}${mal}` : ''}
    </div>`;
  };

  const tarjetas = ['rojo', 'naranja', 'amarillo', 'descartado']
    .map(
      (n) => `<div class="card stat">
        <div class="label">${ETIQUETA[n]}</div>
        <div class="value" style="color:var(--${COLOR[n] === 'blue' ? 'blue' : COLOR[n] === 'gray' ? 'muted' : COLOR[n]})">${cuenta(n)}</div>
      </div>`,
    )
    .join('');

  const tarjetasVeredictos =
    filas.length === 0
      ? `<div class="card"><div class="empty">
           Todavia no hay ningun veredicto. El Robot 3 necesita que un mismo
           token aparezca en Telegram <b>y</b> haya sido analizado por el
           Robot 1; hasta que las dos cosas coinciden, no hay nada que cruzar.
         </div></div>`
      : filas
          .map((f) => {
            const c = COLOR[f.nivel] ?? 'gray';
            return `<div class="card" style="border-left:3px solid var(--${c === 'gray' ? 'border' : c})">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap">
        <div style="min-width:0">
          <a href="/token/${f.chain}/${encodeURIComponent(f.address)}">
            <b style="font-size:15px">${escapeHtml(f.symbol ?? '?')}</b></a>
          <span class="badge ${c}">${ETIQUETA[f.nivel] ?? f.nivel}</span>
          ${f.vetado ? '<span class="badge red">vetado</span>' : ''}
          ${f.enviado_at ? '<span class="badge green">avisado</span>' : ''}
          ${f.en_seguimiento && !f.enviado_at && f.nivel !== 'descartado'
            ? '<span class="badge blue">en seguimiento</span>' : ''}
          <div class="dim small" style="margin-top:3px">
            ${f.fuentes_indep} de ${f.fuentes_total} fuentes independientes ·
            ${anticipacion(f.anticipacion_seg)}
          </div>
          ${evolucion(f)}
        </div>
      </div>
      ${razonamiento(f)}
      <div class="grid two" style="margin-top:10px;gap:14px">
        <div>
          <div class="dim small" style="margin-bottom:5px">Lo que dicen los datos (Robot 1)</div>
          ${barra('Oportunidad', f.score_tecnica)}
          ${barra('Riesgo', f.score_riesgo, true)}
        </div>
        <div>
          <div class="dim small" style="margin-bottom:5px">Lo que dice la calle (Robot 2)</div>
          ${barra('Senal social (incluye independencia)', f.score_social)}
          ${barra('Reputacion de las fuentes', f.score_fuentes)}
          ${barra('Evidencia', f.score_evidencia)}
        </div>
      </div>
    </div>`;
          })
          .join('');

  return page(
    { title: 'Convergencia', active: 'convergencia' },
    `<h1>Convergencia</h1>
     <p class="sub">
       El Robot 3 cruza las dos lecturas: lo que dicen los datos de la cadena
       y lo que se esta diciendo en Telegram. Solo avisa cuando <b>coinciden</b>.
     </p>

     <div class="grid stats">${tarjetas}</div>

     <div class="card" style="margin:16px 0">
       <h3>Como decide</h3>
       <p class="small" style="color:var(--muted);margin:6px 0 0">
         Las dos notas nunca se suman en una sola. Un token con mucho ruido en
         Telegram y un contrato peligroso no es "medio bueno": es un descarte,
         y aqui se ve separado para que se entienda por que.
         <b>El veto del Robot 1 manda siempre</b>: si el token no se puede
         vender, da igual cuanta gente hable de el.
       </p>
       <p class="small" style="color:var(--muted);margin:8px 0 0">
         ${(() => { const u = umbralesActuales(); return `Para <b>Convergencia fuerte</b>, el unico nivel que avisa, hacen falta a la vez:
         oportunidad &ge; <b>${u.tecnicaMinimaRojo}</b>, riesgo &le; <b>${u.riesgoMaximoRojo}</b>,
         al menos <b>${u.fuentesIndepMinimasRojo}</b> fuentes que no se copien entre si con reputacion &ge; <b>${u.reputacionMinimaRojo}</b>,
         que hablaran antes de que el precio se moviera, y que la cadena no desmienta nada de lo que afirman.
         Para <b>Convergencia</b>: oportunidad &ge; <b>${u.tecnicaMinimaNaranja}</b>,
         riesgo &le; <b>${u.riesgoMaximoNaranja}</b> y una fuente. Se ajustan en config/robot3.yaml.`; })()}
       </p>
       <p class="small" style="color:var(--muted);margin:8px 0 0">
         Evaluados hasta ahora: <b>${tot.evaluados}</b> ·
         Con aviso enviado: <b>${tot.avisados}</b> ·
         <a href="/resultados#robot3">Cuanto acierta cada nivel</a>
       </p>
     </div>

     <h2>Veredictos</h2>
     <div class="grid two">${tarjetasVeredictos}</div>`,
  );
}

/**
 * Cuanto acierta el Robot 3, para la pagina de Resultados.
 *
 * La especificacion pide decidir que oportunidades merecen atencion. Sin
 * medir que paso despues con cada una, no hay forma de saber si el Robot 3
 * decide bien o solo lo parece. Aqui se mira, para cada nivel, que hizo el
 * precio en las 24 horas siguientes a que el token llegara a ese nivel.
 *
 * Y una segunda prueba, la que pedia el plan desde el principio: entre los
 * tokens ya cerrados, ¿salen mejor los que se mencionaron en Telegram que
 * los que no?
 */
export async function renderAciertoRobot3(): Promise<string> {
  const porNivel = await query<{
    nivel: string; n: number; mediana_max: number | null; suben50: number; caen50: number;
  }>(
    `WITH entradas AS (
       SELECT DISTINCT ON (h.candidato_id, h.nivel)
              h.candidato_id, h.nivel, h.ts, h.precio_usd, t.id AS token_id
         FROM tg_candidatos_historial h
         JOIN tg_candidatos c ON c.id = h.candidato_id
         JOIN tokens t ON t.chain = c.chain AND t.address = c.address
        WHERE h.precio_usd > 0 AND h.ts < now() - interval '24 hours'
        ORDER BY h.candidato_id, h.nivel, h.ts
     ),
     res AS (
       SELECT e.nivel, e.precio_usd,
              (SELECT MAX(s.price_usd) FROM token_snapshots s
                WHERE s.token_id = e.token_id AND s.ts > e.ts AND s.ts <= e.ts + interval '24 hours') AS maximo,
              (SELECT MIN(s.price_usd) FROM token_snapshots s
                WHERE s.token_id = e.token_id AND s.ts > e.ts AND s.ts <= e.ts + interval '24 hours') AS minimo
         FROM entradas e
     )
     SELECT nivel, COUNT(*)::int AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY (maximo / precio_usd - 1) * 100) AS mediana_max,
            COUNT(*) FILTER (WHERE maximo >= precio_usd * 1.5)::int AS suben50,
            COUNT(*) FILTER (WHERE minimo <= precio_usd * 0.5)::int AS caen50
       FROM res WHERE maximo IS NOT NULL
      GROUP BY nivel`,
  );

  const grupos = await query<{
    con_telegram: boolean; n: number; exitos: number; rugs: number; pico_medio: number | null;
  }>(
    `SELECT EXISTS (SELECT 1 FROM tg_mentions me
                     WHERE me.chain = t.chain AND me.address = t.address) AS con_telegram,
            COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE o.outcome = 'exito')::int AS exitos,
            COUNT(*) FILTER (WHERE o.outcome = 'rug')::int AS rugs,
            AVG(o.peak_multiple) AS pico_medio
       FROM token_outcomes o JOIN tokens t ON t.id = o.token_id
      GROUP BY 1`,
  );

  const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '-');

  const filasNivel = ['rojo', 'naranja', 'amarillo', 'descartado']
    .map((n) => {
      const f = porNivel.find((x) => x.nivel === n);
      if (!f) {
        return `<tr><td><span class="badge ${COLOR[n]}">${ETIQUETA[n]}</span></td>
          <td class="num dim" colspan="4">sin datos todavia</td></tr>`;
      }
      return `<tr>
        <td><span class="badge ${COLOR[n]}">${ETIQUETA[n]}</span></td>
        <td class="num">${f.n}</td>
        <td class="num">${f.mediana_max !== null ? `${Number(f.mediana_max) >= 0 ? '+' : ''}${Number(f.mediana_max).toFixed(0)}%` : '-'}</td>
        <td class="num" style="color:var(--green)">${pct(f.suben50, f.n)}</td>
        <td class="num" style="color:var(--red)">${pct(f.caen50, f.n)}</td>
      </tr>`;
    })
    .join('');

  const filasGrupo = [true, false]
    .map((tg) => {
      const g = grupos.find((x) => x.con_telegram === tg);
      const nombre = tg ? 'Mencionados en Telegram' : 'Sin mencion en Telegram';
      if (!g) return `<tr><td>${nombre}</td><td class="num dim" colspan="4">sin datos</td></tr>`;
      return `<tr>
        <td><b>${nombre}</b></td>
        <td class="num">${g.n}</td>
        <td class="num" style="color:var(--green)">${pct(g.exitos, g.n)}</td>
        <td class="num" style="color:var(--red)">${pct(g.rugs, g.n)}</td>
        <td class="num">${g.pico_medio !== null ? `${Number(g.pico_medio).toFixed(2)}x` : '-'}</td>
      </tr>`;
    })
    .join('');

  return `<h2 id="robot3">¿Acierta el Robot 3?</h2>
     <p class="sub small">Que hizo el precio en las 24 horas siguientes a que un token llegara a cada nivel.
        Si el Robot 3 decide bien, los niveles altos tienen que subir mas y hundirse menos que los descartados.
        Se mide desde que existe el seguimiento de niveles, asi que los numeros crecen con los dias.</p>
     <div class="table-wrap">
       <table>
         <thead><tr><th>Nivel</th><th class="num">Tokens</th><th class="num">Subida maxima (mediana)</th>
           <th class="num">Llegan a +50%</th><th class="num">Caen a la mitad</th></tr></thead>
         <tbody>${filasNivel}</tbody>
       </table>
     </div>

     <h3 style="margin-top:18px">¿Salen mejor los tokens de los que habla Telegram?</h3>
     <p class="sub small">Entre los tokens ya cerrados por el seguimiento del Robot 1.</p>
     <div class="table-wrap">
       <table>
         <thead><tr><th>Grupo</th><th class="num">Tokens</th><th class="num">Exitos</th>
           <th class="num">Rugs</th><th class="num">Pico medio</th></tr></thead>
         <tbody>${filasGrupo}</tbody>
       </table>
     </div>`;
}
