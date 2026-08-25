/**
 * Triaje de mensajes de Telegram: primera etapa, gratis y sin red.
 *
 * POR QUE EXISTE ESTA ETAPA
 * Vigilar unas decenas de canales son facilmente 10.000 mensajes al dia.
 * Mandarlos todos a un modelo de lenguaje seria caro y ademas lento. La
 * inmensa mayoria se puede descartar con reglas puras: un mensaje que no
 * nombra ninguna direccion de contrato, ningun ticker y ninguna palabra
 * relacionada con tokens no puede contener informacion util sobre uno.
 *
 * Lo que sobrevive aqui pasa a la segunda etapa, que si usa modelo.
 *
 * REGLA DE ORO
 * Ante la duda, PASAR. Esta etapa esta para tirar lo obvio, no para
 * decidir. Descartar de mas aqui significa perder informacion sin haberla
 * mirado nunca, y eso no se puede recuperar despues.
 */

/** Direcciones de Solana: base58, sin 0, O, I ni l. */
const RE_SOLANA = /\b[1-9A-HJ-NP-Za-km-z]{32,44}\b/;

/** Direcciones EVM (Base, Ethereum...). */
const RE_EVM = /\b0x[a-fA-F0-9]{40}\b/;

/** Tickers con dolar delante: $PEPE, $BONK... */
const RE_TICKER = /\$[A-Za-z][A-Za-z0-9]{1,9}\b/;

/**
 * Palabras que indican informacion, no entusiasmo.
 *
 * Estan en los tres idiomas que pide la especificacion. No se buscan
 * palabras sueltas de hype ("moon", "gem"): esas NO cualifican por si
 * solas, justamente porque son las que hay que filtrar.
 */
const PALABRAS_INFORMATIVAS = [
  // Ingles
  'listing', 'listed', 'launch', 'presale', 'partnership', 'audit',
  'contract', 'liquidity', 'locked', 'burn', 'airdrop', 'snapshot',
  'migration', 'unlock', 'vesting', 'treasury', 'buyback', 'whale',
  'rug', 'honeypot', 'scam', 'exploit', 'hack', 'dev sold', 'team sold',
  // Espanol
  'listado', 'lanzamiento', 'preventa', 'asociacion', 'auditoria',
  'contrato', 'liquidez', 'bloqueada', 'quemado', 'quema', 'desbloqueo',
  'estafa', 'robo', 'equipo vendio',
  // Portugues
  'listagem', 'lancamento', 'parceria', 'auditoria', 'contrato',
  'liquidez', 'bloqueada', 'queima', 'golpe', 'equipe vendeu',
];

/**
 * Ruido puro. Un mensaje que SOLO tiene esto y ninguna direccion se
 * descarta sin mas.
 */
const PALABRAS_RUIDO = [
  '100x', '1000x', '10x', 'moon', 'moonshot', 'gem', 'next gem',
  'buy now', 'ape in', 'lfg', 'pump it', 'to the moon', 'guaranteed',
  'easy money', 'dont miss', "don't miss", 'last chance', 'financial freedom',
  'compra ya', 'no te lo pierdas', 'ganancia asegurada', 'dinero facil',
  'compre agora', 'lucro garantido', 'nao perca',
];

export type ResultadoTriaje =
  | { pasa: true; motivo: string; direccion?: string; cadena?: string; ticker?: string }
  | { pasa: false; motivo: string };

/** Un token mencionado dentro de un mensaje. */
export interface Candidato {
  direccion?: string;
  cadena?: string;
  ticker?: string;
  /** De donde salio, para poder explicarlo despues. */
  origen: 'direccion' | 'ticker';
}

/**
 * Saca TODOS los tokens mencionados en un mensaje, no solo el primero.
 *
 * POR QUE HACE FALTA
 * Un solo mensaje puede nombrar varios tokens: los canales publican
 * listas del tipo "top 5 de hoy" continuamente. Quedarse con la primera
 * coincidencia significa tirar el resto sin mirarlo, y no se nota, porque
 * el mensaje si aparece como procesado.
 *
 * Se descubrio con un mensaje real de prueba: llevaba un $WIF en la
 * primera linea y una direccion EVM en la tercera. El sistema se quedaba
 * con la direccion, no la podia resolver, y el $WIF se perdia.
 */
export function extraerCandidatos(texto: string): Candidato[] {
  const encontrados: Candidato[] = [];
  const vistos = new Set<string>();

  // Las direcciones son la senal fiable: van primero.
  for (const m of texto.matchAll(new RegExp(RE_EVM.source, 'g'))) {
    const d = m[0];
    if (vistos.has(d.toLowerCase())) continue;
    vistos.add(d.toLowerCase());
    encontrados.push({ direccion: d, cadena: 'base', origen: 'direccion' });
  }

  for (const m of texto.matchAll(new RegExp(RE_SOLANA.source, 'g'))) {
    const d = m[0];
    // Mismo filtro de falsos positivos que en el triaje: base58 largo
    // tambien casa con hashes de transaccion.
    if (d.length < 40 && !/pump$|bonk$/i.test(d)) continue;
    if (vistos.has(d)) continue;
    vistos.add(d);
    encontrados.push({ direccion: d, cadena: 'solana', origen: 'direccion' });
  }

  // Los tickers solo si el mensaje ademas dice algo informativo: un
  // ticker suelto entre hype no es una mencion util.
  const bajo = texto.toLowerCase();
  const informativa = PALABRAS_INFORMATIVAS.some((p) => bajo.includes(p));
  if (informativa) {
    for (const m of texto.matchAll(new RegExp(RE_TICKER.source, 'g'))) {
      const t = m[0].slice(1);
      if (vistos.has(t.toUpperCase())) continue;
      vistos.add(t.toUpperCase());
      encontrados.push({ ticker: t, origen: 'ticker' });
    }
  }

  return encontrados;
}

/**
 * Texto normalizado para comparar mensajes entre canales.
 *
 * Se usa para detectar copias: dos canales que publican lo mismo con
 * distintos emoji, enlaces de referido o espaciado siguen siendo UNA
 * sola fuente, y contarlos como dos falsearia la independencia.
 */
export function normalizar(texto: string): string {
  return texto
    .toLowerCase()
    // Enlaces fuera: cada canal pone el suyo con su referido.
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/t\.me\/\S+/g, ' ')
    .replace(/@\w+/g, ' ')
    // Emoji y simbolos decorativos.
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ')
    // Todo lo que no sea letra, numero o espacio.
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hash corto y estable del texto normalizado. */
export function hashTexto(texto: string): string {
  const n = normalizar(texto);
  // FNV-1a de 32 bits: suficiente para agrupar copias y muy barato.
  let h = 0x811c9dc5;
  for (let i = 0; i < n.length; i++) {
    h ^= n.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Decide si un mensaje merece pasar a la segunda etapa.
 */
export function triar(texto: string | null | undefined): ResultadoTriaje {
  if (!texto || texto.trim().length < 8) {
    return { pasa: false, motivo: 'mensaje vacio o demasiado corto' };
  }

  const bajo = texto.toLowerCase();

  // 1. Una direccion de contrato es la senal mas fuerte que puede haber:
  //    identifica el token sin ambiguedad. Pasa siempre.
  const evm = texto.match(RE_EVM);
  if (evm) {
    return { pasa: true, motivo: 'contiene direccion EVM', direccion: evm[0], cadena: 'base' };
  }

  const sol = texto.match(RE_SOLANA);
  if (sol) {
    // Filtro de falsos positivos: base58 de 32-44 caracteres tambien casa
    // con hashes de transaccion y con palabras largas sin espacios. Se
    // exige que el mensaje hable de algo, no solo que tenga la cadena.
    const pareceDireccion = /pump$|bonk$/i.test(sol[0]) || sol[0].length >= 40;
    if (pareceDireccion) {
      return { pasa: true, motivo: 'contiene direccion Solana', direccion: sol[0], cadena: 'solana' };
    }
  }

  // 2. Sin direccion, hace falta un ticker Y algo informativo. Un ticker
  //    suelto rodeado de hype no aporta nada.
  const ticker = texto.match(RE_TICKER);
  const informativa = PALABRAS_INFORMATIVAS.find((p) => bajo.includes(p));

  if (ticker && informativa) {
    return {
      pasa: true,
      motivo: `ticker ${ticker[0]} junto a "${informativa}"`,
      ticker: ticker[0].slice(1),
    };
  }

  // 3. Ruido puro: solo entusiasmo, sin token identificable.
  const ruido = PALABRAS_RUIDO.find((p) => bajo.includes(p));
  if (ruido) {
    return { pasa: false, motivo: `ruido ("${ruido}") sin token identificable` };
  }

  if (ticker) {
    return { pasa: false, motivo: `solo un ticker (${ticker[0]}) sin informacion` };
  }
  if (informativa) {
    return { pasa: false, motivo: `habla de "${informativa}" pero no dice de que token` };
  }

  return { pasa: false, motivo: 'sin direccion, sin ticker y sin palabras informativas' };
}
