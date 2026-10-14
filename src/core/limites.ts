/**
 * Lo que no cabe en las columnas.
 *
 * Algunos tokens recien creados en Base llegan con cambios de precio de mas
 * de 100 millones por ciento (pasan de casi cero a algo) o con
 * capitalizaciones de mas de 10^17 dolares. No caben en sus columnas,
 * PostgreSQL rechazaba la fila entera y el token se perdia antes de
 * analizarse: unos 350 al dia desde el 08/10. Un cambio de precio asi se
 * guarda en el tope, que sigue diciendo "enorme"; un importe asi no es un
 * dato real y se guarda como desconocido.
 */
const TOPE_CAMBIO_PCT = 99_999_999; // numeric(12,4)
export const TOPE_USD = 1e17;        // numeric(20,2)
export const TOPE_PRECIO_USD = 1e14; // numeric(30,15)

export function acotarCambio(v: number | null): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.max(-TOPE_CAMBIO_PCT, Math.min(TOPE_CAMBIO_PCT, v));
}

/**
 * Un porcentaje del suministro. Mas del 100% es imposible: sale de tokens
 * con contabilidad rara (los que se reparten comisiones sin emitir
 * transferencias) y no dice nada. Con 10.000% o mas ni cabia en la columna
 * numeric(6,2) y se perdia el analisis entero.
 */
export function porcentajeValido(v: number | null): number | null {
  if (v === null || !Number.isFinite(v) || v < 0) return null;
  return v <= 100 ? v : null;
}

export function importeValido(v: number | null, tope = TOPE_USD): number | null {
  if (v === null || !Number.isFinite(v)) return null;
  return Math.abs(v) < tope ? v : null;
}
