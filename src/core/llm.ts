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
 *   anthropic  Claude
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
import { request } from './http.js';
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

  return {
    proveedor,
    clave,
    modelo: process.env.LLM_MODEL ?? '',
    base: process.env.LLM_BASE_URL ?? BASE_POR_DEFECTO[proveedor],
  };
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
  maxTokens = 200,
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
          headers: {
            'x-api-key': c.clave,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: {
            model: c.modelo || 'claude-haiku-4-5-20251001',
            max_tokens: maxTokens,
            system: instruccion,
            messages: [{ role: 'user', content: texto }],
          },
        },
      );
      return r?.content?.[0]?.text ?? null;
    }

    if (c.proveedor === 'gemini') {
      const modelo = c.modelo || 'gemini-2.0-flash';
      const r = await request<{
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      }>(`${c.base}/v1beta/models/${modelo}:generateContent?key=${c.clave}`, {
        provider: 'llm',
        method: 'POST',
        timeoutMs: 30_000,
        headers: { 'content-type': 'application/json' },
        body: {
          systemInstruction: { parts: [{ text: instruccion }] },
          contents: [{ parts: [{ text: texto }] }],
          generationConfig: { maxOutputTokens: maxTokens, temperature: 0 },
        },
      });
      return r?.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    }

    // Compatible con OpenAI: Groq, OpenRouter, Ollama, y un modelo local.
    const r = await request<{ choices?: Array<{ message?: { content?: string } }> }>(
      `${c.base}/chat/completions`,
      {
        provider: 'llm',
        method: 'POST',
        timeoutMs: 30_000,
        headers: {
          authorization: `Bearer ${c.clave}`,
          'content-type': 'application/json',
        },
        body: {
          model: c.modelo || 'llama-3.1-8b-instant',
          max_tokens: maxTokens,
          temperature: 0,
          messages: [
            { role: 'system', content: instruccion },
            { role: 'user', content: texto },
          ],
        },
      },
    );
    return r?.choices?.[0]?.message?.content ?? null;
  } catch (err) {
    log.warn(
      { proveedor: c.proveedor, err: err instanceof Error ? err.message : String(err) },
      'el modelo no respondio',
    );
    return null;
  }
}
