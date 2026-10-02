/**
 * Pruebas de la verificacion de coherencia del Robot 3.
 *
 * La especificacion pide verificar que lo que se dice en Telegram cuadra
 * con los datos. Estas son las reglas que el sistema promete: si alguna
 * falla, el Robot 3 da por buena una mentira o castiga una verdad.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verificarCoherencia, type HechosCadena } from '../robot3/coherencia.js';
import { decidir, type EntradaRobot1, type EntradaRobot2 } from '../robot3/convergencia.js';

const LIMPIO: HechosCadena = {
  liquidezAseguradaPct: 100, permisosLimpios: true, impuestoMaxPct: 0,
  honeypot: false, peligros: [], vetado: false,
};

test('una afirmacion que la cadena confirma cuenta como evidencia', () => {
  const c = verificarCoherencia(['liquidez_bloqueada', 'sin_permisos'], LIMPIO);
  assert.equal(c.confirmadas.length, 2);
  assert.equal(c.contradichas.length, 0);
});

test('"liquidez bloqueada" con la liquidez sin bloquear es una contradiccion', () => {
  const c = verificarCoherencia(['liquidez_bloqueada'], { ...LIMPIO, liquidezAseguradaPct: 0 });
  assert.equal(c.contradichas.length, 1);
  assert.match(c.contradichas[0], /solo esta asegurado el 0%/);
});

test('"sin permisos" cuando el creador conserva poder es una contradiccion', () => {
  const c = verificarCoherencia(['sin_permisos'], { ...LIMPIO, permisosLimpios: false });
  assert.equal(c.contradichas.length, 1);
});

test('"sin impuestos" con un 10% de impuesto es una contradiccion', () => {
  const c = verificarCoherencia(['sin_impuestos'], { ...LIMPIO, impuestoMaxPct: 10 });
  assert.equal(c.contradichas.length, 1);
});

test('"se puede vender" en un honeypot es una contradiccion', () => {
  const c = verificarCoherencia(['no_honeypot'], { ...LIMPIO, honeypot: true });
  assert.equal(c.contradichas.length, 1);
});

test('un aviso de estafa que la cadena confirma no es contradiccion', () => {
  const c = verificarCoherencia(['advertencia'], { ...LIMPIO, peligros: ['Han retirado el 80% de la liquidez.'] });
  assert.equal(c.contradichas.length, 0);
  assert.equal(c.confirmadas.length, 1);
});

test('un aviso de estafa sin reflejo en la cadena bloquea el nivel maximo', () => {
  const c = verificarCoherencia(['advertencia'], LIMPIO);
  assert.equal(c.contradichas.length, 1);
});

test('lo que no se pudo medir no cuenta ni a favor ni en contra', () => {
  const sinDatos: HechosCadena = {
    liquidezAseguradaPct: null, permisosLimpios: null, impuestoMaxPct: null,
    honeypot: null, peligros: [], vetado: false,
  };
  const c = verificarCoherencia(['liquidez_bloqueada', 'sin_permisos', 'sin_impuestos', 'no_honeypot'], sinDatos);
  assert.deepEqual(c, { confirmadas: [], contradichas: [] });
});

test('una contradiccion comprobada impide el nivel maximo aunque todo lo demas cumpla', () => {
  const r1: EntradaRobot1 = { opportunity: 78, risk: 22, vetoed: false, evaluable: true, vetos: [], motivosRiesgo: [] };
  const r2: EntradaRobot2 = {
    fuentesTotal: 5, fuentesIndependientes: 4, anticipacionSeg: 1860,
    reputacionMedia: 68, afirmacionVerificada: true, tipoSenal: 'general',
  };
  assert.equal(decidir(r1, r2).nivel, 'rojo');

  const mentira = verificarCoherencia(['liquidez_bloqueada'], { ...LIMPIO, liquidezAseguradaPct: 5 });
  const v = decidir(r1, { ...r2, coherencia: mentira });
  assert.notEqual(v.nivel, 'rojo');
  assert.ok(v.contradicciones.some((x) => x.includes('liquidez')));
});
