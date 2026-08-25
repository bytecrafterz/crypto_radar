/**
 * Alertas por correo electronico (SMTP).
 *
 * Es el canal que funciona en cualquier pais y en cualquier situacion: no
 * necesita telefono, ni verificacion por SMS, ni ninguna app concreta.
 * Por eso se usa como canal de respaldo siempre que este configurado.
 */
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../core/env.js';
import { child } from '../../core/logger.js';

const log = child('correo');

let transporter: Transporter | null = null;

export function isConfigured(): boolean {
  return env.smtpHost !== '' && env.alertEmailTo !== '';
}

function getTransporter(): Transporter | null {
  if (!isConfigured()) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host: env.smtpHost,
    port: env.smtpPort,
    // 465 usa TLS directo; 587 y 25 usan STARTTLS.
    secure: env.smtpSecure ?? env.smtpPort === 465,
    auth: env.smtpUser ? { user: env.smtpUser, pass: env.smtpPass } : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
  });

  return transporter;
}

/** Comprueba que el servidor SMTP acepta la conexion y las credenciales. */
export async function verify(): Promise<{ ok: boolean; error?: string }> {
  const t = getTransporter();
  if (!t) return { ok: false, error: 'Correo no configurado.' };
  try {
    await t.verify();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function send(
  subject: string,
  html: string,
  plain: string,
): Promise<{ ok: boolean; error?: string }> {
  const t = getTransporter();
  if (!t) {
    return { ok: false, error: 'Correo no configurado (faltan SMTP_HOST o ALERT_EMAIL_TO).' };
  }

  try {
    await t.sendMail({
      from: env.smtpFrom || env.smtpUser || 'radar@localhost',
      to: env.alertEmailTo,
      subject,
      text: plain,
      html,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'no se pudo enviar el correo');
    return { ok: false, error: message };
  }
}

/** Envoltorio HTML sencillo, legible en cualquier cliente de correo. */
export function wrapHtml(bodyHtml: string): string {
  return `<!doctype html>
<html lang="es"><body style="margin:0;padding:0;background:#f4f5f7">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f7;padding:20px 10px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:640px;background:#ffffff;border:1px solid #e1e4e8;border-radius:10px">
    <tr><td style="padding:18px 22px;border-bottom:1px solid #e1e4e8">
      <span style="font:700 16px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111">
        Crypto <span style="color:#0969da">Radar</span>
      </span>
    </td></tr>
    <tr><td style="padding:22px">
      <div style="white-space:pre-wrap;font:14px/1.6 -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#24292f">
${bodyHtml}
      </div>
    </td></tr>
    <tr><td style="padding:14px 22px;border-top:1px solid #e1e4e8;
                   font:12px -apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#6e7781">
      Esto es informacion, no una recomendacion de compra. La decision siempre es tuya.
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}
