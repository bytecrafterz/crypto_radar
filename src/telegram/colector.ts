/**
 * Robot 2: el colector.
 *
 * Es el bucle que une todo lo demas:
 *
 *   Telegram -> guardar en bruto -> triaje -> resolver token
 *            -> registrar mencion -> pedir veredicto al Robot 1
 *
 * ORDEN DELIBERADO
 * Lo primero que hace con un mensaje es GUARDARLO, antes de mirarlo. El
 * clasificador se va a equivocar, y cuando se mejore hay que poder
 * repasarlo sobre el historico en vez de haber tirado la evidencia. Un
 * mensaje que se descarta sin guardar se pierde para siempre.
 */
import { query, queryOne, exec } from '../core/db.js';
import { child } from '../core/logger.js';
import { recogerMensajes, type MensajeTelegram } from './bot.js';
import { triar, hashTexto, extraerCandidatos } from './triaje.js';
import { porDireccion, porTicker } from './resolver.js';
import type { Chain } from '../core/types.js';

const log = child('colector');

export interface ResumenVuelta {
  recibidos: number;
  guardados: number;
  descartados: number;
  candidatos: number;
  resueltos: number;
  enviados: number;
}

/** Crea el canal si es la primera vez que se ve, y devuelve su id. */
async function asegurarCanal(m: MensajeTelegram): Promise<number> {
  const fila = await queryOne<{ id: number }>(
    `INSERT INTO tg_channels (tg_id, username, title)
     VALUES ($1, $2, $3)
     ON CONFLICT (tg_id) DO UPDATE SET
       username = COALESCE(EXCLUDED.username, tg_channels.username),
       title    = COALESCE(EXCLUDED.title, tg_channels.title)
     RETURNING id`,
    [m.chat.id, m.chat.username ?? null, m.chat.title ?? null],
  );
  if (!fila) throw new Error('no se pudo registrar el canal');
  return fila.id;
}

/**
 * Guarda el mensaje tal cual llego.
 * Devuelve null si ya estaba (Telegram puede reenviar lo mismo).
 */
async function guardarMensaje(
  canalId: number,
  m: MensajeTelegram,
): Promise<{ id: number; nuevo: boolean } | null> {
  const hash = hashTexto(m.texto);

  const fila = await queryOne<{ id: number; ya_estaba: boolean }>(
    `INSERT INTO tg_messages (channel_id, tg_msg_id, posted_at, text, text_hash, edited_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (channel_id, tg_msg_id) DO UPDATE SET
       -- Si el mensaje fue editado, se actualiza el texto pero se conserva
       -- la hora original: es la que sirve para medir anticipacion.
       text      = EXCLUDED.text,
       text_hash = EXCLUDED.text_hash,
       edited_at = EXCLUDED.edited_at
     RETURNING id, (xmax <> 0) AS ya_estaba`,
    [canalId, m.messageId, m.fecha, m.texto, hash, m.editado ? new Date() : null],
  );

  if (!fila) return null;
  return { id: fila.id, nuevo: !fila.ya_estaba };
}

/** Marca el resultado del triaje sobre el mensaje guardado. */
async function marcarTriaje(id: number, pasa: boolean, motivo: string): Promise<void> {
  await exec(
    `UPDATE tg_messages SET triage = $2, triage_motivo = $3, triage_at = now() WHERE id = $1`,
    [id, pasa ? 'candidato' : 'descartado', motivo],
  );
}

/**
 * ¿Es la primera vez que se menciona este token en cualquier canal?
 * Importa para la reputacion: descubrir vale mas que repetir.
 */
async function esPrimeraMencion(chain: string, address: string): Promise<boolean> {
  const fila = await queryOne<{ n: number }>(
    'SELECT COUNT(*)::int AS n FROM tg_mentions WHERE chain = $1 AND address = $2',
    [chain, address],
  );
  return (fila?.n ?? 0) === 0;
}

/** Pide el veredicto al Robot 1 por su propio endpoint. */
async function pedirVeredictoRobot1(
  chain: Chain,
  address: string,
): Promise<Record<string, unknown> | null> {
  const secreto = process.env.API_SHARED_SECRET ?? '';
  const puerto = process.env.PORT ?? '3000';
  if (!secreto) {
    log.warn('sin API_SHARED_SECRET: no se puede consultar al Robot 1');
    return null;
  }

  try {
    const res = await fetch(`http://127.0.0.1:${puerto}/api/candidato`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-secret': secreto },
      body: JSON.stringify({ chain, address, origen: 'telegram' }),
      signal: AbortSignal.timeout(120_000),
    });
    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    log.warn({ err: err instanceof Error ? err.message : String(err) }, 'el Robot 1 no respondio');
    return null;
  }
}

/**
 * Una vuelta completa del colector.
 */
export async function runColector(): Promise<ResumenVuelta> {
  const r: ResumenVuelta = {
    recibidos: 0, guardados: 0, descartados: 0,
    candidatos: 0, resueltos: 0, enviados: 0,
  };

  const mensajes = await recogerMensajes();
  r.recibidos = mensajes.length;
  if (mensajes.length === 0) return r;

  for (const m of mensajes) {
    try {
      const canalId = await asegurarCanal(m);

      // 1. GUARDAR SIEMPRE, antes de juzgar nada.
      const guardado = await guardarMensaje(canalId, m);
      if (!guardado) continue;
      if (guardado.nuevo) r.guardados++;

      // 2. Triaje gratis.
      const t = triar(m.texto);
      await marcarTriaje(guardado.id, t.pasa, t.motivo);
      if (!t.pasa) {
        r.descartados++;
        continue;
      }
      r.candidatos++;

      // 3. Un mensaje puede nombrar VARIOS tokens: se procesan todos.
      //    Quedarse con el primero perdia el resto en silencio.
      const candidatos = extraerCandidatos(m.texto);

      for (const c of candidatos) {
        const res = c.direccion && c.cadena
          ? await porDireccion(c.cadena as Chain, c.direccion)
          : c.ticker
            ? await porTicker('$' + c.ticker)
            : { ok: false as const, motivo: 'ni direccion ni ticker' };

        if (!res.ok) {
          log.debug({ motivo: res.motivo }, 'candidato sin resolver');
          continue;
        }
        r.resueltos++;

        // 4. Registrar la mencion. Se hace aunque el Robot 1 luego lo
        //    descarte: la reputacion del canal depende de lo que menciona,
        //    no solo de lo que acaba en alerta.
        const primera = await esPrimeraMencion(res.chain, res.address);
        await exec(
          `INSERT INTO tg_mentions
             (message_id, channel_id, chain, address, resuelto_por, posted_at, es_primera)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [guardado.id, canalId, res.chain, res.address, res.via, m.fecha, primera],
        );

        // 5. Que opine el Robot 1.
        const veredicto = await pedirVeredictoRobot1(res.chain, res.address);
        if (veredicto) {
          r.enviados++;
          log.info(
            {
              token: res.symbol,
              oportunidad: veredicto.opportunity,
              riesgo: veredicto.risk,
              vetado: veredicto.vetoed,
            },
            'candidato analizado por el Robot 1',
          );
        }
      }
    } catch (err) {
      // Un mensaje malo no puede tumbar la vuelta entera.
      log.warn(
        { err: err instanceof Error ? err.message : String(err), msg: m.messageId },
        'fallo procesando un mensaje',
      );
    }
  }

  log.info(r, 'vuelta del colector completada');
  return r;
}

/** Resumen para el panel. */
export async function estadisticas(): Promise<{
  canales: number; mensajes: number; candidatos: number; menciones: number;
}> {
  const f = await queryOne<{ canales: number; mensajes: number; candidatos: number; menciones: number }>(
    `SELECT (SELECT COUNT(*)::int FROM tg_channels WHERE active) AS canales,
            (SELECT COUNT(*)::int FROM tg_messages)              AS mensajes,
            (SELECT COUNT(*)::int FROM tg_messages WHERE triage = 'candidato') AS candidatos,
            (SELECT COUNT(*)::int FROM tg_mentions)              AS menciones`,
  );
  return f ?? { canales: 0, mensajes: 0, candidatos: 0, menciones: 0 };
}
