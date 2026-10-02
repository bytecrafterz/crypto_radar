/**
 * Pruebas de la medida de anticipacion del Robot 2.
 *
 * Es la medida que decide si una fuente se adelanto al mercado o fue
 * detras, y de ella salen la reputacion de los canales y el nivel maximo
 * del Robot 3. Se comprueba sobre todo que se pueda dar por buena en
 * cuanto hay movimiento, sin esperar a que pase el dia entero.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { medirAnticipacion, VEREDICTOS_CON_MOVIMIENTO } from '../telegram/anticipacion.js';

const MENCION = new Date(Date.UTC(2026, 8, 17, 7, 0));
const min = (m: number) => new Date(MENCION.getTime() + m * 60_000);
const serie = (...p: Array<[number, number]>) => p.map(([m, precio]) => ({ ts: min(m), price_usd: precio }));

test('si el precio sube despues del mensaje, la fuente se adelanto y se sabe cuanto', () => {
  const a = medirAnticipacion(serie([-10, 1], [-1, 1], [5, 1.05], [12, 1.3], [30, 2]), MENCION);
  assert.equal(a.veredicto, 'se_adelanto');
  assert.equal(a.segundos, 12 * 60);
});

test('el adelanto se sabe en cuanto hay movimiento: los datos posteriores no lo cambian', () => {
  // Lo que permite medir sin esperar 24 horas: el primer cruce del umbral
  // ya no se mueve, pase lo que pase despues con el precio.
  const pronto = medirAnticipacion(serie([-1, 1], [5, 1.1], [12, 1.3]), MENCION);
  const tarde = medirAnticipacion(serie([-1, 1], [5, 1.1], [12, 1.3], [60, 0.4], [600, 3]), MENCION);
  assert.equal(pronto.veredicto, 'se_adelanto');
  assert.deepEqual(
    { v: tarde.veredicto, s: tarde.segundos },
    { v: pronto.veredicto, s: pronto.segundos },
  );
});

test('si el precio ya habia subido antes del mensaje, la fuente reacciono', () => {
  const a = medirAnticipacion(serie([-90, 1], [-30, 1.4], [-5, 1.5], [10, 1.6]), MENCION);
  assert.equal(a.veredicto, 'reacciono');
  assert.ok((a.segundos ?? 0) < 0);
});

test('quien publica a mitad de una subida reacciono, aunque el precio siga subiendo despues', () => {
  // Antes se comparaba al reves y este caso salia como "se adelanto": el
  // canal ganaba reputacion por llegar tarde.
  const a = medirAnticipacion(serie([-60, 1], [-20, 1.5], [-1, 2], [30, 2.6]), MENCION);
  assert.equal(a.veredicto, 'reacciono');
  assert.equal(a.segundos, -20 * 60);
});

test('una caida antes del mensaje no es una subida ya hecha', () => {
  // El fallo anterior en la otra direccion: un precio previo mas alto que
  // el del mensaje se contaba como "el movimiento ya habia empezado".
  const a = medirAnticipacion(serie([-60, 2], [-1, 1], [20, 1.3]), MENCION);
  assert.equal(a.veredicto, 'se_adelanto');
  assert.equal(a.segundos, 20 * 60);
});

test('si la subida ya se ve en la primera medicion tras el mensaje, no es un adelanto', () => {
  // El caso real: medicion 6 min antes, mensaje, y 0,1 s despues el precio
  // ya multiplicado por 11. Se guardaba como "se adelanto 0 segundos".
  const a = medirAnticipacion(serie([-6, 1], [0.1 / 60, 11], [1, 8], [5, 2]), MENCION);
  assert.equal(a.veredicto, 'sin_datos');
  assert.equal(a.segundos, null);
});

test('con el hueco a partes iguales alrededor del mensaje tampoco se sabe quien fue primero', () => {
  const a = medirAnticipacion(serie([-10, 1], [-0.5, 1], [0.5, 1.4], [3, 1.5]), MENCION);
  assert.equal(a.veredicto, 'sin_datos');
});

test('si casi todo el hueco cae despues del mensaje, cuenta como adelanto', () => {
  const a = medirAnticipacion(serie([-10, 1], [-0.5, 1], [4, 1.4], [8, 1.5]), MENCION);
  assert.equal(a.veredicto, 'se_adelanto');
  assert.equal(a.segundos, 4 * 60);
});

test('sin subida no hay anticipacion que contar', () => {
  const a = medirAnticipacion(serie([-1, 1], [10, 1.1], [60, 0.9]), MENCION);
  assert.equal(a.veredicto, 'sin_movimiento');
  assert.equal(a.segundos, null);
});

test('con menos de tres precios no se decide nada', () => {
  const a = medirAnticipacion(serie([-1, 1], [10, 5]), MENCION);
  assert.equal(a.veredicto, 'sin_datos');
});

test('solo cuentan como medida los veredictos en los que hubo movimiento', () => {
  // "sin_movimiento" y "sin_datos" se guardaban antes como 0 segundos, y
  // el Robot 3 los leia como la anticipacion perfecta.
  assert.deepEqual([...VEREDICTOS_CON_MOVIMIENTO].sort(), ['reacciono', 'se_adelanto']);
});
