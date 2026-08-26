/**
 * Pruebas de las utilidades basicas.
 *
 * Aqui esta el reconocimiento de direcciones, que es de donde arranca
 * todo lo demas: si una direccion valida se rechaza, el token se pierde
 * entero; si una invalida se acepta, se acaba consultando basura.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSolanaAddress, isEvmAddress, base58Encode, base58Decode,
  clamp, escapeHtml, safeNum, numOrNull, safeUrl, shortAddr,
} from '../core/util.js';

test('reconoce direcciones de Solana reales', () => {
  for (const d of [
    'GUmbtfjSZkybSFgPib7RWLBWQTaGwyKQBv5yA1J1pump',
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'So11111111111111111111111111111111111111112',  // SOL
  ]) {
    assert.equal(isSolanaAddress(d), true, `deberia valer: ${d}`);
  }
});

test('rechaza lo que no es una direccion de Solana', () => {
  for (const d of [
    '', 'hola', '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
    'OOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOOO', // 0 y O no existen en base58
    'corto',
  ]) {
    assert.equal(isSolanaAddress(d), false, `no deberia valer: ${d}`);
  }
});

test('reconoce direcciones EVM y rechaza las mal formadas', () => {
  assert.equal(isEvmAddress('0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'), true);
  assert.equal(isEvmAddress('0x833589FCD6EDB6E08F4C7C32D4F71B54BDA02913'), true, 'mayusculas valen');
  assert.equal(isEvmAddress('833589fcd6edb6e08f4c7c32d4f71b54bda02913'), false, 'sin 0x');
  assert.equal(isEvmAddress('0x1234'), false, 'demasiado corta');
  assert.equal(isEvmAddress('0xZZZ589fcd6edb6e08f4c7c32d4f71b54bda02913'), false, 'no es hex');
});

test('base58 ida y vuelta devuelve exactamente lo mismo', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const vuelta = base58Decode(base58Encode(bytes));
  assert.deepEqual(Array.from(vuelta ?? []), Array.from(bytes));
});

test('base58Decode devuelve null en vez de reventar con basura', () => {
  assert.equal(base58Decode('0OIl'), null, 'esos caracteres no existen en base58');
});

test('clamp mantiene el valor dentro de los limites', () => {
  assert.equal(clamp(150, 0, 100), 100);
  assert.equal(clamp(-20, 0, 100), 0);
  assert.equal(clamp(50, 0, 100), 50);
});

test('escapeHtml neutraliza lo que llega de fuera', () => {
  // Los nombres de token vienen de quien creo el token: puede poner
  // cualquier cosa, y acaba pintado en el panel.
  const s = escapeHtml('<script>alert(1)</script>');
  assert.ok(!s.includes('<script>'), 'no puede quedar una etiqueta viva');
  assert.ok(!s.includes('</script>'));
});

test('safeNum y numOrNull no propagan basura', () => {
  assert.equal(safeNum('12.5'), 12.5);
  assert.equal(safeNum('no es un numero'), 0);
  assert.equal(safeNum(null), 0);
  assert.equal(safeNum(undefined, 7), 7);
  assert.equal(numOrNull('abc'), null);
  assert.equal(numOrNull('3'), 3);
});

test('safeUrl deja pasar http(s) y bloquea el resto', () => {
  assert.ok(safeUrl('https://jup.ag/swap'));
  assert.equal(safeUrl('javascript:alert(1)'), null, 'esto acabaria en el panel');
  assert.equal(safeUrl(null), null);
});

test('shortAddr acorta pero deja reconocible la direccion', () => {
  const d = 'GUmbtfjSZkybSFgPib7RWLBWQTaGwyKQBv5yA1J1pump';
  const corta = shortAddr(d);
  assert.ok(corta.length < d.length);
  assert.ok(corta.startsWith(d.slice(0, 5)));
  assert.ok(corta.endsWith(d.slice(-4)));
});
