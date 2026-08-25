/**
 * Panel web.
 *
 * Paginas generadas en el servidor: no hay compilacion, ni dependencias
 * externas, ni JavaScript en el navegador. Arranca en un segundo y funciona
 * en el servidor mas barato.
 */
import Fastify, { type FastifyRequest, type FastifyReply } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';
import { env } from '../core/env.js';
import { getState, setState } from '../core/db.js';
import { child } from '../core/logger.js';
import * as repo from '../core/repo.js';
import * as dexscreener from '../sources/dexscreener.js';
import { renderTelegram } from './telegram-page.js';
import { enrichToken } from '../worker/enrichment.js';
import { getUsage } from '../core/http.js';
import {
  renderLogin,
  renderDashboard,
  renderTokens,
  renderTokenDetail,
  renderAlerts,
  renderResults,
  renderSystem,
} from './pages.js';
import { page } from './layout.js';
import { escapeHtml } from '../core/util.js';

const log = child('panel');
const COOKIE = 'radar_sesion';

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

// Rutas que NO pasan por el guardian de sesion del panel.
//
// /api/candidato no es publica: lleva su propia autenticacion por cabecera
// (x-api-secret), porque quien la llama es otro programa, no una persona
// con navegador y cookie de sesion. Se excluye aqui para que el guardian
// no la corte antes de llegar a su propia comprobacion.
const PUBLIC_PATHS = new Set(['/entrar', '/salud', '/health', '/api/candidato']);

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
  await app.register(formbody);

  // --- Autenticacion ------------------------------------------------------
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (PUBLIC_PATHS.has(req.url.split('?')[0])) return;
    if (isAuthenticated(req)) return;
    if (req.url.startsWith('/api/')) {
      return reply.code(401).send({ error: 'No autorizado' });
    }
    return reply.type('text/html; charset=utf-8').send(renderLogin());
  });

  app.post('/entrar', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as { password?: string };
    const given = body.password ?? '';

    const ok =
      given.length === env.panelPassword.length &&
      timingSafeEqual(
        Buffer.from(given.padEnd(64, '\0').slice(0, 64)),
        Buffer.from(env.panelPassword.padEnd(64, '\0').slice(0, 64)),
      );

    if (!ok) {
      log.warn({ ip: req.ip }, 'intento de acceso fallido');
      return reply
        .type('text/html; charset=utf-8')
        .send(renderLogin('Contrasena incorrecta.'));
    }

    reply.setCookie(COOKIE, sessionToken(), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      maxAge: 60 * 60 * 24 * 30,
    });
    return reply.redirect('/');
  });

  app.get('/salir', async (_req: FastifyRequest, reply: FastifyReply) => {
    reply.clearCookie(COOKIE, { path: '/' });
    return reply.redirect('/entrar');
  });

  app.get('/entrar', async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.type('text/html; charset=utf-8').send(renderLogin()),
  );

  // --- Paginas ------------------------------------------------------------
  const html = (reply: FastifyReply, content: string) =>
    reply.type('text/html; charset=utf-8').send(content);

  app.get('/', async (_req, reply) => html(reply, await renderDashboard()));

  app.get('/tokens', async (req, reply) =>
    html(reply, await renderTokens((req.query ?? {}) as Record<string, string>)),
  );

  app.get('/token/:chain/:address', async (req, reply) => {
    const { chain, address } = req.params as { chain: string; address: string };
    const content = await renderTokenDetail(chain, address);
    if (!content) {
      return reply
        .code(404)
        .type('text/html; charset=utf-8')
        .send(
          page(
            { title: 'No encontrado', active: 'tokens' },
            '<div class="empty"><h1>Token no encontrado</h1><p>Ese token no esta en la base de datos.</p><p><a href="/tokens">Volver al listado</a></p></div>',
          ),
        );
    }
    return html(reply, content);
  });

  app.get('/alertas', async (_req, reply) => html(reply, await renderAlerts()));
  app.get('/resultados', async (_req, reply) => html(reply, await renderResults()));
  app.get('/sistema', async (_req, reply) => html(reply, await renderSystem()));
  app.get('/telegram', async (_req, reply) => html(reply, await renderTelegram()));

  /**
   * Pausar o reanudar los avisos desde el panel.
   *
   * Con Discord por webhook no hay comandos de vuelta, asi que sin esto el
   * usuario no tiene ninguna forma de silenciar su movil por su cuenta.
   * Pausar NO detiene el analisis: solo deja de enviar mensajes.
   */
  app.post('/avisos', async (req: FastifyRequest, reply: FastifyReply) => {
    const body = (req.body ?? {}) as { accion?: string };
    const pausar = body.accion === 'pausar';
    await setState('alertas_pausadas', pausar);
    log.info({ pausar }, pausar ? 'avisos pausados desde el panel' : 'avisos reanudados desde el panel');
    return reply.redirect('/sistema');
  });

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
    if (dado.length !== secreto.length ||
        !timingSafeEqual(Buffer.from(dado.padEnd(64, '\0').slice(0, 64)),
                         Buffer.from(secreto.padEnd(64, '\0').slice(0, 64)))) {
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

  app.setNotFoundHandler(async (_req, reply) =>
    reply
      .code(404)
      .type('text/html; charset=utf-8')
      .send(
        page(
          { title: 'No encontrado' },
          '<div class="empty"><h1>Pagina no encontrada</h1><p><a href="/">Volver al inicio</a></p></div>',
        ),
      ),
  );

  app.setErrorHandler(async (err: unknown, _req, reply) => {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err: message }, 'error en el panel');
    return reply
      .code(500)
      .type('text/html; charset=utf-8')
      .send(
        page(
          { title: 'Error' },
          `<div class="empty"><h1>Algo ha fallado</h1>
           <p class="dim small">${escapeHtml(message)}</p>
           <p><a href="/">Volver al inicio</a></p></div>`,
        ),
      );
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
