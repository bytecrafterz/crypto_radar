/**
 * Prueba de los canales de aviso.
 *
 *   npm run test:alertas
 *
 * Envia un mensaje de prueba por todos los canales configurados y dice
 * exactamente cual funciono y cual no. Sirve para comprobar Telegram,
 * Discord y el correo sin tener que esperar a que salte una alerta real.
 */
import { activeChannels, sendTest } from './worker/notify.js';
import { startTelegram, stopTelegram } from './worker/telegram.js';
import { verify as verifySmtp, isConfigured as emailConfigured } from './worker/notifiers/email.js';
import { env } from './core/env.js';

async function main(): Promise<void> {
  console.log('\n=== PRUEBA DE CANALES DE AVISO ===\n');

  const canales = activeChannels();
  if (canales.length === 0) {
    console.log('No hay ningun canal configurado.\n');
    console.log('Configura al menos uno en el fichero .env:');
    console.log('  Telegram : TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID');
    console.log('  Discord  : DISCORD_WEBHOOK_URL');
    console.log('  Correo   : SMTP_HOST + SMTP_USER + SMTP_PASS + ALERT_EMAIL_TO\n');
    process.exit(1);
  }

  console.log(`Canales configurados: ${canales.join(', ')}`);

  if (env.alertsMuted) {
    console.log('\nAVISO: ALERTS_MUTED=true, no se enviara nada.');
    console.log('Ponlo a false en el .env para probar de verdad.\n');
    process.exit(1);
  }

  // El correo se puede comprobar antes de enviar nada.
  if (emailConfigured()) {
    process.stdout.write('  Conexion con el servidor de correo ... ');
    const v = await verifySmtp();
    console.log(v.ok ? 'OK' : `FALLO  ${v.error}`);
  }

  if (canales.includes('telegram')) {
    await startTelegram();
  }

  console.log('\nEnviando mensaje de prueba...\n');
  const result = await sendTest();

  for (const r of result.results) {
    console.log(`  ${r.channel.padEnd(9)} ${r.ok ? 'ENVIADO' : `FALLO  ${r.error}`}`);
  }

  console.log('');
  if (result.ok) {
    console.log('Al menos un canal funciona. Revisa que te haya llegado el mensaje.\n');
  } else {
    console.log('Ningun canal pudo entregar el mensaje.\n');
    console.log('Causas mas frecuentes:');
    console.log('  Telegram : no le has escrito /start al bot, o el chat id no es correcto.');
    console.log('  Discord  : la URL del webhook esta mal copiada o el canal se borro.');
    console.log('  Correo   : usuario o contrasena incorrectos, o el puerto esta bloqueado.\n');
  }

  await stopTelegram();
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('\nError ejecutando la prueba:', err);
  process.exit(1);
});
