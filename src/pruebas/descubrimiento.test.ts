/**
 * Pruebas de la criba de canales.
 *
 * Esta puntuacion decide en que canales entra la cuenta, y entrar es la
 * operacion mas cara del sistema: hay un tope de unos 500 canales y las
 * uniones rapidas son lo que hace que Telegram restrinja una cuenta. Un
 * fallo aqui se paga gastando plazas en canales que no aportan nada.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { puntuar } from '../telegram/descubrimiento.js';

test('un canal de tamano razonable puntua mejor que uno diminuto', () => {
  const bueno = puntuar('Solana Alpha Research', 12_000);
  const minusculo = puntuar('Solana Alpha Research', 80);
  assert.ok(bueno.score > minusculo.score,
    'un canal sin actividad no aporta menciones, por muy buen nombre que tenga');
});

test('los canales gigantes penalizan: suelen ser promocion pagada', () => {
  const normal = puntuar('Crypto News', 20_000);
  const masivo = puntuar('Crypto News', 900_000);
  assert.ok(masivo.score < normal.score);
});

test('el vocabulario de promocion resta', () => {
  const limpio = puntuar('Solana Tracker', 10_000);
  const promo = puntuar('Solana Tracker VIP 1000x', 10_000);
  assert.ok(promo.score < limpio.score,
    'un titulo que promete 1000x esta vendiendo, no informando');
});

test('el vocabulario de informacion suma', () => {
  const neutro = puntuar('Solana Chat', 10_000);
  const informativo = puntuar('Solana Research', 10_000);
  assert.ok(informativo.score > neutro.score);
});

test('no saber cuantos miembros tiene penaliza, pero no descarta', () => {
  const sinDato = puntuar('Solana Research', null);
  assert.ok(sinDato.score > 0, 'no se puede descartar un canal solo por no ver el tamano');
  assert.ok(sinDato.score < puntuar('Solana Research', 10_000).score);
});

test('la nota nunca se sale de 0-100', () => {
  const casos: Array<[string, number | null]> = [
    ['VIP PREMIUM PUMP SHILL 1000x 100x paid signal group', 500_000],
    ['alpha research insider scanner radar tracker news', 10_000],
    ['', null],
    ['x'.repeat(400), 0],
  ];
  for (const [titulo, miembros] of casos) {
    const p = puntuar(titulo, miembros);
    assert.ok(p.score >= 0 && p.score <= 100, `nota fuera de rango: ${p.score}`);
  }
});

test('siempre explica por que puntuo asi', () => {
  // Sin motivo no se puede revisar una decision a mano ni entender por que
  // el sistema entro en un canal malo.
  for (const [t, m] of [['Solana Research', 10_000], ['x', null]] as const) {
    assert.ok(puntuar(t, m).motivo.length > 0);
  }
});

test('el orden de los factores no cambia el resultado', () => {
  assert.equal(
    puntuar('VIP Research', 10_000).score,
    puntuar('Research VIP', 10_000).score,
  );
});

test('un canal descubierto por reenvio no se castiga por no saber su tamano', () => {
  // Los reenvios no traen el numero de miembros. Sin compensarlo, un
  // canal que alguien eligio relayar puntuaba por debajo del umbral para
  // entrar, y esa via no servia de nada.
  const porReenvio = puntuar('Watcher Guru', null, 'reenvio');
  const porBusqueda = puntuar('Watcher Guru', null, 'busqueda');

  assert.ok(porReenvio.score > porBusqueda.score,
    'que alguien relaye un canal es una prueba de tiron, no un dato que falte');
  assert.ok(porReenvio.score >= 55,
    'si no llega al umbral de union, descubrirlo por reenvio no sirve para nada');
});

test('el reenvio suma, pero no salva a un canal que promete 1000x', () => {
  const promo = puntuar('VIP PUMP SIGNALS 1000x', null, 'reenvio');
  const limpio = puntuar('Solana Research', null, 'reenvio');
  assert.ok(promo.score < limpio.score,
    'la via no puede tapar lo que dice el titulo');
});

test('por defecto se puntua como busqueda, sin cambiar lo de antes', () => {
  assert.equal(puntuar('Solana Research', 10_000).score,
               puntuar('Solana Research', 10_000, 'busqueda').score);
});
