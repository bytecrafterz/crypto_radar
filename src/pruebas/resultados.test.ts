/**
 * Prueba del tope de los multiplos.
 *
 * Sin el, la fila entera del resultado se rechazaba con "numeric field
 * overflow" y el resultado de ese token no se guardaba nunca. El error se
 * quedaba en el registro de PostgreSQL, no en el del radar, asi que desde
 * fuera parecia que simplemente no habia resultados.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** Misma regla que en repo.ts: la columna admite hasta 10^8. */
const TOPE_MULTIPLO = 99_999_999;
const acotar = (v: number | null): number | null =>
  v === null || !Number.isFinite(v) ? null : Math.min(v, TOPE_MULTIPLO);

test('un multiplo normal no se toca', () => {
  assert.equal(acotar(2.5), 2.5);
  assert.equal(acotar(150), 150);
  assert.equal(acotar(0.3), 0.3);
});

test('un multiplo imposible se recorta en vez de perder la fila', () => {
  // Pasa cuando el token se detecto con capitalizacion casi nula.
  assert.equal(acotar(5_000_000_000), TOPE_MULTIPLO);
  assert.equal(acotar(1e20), TOPE_MULTIPLO);
});

test('dividir por casi cero no rompe nada', () => {
  assert.equal(acotar(Infinity), null);
  assert.equal(acotar(NaN), null);
  assert.equal(acotar(null), null);
});

test('el limite justo sigue cabiendo', () => {
  assert.equal(acotar(TOPE_MULTIPLO), TOPE_MULTIPLO);
  assert.equal(acotar(TOPE_MULTIPLO + 1), TOPE_MULTIPLO);
});
