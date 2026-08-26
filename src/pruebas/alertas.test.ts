/**
 * Pruebas del enlace de compra de las alertas.
 *
 * POR QUE IMPORTA TANTO ESTO
 * El enlace es lo unico que el usuario pulsa. Si lleva a un sitio donde
 * ese token no se vende, la alerta es peor que inutil: el usuario cree
 * que el sistema se ha equivocado de token, o busca el nombre a mano y
 * acaba comprando una imitacion.
 *
 * Ya paso una vez: todos los tokens de Base iban a Uniswap, y Uniswap
 * solo opera SUS pools.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { swapLink } from '../worker/alerts.js';

const SOL = 'GUmbtfjSZkybSFgPib7RWLBWQTaGwyKQBv5yA1J1pump';
const BASE = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const POOL = '0x4c36388be6f416a29c8d8eee81c771ce6be14b18';

test('Solana siempre va a Jupiter, que busca en todos los mercados', () => {
  // Jupiter es un agregador, no un mercado: encuentra la ruta este el
  // token en PumpSwap, Meteora, Raydium u Orca.
  for (const dex of ['raydium', 'pumpswap', 'meteora', 'orca', null]) {
    const l = swapLink('solana', SOL, dex, POOL);
    assert.ok(l.includes('jup.ag'), `con dex=${dex} deberia ir a Jupiter, fue a ${l}`);
    assert.ok(l.includes(SOL), 'el enlace tiene que llevar la direccion exacta');
  }
});

test('Base en Uniswap va a Uniswap', () => {
  const l = swapLink('base', BASE, 'uniswap_v3', POOL);
  assert.ok(l.includes('app.uniswap.org'));
  assert.ok(l.includes(BASE));
});

test('EL FALLO QUE YA PASO: Base fuera de Uniswap NO va a Uniswap', () => {
  // Aerodrome, Bankr y compania no se operan desde Uniswap. Mandarlo alli
  // es mandar al usuario a un sitio donde ese token no existe.
  for (const dex of ['aerodrome', 'bankr', 'sushiswap', null]) {
    const l = swapLink('base', BASE, dex, POOL);
    assert.ok(
      !l.includes('uniswap'),
      `un token de ${dex} no se puede comprar en Uniswap, pero el enlace fue a ${l}`,
    );
    assert.ok(l.includes('dexscreener'), 'deberia apuntar al mercado real');
  }
});

test('cuando se conoce la pool exacta, el enlace apunta a esa pool', () => {
  const l = swapLink('base', BASE, 'aerodrome', POOL);
  assert.ok(l.includes(POOL), 'con la pool conocida hay que usarla: es el mercado real');
});

test('sin pool conocida sigue dando un enlace valido, no uno roto', () => {
  const l = swapLink('base', BASE, 'aerodrome', null);
  assert.ok(l.startsWith('https://'));
  assert.ok(l.includes(BASE));
});

test('el enlace nunca lleva el nombre del token, solo la direccion', () => {
  // Buscar por nombre es como se acaba comprando una imitacion: cualquiera
  // puede crear un token que se llame igual.
  for (const [chain, addr] of [['solana', SOL], ['base', BASE]] as const) {
    const l = swapLink(chain, addr, 'uniswap_v3', POOL);
    assert.ok(l.includes(addr), 'la direccion tiene que ir en el enlace');
  }
});
