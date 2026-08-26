/**
 * Colector por MTProto: lee los canales en los que la cuenta ha entrado.
 *
 * DIFERENCIA CON EL COLECTOR POR BOT
 * El bot tenia una cola comun: pedias getUpdates y Telegram te daba todo
 * lo nuevo de golpe. Leyendo como cuenta de usuario no hay cola. Hay que
 * ir canal por canal preguntando "dame lo posterior a este mensaje", y
 * por eso se guarda el ultimo id leido de cada uno.
 *
 * A cambio, esto lee de CUALQUIER canal en el que este la cuenta, que es
 * justo lo que el bot no podia hacer.
 *
 * RITMO
 * Cada canal es una llamada. Con decenas de canales eso son decenas de
 * llamadas por vuelta, y ahi es donde una cuenta se mete en problemas.
 * Por eso se leen unos pocos canales por vuelta, empezando por los que
 * llevan mas tiempo sin mirarse, y con pausa entre uno y otro.
 */
import { query, queryOne, exec } from '../core/db.js';
import { child } from '../core/logger.js';
import { leerCanal, misCanales, pausa, estaConfigurado } from './mtproto.js';
import { triar, hashTexto, extraerCandidatos } from './triaje.js';
import { porDireccion, porTicker } from './resolver.js';
import type { Chain } from '../core/types.js';

const log = child('colector-mt');

/** Canales que se leen por vuelta. */
const CANALES_POR_VUELTA = 6;

/** Pausa entre canales. */
const PAUSA_MS = 3000;

export interface ResumenMt {
  canales: number;
  mensajes: number;
  descartados: number;
  candidatos: number;
  resueltos: number;
}

/**
 * Sincroniza la lista de canales: los que la cuenta tiene, quedan
 * registrados como fuentes que se leen por MTProto.
 */
export async function sincronizarCanales(): Promise<number> {
  const canales = await misCanales();
  let nuevos = 0;

  for (const c of canales) {
    if (!c.username) continue; // sin username no se puede volver a pedir
    const f = await queryOne<{ id: number; ya: boolean }>(
      `INSERT INTO tg_channels (tg_id, username, title, via)
       VALUES ($1, $2, $3, 'mtproto')
       ON CONFLICT (tg_id) DO UPDATE SET
         username = COALESCE(EXCLUDED.username, tg_channels.username),
         title    = COALESCE(EXCLUDED.title, tg_channels.title),
         via      = 'mtproto'
       RETURNING id, (xmax <> 0) AS ya`,
      [Number(c.tgId), c.username, c.title],
    );
    if (f && !f.ya) nuevos++;
  }

  if (nuevos > 0) log.info({ nuevos }, 'canales nuevos registrados para lectura');
  return nuevos;
}

/** Pide veredicto al Robot 1. */
async function pedirVeredicto(chain: Chain, address: string): Promise<boolean> {
  const secreto = process.env.API_SHARED_SECRET ?? '';
  const puerto = process.env.PORT ?? '3000';
  if (!secreto) return false;
  try {
    await fetch(`http://127.0.0.1:${puerto}/api/candidato`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-secret': secreto },
      body: JSON.stringify({ chain, address, origen: 'telegram-mt' }),
      signal: AbortSignal.timeout(120_000),
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Una vuelta: lee unos cuantos canales y pasa lo nuevo por la cadena.
 */
export async function runColectorMt(): Promise<ResumenMt> {
  const r: ResumenMt = { canales: 0, mensajes: 0, descartados: 0, candidatos: 0, resueltos: 0 };
  if (!estaConfigurado()) return r;

  // Se empieza por los que llevan mas tiempo sin leerse, para que ninguno
  // se quede olvidado cuando haya muchos.
  const canales = await query<{ id: number; username: string; ultimo_msg_id: string }>(
    `SELECT id, username, ultimo_msg_id
       FROM tg_channels
      WHERE via = 'mtproto' AND active AND username IS NOT NULL
      ORDER BY leido_at ASC NULLS FIRST
      LIMIT $1`,
    [CANALES_POR_VUELTA],
  );

  for (const canal of canales) {
    r.canales++;
    const desde = Number(canal.ultimo_msg_id) || 0;

    // La primera vez se cogen pocos: no interesa arrastrar meses de
    // historico, solo empezar a mirar desde ahora.
    const mensajes = await leerCanal(canal.username, desde, desde === 0 ? 10 : 30);
    await exec('UPDATE tg_channels SET leido_at = now() WHERE id = $1', [canal.id]);

    if (mensajes.length === 0) {
      await pausa(PAUSA_MS);
      continue;
    }

    let maxId = desde;

    for (const m of mensajes) {
      try {
        maxId = Math.max(maxId, m.mensajeId);

        // 1. Guardar en bruto, siempre y antes de juzgar.
        const guardado = await queryOne<{ id: number; ya: boolean }>(
          `INSERT INTO tg_messages (channel_id, tg_msg_id, posted_at, text, text_hash)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (channel_id, tg_msg_id) DO UPDATE SET text = EXCLUDED.text
           RETURNING id, (xmax <> 0) AS ya`,
          [canal.id, m.mensajeId, m.fecha, m.texto, hashTexto(m.texto)],
        );
        if (!guardado || guardado.ya) continue;
        r.mensajes++;

        // 2. Triaje.
        const t = triar(m.texto);
        await exec(
          `UPDATE tg_messages SET triage = $2, triage_motivo = $3, triage_at = now() WHERE id = $1`,
          [guardado.id, t.pasa ? 'candidato' : 'descartado', t.motivo],
        );
        if (!t.pasa) {
          r.descartados++;
          continue;
        }
        r.candidatos++;

        // 3. Todos los tokens del mensaje, no solo el primero.
        for (const c of extraerCandidatos(m.texto)) {
          const res = c.direccion && c.cadena
            ? await porDireccion(c.cadena as Chain, c.direccion)
            : c.ticker
              ? await porTicker('$' + c.ticker)
              : { ok: false as const, motivo: 'sin token' };

          if (!res.ok) continue;
          r.resueltos++;

          const primera = await queryOne<{ n: number }>(
            'SELECT COUNT(*)::int AS n FROM tg_mentions WHERE chain = $1 AND address = $2',
            [res.chain, res.address],
          );

          await exec(
            `INSERT INTO tg_mentions
               (message_id, channel_id, chain, address, resuelto_por, posted_at, es_primera)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [guardado.id, canal.id, res.chain, res.address, res.via, m.fecha, (primera?.n ?? 0) === 0],
          );

          await pedirVeredicto(res.chain, res.address);
        }
      } catch (err) {
        // Un mensaje malo no puede tumbar el canal entero.
        log.warn(
          { err: err instanceof Error ? err.message : String(err), canal: canal.username },
          'fallo procesando un mensaje',
        );
      }
    }

    // Se avanza el marcador solo despues de haber procesado todo el lote:
    // si algo falla a medias, la vuelta siguiente vuelve a intentarlo.
    if (maxId > desde) {
      await exec('UPDATE tg_channels SET ultimo_msg_id = $2 WHERE id = $1', [canal.id, maxId]);
    }

    await pausa(PAUSA_MS);
  }

  if (r.mensajes > 0) log.info(r, 'vuelta del colector MTProto');
  return r;
}
