/**
 * Cuantas fuentes independientes hay detras de un token.
 *
 * QUE ES UNA FUENTE INDEPENDIENTE
 * Un CANAL que publico algo por su cuenta, no copiado de otro. Es lo que
 * dice config/robot3.yaml y lo que promete el aviso ("N fuentes
 * independientes, no copias unas de otras").
 *
 * EL FALLO QUE HABIA
 * Antes se contaban textos distintos, no canales. Un solo canal que
 * hablaba dos veces de un token, con palabras distintas, sumaba DOS
 * fuentes independientes, y con eso ya llegaba al nivel maximo. Los
 * avisos lo dejaban ver: "2 fuente(s) independiente(s) de 1 en total".
 *
 * COMO SE CUENTA AHORA
 * Cada texto (agrupado por su hash normalizado) pertenece al canal que lo
 * publico primero; los que lo repiten despues son copias. Las fuentes
 * independientes son los canales distintos que son autores de al menos un
 * texto util. Por construccion nunca pueden ser mas que los canales.
 */

export interface MencionFuente {
  canal: number;
  /** Hash del texto normalizado. Sin texto, el mensaje cuenta como unico. */
  hash: string | null;
  mensaje: number;
  publicado: Date;
  /** El clasificador no lo dio por publicidad (o aun no lo ha visto). */
  util: boolean;
}

export interface RecuentoFuentes {
  /** Canales distintos que hablaron del token. */
  total: number;
  /** Canales que publicaron por su cuenta algo util. */
  independientes: number;
}

export function contarFuentes(menciones: MencionFuente[]): RecuentoFuentes {
  const canales = new Set<number>();
  const textos = new Map<string, { autor: MencionFuente; util: boolean }>();

  for (const m of menciones) {
    canales.add(m.canal);
    const clave = m.hash ?? `mensaje:${m.mensaje}`;
    const visto = textos.get(clave);
    if (!visto) {
      textos.set(clave, { autor: m, util: m.util });
      continue;
    }
    // El mismo texto vale como util si alguno de sus mensajes lo es, igual
    // que antes: el clasificador puede no haber llegado aun a todos.
    visto.util ||= m.util;
    // El autor es quien lo publico antes. En empate, el de id mas bajo,
    // para que el resultado no dependa del orden en que llegan las filas.
    const t = m.publicado.getTime();
    const tAutor = visto.autor.publicado.getTime();
    if (t < tAutor || (t === tAutor && m.canal < visto.autor.canal)) visto.autor = m;
  }

  const autores = new Set<number>();
  for (const { autor, util } of textos.values()) {
    if (util) autores.add(autor.canal);
  }

  return { total: canales.size, independientes: autores.size };
}
