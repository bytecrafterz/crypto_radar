/**
 * Robot 3: ¿lo que se dice en Telegram cuadra con lo que dice la cadena?
 *
 * La especificacion pide "verificar la coherencia de la informacion". Hasta
 * ahora no se comprobaba nada: "afirmacion verificada" solo significaba que
 * algun mensaje parecia informativo. Aqui se comparan las afirmaciones
 * concretas que hacen los mensajes con los datos que el Robot 1 ya midio en
 * la cadena.
 *
 *   Telegram: "liquidez bloqueada"    cadena: 100% asegurada  -> confirmada
 *   Telegram: "liquidez bloqueada"    cadena: 0% bloqueada    -> contradicha
 *   Telegram: "cuidado, es un rug"    cadena: todo en orden   -> contradicha
 *
 * Una contradiccion impide el nivel maximo: si la fuente miente sobre algo
 * que se puede comprobar, no se le puede creer en lo que no. Una
 * confirmacion es la evidencia que antes se suponia.
 *
 * Lo que no se puede comprobar (un listado en un exchange, una alianza) no
 * cuenta ni a favor ni en contra.
 */
import type { Afirmacion } from '../telegram/clasificador.js';

/** Lo que el Robot 1 sabe de la cadena. null = no se pudo medir. */
export interface HechosCadena {
  /** Porcentaje de la liquidez bloqueada o quemada, 0-100. */
  liquidezAseguradaPct: number | null;
  /** Sin poder de acunar, congelar ni cambiar el contrato. */
  permisosLimpios: boolean | null;
  /** El mayor de los impuestos de compra y venta, en %. */
  impuestoMaxPct: number | null;
  /** No se puede vender (honeypot o sin ruta de venta). */
  honeypot: boolean | null;
  /** Problemas graves vistos en la cadena: liquidez retirada, desplome... */
  peligros: string[];
  /** El Robot 1 vetó el token. */
  vetado: boolean;
}

export interface Coherencia {
  confirmadas: string[];
  contradichas: string[];
}

/** Por debajo de esto, "liquidez bloqueada" es falso. */
const LIQUIDEZ_FALSA_PCT = 50;
/** Por encima de esto, "liquidez bloqueada" es cierto. */
const LIQUIDEZ_CIERTA_PCT = 90;
/** Por encima de esto, "sin impuestos" es falso. */
const IMPUESTO_FALSO_PCT = 3;

export function verificarCoherencia(afirmaciones: Afirmacion[], h: HechosCadena): Coherencia {
  const confirmadas: string[] = [];
  const contradichas: string[] = [];
  const dice = new Set(afirmaciones);

  if (dice.has('liquidez_bloqueada') && h.liquidezAseguradaPct !== null) {
    const pct = Math.round(h.liquidezAseguradaPct);
    if (h.liquidezAseguradaPct >= LIQUIDEZ_CIERTA_PCT) {
      confirmadas.push(`Telegram dice que la liquidez esta bloqueada, y la cadena lo confirma: ${pct}% asegurada.`);
    } else if (h.liquidezAseguradaPct < LIQUIDEZ_FALSA_PCT) {
      contradichas.push(`Telegram dice que la liquidez esta bloqueada, pero en la cadena solo esta asegurado el ${pct}%.`);
    }
  }

  if (dice.has('sin_permisos') && h.permisosLimpios !== null) {
    if (h.permisosLimpios) {
      confirmadas.push('Telegram dice que el contrato no tiene permisos peligrosos, y la cadena lo confirma.');
    } else {
      contradichas.push('Telegram dice que el contrato no tiene permisos, pero el creador conserva poder sobre el (acunar, congelar o modificar).');
    }
  }

  if (dice.has('sin_impuestos') && h.impuestoMaxPct !== null) {
    const pct = Math.round(h.impuestoMaxPct * 10) / 10;
    if (h.impuestoMaxPct <= 1) {
      confirmadas.push(`Telegram dice que no tiene impuestos, y la cadena lo confirma (${pct}%).`);
    } else if (h.impuestoMaxPct > IMPUESTO_FALSO_PCT) {
      contradichas.push(`Telegram dice que no tiene impuestos, pero cobra un ${pct}% al comprar o vender.`);
    }
  }

  if (dice.has('no_honeypot') && h.honeypot !== null) {
    if (h.honeypot) {
      contradichas.push('Telegram dice que se puede vender, pero la cadena dice que no: es un honeypot.');
    } else {
      confirmadas.push('Telegram dice que se puede vender, y la cadena lo confirma.');
    }
  }

  if (dice.has('advertencia')) {
    const problema = h.vetado || h.honeypot === true || h.peligros.length > 0;
    if (problema) {
      const que = h.peligros[0] ?? (h.honeypot ? 'no se puede vender' : 'el Robot 1 lo veto');
      confirmadas.push(`Telegram avisa de un problema, y la cadena lo confirma: ${que}`);
    } else {
      // No es mentira necesariamente: puede ser informacion adelantada que
      // aun no se ve en los numeros. Pero un aviso de estafa sin resolver
      // no puede convivir con el nivel maximo.
      contradichas.push(
        'Telegram avisa de un problema (estafa, rug o venta del equipo) que la cadena aun no muestra. ' +
          'Puede ser informacion adelantada: mejor no entrar hasta que se aclare.',
      );
    }
  }

  return { confirmadas, contradichas };
}
