/**
 * Pruebas del permiso para usar los comandos del bot de avisos.
 *
 * El bot es publico en Telegram: cualquiera puede buscarlo por su nombre.
 * Solo el chat de los avisos, y los que se anadan a mano, deben poder ver
 * las oportunidades o pausar los avisos.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatPermitido } from '../worker/telegram.js';

test('el chat de los avisos puede usar los comandos', () => {
  assert.equal(chatPermitido(123456789, '123456789', ''), true);
  assert.equal(chatPermitido('123456789', '123456789', ''), true);
});

test('un chat cualquiera no puede', () => {
  assert.equal(chatPermitido(987654321, '123456789', ''), false);
  assert.equal(chatPermitido(undefined, '123456789', ''), false);
});

test('los anadidos en la lista si pueden, con espacios o sin ellos', () => {
  assert.equal(chatPermitido(555, '123456789', '111, 555 ,-100200300'), true);
  assert.equal(chatPermitido(-100200300, '123456789', '111, 555 ,-100200300'), true);
  assert.equal(chatPermitido(222, '123456789', '111, 555'), false);
});

test('sin chat configurado no entra nadie, tampoco un id vacio', () => {
  assert.equal(chatPermitido(123, '', ''), false);
  assert.equal(chatPermitido('', '', ' , '), false);
});
