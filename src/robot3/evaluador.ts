/**
 * Robot 3: la pieza que junta todo y decide si avisar.
 *
 * QUE FALTABA
 * El motor de convergencia estaba escrito y probado, pero nadie lo
 * llamaba: el colector preguntaba al Robot 1 y no hacia nada con la
 * respuesta. Este fichero es el que cierra el circuito.
 *
 * QUE HACE
 * Cuando el Robot 2 identifica un token, aqui se reune todo lo que se
 * sabe de el por los dos lados, se pide el veredicto al motor de
 * convergencia y, solo si el nivel es el mas alto, se envia un aviso.
 *
 * LA ALERTA VA EN ESPANOL aunque el mensaje original estuviera en ingles
 * o portugues, que es lo que pedia la especificacion.
 */
import { query, queryOne, exec } from '../core/db.js';
import { child } from '../core/logger.js';
import { notify } from '../worker/notify.js';
import { decidir, type EntradaRobot1, type EntradaRobot2 } from './convergencia.js';
import type { Chain } from '../core/types.js';

const log = child('robot3');

/**
 * Tope de avisos de convergencia al dia.
 *
 * Muy bajo a proposito. Estos avisos son los de maxima prioridad: si
 * llegan varios al dia dejan de significar nada. La especificacion pedia
 * "pocas oportunidades y extremadamente filtradas".
 */
const MAX_AVISOS_DIA = 3;

interface DatosMencion {
  chain: Chain;
  address: string;
  symbol: string | null;
  primeraMencion: Date;
}

/**
 * Reune lo que sabe el Robot 2 sobre un token.
 *
 * La parte importante es distinguir fuentes de verdad independientes de
 * las que se estan copiando: se agrupan por el hash del texto
 * normalizado, asi que cinco canales publicando lo mismo cuentan como
 * uno solo.
 */
async function reunirSenalSocial(chain: string, address: string): Promise<EntradaRobot2 | null> {
  const f = await queryOne<{
    fuentes_total: number;
    fuentes_indep: number;
    anticipacion: number | null;
    reputacion: number | null;
    tipo: string | null;
  }>(
    `SELECT COUNT(DISTINCT me.channel_id)::int                        AS fuentes_total,
            -- Textos distintos = fuentes que no se estan copiando
            COUNT(DISTINCT m.text_hash)::int                          AS fuentes_indep,
            AVG(me.anticipacion_seg)::int                             AS anticipacion,
            AVG(COALESCE(s.tasa_utiles, 0))::int                      AS reputacion,
            MAX(me.tipo_senal)                                        AS tipo
       FROM tg_mentions me
       JOIN tg_messages m       ON m.id = me.message_id
       LEFT JOIN tg_source_stats s ON s.channel_id = me.channel_id
      WHERE me.chain = $1 AND me.address = $2`,
    [chain, address],
  );

  if (!f || f.fuentes_total === 0) return null;

  return {
    fuentesTotal: f.fuentes_total,
    fuentesIndependientes: Math.max(1, f.fuentes_indep),
    anticipacionSeg: f.anticipacion,
    reputacionMedia: f.reputacion ?? 0,
    // Sin el clasificador por modelo no se puede afirmar que algo se ha
    // verificado. Se deja en false a proposito: es mejor quedarse corto
    // que dar por comprobado lo que no lo esta.
    afirmacionVerificada: false,
    tipoSenal: f.tipo ?? 'general',
  };
}

/** Lo que dice el Robot 1, leido de lo que ya guardo al analizar. */
async function reunirSenalTecnica(chain: string, address: string): Promise<EntradaRobot1 | null> {
  const t = await queryOne<{
    id: number;
    symbol: string | null;
    last_opportunity: number | null;
    last_risk: number | null;
    enriched_at: Date | null;
  }>(
    `SELECT id, symbol, last_opportunity, last_risk, enriched_at
       FROM tokens WHERE chain = $1 AND address = $2`,
    [chain, address],
  );

  if (!t?.enriched_at || t.last_opportunity === null || t.last_risk === null) return null;

  // La tabla es 'scores' y los vetos vienen como JSON con {code, text}.
  const s = await queryOne<{
    vetoed: boolean;
    evaluable: boolean | null;
    critical_vetoes: Array<{ code: string; text: string }> | null;
  }>(
    `SELECT vetoed, evaluable, critical_vetoes
       FROM scores WHERE token_id = $1 ORDER BY ts DESC LIMIT 1`,
    [t.id],
  );

  const riesgos = await query<{ detail: string }>(
    `SELECT detail FROM suspicious_events
      WHERE token_id = $1 AND severity IN ('danger','warn')
      ORDER BY ts DESC LIMIT 4`,
    [t.id],
  );

  return {
    opportunity: Number(t.last_opportunity),
    risk: Number(t.last_risk),
    vetoed: s?.vetoed ?? false,
    evaluable: s?.evaluable ?? true,
    vetos: (s?.critical_vetoes ?? []).map((v) => v.text),
    motivosRiesgo: riesgos.map((r) => r.detail),
  };
}

/** Cuantos avisos de convergencia se han mandado hoy. */
async function avisosHoy(): Promise<number> {
  const f = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM tg_candidatos
      WHERE enviado_at >= date_trunc('day', now())`,
  );
  return f?.n ?? 0;
}

/** Construye el aviso, en espanol, sea cual sea el idioma original. */
function construirAviso(
  d: DatosMencion,
  r1: EntradaRobot1,
  r2: EntradaRobot2,
  v: ReturnType<typeof decidir>,
): string {
  const enlace =
    d.chain === 'solana'
      ? `https://jup.ag/swap/SOL-${d.address}`
      : `https://app.uniswap.org/swap?chain=base&outputCurrency=${d.address}`;

  const anticipacion =
    r2.anticipacionSeg && r2.anticipacionSeg > 0
      ? `${Math.round(r2.anticipacionSeg / 60)} min antes del movimiento`
      : 'sin medir todavia';

  return [
    `🚨 <b>ALTA CONVERGENCIA · ${d.symbol ?? '?'}</b>`,
    `${d.chain === 'solana' ? 'Solana' : 'Base'}`,
    '',
    '<b>Lo que dice Telegram</b>',
    `${r2.fuentesIndependientes} fuente(s) independiente(s) de ${r2.fuentesTotal} en total`,
    `La informacion aparecio ${anticipacion}`,
    '',
    '<b>Lo que dicen los datos</b>',
    `Oportunidad ${r1.opportunity}/100   Riesgo ${r1.risk}/100`,
    ...(r1.motivosRiesgo.length > 0
      ? ['', '<b>Riesgos detectados</b>', ...r1.motivosRiesgo.slice(0, 3).map((m) => `• ${m}`)]
      : []),
    '',
    '<b>Por que se avisa</b>',
    ...v.explicacion.map((e) => `• ${e}`),
    '',
    `👉 <b><a href="${enlace}">COMPRAR ESTE TOKEN</a></b>`,
    '<i>Este enlace lleva la direccion correcta. No busques el token por su nombre.</i>',
    '',
    `<code>${d.address}</code>`,
    '',
    '<i>Esto es informacion, no una recomendacion de compra.</i>',
  ].join('\n');
}

/**
 * Evalua un token del que Telegram ha hablado y decide si avisar.
 */
export async function evaluar(chain: Chain, address: string): Promise<void> {
  const r2 = await reunirSenalSocial(chain, address);
  if (!r2) return;

  const r1 = await reunirSenalTecnica(chain, address);
  // Sin analisis del Robot 1 no hay nada que cruzar. No se avisa: la
  // mitad de la informacion no es informacion.
  if (!r1) return;

  const t = await queryOne<{ symbol: string | null }>(
    'SELECT symbol FROM tokens WHERE chain = $1 AND address = $2',
    [chain, address],
  );
  const primera = await queryOne<{ ts: Date }>(
    'SELECT MIN(posted_at) AS ts FROM tg_mentions WHERE chain = $1 AND address = $2',
    [chain, address],
  );

  const veredicto = decidir(r1, r2);

  // Se guarda SIEMPRE, avise o no. Los descartados son justamente lo que
  // hace falta para comprobar mas adelante si el sistema acertaba.
  const fila = await queryOne<{ id: number; ya: boolean }>(
    `INSERT INTO tg_candidatos
       (chain, address, primera_mencion, fuentes_total, fuentes_indep, anticipacion_seg,
        score_social, score_fuentes, score_evidencia, score_tecnica, score_riesgo,
        vetado, nivel)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (chain, address, primera_mencion) DO UPDATE SET
       fuentes_total = EXCLUDED.fuentes_total,
       fuentes_indep = EXCLUDED.fuentes_indep,
       score_tecnica = EXCLUDED.score_tecnica,
       score_riesgo  = EXCLUDED.score_riesgo,
       nivel         = EXCLUDED.nivel
     RETURNING id, (xmax <> 0) AS ya`,
    [
      chain, address, primera?.ts ?? new Date(),
      r2.fuentesTotal, r2.fuentesIndependientes, r2.anticipacionSeg,
      // Las notas del Robot 1 llevan decimales (54.5, 7.4) y estas
      // columnas son enteras: sin redondear, PostgreSQL rechaza la fila
      // entera y el veredicto se perdia sin dejar rastro.
      Math.round(veredicto.componentes.social),
      Math.round(veredicto.componentes.fuentes),
      Math.round(veredicto.componentes.evidencia),
      Math.round(veredicto.componentes.tecnica),
      Math.round(veredicto.componentes.riesgo),
      r1.vetoed, veredicto.nivel,
    ],
  );

  if (veredicto.nivel !== 'rojo') {
    log.debug({ token: t?.symbol, nivel: veredicto.nivel }, 'sin nivel suficiente para avisar');
    return;
  }

  // Ya se aviso de este token antes: no se repite.
  if (!fila || fila.ya) {
    const yaEnviado = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM tg_candidatos
        WHERE chain = $1 AND address = $2 AND enviado_at IS NOT NULL`,
      [chain, address],
    );
    if ((yaEnviado?.n ?? 0) > 0) return;
  }

  if ((await avisosHoy()) >= MAX_AVISOS_DIA) {
    log.info({ token: t?.symbol }, 'tope diario de avisos de convergencia alcanzado');
    return;
  }

  const mensaje = construirAviso(
    { chain, address, symbol: t?.symbol ?? null, primeraMencion: primera?.ts ?? new Date() },
    r1, r2, veredicto,
  );

  const res = await notify(mensaje, {
    subject: `Alta convergencia · ${t?.symbol ?? address.slice(0, 8)}`,
  });

  if (res.ok && fila) {
    await exec('UPDATE tg_candidatos SET enviado_at = now() WHERE id = $1', [fila.id]);
    log.info(
      { token: t?.symbol, fuentes: r2.fuentesIndependientes, oportunidad: r1.opportunity },
      'aviso de alta convergencia enviado',
    );
  }
}

/**
 * Repasa los tokens mencionados recientemente y evalua los que aun no
 * tienen veredicto. Se ejecuta periodicamente en vez de al momento,
 * porque hace falta que el Robot 1 haya terminado su analisis primero.
 */
export async function runRobot3(): Promise<number> {
  // OJO CON QUE FECHA SE FILTRA
  // Se usa creado_at (cuando lo registramos nosotros), NO posted_at
  // (cuando se escribio el mensaje). Al entrar en un canal se lee su
  // historico, asi que llegan mensajes de hace dias: filtrando por
  // posted_at quedaban todos fuera de la ventana y no se evaluaba nada,
  // aunque acabaramos de recogerlos.
  const pendientes = await query<{ chain: Chain; address: string }>(
    `SELECT DISTINCT me.chain, me.address
       FROM tg_mentions me
       JOIN tokens t ON t.chain = me.chain AND t.address = me.address
      WHERE me.creado_at > now() - interval '24 hours'
        AND t.enriched_at IS NOT NULL
      LIMIT 40`,
  );

  let fallos = 0;
  for (const p of pendientes) {
    await evaluar(p.chain, p.address).catch((err) => {
      fallos++;
      log.warn({ err: err instanceof Error ? err.message : String(err) }, 'fallo evaluando');
    });
  }

  // Se deja constancia de cada vuelta con trabajo. Sin esto el Robot 3
  // solo se hacia notar cuando enviaba un aviso, y era imposible saber
  // desde fuera si estaba funcionando o parado en silencio.
  if (pendientes.length > 0) {
    log.info({ evaluados: pendientes.length, fallos }, 'vuelta de convergencia');
  }

  return pendientes.length;
}
