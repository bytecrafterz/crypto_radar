/**
 * Estado del sistema: tareas, configuracion activa, consumo de APIs y registro.
 */
import { getState, query, queryOne } from '../../core/db.js';
import { estadoDeLasTareas } from '../../worker/vigilante.js';
import { getUsage } from '../../core/http.js';
import { getFilters, getScoring } from '../../core/config.js';
import { env, checkEnv } from '../../core/env.js';
import { activeChannels } from '../../worker/notify.js';
import { iso, paginacion } from './comun.js';

export async function alertasPausadas(): Promise<boolean> {
  return getState<boolean>('alertas_pausadas', false);
}

export async function datosSistema() {
  const filters = getFilters();
  const scoring = getScoring();
  const [pausado, tareas] = await Promise.all([alertasPausadas(), estadoDeLasTareas()]);

  return {
    pausado,
    tareas: tareas.map((t) => ({
      nombre: t.nombre,
      calladaMs: t.callada_ms,
      caida: t.caida,
      arrancando: t.ultimoLatido === null,
    })),
    avisosConfig: checkEnv(),
    fuentes: {
      solana: env.hasHelius ? 'Helius (con clave) y RPC publico de respaldo' : 'RPC publico',
      base: env.hasAlchemy ? 'Alchemy (con clave)' : 'RPC publico',
      basescan: env.basescanKey ? 'con clave' : 'sin clave',
      mercado: 'DexScreener + GeckoTerminal',
      seguridad: 'GoPlus, RugCheck, Honeypot.is',
      canales: activeChannels(),
    },
    filtros: {
      cadenas: filters.discovery.chains,
      deteccionCadaSeg: filters.discovery.interval_seconds,
      liquidezMin: filters.prefilter.min_liquidity_usd,
      liquidezMax: filters.prefilter.max_liquidity_usd,
      volumen24hMin: filters.prefilter.min_volume_h24_usd,
      antiguedadMaxH: filters.prefilter.max_pair_age_hours,
      analisisPorHora: filters.enrichment.max_per_hour,
      oportunidadMinAlerta: filters.alerts.min_opportunity_score,
      riesgoMaxAlerta: filters.alerts.max_risk_score,
      riesgoVeto: scoring.risk_veto_threshold,
    },
    apis: getUsage()
      .sort((a, b) => b.callsToday - a.callsToday)
      .map((u) => ({
        proveedor: u.provider,
        llamadasHoy: u.callsToday,
        limiteDiario: u.dailyLimit,
        rps: u.rps,
        esperas: u.total429,
        estado: u.circuitOpen ? 'caido' : u.throttled ? 'esperando' : 'ok',
      })),
  };
}

const NIVELES = ['info', 'warn', 'error'];

export async function datosActividad(q: Record<string, string | undefined>) {
  const { page, size, offset } = paginacion(q, 25);
  const nivel = NIVELES.includes(q.nivel ?? '') ? q.nivel! : null;
  const [filas, total] = await Promise.all([
    query<{ ts: Date; level: string; area: string; message: string }>(
      `SELECT ts, level, area, message FROM activity_log
        WHERE ($3::text IS NULL OR level = $3)
        ORDER BY ts DESC, id DESC LIMIT $1 OFFSET $2`,
      [size, offset, nivel],
    ),
    queryOne<{ n: number }>('SELECT COUNT(*)::int AS n FROM activity_log WHERE ($1::text IS NULL OR level = $1)', [nivel]),
  ]);
  return {
    items: filas.map((a) => ({ ts: iso(a.ts), level: a.level, area: a.area, message: a.message })),
    total: total?.n ?? 0,
    page,
    size,
  };
}
