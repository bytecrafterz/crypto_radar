/**
 * Pruebas del recuento de fuentes independientes del Robot 3.
 *
 * Existe por un fallo real: tres avisos de alta convergencia salieron con
 * mas fuentes independientes que canales ("2 de 1", "5 de 2", "4 de 1"),
 * porque se contaban textos y no canales. Un canal repitiendose bastaba
 * para cumplir la regla de "al menos 2 fuentes independientes".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contarFuentes, type MencionFuente } from '../robot3/fuentes.js';

let id = 0;
const m = (canal: number, hash: string | null, minuto: number, util = true): MencionFuente => ({
  canal, hash, mensaje: ++id, publicado: new Date(Date.UTC(2026, 8, 17, 7, minuto)), util,
});

test('un canal que habla varias veces del token es UNA fuente, no varias', () => {
  // El caso de DIABLO: cuatro mensajes distintos, todos del mismo canal.
  const r = contarFuentes([m(7, 'a', 0), m(7, 'b', 5), m(7, 'c', 9), m(7, 'd', 20)]);
  assert.deepEqual(r, { total: 1, independientes: 1 });
});

test('nunca hay mas fuentes independientes que canales', () => {
  // El caso de TRENDS: cinco textos repartidos entre dos canales.
  const r = contarFuentes([m(1, 'a', 0), m(1, 'b', 1), m(1, 'c', 2), m(2, 'd', 3), m(2, 'e', 4)]);
  assert.deepEqual(r, { total: 2, independientes: 2 });
});

test('el canal que copia el texto de otro no es independiente', () => {
  // Cinco canales publicando lo mismo: una sola fuente, la que lo dijo primero.
  const r = contarFuentes([m(1, 'x', 0), m(2, 'x', 3), m(3, 'x', 4), m(4, 'x', 6), m(5, 'x', 8)]);
  assert.deepEqual(r, { total: 5, independientes: 1 });
});

test('el autor es quien lo publico antes, aunque la fila llegue despues', () => {
  // Si el orden de las filas decidiera el autor, el resultado cambiaria
  // de una vuelta a otra con los mismos datos.
  const a = contarFuentes([m(2, 'x', 5), m(1, 'x', 1), m(2, 'y', 6)]);
  const b = contarFuentes([m(1, 'x', 1), m(2, 'x', 5), m(2, 'y', 6)]);
  assert.deepEqual(a, { total: 2, independientes: 2 });
  assert.deepEqual(b, a);
});

test('quien solo repite lo de otros no suma, aunque tambien publique algo suyo sin interes', () => {
  // El canal 2 copia a 1, y lo unico propio que dice es publicidad.
  const r = contarFuentes([m(1, 'x', 0), m(2, 'x', 2), m(2, 'promo', 3, false)]);
  assert.deepEqual(r, { total: 2, independientes: 1 });
});

test('la publicidad no cuenta como fuente independiente', () => {
  const r = contarFuentes([m(1, 'a', 0, false), m(2, 'b', 1, false)]);
  assert.deepEqual(r, { total: 2, independientes: 0 });
});

test('un texto cuenta como util si alguno de sus mensajes lo es', () => {
  // El clasificador puede haber visto la copia y no el original todavia.
  const r = contarFuentes([m(1, 'x', 0, false), m(2, 'x', 1, true)]);
  assert.deepEqual(r, { total: 2, independientes: 1 });
});

test('dos canales que dicen cosas distintas por su cuenta son dos fuentes', () => {
  const r = contarFuentes([m(1, 'a', 0), m(2, 'b', 1)]);
  assert.deepEqual(r, { total: 2, independientes: 2 });
});

test('un mensaje sin texto cuenta como unico y no se confunde con otros sin texto', () => {
  const r = contarFuentes([m(1, null, 0), m(2, null, 0)]);
  assert.deepEqual(r, { total: 2, independientes: 2 });
});

test('sin menciones no hay fuentes', () => {
  assert.deepEqual(contarFuentes([]), { total: 0, independientes: 0 });
});
