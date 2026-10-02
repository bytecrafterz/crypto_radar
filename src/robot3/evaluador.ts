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
 * sabe de el por los dos lados, se comprueba que lo que dicen los
 * mensajes cuadra con la cadena, se pide el veredicto al motor de
 * convergencia y, solo si el nivel es el mas alto, se envia un aviso.
 * Mientras el token siga vigilado, el veredicto se revisa y cada cambio de
 * nivel queda apuntado.
 *
 * LA ALERTA VA EN ESPANOL aunque el mensaje original estuviera en ingles
 * o portugues, que es lo que pedia la especificacion: lo que dice
 * Telegram llega resumido en espanol.
 */
import { query, queryOne, exec } from '../core/db.js';
import { child } from '../core/logger.js';
import { notify } from '../worker/notify.js';
import { isPaused } from '../worker/telegram.js';
import { saveAlert } from '../core/repo.js';
import { escapeHtml } from '../core/util.js';
import { decidir, describirAnticipacion, type EntradaRobot1, type EntradaRobot2 } from './convergencia.js';
import { verificarCoherencia, type HechosCadena } from './coherencia.js';
import { contarFuentes, type MencionFuente } from './fuentes.js';
import { umbralesActuales, avisosPorDia } from './umbrales.js';
import { AFIRMACIONES, type Afirmacion } from '../telegram/clasificador.js';
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

/** Lo que dice un mensaje, resumido en espanol. */
export interface ResumenMensaje {
  texto: string;
  canal: string | null;
  clase: string | null;
}

/**
 * Tipo de senal que manda cuando los mensajes dicen cosas distintas.
 * Un aviso negativo va por delante de todo; antes se cogia el "mayor"
 * por orden alfabetico, y "whale" le ganaba a "negativo".
 */
const PRIORIDAD_TIPO = ['negativo', 'listing', 'lanzamiento', 'partnership', 'whale', 'llamada', 'general'];

/**
 * Reune lo que sabe el Robot 2 sobre un token.
 *
 * La parte importante es distinguir fuentes de verdad independientes de
 * las que se estan copiando. Como se cuentan esta en fuentes.ts: son
 * canales que publicaron algo por su cuenta, no textos distintos.
 */
async function reunirSenalSocial(
  chain: string,
  address: string,
): Promise<{ r2: EntradaRobot2; afirmaciones: Afirmacion[]; resumenes: ResumenMensaje[] } | null> {
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
    anticipacion: number | null;
    reputacion: number | null;
    tipos: string[] | null;
    afirmaciones: string[] | null;
  }>(
    `SELECT -- Solo las menciones tras las que hubo movimiento. "No se
            -- movio" y "sin datos" se guardaban como 0 segundos, y ese 0
            -- puntuaba como la anticipacion perfecta.
            AVG(me.anticipacion_seg) FILTER (
              WHERE me.anticipacion_veredicto IN ('se_adelanto', 'reacciono'))::int AS anticipacion,
            -- Media por CANAL y solo de los que tienen historial medido.
            -- Antes era por mencion y con los no medidos a 0: un canal que
            -- repetia el token diez veces pesaba diez veces mas, y uno
            -- recien llegado hundia la media de los que si acertaban. Si
            -- ninguno tiene historial, la reputacion es 0: sin pruebas no
            -- se confia.
            (SELECT AVG(s.tasa_utiles)::int
               FROM tg_source_stats s
              WHERE s.tasa_utiles IS NOT NULL
                AND s.channel_id IN (SELECT channel_id FROM tg_mentions
                                      WHERE chain = $1 AND address = $2)) AS reputacion,
            ARRAY_AGG(DISTINCT me.tipo_senal) FILTER (WHERE me.tipo_senal IS NOT NULL) AS tipos,
            (SELECT ARRAY_AGG(DISTINCT a)
               FROM tg_mentions me2
               JOIN tg_messages m2 ON m2.id = me2.message_id,
                    jsonb_array_elements_text(COALESCE(m2.afirmaciones, '[]'::jsonb)) a
              WHERE me2.chain = $1 AND me2.address = $2) AS afirmaciones
       FROM tg_mentions me
      WHERE me.chain = $1 AND me.address = $2`,
    [chain, address],
  );
  if (!f) return null;

  // Lo que dicen los mensajes, en espanol. Un resumen por texto distinto
  // (las copias dicen lo mismo), primero los informativos.
  const resumenes = await query<ResumenMensaje>(
    `SELECT texto, canal, clase FROM (
       SELECT DISTINCT ON (COALESCE(m.text_hash, m.id::text))
              m.resumen_es AS texto, c.username AS canal, m.clasificacion AS clase,
              m.clasificacion_confianza AS confianza, m.posted_at
         FROM tg_mentions me
         JOIN tg_messages m ON m.id = me.message_id
         JOIN tg_channels c ON c.id = me.channel_id
        WHERE me.chain = $1 AND me.address = $2 AND m.resumen_es IS NOT NULL
        ORDER BY COALESCE(m.text_hash, m.id::text), m.posted_at
     ) x
     ORDER BY (clase = 'informacion') DESC, confianza DESC NULLS LAST, posted_at
     LIMIT 3`,
    [chain, address],
  );

  const fuentes = contarFuentes(menciones);
  const tipos = f.tipos ?? [];
  const tipo = PRIORIDAD_TIPO.find((t) => tipos.includes(t)) ?? 'general';
  const afirmaciones = (f.afirmaciones ?? [])
    .filter((a): a is Afirmacion => (AFIRMACIONES as readonly string[]).includes(a));

  return {
    r2: {
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
      // Se decide en evaluar(), al comprobar las afirmaciones contra la
      // cadena. Antes bastaba con que un mensaje "pareciera" informativo.
      afirmacionVerificada: false,
      tipoSenal: tipo,
    },
    afirmaciones,
    resumenes,
  };
}

/** Lo que dice el Robot 1, leido de lo que ya guardo al analizar. */
async function reunirSenalTecnica(
  chain: string,
  address: string,
): Promise<{ r1: EntradaRobot1; hechos: HechosCadena; precio: number | null } | null> {
  const t = await queryOne<{
    id: number;
    symbol: string | null;
    last_opportunity: number | null;
    last_risk: number | null;
    last_price_usd: number | null;
    enriched_at: Date | null;
    invalidated_at: Date | null;
    invalidation_reason: string | null;
  }>(
    `SELECT id, symbol, last_opportunity, last_risk, last_price_usd, enriched_at,
            invalidated_at, invalidation_reason
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

  const riesgos = await query<{ detail: string; severity: string }>(
    `SELECT detail, severity FROM suspicious_events
      WHERE token_id = $1 AND severity IN ('danger','warn')
      ORDER BY ts DESC LIMIT 6`,
    [t.id],
  );

  const sec = await queryOne<{
    mint_authority_active: boolean | null;
    freeze_authority_active: boolean | null;
    owner_can_modify: boolean | null;
    has_mint_function: boolean | null;
    has_blacklist: boolean | null;
    buy_tax_pct: number | null;
    sell_tax_pct: number | null;
    is_honeypot: boolean | null;
    can_sell: boolean | null;
    lp_locked_pct: number | null;
    lp_burned_pct: number | null;
  }>(
    `SELECT mint_authority_active, freeze_authority_active, owner_can_modify, has_mint_function,
            has_blacklist, buy_tax_pct, sell_tax_pct, is_honeypot, can_sell,
            lp_locked_pct, lp_burned_pct
       FROM security_reports WHERE token_id = $1 ORDER BY ts DESC LIMIT 1`,
    [t.id],
  );

  // Una oportunidad que el seguimiento ya dio por perdida (liquidez
  // retirada, desplome) cuenta como vetada. Antes el Robot 3 no lo miraba
  // y podia seguir dandole nivel con la nota de cuando aun estaba sana.
  const vetos = (s?.critical_vetoes ?? []).map((v) => v.text);
  const invalidado = t.invalidated_at !== null;
  if (invalidado) vetos.unshift(`Oportunidad invalidada: ${t.invalidation_reason ?? 'sin motivo'}`);

  const r1: EntradaRobot1 = {
    opportunity: Number(t.last_opportunity),
    risk: Number(t.last_risk),
    vetoed: (s?.vetoed ?? false) || invalidado,
    evaluable: s?.evaluable ?? true,
    vetos,
    motivosRiesgo: riesgos.slice(0, 4).map((r) => r.detail),
  };

  return { r1, hechos: hechosDe(chain, sec, riesgos, r1.vetoed), precio: t.last_price_usd };
}

/** Traduce el informe de seguridad del Robot 1 a lo que se puede comprobar. */
function hechosDe(
  chain: string,
  sec: {
    mint_authority_active: boolean | null; freeze_authority_active: boolean | null;
    owner_can_modify: boolean | null; has_mint_function: boolean | null; has_blacklist: boolean | null;
    buy_tax_pct: number | null; sell_tax_pct: number | null; is_honeypot: boolean | null;
    can_sell: boolean | null; lp_locked_pct: number | null; lp_burned_pct: number | null;
  } | null,
  riesgos: Array<{ detail: string; severity: string }>,
  vetado: boolean,
): HechosCadena {
  const peligros = riesgos.filter((r) => r.severity === 'danger').map((r) => r.detail);
  if (!sec) {
    return {
      liquidezAseguradaPct: null, permisosLimpios: null, impuestoMaxPct: null,
      honeypot: null, peligros, vetado,
    };
  }

  const bloqueada = sec.lp_locked_pct === null ? null : Number(sec.lp_locked_pct);
  const quemada = sec.lp_burned_pct === null ? null : Number(sec.lp_burned_pct);
  const liquidezAseguradaPct =
    bloqueada === null && quemada === null ? null : Math.min(100, (bloqueada ?? 0) + (quemada ?? 0));

  // En Solana el poder esta en las autoridades de mint y freeze; en Base,
  // en el owner del contrato. Si no se pudo ver ninguna, no se sabe.
  const permisos = chain === 'solana'
    ? [sec.mint_authority_active, sec.freeze_authority_active]
    : [sec.owner_can_modify, sec.has_mint_function, sec.has_blacklist];
  const conocidos = permisos.filter((p): p is boolean => p !== null);
  const permisosLimpios = conocidos.length === 0 ? null : !conocidos.some(Boolean);

  const impuestos = [sec.buy_tax_pct, sec.sell_tax_pct].filter((x): x is number => x !== null).map(Number);
  const honeypot = sec.is_honeypot === true || sec.can_sell === false
    ? true
    : sec.is_honeypot === false || sec.can_sell === true ? false : null;

  return {
    liquidezAseguradaPct,
    permisosLimpios,
    impuestoMaxPct: impuestos.length > 0 ? Math.max(...impuestos) : null,
    honeypot,
    peligros,
    vetado,
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
  resumenes: ResumenMensaje[] = [],
): string {
  const enlace =
    d.chain === 'solana'
      ? `https://jup.ag/swap/SOL-${d.address}`
      : `https://app.uniswap.org/swap?chain=base&outputCurrency=${d.address}`;

  const anticipacion = describirAnticipacion(r2.anticipacionSeg);
  const confirmadas = r2.coherencia?.confirmadas ?? [];

  return [
    `🚨 <b>ALTA CONVERGENCIA · ${escapeHtml(d.symbol ?? '?')}</b>`,
    `${d.chain === 'solana' ? 'Solana' : 'Base'}`,
    '',
    '<b>Lo que dice Telegram</b>',
    `${r2.fuentesIndependientes} fuente(s) independiente(s) de ${r2.fuentesTotal} en total`,
    `La informacion aparecio ${anticipacion}`,
    // Lo que dicen los mensajes, resumido en espanol aunque el original
    // estuviera en ingles o portugues.
    ...resumenes.slice(0, 2).map(
      (r) => `• ${escapeHtml(r.texto)}${r.canal ? ` <i>(@${escapeHtml(r.canal)})</i>` : ''}`,
    ),
    '',
    '<b>Lo que dicen los datos</b>',
    `Oportunidad ${r1.opportunity}/100   Riesgo ${r1.risk}/100`,
    ...(confirmadas.length > 0
      ? ['', '<b>Comprobado en la cadena</b>', ...confirmadas.map((c) => `✅ ${escapeHtml(c)}`)]
      : []),
    ...(r1.motivosRiesgo.length > 0
      ? ['', '<b>Riesgos detectados</b>', ...r1.motivosRiesgo.slice(0, 3).map((m) => `• ${escapeHtml(m)}`)]
      : []),
    '',
    '<b>Por que se avisa</b>',
    // Las confirmaciones ya van en su apartado.
    ...v.explicacion.filter((e) => !confirmadas.includes(e)).map((e) => `• ${escapeHtml(e)}`),
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

  const social = await reunirSenalSocial(chain, address);
  if (!social) return;

  const tecnica = await reunirSenalTecnica(chain, address);
  // Sin analisis del Robot 1 no hay nada que cruzar. No se avisa: la
  // mitad de la informacion no es informacion.
  if (!tecnica) return;
  const { r1, hechos, precio } = tecnica;

  // COHERENCIA: lo que afirman los mensajes, contra lo que dice la cadena.
  // Lo desmentido impide el nivel maximo; lo confirmado es la evidencia.
  const coherencia = verificarCoherencia(social.afirmaciones, hechos);
  const r2: EntradaRobot2 = {
    ...social.r2,
    coherencia,
    afirmacionVerificada: coherencia.confirmadas.length > 0,
  };

  const t = await queryOne<{ id: number; symbol: string | null }>(
    'SELECT id, symbol FROM tokens WHERE chain = $1 AND address = $2',
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

  // Nivel que tenia, para saber si cambia.
  const antes = await queryOne<{ nivel: string | null }>(
    'SELECT nivel FROM tg_candidatos WHERE chain = $1 AND address = $2 AND primera_mencion = $3',
    [chain, address, primeraMencion],
  );

  // Todo el razonamiento se guarda con el veredicto, se avise o no. Antes
  // solo viajaba en el aviso: de lo que no se avisaba no quedaba por que.
  const detalle = {
    motivo: veredicto.motivo,
    explicacion: veredicto.explicacion,
    contradicciones: veredicto.contradicciones,
    confirmaciones: coherencia.confirmadas,
    resumenes: social.resumenes,
  };

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
        vetado, nivel, detalle)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
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
       nivel            = EXCLUDED.nivel,
       detalle          = EXCLUDED.detalle
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
      r1.vetoed, veredicto.nivel, JSON.stringify(detalle),
    ],
  );

  // SEGUIMIENTO: cada cambio de nivel queda apuntado con su precio. Es lo
  // que deja ver como evoluciona una oportunidad y medir despues cuanto
  // acerto cada nivel. Los veredictos de antes del historial reciben su
  // primera fila aunque no cambien: sin un punto de partida no se pueden
  // medir.
  const sinHistorial = fila
    ? !(await queryOne<{ n: number }>(
        'SELECT 1 AS n FROM tg_candidatos_historial WHERE candidato_id = $1 LIMIT 1', [fila.id],
      ))
    : false;
  if (fila && (antes?.nivel !== veredicto.nivel || sinHistorial)) {
    await exec(
      `INSERT INTO tg_candidatos_historial
         (candidato_id, nivel, nivel_antes, score_tecnica, score_riesgo, fuentes_indep, precio_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        fila.id, veredicto.nivel, antes?.nivel ?? null,
        Math.round(veredicto.componentes.tecnica), Math.round(veredicto.componentes.riesgo),
        r2.fuentesIndependientes, precio,
      ],
    );
  }

  if (veredicto.nivel !== 'rojo') {
    log.debug({ token: t?.symbol, nivel: veredicto.nivel }, 'sin nivel suficiente para avisar');
    return;
  }

  if ((await avisosHoy()) >= avisosPorDia()) {
    log.info({ token: t?.symbol }, 'tope diario de avisos de convergencia alcanzado');
    return;
  }

  // El interruptor de pausa del panel vale para todos los avisos. El Robot 3
  // no lo miraba: con las alertas pausadas, las suyas seguian saliendo. Se
  // deja sin marcar como enviado, y si al reanudar sigue cumpliendo, sale.
  if (await isPaused()) {
    log.info({ token: t?.symbol }, 'aviso de convergencia retenido: alertas pausadas');
    return;
  }

  const mensaje = construirAviso(
    { chain, address, symbol: t?.symbol ?? null, primeraMencion },
    r1, r2, veredicto, social.resumenes,
  );

  const res = await notify(mensaje, {
    subject: `Alta convergencia · ${t?.symbol ?? address.slice(0, 8)}`,
  });

  // Tambien al historial de alertas, como las del Robot 1. Asi sale en el
  // panel junto a las demas y, sobre todo, el seguimiento le manda el aviso
  // de peligro si el token se hunde despues: antes solo lo hacia con los
  // tokens avisados por el Robot 1, y uno avisado por el Robot 3 podia
  // desplomarse sin que nadie dijera nada.
  if (t) {
    await saveAlert(
      t.id, 'convergencia', r1.opportunity, r1.risk, mensaje, res.ok, res.error, res.results,
    );
  }

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
 * Repasa los tokens mencionados recientemente y los que siguen en
 * seguimiento, y los evalua. Se ejecuta periodicamente en vez de al
 * momento, porque hace falta que el Robot 1 haya terminado su analisis
 * primero.
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
  //
  // Y TAMBIEN LOS QUE SIGUEN EN SEGUIMIENTO
  // La especificacion pide decidir que oportunidades merecen atencion Y
  // SEGUIMIENTO. Antes un veredicto se dejaba de revisar en cuanto pasaban
  // 24 horas sin menciones nuevas, aunque el Robot 1 siguiera vigilando el
  // token y sus datos cambiaran. Ahora, mientras el token este vigilado y
  // el veredicto no sea un descarte, se sigue revisando.
  const pendientes = await query<{ chain: Chain; address: string }>(
    `SELECT chain, address FROM (
       SELECT me.chain, me.address, MAX(me.creado_at) AS ultimo
         FROM tg_mentions me
         JOIN tokens t ON t.chain = me.chain AND t.address = me.address
        WHERE me.creado_at > now() - interval '24 hours'
          AND t.enriched_at IS NOT NULL
        GROUP BY me.chain, me.address
       UNION
       SELECT c.chain, c.address, MAX(c.creado_at) AS ultimo
         FROM tg_candidatos c
         JOIN tokens t ON t.chain = c.chain AND t.address = c.address
        WHERE c.enviado_at IS NULL AND c.nivel <> 'descartado'
          AND t.tracked_until > now()
        GROUP BY c.chain, c.address
     ) x
     GROUP BY chain, address
     ORDER BY MAX(ultimo) DESC
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
