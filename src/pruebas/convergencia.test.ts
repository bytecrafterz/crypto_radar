/**
 * Pruebas del motor de decision del Robot 3.
 *
 * Lo que se comprueba aqui no son detalles de implementacion, sino las
 * reglas que el sistema promete al usuario. Si alguna de estas falla, el
 * robot esta mintiendo sobre como decide.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidir, type EntradaRobot1, type EntradaRobot2 } from '../robot3/convergencia.js';

/** Token limpio y con buena pinta segun los datos de la cadena. */
const R1_BUENO: EntradaRobot1 = {
  opportunity: 78, risk: 22, vetoed: false, evaluable: true,
  vetos: [], motivosRiesgo: [],
};

/** Varias fuentes independientes y llegando antes del movimiento. */
const R2_FUERTE: EntradaRobot2 = {
  fuentesTotal: 5, fuentesIndependientes: 4, anticipacionSeg: 1860,
  reputacionMedia: 68, afirmacionVerificada: true, tipoSenal: 'llamada',
};

test('LA REGLA QUE MANDA: el veto del Robot 1 gana sobre cualquier ruido social', () => {
  const vetado: EntradaRobot1 = {
    ...R1_BUENO, vetoed: true, vetos: ['no se puede vender'],
  };
  const v = decidir(vetado, R2_FUERTE);

  assert.equal(v.nivel, 'descartado',
    'un token que no se puede vender no es una oportunidad, hable quien hable de el');
});

test('el veto gana incluso con la senal social maxima posible', () => {
  const social: EntradaRobot2 = {
    fuentesTotal: 40, fuentesIndependientes: 30, anticipacionSeg: 7200,
    reputacionMedia: 100, afirmacionVerificada: true, tipoSenal: 'llamada',
  };
  const v = decidir({ ...R1_BUENO, vetoed: true, vetos: ['honeypot'] }, social);
  assert.equal(v.nivel, 'descartado');
});

test('las componentes NUNCA se funden en un numero unico', () => {
  const v = decidir(R1_BUENO, R2_FUERTE);
  const c = v.componentes;

  // Si alguna vez alguien "simplifica" esto a una nota media, el usuario
  // pierde justo lo que necesita saber: si el token es bueno Y ademas hay
  // informacion, o si es malo pero con mucho ruido.
  for (const clave of ['tecnica', 'riesgo', 'social', 'fuentes', 'anticipacion', 'evidencia'] as const) {
    assert.equal(typeof c[clave], 'number', `falta la componente ${clave}`);
  }
  assert.equal(c.tecnica, R1_BUENO.opportunity, 'la nota tecnica debe llegar intacta');
  assert.equal(c.riesgo, R1_BUENO.risk, 'el riesgo debe llegar intacto');
});

test('un token bueno del que nadie habla no se confunde con uno malo muy comentado', () => {
  const calladoYBueno = decidir(R1_BUENO, {
    fuentesTotal: 1, fuentesIndependientes: 1, anticipacionSeg: null,
    reputacionMedia: 30, afirmacionVerificada: false, tipoSenal: 'mencion',
  });
  const ruidosoYMalo = decidir(
    { opportunity: 20, risk: 85, vetoed: false, evaluable: true, vetos: [], motivosRiesgo: ['liquidez minima'] },
    R2_FUERTE,
  );

  // Una media los dejaria parecidos. Separados, se ven como lo que son.
  assert.ok(calladoYBueno.componentes.tecnica > ruidosoYMalo.componentes.tecnica);
  assert.ok(calladoYBueno.componentes.social < ruidosoYMalo.componentes.social);
});

test('la convergencia de verdad (datos buenos + varias fuentes) llega al nivel maximo', () => {
  const v = decidir(R1_BUENO, R2_FUERTE);
  assert.equal(v.nivel, 'rojo');
  assert.ok(v.motivo.length > 0, 'un aviso sin motivo no le sirve a nadie');
  assert.ok(v.explicacion.length > 0, 'hay que poder explicar por que se avisa');
});

test('una sola fuente no es convergencia por muy bueno que sea el token', () => {
  const v = decidir(R1_BUENO, {
    fuentesTotal: 1, fuentesIndependientes: 1, anticipacionSeg: 600,
    reputacionMedia: 70, afirmacionVerificada: false, tipoSenal: 'llamada',
  });
  assert.notEqual(v.nivel, 'rojo',
    'con una unica fuente no hay nada que converja: es una opinion, no una senal');
});

test('un token no evaluable no se avisa aunque la senal social sea buena', () => {
  const v = decidir({ ...R1_BUENO, evaluable: false }, R2_FUERTE);
  assert.notEqual(v.nivel, 'rojo');
});

test('llegar tarde al movimiento no puntua como llegar antes', () => {
  const antes = decidir(R1_BUENO, { ...R2_FUERTE, anticipacionSeg: 1800 });
  const tarde = decidir(R1_BUENO, { ...R2_FUERTE, anticipacionSeg: -1800 });

  assert.ok(antes.componentes.anticipacion > tarde.componentes.anticipacion,
    'un canal que publica cuando el precio ya subio no esta descubriendo nada');
});

test('las fuentes que se copian entre si no cuentan como independientes', () => {
  const copias = decidir(R1_BUENO, {
    ...R2_FUERTE, fuentesTotal: 10, fuentesIndependientes: 1,
  });
  const reales = decidir(R1_BUENO, {
    ...R2_FUERTE, fuentesTotal: 10, fuentesIndependientes: 8,
  });

  assert.ok(copias.componentes.social < reales.componentes.social,
    'diez canales repitiendo el mismo mensaje son una fuente, no diez');
});

test('cero fuentes utiles no puede llegar a convergencia', () => {
  // Habia un suelo de 1 heredado de antes del clasificador que deshacia
  // su trabajo entero: un token del que solo hablaban promociones
  // pagadas contaba con una fuente independiente y con eso subia de
  // nivel. Cero es cero.
  const v = decidir(R1_BUENO, {
    fuentesTotal: 5, fuentesIndependientes: 0, anticipacionSeg: 1800,
    reputacionMedia: 70, afirmacionVerificada: false, tipoSenal: 'llamada',
  });
  assert.ok(['descartado', 'amarillo'].includes(v.nivel),
    `con cero fuentes utiles no puede subir de nivel, y salio ${v.nivel}`);
});

test('una fuente util si permite seguimiento o convergencia', () => {
  const v = decidir(R1_BUENO, {
    fuentesTotal: 5, fuentesIndependientes: 1, anticipacionSeg: 1800,
    reputacionMedia: 70, afirmacionVerificada: false, tipoSenal: 'llamada',
  });
  assert.notEqual(v.nivel, 'descartado');
});
