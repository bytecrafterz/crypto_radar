/**
 * Pruebas de los limites de las columnas.
 *
 * Un cambio de precio de 500 millones por ciento tumbaba la fila entera y el
 * token se perdia sin analizar.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { acotarCambio, importeValido, porcentajeValido, TOPE_PRECIO_USD } from '../core/limites.js';

test('un cambio de precio enorme se guarda en el tope, con su signo', () => {
  assert.equal(acotarCambio(523_456_789.12), 99_999_999);
  assert.equal(acotarCambio(-523_456_789), -99_999_999);
  assert.equal(acotarCambio(-100), -100);
  assert.equal(acotarCambio(12.5), 12.5);
});

test('un importe imposible se guarda como desconocido, uno normal tal cual', () => {
  assert.equal(importeValido(1.2e21), null);
  assert.equal(importeValido(19_405_568_045), 19_405_568_045);
  assert.equal(importeValido(2.016, TOPE_PRECIO_USD), 2.016);
  assert.equal(importeValido(5e15, TOPE_PRECIO_USD), null);
});

test('un porcentaje del suministro por encima del 100% no se guarda', () => {
  // El caso real: tokens de Base con un "top 10" de mas de 10.000%.
  assert.equal(porcentajeValido(12_345.6), null);
  assert.equal(porcentajeValido(100), 100);
  assert.equal(porcentajeValido(74.06), 74.06);
  assert.equal(porcentajeValido(-1), null);
});

test('lo que no es un numero no se guarda', () => {
  assert.equal(acotarCambio(null), null);
  assert.equal(acotarCambio(Number.NaN), null);
  assert.equal(importeValido(Number.POSITIVE_INFINITY), null);
});
