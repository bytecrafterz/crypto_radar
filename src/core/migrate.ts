/**
 * Ejecuta las migraciones SQL de db/migrations en orden alfabetico.
 * Cada fichero se aplica una sola vez; queda registrado en schema_migrations.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from './env.js';
import { pool, waitForDb, closeDb } from './db.js';
import { child } from './logger.js';

const log = child('migrate');
const MIGRATIONS_DIR = resolve(ROOT, 'db', 'migrations');

export async function runMigrations(): Promise<void> {
  await waitForDb();

  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const applied = new Set(
    (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map(
      (r) => r.name,
    ),
  );

  let count = 0;
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(resolve(MIGRATIONS_DIR, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
      await client.query('COMMIT');
      log.info({ file }, 'migracion aplicada');
      count++;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      log.error({ file, err }, 'fallo la migracion');
      throw err;
    } finally {
      client.release();
    }
  }

  if (count === 0) log.info('base de datos ya actualizada');
  else log.info({ count }, 'migraciones aplicadas');
}

// Permite ejecutarlo directamente: npm run migrate
const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('migrate.ts') || process.argv[1].endsWith('migrate.js'));

if (isMain) {
  runMigrations()
    .then(() => closeDb())
    .then(() => process.exit(0))
    .catch((err) => {
      log.error({ err }, 'error ejecutando migraciones');
      process.exit(1);
    });
}
