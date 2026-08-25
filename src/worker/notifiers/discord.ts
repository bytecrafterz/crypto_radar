/**
 * Discord por webhook.
 *
 * Es la alternativa mas practica a Telegram cuando no se puede verificar un
 * numero de telefono: crear una cuenta de Discord solo pide correo electronico,
 * y un webhook no necesita bot, ni servidor propio, ni programacion.
 *
 * Basta con: Ajustes del canal -> Integraciones -> Webhooks -> Nuevo webhook,
 * y copiar la URL.
 */
import { request } from '../../core/http.js';
import { env } from '../../core/env.js';
import { child } from '../../core/logger.js';

const log = child('discord');

/** Limite duro de Discord por mensaje. */
const MAX_LEN = 1900;

export function isConfigured(): boolean {
  return env.discordWebhook !== '';
}

export async function send(text: string): Promise<{ ok: boolean; error?: string }> {
  if (!isConfigured()) {
    return { ok: false, error: 'Discord no configurado (falta DISCORD_WEBHOOK_URL).' };
  }

  const content = text.length > MAX_LEN ? `${text.slice(0, MAX_LEN - 20)}\n...(recortado)` : text;

  try {
    await request(env.discordWebhook, {
      provider: 'discord',
      method: 'POST',
      body: { content, allowed_mentions: { parse: [] } },
      retries: 2,
      timeoutMs: 15_000,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'no se pudo enviar el aviso a Discord');
    return { ok: false, error: message };
  }
}
