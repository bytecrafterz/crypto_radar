/**
 * Descubrimiento automatico de canales.
 *
 * El sistema busca sus propias fuentes en vez de trabajar con una lista
 * escrita a mano. Lo hace por tres caminos que se alimentan entre si:
 *
 *   1. Busqueda por palabras clave, en los tres idiomas
 *   2. Enlaces t.me que los canales se pasan unos a otros
 *   3. Reenvios: cuando un canal relaya algo, se sabe de donde salio
 *
 * Empezando con unos pocos, en semanas hay cientos localizados.
 *
 * LO QUE NO HACE: entrar en todos.
 * Va a encontrar miles y la mayoria no valen nada. Se apuntan, se miran
 * de lejos, y solo se entra en los que puntuan bien. Entrar en masa es
 * la forma mas rapida de que Telegram bloquee la cuenta, y ademas hay un
 * tope de unos 500 canales, asi que el sitio es limitado.
 */
import { query, queryOne, exec } from '../core/db.js';
import { child } from '../core/logger.js';
import { buscarCanales, mirarCanal, unirse, salir, pausa } from './mtproto.js';

const log = child('descubrimiento');

/**
 * Cuantos canales nuevos al dia como maximo.
 *
 * Muy conservador a proposito. La cuenta que hace esto es la personal
 * del usuario, y las restricciones de Telegram llegan por RITMO, no por
 * volumen acumulado: una cuenta tranquila puede leer indefinidamente,
 * pero unirse a muchos canales seguidos la marca enseguida.
 */
const UNIONES_POR_DIA = 3;

/** Pausa entre operaciones que tocan la red de Telegram. */
const PAUSA_MS = 4000;

/**
 * Consultas de busqueda, en los tres idiomas que pide la especificacion.
 * Se rota entre ellas: repetir la misma no aporta resultados nuevos.
 */
const CONSULTAS = [
  'solana calls', 'solana gems', 'base gems', 'memecoin calls',
  'crypto calls', 'pumpfun', 'early calls', 'alpha calls', 'degen calls',
  'cripto señales', 'criptomonedas alertas', 'señales cripto', 'gemas cripto',
  'sinais cripto', 'cripto alertas', 'moedas cripto',
];

/** Enlaces a otros canales dentro de un texto. */
const RE_ENLACE = /(?:https?:\/\/)?t\.me\/(?:joinchat\/)?([A-Za-z][A-Za-z0-9_]{3,31})/g;

/**
 * Puntua un canal SIN entrar en el, solo con lo que se ve de fuera.
 *
 * Es una criba tosca a proposito: aqui no se puede saber si un canal es
 * bueno, solo descartar los que evidentemente no lo son. La calidad de
 * verdad se mide despues, viendo si llega antes o despues del movimiento
 * del precio.
 */
function puntuar(titulo: string, miembros: number | null): { score: number; motivo: string } {
  let score = 50;
  const motivos: string[] = [];
  const t = titulo.toLowerCase();

  // Tamano. Ni muy pequeno ni gigante: los canales enormes suelen ser
  // publicidad pagada, y los diminutos no tienen actividad.
  if (miembros === null) {
    score -= 10;
    motivos.push('sin dato de miembros');
  } else if (miembros < 500) {
    score -= 20;
    motivos.push('muy pocos miembros');
  } else if (miembros > 200_000) {
    score -= 15;
    motivos.push('demasiado masivo, suele ser promocion');
  } else if (miembros >= 2000 && miembros <= 80_000) {
    score += 15;
    motivos.push('tamano razonable');
  }

  // Palabras que delatan promocion pagada mas que informacion.
  const promo = ['pump', 'shill', '100x', '1000x', 'vip', 'premium', 'signal group', 'paid'];
  const hallado = promo.find((p) => t.includes(p));
  if (hallado) {
    score -= 15;
    motivos.push(`el titulo dice "${hallado}"`);
  }

  // Palabras que sugieren informacion o vigilancia.
  const bueno = ['alpha', 'research', 'insider', 'scanner', 'radar', 'tracker', 'news'];
  const bien = bueno.find((p) => t.includes(p));
  if (bien) {
    score += 10;
    motivos.push(`el titulo dice "${bien}"`);
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    motivo: motivos.join('; ') || 'sin senales claras',
  };
}

/** Apunta un canal como candidato, si no estaba ya. */
async function apuntar(
  username: string,
  titulo: string,
  miembros: number | null,
  via: 'busqueda' | 'enlace' | 'reenvio',
): Promise<boolean> {
  const p = puntuar(titulo, miembros);
  const fila = await queryOne<{ id: number }>(
    `INSERT INTO tg_canales_descubiertos
       (username, title, miembros, descubierto_por, score, motivo_score)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (username) DO UPDATE SET
       -- Se refresca lo que puede cambiar, pero NO el estado: si ya se
       -- decidio entrar o descartar, esa decision se respeta.
       title    = EXCLUDED.title,
       miembros = EXCLUDED.miembros
     RETURNING id`,
    [username, titulo, miembros, via, p.score, p.motivo],
  );
  return Boolean(fila);
}

/**
 * Ronda de busqueda por palabras clave.
 * Usa unas pocas consultas por vuelta, rotando, para no repetir siempre
 * las mismas ni disparar limites.
 */
export async function buscarNuevos(cuantas = 3): Promise<number> {
  // Rotacion basada en la hora, para recorrer toda la lista a lo largo
  // del dia sin guardar estado.
  const inicio = (new Date().getHours() * cuantas) % CONSULTAS.length;
  let apuntados = 0;

  for (let i = 0; i < cuantas; i++) {
    const consulta = CONSULTAS[(inicio + i) % CONSULTAS.length];
    const encontrados = await buscarCanales(consulta, 10);

    for (const c of encontrados) {
      if (!c.username) continue; // sin username no se puede entrar despues
      if (await apuntar(c.username, c.title, c.miembros, 'busqueda')) apuntados++;
    }
    await pausa(PAUSA_MS);
  }

  if (apuntados > 0) log.info({ apuntados }, 'canales apuntados por busqueda');
  return apuntados;
}

/**
 * Saca enlaces a otros canales de los mensajes ya guardados.
 *
 * Es la via mas barata de todas: no gasta ni una llamada a Telegram,
 * porque el texto ya esta en la base de datos.
 */
export async function extraerDeMensajes(limite = 200): Promise<number> {
  const mensajes = await query<{ text: string }>(
    `SELECT text FROM tg_messages
      WHERE text IS NOT NULL AND text ILIKE '%t.me/%'
      ORDER BY posted_at DESC LIMIT $1`,
    [limite],
  );

  const vistos = new Set<string>();
  for (const m of mensajes) {
    for (const enc of m.text.matchAll(RE_ENLACE)) {
      const u = enc[1];
      // Los enlaces de invitacion privada no sirven: no se pueden mirar
      // desde fuera ni entrar por username.
      if (u.length < 5 || u.startsWith('joinchat')) continue;
      vistos.add(u);
    }
  }

  let apuntados = 0;
  // Mirar cada canal cuesta una llamada, asi que se limita por vuelta.
  for (const u of [...vistos].slice(0, 8)) {
    const ya = await queryOne<{ id: number }>(
      'SELECT id FROM tg_canales_descubiertos WHERE username = $1',
      [u],
    );
    if (ya) continue;

    const info = await mirarCanal(u);
    if (info?.username) {
      if (await apuntar(info.username, info.title, info.miembros, 'enlace')) apuntados++;
    }
    await pausa(PAUSA_MS);
  }

  if (apuntados > 0) log.info({ apuntados }, 'canales apuntados desde enlaces');
  return apuntados;
}

/** Cuantas uniones se han hecho hoy. */
async function unionesHoy(): Promise<number> {
  const f = await queryOne<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM tg_uniones
      WHERE accion = 'union' AND resultado = 'ok' AND ts >= date_trunc('day', now())`,
  );
  return f?.n ?? 0;
}

/**
 * Entra en los mejores candidatos, respetando el tope diario.
 */
export async function unirseALosMejores(): Promise<number> {
  const hechas = await unionesHoy();
  const hueco = UNIONES_POR_DIA - hechas;
  if (hueco <= 0) return 0;

  const candidatos = await query<{ id: number; username: string; score: number }>(
    `SELECT id, username, score FROM tg_canales_descubiertos
      WHERE estado = 'candidato' AND username IS NOT NULL AND score >= 55
      ORDER BY score DESC, miembros DESC NULLS LAST
      LIMIT $1`,
    [hueco],
  );

  let unidos = 0;
  for (const c of candidatos) {
    const r = await unirse(c.username);

    await exec(
      `INSERT INTO tg_uniones (canal_id, username, accion, resultado, detalle)
       VALUES ($1, $2, 'union', $3, $4)`,
      [c.id, c.username, r.ok ? 'ok' : 'error', r.detalle],
    );

    if (r.ok) {
      await exec(
        `UPDATE tg_canales_descubiertos
            SET estado = 'unido', unido_at = now() WHERE id = $1`,
        [c.id],
      );
      unidos++;
    } else if (r.detalle === 'flood_wait') {
      // Telegram ha pedido parar. Se para de verdad: insistir es lo que
      // convierte una espera temporal en un bloqueo permanente.
      log.warn('Telegram pide esperar; no se une a mas canales por ahora');
      break;
    } else {
      await exec(
        `UPDATE tg_canales_descubiertos
            SET estado = 'rechazado', motivo_estado = $2 WHERE id = $1`,
        [c.id, r.detalle],
      );
    }

    await pausa(PAUSA_MS * 3);
  }

  return unidos;
}

/**
 * Abandona canales que llevan tiempo dentro y no han aportado nada.
 *
 * Esto es lo que hace que el sistema se mantenga solo: cada canal inutil
 * que se abandona deja un hueco para probar otro. Sin esto habria que
 * limpiarlo a mano, que es justo lo que la especificacion pedia evitar.
 */
export async function abandonarInutiles(): Promise<number> {
  const malos = await query<{ id: number; username: string; menciones: number }>(
    `SELECT d.id, d.username,
            COALESCE(COUNT(me.id), 0)::int AS menciones
       FROM tg_canales_descubiertos d
       LEFT JOIN tg_channels c  ON c.username = d.username
       LEFT JOIN tg_mentions me ON me.channel_id = c.id
      WHERE d.estado = 'unido'
        -- Se le da al menos una semana antes de juzgarlo.
        AND d.unido_at < now() - interval '7 days'
      GROUP BY d.id, d.username
      -- Ni una sola mencion util en una semana entera.
      HAVING COALESCE(COUNT(me.id), 0) = 0
      LIMIT 2`,
  );

  let fuera = 0;
  for (const m of malos) {
    if (await salir(m.username)) {
      await exec(
        `UPDATE tg_canales_descubiertos
            SET estado = 'abandonado', motivo_estado = 'una semana sin aportar ninguna mencion',
                revisado_at = now()
          WHERE id = $1`,
        [m.id],
      );
      await exec(
        `INSERT INTO tg_uniones (canal_id, username, accion, resultado, detalle)
         VALUES ($1, $2, 'salida', 'ok', 'sin aportar nada en una semana')`,
        [m.id, m.username],
      );
      fuera++;
    }
    await pausa(PAUSA_MS);
  }

  if (fuera > 0) log.info({ fuera }, 'canales abandonados por no aportar');
  return fuera;
}

/** Una vuelta completa de descubrimiento. */
export async function runDescubrimiento(): Promise<{
  buscados: number; enlaces: number; unidos: number; abandonados: number;
}> {
  const buscados = await buscarNuevos(2);
  const enlaces = await extraerDeMensajes();
  const unidos = await unirseALosMejores();
  const abandonados = await abandonarInutiles();

  const r = { buscados, enlaces, unidos, abandonados };
  if (buscados + enlaces + unidos + abandonados > 0) {
    log.info(r, 'vuelta de descubrimiento');
  }
  return r;
}
