/**
 * Lo que esta viendo el Robot 2 en Telegram.
 *
 * Cada lista va por separado y paginada: la pagina las pide segun se abren
 * sus pestanas, en vez de cargar cinco tablas de golpe.
 */
import { query, queryOne } from '../../core/db.js';
import { iso, num, paginacion, type Pagina } from './comun.js';

export async function datosTelegramResumen() {
  const [resumen, idiomas, porEstado] = await Promise.all([
    queryOne<{ canales: number; mensajes: number; descartados: number; candidatos: number; menciones: number; tokens: number }>(
      `SELECT (SELECT COUNT(*)::int FROM tg_channels WHERE active)                     AS canales,
              (SELECT COUNT(*)::int FROM tg_messages)                                  AS mensajes,
              (SELECT COUNT(*)::int FROM tg_messages WHERE triage = 'descartado')      AS descartados,
              (SELECT COUNT(*)::int FROM tg_messages WHERE triage = 'candidato')       AS candidatos,
              (SELECT COUNT(*)::int FROM tg_mentions)                                  AS menciones,
              (SELECT COUNT(DISTINCT address)::int FROM tg_mentions)                   AS tokens`,
    ),
    // De que idioma es lo que informa en la ultima semana. La especificacion
    // pide buscar en espanol, portugues e ingles: aqui se ve si llega de los tres.
    query<{ idioma: string; n: number }>(
      `SELECT idioma, COUNT(*)::int AS n FROM tg_messages
        WHERE idioma IS NOT NULL AND posted_at > now() - interval '7 days'
        GROUP BY idioma`,
    ),
    query<{ estado: string; n: number }>(
      'SELECT estado, COUNT(*)::int AS n FROM tg_canales_descubiertos GROUP BY estado',
    ),
  ]);

  const r = resumen ?? { canales: 0, mensajes: 0, descartados: 0, candidatos: 0, menciones: 0, tokens: 0 };
  const total = idiomas.reduce((a, x) => a + x.n, 0);
  const pct = (i: string) => (total > 0 ? Math.round(((idiomas.find((x) => x.idioma === i)?.n ?? 0) / total) * 100) : null);

  return {
    ...r,
    pctDescarte: r.mensajes > 0 ? Math.round((r.descartados / r.mensajes) * 100) : 0,
    idiomas: { es: pct('es'), pt: pct('pt'), en: pct('en'), muestra: total },
    descubiertos: Object.fromEntries(porEstado.map((e) => [e.estado, e.n])) as Record<string, number>,
  };
}

export interface FuenteFila {
  title: string | null;
  username: string | null;
  active: boolean;
  mensajes: number;
  menciones: number;
  primeras: number;
  adelantadas: number;
  medibles: number;
  acierto: number | null;
}

export async function datosFuentes(q: Record<string, string | undefined>): Promise<Pagina<FuenteFila>> {
  const { page, size, offset } = paginacion(q, 20);
  const soloActivos = q.estado === 'activos';
  const [filas, total] = await Promise.all([
    // Cada tabla se cuenta POR SEPARADO y luego se juntan: unirlas a la vez
    // multiplica una por otra y con 56.000 mensajes la consulta no acababa.
    query<Omit<FuenteFila, 'acierto'>>(
      `WITH msg AS (SELECT channel_id, COUNT(*)::int AS mensajes FROM tg_messages GROUP BY channel_id),
            men AS (
              SELECT channel_id,
                     COUNT(*)::int                                     AS menciones,
                     COUNT(*) FILTER (WHERE es_primera)::int           AS primeras,
                     COUNT(*) FILTER (WHERE anticipacion_seg > 0)::int AS adelantadas,
                     COUNT(*) FILTER (WHERE anticipacion_veredicto IS NOT NULL
                                        AND anticipacion_veredicto <> 'sin_datos')::int AS medibles
                FROM tg_mentions GROUP BY channel_id)
       SELECT c.title, c.username, c.active,
              COALESCE(msg.mensajes, 0) AS mensajes, COALESCE(men.menciones, 0) AS menciones,
              COALESCE(men.primeras, 0) AS primeras, COALESCE(men.adelantadas, 0) AS adelantadas,
              COALESCE(men.medibles, 0) AS medibles
         FROM tg_channels c
         LEFT JOIN msg ON msg.channel_id = c.id
         LEFT JOIN men ON men.channel_id = c.id
        WHERE ($3::boolean IS FALSE OR c.active)
        ORDER BY c.active DESC, COALESCE(men.adelantadas, 0) DESC, COALESCE(men.menciones, 0) DESC, c.id
        LIMIT $1 OFFSET $2`,
      [size, offset, soloActivos],
    ),
    queryOne<{ n: number }>('SELECT COUNT(*)::int AS n FROM tg_channels WHERE ($1::boolean IS FALSE OR active)', [soloActivos]),
  ]);
  return {
    // El acierto se mide sobre lo que se pudo comprobar. Dividir por todas
    // las menciones hundia a los canales por su propio historico.
    items: filas.map((f) => ({ ...f, acierto: f.medibles > 0 ? Math.round((f.adelantadas / f.medibles) * 100) : null })),
    total: total?.n ?? 0,
    page,
    size,
  };
}

export async function datosMenciones(q: Record<string, string | undefined>) {
  const { page, size, offset } = paginacion(q, 20);
  const [filas, total] = await Promise.all([
    query<{
      symbol: string | null; chain: string; address: string; canal: string | null; posted_at: Date;
      resuelto_por: string; es_primera: boolean; anticipacion_seg: number | null;
      anticipacion_veredicto: string | null; opportunity: unknown; risk: unknown;
      resumen_es: string | null; nivel: string | null;
    }>(
      `SELECT t.symbol, me.chain, me.address, c.title AS canal, me.posted_at,
              me.resuelto_por, me.es_primera, me.anticipacion_seg, me.anticipacion_veredicto,
              t.last_opportunity AS opportunity, t.last_risk AS risk, m.resumen_es,
              (SELECT nivel FROM tg_candidatos k
                WHERE k.chain = me.chain AND k.address = me.address
                ORDER BY k.enviado_at IS NULL, k.primera_mencion LIMIT 1) AS nivel
         FROM tg_mentions me
         JOIN tg_channels c ON c.id = me.channel_id
         JOIN tg_messages m ON m.id = me.message_id
         LEFT JOIN tokens t ON t.chain = me.chain AND t.address = me.address
        ORDER BY me.posted_at DESC, me.id DESC
        LIMIT $1 OFFSET $2`,
      [size, offset],
    ),
    queryOne<{ n: number }>('SELECT COUNT(*)::int AS n FROM tg_mentions'),
  ]);
  return {
    items: filas.map((m) => ({
      symbol: m.symbol,
      chain: m.chain,
      address: m.address,
      canal: m.canal,
      postedAt: iso(m.posted_at),
      resueltoPor: m.resuelto_por,
      esPrimera: m.es_primera,
      anticipacionSeg: num(m.anticipacion_seg),
      veredicto: m.anticipacion_veredicto,
      opportunity: num(m.opportunity),
      risk: num(m.risk),
      resumen: m.resumen_es,
      nivel: m.nivel,
    })),
    total: total?.n ?? 0,
    page,
    size,
  };
}

const CLASES = ['informacion', 'promocion', 'hype', 'indeterminado', 'sin_clasificar'];

export async function datosMensajes(q: Record<string, string | undefined>) {
  const { page, size, offset } = paginacion(q, 15);
  const clase = CLASES.includes(q.clase ?? '') ? q.clase! : null;
  // Los que pasaron el primer filtro: el resto es ruido y ya se cuenta en el resumen.
  const filtro = `m.triage = 'candidato'
     AND ($3::text IS NULL OR ($3 = 'sin_clasificar' AND m.clasificacion IS NULL) OR m.clasificacion = $3)`;
  const [filas, total] = await Promise.all([
    query<{
      id: number; posted_at: Date; canal: string | null; text: string | null; triage_motivo: string | null;
      clasificacion: string | null; clasificacion_motivo: string | null; resumen_es: string | null; idioma: string | null;
    }>(
      `SELECT m.id, m.posted_at, c.title AS canal, m.text, m.triage_motivo,
              m.clasificacion, m.clasificacion_motivo, m.resumen_es, m.idioma
         FROM tg_messages m JOIN tg_channels c ON c.id = m.channel_id
        WHERE ${filtro}
        ORDER BY m.posted_at DESC, m.id DESC
        LIMIT $1 OFFSET $2`,
      [size, offset, clase],
    ),
    queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM tg_messages m WHERE ${filtro.replaceAll('$3', '$1')}`,
      [clase],
    ),
  ]);
  return {
    items: filas.map((m) => ({
      id: m.id,
      postedAt: iso(m.posted_at),
      canal: m.canal,
      texto: (m.text ?? '').slice(0, 800),
      clase: m.clasificacion,
      motivo: m.clasificacion_motivo ?? m.triage_motivo,
      resumen: m.resumen_es,
      idioma: m.idioma,
    })),
    total: total?.n ?? 0,
    page,
    size,
  };
}

const ESTADOS = ['unido', 'candidato', 'rechazado', 'abandonado'];

export async function datosDescubiertos(q: Record<string, string | undefined>) {
  const { page, size, offset } = paginacion(q, 20);
  const estado = ESTADOS.includes(q.estado ?? '') ? q.estado! : null;
  const [filas, total] = await Promise.all([
    query<{
      username: string; title: string | null; miembros: number | null; score: number;
      estado: string; descubierto_por: string; motivo_score: string | null; motivo_estado: string | null;
    }>(
      `SELECT username, title, miembros, score, estado, descubierto_por, motivo_score, motivo_estado
         FROM tg_canales_descubiertos
        WHERE ($3::text IS NULL OR estado = $3)
        ORDER BY CASE estado WHEN 'unido' THEN 0 WHEN 'candidato' THEN 1 ELSE 2 END,
                 score DESC, miembros DESC NULLS LAST, id
        LIMIT $1 OFFSET $2`,
      [size, offset, estado],
    ),
    queryOne<{ n: number }>(
      'SELECT COUNT(*)::int AS n FROM tg_canales_descubiertos WHERE ($1::text IS NULL OR estado = $1)',
      [estado],
    ),
  ]);
  return {
    items: filas.map((d) => ({
      username: d.username,
      title: d.title,
      miembros: num(d.miembros),
      score: num(d.score),
      estado: d.estado,
      descubiertoPor: d.descubierto_por,
      motivo: d.motivo_estado ?? d.motivo_score,
    })),
    total: total?.n ?? 0,
    page,
    size,
  };
}

/**
 * Lo que se dijo de un token en Telegram y lo que decidio el Robot 3, para
 * la ficha del token: los tres robots se ven juntos en un solo sitio.
 */
/**
 * Que menciones se ensenan en la ficha de un token, en orden de llegada.
 *
 * Antes salian las diez ultimas, y en un token muy comentado eran todas del
 * mismo canal: no se veian las primeras de cada canal, que son justo las que
 * cuentan como fuentes independientes para el Robot 3. Ahora va siempre la
 * primera de cada canal y el resto del hueco se llena con las mas recientes.
 */
export function elegirMenciones<T extends { canal: string | null }>(menciones: T[], maximo = 15): T[] {
  const elegidas = new Set<T>();
  const vistos = new Set<string>();
  for (const m of menciones) {
    const canal = m.canal ?? '?';
    if (!vistos.has(canal)) {
      vistos.add(canal);
      elegidas.add(m);
    }
  }
  for (let i = menciones.length - 1; i >= 0 && elegidas.size < maximo; i--) elegidas.add(menciones[i]);
  return menciones.filter((m) => elegidas.has(m));
}

export async function datosTelegramToken(chain: string, address: string) {
  const menciones = await query<{
    canal: string | null; posted_at: Date; resumen_es: string | null; clasificacion: string | null;
    anticipacion_seg: number | null; anticipacion_veredicto: string | null; text: string | null;
    reputacion: unknown;
  }>(
    `SELECT c.username AS canal, me.posted_at, m.resumen_es, m.clasificacion,
            me.anticipacion_seg, me.anticipacion_veredicto, m.text, s.tasa_utiles AS reputacion
       FROM tg_mentions me
       JOIN tg_messages m ON m.id = me.message_id
       JOIN tg_channels c ON c.id = me.channel_id
       LEFT JOIN tg_source_stats s ON s.channel_id = me.channel_id
      WHERE me.chain = $1 AND me.address = $2
      ORDER BY me.posted_at`,
    [chain, address],
  );
  if (menciones.length === 0) return null;

  const v = await queryOne<{
    nivel: string; fuentes_indep: number; fuentes_total: number; enviado_at: Date | null;
    detalle: { contradicciones?: string[]; confirmaciones?: string[] } | null;
  }>(
    `SELECT nivel, fuentes_indep, fuentes_total, enviado_at, detalle FROM tg_candidatos
      WHERE chain = $1 AND address = $2
      ORDER BY enviado_at IS NULL, primera_mencion LIMIT 1`,
    [chain, address],
  );

  return {
    total: menciones.length,
    canales: new Set(menciones.map((m) => m.canal ?? '?')).size,
    primera: iso(menciones[0].posted_at),
    veredicto: v
      ? {
          nivel: v.nivel,
          fuentesIndep: v.fuentes_indep,
          fuentesTotal: v.fuentes_total,
          avisado: v.enviado_at !== null,
          confirmaciones: v.detalle?.confirmaciones ?? [],
          contradicciones: v.detalle?.contradicciones ?? [],
        }
      : null,
    menciones: elegirMenciones(menciones).map((m) => ({
      canal: m.canal,
      postedAt: iso(m.posted_at),
      resumen: m.resumen_es,
      texto: (m.text ?? '').slice(0, 1200),
      reputacion: num(m.reputacion),
      clase: m.clasificacion,
      anticipacionSeg: num(m.anticipacion_seg),
      veredicto: m.anticipacion_veredicto,
    })),
  };
}
