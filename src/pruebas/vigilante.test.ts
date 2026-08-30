/**
 * Pruebas del vigilante.
 *
 * Existe porque el Robot 2 estuvo dos dias parado sin que nadie se
 * enterara. Lo que se comprueba aqui es que el aviso salga cuando toca y,
 * sobre todo, que NO salga cuando no toca: un vigilante que avisa de mas
 * se acaba ignorando, y entonces vuelve a no servir para nada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describirTiempo } from '../worker/vigilante.js';

test('el tiempo se dice en singular cuando es uno solo', () => {
  // "1 horas" en un aviso que lee el cliente queda mal y se nota.
  assert.equal(describirTiempo(60 * 60_000), '1 hora');
  assert.equal(describirTiempo(60_000), '1 minuto');
  assert.equal(describirTiempo(24 * 60 * 60_000 * 2.4), '2 dias');
});

test('el tiempo se dice en la unidad que se entiende de un vistazo', () => {
  // Nadie quiere leer "2880 minutos" para entender que lleva dos dias.
  assert.equal(describirTiempo(30 * 60_000), '30 minutos');
  assert.equal(describirTiempo(5 * 60 * 60_000), '5 horas');
  assert.equal(describirTiempo(72 * 60 * 60_000), '3 dias');
});

test('el caso real que lo destapo se lee bien', () => {
  // El Robot 2 estuvo callado unas 44 horas.
  assert.equal(describirTiempo(44 * 60 * 60_000), '44 horas');
});
