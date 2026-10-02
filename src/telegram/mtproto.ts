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

/**
 * Tope de tiempo para una llamada a Telegram.
 *
 * La libreria no trae ninguno. Si la conexion se queda a medias, sin
 * cerrarse pero sin responder, la llamada espera indefinidamente. Y como
 * el colector va en un bucle que espera a que termine una vuelta antes de
 * programar la siguiente, una sola llamada colgada dejaba al Robot 2
 * parado del todo y sin dejar rastro en el registro.
 */
const TOPE_LLAMADA_MS = 45_000;

/**
 * Ejecuta una operacion de Telegram con tope de tiempo.
 *
 * Si se agota, se tira la conexion para que la siguiente llamada abra una
 * nueva. Una conexion que ya no responde no se arregla sola: insistir
 * sobre ella es quedarse colgado otra vez.
 */
async function conTope<T>(
  operacion: () => Promise<T>,
  etiqueta: string,
  siFalla: T,
): Promise<T> {
  let reloj: NodeJS.Timeout | undefined;
  try {
    return await new Promise<T>((resolver, rechazar) => {
      reloj = setTimeout(
        () => rechazar(new Error('sin respuesta en ' + Math.round(TOPE_LLAMADA_MS / 1000) + ' s')),
        TOPE_LLAMADA_MS,
      );
      operacion().then(resolver, rechazar);
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn({ operacion: etiqueta, err: msg }, 'llamada a Telegram fallida o colgada');
    if (msg.includes('sin respuesta')) {
      // Conexion muerta: se descarta para que la proxima empiece limpia.
      cliente = null;
    }
    return siFalla;
  } finally {
    if (reloj) clearTimeout(reloj);
  }
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
        // La libreria llama por dentro a estos dos, y solo cuando algo va
        // mal. Si no estan, el propio manejador del error revienta con
        // "canSend is not a function", y entonces un corte pasajero de red
        // se convierte en una conexion que ya no vuelve a levantarse.
        canSend: () => false,
        setLevel: () => {},
      } as never,
    },
  );

  // connect() tampoco tiene tope propio: si la red se queda a medias,
  // se espera para siempre antes de haber hecho nada.
  const abierto = await new Promise<boolean>((resolver) => {
    const reloj = setTimeout(() => resolver(false), TOPE_LLAMADA_MS);
    cliente!.connect().then(
      () => { clearTimeout(reloj); resolver(true); },
      () => { clearTimeout(reloj); resolver(false); },
    );
  });

  if (!abierto) {
    log.warn('no se pudo abrir la conexion con Telegram; se reintentara en la proxima vuelta');
    cliente = null;
    return null;
  }

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
    const r = await conTope(
      () => cli.invoke(new Api.contacts.Search({ q: consulta, limit: limite })),
      'buscar ' + consulta,
      null as unknown as Api.contacts.Found,
    );
    if (!r) return [];
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
    const ent = await conTope(() => cli.getEntity(username), 'mirar @' + username, null);
    if (!ent || ent.className !== 'Channel') return null;
    const c = ent as Api.Channel;

    // getEntity NO trae el numero de miembros: ese dato solo viene en la
    // informacion completa del canal. Sin el, un canal se quedaba sin
    // tamano conocido y la nota lo penalizaba por un dato que si se podia
    // consultar. Es una llamada mas, y por eso quien llama aqui lo hace
    // de pocos en pocos.
    let miembros = c.participantsCount ?? null;
    if (miembros === null) {
      try {
        const full = await cli.invoke(new Api.channels.GetFullChannel({ channel: c }));
        const fc = full.fullChat as Api.ChannelFull;
        miembros = fc.participantsCount ?? null;
      } catch {
        // Hay canales que no dejan ver el recuento. No es un fallo.
      }
    }

    return {
      username: c.username ?? null,
      tgId: String(c.id),
      title: c.title ?? '',
      miembros,
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
  /** Usuario del canal original, cuando Telegram lo deja ver. */
  reenviadoDeUsuario: string | null;
  /** Nombre del canal original, para poder puntuarlo sin entrar. */
  reenviadoDeTitulo: string | null;
}

export interface LecturaCanal {
  /** Los mensajes con texto, en orden. */
  mensajes: MensajeMt[];
  /**
   * El id mas alto que devolvio Telegram, tenga texto o no. Es hasta donde
   * se ha leido: si se avanzara solo hasta el ultimo con texto, una tanda
   * entera de fotos sin pie dejaria el marcador clavado para siempre.
   */
  ultimoId: number;
}

/**
 * Lee los mensajes de un canal en el que ya estamos.
 */
export async function leerCanal(
  username: string,
  desdeId = 0,
  limite = 30,
): Promise<LecturaCanal> {
  const nada: LecturaCanal = { mensajes: [], ultimoId: desdeId };
  const cli = await conectar();
  if (!cli) return nada;

  try {
    const ent = await conTope(() => cli.getEntity(username), 'abrir @' + username, null);
    if (!ent) return nada;
    const c = ent as Api.Channel;
    // HACIA DELANTE DESDE EL ULTIMO LEIDO
    // Antes se pedian los `limite` mas recientes por encima de desdeId. Si
    // entre dos visitas el canal publicaba mas que eso, los del medio no se
    // leian nunca: el marcador saltaba al mas nuevo y el hueco quedaba
    // atras. Ahora se leen en orden desde el ultimo visto; si hay mas de
    // `limite`, el resto se lee en la visita siguiente.
    //
    // La primera vez (desdeId = 0) se cogen los mas recientes: leer hacia
    // delante desde 0 seria empezar por el primer mensaje de la historia
    // del canal.
    const opciones = desdeId > 0
      ? { limit: limite, minId: desdeId, reverse: true }
      : { limit: limite };
    const mensajes = await conTope(
      () => cli.getMessages(ent, opciones),
      'leer @' + username,
      [] as unknown as Awaited<ReturnType<typeof cli.getMessages>>,
    );

    const ultimoId = mensajes.reduce((max, m) => Math.max(max, m.id), desdeId);
    const conTexto = mensajes
      .filter((m) => m.message && m.id > desdeId)
      .sort((x, y) => x.id - y.id)
      .map((m) => {
        // El reenvio dice de donde salio originalmente el contenido: es
        // como se descubren canales que nadie ha buscado nunca.
        //
        // El identificador numerico por si solo no sirve de mucho, porque
        // para volver a pedir un canal hace falta su usuario. Pero el
        // propio mensaje ya trae el canal de origen resuelto, asi que se
        // coge de ahi y no cuesta ni una llamada mas.
        let reenviadoDe: string | null = null;
        let reenviadoDeUsuario: string | null = null;
        let reenviadoDeTitulo: string | null = null;

        const f = m.fwdFrom as Api.MessageFwdHeader | undefined;
        if (f?.fromId && 'channelId' in f.fromId) {
          reenviadoDe = String((f.fromId as Api.PeerChannel).channelId);
        }

        const origen = (m as { forward?: { chat?: unknown } }).forward?.chat;
        if (origen && (origen as Api.Channel).className === 'Channel') {
          const oc = origen as Api.Channel;
          reenviadoDeUsuario = oc.username ?? null;
          reenviadoDeTitulo = oc.title ?? null;
          if (!reenviadoDe) reenviadoDe = String(oc.id);
        }

        return {
          canalTgId: String(c.id),
          canalUsername: c.username ?? null,
          canalTitulo: c.title ?? '',
          mensajeId: m.id,
          fecha: new Date(m.date * 1000),
          texto: m.message ?? '',
          reenviadoDe,
          reenviadoDeUsuario,
          reenviadoDeTitulo,
        };
      });
    return { mensajes: conTexto, ultimoId };
  } catch (err) {
    log.warn(
      { canal: username, err: err instanceof Error ? err.message : String(err) },
      'no se pudo leer el canal',
    );
    return nada;
  }
}

/** Canales en los que la cuenta ya esta dentro. */
export async function misCanales(): Promise<CanalEncontrado[]> {
  const cli = await conectar();
  if (!cli) return [];

  try {
    const dialogos = await conTope(
      () => cli.getDialogs({ limit: 400 }),
      'listar mis canales',
      [] as unknown as Awaited<ReturnType<typeof cli.getDialogs>>,
    );
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
