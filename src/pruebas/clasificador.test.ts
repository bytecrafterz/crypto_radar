/**
 * Pruebas de la lectura de la respuesta del modelo.
 *
 * Es la parte fragil: el modelo devuelve texto libre y por muy claras que
 * sean las instrucciones, a veces lo envuelve en explicaciones o en
 * bloques de codigo. Si esto se rompe, los mensajes se quedan sin
 * clasificar sin que salte ningun error.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { leerRespuesta } from '../telegram/clasificador.js';

test('lee un JSON limpio', () => {
  const v = leerRespuesta('{"clase":"promocion","confianza":85,"motivo":"lenguaje de venta"}');
  assert.equal(v?.clase, 'promocion');
  assert.equal(v?.confianza, 85);
});

test('lee el JSON aunque venga envuelto en explicaciones', () => {
  // Pasa constantemente por mucho que se pida lo contrario.
  const v = leerRespuesta('Claro, aqui tienes:\n```json\n{"clase":"hype","confianza":90,"motivo":"sin datos"}\n```\nEspero que ayude.');
  assert.equal(v?.clase, 'hype');
});

test('una clase que no existe se rechaza en vez de colarse', () => {
  assert.equal(leerRespuesta('{"clase":"buenisimo","confianza":99,"motivo":"x"}'), null);
});

test('una confianza rara no se toma por buena', () => {
  // Sin dato fiable se queda en la mitad, que no inclina la decision.
  assert.equal(leerRespuesta('{"clase":"informacion","motivo":"x"}')?.confianza, 50);
  assert.equal(leerRespuesta('{"clase":"informacion","confianza":"mucha","motivo":"x"}')?.confianza, 50);
});

test('una confianza fuera de rango se recorta', () => {
  assert.equal(leerRespuesta('{"clase":"hype","confianza":500,"motivo":"x"}')?.confianza, 100);
  assert.equal(leerRespuesta('{"clase":"hype","confianza":-20,"motivo":"x"}')?.confianza, 0);
});

test('una respuesta vacia o rota no revienta nada', () => {
  for (const malo of [null, '', 'lo siento, no puedo ayudarte', '{roto', '{}']) {
    assert.equal(leerRespuesta(malo), null, `deberia devolver null: ${malo}`);
  }
});

test('el motivo se recorta para que no ocupe la base de datos entera', () => {
  const largo = 'a'.repeat(500);
  const v = leerRespuesta(`{"clase":"hype","confianza":50,"motivo":"${largo}"}`);
  assert.ok((v?.motivo.length ?? 0) <= 200);
});
