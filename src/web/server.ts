/**
 * Panel web.
 *
 * El panel es una aplicacion aparte (carpeta web/, React) que se compila a
 * dist/panel con `npm run build`. Este servidor la entrega tal cual y le
 * sirve los datos por la API de api.ts. Ningun dato sale sin sesion: la
 * aplicacion en si no lleva datos, solo los pide.
 */
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../core/env.js';
import { getState, setState } from '../core/db.js';
import { child } from '../core/logger.js';
import * as repo from '../core/repo.js';
import * as dexscreener from '../sources/dexscreener.js';
import { enrichToken } from '../worker/enrichment.js';
import { getUsage } from '../core/http.js';
import { registrarApiPanel } from './api.js';

const log = child('panel');
const COOKIE = 'radar_sesion';

/**
 * Donde queda la aplicacion compilada. La misma ruta vale ejecutando desde
 * src/ (tsx) y desde dist/: en los dos casos la raiz esta dos niveles arriba.
 */
const PANEL_DIR = path.resolve(fileURLToPath(new URL('../../', import.meta.url)), 'dist/panel');

/**
 * Sal aleatoria propia de esta instalacion.
 *
 * Sin ella el valor de la cookie es HMAC(SESSION_SECRET, PANEL_PASSWORD): si
 * ambos siguen con el valor de ejemplo, cualquiera puede calcular la cookie en
 * su ordenador y entrar sin saber la contrasena. La sal se genera una vez y se
 * guarda, para que las sesiones sobrevivan a los reinicios.
 */
let sessionSalt = '';

async function loadSessionSalt(): Promise<void> {
  const guardada = await getState<string>('session_salt', '');
  if (guardada) {
    sessionSalt = guardada;
    return;
  }
  sessionSalt = randomBytes(32).toString('hex');
  await setState('session_salt', sessionSalt);
  log.info('generada una sal de sesion nueva para esta instalacion');
}

/** Valor de sesion derivado de la contrasena, la sal y el secreto. */
function sessionToken(): string {
  return createHmac('sha256', `${env.sessionSecret}:${sessionSalt}`)
    .update(env.panelPassword)
    .digest('hex');
}

function isAuthenticated(req: FastifyRequest): boolean {
  const value = req.cookies?.[COOKIE];
  if (!value) return false;
  const expected = sessionToken();
  if (value.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(value), Buffer.from(expected));
  } catch {
    return false;
  }
}

/** Comparacion en tiempo constante, para no dar pistas por lo que tarda. */
function iguales(a: string, b: string): boolean {
  return (
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a.padEnd(64, '\0').slice(0, 64)), Buffer.from(b.padEnd(64, '\0').slice(0, 64)))
  );
}

// API que NO pasa por el guardian de sesion.
//
// /api/candidato no es publica: lleva su propia autenticacion por cabecera
// (x-api-secret), porque quien la llama es otro programa, no una persona
// con navegador y cookie de sesion.
const API_PUBLICA = new Set(['/api/candidato']);

/**
 * Intentos fallidos de entrar, por IP.
 *
 * El panel esta en internet: sin freno, se pueden probar contrasenas sin
 * limite. A los 8 fallos en 15 minutos se deja de comprobar hasta que pasen.
 */
const MAX_FALLOS = 8;
const VENTANA_FALLOS_MS = 15 * 60_000;
const fallos = new Map<string, { n: number; hasta: number }>();

function bloqueado(ip: string): boolean {
  const f = fallos.get(ip);
  return f !== undefined && f.hasta > Date.now() && f.n >= MAX_FALLOS;
}

function apuntarFallo(ip: string): void {
  const ahora = Date.now();
  if (fallos.size > 5_000) {
    for (const [k, v] of fallos) if (v.hasta <= ahora) fallos.delete(k);
  }
  const f = fallos.get(ip);
  if (f && f.hasta > ahora) f.n++;
  else fallos.set(ip, { n: 1, hasta: ahora + VENTANA_FALLOS_MS });
}

export async function buildServer() {
  await loadSessionSalt();

  // Con la contrasena de ejemplo el panel es publico de facto. En produccion
  // se para el arranque: es preferible un fallo evidente a un panel abierto.
  const porDefecto = ['radar', 'cambia-esta-clave'];
  if (porDefecto.includes(env.panelPassword)) {
    const aviso =
      'PANEL_PASSWORD sigue con el valor de ejemplo: cualquiera podria entrar en el panel.';
    if (env.isProd) throw new Error(`${aviso} Cambialo en el fichero .env antes de arrancar.`);
    log.warn(aviso);
  }

  const app = Fastify({ logger: false, trustProxy: true });

  await app.register(cookie, { secret: env.sessionSecret });

  // --- Autenticacion ------------------------------------------------------
  // Solo se protege la API: la aplicacion del panel no lleva datos, y es
  // ella la que ensena la pantalla de acceso cuando la API responde 401.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const ruta = req.url.split('?')[0];
    if (!ruta.startsWith('/api/')) return;
    if (API_PUBLICA.has(ruta)) return;
    if (ruta === '/api/panel/sesion' && req.method === 'POST') return;
    if (isAuthenticated(req)) return;
    return reply.code(401).send({ error: 'No autorizado' });
  });

  app.post('/api/panel/sesion', async (req: FastifyRequest, reply: FastifyReply) => {
    if (bloqueado(req.ip)) {
      return reply.code(429).send({ error: 'Demasiados intentos. Vuelve a probar en unos minutos.' });
    }
    const body = (req.body ?? {}) as { password?: unknown };
    const dada = typeof body.password === 'string' ? body.password : '';

    if (!iguales(dada, env.panelPassword)) {
      apuntarFallo(req.ip);
      log.warn({ ip: req.ip }, 'intento de acceso fallido');
      return reply.code(401).send({ error: 'Contrasena incorrecta.' });
    }

    fallos.delete(req.ip);
    reply.setCookie(COOKIE, sessionToken(), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: 60 * 60 * 24 * 30,
    });
    return { ok: true };
  });

  // Comprueba si la sesion sigue valida (el guardian ya respondio 401 si no).
  app.get('/api/panel/sesion', async () => ({ ok: true }));

  app.delete('/api/panel/sesion', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  // Enlaces antiguos de salida: siguen funcionando.
  app.get('/salir', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return reply.redirect('/entrar');
  });

  registrarApiPanel(app);

  /**
   * Entrada de candidatos desde fuera (Robot 2 / Robot 3).
   *
   * El Robot 2 encuentra un token en Telegram y lo manda aqui. Este
   * endpoint NO decide nada: solo hace pasar el token por el mismo
   * analisis completo que cualquier token descubierto por el propio
   * radar, y devuelve el veredicto.
   *
   * Es deliberado que sea asi. El Robot 1 no relaja sus criterios porque
   * alguien haya hablado del token en Telegram: los vetos siguen mandando
   * y una moneda con honeypot se rechaza igual aunque medio Telegram este
   * hablando de ella.
   *
   * Protegido con secreto compartido porque es una ruta de escritura.
   */
  app.post('/api/candidato', async (req: FastifyRequest, reply: FastifyReply) => {
    const secreto = process.env.API_SHARED_SECRET ?? '';
    if (!secreto) {
      return reply.code(503).send({ error: 'API_SHARED_SECRET no configurado' });
    }
    const dado = String(req.headers['x-api-secret'] ?? '');
    if (!iguales(dado, secreto)) {
      log.warn({ ip: req.ip }, 'candidato rechazado: secreto invalido');
      return reply.code(401).send({ error: 'no autorizado' });
    }

    const body = (req.body ?? {}) as { chain?: string; address?: string; origen?: string };
    const chain = body.chain === 'solana' || body.chain === 'base' ? body.chain : null;
    const address = (body.address ?? '').trim();

    if (!chain || !address) {
      return reply.code(400).send({ error: 'faltan chain (solana|base) o address' });
    }

    // Si ya lo conocemos y ya se analizo, se devuelve lo que hay en vez de
    // volver a gastar cuota de las APIs.
    const existente = await repo.getToken(chain, address);
    if (existente?.enriched_at) {
      return {
        ya_analizado: true,
        symbol: existente.symbol,
        opportunity: existente.last_opportunity,
        risk: existente.last_risk,
        analizado_at: existente.enriched_at,
      };
    }

    // Los datos de mercado los busca el propio radar: el Robot 2 solo
    // aporta la direccion, no numeros en los que haya que confiar.
    const pair = await dexscreener.getToken(chain, address);
    if (!pair) {
      return reply.code(404).send({
        error: 'sin datos de mercado',
        detalle: 'DexScreener no conoce ese token; puede no tener pool todavia',
      });
    }

    const token = await repo.upsertToken({ ...pair, source: body.origen ?? 'telegram' });
    const analysis = await enrichToken(token);

    if (!analysis?.score) {
      return reply.code(422).send({ error: 'no se pudo analizar', symbol: pair.symbol });
    }

    log.info(
      { symbol: pair.symbol, origen: body.origen, opp: analysis.score.opportunity },
      'candidato externo analizado',
    );

    return {
      ya_analizado: false,
      symbol: pair.symbol,
      chain,
      address,
      opportunity: analysis.score.opportunity,
      risk: analysis.score.risk,
      vetoed: analysis.score.vetoed,
      evaluable: analysis.score.evaluable,
      light: analysis.score.light,
      // Se devuelven como texto plano, no como objetos: quien consume esto
      // es el Robot 3, que necesita explicar la decision en la alerta.
      motivos_oportunidad: analysis.score.opportunityReasons.map((r) => r.text),
      motivos_riesgo: analysis.score.riskReasons.map((r) => r.text),
      vetos: analysis.score.criticalVetoes.map((v) => v.text),
      falta_por_comprobar: analysis.score.missingData,
    };
  });

  // --- API JSON (por si quieres conectar otra herramienta) ---------------
  app.get('/api/estado', async () => ({
    ...(await repo.getDashboardStats()),
    apis: getUsage(),
  }));

  app.get('/api/tokens', async (req) => {
    const q = (req.query ?? {}) as Record<string, string>;
    return repo.listTokens({
      chain: q.chain || undefined,
      status: q.status || undefined,
      minOpportunity: q.minop ? Number(q.minop) : undefined,
      maxRisk: q.maxrisk ? Number(q.maxrisk) : undefined,
      limit: Math.min(Number(q.limit ?? 50) || 50, 200),
      orderBy: (q.orden as repo.TokenListFilters['orderBy']) || 'reciente',
    });
  });

  app.get('/api/token/:chain/:address', async (req, reply) => {
    const { chain, address } = req.params as { chain: string; address: string };
    const token = await repo.getToken(chain as 'solana' | 'base', address);
    if (!token) return reply.code(404).send({ error: 'No encontrado' });

    const [security, holders, deployer, score, suspicious] = await Promise.all([
      repo.getLatestSecurity(token.id),
      repo.getLatestHolders(token.id),
      repo.getLatestDeployer(token.id),
      repo.getLatestScore(token.id),
      repo.getSuspicious(token.id, 25),
    ]);
    return { token, security, holders, deployer, score, suspicious };
  });

  app.get('/api/alertas', async () => repo.recentAlerts(100));

  // --- Salud --------------------------------------------------------------
  app.get('/salud', async () => ({ ok: true, ts: new Date().toISOString() }));
  app.get('/health', async () => ({ ok: true, ts: new Date().toISOString() }));

  // --- La aplicacion del panel ---------------------------------------------
  const compilado = existsSync(path.join(PANEL_DIR, 'index.html'));
  if (compilado) {
    await app.register(fastifyStatic, {
      root: PANEL_DIR,
      prefix: '/',
      wildcard: false,
      index: false,
      setHeaders: (res, ruta) => {
        // Lo de assets/ lleva un resumen del contenido en el nombre: puede
        // guardarse un ano. El resto, siempre la version del servidor.
        res.setHeader(
          'Cache-Control',
          ruta.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  } else {
    log.warn({ carpeta: PANEL_DIR }, 'el panel no esta compilado: ejecuta npm run build');
  }

  // Cualquier otra ruta es una pagina del panel: la decide la aplicacion.
  app.setNotFoundHandler(async (req, reply) => {
    if (req.method !== 'GET' || req.url.startsWith('/api/')) {
      return reply.code(404).send({ error: 'No encontrado' });
    }
    if (!compilado) {
      return reply.code(503).type('text/plain; charset=utf-8').send('Panel sin compilar: ejecuta npm run build.');
    }
    return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
  });

  app.setErrorHandler(async (err: unknown, _req, reply) => {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'error en el panel');
    return reply.code(500).send({ error: 'Error interno del panel' });
  });

  return app;
}

export async function startWeb() {
  const app = await buildServer();
  await app.listen({ port: env.port, host: env.host });
  log.info({ puerto: env.port }, 'panel web disponible');
  return app;
}

// Permite arrancar solo el panel: npm run web
const isMain =
  process.argv[1] && (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (isMain) {
  startWeb().catch((err) => {
    log.error({ err: String(err) }, 'no se pudo arrancar el panel');
    process.exit(1);
  });
}
