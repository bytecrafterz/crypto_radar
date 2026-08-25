/**
 * Lectura de variables de entorno.
 * Carga el fichero .env sin dependencias externas.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
/** Raiz del proyecto (funciona tanto desde src/ como desde dist/). */
export const ROOT = resolve(here, '..', '..');

function loadDotEnv(): void {
  const path = resolve(ROOT, '.env');
  if (!existsSync(path)) return;
  const content = readFileSync(path, 'utf8');
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadDotEnv();

function str(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return ['1', 'true', 'yes', 'si', 'y'].includes(v.toLowerCase());
}

function num(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const heliusKey = str('HELIUS_API_KEY');
const alchemyKey = str('ALCHEMY_API_KEY');

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProd: str('NODE_ENV', 'development') === 'production',
  logLevel: str('LOG_LEVEL', 'info'),

  databaseUrl: str('DATABASE_URL', 'postgres://radar:radar@localhost:5432/radar'),

  telegramToken: str('TELEGRAM_BOT_TOKEN'),
  telegramChatId: str('TELEGRAM_CHAT_ID'),
  alertsMuted: bool('ALERTS_MUTED', false),

  // Canal alternativo: no necesita telefono, solo una cuenta de Discord.
  discordWebhook: str('DISCORD_WEBHOOK_URL'),

  // Canal de respaldo: funciona en cualquier pais, sin verificacion por SMS.
  smtpHost: str('SMTP_HOST'),
  smtpPort: num('SMTP_PORT', 587),
  smtpUser: str('SMTP_USER'),
  smtpPass: str('SMTP_PASS'),
  smtpFrom: str('SMTP_FROM'),
  smtpSecure: process.env.SMTP_SECURE ? bool('SMTP_SECURE', false) : null,
  alertEmailTo: str('ALERT_EMAIL_TO'),

  heliusKey,
  /** RPC de Solana: Helius si hay clave, si no el publico. */
  solanaRpcUrl:
    str('SOLANA_RPC_URL') ||
    (heliusKey
      ? `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`
      : 'https://api.mainnet-beta.solana.com'),
  hasHelius: heliusKey !== '',

  alchemyKey,
  /** RPC de Base: Alchemy si hay clave, si no el publico. */
  baseRpcUrl:
    str('BASE_RPC_URL') ||
    (alchemyKey
      ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}`
      : 'https://mainnet.base.org'),
  hasAlchemy: alchemyKey !== '',

  /**
   * RPC aparte solo para eth_getLogs (reconstruccion de holders en Base).
   *
   * El plan gratuito de Alchemy limita eth_getLogs a 10 bloques por peticion,
   * lo que hace inviable reconstruir la lista de holders: harian falta miles
   * de peticiones por token. El RPC publico de Base admite rangos mucho mas
   * amplios, asi que se usa ese para los logs y Alchemy para todo lo demas.
   */
  baseLogsRpcUrl: str('BASE_LOGS_RPC_URL') || 'https://mainnet.base.org',

  basescanKey: str('BASESCAN_API_KEY'),

  panelPassword: str('PANEL_PASSWORD', 'radar'),
  sessionSecret: str('SESSION_SECRET', 'cambia-este-secreto-de-sesion-por-favor-1234'),
  port: num('PORT', 3000),
  host: str('HOST', '0.0.0.0'),

  workerEnabled: bool('WORKER_ENABLED', true),
};

/** Comprobaciones al arrancar: avisa de lo que falta pero no impide arrancar. */
export function checkEnv(): string[] {
  const warnings: string[] = [];

  // Hace falta AL MENOS un canal de avisos, pero no importa cual.
  const hasTelegram = env.telegramToken !== '' && env.telegramChatId !== '';
  const hasDiscord = env.discordWebhook !== '';
  const hasEmail = env.smtpHost !== '' && env.alertEmailTo !== '';

  if (!hasTelegram && !hasDiscord && !hasEmail) {
    warnings.push(
      'No hay ningun canal de avisos configurado. Configura al menos uno: Telegram, Discord (webhook) o correo (SMTP).',
    );
  }
  if (env.telegramToken && !env.telegramChatId) {
    warnings.push('TELEGRAM_BOT_TOKEN puesto pero falta TELEGRAM_CHAT_ID.');
  }
  if (env.smtpHost && !env.alertEmailTo) {
    warnings.push('SMTP_HOST puesto pero falta ALERT_EMAIL_TO (a que direccion enviar).');
  }
  if (!env.hasHelius) warnings.push('HELIUS_API_KEY vacio: se usa el RPC publico de Solana (mas lento y con mas fallos).');
  if (!env.hasAlchemy) warnings.push('ALCHEMY_API_KEY vacio: se usa el RPC publico de Base (limite bajo).');
  // Basescan ya no cubre Base en el plan gratuito de Etherscan, asi que su
  // ausencia no es un problema: el creador viene de GoPlus y el bloque de
  // creacion se busca en la cadena. No merece la pena avisar de ello.
  if (env.panelPassword === 'radar' || env.panelPassword === 'cambia-esta-clave') {
    warnings.push('PANEL_PASSWORD sigue con el valor por defecto: cambialo.');
  }
  return warnings;
}
