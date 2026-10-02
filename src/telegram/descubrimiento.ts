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
import { query, queryOne, exec, getState, setState } from '../core/db.js';
import { child } from '../core/logger.js';
import { buscarCanales, mirarCanal, unirse, salir, pausa } from './mtproto.js';
import { sinTildes } from './triaje.js';

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

/** Por que consulta de la lista va la rotacion. */
const CLAVE_ROTACION = 'descubrimiento_rotacion';

/**
 * Consultas de busqueda, en los tres idiomas que pide la especificacion.
 * Se rota entre ellas: repetir la misma no aporta resultados nuevos.
 */
const CONSULTAS = [
  // LO QUE SE BUSCA, CORREGIDO DOS VECES CON DATOS DELANTE
  //
  // Primero se buscaban solo canales de "calls" y salio que de veintiuna
  // menciones, diecinueve eran promocion pagada. Se cambio a buscar
  // informacion y se fue al extremo contrario: entraron canales de
  // noticias generales que publicaron 341 mensajes y produjeron CERO
  // menciones, porque hablan de Bitcoin y del mercado sin nombrar nunca
  // un token concreto con su direccion.
  //
  // Lo que de verdad hace falta es lo de en medio: canales que hablen de
  // TOKENS CONCRETOS pero informando en vez de vendiendo. Alertas de
  // ballenas, avisos de estafa, desbloqueos, auditorias. Esos si traen
  // direcciones y no son publicidad.
  //
  // Se dejan tambien consultas de "calls" porque, con todo lo promocional
  // que son, hoy son los unicos que producen menciones.
  //
  // LOS TRES IDIOMAS POR IGUAL
  // La especificacion pide buscar en espanol, portugues e ingles. La lista
  // tenia trece consultas en ingles, cuatro en espanol y tres en
  // portugues. Ahora son ocho de cada, intercaladas para que cada vuelta
  // toque idiomas distintos.
  ...intercalar(
    [
      'whale alerts', 'new token listings', 'solana new tokens', 'rug pull alerts',
      'token unlocks', 'onchain analysis', 'liquidity locked', 'solana calls',
    ],
    [
      'alertas ballenas', 'nuevos tokens solana', 'tokens nuevos cripto', 'estafas cripto',
      'alertas rug pull', 'analisis onchain', 'cripto alertas', 'memecoins español',
    ],
    [
      'alertas baleias', 'novos tokens solana', 'novos tokens cripto', 'golpes cripto',
      'alertas rug pull brasil', 'analise onchain', 'cripto alertas brasil', 'memecoins brasil',
    ],
  ),
];

/** [a1, b1, c1, a2, b2, c2, ...] */
function intercalar(...listas: string[][]): string[] {
  const largo = Math.max(...listas.map((l) => l.length));
  const r: string[] = [];
  for (let i = 0; i < largo; i++) for (const l of listas) if (l[i]) r.push(l[i]);
  return r;
}

/**
 * Enlaces a otros canales dentro de un texto.
 *
 * Coge SOLO el primer tramo despues de t.me/ y no se traga ningun prefijo.
 * Antes la expresion se comia "joinchat/" y capturaba lo de detras, que es el
 * codigo de la invitacion y no un canal: se gastaba una llamada en resolver
 * un nombre que no existe. Y el filtro de mas abajo no podia darse cuenta,
 * porque para cuando miraba la palabra "joinchat" ya no estaba.
 *
 * Los enlaces t.me/+CODIGO se quedan fuera solos: el primer caracter tiene
 * que ser una letra.
 */
const RE_ENLACE = /(?:https?:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{3,31})/g;

/**
 * Tramos que ocupan el sitio del nombre de usuario sin serlo.
 *
 * joinchat y addlist son invitaciones y carpetas: lo que llevan detras es un
 * codigo. Resolverlos devuelve USERNAME_INVALID, y cada intento gasta una de
 * las pocas llamadas a Telegram que este sistema se permite por vuelta.
 */
const TRAMOS_NO_USUARIO = new Set([
  'joinchat', 'addlist', 'proxy', 'socks', 'share', 'iv', 'setlanguage', 'addstickers',
]);

/** Alfabetos que no son de ninguno de los tres idiomas pedidos. */
const OTRO_ALFABETO =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}\p{Script=Thai}\p{Script=Devanagari}\p{Script=Bengali}]/u;

/** Temas que no tienen nada que ver con tokens. Sin tildes. */
const FUERA_DE_TEMA = [
  'futbol', 'football', 'soccer', 'champions', 'liga de', 'deporte', 'esporte', 'sports',
  'casino', 'apuestas', 'apostas', 'betting', 'opciones binarias', 'opcoes binarias',
  'binary options',
];

/**
 * Puntua un canal SIN entrar en el, solo con lo que se ve de fuera.
 *
 * Es una criba tosca a proposito: aqui no se puede saber si un canal es
 * bueno, solo descartar los que evidentemente no lo son. La calidad de
 * verdad se mide despues, viendo si llega antes o despues del movimiento
 * del precio.
 */
export function puntuar(
  titulo: string,
  miembros: number | null,
  via: 'busqueda' | 'enlace' | 'reenvio' = 'busqueda',
): { score: number; motivo: string } {
  let score = 50;
  const motivos: string[] = [];
  // NFKC primero: hay titulos escritos con letras "decorativas" de
  // Unicode (𝔏𝔦𝔤𝔞, 𝐀𝐋𝐏𝐇𝐀) que sin normalizar no casan con nada.
  const t = sinTildes(titulo.normalize('NFKC'));

  // IDIOMA
  // La especificacion pide fuentes en espanol, portugues e ingles. Por
  // reenvio entraban canales en chino: con el +25 del reenvio superaban el
  // corte aunque nadie en el equipo pudiera leerlos.
  if (OTRO_ALFABETO.test(titulo)) {
    score -= 45;
    motivos.push('titulo en un alfabeto fuera de espanol, portugues e ingles');
  }

  // TEMA
  // Tambien por reenvio entro un canal de futbol. No habla de tokens.
  const fuera = FUERA_DE_TEMA.find((p) => t.includes(p));
  if (fuera) {
    score -= 45;
    motivos.push(`fuera de tema ("${fuera}")`);
  }

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
  // 'calls', 'gems', 'senales' y 'sinais' entraron aqui despues de ver
  // los datos: de veintiuna menciones recogidas de canales asi,
  // diecinueve eran promocion pagada y ni una sola era informacion. No se
  // descartan del todo porque llegan pronto, pero no pueden seguir
  // ganandole el sitio a un canal que si informa.
  const promo = [
    'pump', 'shill', '100x', '1000x', 'vip', 'premium', 'signal group', 'paid',
    'calls', 'gems', 'senales', 'señales', 'sinais', 'degen', 'ape',
  ];
  const hallado = promo.find((p) => t.includes(p));
  if (hallado) {
    score -= 15;
    motivos.push(`el titulo dice "${hallado}"`);
  }

  // Palabras que sugieren informacion o vigilancia.
  // 'alpha' estaba aqui y era un error: los canales que se llaman
  // "alpha calls" resultaron ser los mas promocionales de todos. Premiarlo
  // era premiar lo contrario de lo que se busca.
  // 'news' y 'noticias' estaban aqui y fue un error: atraian canales de
  // noticias generales que hablan del mercado sin nombrar ningun token.
  // 341 mensajes suyos y ni una sola mencion aprovechable.
  const bueno = [
    'whale', 'ballena', 'baleia', 'scanner', 'radar', 'tracker',
    'onchain', 'on-chain', 'audit', 'auditoria', 'unlock', 'alert',
    'insider', 'scam', 'rug', 'estafa',
  ];
  const bien = bueno.find((p) => t.includes(p));
  if (bien) {
    score += 10;
    motivos.push(`el titulo dice "${bien}"`);
  }

  // Un canal al que alguien reenvia ya ha demostrado tiron: alguien
  // eligio relayar lo que publica. Eso es mejor prueba que coincidir con
  // una palabra de busqueda, y ademas compensa que por esta via nunca
  // llega el numero de miembros.
  if (via === 'reenvio') {
    score += 25;
    motivos.push('alguien reenvio su contenido');
  }

  return {
    score: Math.max(0, Math.min(100, score)),
    motivo: motivos.join('; ') || 'sin senales claras',
  };
}

/**
 * Apunta un canal descubierto por reenvio.
 *
 * Es la via mas barata de las tres y la que encuentra canales que nadie
 * localizaria buscando: cuando un canal relaya algo, el mensaje ya trae
 * de donde salio, asi que no cuesta ninguna llamada extra a Telegram.
 */
export async function apuntarReenvio(
  username: string,
  titulo: string,
): Promise<boolean> {
  const ya = await queryOne<{ id: number }>(
    'SELECT id FROM tg_canales_descubiertos WHERE username = $1',
    [username],
  );
  if (ya) return false;
  // Sin dato de miembros: verlo costaria una llamada, y aqui interesa
  // apuntarlo y seguir leyendo. Ya se puntuara mejor cuando toque.
  return apuntar(username, titulo, null, 'reenvio');
}

/** Apunta un canal como candidato, si no estaba ya. */
async function apuntar(
  username: string,
  titulo: string,
  miembros: number | null,
  via: 'busqueda' | 'enlace' | 'reenvio',
): Promise<boolean> {
  const p = puntuar(titulo, miembros, via);
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
  // ROTACION CON MEMORIA
  // Antes el punto de partida salia de la hora del dia. Con una vuelta
  // cada dos horas, las horas pares tocaban siempre las mismas consultas
  // y las impares las otras: la mitad de la lista no se usaba nunca, y
  // con ella casi todas las de portugues. Ahora se guarda por donde se
  // iba y se sigue desde ahi.
  const inicio = (await getState<number>(CLAVE_ROTACION, 0)) % CONSULTAS.length;
  await setState(CLAVE_ROTACION, (inicio + cuantas) % CONSULTAS.length);
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
      if (u.length < 5 || TRAMOS_NO_USUARIO.has(u.toLowerCase())) continue;
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

/**
 * Completa los canales apuntados sin numero de miembros.
 *
 * Los que llegan por reenvio no traen ese dato, y sin el la nota se
 * queda coja. Mirarlos cuesta una llamada por canal, asi que se hacen
 * unos pocos por vuelta y con pausa.
 */
export async function completarSinMiembros(cuantos = 3): Promise<number> {
  const pendientes = await query<{ id: number; username: string; title: string; descubierto_por: string }>(
    `SELECT id, username, title, descubierto_por
       FROM tg_canales_descubiertos
      WHERE miembros IS NULL AND estado = 'candidato' AND username IS NOT NULL
      ORDER BY visto_at DESC
      LIMIT $1`,
    [cuantos],
  );

  let completados = 0;
  for (const c of pendientes) {
    const info = await mirarCanal(c.username);
    if (info) {
      const via = c.descubierto_por as 'busqueda' | 'enlace' | 'reenvio';
      const p = puntuar(info.title || c.title, info.miembros, via);
      await exec(
        `UPDATE tg_canales_descubiertos
            SET miembros = $2, score = $3, motivo_score = $4, revisado_at = now()
          WHERE id = $1`,
        [c.id, info.miembros, p.score, p.motivo],
      );
      completados++;
    } else {
      // El canal ya no existe o es privado: no vale la pena volver.
      await exec(
        `UPDATE tg_canales_descubiertos
            SET estado = 'rechazado', motivo_estado = 'no se pudo consultar'
          WHERE id = $1`,
        [c.id],
      );
    }
    await pausa(PAUSA_MS);
  }

  if (completados > 0) log.info({ completados }, 'canales completados con su numero de miembros');
  return completados;
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
      await dejarDeLeer(m.username);
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

/**
 * Abandona canales que solo publican publicidad.
 *
 * POR QUE HACE FALTA ADEMAS DEL ANTERIOR
 * El otro solo echa a los que no aportan NINGUNA mencion. Un canal que
 * publica veinte promociones pagadas al dia si aporta menciones, asi que
 * sobrevivia para siempre ocupando una plaza. Y para el Robot 3 no vale
 * nada: una promocion no cuenta como fuente independiente.
 *
 * LA EXCEPCION QUE IMPORTA
 * Un canal promocional que llega ANTES del movimiento si vale, aunque
 * venda. El primero que medimos, Alpha Calls, publico un token casi
 * cuatro horas antes de que el precio se moviera, y todos sus mensajes
 * son promocion. Ese no se toca: la publicidad no cuenta como fuente,
 * pero adelantarse al mercado es exactamente lo que buscamos.
 *
 * Asi que se echa solo al que ademas nunca se ha adelantado a nada.
 */
export async function abandonarSoloPublicidad(): Promise<number> {
  const malos = await query<{ id: number; username: string; promo: number }>(
    `SELECT d.id, d.username, COUNT(*) FILTER (WHERE m.clasificacion = 'promocion')::int AS promo
       FROM tg_canales_descubiertos d
       JOIN tg_channels c  ON c.username = d.username
       JOIN tg_messages m  ON m.channel_id = c.id AND m.clasificado_at IS NOT NULL
      WHERE d.estado = 'unido'
        AND d.unido_at < now() - interval '7 days'
      -- c.id entra en el GROUP BY porque la subconsulta de abajo lo usa.
      -- Sin el, PostgreSQL rechaza la consulta entera y la vuelta de
      -- descubrimiento reventaba cada dos horas sin llegar al final.
      GROUP BY d.id, d.username, c.id
      -- Muestra suficiente para juzgar, y ni una sola vez informacion.
      HAVING COUNT(*) >= 8
         AND COUNT(*) FILTER (WHERE m.clasificacion = 'informacion') = 0
         -- Y que ademas nunca se haya adelantado al movimiento.
         AND NOT EXISTS (
           SELECT 1 FROM tg_mentions me
            WHERE me.channel_id = c.id AND me.anticipacion_seg > 0)
      LIMIT 2`,
  );

  let fuera = 0;
  for (const m of malos) {
    if (await salir(m.username)) {
      await exec(
        `UPDATE tg_canales_descubiertos
            SET estado = 'abandonado',
                motivo_estado = 'solo publicidad y nunca se adelanto al movimiento',
                revisado_at = now()
          WHERE id = $1`,
        [m.id],
      );
      await dejarDeLeer(m.username);
      await exec(
        `INSERT INTO tg_uniones (canal_id, username, accion, resultado, detalle)
         VALUES ($1, $2, 'salida', 'ok', $3)`,
        [m.id, m.username, `${m.promo} promociones y ninguna informacion`],
      );
      fuera++;
    }
    await pausa(PAUSA_MS);
  }

  if (fuera > 0) log.info({ fuera }, 'canales abandonados por publicar solo publicidad');
  return fuera;
}

/**
 * Deja de leer un canal del que se ha salido.
 *
 * Salir solo se apuntaba en la lista de descubiertos: el lector seguia
 * leyendo el canal (los publicos se pueden leer sin estar dentro) y sus
 * menciones seguian contando como fuentes para el Robot 3. El panel decia
 * "15 abandonados" mientras los 58 se seguian leyendo.
 */
async function dejarDeLeer(username: string): Promise<void> {
  await exec('UPDATE tg_channels SET active = false WHERE lower(username) = lower($1)', [username]);
}

/**
 * Pone al dia los canales abandonados antes de que existiera dejarDeLeer.
 * No hace nada si ya estan bien, asi que puede correr en cada vuelta.
 */
async function desactivarAbandonados(): Promise<number> {
  return exec(
    `UPDATE tg_channels c SET active = false
       FROM tg_canales_descubiertos d
      WHERE lower(d.username) = lower(c.username)
        AND d.estado = 'abandonado' AND c.active`,
  );
}

/** Menciones medidas que hacen falta para juzgar si un canal llega tarde. */
const MEDIDAS_PARA_JUZGAR = 6;

/**
 * Abandona canales que llegan siempre tarde.
 *
 * Los otros dos criterios no lo cubrian: un canal que cita tokens a
 * diario, siempre cuando ya han subido, aporta menciones y no es solo
 * publicidad, asi que se quedaba para siempre. Para el Robot 3 vale cero
 * (su reputacion es 0) y ocupa una plaza que podria tener otro.
 *
 * Solo canales que encontro el propio sistema: los que el cliente puso a
 * mano no se tocan. Y solo con muestra suficiente: seis menciones con el
 * precio medido y ni una sola antes del movimiento.
 */
export async function abandonarTardios(): Promise<number> {
  const malos = await query<{ id: number; username: string; medidas: number }>(
    `SELECT d.id, d.username, COUNT(*)::int AS medidas
       FROM tg_canales_descubiertos d
       JOIN tg_channels c  ON lower(c.username) = lower(d.username)
       JOIN tg_mentions me ON me.channel_id = c.id
      WHERE d.estado = 'unido'
        AND d.unido_at < now() - interval '7 days'
        AND me.anticipacion_veredicto IN ('se_adelanto', 'reacciono', 'sin_movimiento')
      GROUP BY d.id, d.username
     HAVING COUNT(*) >= $1
        AND COUNT(*) FILTER (WHERE me.anticipacion_veredicto = 'se_adelanto') = 0
      LIMIT 2`,
    [MEDIDAS_PARA_JUZGAR],
  );

  let fuera = 0;
  for (const m of malos) {
    const ok = await abandonar(
      m.id, m.username, 'siempre llega despues del movimiento',
      `${m.medidas} menciones medidas y ninguna antes del movimiento`,
    );
    if (ok) fuera++;
    await pausa(PAUSA_MS);
  }

  if (fuera > 0) log.info({ fuera }, 'canales abandonados por llegar siempre tarde');
  return fuera;
}

/** Sale de un canal descubierto y deja constancia de por que. */
async function abandonar(id: number, username: string, motivo: string, detalle: string): Promise<boolean> {
  if (!(await salir(username))) return false;
  await exec(
    `UPDATE tg_canales_descubiertos
        SET estado = 'abandonado', motivo_estado = $2, revisado_at = now()
      WHERE id = $1`,
    [id, motivo],
  );
  await dejarDeLeer(username);
  await exec(
    `INSERT INTO tg_uniones (canal_id, username, accion, resultado, detalle)
     VALUES ($1, $2, 'salida', 'ok', $3)`,
    [id, username, detalle],
  );
  return true;
}

/**
 * Abandona canales que escriben casi siempre en otro idioma.
 *
 * La especificacion pide fuentes en espanol, portugues e ingles. El titulo
 * ya filtra los evidentes antes de entrar (otro alfabeto), pero hay canales
 * con titulo en ingles que publican en otro idioma, y solo se ve dentro. El
 * idioma de cada mensaje lo dice el clasificador.
 */
export async function abandonarOtroIdioma(): Promise<number> {
  const malos = await query<{ id: number; username: string; total: number; buenos: number }>(
    `SELECT d.id, d.username, COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE m.idioma IN ('es', 'pt', 'en'))::int AS buenos
       FROM tg_canales_descubiertos d
       JOIN tg_channels c  ON lower(c.username) = lower(d.username)
       JOIN tg_messages m  ON m.channel_id = c.id AND m.idioma IS NOT NULL
      WHERE d.estado = 'unido'
        AND d.unido_at < now() - interval '3 days'
      GROUP BY d.id, d.username
     HAVING COUNT(*) >= 8
        AND COUNT(*) FILTER (WHERE m.idioma IN ('es', 'pt', 'en')) < COUNT(*) * 0.3
      LIMIT 2`,
  );

  let fuera = 0;
  for (const m of malos) {
    const ok = await abandonar(
      m.id, m.username, 'escribe en otro idioma',
      `${m.total - m.buenos} de ${m.total} mensajes fuera de espanol, portugues e ingles`,
    );
    if (ok) fuera++;
    await pausa(PAUSA_MS);
  }

  if (fuera > 0) log.info({ fuera }, 'canales abandonados por escribir en otro idioma');
  return fuera;
}

/** Una vuelta completa de descubrimiento. */
export async function runDescubrimiento(): Promise<{
  buscados: number; enlaces: number; unidos: number; abandonados: number;
}> {
  const buscados = await buscarNuevos(2);
  const enlaces = await extraerDeMensajes();
  // Completar antes de decidir: si no, se entraria en canales mal
  // puntuados solo porque les faltaba el dato de miembros.
  await completarSinMiembros();
  const unidos = await unirseALosMejores();
  const abandonados = await abandonarInutiles();
  const publicitarios = await abandonarSoloPublicidad();
  const tardios = await abandonarTardios();
  const otroIdioma = await abandonarOtroIdioma();
  const desactivados = await desactivarAbandonados();
  if (desactivados > 0) log.info({ desactivados }, 'canales abandonados que se seguian leyendo, ya no');

  const r = { buscados, enlaces, unidos, abandonados: abandonados + publicitarios + tardios + otroIdioma };
  if (buscados + enlaces + unidos + abandonados > 0) {
    log.info(r, 'vuelta de descubrimiento');
  }
  return r;
}
