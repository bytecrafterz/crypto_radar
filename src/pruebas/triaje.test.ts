/**
 * Pruebas del triaje: la etapa que decide que mensajes merecen mirarse.
 *
 * Esta etapa es la que mas trabajo hace de todo el Robot 2 (descarta
 * alrededor del 80% de lo que entra) y la mas facil de romper sin darse
 * cuenta, porque un descarte de mas no se ve en ningun sitio: el mensaje
 * aparece como procesado y la informacion se pierde para siempre.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { triar, normalizar, hashTexto, extraerCandidatos } from '../telegram/triaje.js';

const DIR_SOLANA = 'GUmbtfjSZkybSFgPib7RWLBWQTaGwyKQBv5yA1J1pump';
const DIR_EVM = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';

test('el hype puro sin ningun token se descarta', () => {
  for (const ruido of [
    '🚀🚀 NEXT 100X GEM 🚀🚀 BUY NOW DONT MISS',
    'to the moon lfg guaranteed easy money',
    'compra ya, ganancia asegurada, no te lo pierdas',
  ]) {
    assert.equal(triar(ruido).pasa, false, `deberia descartarse: ${ruido}`);
  }
});

test('un mensaje con direccion de contrato pasa aunque venga lleno de hype', () => {
  // La direccion es informacion comprobable. Da igual como este redactado
  // el mensaje: se puede ir a mirar el token y decidir con datos.
  const r = triar(`🚀 NEXT 100X GEM 🚀 ${DIR_SOLANA} moon soon`);
  assert.equal(r.pasa, true);
});

test('reconoce las direcciones de las dos cadenas', () => {
  assert.equal(triar(`mira esto ${DIR_SOLANA}`).pasa, true, 'Solana');
  assert.equal(triar(`mira esto ${DIR_EVM}`).pasa, true, 'Base / EVM');
});

test('ANTE LA DUDA, PASAR: un ticker con palabra informativa no se tira', () => {
  // Descartar de mas aqui pierde informacion sin haberla mirado nunca, y
  // eso no se recupera despues.
  const r = triar('$PEPE liquidity locked for 6 months, contract audited');
  assert.equal(r.pasa, true);
});

test('los tres idiomas de la especificacion valen igual', () => {
  // Cada frase solo con palabras de su idioma. La version anterior de esta
  // prueba pasaba en "espanol" gracias a la palabra inglesa "listing".
  assert.equal(triar('$BONK lanzamiento confirmado en Binance').pasa, true, 'espanol');
  assert.equal(triar('$BONK listagem confirmada na Binance').pasa, true, 'portugues');
  assert.equal(triar('$BONK listing confirmed on Binance').pasa, true, 'ingles');
});

test('las tildes no esconden las palabras en espanol y portugues', () => {
  assert.equal(triar('$BONK lançamento hoje, não perca').pasa, true, 'portugues con cedilla');
  assert.equal(triar('$BONK nueva asociación anunciada').pasa, true, 'espanol con tilde');
  assert.equal(triar('$BONK el equipo vendió todo').pasa, true, 'espanol con tilde final');
  assert.equal(triar('$BONK baleia comprou 2% do supply').pasa, true, 'portugues, ballenas');
});

test('un mensaje vacio o nulo no revienta nada', () => {
  assert.equal(triar(null).pasa, false);
  assert.equal(triar(undefined).pasa, false);
  assert.equal(triar('').pasa, false);
  assert.equal(triar('   ').pasa, false);
});

test('SACA TODOS LOS TOKENS del mensaje, no solo el primero', () => {
  // El caso real que lo destapo: un $WIF en la primera linea y una
  // direccion en la tercera. Quedarse con uno perdia el otro en silencio.
  // Los tickers necesitan una palabra informativa cerca; sin ella un
  // ticker suelto es hype, no informacion, y por eso lleva "listing".
  const c = extraerCandidatos(`Listing de hoy:
1. $WIF
2. ${DIR_EVM}
3. $BONK`);
  assert.ok(c.length >= 3, `esperaba 3 o mas tokens, salieron ${c.length}`);

  const tickers = c.filter((x) => x.origen === 'ticker').map((x) => x.ticker?.toUpperCase());
  assert.ok(tickers.includes('WIF'), 'se perdio $WIF');
  assert.ok(tickers.includes('BONK'), 'se perdio $BONK');
  assert.ok(c.some((x) => x.origen === 'direccion'), 'se perdio la direccion');
});

test('un ticker suelto entre hype no cuenta como token', () => {
  // Sin ninguna palabra informativa no hay nada que comprobar: es una
  // opinion, no una mencion util.
  assert.deepEqual(extraerCandidatos('$PEPE es lo mejor, repito: $PEPE'), []);
});

test('el mismo token nombrado dos veces solo cuenta una', () => {
  const c = extraerCandidatos('$PEPE con liquidity locked, repito: $PEPE');
  assert.equal(c.filter((x) => x.ticker?.toUpperCase() === 'PEPE').length, 1);
});

test('INVARIANTE: todo lo que el triaje deja pasar produce al menos un token', () => {
  // Si el triaje marca un mensaje como candidato y luego no se saca ningun
  // token de el, ese mensaje queda como procesado sin haber aportado nada
  // y no se nota por ningun lado. Las dos funciones tienen que usar las
  // mismas reglas.
  const mensajes = [
    `compra ${DIR_SOLANA} ahora`,
    `el contrato es ${DIR_EVM}`,
    '$BONK listing confirmado en Binance',
    '$PEPE liquidity locked for 6 months',
    `🚀 NEXT 100X GEM 🚀 ${DIR_SOLANA} moon soon`,
    `Listing de hoy: $WIF y tambien ${DIR_EVM}`,
  ];

  for (const m of mensajes) {
    if (!triar(m).pasa) continue;
    assert.ok(
      extraerCandidatos(m).length > 0,
      `el triaje lo acepto pero no salio ningun token: "${m.slice(0, 60)}"`,
    );
  }
});

test('normalizar iguala los mensajes que solo cambian en la forma', () => {
  // Asi se detecta que varios canales estan copiando el mismo texto: si no,
  // diez copias contarian como diez fuentes independientes.
  const a = normalizar('🚀 COMPRA $PEPE AHORA!!!   https://t.me/algo');
  const b = normalizar('compra $pepe ahora   https://t.me/otro-enlace');
  assert.equal(a, b, 'mayusculas, emojis y enlaces no deberian diferenciar dos copias');
});

test('el hash es estable y distinto para textos distintos', () => {
  assert.equal(hashTexto('mismo texto'), hashTexto('mismo texto'), 'debe ser estable');
  assert.notEqual(hashTexto('un texto'), hashTexto('otro texto'));
});

test('dos copias del mismo mensaje producen el mismo hash', () => {
  const uno = hashTexto(normalizar('🔥 $BONK LISTING CONFIRMED 🔥'));
  const dos = hashTexto(normalizar('$bonk listing confirmed'));
  assert.equal(uno, dos, 'si no coinciden, las copias cuentan como fuentes independientes');
});
