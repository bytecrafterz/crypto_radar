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
import { contarFuentes, type MencionFuente } from './fuentes.js';
import { umbralesActuales, avisosPorDia } from './umbrales.js';
import type { Chain } from '../core/types.js';

const log = child('robot3');

/**
 * Tope de avisos de convergencia al dia: config/robot3.yaml, avisos_por_dia.
 *
 * Muy bajo a proposito. Estos avisos son los de maxima prioridad: si
 * llegan varios al dia dejan de significar nada. La especificacion pedia
 * "pocas oportunidades y extremadamente filtradas".
 */

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
 * las que se estan copiando. Como se cuentan esta en fuentes.ts: son
 * canales que publicaron algo por su cuenta, no textos distintos.
 */
async function reunirSenalSocial(chain: string, address: string): Promise<EntradaRobot2 | null> {
  const menciones = await query<MencionFuente>(
    `SELECT me.channel_id AS canal, m.text_hash AS hash, m.id AS mensaje, m.posted_at AS publicado,
            -- Una promocion pagada NO es una fuente independiente por
            -- mucho que venga de otro canal: es el mismo interes pagando
            -- dos veces, y contarla como tal es justo lo que dispara una
            -- alerta en falso.
            --
            -- 'indeterminado' cuenta como no clasificado, no como publicidad.
            -- Es lo que se guarda cuando el modelo no contesta en varios
            -- intentos, y eso pasa por una caida del proveedor, no por algo
            -- que diga el mensaje. Excluirlo hacia que una caida ajena fuera
            -- bajando las fuentes del Robot 3 en silencio: cuanto mas durara
            -- la caida, menos podia converger, sin que nada lo avisara.
            (m.clasificacion IS NULL
              OR m.clasificacion IN ('indeterminado', 'informacion')) AS util
       FROM tg_mentions me
       JOIN tg_messages m ON m.id = me.message_id
      WHERE me.chain = $1 AND me.address = $2`,
    [chain, address],
  );
  if (menciones.length === 0) return null;

  const f = await queryOne<{
    con_informacion: number | null;
    anticipacion: number | null;
    reputacion: number | null;
    tipo: string | null;
  }>(
    `SELECT COUNT(*) FILTER (WHERE m.clasificacion = 'informacion')::int AS con_informacion,
            AVG(me.anticipacion_seg)::int                             AS anticipacion,
            AVG(COALESCE(s.tasa_utiles, 0))::int                      AS reputacion,
            MAX(me.tipo_senal)                                        AS tipo
       FROM tg_mentions me
       JOIN tg_messages m       ON m.id = me.message_id
       LEFT JOIN tg_source_stats s ON s.channel_id = me.channel_id
      WHERE me.chain = $1 AND me.address = $2`,
    [chain, address],
  );
  if (!f) return null;

  const fuentes = contarFuentes(menciones);

  return {
    fuentesTotal: fuentes.total,
    // Si el clasificador esta puesto, solo cuentan los canales que
    // informan. Sin clasificador, clasificacion es NULL y todo es util.
    //
    // OJO CON EL SUELO DE 1
    // Aqui habia un Math.max(1, ...) heredado de cuando no existia el
    // clasificador, y deshacia su trabajo entero: un token del que solo
    // hablaban promociones pagadas se guardaba con UNA fuente
    // independiente en vez de con ninguna, y con eso le bastaba para
    // llegar a "convergencia". Cero fuentes utiles son cero, y ese token
    // no tiene que subir de nivel.
    fuentesIndependientes: fuentes.independientes,
    anticipacionSeg: f.anticipacion,
    reputacionMedia: f.reputacion ?? 0,
    // Ahora si se puede afirmar algo: hay al menos un mensaje que el
    // clasificador dio por informacion comprobable y no por publicidad.
    // Sin clasificador sigue siendo false, que es lo prudente.
    afirmacionVerificada: (f.con_informacion ?? 0) > 0,
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
export function construirAviso(
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
  // Ya se aviso de este token: su veredicto es el registro de lo que se
  // envio y no hay nada mas que decidir.
  const avisado = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM tg_candidatos
      WHERE chain = $1 AND address = $2 AND enviado_at IS NOT NULL`,
    [chain, address],
  );
  if ((avisado?.n ?? 0) > 0) return;

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

  // Los umbrales salen de config/robot3.yaml y se recargan solos: cambiar
  // un numero ahi no exige reiniciar ni tocar codigo.
  const veredicto = decidir(r1, r2, umbralesActuales());

  const primeraMencion = primera?.ts ?? new Date();

  // UN VEREDICTO POR TOKEN
  // La fila se identifica por la primera mencion, y esa fecha puede ir
  // hacia atras: al entrar en un canal se lee su historico, y a veces
  // aparece una mencion mas antigua que la que se conocia. Antes eso
  // creaba una fila nueva y la vieja se quedaba congelada a medias, asi
  // que el mismo token salia dos veces en el panel y con niveles
  // distintos. Ahora la fila que ya habia se mueve a la nueva fecha.
  await exec(
    `UPDATE tg_candidatos SET primera_mencion = $3
      WHERE id = (SELECT id FROM tg_candidatos
                   WHERE chain = $1 AND address = $2 AND enviado_at IS NULL
                   ORDER BY primera_mencion LIMIT 1)
        AND primera_mencion <> $3
        AND NOT EXISTS (SELECT 1 FROM tg_candidatos
                         WHERE chain = $1 AND address = $2 AND primera_mencion = $3)`,
    [chain, address, primeraMencion],
  );

  // Se guarda SIEMPRE, avise o no. Los descartados son justamente lo que
  // hace falta para comprobar mas adelante si el sistema acertaba.
  //
  // AL REEVALUAR SE ACTUALIZA TODO EL VEREDICTO
  // Antes solo se actualizaban algunas columnas, y la fila mezclaba datos
  // de la primera vuelta con los de la ultima: un aviso que decia "12 min
  // antes del movimiento" quedaba guardado sin anticipacion.
  //
  // Y UNA VEZ AVISADO, NO SE TOCA
  // La fila de un token avisado es el registro de lo que se le envio al
  // cliente. Si las vueltas siguientes la reescribian, un aviso de maxima
  // prioridad aparecia luego en el panel como "amarillo", y ya no habia
  // forma de saber que datos lo justificaron. Los avisados ya no llegan
  // hasta aqui (ver el principio); la condicion es una segunda barrera.
  const fila = await queryOne<{ id: number }>(
    `INSERT INTO tg_candidatos
       (chain, address, primera_mencion, fuentes_total, fuentes_indep, anticipacion_seg,
        score_social, score_fuentes, score_evidencia, score_tecnica, score_riesgo,
        vetado, nivel)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (chain, address, primera_mencion) DO UPDATE SET
       fuentes_total    = EXCLUDED.fuentes_total,
       fuentes_indep    = EXCLUDED.fuentes_indep,
       anticipacion_seg = EXCLUDED.anticipacion_seg,
       score_social     = EXCLUDED.score_social,
       score_fuentes    = EXCLUDED.score_fuentes,
       score_evidencia  = EXCLUDED.score_evidencia,
       score_tecnica    = EXCLUDED.score_tecnica,
       score_riesgo     = EXCLUDED.score_riesgo,
       vetado           = EXCLUDED.vetado,
       nivel            = EXCLUDED.nivel
     WHERE tg_candidatos.enviado_at IS NULL
     RETURNING id`,
    [
      chain, address, primeraMencion,
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

  if ((await avisosHoy()) >= avisosPorDia()) {
    log.info({ token: t?.symbol }, 'tope diario de avisos de convergencia alcanzado');
    return;
  }

  const mensaje = construirAviso(
    { chain, address, symbol: t?.symbol ?? null, primeraMencion },
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

const MAXIMO_POR_VUELTA = 300;

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
  //
  // TODOS LOS PENDIENTES, NO SOLO LOS PRIMEROS 40
  // Antes habia un LIMIT 40 sin orden. En cuanto habia mas de 40 tokens
  // con menciones del ultimo dia (al entrar en canales nuevos llegan
  // decenas de golpe), cada vuelta cogia los mismos 40 y el resto no se
  // evaluaba nunca. Evaluar uno son unas pocas consultas: el tope queda
  // solo como freno de seguridad, y se empieza por lo mas reciente.
  const pendientes = await query<{ chain: Chain; address: string }>(
    `SELECT me.chain, me.address
       FROM tg_mentions me
       JOIN tokens t ON t.chain = me.chain AND t.address = me.address
      WHERE me.creado_at > now() - interval '24 hours'
        AND t.enriched_at IS NOT NULL
      GROUP BY me.chain, me.address
      ORDER BY MAX(me.creado_at) DESC
      LIMIT $1`,
    [MAXIMO_POR_VUELTA],
  );
  if (pendientes.length === MAXIMO_POR_VUELTA) {
    log.warn({ tope: MAXIMO_POR_VUELTA }, 'mas tokens pendientes que el tope por vuelta; los mas antiguos esperan');
  }

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
