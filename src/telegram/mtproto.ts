/**
 * Conexion con Telegram como cuenta de usuario (MTProto).
 *
 * QUE PERMITE Y QUE NO PERMITE EL BOT
 * Un bot solo lee donde alguien lo mete a mano. Una cuenta de usuario
 * puede buscar canales, entrar sola y leer historico. Por eso el
 * descubrimiento automatico solo es posible por aqui.
 *
 * EL PRECIO
 * Esta cuenta se va a comportar como un programa, y Telegram puede
 * acabar restringiendola. Todo lo de este fichero esta escrito para que
 * eso tarde lo maximo posible: se busca despacio, se entra en muy pocos
 * canales al dia, y entre llamada y llamada siempre hay una pausa.
 *
 * No es paranoia: las restricciones llegan por ritmo, no por volumen
 * total. Una cuenta que lee mil mensajes tranquila dura; una que se une
 * a treinta canales en una hora, no.
 */
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { child } from '../core/logger.js';

const log = child('mtproto');

let cliente: TelegramClient | null = null;

/** Pausa entre llamadas. Deliberadamente generosa. */
export function pausa(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function estaConfigurado(): boolean {
  return Boolean(
    process.env.TELEGRAM_API_ID &&
      process.env.TELEGRAM_API_HASH &&
      process.env.TELEGRAM_SESSION,
  );
}

/** Devuelve el cliente conectado, creandolo la primera vez. */
export async function conectar(): Promise<TelegramClient | null> {
  if (!estaConfigurado()) return null;
  if (cliente?.connected) return cliente;

  cliente = new TelegramClient(
    new StringSession(process.env.TELEGRAM_SESSION ?? ''),
    Number(process.env.TELEGRAM_API_ID),
    process.env.TELEGRAM_API_HASH ?? '',
    {
      connectionRetries: 3,
      // La libreria escribe mucho por consola; se silencia y se usa el
      // registro del propio sistema.
      baseLogger: {
        log: () => {}, info: () => {}, warn: () => {},
        error: () => {}, debug: () => {},
      } as never,
    },
  );

  await cliente.connect();
  return cliente;
}

export async function desconectar(): Promise<void> {
  if (cliente?.connected) await cliente.disconnect().catch(() => {});
  cliente = null;
}

export interface CanalEncontrado {
  username: string | null;
  tgId: string;
  title: string;
  miembros: number | null;
}

/**
 * Busca canales publicos por palabra clave.
 *
 * Telegram devuelve pocos resultados por consulta, asi que la variedad
 * viene de usar muchas consultas distintas, no de pedir mas de una vez
 * lo mismo.
 */
export async function buscarCanales(consulta: string, limite = 10): Promise<CanalEncontrado[]> {
  const cli = await conectar();
  if (!cli) return [];

  try {
    const r = await cli.invoke(new Api.contacts.Search({ q: consulta, limit: limite }));
    return (r.chats ?? [])
      .filter((c) => c.className === 'Channel')
      .map((c) => {
        const canal = c as Api.Channel;
        return {
          username: canal.username ?? null,
          tgId: String(canal.id),
          title: canal.title ?? '',
          miembros: canal.participantsCount ?? null,
        };
      });
  } catch (err) {
    log.warn(
      { consulta, err: err instanceof Error ? err.message : String(err) },
      'fallo la busqueda de canales',
    );
    return [];
  }
}

/** Datos publicos de un canal sin necesidad de entrar en el. */
export async function mirarCanal(username: string): Promise<CanalEncontrado | null> {
  const cli = await conectar();
  if (!cli) return null;

  try {
    const ent = await cli.getEntity(username);
    if (ent.className !== 'Channel') return null;
    const c = ent as Api.Channel;
    return {
      username: c.username ?? null,
      tgId: String(c.id),
      title: c.title ?? '',
      miembros: c.participantsCount ?? null,
    };
  } catch {
    // Canal inexistente, privado o el nombre ha cambiado. No es un error
    // del sistema: pasa constantemente con los enlaces que circulan.
    return null;
  }
}

/**
 * Entra en un canal.
 *
 * Es la operacion mas delicada de todas: unirse deprisa es lo que hace
 * que Telegram bloquee la cuenta. Quien llama a esto es responsable de
 * respetar el tope diario.
 */
export async function unirse(username: string): Promise<{ ok: boolean; detalle: string }> {
  const cli = await conectar();
  if (!cli) return { ok: false, detalle: 'sin conexion' };

  try {
    await cli.invoke(new Api.channels.JoinChannel({ channel: username }));
    log.info({ canal: username }, 'unido al canal');
    return { ok: true, detalle: 'unido' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // FLOOD_WAIT significa que Telegram esta pidiendo parar. Hay que
    // obedecer: insistir es lo que convierte una espera en un bloqueo.
    if (msg.includes('FLOOD')) {
      log.warn({ canal: username, msg }, 'Telegram pide esperar; se deja de unir por hoy');
      return { ok: false, detalle: 'flood_wait' };
    }
    return { ok: false, detalle: msg.slice(0, 120) };
  }
}

/** Sale de un canal que no aporta, para dejar sitio a otro. */
export async function salir(username: string): Promise<boolean> {
  const cli = await conectar();
  if (!cli) return false;
  try {
    await cli.invoke(new Api.channels.LeaveChannel({ channel: username }));
    log.info({ canal: username }, 'abandonado el canal');
    return true;
  } catch {
    return false;
  }
}

export interface MensajeMt {
  canalTgId: string;
  canalUsername: string | null;
  canalTitulo: string;
  mensajeId: number;
  fecha: Date;
  texto: string;
  /** Canal del que se reenvio, si es un reenvio. Es la mejor pista. */
  reenviadoDe: string | null;
}

/**
 * Lee los mensajes recientes de los canales en los que ya estamos.
 */
export async function leerCanal(
  username: string,
  desdeId = 0,
  limite = 30,
): Promise<MensajeMt[]> {
  const cli = await conectar();
  if (!cli) return [];

  try {
    const ent = await cli.getEntity(username);
    const c = ent as Api.Channel;
    const mensajes = await cli.getMessages(ent, { limit: limite, minId: desdeId });

    return mensajes
      .filter((m) => m.message)
      .map((m) => {
        // El reenvio dice de donde salio originalmente el contenido: es
        // como se descubren canales que nadie ha buscado.
        let reenviadoDe: string | null = null;
        const f = m.fwdFrom as Api.MessageFwdHeader | undefined;
        if (f?.fromId && 'channelId' in f.fromId) {
          reenviadoDe = String((f.fromId as Api.PeerChannel).channelId);
        }

        return {
          canalTgId: String(c.id),
          canalUsername: c.username ?? null,
          canalTitulo: c.title ?? '',
          mensajeId: m.id,
          fecha: new Date(m.date * 1000),
          texto: m.message ?? '',
          reenviadoDe,
        };
      });
  } catch (err) {
    log.warn(
      { canal: username, err: err instanceof Error ? err.message : String(err) },
      'no se pudo leer el canal',
    );
    return [];
  }
}

/** Canales en los que la cuenta ya esta dentro. */
export async function misCanales(): Promise<CanalEncontrado[]> {
  const cli = await conectar();
  if (!cli) return [];

  try {
    const dialogos = await cli.getDialogs({ limit: 400 });
    return dialogos
      .filter((d) => d.isChannel)
      .map((d) => {
        const c = d.entity as Api.Channel;
        return {
          username: c.username ?? null,
          tgId: String(c.id),
          title: c.title ?? '',
          miembros: c.participantsCount ?? null,
        };
      });
  } catch {
    return [];
  }
}
