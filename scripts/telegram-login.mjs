/**
 * Login inicial de la cuenta de Telegram del Robot 2.
 *
 * Se ejecuta UNA sola vez. Pide el telefono, el codigo que llega dentro
 * de la aplicacion de Telegram, y si la cuenta tiene contrasena de dos
 * pasos, tambien la pide.
 *
 * A cambio devuelve una "cadena de sesion" que se guarda en .env. A
 * partir de ahi el sistema entra solo, sin volver a pedir nada.
 *
 * ESA CADENA ES COMO LA CONTRASENA DE LA CUENTA
 * Quien la tenga puede leer y escribir como si fuera esa cuenta. Vive en
 * .env, que no se sube a GitHub. No la pegues en ningun sitio.
 *
 * USO:
 *     node scripts/telegram-login.mjs
 */
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { createInterface } from 'node:readline/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { stdin, stdout } from 'node:process';

const RUTA_ENV = new URL('../.env', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function leerEnv(clave) {
  try {
    const txt = readFileSync(RUTA_ENV, 'utf8');
    const m = txt.match(new RegExp(`^${clave}=(.*)$`, 'm'));
    return m ? m[1].trim() : '';
  } catch {
    return '';
  }
}

function guardarEnv(clave, valor) {
  const txt = readFileSync(RUTA_ENV, 'utf8');
  const re = new RegExp(`^${clave}=.*$`, 'm');
  const nuevo = re.test(txt) ? txt.replace(re, `${clave}=${valor}`) : `${txt}\n${clave}=${valor}\n`;
  writeFileSync(RUTA_ENV, nuevo);
}

const apiId = Number(leerEnv('TELEGRAM_API_ID'));
const apiHash = leerEnv('TELEGRAM_API_HASH');

if (!apiId || !apiHash) {
  console.error('\n  Faltan TELEGRAM_API_ID o TELEGRAM_API_HASH en .env\n');
  process.exit(1);
}

const yaHabia = leerEnv('TELEGRAM_SESSION');
if (yaHabia) {
  console.log('\n  Ya hay una sesion guardada en .env.');
  console.log('  Si quieres rehacerla, borra la linea TELEGRAM_SESSION y vuelve a ejecutar.\n');
  process.exit(0);
}

console.log('\n  ============================================');
console.log('   Login de la cuenta de Telegram del Robot 2');
console.log('  ============================================\n');
console.log('  El codigo NO llega por SMS: llega dentro de la propia');
console.log('  aplicacion de Telegram, en el chat de "Telegram".\n');

const rl = createInterface({ input: stdin, output: stdout });
const cliente = new TelegramClient(new StringSession(''), apiId, apiHash, {
  connectionRetries: 3,
  // Que no escriba ruido de la libreria por pantalla.
  baseLogger: { log: () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
});

try {
  await cliente.start({
    phoneNumber: async () => (await rl.question('  Telefono (con prefijo, ej. +34612345678): ')).trim(),
    phoneCode: async () => (await rl.question('  Codigo recibido en Telegram: ')).trim(),
    password: async () =>
      (await rl.question('  Contrasena de dos pasos (Enter si no tienes): ')).trim(),
    onError: (err) => console.error('  Error:', err?.message ?? err),
  });

  const yo = await cliente.getMe();
  const sesion = cliente.session.save();

  guardarEnv('TELEGRAM_SESSION', sesion);

  console.log('\n  ============================================');
  console.log(`   Conectado como: ${yo.firstName ?? ''} ${yo.username ? '@' + yo.username : ''}`);
  console.log('   Sesion guardada en .env');
  console.log('  ============================================\n');
  console.log('  Ya no hara falta volver a hacer esto.\n');
} catch (err) {
  console.error('\n  No se pudo iniciar sesion:', err?.message ?? err, '\n');
} finally {
  rl.close();
  await cliente.disconnect().catch(() => {});
  process.exit(0);
}
