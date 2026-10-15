/**
 * La decision del Robot 3 sobre un token, entera y verificable.
 *
 * No basta con ensenar "Convergencia fuerte": quien revise tiene que ver que
 * datos del Robot 1 y del Robot 2 se compararon, que reglas se aplicaron,
 * que resultado dio cada una, en que momento, y donde esta cada cosa en el
 * codigo, la configuracion y la base de datos.
 */
import { query, queryOne } from '../../core/db.js';
import { getScoring } from '../../core/config.js';
import { maxOpportunityPoints } from '../../scoring/engine.js';
import {
  reglasNivelMaximo,
  reglasNivelIntermedio,
  describirAnticipacion,
  type ReglaAplicada,
  type DatosComparados,
} from '../../robot3/convergencia.js';
import { contarFuentes, type MencionFuente } from '../../robot3/fuentes.js';
import { umbralesActuales } from '../../robot3/umbrales.js';
import { iso, num } from './comun.js';

interface Motivo {
  code: string;
  text: string;
  points: number;
}

/** Lo que el veredicto guarda en su columna detalle (los antiguos, solo parte). */
interface DetalleVeredicto {
  motivo?: string;
  explicacion?: string[];
  contradicciones?: string[];
  confirmaciones?: string[];
  reglas?: { maximo: ReglaAplicada[]; intermedio: ReglaAplicada[] };
  umbrales?: Record<string, number>;
  datos?: { robot2?: { canalesIndependientes?: number[] } };
  evaluadoEn?: string;
}

interface FilaVeredicto {
  score_tecnica: number;
  score_riesgo: number;
  vetado: boolean;
  fuentes_indep: number;
  score_fuentes: number;
  anticipacion_seg: number | null;
  detalle: DetalleVeredicto | null;
}

/**
 * Las reglas de un veredicto: las que se guardaron al decidir o, en los
 * veredictos anteriores a que se guardaran, recalculadas con los valores
 * que si se guardaron y los umbrales actuales. El panel dice cual de los
 * dos casos es.
 */
export function reglasDeVeredicto(f: FilaVeredicto): {
  maximo: ReglaAplicada[];
  intermedio: ReglaAplicada[];
  guardadas: boolean;
} {
  if (f.detalle?.reglas) return { ...f.detalle.reglas, guardadas: true };
  const u = umbralesActuales();
  const datos: DatosComparados = {
    tecnica: Number(f.score_tecnica),
    riesgo: Number(f.score_riesgo),
    vetado: f.vetado,
    evaluable: f.detalle?.motivo !== 'No se pudo comprobar lo suficiente',
    fuentesIndependientes: f.fuentes_indep,
    reputacionMedia: Number(f.score_fuentes),
    anticipacionSeg: num(f.anticipacion_seg),
    contradicciones: (f.detalle?.contradicciones ?? []).length,
  };
  return { maximo: reglasNivelMaximo(datos, u), intermedio: reglasNivelIntermedio(datos, u), guardadas: false };
}

/**
 * Como sale la nota del Robot 1 a partir de sus motivos.
 *
 * La oportunidad es la suma de puntos a favor sobre el maximo posible con
 * las reglas activas; despues, un riesgo alto la rebaja y el contexto de
 * mercado la ajusta. El riesgo es la suma de puntos en contra, hasta 100.
 */
export function calculoNota(s: {
  opportunity: unknown;
  risk: unknown;
  opportunity_reasons: unknown;
  risk_reasons: unknown;
}) {
  const cfg = getScoring();
  const aFavor = ((s.opportunity_reasons ?? []) as Motivo[]).filter((m) => typeof m.points === 'number');
  const enContra = ((s.risk_reasons ?? []) as Motivo[]).filter((m) => typeof m.points === 'number');
  const suma = Math.round(aFavor.reduce((a, m) => a + m.points, 0) * 10) / 10;
  const bonus = cfg.market_context?.enabled ? (cfg.market_context.bonus_fuerza_relativa ?? 0) : 0;
  const maximo = maxOpportunityPoints(cfg.opportunity) + bonus;
  const base = maximo > 0 ? Math.round((suma / maximo) * 1000) / 10 : 0;
  const final = num(s.opportunity) ?? 0;
  const sumaRiesgo = Math.round(enContra.reduce((a, m) => a + m.points, 0) * 10) / 10;
  return {
    aFavor: aFavor.map((m) => ({ texto: m.text, puntos: m.points })),
    enContra: enContra.map((m) => ({ texto: m.text, puntos: m.points })),
    sumaAFavor: suma,
    maximoPosible: maximo,
    oportunidadBase: base,
    oportunidad: final,
    ajuste: Math.round((final - base) * 10) / 10,
    sumaRiesgo,
    riesgo: num(s.risk) ?? 0,
    vetoRiesgo: cfg.risk_veto_threshold,
  };
}

export async function datosDecisionRobot3(chain: string, address: string) {
  const c = await queryOne<FilaVeredicto & {
    id: number; nivel: string; primera_mencion: Date; fuentes_total: number;
    score_social: number; score_evidencia: number; enviado_at: Date | null; creado_at: Date;
  }>(
    `SELECT id, nivel, primera_mencion, fuentes_total, fuentes_indep, anticipacion_seg,
            score_social, score_fuentes, score_evidencia, score_tecnica, score_riesgo,
            vetado, enviado_at, creado_at, detalle
       FROM tg_candidatos WHERE chain = $1 AND address = $2
      ORDER BY enviado_at IS NULL, primera_mencion LIMIT 1`,
    [chain, address],
  );
  if (!c) return null;

  const token = await queryOne<{ id: number }>('SELECT id FROM tokens WHERE chain = $1 AND address = $2', [chain, address]);
  const historial = await query<{
    ts: Date; nivel: string; nivel_antes: string | null; score_tecnica: number | null;
    score_riesgo: number | null; fuentes_indep: number | null; precio_usd: unknown;
  }>(
    `SELECT ts, nivel, nivel_antes, score_tecnica, score_riesgo, fuentes_indep, precio_usd
       FROM tg_candidatos_historial WHERE candidato_id = $1 ORDER BY ts`,
    [c.id],
  );

  // El momento de la decision: el del aviso si lo hubo; si no, cuando el
  // token llego a su nivel actual.
  const momento: Date = c.enviado_at ?? historial.at(-1)?.ts ?? c.creado_at;

  // Robot 1: la nota vigente en ese momento, con todos sus motivos.
  const score = token
    ? await queryOne<{
        id: number; ts: Date; opportunity: unknown; risk: unknown; vetoed: boolean; evaluable: boolean | null;
        opportunity_reasons: unknown; risk_reasons: unknown;
        critical_vetoes: Array<{ code: string; text: string }> | null; missing_data: string[] | null;
      }>(
        `SELECT id, ts, opportunity, risk, vetoed, evaluable, opportunity_reasons, risk_reasons,
                critical_vetoes, missing_data
           FROM scores WHERE token_id = $1 AND ts <= $2 ORDER BY ts DESC LIMIT 1`,
        [token.id, momento],
      )
    : null;

  // Robot 2: lo que se habia dicho hasta ese momento, canal por canal.
  const canales = await query<{
    channel_id: number; username: string | null; title: string | null; posted_at: Date; menciones: number;
    text: string | null; resumen_es: string | null; clasificacion: string | null;
    anticipacion_seg: number | null; anticipacion_veredicto: string | null;
    tasa_utiles: unknown; veces_primero: number | null; tokens_citados: number | null; anticipacion_med: number | null;
  }>(
    `SELECT DISTINCT ON (me.channel_id)
            me.channel_id, ch.username, ch.title, me.posted_at,
            COUNT(*) OVER (PARTITION BY me.channel_id)::int AS menciones,
            m.text, m.resumen_es, m.clasificacion, me.anticipacion_seg, me.anticipacion_veredicto,
            s.tasa_utiles, s.veces_primero, s.tokens_citados, s.anticipacion_med
       FROM tg_mentions me
       JOIN tg_messages m ON m.id = me.message_id
       JOIN tg_channels ch ON ch.id = me.channel_id
       LEFT JOIN tg_source_stats s ON s.channel_id = me.channel_id
      WHERE me.chain = $1 AND me.address = $2 AND me.posted_at <= $3
      ORDER BY me.channel_id, me.posted_at`,
    [chain, address, momento],
  );
  canales.sort((a, b) => new Date(a.posted_at).getTime() - new Date(b.posted_at).getTime());

  // Que canales contaron como independientes. Los veredictos nuevos lo
  // guardan; en los anteriores se recalcula con la misma funcion que usa el
  // Robot 3 (src/robot3/fuentes.ts) y la clasificacion actual de los mensajes.
  const guardados = c.detalle?.datos?.robot2?.canalesIndependientes;
  let independientes: number[];
  if (guardados) {
    independientes = guardados;
  } else {
    const menciones = await query<MencionFuente>(
      `SELECT me.channel_id AS canal, m.text_hash AS hash, m.id AS mensaje, m.posted_at AS publicado,
              (m.clasificacion IS NULL OR m.clasificacion IN ('indeterminado', 'informacion')) AS util
         FROM tg_mentions me JOIN tg_messages m ON m.id = me.message_id
        WHERE me.chain = $1 AND me.address = $2 AND me.posted_at <= $3`,
      [chain, address, momento],
    );
    independientes = contarFuentes(menciones.map((m) => ({ ...m, publicado: new Date(m.publicado) }))).autores;
  }

  const alerta = token
    ? await queryOne<{ id: number; ts: Date }>(
        `SELECT id, ts FROM alerts WHERE token_id = $1 AND kind = 'convergencia' ORDER BY ts LIMIT 1`,
        [token.id],
      )
    : null;

  const reglas = reglasDeVeredicto(c);
  const calculo = score ? calculoNota(score) : null;

  return {
    nivel: c.nivel,
    momento: iso(momento),
    avisadoEn: iso(c.enviado_at),
    primeraMencion: iso(c.primera_mencion),
    evaluadoEn: c.detalle?.evaluadoEn ?? null,
    motivo: c.detalle?.motivo ?? null,
    reglas: { maximo: reglas.maximo, intermedio: reglas.intermedio },
    reglasGuardadas: reglas.guardadas,
    explicacion: c.detalle?.explicacion ?? [],
    confirmaciones: c.detalle?.confirmaciones ?? [],
    contradicciones: c.detalle?.contradicciones ?? [],
    robot1: {
      notaEn: iso(score?.ts),
      oportunidad: Number(c.score_tecnica),
      riesgo: Number(c.score_riesgo),
      vetado: c.vetado,
      vetos: (score?.critical_vetoes ?? []).map((v) => v.text),
      faltan: score?.missing_data ?? [],
      calculo,
    },
    robot2: {
      fuentesTotal: c.fuentes_total,
      fuentesIndep: c.fuentes_indep,
      reputacionMedia: Number(c.score_fuentes),
      anticipacion: describirAnticipacion(num(c.anticipacion_seg)),
      independientesRecalculados: !guardados,
      canales: canales.map((m) => ({
        canal: m.username,
        titulo: m.title,
        primera: iso(m.posted_at),
        menciones: m.menciones,
        texto: (m.text ?? '').slice(0, 1200),
        resumen: m.resumen_es,
        clase: m.clasificacion,
        anticipacionSeg: num(m.anticipacion_seg),
        veredicto: m.anticipacion_veredicto,
        reputacion: num(m.tasa_utiles),
        vecesPrimero: m.veces_primero,
        tokensCitados: m.tokens_citados,
        independiente: independientes.includes(m.channel_id),
      })),
    },
    historial: historial.map((h) => ({
      ts: iso(h.ts),
      nivel: h.nivel,
      nivelAntes: h.nivel_antes,
      tecnica: num(h.score_tecnica),
      riesgo: num(h.score_riesgo),
      fuentes: h.fuentes_indep,
      precio: num(h.precio_usd),
    })),
    traza: {
      candidatoId: c.id,
      tokenId: token?.id ?? null,
      scoreId: score?.id ?? null,
      alertaId: alerta?.id ?? null,
    },
  };
}
