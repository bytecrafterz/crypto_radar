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
