/**
 * Motor del radar: coordina deteccion, analisis y seguimiento.
 *
 * Cada tarea corre en su propio bucle y nunca se solapa consigo misma.
 * Si una vuelta falla, se registra y se sigue: el sistema no se para.
 */
import { child } from '../core/logger.js';
import { getFilters, validateConfig } from '../core/config.js';
import { logActivity, recordUsage } from '../core/db.js';
import { getUsage } from '../core/http.js';
import { env, checkEnv } from '../core/env.js';
import { runDiscovery } from './discovery.js';
import { runEnrichment } from './enrichment.js';
import { runMonitor } from './monitor.js';
import { startTelegram, stopTelegram } from './telegram.js';
import { runColector } from '../telegram/colector.js';
import { comprobar as comprobarBot } from '../telegram/bot.js';
import { actualizarPendientes, recalcularReputacion } from '../telegram/anticipacion.js';
import { runDescubrimiento } from '../telegram/descubrimiento.js';
import { runColectorMt, sincronizarCanales } from '../telegram/colector-mt.js';
import { estaConfigurado as mtprotoListo } from '../telegram/mtproto.js';
import { notify, activeChannels } from './notify.js';

const log = child('motor');

let running = false;
const timers: NodeJS.Timeout[] = [];

/**
 * Bucle que se reprograma solo despues de cada vuelta.
 * Asi nunca hay dos ejecuciones de la misma tarea a la vez.
 */
function loop(name: string, intervalMs: () => number, task: () => Promise<unknown>): void {
  let busy = false;

  const tick = async () => {
    if (!running) return;
    if (busy) {
      log.warn({ tarea: name }, 'la vuelta anterior sigue en curso, se salta esta');
    } else {
      busy = true;
      const started = Date.now();
      try {
        await task();
      } catch (err) {
        log.error({ tarea: name, err: String(err) }, 'error en la tarea');
        await logActivity('error', name, `Error en la tarea: ${String(err)}`).catch(() => {});
      } finally {
        busy = false;
        const elapsed = Date.now() - started;
        if (elapsed > 60_000) log.warn({ tarea: name, segundos: Math.round(elapsed / 1000) }, 'vuelta lenta');
      }
    }
    if (running) {
      const t = setTimeout(tick, intervalMs());
      timers.push(t);
    }
  };

  // Arranque escalonado para no lanzar todo a la vez.
  const delay = name === 'deteccion' ? 2000 : name === 'analisis' ? 12_000 : 25_000;
  timers.push(setTimeout(tick, delay));
}

/** Guarda el consumo de APIs para poder verlo en el panel. */
async function persistUsage(): Promise<void> {
  for (const u of getUsage()) {
    await recordUsage(u.provider, u.callsToday, u.totalErrors, u.total429).catch(() => {});
  }
}

export async function startWorker(): Promise<void> {
  if (running) return;
  running = true;

  const problems = validateConfig();
  for (const p of problems) log.warn(p);

  const warnings = checkEnv();
  for (const w of warnings) log.warn(w);

  await startTelegram();

  const filters = getFilters();

  loop('deteccion', () => getFilters().discovery.interval_seconds * 1000, runDiscovery);
  loop('analisis', () => 60_000, runEnrichment);
  loop('seguimiento', () => getFilters().monitoring.interval_minutes * 60_000, runMonitor);
  loop('consumo', () => 300_000, persistUsage);

  // --- Robot 2: radar de informacion en Telegram -------------------------
  // Solo arranca si hay token configurado. Sin el, el resto del sistema
  // funciona exactamente igual que antes.
  if (process.env.TELEGRAM_RADAR_TOKEN) {
    const bot = await comprobarBot();
    if (bot.ok) {
      log.info({ bot: '@' + bot.usuario }, 'Robot 2 activo');

      // Cada 30 s: leer mensajes nuevos y pasarlos por la cadena.
      loop('robot2-colector', () => 30_000, runColector);

      // Cada 30 min: calcular si las menciones se adelantaron al
      // movimiento. No puede hacerse al recibir el mensaje porque en ese
      // momento todavia no ha pasado nada que medir.
      loop('robot2-anticipacion', () => 30 * 60_000, () => actualizarPendientes());

      // Cada 6 h: rehacer la reputacion de cada canal con los resultados
      // reales acumulados.
      loop('robot2-reputacion', () => 6 * 60 * 60_000, recalcularReputacion);

      // --- Descubrimiento automatico de canales -------------------------
      // Solo si hay credenciales de cuenta de usuario: un bot normal no
      // puede buscar canales ni unirse por su cuenta.
      //
      // Cada 2 horas, y con un tope de 3 uniones al dia dentro del propio
      // modulo. El ritmo importa mas que el volumen: Telegram restringe
      // las cuentas que se unen deprisa, no las que leen mucho.
      if (mtprotoListo()) {
        log.info('descubrimiento automatico de canales activo');
        loop('robot2-descubrimiento', () => 2 * 60 * 60_000, runDescubrimiento);

        // Lectura de los canales en los que la cuenta ya esta dentro.
        // Cada canal es una llamada, asi que se leen pocos por vuelta y
        // se empieza siempre por los que llevan mas tiempo sin mirarse.
        loop('robot2-lectura', () => 90_000, runColectorMt);

        // Cada hora se comprueba si la cuenta ha entrado en canales
        // nuevos, para registrarlos como fuentes.
        loop('robot2-sincronizar', () => 60 * 60_000, sincronizarCanales);
      } else {
        log.info('sin credenciales MTProto: el Robot 2 solo lee donde se le invite');
      }
    } else {
      log.warn({ error: bot.error }, 'token de Telegram configurado pero el bot no responde');
    }
  }

  log.info(
    {
      cadenas: filters.discovery.chains,
      deteccion_seg: filters.discovery.interval_seconds,
      seguimiento_min: filters.monitoring.interval_minutes,
      solana: env.hasHelius ? 'Helius' : 'RPC publico',
      base: env.hasAlchemy ? 'Alchemy' : 'RPC publico',
    },
    'motor arrancado',
  );

  await logActivity('info', 'sistema', 'El motor del radar ha arrancado.');

  // Aviso de arranque: sirve para confirmar de un vistazo que los canales van.
  const canales = activeChannels();
  if (canales.length > 0 && !env.alertsMuted) {
    const modo = env.hasHelius && env.hasAlchemy ? 'con claves propias' : 'con RPC publicos';
    await notify(
      [
        '✅ <b>Crypto Radar arrancado</b>',
        '',
        `Vigilando: ${filters.discovery.chains.join(', ')}`,
        `Deteccion cada ${filters.discovery.interval_seconds} segundos (${modo}).`,
        `Canales de aviso activos: ${canales.join(', ')}.`,
      ].join('\n'),
      { subject: 'Crypto Radar · sistema arrancado' },
    ).catch(() => {});
  } else if (canales.length === 0) {
    log.warn('ningun canal de avisos configurado: el sistema analiza y guarda, pero no avisa');
  }
}

export async function stopWorker(): Promise<void> {
  running = false;
  for (const t of timers) clearTimeout(t);
  timers.length = 0;
  await persistUsage().catch(() => {});
  await stopTelegram();
  log.info('motor detenido');
}
