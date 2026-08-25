/**
 * Cliente del Bot API de Telegram.
 *
 * ALCANCE Y LIMITE
 * Un bot solo lee donde le han metido: canales donde es administrador y
 * grupos donde es miembro con la privacidad desactivada. NO puede
 * asomarse a canales publicos ajenos, que es la mayor parte de lo que el
 * Robot 2 necesita a la larga.
 *
 * Se usa igualmente porque permite construir y probar TODA la cadena hoy,
 * con mensajes de verdad. Cuando lleguen las credenciales de MTProto solo
 * se cambia esta pieza: lo que va detras (triaje, resolucion, Robot 1,
 * convergencia) ya estara probado contra trafico real.
 */
import { request } from '../core/http.js';
import { child } from '../core/logger.js';
import { getState, setState } from '../core/db.js';

const log = child('telegram-bot');

const CLAVE_OFFSET = 'telegram_bot_offset';

export interface ChatTelegram {
  id: number;
  type: string;
  title?: string;
  username?: string;
}

export interface MensajeTelegram {
  chat: ChatTelegram;
  messageId: number;
  /** Hora que dice Telegram, en segundos. Es la que vale para medir. */
  fecha: Date;
  texto: string;
  editado: boolean;
}

interface RespuestaUpdates {
  ok: boolean;
  result?: Array<Record<string, unknown>>;
  description?: string;
}

/**
 * Token del bot del Robot 2.
 *
 * VARIABLE PROPIA, A PROPOSITO
 * El sistema ya tenia un bot de Telegram para ENVIAR alertas, que lee
 * TELEGRAM_BOT_TOKEN. Si el colector usara la misma variable, los dos
 * estarian pidiendo getUpdates con el mismo token, y Telegram entrega
 * cada mensaje UNA sola vez: el que llegara antes se quedaria con el y
 * el otro no veria nada. El fallo no da error, simplemente se pierden
 * mensajes en silencio.
 */
function token(): string {
  const t = process.env.TELEGRAM_RADAR_TOKEN ?? '';
  if (!t) throw new Error('Falta TELEGRAM_RADAR_TOKEN en .env');
  return t;
}

/**
 * Pide los mensajes nuevos desde el ultimo procesado.
 *
 * El offset se guarda en la base de datos y no en memoria: si el proceso
 * se reinicia, hay que seguir por donde iba. Telegram ademas borra de su
 * cola todo lo anterior al offset confirmado, asi que perderlo significa
 * perder mensajes de verdad.
 */
export async function recogerMensajes(limite = 100): Promise<MensajeTelegram[]> {
  const offset = await getState<number>(CLAVE_OFFSET, 0);

  const url =
    `https://api.telegram.org/bot${token()}/getUpdates` +
    `?limit=${limite}&timeout=0` +
    (offset > 0 ? `&offset=${offset}` : '');

  const res = await request<RespuestaUpdates>(url, {
    provider: 'telegram',
    retries: 1,
    timeoutMs: 20_000,
  }).catch((err) => {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'Telegram no respondio');
    return null;
  });

  if (!res?.ok || !res.result) {
    if (res?.description) log.warn({ motivo: res.description }, 'Telegram devolvio error');
    return [];
  }

  const mensajes: MensajeTelegram[] = [];
  let ultimoUpdate = offset;

  for (const u of res.result) {
    const updateId = Number(u.update_id);
    if (Number.isFinite(updateId)) ultimoUpdate = Math.max(ultimoUpdate, updateId);

    // Un mensaje puede llegar por cuatro sitios distintos segun sea grupo
    // o canal, nuevo o editado. Los editados importan: el texto pudo
    // cambiar despues de que lo procesaramos.
    const editado = Boolean(u.edited_message ?? u.edited_channel_post);
    const m = (u.message ?? u.channel_post ?? u.edited_message ?? u.edited_channel_post) as
      | Record<string, unknown>
      | undefined;

    if (!m) continue;
    const chat = m.chat as ChatTelegram | undefined;
    const texto = (m.text ?? m.caption) as string | undefined;

    // Sin texto no hay nada que analizar (fotos, stickers, entradas y
    // salidas de miembros).
    if (!chat || !texto) continue;

    // Los mensajes privados al bot no son fuentes de informacion: son
    // gente escribiendole. No entran en el radar.
    if (chat.type === 'private') continue;

    mensajes.push({
      chat,
      messageId: Number(m.message_id),
      fecha: new Date(Number(m.date) * 1000),
      texto,
      editado,
    });
  }

  // Se confirma el offset SOLO despues de haber extraido todo. Si algo
  // falla antes, en la vuelta siguiente vuelven a llegar los mismos
  // mensajes en vez de perderse.
  //
  // OJO CON EL FUERA DE UNO
  // El parametro offset de Telegram significa "dame las actualizaciones
  // con id MAYOR O IGUAL que esto". Por eso hay que guardar siempre
  // ultimoUpdate + 1: guardar ultimoUpdate a secas hace que la siguiente
  // llamada devuelva otra vez el mismo mensaje.
  //
  // Antes la condicion era "ultimoUpdate > offset", y fallaba justo
  // cuando el id del mensaje coincidia con el offset guardado: no
  // avanzaba nunca y el colector reprocesaba el mismo mensaje cada 30
  // segundos. No daba error, solo trabajaba en balde.
  if (res.result.length > 0) {
    await setState(CLAVE_OFFSET, ultimoUpdate + 1);
  }

  return mensajes;
}

/** Comprueba que el token funciona y devuelve el nombre del bot. */
export async function comprobar(): Promise<{ ok: boolean; usuario?: string; error?: string }> {
  type RespuestaGetMe = {
    ok: boolean;
    result?: { username?: string };
    description?: string;
  };

  const res = await request<RespuestaGetMe>(`https://api.telegram.org/bot${token()}/getMe`, {
    provider: 'telegram',
    retries: 1,
    timeoutMs: 15_000,
  }).catch(
    (err): RespuestaGetMe => ({
      ok: false,
      description: err instanceof Error ? err.message : String(err),
    }),
  );

  if (!res?.ok) return { ok: false, error: res?.description ?? 'sin respuesta' };
  return { ok: true, usuario: res.result?.username };
}
