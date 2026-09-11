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
            c.enviado_at, c.creado_at, c.primera_mencion
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
          <div class="dim small" style="margin-top:3px">
            ${f.fuentes_indep} de ${f.fuentes_total} fuentes independientes ·
            ${anticipacion(f.anticipacion_seg)}
          </div>
        </div>
      </div>
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
         y que hablaran antes de que el precio se moviera. Para <b>Convergencia</b>: oportunidad &ge; <b>${u.tecnicaMinimaNaranja}</b>,
         riesgo &le; <b>${u.riesgoMaximoNaranja}</b> y una fuente. Se ajustan en config/robot3.yaml.`; })()}
       </p>
       <p class="small" style="color:var(--muted);margin:8px 0 0">
         Evaluados hasta ahora: <b>${tot.evaluados}</b> ·
         Con aviso enviado: <b>${tot.avisados}</b>
       </p>
     </div>

     <h2>Veredictos</h2>
     <div class="grid two">${tarjetasVeredictos}</div>`,
  );
}
