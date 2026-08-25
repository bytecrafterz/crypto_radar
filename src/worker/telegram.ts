/**
 * Bot de Telegram: alertas y consultas.
 * La API de Telegram es gratuita y sin limite practico para este uso.
 */
import { Bot } from 'grammy';
import { env } from '../core/env.js';
import { child } from '../core/logger.js';
import { getFilters, getScoring } from '../core/config.js';
import { getState, setState } from '../core/db.js';
import * as repo from '../core/repo.js';
import { getUsage } from '../core/http.js';
import { fmtUsd, fmtNum, escapeHtml, shortAddr } from '../core/util.js';

const log = child('telegram');

let bot: Bot | null = null;
let started = false;

export function getBot(): Bot | null {
  return bot;
}

/** ¿Estan las alertas pausadas por el usuario? */
export async function isPaused(): Promise<boolean> {
  return getState<boolean>('alertas_pausadas', false);
}

export async function setPaused(paused: boolean): Promise<void> {
  await setState('alertas_pausadas', paused);
}

/** Envia un mensaje al chat configurado. Devuelve true si se entrego. */
export async function sendMessage(text: string): Promise<{ ok: boolean; error?: string }> {
  if (env.alertsMuted) return { ok: false, error: 'Alertas silenciadas por configuracion (ALERTS_MUTED).' };
  if (!bot || !env.telegramChatId) {
    return { ok: false, error: 'Telegram no configurado (falta token o chat id).' };
  }

  try {
    await bot.api.sendMessage(env.telegramChatId, text, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
    });
    return { ok: true };
  } catch (err) {
    log.error({ err: String(err) }, 'no se pudo enviar el mensaje de Telegram');
    return { ok: false, error: String(err) };
  }
}

// --------------------------------------------------------------------------
//  Comandos
// --------------------------------------------------------------------------

function registerCommands(b: Bot): void {
  b.command('start', async (ctx) => {
    await ctx.reply(
      [
        '<b>Crypto Radar en marcha</b>',
        '',
        'Te avisare cuando detecte un token que cumpla tus criterios.',
        '',
        'Comandos disponibles:',
        '/estado - como va el sistema',
        '/top - mejores oportunidades de hoy',
        '/ultimas - ultimas alertas enviadas',
        '/filtros - filtros activos ahora mismo',
        '/apis - consumo de las APIs gratuitas',
        '/pausar - dejar de recibir alertas',
        '/reanudar - volver a recibirlas',
        '/ayuda - esta lista',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  b.command(['ayuda', 'help'], async (ctx) => {
    await ctx.reply(
      [
        '<b>Como usar el radar</b>',
        '',
        '<b>/estado</b> - tokens detectados, analizados y vigilados hoy.',
        '<b>/top</b> - los 5 tokens con mejor puntuacion de oportunidad.',
        '<b>/ultimas</b> - las ultimas alertas que te he enviado.',
        '<b>/filtros</b> - que criterios estoy aplicando ahora.',
        '<b>/apis</b> - cuantas llamadas llevo hoy en cada servicio gratuito.',
        '<b>/pausar</b> y <b>/reanudar</b> - controlar las alertas.',
        '',
        'Los filtros se cambian en el fichero <code>config/filters.yaml</code>',
        'y los pesos de la puntuacion en <code>config/scoring.yaml</code>.',
        'No hace falta reiniciar: se recargan solos.',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  b.command('estado', async (ctx) => {
    const stats = await repo.getDashboardStats();
    const paused = await isPaused();
    await ctx.reply(
      [
        '<b>Estado del sistema</b>',
        '',
        `Tokens detectados hoy: <b>${stats.tokensToday}</b>`,
        `Analizados a fondo hoy: <b>${stats.enrichedToday}</b>`,
        `Descartados hoy: <b>${stats.discardedToday}</b>`,
        `Alertas enviadas hoy: <b>${stats.alertsToday}</b>`,
        `En seguimiento ahora: <b>${stats.tracked}</b>`,
        '',
        `Historico total: ${fmtNum(stats.totalTokens)} tokens (${stats.bySolana} Solana / ${stats.byBase} Base)`,
        '',
        paused ? '⏸ Alertas <b>pausadas</b>. Usa /reanudar.' : '✅ Alertas activas.',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  b.command('top', async (ctx) => {
    const tokens = await repo.listTokens({ orderBy: 'oportunidad', limit: 5, minOpportunity: 40 });
    if (tokens.length === 0) {
      await ctx.reply('Todavia no hay ningun token con puntuacion destacable.');
      return;
    }

    const lines = ['<b>Mejores oportunidades</b>', ''];
    for (const t of tokens) {
      lines.push(
        `<b>${escapeHtml(t.symbol ?? '???')}</b> (${t.chain}) - oportunidad ${t.last_opportunity ?? 0}, riesgo ${t.last_risk ?? 0}`,
      );
      lines.push(`   Liquidez ${fmtUsd(t.last_liquidity_usd)} | Cap ${fmtUsd(t.last_market_cap_usd)}`);
      lines.push(`   <code>${escapeHtml(t.address)}</code>`);
      lines.push('');
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  b.command('ultimas', async (ctx) => {
    const alerts = await repo.recentAlerts(5);
    if (alerts.length === 0) {
      await ctx.reply('Aun no he enviado ninguna alerta.');
      return;
    }
    const lines = ['<b>Ultimas alertas</b>', ''];
    for (const a of alerts) {
      const when = a.ts.toLocaleString('es-ES', { timeZone: 'Europe/Madrid' });
      lines.push(`${when} - <b>${escapeHtml(a.symbol ?? '???')}</b> (${a.kind})`);
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  b.command('filtros', async (ctx) => {
    const f = getFilters();
    const s = getScoring();
    await ctx.reply(
      [
        '<b>Filtros activos</b>',
        '',
        `Cadenas: ${f.discovery.chains.join(', ')}`,
        `Liquidez: entre ${fmtUsd(f.prefilter.min_liquidity_usd)} y ${fmtUsd(f.prefilter.max_liquidity_usd)}`,
        `Volumen minimo 24 h: ${fmtUsd(f.prefilter.min_volume_h24_usd)}`,
        `Antiguedad maxima: ${f.prefilter.max_pair_age_hours} h`,
        `Operaciones minimas 1 h: ${f.prefilter.min_txns_h1}`,
        '',
        '<b>Para avisarte</b>',
        `Oportunidad minima: ${f.alerts.min_opportunity_score}`,
        `Riesgo maximo: ${f.alerts.max_risk_score}`,
        `Riesgo que veta la alerta: ${s.risk_veto_threshold}`,
        `Maximo de alertas por hora: ${f.alerts.max_alerts_per_hour}`,
        '',
        'Se cambian en <code>config/filters.yaml</code>.',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  b.command('apis', async (ctx) => {
    const usage = getUsage();
    if (usage.length === 0) {
      await ctx.reply('Todavia no se ha llamado a ninguna API en esta sesion.');
      return;
    }
    const lines = ['<b>Consumo de APIs hoy</b>', ''];
    for (const u of usage.sort((a, b) => b.callsToday - a.callsToday)) {
      const limit = u.dailyLimit > 0 ? ` / ${fmtNum(u.dailyLimit)}` : '';
      const warn = u.throttled ? ' ⏳' : '';
      lines.push(`${u.provider}: ${fmtNum(u.callsToday)}${limit} llamadas${warn}`);
      if (u.total429 > 0) lines.push(`   (${u.total429} veces al limite, se reintento solo)`);
    }
    await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
  });

  b.command('pausar', async (ctx) => {
    await setPaused(true);
    await ctx.reply('⏸ Alertas pausadas. El sistema sigue analizando y guardando datos. Usa /reanudar cuando quieras.');
  });

  b.command('reanudar', async (ctx) => {
    await setPaused(false);
    await ctx.reply('✅ Alertas reanudadas.');
  });

  b.catch((err) => {
    log.error({ err: String(err.error) }, 'error en el bot de Telegram');
  });
}

// --------------------------------------------------------------------------
//  Arranque
// --------------------------------------------------------------------------

export async function startTelegram(): Promise<void> {
  if (!env.telegramToken) {
    log.warn('sin TELEGRAM_BOT_TOKEN: el bot no arranca (el resto del sistema si funciona)');
    return;
  }
  if (started) return;

  bot = new Bot(env.telegramToken);
  registerCommands(bot);

  try {
    await bot.api.setMyCommands([
      { command: 'estado', description: 'Como va el sistema' },
      { command: 'top', description: 'Mejores oportunidades' },
      { command: 'ultimas', description: 'Ultimas alertas' },
      { command: 'filtros', description: 'Filtros activos' },
      { command: 'apis', description: 'Consumo de las APIs' },
      { command: 'pausar', description: 'Pausar alertas' },
      { command: 'reanudar', description: 'Reanudar alertas' },
      { command: 'ayuda', description: 'Ayuda' },
    ]);
  } catch (err) {
    log.warn({ err: String(err) }, 'no se pudieron registrar los comandos');
  }

  // start() no se espera a proposito: se queda escuchando en segundo plano.
  void bot.start({
    onStart: () => log.info('bot de Telegram escuchando'),
    drop_pending_updates: true,
  });

  started = true;
}

export async function stopTelegram(): Promise<void> {
  if (bot && started) {
    await bot.stop().catch(() => {});
    started = false;
  }
}
