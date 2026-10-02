/**
 * Segunda etapa del triaje: informacion o publicidad.
 *
 * QUE APORTA SOBRE LAS REGLAS
 * La primera etapa es gratis y tira lo evidente. Lo que no sabe hacer es
 * distinguir estos dos mensajes:
 *
 *   "SOL/USDC liquidez bloqueada 6 meses, contrato 0x... auditado"
 *   "PROXIMO 100X ya con liquidez bloqueada, contrato 0x..., entra ya"
 *
 * Los dos nombran un contrato, los dos dicen "liquidez bloqueada" y los
 * dos pasan las reglas. Pero uno informa y el otro vende. Separarlos
 * necesita entender el texto, no buscar palabras.
 *
 * POR QUE IMPORTA TANTO
 * Una promocion pagada que se cuela como si fuera informacion acaba
 * contando como FUENTE en el Robot 3. Y ahi es donde mas dano hace: dos
 * canales pagados por la misma persona parecen dos fuentes
 * independientes, que es justo lo que dispara una alerta.
 *
 * SIN MODELO CONFIGURADO NO HACE NADA
 * Si no hay clave, esta etapa se salta entera y el sistema funciona como
 * hasta ahora. Es una mejora, no una pieza que falte.
 */
import { query, exec } from '../core/db.js';
import { child } from '../core/logger.js';
import { preguntar, hayModelo, cuotaAgotada } from '../core/llm.js';

const log = child('clasificador');

/** Mensajes por vuelta. Bajo a proposito: esto puede costar dinero. */
const POR_VUELTA = 8;

/**
 * Intentos antes de rendirse con un mensaje.
 *
 * Un fallo del proveedor o un limite por minuto no dicen nada sobre el
 * mensaje. Marcarlo como imposible de clasificar a la primera es perder
 * informacion por un problema que dura dos minutos.
 */
const INTENTOS_MAXIMOS = 3;

export type Clase = 'informacion' | 'promocion' | 'hype' | 'indeterminado';

// CORTA A PROPOSITO
// La cuota gratuita del modelo se cuenta en tokens, y estas instrucciones
// se mandan con cada mensaje. Cada palabra de mas aqui son cientos de
// mensajes menos clasificados al dia.
const INSTRUCCION = `Filtras mensajes de canales de cripto, escritos en espanol, portugues o ingles.
Responde SOLO este JSON, sin nada alrededor:
{"clase":"informacion|promocion|hype","confianza":85,"motivo":"","idioma":"es|pt|en|otro","tipo":"general","resumen":"","afirmaciones":[]}

clase: informacion = dato concreto y comprobable (listado, auditoria, liquidez bloqueada con plazo,
compra de una cartera grande, desbloqueo, aviso de estafa). promocion = vende un token con urgencia o
promesas ("entra ya", "100x", "nao perca", referidos), aunque traiga datos. hype = entusiasmo sin datos.
En la duda entre informacion y promocion, promocion.
confianza: entero de 0 a 100.
motivo: en espanol, menos de 15 palabras.
tipo: listing (exchange), lanzamiento (token nuevo o preventa), partnership, whale (cartera grande),
negativo (estafa, rug, honeypot, equipo vendio, liquidez retirada), llamada (solo recomienda comprar), general.
resumen: una frase en espanol de menos de 25 palabras con lo que afirma del token, sin lenguaje de venta.
afirmaciones: solo las que dice expresamente: liquidez_bloqueada, sin_permisos (mint o freeze revocados,
contrato renunciado), sin_impuestos (0% de impuesto), no_honeypot (se puede vender), advertencia
(estafa, rug, honeypot, equipo vendio, liquidez retirada).`;

export type Afirmacion =
  | 'liquidez_bloqueada' | 'sin_permisos' | 'sin_impuestos' | 'no_honeypot' | 'advertencia';

export const AFIRMACIONES: readonly Afirmacion[] = [
  'liquidez_bloqueada', 'sin_permisos', 'sin_impuestos', 'no_honeypot', 'advertencia',
];

export type TipoSenal =
  | 'listing' | 'lanzamiento' | 'partnership' | 'whale' | 'negativo' | 'llamada' | 'general';

const TIPOS: readonly TipoSenal[] = [
  'listing', 'lanzamiento', 'partnership', 'whale', 'negativo', 'llamada', 'general',
];

export interface Veredicto {
  clase: Clase;
  confianza: number;
  motivo: string;
  /** es | pt | en | otro, o null si el modelo no lo dijo. */
  idioma: string | null;
  tipo: TipoSenal;
  /** Lo que afirma el mensaje, en espanol. null si el modelo no lo dio. */
  resumen: string | null;
  afirmaciones: Afirmacion[];
}

/**
 * Lee la respuesta del modelo.
 *
 * Los modelos envuelven el JSON en explicaciones o en bloques de codigo
 * por mucho que se les pida que no. Se busca el JSON dentro del texto en
 * vez de confiar en que venga limpio.
 */
export function leerRespuesta(texto: string | null): Veredicto | null {
  if (!texto) return null;

  // Si el modelo razona en voz alta, el razonamiento va entre <think> y
  // puede llevar llaves que no son la respuesta.
  const limpio = texto.replace(/<think>[\s\S]*?<\/think>/g, '');
  const trozo = limpio.match(/\{[\s\S]*?\}/);
  if (!trozo) return null;

  try {
    const j = JSON.parse(trozo[0]) as Record<string, unknown>;
    const clase = String(j.clase ?? '').toLowerCase();
    if (!['informacion', 'promocion', 'hype'].includes(clase)) return null;

    let confianza = Number(j.confianza);
    // Se pide entero de 0 a 100 y aun asi hay modelos que contestan 0.98.
    // Sin esto, un 98 por ciento de confianza se guardaba como un 1.
    if (Number.isFinite(confianza) && confianza > 0 && confianza <= 1) confianza *= 100;

    const idioma = String(j.idioma ?? '').toLowerCase().slice(0, 5);
    const tipo = String(j.tipo ?? '').toLowerCase() as TipoSenal;
    const resumen = String(j.resumen ?? '').trim().slice(0, 300);
    // Solo se aceptan afirmaciones de la lista: lo que el modelo invente
    // fuera de ella no se puede comprobar contra la cadena.
    const afirmaciones = Array.isArray(j.afirmaciones)
      ? [...new Set(j.afirmaciones.map((x) => String(x).toLowerCase()))]
          .filter((x): x is Afirmacion => (AFIRMACIONES as readonly string[]).includes(x))
      : [];

    return {
      clase: clase as Clase,
      // Una confianza que no viene o viene rara no puede tomarse por
      // buena: se queda en la mitad, que no inclina la decision.
      confianza: Number.isFinite(confianza) ? Math.max(0, Math.min(100, Math.round(confianza))) : 50,
      motivo: String(j.motivo ?? '').slice(0, 200),
      idioma: ['es', 'pt', 'en', 'otro'].includes(idioma) ? idioma : null,
      tipo: (TIPOS as readonly string[]).includes(tipo) ? tipo : 'general',
      resumen: resumen || null,
      afirmaciones,
    };
  } catch {
    return null;
  }
}

/** Clasifica un texto suelto. Devuelve null si no hay modelo o falla. */
export async function clasificar(texto: string): Promise<Veredicto | null> {
  if (!hayModelo()) return null;
  // Mensajes larguisimos se recortan: el principio ya dice de que va, y
  // pagar por leer mil lineas de firma no aporta nada.
  const respuesta = await preguntar(INSTRUCCION, texto.slice(0, 1200), 1000);
  return leerRespuesta(respuesta);
}

/** Guarda lo que dijo el modelo sobre un mensaje y sobre sus menciones. */
async function guardar(id: number, v: Veredicto): Promise<void> {
  await exec(
    `UPDATE tg_messages
        SET clasificacion = $2, clasificacion_motivo = $3,
            clasificacion_confianza = $4, clasificado_at = now(),
            idioma = $5, tipo_senal = $6, resumen_es = $7, afirmaciones = $8
      WHERE id = $1`,
    [id, v.clase, v.motivo, v.confianza, v.idioma, v.tipo, v.resumen, JSON.stringify(v.afirmaciones)],
  );
  // El tipo de senal va tambien a las menciones, que es donde lo lee el
  // Robot 3. Antes nadie lo escribia: valia siempre "general", y las
  // reglas del Robot 3 que dependen de el no se activaban nunca.
  await exec('UPDATE tg_mentions SET tipo_senal = $2 WHERE message_id = $1', [id, v.tipo]);
}

/**
 * Clasifica los mensajes que pasaron las reglas y aun no se han mirado.
 *
 * Si sobra hueco en la vuelta, se rellena el resumen en espanol de los ya
 * clasificados en los ultimos dias que aun no lo tienen (los de antes de
 * que existiera). Lo nuevo va siempre primero.
 */
export async function runClasificador(): Promise<number> {
  if (!hayModelo()) return 0;
  // Sin cuota no se intenta nada: se sigue en cuanto vuelva a haberla.
  if (cuotaAgotada()) return 0;

  const pendientes = await query<{ id: number; text: string; clasificacion_intentos: number }>(
    `WITH p AS (
       SELECT id, text, clasificacion_intentos, channel_id, posted_at,
              EXISTS (SELECT 1 FROM tg_mentions me WHERE me.message_id = tg_messages.id) AS con_token
         FROM tg_messages
        WHERE triage = 'candidato' AND clasificado_at IS NULL AND text IS NOT NULL
          AND clasificacion_intentos < $2
     )
     SELECT id, text, clasificacion_intentos FROM p
      -- Primero los que nombran un token ya identificado: son los que
      -- cuentan como fuentes para el Robot 3. La cuota del modelo es
      -- limitada y no debe irse en mensajes que no llevan a nada.
      --
      -- Y POR TURNOS ENTRE CANALES: el mas reciente de cada canal, luego el
      -- segundo de cada uno, y asi. Antes iban solo por fecha, y un bot que
      -- publica 2.000 mensajes al dia (KOLscope) se llevaba toda la cuota:
      -- los mensajes de los demas canales no se resumian nunca.
      ORDER BY con_token DESC,
               ROW_NUMBER() OVER (PARTITION BY channel_id, con_token ORDER BY posted_at DESC),
               posted_at DESC
      LIMIT $1`,
    [POR_VUELTA, INTENTOS_MAXIMOS],
  );

  let hechos = 0;
  for (const m of pendientes) {
    const v = await clasificar(m.text);

    if (v) {
      await guardar(m.id, v);
      hechos++;
      continue;
    }

    // Sin cuota del modelo: el mensaje no tiene la culpa. No se le cuenta
    // el intento y se para la vuelta hasta que vuelva a haber cuota.
    if (cuotaAgotada()) {
      log.info({ clasificados: hechos }, 'cuota del modelo agotada; se sigue cuando vuelva a haberla');
      return hechos;
    }

    // No hubo respuesta. Puede ser un limite por minuto o una caida
    // pasajera, que no dicen nada sobre el mensaje. Se apunta el intento
    // y se deja para la proxima vuelta; solo despues de varios intentos
    // se da por imposible.
    const intentos = m.clasificacion_intentos + 1;
    if (intentos >= INTENTOS_MAXIMOS) {
      await exec(
        `UPDATE tg_messages
            SET clasificacion = 'indeterminado', clasificacion_motivo = $2,
                clasificacion_intentos = $3, clasificado_at = now()
          WHERE id = $1`,
        [m.id, `el modelo no respondio en ${INTENTOS_MAXIMOS} intentos`, intentos],
      );
    } else {
      await exec('UPDATE tg_messages SET clasificacion_intentos = $2 WHERE id = $1', [m.id, intentos]);
      // El proveedor esta fallando ahora mismo: insistir con los demas de
      // esta vuelta solo gasta intentos. Se corta y se sigue en la
      // siguiente.
      if (hechos > 0) log.info({ clasificados: hechos }, 'vuelta del clasificador');
      return hechos;
    }
  }

  // Hueco sobrante: resumen de lo clasificado antes de que hubiera resumen.
  const hueco = POR_VUELTA - pendientes.length;
  let resumidos = 0;
  if (hueco > 0) {
    const atrasados = await query<{ id: number; text: string }>(
      `SELECT id, text FROM tg_messages
        WHERE clasificado_at IS NOT NULL AND resumen_es IS NULL AND text IS NOT NULL
          AND clasificacion <> 'indeterminado'
          AND posted_at > now() - interval '3 days'
        ORDER BY posted_at DESC
        LIMIT $1`,
      [hueco],
    );
    for (const m of atrasados) {
      if (cuotaAgotada()) break;
      const v = await clasificar(m.text);
      if (!v) break;
      await guardar(m.id, v);
      resumidos++;
    }
  }

  if (hechos + resumidos > 0) log.info({ clasificados: hechos, resumidos }, 'vuelta del clasificador');
  return hechos + resumidos;
}
