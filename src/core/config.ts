/**
 * Carga de los ficheros YAML de configuracion.
 * Se recargan solos cada 60 s, asi que puedes editar los filtros
 * sin reiniciar el sistema.
 */
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import { ROOT } from './env.js';
import { child } from './logger.js';

const log = child('config');
const CONFIG_DIR = resolve(ROOT, 'config');

export interface FiltersConfig {
  discovery: {
    interval_seconds: number;
    chains: string[];
    sources: string[];
  };
  prefilter: {
    max_pair_age_hours: number;
    min_pair_age_minutes: number;
    min_liquidity_usd: number;
    max_liquidity_usd: number;
    min_volume_h24_usd: number;
    min_txns_h1: number;
    min_buys_h24: number;
    max_volume_liquidity_ratio: number;
    max_market_cap_usd: number;
    quote_whitelist: Record<string, string[]>;
  };
  enrichment: {
    max_per_hour: number;
    max_per_day: number;
    top_holders_to_store: number;
    base_max_blocks_lookback: number;
    base_log_chunk_blocks: number;
  };
  monitoring: {
    interval_minutes: number;
    intensive_hours: number;
    slow_interval_minutes: number;
    total_days: number;
    max_tracked_tokens: number;
    liquidity_drop_alert_pct: number;
    price_crash_alert_pct: number;
  };
  execution?: {
    position_size_usd: number;
    max_impact_pct: number;
    veto_round_trip_pct: number;
  };
  invalidation?: {
    max_hours_valid: number;
    min_volume_pct_of_peak: number;
    min_liquidity_pct_of_peak: number;
    recheck_security_minutes: number;
  };
  alerts: {
    min_opportunity_score: number;
    max_risk_score: number;
    cooldown_minutes: number;
    max_alerts_per_hour: number;
    max_alerts_per_day: number;
    danger_only_for_alerted: boolean;
    max_danger_alerts_per_hour: number;
    max_danger_alerts_per_day: number;
    send_danger_alerts: boolean;
  };
}

export interface RuleConfig {
  enabled: boolean;
  points: number;
  reason: string;
  [key: string]: unknown;
}

export interface ScoringConfig {
  risk_veto_threshold: number;
  risk_labels: Array<{ max: number; label: string }>;
  opportunity_labels: Array<{ max: number; label: string }>;
  risk: Record<string, RuleConfig>;
  market_context?: {
    enabled: boolean;
    factor_mercado_fuerte: number;
    factor_mercado_neutral: number;
    factor_mercado_debil: number;
    riesgo_mercado_debil: number;
    bonus_fuerza_relativa: number;
    fuerza_relativa_min_pct: number;
  };
  opportunity: Record<string, RuleConfig>;
  critical_vetoes?: { enabled: boolean; codes: string[] };
  evaluability?: { enabled: boolean; required: string[]; max_missing: number };
  traffic_light?: { amarillo_desde_riesgo: number; rojo_desde_riesgo: number };
}

export interface KnownAddressesConfig {
  solana: {
    burn: string[];
    programs: Record<string, string>;
    custodians: string[];
  };
  base: {
    burn: string[];
    routers: Record<string, string>;
    factories: Record<string, string>;
    lockers: Record<string, string>;
    quotes: Record<string, string>;
  };
}

interface CacheEntry<T> {
  value: T;
  mtimeMs: number;
  loadedAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const RELOAD_MS = 60_000;

function load<T>(file: string): T {
  const path = resolve(CONFIG_DIR, file);
  const cached = cache.get(file) as CacheEntry<T> | undefined;
  const now = Date.now();

  if (cached && now - cached.loadedAt < RELOAD_MS) return cached.value;

  if (!existsSync(path)) {
    if (cached) return cached.value;
    throw new Error(`Falta el fichero de configuracion: ${path}`);
  }

  const mtimeMs = statSync(path).mtimeMs;
  if (cached && cached.mtimeMs === mtimeMs) {
    cached.loadedAt = now;
    return cached.value;
  }

  try {
    const value = YAML.parse(readFileSync(path, 'utf8')) as T;
    cache.set(file, { value, mtimeMs, loadedAt: now });
    if (cached) log.info({ file }, 'configuracion recargada');
    return value;
  } catch (err) {
    log.error({ file, err }, 'error leyendo la configuracion, se mantiene la anterior');
    if (cached) return cached.value;
    throw err;
  }
}

export const getFilters = (): FiltersConfig => load<FiltersConfig>('filters.yaml');
export const getScoring = (): ScoringConfig => load<ScoringConfig>('scoring.yaml');
export const getKnownAddresses = (): KnownAddressesConfig =>
  load<KnownAddressesConfig>('known-addresses.yaml');

/** Umbrales del Robot 3. Ver config/robot3.yaml para el porque de cada numero. */
export interface Robot3Config {
  nivel_maximo: {
    tecnica_minima: number;
    riesgo_maximo: number;
    fuentes_independientes_minimas: number;
    reputacion_minima: number;
  };
  nivel_intermedio: {
    tecnica_minima: number;
    riesgo_maximo: number;
  };
  avisos_por_dia: number;
  aviso_caduca_horas?: number;
}
export const getRobot3 = (): Robot3Config => load<Robot3Config>('robot3.yaml');

/** Conjunto de direcciones que NO cuentan como holder real, en minusculas. */
export function nonHolderAddresses(chain: string): Set<string> {
  const known = getKnownAddresses();
  const out = new Set<string>();
  if (chain === 'solana') {
    for (const a of known.solana.burn) out.add(a);
    for (const a of Object.values(known.solana.programs)) out.add(a);
    for (const a of known.solana.custodians) out.add(a);
  } else {
    for (const a of known.base.burn) out.add(a.toLowerCase());
    for (const a of Object.values(known.base.routers)) out.add(a.toLowerCase());
    for (const a of Object.values(known.base.factories)) out.add(a.toLowerCase());
  }
  return out;
}

/** Direcciones de quemado, en el formato de cada cadena. */
export function burnAddresses(chain: string): Set<string> {
  const known = getKnownAddresses();
  return chain === 'solana'
    ? new Set(known.solana.burn)
    : new Set(known.base.burn.map((a) => a.toLowerCase()));
}

/** Devuelve el nombre del locker si la direccion es un contrato de bloqueo. */
export function lockerName(address: string): string | null {
  const known = getKnownAddresses();
  const lower = address.toLowerCase();
  for (const [name, addr] of Object.entries(known.base.lockers)) {
    if (addr.toLowerCase() === lower) return name;
  }
  return null;
}

/** Valida que la configuracion cargada tenga sentido. Se llama al arrancar. */
export function validateConfig(): string[] {
  const problems: string[] = [];
  try {
    const f = getFilters();
    if (!f.discovery?.chains?.length) problems.push('filters.yaml: discovery.chains vacio.');
    if (f.prefilter.min_liquidity_usd >= f.prefilter.max_liquidity_usd) {
      problems.push('filters.yaml: min_liquidity_usd debe ser menor que max_liquidity_usd.');
    }
    if (f.discovery.interval_seconds < 15) {
      problems.push('filters.yaml: interval_seconds por debajo de 15 s puede agotar el plan gratuito.');
    }
  } catch (err) {
    problems.push(`filters.yaml no se pudo leer: ${(err as Error).message}`);
  }
  try {
    const s = getScoring();
    if (!s.risk || !s.opportunity) problems.push('scoring.yaml: faltan las secciones risk/opportunity.');
  } catch (err) {
    problems.push(`scoring.yaml no se pudo leer: ${(err as Error).message}`);
  }
  try {
    getKnownAddresses();
  } catch (err) {
    problems.push(`known-addresses.yaml no se pudo leer: ${(err as Error).message}`);
  }
  try {
    const r = getRobot3();
    const max = r.nivel_maximo, med = r.nivel_intermedio;
    if (!max || !med) problems.push('robot3.yaml: faltan las secciones nivel_maximo/nivel_intermedio.');
    else {
      if (max.tecnica_minima < med.tecnica_minima) {
        problems.push('robot3.yaml: el nivel maximo no puede exigir menos nota tecnica que el intermedio.');
      }
      if (max.fuentes_independientes_minimas < 2) {
        // Con una sola fuente no hay convergencia: es la promesa que protege
        // la prueba "una sola fuente no es convergencia".
        problems.push('robot3.yaml: fuentes_independientes_minimas debe ser al menos 2.');
      }
      // Aviso, no error: un liston que ningun token real alcanza deja el
      // Robot 3 mudo sin que nadie lo note. 60,1 es la nota mas alta vista
      // en 9.552 resultados reales (paquete de revision del 06/09/2026).
      if (max.tecnica_minima > 60) {
        problems.push('robot3.yaml: tecnica_minima por encima de 60 esta por encima de la nota mas alta que el Robot 1 ha dado nunca; el aviso no podra dispararse.');
      }
    }
  } catch (err) {
    problems.push(`robot3.yaml no se pudo leer: ${(err as Error).message}`);
  }
  return problems;
}
