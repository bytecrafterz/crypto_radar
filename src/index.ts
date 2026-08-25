/**
 * Punto de entrada: arranca la base de datos, el motor de deteccion
 * y el panel web en un solo proceso.
 *
 * Se hace asi a proposito: en un servidor pequeno un unico proceso consume
 * mucha menos memoria y no hay nada que coordinar entre servicios.
 */
import { logger } from './core/logger.js';
import { env } from './core/env.js';
import { waitForDb, closeDb, logActivity } from './core/db.js';
import { runMigrations } from './core/migrate.js';
import { startWorker, stopWorker } from './worker/index.js';
import { startWeb } from './web/server.js';

const log = logger.child({ mod: 'principal' });

async function main(): Promise<void> {
  log.info({ entorno: env.nodeEnv }, 'arrancando Crypto Radar');

  await waitForDb(90);
  await runMigrations();

  const app = await startWeb();

  if (env.workerEnabled) {
    await startWorker();
  } else {
    log.warn('WORKER_ENABLED=false: solo se ha arrancado el panel web');
  }

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'cerrando');
    try {
      await stopWorker();
      await app.close();
      await logActivity('info', 'sistema', `Sistema detenido (${signal}).`).catch(() => {});
      await closeDb();
    } catch (err) {
      log.error({ err: String(err) }, 'error durante el cierre');
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  // Nunca dejamos caer el proceso por un fallo aislado: se registra y sigue.
  process.on('unhandledRejection', (reason) => {
    log.error({ reason: String(reason) }, 'promesa rechazada sin capturar');
  });
  process.on('uncaughtException', (err) => {
    log.error({ err: String(err) }, 'excepcion no capturada');
  });

  log.info('Crypto Radar en marcha');
}

main().catch(async (err) => {
  log.error({ err: String(err) }, 'fallo al arrancar');
  await closeDb().catch(() => {});
  process.exit(1);
});
