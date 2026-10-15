/**
 * Pruebas del estado de cada robot a partir de sus tareas.
 *
 * Un robot a medias (lee Telegram pero no clasifica) parece vivo y no
 * sirve: basta una tarea parada para darlo por parado.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estadoDeRobot } from '../worker/robots.js';
import type { EstadoTarea } from '../worker/vigilante.js';

const tarea = (nombre: string, callada_ms: number | null, caida = false): EstadoTarea => ({
  nombre,
  ultimoLatido: callada_ms === null ? null : Date.now() - callada_ms,
  callada_ms,
  margen_ms: 15 * 60_000,
  caida,
});

test('todas al dia: funcionando, con la vuelta mas reciente', () => {
  const r = estadoDeRobot([tarea('deteccion', 120_000), tarea('analisis', 30_000)]);
  assert.equal(r.estado, 'funcionando');
  assert.equal(r.ultimaVueltaMs, 30_000);
  assert.deepEqual(r.paradas, []);
});

test('una sola tarea caida para todo el robot y se dice cual', () => {
  const r = estadoDeRobot([tarea('robot2-colector', 10_000), tarea('robot2-clasificador', 3_600_000, true)]);
  assert.equal(r.estado, 'parado');
  assert.deepEqual(r.paradas, ['robot2-clasificador']);
});

test('sin ninguna vuelta todavia: arrancando, no parado', () => {
  assert.equal(estadoDeRobot([tarea('robot3-convergencia', null)]).estado, 'arrancando');
  assert.equal(estadoDeRobot([]).estado, 'arrancando');
});

test('la ficha ensena la primera mencion de cada canal aunque haya muchas de otro', async () => {
  const { elegirMenciones } = await import('../web/datos/telegram.js');
  const m = (canal: string, n: number) => ({ canal, n });
  const todas = [m('a', 1), m('b', 2), m('c', 3), ...Array.from({ length: 20 }, (_, i) => m('c', 4 + i))];
  const vistas = elegirMenciones(todas, 5);
  assert.deepEqual(vistas.map((x) => x.n), [1, 2, 3, 22, 23]);
  assert.deepEqual(elegirMenciones([m('a', 1), m('a', 2)], 15).map((x) => x.n), [1, 2]);
});

test('ROBOTS elige que robots arranca el proceso; vacio o invalido, todos', async () => {
  const { robotsActivos } = await import('../worker/index.js');
  assert.deepEqual([...robotsActivos('1')], [1]);
  assert.deepEqual([...robotsActivos('2, 3')].sort(), [2, 3]);
  assert.deepEqual([...robotsActivos('')].sort(), [1, 2, 3]);
  assert.deepEqual([...robotsActivos('x,9')].sort(), [1, 2, 3]);
});
