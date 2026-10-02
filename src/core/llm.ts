/**
 * Modelo de lenguaje, sea cual sea el proveedor.
 *
 * POR QUE NO SE ATA A UNO SOLO
 * Esta pieza es la unica del sistema que cuesta dinero, y la clienta ya
 * dijo que el gasto le preocupa. Varios proveedores tienen capa gratuita
 * con limites diarios que estan muy por encima de lo que gastamos aqui:
 * unas decenas de mensajes al dia. Atarse a uno de pago seria pagar por
 * costumbre.
 *
 * Asi que se habla con todos por la misma puerta. Cambiar de proveedor es
 * cambiar dos variables de entorno, no reescribir nada.
 *
 * Se soportan tres formas de API, que cubren practicamente todo:
 *
 *   anthropic  API de Anthropic
 *   gemini     Google
 *   openai     Groq, OpenRouter, Ollama y cualquiera compatible, que a
 *              dia de hoy son casi todos, incluido un modelo corriendo en
 *              el propio servidor sin coste ninguno
 *
 * SIN CLAVE NO PASA NADA
 * Si no hay nada configurado, esto se queda callado y quien llama sigue
 * su camino. El sistema entero funciona sin esta pieza: es una mejora, no
 * un requisito.
 */
import { request, HttpError, QuotaExceededError } from './http.js';
import { child } from './logger.js';

const log = child('llm');

export type Proveedor = 'anthropic' | 'gemini' | 'openai';

export interface ConfigLlm {
  proveedor: Proveedor;
  modelo: string;
  clave: string;
  /** Solo para los compatibles con OpenAI: Groq, Ollama, OpenRouter... */
  base: string;
}

/** Direcciones por defecto de cada proveedor. */
const BASE_POR_DEFECTO: Record<Proveedor, string> = {
  anthropic: 'https://api.anthropic.com',
  gemini: 'https://generativelanguage.googleapis.com',
  openai: 'https://api.groq.com/openai/v1',
};

export function configLlm(): ConfigLlm | null {
  const clave = process.env.LLM_API_KEY ?? '';
  if (!clave) return null;

  const proveedor = (process.env.LLM_PROVIDER ?? 'gemini') as Proveedor;
  if (!['anthropic', 'gemini', 'openai'].includes(proveedor)) {
    log.warn({ proveedor }, 'proveedor de modelo desconocido; no se usara');
    return null;
  }

  const modelo = process.env.LLM_MODEL ?? '';
  // Anthropic no lleva modelo por defecto: hay que decir cual. Sin esto la
  // llamada saldria con el modelo vacio y el error que devuelve el
  // proveedor no deja claro que lo que falta es una variable de entorno.
  if (proveedor === 'anthropic' && !modelo) {
    log.warn('falta LLM_MODEL para el proveedor anthropic; no se usara');
    return null;
  }

  return {
    proveedor,
    clave,
    modelo,
    base: process.env.LLM_BASE_URL ?? BASE_POR_DEFECTO[proveedor],
  };
}

/**
 * Apaga el razonamiento de los modelos Qwen3.
 *
 * Qwen3 "piensa" antes de contestar, y ese pensamiento se cobra en tokens:
 * para clasificar un mensaje gastaba tres o cuatro veces lo que ocupa la
 * respuesta. Con la cuota gratuita de Groq eso agotaba el limite por
 * minuto y el clasificador se quedaba minutos esperando, con los mensajes
 * acumulandose. Para decidir si un mensaje informa o vende, y resumirlo,
 * no hace falta razonar. "/no_think" es la forma que tiene el propio
 * modelo de desactivarlo; a los demas modelos no se les anade nada.
 */
/** Hasta cuando no merece la pena volver a preguntar al modelo. */
let sinCuotaHasta = 0;

/**
 * ¿El proveedor acaba de decir que no queda cuota?
 *
 * La cuota gratuita de Groq para este modelo es de 200.000 tokens al dia, y
 * se agota. Antes, cada mensaje que se intentaba clasificar con la cuota
 * agotada gastaba uno de sus tres intentos, y a los tres quedaba como
 * "indeterminado" para siempre, sin resumen. Quedarse sin cuota no dice
 * nada del mensaje: ahora se espera y se sigue cuando la haya.
 */
export function cuotaAgotada(): boolean {
  return Date.now() < sinCuotaHasta;
}

/** Tope de la respuesta cuando el modelo no razona: el JSON cabe de sobra. */
const TOKENS_SIN_RAZONAR = 400;

function sinRazonar(modelo: string): string {
  return /qwen3/i.test(modelo) ? '\n\n/no_think' : '';
}

export function hayModelo(): boolean {
  return configLlm() !== null;
}

/**
 * Hace una pregunta y devuelve el texto de la respuesta.
 *
 * Devuelve null si no hay modelo configurado o si falla. Quien llama
 * decide que hacer sin eso; nunca se queda a medias esperando.
 */
export async function preguntar(
  instruccion: string,
  texto: string,
  // Generoso a proposito. Los modelos que razonan consumen la mayor
  // parte del presupuesto pensando antes de escribir nada: con un tope
  // bajo se quedan sin margen y devuelven una respuesta vacia, sin
  // error y sin ninguna pista de por que.
  maxTokens = 800,
): Promise<string | null> {
  const c = configLlm();
  if (!c) return null;

  try {
    if (c.proveedor === 'anthropic') {
      const r = await request<{ content?: Array<{ text?: string }> }>(
        `${c.base}/v1/messages`,
        {
          provider: 'llm',
          method: 'POST',
          timeoutMs: 30_000,
          // Un 429 aqui es cuota agotada, no un fallo pasajero: reintentar
          // solo deja la vuelta esperando minutos. Ver cuotaAgotada().
          retries: 0,
          headers: {
            'x-api-key': c.clave,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: {
            // El modelo se indica siempre en LLM_MODEL: cada proveedor
            // cambia los suyos cada pocos meses y un nombre escrito aqui
            // envejece mal.
            model: c.modelo,
            max_tokens: maxTokens,
            system: instruccion,
            messages: [{ role: 'user', content: texto }],
          },
        },
      );
      return r?.content?.[0]?.text ?? null;
    }

    if (c.proveedor === 'gemini') {
      // La cuota gratuita de Google va POR MODELO y por dia, y en los
      // modelos grandes es ridicula: gemini-3.6-flash da 20 peticiones
      // diarias, menos de lo que gastamos en una manana. Los 'lite'
      // tienen mucho mas margen y para decidir si un mensaje informa o
      // vende aciertan igual, comprobado caso por caso.
      const modelo = c.modelo || 'gemini-3.5-flash-lite';
      const r = await request<{
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      }>(`${c.base}/v1beta/models/${modelo}:generateContent?key=${c.clave}`, {
        provider: 'llm',
        method: 'POST',
        timeoutMs: 30_000,
          // Un 429 aqui es cuota agotada, no un fallo pasajero: reintentar
          // solo deja la vuelta esperando minutos. Ver cuotaAgotada().
          retries: 0,
        headers: { 'content-type': 'application/json' },
        body: {
          systemInstruction: { parts: [{ text: instruccion }] },
          contents: [{ parts: [{ text: texto }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0 },
        },
      });
      // Los modelos que razonan devuelven varias partes y no siempre la
      // primera lleva el texto: puede venir antes el rastro del
      // razonamiento. Se busca la primera que de verdad tenga texto.
      const partes = r?.candidates?.[0]?.content?.parts ?? [];
      return partes.find((p) => typeof p.text === 'string' && p.text.length > 0)?.text ?? null;
    }

    // Compatible con OpenAI: Groq, OpenRouter, Ollama, y un modelo local.
    const tope = sinRazonar(c.modelo) ? Math.min(maxTokens, TOKENS_SIN_RAZONAR) : maxTokens;
    const r = await request<{ choices?: Array<{ message?: { content?: string } }> }>(
      `${c.base}/chat/completions`,
      {
        provider: 'llm',
        method: 'POST',
        timeoutMs: 30_000,
          // Un 429 aqui es cuota agotada, no un fallo pasajero: reintentar
          // solo deja la vuelta esperando minutos. Ver cuotaAgotada().
          retries: 0,
        headers: {
          authorization: `Bearer ${c.clave}`,
          'content-type': 'application/json',
        },
        body: {
          model: c.modelo || 'llama-3.1-8b-instant',
          max_tokens: tope,
          temperature: 0,
          messages: [
            { role: 'system', content: instruccion + sinRazonar(c.modelo) },
            { role: 'user', content: texto },
          ],
        },
      },
    );
    return r?.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    if ((err instanceof HttpError && err.status === 429) || err instanceof QuotaExceededError) {
      sinCuotaHasta = Date.now() + 5 * 60_000;
    }
    log.warn(
      { proveedor: c.proveedor, err: err instanceof Error ? err.message : String(err) },
      'el modelo no respondio',
    );
    return null;
  }
}
