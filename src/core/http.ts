/**
 * Cliente HTTP con control de limites por proveedor.
 *
 * Esta es la pieza que permite que el sistema funcione con planes gratuitos:
 *  - cada proveedor tiene su propio "cubo" de peticiones por segundo y por dia
 *  - si se llega al limite, la peticion espera en cola en vez de fallar
 *  - ante un 429 o un error de red se reintenta con espera creciente
 *  - se contabiliza el consumo para poder verlo en el panel
 */
import { child } from './logger.js';
import { sleep } from './util.js';

const log = child('http');

export interface ProviderLimits {
  /** Peticiones por segundo permitidas. */
  rps: number;
  /** Maximo de peticiones al dia (0 = sin limite). */
  perDay: number;
  /** Peticiones simultaneas. */
  concurrency: number;
}

/**
 * Limites conservadores de los planes GRATUITOS.
 * Estan por debajo del limite real a proposito, para no llegar nunca al 429.
 * Si contratas un plan de pago, sube el rps aqui.
 */
export const PROVIDER_LIMITS: Record<string, ProviderLimits> = {
  dexscreener: { rps: 4, perDay: 0, concurrency: 3 },
  geckoterminal: { rps: 0.5, perDay: 0, concurrency: 1 },
  solana_rpc: { rps: 8, perDay: 0, concurrency: 4 },
  base_rpc: { rps: 8, perDay: 0, concurrency: 4 },
  // Host distinto al de base_rpc: necesita su propio cubo de peticiones.
  base_logs: { rps: 4, perDay: 0, concurrency: 2 },
  rugcheck: { rps: 1, perDay: 0, concurrency: 1 },
  goplus: { rps: 0.5, perDay: 0, concurrency: 1 },
  // El endpoint de Solana de GoPlus va por separado: cuando se cae, no debe
  // arrastrar al de EVM, que funciona perfectamente.
  goplus_solana: { rps: 0.5, perDay: 0, concurrency: 1 },
  honeypot: { rps: 1, perDay: 0, concurrency: 1 },
  basescan: { rps: 3, perDay: 90_000, concurrency: 2 },
  jupiter: { rps: 2, perDay: 0, concurrency: 2 },
  // Modelo de lenguaje. Va deliberadamente despacio por dos motivos: las
  // capas gratuitas limitan por minuto y se bloquean si te pasas, y este
  // es el unico servicio que puede costar dinero. El tope diario hace de
  // freno: aunque algo se desmadre, no puede gastar sin limite.
  llm: { rps: 0.1, perDay: 800, concurrency: 1 },
  telegram: { rps: 1, perDay: 0, concurrency: 1 },
};

const DEFAULT_LIMITS: ProviderLimits = { rps: 2, perDay: 0, concurrency: 2 };

interface ProviderState {
  limits: ProviderLimits;
  queue: Array<() => void>;
  active: number;
  lastStart: number;
  dayKey: string;
  dayCount: number;
  totalCalls: number;
  totalErrors: number;
  total429: number;
  /** Momento hasta el que el proveedor esta penalizado por 429. */
  cooldownUntil: number;
  /** Fallos seguidos. Alimenta el cortacircuitos. */
  consecutiveFailures: number;
  /** Si el proveedor esta caido, hasta cuando se deja de llamarle. */
  circuitOpenUntil: number;
  /** Cuantas veces se ha abierto seguido, para alargar la espera. */
  circuitTrips: number;
}

const states = new Map<string, ProviderState>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function getState(provider: string): ProviderState {
  let st = states.get(provider);
  if (!st) {
    st = {
      limits: PROVIDER_LIMITS[provider] ?? DEFAULT_LIMITS,
      queue: [],
      active: 0,
      lastStart: 0,
      dayKey: todayKey(),
      dayCount: 0,
      totalCalls: 0,
      totalErrors: 0,
      total429: 0,
      cooldownUntil: 0,
      consecutiveFailures: 0,
      circuitOpenUntil: 0,
      circuitTrips: 0,
    };
    states.set(provider, st);
  }
  if (st.dayKey !== todayKey()) {
    st.dayKey = todayKey();
    st.dayCount = 0;
  }
  return st;
}

/** Espera el turno segun rps + concurrencia + penalizaciones. */
async function acquire(st: ProviderState): Promise<void> {
  while (st.active >= st.limits.concurrency) {
    await new Promise<void>((resolve) => st.queue.push(resolve));
  }
  st.active++;

  const minGap = 1000 / st.limits.rps;
  for (;;) {
    const now = Date.now();
    const waitForRate = st.lastStart + minGap - now;
    const waitForCooldown = st.cooldownUntil - now;
    const wait = Math.max(waitForRate, waitForCooldown);
    if (wait <= 0) break;
    await sleep(Math.min(wait, 5000));
  }
  st.lastStart = Date.now();
}

function release(st: ProviderState): void {
  st.active--;
  const next = st.queue.shift();
  if (next) next();
}

export class QuotaExceededError extends Error {
  constructor(provider: string) {
    super(`Limite diario alcanzado para el proveedor ${provider}`);
    this.name = 'QuotaExceededError';
  }
}

/**
 * Cortacircuitos: si un proveedor deja de responder, se para de llamarle.
 *
 * Sin esto, una API caida cuesta el tiempo de espera COMPLETO en cada token
 * analizado. Con el endpoint de Solana de GoPlus caido eran 20 segundos por
 * token, que es justo lo que el cliente pidio medir y reducir.
 */
const FALLOS_PARA_ABRIR = 4;
const ESPERA_BASE_MS = 2 * 60_000;
const ESPERA_MAX_MS = 30 * 60_000;

export class CircuitOpenError extends Error {
  constructor(provider: string, hasta: number) {
    const seg = Math.max(0, Math.round((hasta - Date.now()) / 1000));
    super(`${provider} no responde; se reintentara en ${seg} s`);
    this.name = 'CircuitOpenError';
  }
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public provider: string,
    public body: string,
  ) {
    // El cuerpo va en el mensaje a proposito: sin el, un 400 no dice nada y
    // hay que reproducir la llamada a mano para saber que ha pasado.
    super(`${provider} devolvio HTTP ${status}${body ? `: ${body.slice(0, 200)}` : ''}`);
    this.name = 'HttpError';
  }
}

export interface RequestOptions {
  provider: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  /** Milisegundos antes de abortar. */
  timeoutMs?: number;
  /** Numero de reintentos ante error temporal. */
  retries?: number;
  /** Si es true, un 404 devuelve null en vez de lanzar error. */
  allow404?: boolean;
}

/**
 * Peticion HTTP con control de limites. Devuelve el JSON ya parseado.
 * Devuelve null si hubo 404 y `allow404` esta activo.
 */
export async function request<T = unknown>(
  url: string,
  opts: RequestOptions,
): Promise<T | null> {
  const st = getState(opts.provider);

  if (st.limits.perDay > 0 && st.dayCount >= st.limits.perDay) {
    throw new QuotaExceededError(opts.provider);
  }

  // Proveedor marcado como caido: se falla al instante en vez de esperar.
  if (st.circuitOpenUntil > Date.now()) {
    throw new CircuitOpenError(opts.provider, st.circuitOpenUntil);
  }

  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    await acquire(st);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      st.totalCalls++;
      st.dayCount++;

      const res = await fetch(url, {
        method: opts.method ?? 'GET',
        headers: {
          accept: 'application/json',
          'user-agent': 'crypto-radar/1.0',
          ...(opts.body ? { 'content-type': 'application/json' } : {}),
          ...opts.headers,
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      if (res.status === 404 && opts.allow404) return null;

      if (res.status === 429 || res.status === 503) {
        st.total429++;
        // Penalizamos al proveedor un rato: el resto de peticiones esperan.
        const retryAfter = Number(res.headers.get('retry-after')) || 0;
        const penalty = retryAfter > 0 ? retryAfter * 1000 : Math.min(2000 * 2 ** attempt, 60_000);
        st.cooldownUntil = Date.now() + penalty;
        log.warn({ provider: opts.provider, status: res.status, penalty }, 'limite alcanzado, esperando');
        lastError = new HttpError(res.status, opts.provider, '');
        continue;
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        // 4xx que no sea 429 no se reintenta: no va a cambiar.
        if (res.status >= 400 && res.status < 500) {
          st.totalErrors++;
          throw new HttpError(res.status, opts.provider, body.slice(0, 300));
        }
        lastError = new HttpError(res.status, opts.provider, body.slice(0, 300));
        continue;
      }

      // Respuesta valida: el proveedor esta vivo.
      st.consecutiveFailures = 0;
      st.circuitTrips = 0;

      const text = await res.text();
      if (!text) return null;
      return JSON.parse(text) as T;
    } catch (err) {
      if (err instanceof HttpError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        throw err;
      }
      lastError = err;
      st.totalErrors++;
      if (attempt < retries) {
        await sleep(Math.min(500 * 2 ** attempt, 8000));
      }
    } finally {
      clearTimeout(timer);
      release(st);
    }
  }

  // Agotados los reintentos: el proveedor suma un fallo seguido.
  st.consecutiveFailures++;
  if (st.consecutiveFailures >= FALLOS_PARA_ABRIR) {
    st.circuitTrips++;
    const espera = Math.min(ESPERA_BASE_MS * 2 ** (st.circuitTrips - 1), ESPERA_MAX_MS);
    st.circuitOpenUntil = Date.now() + espera;
    st.consecutiveFailures = 0;
    log.error(
      { provider: opts.provider, minutos: Math.round(espera / 60_000) },
      'proveedor caido: se deja de llamarle temporalmente',
    );
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Fallo la peticion a ${opts.provider}: ${String(lastError)}`);
}

/**
 * Llamada JSON-RPC (Solana y Base usan el mismo formato).
 *
 * `params` suele ser un array, pero algunos metodos de Helius (la API DAS,
 * por ejemplo getTokenAccounts) esperan un objeto directamente. Si se les
 * envia el objeto dentro de un array responden
 * "invalid type: map, expected a string".
 */
export async function rpcCall<T = unknown>(
  url: string,
  provider: string,
  method: string,
  params: unknown[] | Record<string, unknown>,
  opts: { timeoutMs?: number; retries?: number } = {},
): Promise<T> {
  const res = await request<{ result?: T; error?: { code: number; message: string } }>(url, {
    provider,
    method: 'POST',
    body: { jsonrpc: '2.0', id: 1, method, params },
    timeoutMs: opts.timeoutMs ?? 20_000,
    retries: opts.retries ?? 2,
  });
  if (!res) throw new Error(`${method}: respuesta vacia del RPC`);
  if (res.error) throw new Error(`${method}: ${res.error.message} (codigo ${res.error.code})`);
  return res.result as T;
}

/** Llamada JSON-RPC por lotes: varias peticiones en una sola conexion. */
export async function rpcBatch<T = unknown>(
  url: string,
  provider: string,
  calls: Array<{ method: string; params: unknown[] }>,
  opts: { timeoutMs?: number } = {},
): Promise<Array<T | null>> {
  if (calls.length === 0) return [];
  const body = calls.map((c, i) => ({ jsonrpc: '2.0', id: i, method: c.method, params: c.params }));
  const res = await request<Array<{ id: number; result?: T; error?: unknown }>>(url, {
    provider,
    method: 'POST',
    body,
    timeoutMs: opts.timeoutMs ?? 30_000,
    retries: 2,
  });
  const out: Array<T | null> = new Array(calls.length).fill(null);
  if (Array.isArray(res)) {
    for (const item of res) {
      if (item && typeof item.id === 'number' && item.result !== undefined) {
        out[item.id] = item.result as T;
      }
    }
  }
  return out;
}

export interface ProviderUsage {
  provider: string;
  callsToday: number;
  totalCalls: number;
  totalErrors: number;
  total429: number;
  dailyLimit: number;
  rps: number;
  throttled: boolean;
  /** true si el proveedor esta marcado como caido ahora mismo. */
  circuitOpen: boolean;
}

/** Consumo por proveedor, para mostrarlo en el panel. */
export function getUsage(): ProviderUsage[] {
  const now = Date.now();
  return [...states.entries()].map(([provider, st]) => ({
    provider,
    callsToday: st.dayCount,
    totalCalls: st.totalCalls,
    totalErrors: st.totalErrors,
    total429: st.total429,
    dailyLimit: st.limits.perDay,
    rps: st.limits.rps,
    throttled: st.cooldownUntil > now,
    circuitOpen: st.circuitOpenUntil > now,
  }));
}
