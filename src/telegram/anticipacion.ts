/**
 * Anticipacion: ¿Telegram hablo ANTES o DESPUES del movimiento?
 *
 * POR QUE ESTO ES LO MAS IMPORTANTE DEL ROBOT 2
 * Que mucha gente hable de un token no significa nada por si solo. Lo que
 * distingue una fuente util de una inutil es CUANDO habla:
 *
 *   Telegram 14:02  ->  precio se mueve 14:15   = se adelanto  (util)
 *   precio se mueve 14:02  ->  Telegram 14:15   = va detras    (inutil)
 *
 * La segunda es la mayoria. Un canal que publica cuando el token ya subio
 * un 300% no esta descubriendo nada: esta contando lo que ya paso, y
 * seguirlo es comprar el maximo.
 *
 * Esta medida es lo que permite construir reputacion con datos reales en
 * vez de con opiniones, y es la unica parte del sistema que puede decir
 * "este canal vale" o "este canal llega tarde" sin que sea una corazonada.
 *
 * El lado del precio ya lo tenemos: el radar lleva meses guardando
 * mediciones en token_snapshots. Aqui solo se cruza con la hora del
 * mensaje.
 */
import { query, queryOne } from '../core/db.js';
import { child } from '../core/logger.js';

const log = child('anticipacion');

/**
 * Cuanto tiene que subir el precio para considerarlo "un movimiento".
 *
 * Por debajo de esto es ruido de mercado normal y no significa nada. El
 * 25% es un punto de partida razonable para tokens nuevos, donde las
 * variaciones son enormes; para activos grandes seria disparatado.
 */
const SUBIDA_MINIMA_PCT = 25;

/**
 * Ventana maxima hacia adelante desde la mencion.
 *
 * Si el precio se mueve tres dias despues, ese movimiento no tiene nada
 * que ver con el mensaje. Atribuirselo seria enganarse.
 */
const VENTANA_HORAS = 24;

export interface Anticipacion {
  /** Segundos entre la mencion y el movimiento. Positivo = se adelanto. */
  segundos: number | null;
  /** Precio en el momento de la mencion. */
  precioMencion: number | null;
  /** Precio cuando se disparo el movimiento. */
  precioMovimiento: number | null;
  subidaPct: number | null;
  /** Explicacion legible de que se concluyo y por que. */
  veredicto:
    | 'se_adelanto'      // el mensaje llego antes del movimiento
    | 'reacciono'        // el movimiento ya habia empezado
    | 'sin_movimiento'   // no paso nada en la ventana
    | 'sin_datos';       // no hay mediciones suficientes
  detalle: string;
}

interface FilaPrecio {
  ts: Date;
  price_usd: string | null;
}

/**
 * Calcula la anticipacion de una mencion concreta.
 *
 * @param tokenId  token del que se hablo
 * @param mencion  hora EXACTA del mensaje segun Telegram, no la de ingesta
 */
export async function calcularAnticipacion(
  tokenId: number,
  mencion: Date,
): Promise<Anticipacion> {
  // Se miran precios desde un poco antes de la mencion: hace falta saber
  // si el movimiento ya venia de antes.
  const desde = new Date(mencion.getTime() - 2 * 60 * 60 * 1000);
  const hasta = new Date(mencion.getTime() + VENTANA_HORAS * 60 * 60 * 1000);

  const filas = await query<FilaPrecio>(
    `SELECT ts, price_usd
       FROM token_snapshots
      WHERE token_id = $1 AND ts BETWEEN $2 AND $3 AND price_usd IS NOT NULL
      ORDER BY ts ASC`,
    [tokenId, desde, hasta],
  );

  if (filas.length < 3) {
    return {
      segundos: null, precioMencion: null, precioMovimiento: null, subidaPct: null,
      veredicto: 'sin_datos',
      detalle: `Solo ${filas.length} mediciones de precio en la ventana; no alcanza para decidir.`,
    };
  }

  const puntos = filas
    .map((f) => ({ ts: new Date(f.ts).getTime(), precio: Number(f.price_usd) }))
    .filter((p) => Number.isFinite(p.precio) && p.precio > 0);

  if (puntos.length < 3) {
    return {
      segundos: null, precioMencion: null, precioMovimiento: null, subidaPct: null,
      veredicto: 'sin_datos',
      detalle: 'Los precios guardados no son utilizables.',
    };
  }

  const tMencion = mencion.getTime();

  // Precio de referencia: la ultima medicion ANTES del mensaje. Es el
  // precio que veia quien lo escribio.
  const previos = puntos.filter((p) => p.ts <= tMencion);
  const base = previos.length > 0 ? previos[previos.length - 1] : puntos[0];

  // Primer punto que supera el umbral respecto a esa base.
  const umbral = base.precio * (1 + SUBIDA_MINIMA_PCT / 100);
  const disparo = puntos.find((p) => p.precio >= umbral);

  if (!disparo) {
    return {
      segundos: null,
      precioMencion: base.precio,
      precioMovimiento: null,
      subidaPct: null,
      veredicto: 'sin_movimiento',
      detalle: `El precio no subio un ${SUBIDA_MINIMA_PCT}% en las ${VENTANA_HORAS} h siguientes.`,
    };
  }

  const segundos = Math.round((disparo.ts - tMencion) / 1000);
  const subidaPct = ((disparo.precio - base.precio) / base.precio) * 100;

  // Si el disparo es anterior al mensaje, el movimiento ya estaba en marcha
  // cuando se publico: el canal reacciono, no descubrio.
  if (segundos < 0) {
    return {
      segundos,
      precioMencion: base.precio,
      precioMovimiento: disparo.precio,
      subidaPct: Math.round(subidaPct * 10) / 10,
      veredicto: 'reacciono',
      detalle:
        `El precio ya se habia movido ${Math.abs(Math.round(segundos / 60))} min ` +
        `antes del mensaje. La fuente va por detras del mercado.`,
    };
  }

  return {
    segundos,
    precioMencion: base.precio,
    precioMovimiento: disparo.precio,
    subidaPct: Math.round(subidaPct * 10) / 10,
    veredicto: 'se_adelanto',
    detalle:
      `El mensaje llego ${Math.round(segundos / 60)} min antes de que el precio ` +
      `subiera un ${subidaPct.toFixed(0)}%.`,
  };
}

/**
 * Rellena la anticipacion de las menciones que aun no la tienen.
 *
 * Se ejecuta periodicamente y no en el momento de la mencion, porque en
 * ese instante todavia no ha pasado nada que medir: hay que dejar correr
 * la ventana.
 */
export async function actualizarPendientes(limite = 200): Promise<number> {
  const pendientes = await query<{ id: number; token_id: number; posted_at: Date }>(
    `SELECT m.id, t.id AS token_id, m.posted_at
       FROM tg_mentions m
       JOIN tokens t ON t.chain = m.chain AND t.address = m.address
      WHERE m.anticipacion_seg IS NULL
        -- Solo las que ya tienen la ventana cumplida: antes no hay nada
        -- que medir todavia.
        AND m.posted_at < now() - ($1 || ' hours')::interval
      ORDER BY m.posted_at ASC
      LIMIT $2`,
    [VENTANA_HORAS, limite],
  );

  let hechas = 0;
  for (const p of pendientes) {
    const a = await calcularAnticipacion(p.token_id, new Date(p.posted_at));
    // sin_datos y sin_movimiento se guardan como 0 para no reprocesarlas
    // eternamente; el veredicto se distingue por el signo y por el resto
    // de columnas.
    const valor = a.segundos ?? 0;
    await queryOne(
      'UPDATE tg_mentions SET anticipacion_seg = $2 WHERE id = $1 RETURNING id',
      [p.id, valor],
    );
    hechas++;
  }

  if (hechas > 0) log.info({ hechas }, 'anticipacion calculada');
  return hechas;
}

/**
 * Recalcula la reputacion de cada canal a partir de resultados reales.
 *
 * Nunca se escribe a mano. Un canal que menciona pocos tokens pero
 * siempre antes del movimiento vale mas que uno que menciona cientos
 * cuando ya han subido.
 */
export async function recalcularReputacion(): Promise<number> {
  const filas = await query<{ channel_id: number }>(
    `INSERT INTO tg_source_stats (channel_id, tokens_citados, veces_primero,
                                  anticipacion_med, tasa_utiles, actualizado)
     SELECT m.channel_id,
            COUNT(DISTINCT m.address),
            COUNT(*) FILTER (WHERE m.es_primera),
            AVG(m.anticipacion_seg)::int,
            ROUND(100.0 * COUNT(*) FILTER (WHERE m.anticipacion_seg > 0)
                  / NULLIF(COUNT(*) FILTER (WHERE m.anticipacion_seg IS NOT NULL), 0), 2),
            now()
       FROM tg_mentions m
      GROUP BY m.channel_id
     ON CONFLICT (channel_id) DO UPDATE SET
        tokens_citados   = EXCLUDED.tokens_citados,
        veces_primero    = EXCLUDED.veces_primero,
        anticipacion_med = EXCLUDED.anticipacion_med,
        tasa_utiles      = EXCLUDED.tasa_utiles,
        actualizado      = now()
     RETURNING channel_id`,
  );
  return filas.length;
}
