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
import type { Chain } from '../core/types.js';
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

export interface FilaPrecio {
  ts: Date;
  price_usd: string | number | null;
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

  return medirAnticipacion(filas, mencion);
}

/** La medida en si, sobre precios ya ordenados por hora. Sin base de datos. */
export function medirAnticipacion(filas: FilaPrecio[], mencion: Date): Anticipacion {
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
  // precio que veia quien lo escribio. Si el radar aun no seguia el token,
  // la primera que hay.
  const previos = puntos.filter((p) => p.ts <= tMencion);
  const base = previos.length > 0 ? previos[previos.length - 1] : puntos[0];
  const factor = 1 + SUBIDA_MINIMA_PCT / 100;

  // 1. ¿La subida ya venia de antes del mensaje?
  //
  // Se busca en las horas previas el primer punto que esta un 25% por
  // encima del minimo anterior. Antes se buscaba al reves, precios previos
  // por ENCIMA del precio del mensaje, y eso detecta caidas, no subidas:
  // un canal que publicaba a mitad de una subida salia como "se adelanto"
  // en cuanto el precio seguia subiendo, y ganaba reputacion por llegar
  // tarde, que es justo lo que esta medida tiene que destapar.
  let minimo = previos[0];
  for (const p of previos) {
    if (p.precio < minimo.precio) minimo = p;
    if (p.precio >= minimo.precio * factor) {
      // Como mucho un segundo antes: el movimiento ya estaba en marcha al
      // publicarse, y un 0 se leeria como "a la vez".
      const segundos = Math.min(-1, Math.round((p.ts - tMencion) / 1000));
      const subidaPct = ((p.precio - minimo.precio) / minimo.precio) * 100;
      return {
        segundos,
        precioMencion: base.precio,
        precioMovimiento: p.precio,
        subidaPct: Math.round(subidaPct * 10) / 10,
        veredicto: 'reacciono',
        detalle:
          `El precio ya habia subido un ${subidaPct.toFixed(0)}% ` +
          `${Math.max(1, Math.abs(Math.round(segundos / 60)))} min antes del mensaje. ` +
          'La fuente va por detras del mercado.',
      };
    }
  }

  // 2. ¿Subio despues? Primer punto POSTERIOR al mensaje que supera el
  // umbral respecto al precio que vio quien lo escribio.
  const umbral = base.precio * factor;
  const disparo = puntos.find((p) => p.ts > tMencion && p.ts > base.ts && p.precio >= umbral);

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
 * Veredictos que miden algo de verdad: hubo movimiento y se sabe cuando.
 * "sin_movimiento" y "sin_datos" no dicen nada sobre si la fuente se
 * adelanto, y no pueden contar como anticipacion.
 */
export const VEREDICTOS_CON_MOVIMIENTO = ['se_adelanto', 'reacciono'] as const;

/**
 * Rellena la anticipacion de las menciones que aun no la tienen.
 *
 * Se ejecuta periodicamente y no en el momento de la mencion, porque en
 * ese instante todavia no ha pasado nada que medir.
 *
 * SE MIDE EN CUANTO SE SABE, NO A LAS 24 HORAS
 * Antes se esperaba a que pasara la ventana entera para medir nada. Pero
 * en cuanto el precio sube el umbral ya se sabe, y para siempre, cuando
 * fue el movimiento: lo que pase despues no cambia ese primer cruce. Con
 * la espera, el Robot 3 (que solo mira tokens mencionados en las ultimas
 * 24 horas) no llegaba a ver casi nunca la anticipacion de una mencion
 * reciente, y sin ella no puede dar el nivel maximo. Solo "no se movio" y
 * "no hay datos" necesitan la ventana cumplida para darse por buenos.
 */
export async function actualizarPendientes(
  limite = 1000,
): Promise<{ hechas: number; conMovimiento: Array<{ chain: Chain; address: string }> }> {
  const pendientes = await query<{
    id: number; token_id: number; chain: Chain; address: string; posted_at: Date; cumplida: boolean;
  }>(
    `SELECT m.id, t.id AS token_id, t.chain, t.address, m.posted_at,
            m.posted_at < now() - ($1 || ' hours')::interval AS cumplida
       FROM tg_mentions m
       JOIN tokens t ON t.chain = m.chain AND t.address = m.address
      WHERE m.anticipacion_veredicto IS NULL
        AND m.posted_at < now() - interval '5 minutes'
      -- Primero las que ya se pueden cerrar, para que nunca se queden
      -- esperando detras de las recientes; luego lo mas nuevo.
      ORDER BY cumplida DESC, m.posted_at DESC
      LIMIT $2`,
    [VENTANA_HORAS, limite],
  );

  let hechas = 0;
  const movidos = new Map<string, { chain: Chain; address: string }>();
  for (const p of pendientes) {
    const a = await calcularAnticipacion(p.token_id, new Date(p.posted_at));
    const conMovimiento = (VEREDICTOS_CON_MOVIMIENTO as readonly string[]).includes(a.veredicto);
    if (!conMovimiento && !p.cumplida) continue;
    if (conMovimiento) movidos.set(`${p.chain}:${p.address}`, { chain: p.chain, address: p.address });

    // Se guarda el veredicto ademas del numero, y el numero solo cuando
    // hubo movimiento.
    //
    // Antes "no se movio" y "no se pudo medir" se guardaban como 0
    // segundos, y el Robot 3 leia ese 0 como "aparecio 0 min antes del
    // movimiento": la mejor anticipacion posible. Asi salio un aviso de
    // maxima prioridad sobre un token que no se habia movido.
    await queryOne(
      `UPDATE tg_mentions
          SET anticipacion_seg = $2, anticipacion_veredicto = $3
        WHERE id = $1 RETURNING id`,
      [p.id, conMovimiento ? a.segundos : null, a.veredicto],
    );
    hechas++;
  }

  if (hechas > 0) log.info({ hechas, conMovimiento: movidos.size }, 'anticipacion calculada');
  return { hechas, conMovimiento: [...movidos.values()] };
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
            AVG(m.anticipacion_seg) FILTER (
              WHERE m.anticipacion_veredicto IN ('se_adelanto', 'reacciono'))::int,
            -- Lo que no se pudo medir no cuenta ni a favor ni en contra.
            -- Tenerlo en el divisor castigaba a un canal por menciones
            -- antiguas que era imposible comprobar: un canal con un
            -- acierto de uno figuraba con un 33% por dos menciones
            -- heredadas de su historico.
            ROUND(100.0 * COUNT(*) FILTER (WHERE m.anticipacion_seg > 0)
                  / NULLIF(COUNT(*) FILTER (
                      WHERE m.anticipacion_veredicto IS NOT NULL
                        AND m.anticipacion_veredicto <> 'sin_datos'), 0), 2),
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
