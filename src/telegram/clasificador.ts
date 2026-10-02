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
import { preguntar, hayModelo } from '../core/llm.js';

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

const INSTRUCCION = `Eres un filtro de mensajes de canales de criptomonedas.
Los mensajes pueden venir en espanol, portugues o ingles.

Tu trabajo es decidir si un mensaje aporta INFORMACION comprobable sobre
un token o si es PUBLICIDAD disfrazada de informacion, y resumir en
espanol lo que afirma.

Responde SOLO con un JSON, sin nada mas alrededor:
{"clase":"informacion|promocion|hype","confianza":85,"motivo":"breve",
 "idioma":"es|pt|en|otro","tipo":"listing|lanzamiento|partnership|whale|negativo|llamada|general",
 "resumen":"una frase en espanol","afirmaciones":["liquidez_bloqueada"]}

La confianza es un numero ENTERO entre 0 y 100. No uses decimales.

clase:
informacion: dice algo concreto y comprobable. Un listado, una auditoria,
  liquidez bloqueada con plazo, un movimiento de una cartera grande, un
  desbloqueo, un contrato con datos verificables, una advertencia de
  estafa. Que este bien o mal escrito da igual.
promocion: promociona un token en concreto usando lenguaje de venta.
  Urgencia, promesas de multiplicar, "entra ya", "no te lo pierdas",
  "compre agora", "nao perca", enlaces de referido. Puede incluir datos
  reales, pero el proposito es que compres, no que sepas.
hype: entusiasmo sin nada concreto. Emojis, "to the moon", "gema", sin
  ningun dato que se pueda comprobar.
Ante la duda entre informacion y promocion, elige promocion: es peor
tratar publicidad como informacion que al reves.

idioma: el idioma del mensaje.

tipo: listing (lo listan en un exchange), lanzamiento (token nuevo o
  preventa), partnership (alianza o acuerdo), whale (compra o venta de
  una cartera grande), negativo (aviso de estafa, rug, honeypot, el
  equipo vendio, liquidez retirada), llamada (recomendacion de compra
  sin mas), general (nada de lo anterior).

resumen: UNA frase en espanol, de menos de 25 palabras, con lo que el
  mensaje afirma del token. Sin opinar ni repetir el lenguaje de venta.
  Ejemplo: "Afirma que la liquidez esta bloqueada 6 meses y que el
  contrato esta renunciado."

afirmaciones: solo las que el mensaje dice EXPRESAMENTE, de esta lista:
  liquidez_bloqueada (LP bloqueada o quemada),
  sin_permisos (mint o freeze revocados, contrato renunciado, sin owner),
  sin_impuestos (0% de impuesto o "no tax"),
  no_honeypot (dice que se puede vender, "not a honeypot"),
  advertencia (avisa de estafa, rug, honeypot, que el equipo vendio o que
  retiraron la liquidez).
  Lista vacia si no dice ninguna.

El motivo, en espanol y en menos de quince palabras.`;

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

  const trozo = texto.match(/\{[\s\S]*?\}/);
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
  const respuesta = await preguntar(INSTRUCCION, texto.slice(0, 1500), 1000);
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

  const pendientes = await query<{ id: number; text: string; clasificacion_intentos: number }>(
    `SELECT id, text, clasificacion_intentos FROM tg_messages
      WHERE triage = 'candidato' AND clasificado_at IS NULL AND text IS NOT NULL
        AND clasificacion_intentos < $2
      ORDER BY posted_at DESC
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
      const v = await clasificar(m.text);
      if (!v) break;
      await guardar(m.id, v);
      resumidos++;
    }
  }

  if (hechos + resumidos > 0) log.info({ clasificados: hechos, resumidos }, 'vuelta del clasificador');
  return hechos + resumidos;
}
