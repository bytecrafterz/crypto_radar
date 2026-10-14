/**
 * API del panel: lo que pide la aplicacion de la carpeta web/.
 *
 * Todo devuelve JSON. Las listas largas van paginadas en el servidor
 * (?page=&size=), asi que la aplicacion nunca recibe tablas enteras.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { setState } from '../core/db.js';
import { child } from '../core/logger.js';
import { estadoDeLasTareas } from '../worker/vigilante.js';
import { datosResumen } from './datos/resumen.js';
import { datosTokens } from './datos/tokens.js';
import { datosToken } from './datos/token.js';
import { datosAlertas } from './datos/alertas.js';
import { datosResultados } from './datos/resultados.js';
import { datosSistema, datosActividad, alertasPausadas } from './datos/sistema.js';
import {
  datosTelegramResumen, datosFuentes, datosMenciones, datosMensajes, datosDescubiertos,
} from './datos/telegram.js';
import { datosConvergenciaResumen, datosVeredictos } from './datos/convergencia.js';

const log = child('panel');

type Consulta = Record<string, string | undefined>;
const consulta = (req: FastifyRequest): Consulta => (req.query ?? {}) as Consulta;

export function registrarApiPanel(app: FastifyInstance): void {
  // Para la barra superior: si los avisos estan pausados y si algun robot se ha parado.
  app.get('/api/panel/estado', async () => {
    const [pausado, tareas] = await Promise.all([alertasPausadas(), estadoDeLasTareas()]);
    return { pausado, tareasCaidas: tareas.filter((t) => t.caida).map((t) => t.nombre) };
  });

  app.get('/api/panel/resumen', async () => datosResumen());
  app.get('/api/panel/tokens', async (req) => datosTokens(consulta(req)));

  app.get('/api/panel/token/:chain/:address', async (req: FastifyRequest, reply: FastifyReply) => {
    const { chain, address } = req.params as { chain: string; address: string };
    if (chain !== 'solana' && chain !== 'base') return reply.code(404).send({ error: 'Cadena desconocida' });
    const datos = await datosToken(chain, address);
    if (!datos) return reply.code(404).send({ error: 'Token no encontrado' });
    return datos;
  });

  app.get('/api/panel/alertas', async (req) => datosAlertas(consulta(req)));
  app.get('/api/panel/resultados', async () => datosResultados());

  app.get('/api/panel/telegram', async () => datosTelegramResumen());
  app.get('/api/panel/telegram/fuentes', async (req) => datosFuentes(consulta(req)));
  app.get('/api/panel/telegram/menciones', async (req) => datosMenciones(consulta(req)));
  app.get('/api/panel/telegram/mensajes', async (req) => datosMensajes(consulta(req)));
  app.get('/api/panel/telegram/descubiertos', async (req) => datosDescubiertos(consulta(req)));

  app.get('/api/panel/convergencia', async () => datosConvergenciaResumen());
  app.get('/api/panel/convergencia/veredictos', async (req) => datosVeredictos(consulta(req)));

  app.get('/api/panel/sistema', async () => datosSistema());
  app.get('/api/panel/actividad', async (req) => datosActividad(consulta(req)));

  /**
   * Pausar o reanudar los avisos desde el panel.
   *
   * Con Discord por webhook no hay comandos de vuelta, asi que sin esto no
   * hay forma de silenciar el movil. Pausar NO detiene el analisis: solo
   * deja de enviar mensajes.
   */
  app.post('/api/panel/avisos', async (req: FastifyRequest) => {
    const body = (req.body ?? {}) as { pausar?: boolean };
    const pausar = body.pausar === true;
    await setState('alertas_pausadas', pausar);
    log.info({ pausar }, pausar ? 'avisos pausados desde el panel' : 'avisos reanudados desde el panel');
    return { pausado: pausar };
  });
}
