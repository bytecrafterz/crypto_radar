/**
 * Vigilante de los bucles: avisa cuando un robot deja de trabajar.
 *
 * POR QUE EXISTE
 * El Robot 2 estuvo dos dias parado y nadie se entero. El proceso seguia
 * vivo, el panel respondia y el Robot 1 alertaba con normalidad, asi que
 * por fuera todo parecia correcto. El fallo solo se veia mirando a mano
 * una fecha en la base de datos.
 *
 * Eso es lo peor que puede pasarle a un sistema que trabaja solo: no que
 * se rompa, sino que se rompa a medias y siga aparentando que funciona.
 * Un sistema desatendido tiene que ser capaz de decir que se ha parado.
 *
 * COMO FUNCIONA
 * Cada vuelta de cada bucle deja constancia de que ha pasado por ahi.
 * Este vigilante compara esa hora con lo que cada bucle deberia tardar y,
 * si uno lleva demasiado callado, avisa por el mismo canal que las
 * alertas normales.
 *
 * LO QUE NO HACE
 * No repite el aviso cada vuelta. Un vigilante que avisa cada cinco
 * minutos se silencia igual que una alarma de coche, y entonces deja de
 * servir. Avisa una vez cuando algo se cae, y otra cuando se recupera.
 */
import { getState, setState, logActivity } from '../core/db.js';
import { child } from '../core/logger.js';
import { notify } from './notify.js';

const log = child('vigilante');

/** Cuanto puede tardar un bucle antes de darlo por caido. */
const TOLERANCIA = 3;

/** Ningun bucle se da por caido antes de esto, por lento que sea. */
const MINIMO_MS = 15 * 60_000;

interface Vigilado {
  nombre: string;
  intervaloMs: () => number;
}

const vigilados = new Map<string, Vigilado>();

/** Un bucle se apunta aqui para que se le eche de menos si desaparece. */
export function vigilar(nombre: string, intervaloMs: () => number): void {
  vigilados.set(nombre, { nombre, intervaloMs });
}

/** Cada vuelta que termina deja su hora. */
export async function latir(nombre: string): Promise<void> {
  await setState(`latido:${nombre}`, Date.now()).catch(() => {});
}

/** Cuando arranco este proceso. */
const ARRANQUE = Date.now();

/**
 * Cuanto lleva callado un bucle, contando el arranque como un latido.
 *
 * Sin esto, cada reinicio podia dar falsas alarmas: si el ultimo latido
 * guardado era viejo (una copia de seguridad restaurada, un bucle al que se
 * le cambio el intervalo), el bucle salia como "parado" antes de que le
 * diera tiempo a dar su primera vuelta, y al cliente le llegaba un aviso de
 * "una parte del sistema se ha parado" seguido de otro de "recuperado".
 * Ahora cada bucle tiene, desde el arranque, el mismo margen que en
 * marcha. Si en ese margen no da ninguna vuelta, si se avisa.
 */
export function silencio(ultimo: number | null, ahora: number, arranque = ARRANQUE): number | null {
  if (ultimo === null) return null;
  return ahora - Math.max(ultimo, arranque);
}

/** Cuanto puede estar callado un bucle antes de preocupar. */
function margen(intervaloMs: number): number {
  return Math.max(MINIMO_MS, intervaloMs * TOLERANCIA);
}

export function describirTiempo(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return min === 1 ? '1 minuto' : `${min} minutos`;

  const h = Math.round(min / 60);
  if (h < 48) return h === 1 ? '1 hora' : `${h} horas`;

  const d = Math.round(h / 24);
  return d === 1 ? '1 dia' : `${d} dias`;
}

export interface EstadoTarea {
  nombre: string;
  ultimoLatido: number | null;
  callada_ms: number | null;
  margen_ms: number;
  caida: boolean;
}

/** Foto del estado de todos los bucles, para el panel. */
export async function estadoDeLasTareas(): Promise<EstadoTarea[]> {
  const ahora = Date.now();
  const salida: EstadoTarea[] = [];

  for (const v of vigilados.values()) {
    const ultimo = await getState<number | null>(`latido:${v.nombre}`, null);
    const callada = silencio(ultimo, ahora);
    const m = margen(v.intervaloMs());
    salida.push({
      nombre: v.nombre,
      ultimoLatido: ultimo,
      callada_ms: callada,
      margen_ms: m,
      // Sin ningun latido todavia no se acusa a nadie: puede que el bucle
      // acabe de arrancar y aun no le haya tocado su primera vuelta.
      caida: callada !== null && callada > m,
    });
  }

  return salida;
}

/**
 * Una pasada del vigilante.
 *
 * Devuelve cuantos bucles estan caidos ahora mismo.
 */
export async function runVigilante(): Promise<number> {
  const tareas = await estadoDeLasTareas();
  const caidas = tareas.filter((t) => t.caida);

  // Se recuerda a quien ya se aviso, para no repetir el mismo aviso una y
  // otra vez y acabar siendo ruido que se ignora.
  const avisadas = await getState<string[]>('vigilante:avisadas', []);
  const ahoraCaidas = caidas.map((c) => c.nombre);

  const nuevas = caidas.filter((c) => !avisadas.includes(c.nombre));
  const recuperadas = avisadas.filter((n) => !ahoraCaidas.includes(n));

  for (const c of nuevas) {
    const texto = describirTiempo(c.callada_ms ?? 0);
    log.error({ tarea: c.nombre, callada: texto }, 'un bucle lleva demasiado tiempo sin dar senales');
    await logActivity('error', 'vigilante', `La tarea ${c.nombre} lleva ${texto} sin dar senales.`);
    await notify(
      `⚠️ <b>Una parte del sistema se ha parado</b>\n\n` +
        `La tarea <b>${c.nombre}</b> lleva ${texto} sin dar senales de vida.\n\n` +
        `El resto sigue funcionando. Esto avisa de que algo se ha quedado ` +
        `atascado, que es justo lo que antes pasaba sin que nadie lo notara.`,
      { subject: `Tarea parada: ${c.nombre}` },
    ).catch(() => {});
  }

  for (const nombre of recuperadas) {
    log.info({ tarea: nombre }, 'el bucle ha vuelto a funcionar');
    await logActivity('info', 'vigilante', `La tarea ${nombre} ha vuelto a funcionar.`);
    await notify(
      `✅ <b>Recuperado</b>\n\nLa tarea <b>${nombre}</b> ha vuelto a funcionar con normalidad.`,
      { subject: `Recuperado: ${nombre}` },
    ).catch(() => {});
  }

  if (nuevas.length > 0 || recuperadas.length > 0) {
    await setState('vigilante:avisadas', ahoraCaidas);
  }

  return caidas.length;
}
