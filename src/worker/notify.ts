/**
 * Envio de avisos por varios canales a la vez.
 *
 * El sistema no depende de ningun canal concreto: se envia por todos los que
 * esten configurados (Telegram, Discord y correo). Si uno falla o no se puede
 * usar, los demas siguen funcionando.
 *
 * Los mensajes se escriben una sola vez en el formato de Telegram (HTML
 * sencillo) y aqui se traducen a lo que necesita cada canal.
 */
import { child } from '../core/logger.js';
import { env } from '../core/env.js';
import * as telegram from './telegram.js';
import * as discord from './notifiers/discord.js';
import * as email from './notifiers/email.js';

const log = child('avisos');

export interface ChannelResult {
  channel: 'telegram' | 'discord' | 'email';
  ok: boolean;
  error?: string;
}

export interface NotifyResult {
  /** true si al menos un canal entrego el aviso. */
  ok: boolean;
  results: ChannelResult[];
  /** Resumen de errores, para guardarlo en la base de datos. */
  error?: string;
}

// --------------------------------------------------------------------------
//  Conversion de formatos
// --------------------------------------------------------------------------

function unescapeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * HTML de Telegram -> texto con formato de Discord.
 * Discord usa Markdown, asi que <b> pasa a **, <i> a _ y los enlaces a
 * "texto (url)". Se hace sobre el subconjunto de etiquetas que usamos.
 */
export function toDiscord(html: string): string {
  // Los enlaces se envuelven en < > para que Discord no genere vista previa.
  // Se usan marcas temporales porque, si se pusieran los simbolos directamente,
  // el borrado de etiquetas de mas abajo se los llevaria por delante.
  // Escritas como secuencia de escape a proposito: son caracteres de control
  // invisibles, y si alguna herramienta los limpiase del fichero se romperian
  // todos los enlaces de las alertas sin que nadie lo notase.
  const OPEN = '\u0001';
  const CLOSE = '\u0002';

  const text = html
    .replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gis, `$2 (${OPEN}$1${CLOSE})`)
    .replace(/<b>(.*?)<\/b>/gis, '**$1**')
    .replace(/<strong>(.*?)<\/strong>/gis, '**$1**')
    .replace(/<i>(.*?)<\/i>/gis, '_$1_')
    .replace(/<em>(.*?)<\/em>/gis, '_$1_')
    .replace(/<code>(.*?)<\/code>/gis, '`$1`')
    .replace(/<[^>]+>/g, '');

  return unescapeEntities(text).replaceAll(OPEN, '<').replaceAll(CLOSE, '>').trim();
}

/** HTML de Telegram -> texto plano, para la version sin formato del correo. */
export function toPlain(html: string): string {
  const text = html
    .replace(/<a\s+href="([^"]*)"[^>]*>(.*?)<\/a>/gis, '$2: $1')
    .replace(/<[^>]+>/g, '');
  return unescapeEntities(text).trim();
}

/**
 * HTML de Telegram -> HTML de correo.
 * El subconjunto que usamos (<b>, <i>, <code>, <a>) ya es HTML valido, asi que
 * solo hay que darle estilo al bloque y respetar los saltos de linea.
 */
export function toEmailHtml(html: string): string {
  const styled = html
    .replace(/<code>/g, '<code style="background:#f6f8fa;padding:2px 5px;border-radius:4px;font-size:12px">')
    .replace(/<a /g, '<a style="color:#0969da;text-decoration:none" ');
  return email.wrapHtml(styled);
}

/** Titulo del correo a partir de la primera linea del mensaje. */
function subjectFrom(html: string, fallback: string): string {
  const firstLine = toPlain(html).split('\n')[0]?.trim() ?? '';
  const clean = firstLine.replace(/\s+/g, ' ').slice(0, 90);
  return clean ? `Crypto Radar · ${clean}` : fallback;
}

// --------------------------------------------------------------------------
//  Envio
// --------------------------------------------------------------------------

/** Canales configurados ahora mismo. */
export function activeChannels(): string[] {
  const list: string[] = [];
  if (env.telegramToken && env.telegramChatId) list.push('telegram');
  if (discord.isConfigured()) list.push('discord');
  if (email.isConfigured()) list.push('email');
  return list;
}

/**
 * Envia el aviso por todos los canales configurados.
 * Devuelve ok = true si al menos uno lo entrego.
 */
export async function notify(
  html: string,
  opts: { subject?: string } = {},
): Promise<NotifyResult> {
  if (env.alertsMuted) {
    return {
      ok: false,
      results: [],
      error: 'Avisos silenciados por configuracion (ALERTS_MUTED).',
    };
  }

  const channels = activeChannels();
  if (channels.length === 0) {
    return {
      ok: false,
      results: [],
      error: 'No hay ningun canal de avisos configurado (Telegram, Discord o correo).',
    };
  }

  const tasks: Array<Promise<ChannelResult>> = [];

  if (channels.includes('telegram')) {
    tasks.push(
      telegram.sendMessage(html).then((r) => ({ channel: 'telegram' as const, ok: r.ok, error: r.error })),
    );
  }

  if (channels.includes('discord')) {
    tasks.push(
      discord.send(toDiscord(html)).then((r) => ({ channel: 'discord' as const, ok: r.ok, error: r.error })),
    );
  }

  if (channels.includes('email')) {
    const subject = opts.subject ?? subjectFrom(html, 'Crypto Radar · nueva alerta');
    tasks.push(
      email
        .send(subject, toEmailHtml(html), toPlain(html))
        .then((r) => ({ channel: 'email' as const, ok: r.ok, error: r.error })),
    );
  }

  const results = await Promise.all(tasks);
  const ok = results.some((r) => r.ok);

  const failed = results.filter((r) => !r.ok);
  const error =
    failed.length > 0 ? failed.map((f) => `${f.channel}: ${f.error ?? 'error'}`).join(' | ') : undefined;

  if (!ok) log.error({ results }, 'ningun canal pudo entregar el aviso');
  else if (failed.length > 0) log.warn({ failed }, 'algun canal fallo, pero el aviso se entrego');

  return { ok, results, error };
}

/** Mensaje de prueba, para comprobar los canales sin esperar a una alerta. */
export async function sendTest(): Promise<NotifyResult> {
  const channels = activeChannels();
  return notify(
    [
      '✅ <b>Prueba de avisos</b>',
      '',
      'Si estas leyendo esto, este canal funciona correctamente.',
      '',
      `Canales activos: ${channels.length > 0 ? channels.join(', ') : 'ninguno'}`,
    ].join('\n'),
    { subject: 'Crypto Radar · prueba de avisos' },
  );
}
