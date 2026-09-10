/**
 * Por que no conecta el Robot 2 con Telegram.
 *
 * POR QUE HACE FALTA ESTO
 * conectar() en src/telegram/mtproto.ts descarta el motivo del fallo: su
 * manejador de rechazo es `() => resolver(false)`, sin tocar el error. Por eso
 * el registro solo puede decir "no se pudo abrir la conexion" y nunca por que.
 * Este script hace la misma llamada y ensena el error entero.
 *
 * No escribe nada. Solo abre la conexion, mira quien es y se va.
 *
 * USO:
 *     node scripts/diagnostico-telegram.mjs
 */
import { TelegramClient } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { readFileSync } from 'node:fs';

const RUTA_ENV = new URL('../.env', import.meta.url).pathname;

function leerEnv(clave) {
  try {
    const m = readFileSync(RUTA_ENV, 'utf8').match(new RegExp(`^${clave}=(.*)$`, 'm'));
    return m ? m[1].trim() : '';
  } catch (err) {
    console.error(`No se puede leer ${RUTA_ENV}: ${err.message}`);
    process.exit(1);
  }
}

const apiId = Number(leerEnv('TELEGRAM_API_ID'));
const apiHash = leerEnv('TELEGRAM_API_HASH');
const sesion = leerEnv('TELEGRAM_SESSION');

console.log('Configuracion:');
console.log(`  TELEGRAM_API_ID    ${apiId ? 'presente (' + apiId + ')' : 'FALTA'}`);
console.log(`  TELEGRAM_API_HASH  ${apiHash ? 'presente (' + apiHash.length + ' caracteres)' : 'FALTA'}`);
console.log(`  TELEGRAM_SESSION   ${sesion ? 'presente (' + sesion.length + ' caracteres)' : 'FALTA'}`);
console.log();

if (!apiId || !apiHash || !sesion) {
  console.error('Faltan datos en .env. Sin ellos no se puede ni intentar.');
  process.exit(1);
}

const cliente = new TelegramClient(new StringSession(sesion), apiId, apiHash, {
  connectionRetries: 1,
  // Aqui SI queremos que la libreria hable: es justo lo que venimos a ver.
});

const tope = setTimeout(() => {
  console.error('\nSin respuesta en 45 s. Parece red, no credenciales.');
  process.exit(1);
}, 45_000);

try {
  console.log('Conectando...');
  await cliente.connect();
  console.log('  conexion abierta');

  const yo = await cliente.getMe();
  console.log(`  sesion valida: ${yo.username ? '@' + yo.username : yo.firstName} (id ${yo.id})`);

  const dialogos = await cliente.getDialogs({ limit: 5 });
  console.log(`  puede leer dialogos: ${dialogos.length} devueltos`);

  clearTimeout(tope);
  await cliente.disconnect();
  console.log('\nLa sesion FUNCIONA. El fallo esta en otro sitio.');
  process.exit(0);
} catch (err) {
  clearTimeout(tope);
  console.error('\n=== ESTE ES EL ERROR QUE conectar() TIRABA A LA BASURA ===');
  console.error(`  nombre:  ${err?.constructor?.name ?? typeof err}`);
  console.error(`  mensaje: ${err?.message ?? String(err)}`);
  if (err?.errorMessage) console.error(`  codigo Telegram: ${err.errorMessage}`);
  if (err?.code) console.error(`  code: ${err.code}`);
  console.error('\n--- traza ---');
  console.error(err?.stack ?? '(sin traza)');

  const m = String(err?.errorMessage ?? err?.message ?? '');
  console.error('\n--- que significa ---');
  if (/AUTH_KEY_DUPLICATED/i.test(m)) {
    console.error('  La MISMA cadena de sesion se esta usando desde dos sitios a la vez.');
    console.error('  Telegram lo trata como una cuenta robada y mata la sesion. No se');
    console.error('  recupera sola: la cadena que hay en .env ya no sirve para nada.');
    console.error();
    console.error('  Es lo que pasa al migrar de maquina sin apagar la vieja: las dos');
    console.error('  entran con la misma llave. El aviso "409: Conflict" del bot en el');
    console.error('  registro es el mismo problema visto desde el otro lado.');
    console.error();
    console.error('  Arreglo, y EN ESTE ORDEN:');
    console.error('    1. Apagar la otra copia. Si se hace el login antes, la sesion');
    console.error('       nueva morira igual que esta en cuanto la otra se conecte.');
    console.error('    2. node scripts/telegram-login.mjs   (pide telefono y codigo)');
    console.error('    3. sudo systemctl restart crypto-radar');
  } else if (/AUTH_KEY_UNREGISTERED|AUTH_KEY_INVALID|SESSION_REVOKED|USER_DEACTIVATED/i.test(m)) {
    console.error('  La sesion ya no vale: Telegram la ha cerrado.');
    console.error('  Arreglo:  node scripts/telegram-login.mjs  (pide telefono y codigo)');
  } else if (/FLOOD_WAIT/i.test(m)) {
    console.error('  Telegram esta limitando la cuenta. Hay que esperar el tiempo que indica.');
  } else if (/API_ID_INVALID|API_ID_PUBLISHED/i.test(m)) {
    console.error('  El par api_id/api_hash no es valido.');
  } else {
    console.error('  No es un error conocido de autenticacion. Mira la traza.');
  }
  process.exit(1);
}
