/**
 * Acceso a PostgreSQL.
 */
import pg from 'pg';
import { env } from './env.js';
import { child } from './logger.js';

const log = child('db');

// Los NUMERIC de Postgres llegan como texto por defecto; los queremos como numero.
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// int8 (BIGINT) tambien como numero: nuestros contadores caben de sobra.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => log.error({ err }, 'error inesperado en el pool de conexiones'));

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await pool.query<T>(text, params as never[]);
  return res.rows;
}

export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function exec(text: string, params: unknown[] = []): Promise<number> {
  const res = await pool.query(text, params as never[]);
  return res.rowCount ?? 0;
}

/** Ejecuta varias sentencias dentro de una transaccion. */
export async function transaction<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Espera a que la base de datos responda. Util al arrancar con docker. */
export async function waitForDb(maxSeconds = 60): Promise<void> {
  const deadline = Date.now() + maxSeconds * 1000;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      lastErr = err;
      log.warn('esperando a la base de datos...');
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  throw new Error(`La base de datos no responde: ${String(lastErr)}`);
}

// --- Estado interno -------------------------------------------------------

export async function getState<T>(key: string, fallback: T): Promise<T> {
  const row = await queryOne<{ value: T }>('SELECT value FROM system_state WHERE key = $1', [key]);
  return row ? row.value : fallback;
}

export async function setState(key: string, value: unknown): Promise<void> {
  await exec(
    `INSERT INTO system_state (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

// --- Registro de actividad ------------------------------------------------

export async function logActivity(
  level: 'info' | 'warn' | 'error',
  area: string,
  message: string,
  data?: unknown,
): Promise<void> {
  try {
    await exec('INSERT INTO activity_log (level, area, message, data) VALUES ($1, $2, $3, $4)', [
      level,
      area,
      message,
      data ? JSON.stringify(data) : null,
    ]);
  } catch (err) {
    log.warn({ err }, 'no se pudo escribir en activity_log');
  }
}

/** Guarda el consumo diario de cada API. */
export async function recordUsage(
  provider: string,
  calls: number,
  errors: number,
  rateHits: number,
): Promise<void> {
  await exec(
    `INSERT INTO api_usage (day, provider, calls, errors, rate_hits)
     VALUES (CURRENT_DATE, $1, $2, $3, $4)
     ON CONFLICT (day, provider) DO UPDATE
       SET calls = $2, errors = $3, rate_hits = $4`,
    [provider, calls, errors, rateHits],
  );
}

export async function closeDb(): Promise<void> {
  await pool.end();
}
