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

Tu unico trabajo es decidir si un mensaje aporta INFORMACION comprobable
sobre un token o si es PUBLICIDAD disfrazada de informacion.

Responde SOLO con un JSON, sin nada mas alrededor:
{"clase":"informacion|promocion|hype","confianza":85,"motivo":"breve"}

La confianza es un numero ENTERO entre 0 y 100. No uses decimales.

informacion: dice algo concreto y comprobable. Un listado, una auditoria,
  liquidez bloqueada con plazo, un movimiento de una cartera grande, un
  desbloqueo, un contrato con datos verificables, una advertencia de
  estafa. Que este bien o mal escrito da igual.

promocion: promociona un token en concreto usando lenguaje de venta.
  Urgencia, promesas de multiplicar, "entra ya", "no te lo pierdas",
  enlaces de referido. Puede incluir datos reales, pero el proposito es
  que compres, no que sepas.

hype: entusiasmo sin nada concreto. Emojis, "to the moon", "gema", sin
  ningun dato que se pueda comprobar.

Ante la duda entre informacion y promocion, elige promocion: es peor
tratar publicidad como informacion que al reves.

El motivo, en espanol y en menos de quince palabras.`;

export interface Veredicto {
  clase: Clase;
  confianza: number;
  motivo: string;
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

    return {
      clase: clase as Clase,
      // Una confianza que no viene o viene rara no puede tomarse por
      // buena: se queda en la mitad, que no inclina la decision.
      confianza: Number.isFinite(confianza) ? Math.max(0, Math.min(100, Math.round(confianza))) : 50,
      motivo: String(j.motivo ?? '').slice(0, 200),
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
  const respuesta = await preguntar(INSTRUCCION, texto.slice(0, 1500), 800);
  return leerRespuesta(respuesta);
}

/**
 * Clasifica los mensajes que pasaron las reglas y aun no se han mirado.
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
      await exec(
        `UPDATE tg_messages
            SET clasificacion = $2, clasificacion_motivo = $3,
                clasificacion_confianza = $4, clasificado_at = now()
          WHERE id = $1`,
        [m.id, v.clase, v.motivo, v.confianza],
      );
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
      break;
    }
  }

  if (hechos > 0) log.info({ clasificados: hechos }, 'vuelta del clasificador');
  return hechos;
}
