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
