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

test('suman las palabras de datos concretos, no las de noticias', () => {
  // Aprendido con datos: los canales de noticias generales publicaron 341
  // mensajes y no produjeron ni una sola mencion util, porque hablan del
  // mercado sin nombrar ningun token con su direccion. Lo que sirve son
  // los que avisan de algo concreto y comprobable.
  const neutro = puntuar('Solana Chat', 10_000);
  const concreto = puntuar('Solana Whale Alerts', 10_000);
  assert.ok(concreto.score > neutro.score,
    'un canal de alertas de ballenas tiene que puntuar por encima');
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

test('un canal de "calls" ya no puntua mejor que uno de analisis', () => {
  // El fallo que se descubrio con datos reales: 'alpha' sumaba puntos, y
  // los canales llamados "alpha calls" resultaron ser los mas
  // promocionales de todos. Se premiaba lo contrario de lo que se busca.
  const llamadas = puntuar('Alpha Calls Solana', 10_000);
  const analisis = puntuar('Solana Onchain Research', 10_000);

  assert.ok(analisis.score > llamadas.score,
    'un canal de analisis tiene que puntuar por encima de uno de llamadas');
});

test('las palabras que suman apuntan a tokens concretos', () => {
  const base = puntuar('Solana Chat', 10_000).score;
  for (const buena of ['Whale', 'Onchain', 'Audit', 'Scanner', 'Tracker', 'Rug', 'Unlock']) {
    assert.ok(puntuar(`Solana ${buena}`, 10_000).score > base,
      `"${buena}" deberia sumar`);
  }
});

test('las noticias generales ya no suman puntos', () => {
  // Este es el fallo que costo 341 mensajes inutiles: 'news' y 'noticias'
  // premiaban a canales que nunca nombran un token.
  const base = puntuar('Solana Chat', 10_000).score;
  for (const generica of ['News', 'Noticias']) {
    assert.equal(puntuar(`Solana ${generica}`, 10_000).score, base,
      `"${generica}" no deberia cambiar la nota`);
  }
});

test('la promocion descarada sigue restando', () => {
  const limpio = puntuar('Solana Research', 10_000).score;
  for (const mala of ['VIP', 'PUMP', '1000x', 'premium']) {
    assert.ok(puntuar(`Solana Research ${mala}`, 10_000).score < limpio,
      `"${mala}" deberia restar`);
  }
});
