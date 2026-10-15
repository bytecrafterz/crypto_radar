/**
 * Estado de los tres robots, cada uno por separado.
 *
 * El cliente no piensa en tareas ("robot2-colector", "seguimiento"...) sino
 * en sus tres robots: quiere saber si cada uno esta funcionando y que ha
 * sacado hoy. Aqui se agrupan las tareas del vigilante por robot y se
 * juntan las cifras del dia de cada uno. Lo usan el panel y el bot.
 */
import { query, queryOne } from '../core/db.js';
import { getFilters } from '../core/config.js';
import { getDashboardStats } from '../core/repo.js';
import { fmtNum } from '../core/util.js';
import { estadoDeLasTareas, type EstadoTarea } from './vigilante.js';

export type EstadoRobot = 'funcionando' | 'parado' | 'arrancando';

export interface ResumenRobot {
  id: 'robot1' | 'robot2' | 'robot3';
  nombre: string;
  funcion: string;
  estado: EstadoRobot;
  /** Tareas de este robot que llevan demasiado sin dar senales. */
  paradas: string[];
  /** Cuanto hace de la ultima vuelta de cualquiera de sus tareas. */
  ultimaVueltaMs: number | null;
  cifras: Array<{ etiqueta: string; valor: number }>;
  nota: string | null;
  ruta: string;
}

/** Que tareas son de cada robot. Las del sistema (vigilante, consumo) no cuentan. */
const TAREAS: Record<ResumenRobot['id'], (nombre: string) => boolean> = {
  robot1: (n) => ['deteccion', 'analisis', 'seguimiento'].includes(n),
  robot2: (n) => n.startsWith('robot2-'),
  robot3: (n) => n.startsWith('robot3-'),
};

/**
 * Cada cuanto da una vuelta cada tarea. Hace falta para juzgar los latidos
 * de un robot que corre en OTRO proceso (ROBOTS=...): este proceso no tiene
 * sus bucles apuntados, pero si ve sus latidos en la base de datos.
 */
function intervalos(): Record<string, number> {
  const f = getFilters();
  return {
    deteccion: f.discovery.interval_seconds * 1000,
    analisis: 60_000,
    seguimiento: f.monitoring.interval_minutes * 60_000,
    'robot2-colector': 30_000,
    'robot2-descubrimiento': 2 * 3_600_000,
    'robot2-lectura': 90_000,
    'robot2-sincronizar': 3_600_000,
    'robot2-anticipacion': 5 * 60_000,
    'robot2-reputacion': 30 * 60_000,
    'robot2-clasificador': 3 * 60_000,
    'robot3-convergencia': 5 * 60_000,
  };
}

/** Las tareas de los robots que no corren en este proceso, por sus latidos guardados. */
async function tareasDeOtrosProcesos(locales: Set<string>): Promise<EstadoTarea[]> {
  const filas = await query<{ key: string; value: number }>(
    "SELECT key, value FROM system_state WHERE key LIKE 'latido:%'",
  );
  const iv = intervalos();
  const ahora = Date.now();
  return filas
    .map((f) => ({ nombre: f.key.slice('latido:'.length), ultimo: Number(f.value) }))
    .filter((t) => !locales.has(t.nombre) && iv[t.nombre] !== undefined && Number.isFinite(t.ultimo))
    .map((t) => {
      const margen = Math.max(15 * 60_000, iv[t.nombre] * 3);
      const callada = ahora - t.ultimo;
      return { nombre: t.nombre, ultimoLatido: t.ultimo, callada_ms: callada, margen_ms: margen, caida: callada > margen };
    });
}

/**
 * Estado de un robot a partir de sus tareas.
 *
 * Basta una tarea parada para dar el robot por parado: un robot que lee
 * Telegram pero no clasifica nada parece vivo y no sirve.
 */
export function estadoDeRobot(tareas: EstadoTarea[]): { estado: EstadoRobot; paradas: string[]; ultimaVueltaMs: number | null } {
  const paradas = tareas.filter((t) => t.caida).map((t) => t.nombre);
  const vueltas = tareas.map((t) => t.callada_ms).filter((ms): ms is number => ms !== null);
  const ultimaVueltaMs = vueltas.length > 0 ? Math.min(...vueltas) : null;
  if (paradas.length > 0) return { estado: 'parado', paradas, ultimaVueltaMs };
  if (tareas.length === 0 || vueltas.length === 0) return { estado: 'arrancando', paradas, ultimaVueltaMs };
  return { estado: 'funcionando', paradas, ultimaVueltaMs };
}

function fechaCorta(d: Date): string {
  return d.toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export async function resumenRobots(): Promise<ResumenRobot[]> {
  const [tareas, stats, r1, r2, r3] = await Promise.all([
    estadoDeLasTareas(),
    getDashboardStats(),
    queryOne<{ oportunidad: number; peligro: number }>(
      `SELECT COUNT(*) FILTER (WHERE kind = 'oportunidad')::int AS oportunidad,
              COUNT(*) FILTER (WHERE kind = 'peligro')::int AS peligro
         FROM alerts WHERE ts > CURRENT_DATE`,
    ),
    queryOne<{ mensajes: number; canales: number; tokens: number; resumidos: number }>(
      `SELECT (SELECT COUNT(*)::int FROM tg_messages WHERE posted_at > CURRENT_DATE) AS mensajes,
              (SELECT COUNT(*)::int FROM tg_channels WHERE active) AS canales,
              (SELECT COUNT(DISTINCT (chain, address))::int FROM tg_mentions WHERE posted_at > CURRENT_DATE) AS tokens,
              (SELECT COUNT(*)::int FROM tg_messages WHERE clasificado_at > CURRENT_DATE) AS resumidos`,
    ),
    Promise.all([
      query<{ nivel: string; n: number }>(
        `SELECT nivel, COUNT(*)::int AS n FROM tg_candidatos WHERE creado_at > CURRENT_DATE GROUP BY nivel`,
      ),
      queryOne<{ avisos: number; ultimo: Date | null }>(
        `SELECT COUNT(*) FILTER (WHERE enviado_at > CURRENT_DATE)::int AS avisos, MAX(enviado_at) AS ultimo
           FROM tg_candidatos`,
      ),
    ]),
  ]);

  // Un robot sin bucles en este proceso puede estar corriendo en otro: se
  // le juzga por los latidos que deja en la base de datos.
  const remotas = await tareasDeOtrosProcesos(new Set(tareas.map((t) => t.nombre)));
  const de = (id: ResumenRobot['id']) => {
    const locales = tareas.filter((t) => TAREAS[id](t.nombre));
    return estadoDeRobot(locales.length > 0 ? locales : remotas.filter((t) => TAREAS[id](t.nombre)));
  };
  const [niveles, avisosR3] = r3;
  const nivel = (n: string) => niveles.find((x) => x.nivel === n)?.n ?? 0;
  const cruzados = niveles.reduce((a, x) => a + x.n, 0);

  return [
    {
      id: 'robot1',
      nombre: 'Robot 1 · Oportunidades',
      funcion: 'Detecta tokens nuevos en Solana y Base, los analiza a fondo y avisa de oportunidades y peligros.',
      ...de('robot1'),
      cifras: [
        { etiqueta: 'Detectados hoy', valor: stats.tokensToday },
        { etiqueta: 'Analizados a fondo', valor: stats.enrichedToday },
        { etiqueta: 'Avisos de oportunidad', valor: r1?.oportunidad ?? 0 },
        { etiqueta: 'Avisos de peligro', valor: r1?.peligro ?? 0 },
      ],
      nota: `${fmtNum(stats.tracked)} tokens en seguimiento ahora mismo.`,
      ruta: '/tokens',
    },
    {
      id: 'robot2',
      nombre: 'Robot 2 · Telegram',
      funcion: 'Lee canales de Telegram, separa la informacion del ruido y anota que tokens se mencionan y cuando.',
      ...de('robot2'),
      cifras: [
        { etiqueta: 'Mensajes leidos hoy', valor: r2?.mensajes ?? 0 },
        { etiqueta: 'Canales que lee', valor: r2?.canales ?? 0 },
        { etiqueta: 'Tokens mencionados', valor: r2?.tokens ?? 0 },
        { etiqueta: 'Resumidos en espanol', valor: r2?.resumidos ?? 0 },
      ],
      nota: 'No envia avisos propios: lo que encuentra lo analiza el Robot 1 y lo cruza el Robot 3.',
      ruta: '/telegram',
    },
    {
      id: 'robot3',
      nombre: 'Robot 3 · Convergencia',
      funcion: 'Cruza lo que se dice en Telegram con el analisis del Robot 1 y solo avisa cuando los dos coinciden.',
      ...de('robot3'),
      cifras: [
        { etiqueta: 'Tokens cruzados hoy', valor: cruzados },
        { etiqueta: 'Convergencia', valor: nivel('naranja') },
        { etiqueta: 'Convergencia fuerte', valor: nivel('rojo') },
        { etiqueta: 'Avisos enviados', valor: avisosR3?.avisos ?? 0 },
      ],
      nota: avisosR3?.ultimo
        ? `Es muy exigente a proposito: solo avisa en convergencia fuerte. Ultimo aviso: ${fechaCorta(new Date(avisosR3.ultimo))}.`
        : 'Es muy exigente a proposito: solo avisa en convergencia fuerte. Aun no ha enviado ninguno.',
      ruta: '/convergencia',
    },
  ];
}
