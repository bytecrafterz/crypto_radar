/**
 * Robot 3: motor de decision.
 *
 * QUE HACE
 * Recibe dos opiniones independientes sobre el mismo token y decide si
 * juntas forman algo que merezca la pena mirar:
 *
 *   Robot 1  ->  ¿que esta pasando DENTRO del token?   (datos objetivos)
 *   Robot 2  ->  ¿que esta pasando ALREDEDOR?          (informacion)
 *
 * QUE NO HACE
 * No promedia. Las componentes se mantienen separadas de principio a fin
 * porque el usuario tiene que poder ver POR QUE se llego a una conclusion.
 * Una sola nota escondería justo lo que hace falta saber: si el token es
 * bueno y ademas hay informacion, o si es malo pero hay mucho ruido.
 *
 * LA REGLA QUE MANDA SOBRE TODAS
 * El veto del Robot 1 gana siempre. Da igual que medio Telegram este
 * hablando del token: si no se puede vender, no es una oportunidad. Esto
 * esta cableado, no es una politica que se pueda ajustar.
 */

import type { Coherencia } from './coherencia.js';

export interface EntradaRobot1 {
  opportunity: number;
  risk: number;
  vetoed: boolean;
  evaluable: boolean;
  vetos: string[];
  motivosRiesgo: string[];
}

export interface EntradaRobot2 {
  /** Fuentes que hablaron del token. */
  fuentesTotal: number;
  /** Fuentes que NO son copia unas de otras. Es el numero que importa. */
  fuentesIndependientes: number;
  /** Segundos de adelanto sobre el movimiento. Negativo = llego tarde. */
  anticipacionSeg: number | null;
  /** Reputacion media de las fuentes, 0-100. */
  reputacionMedia: number;
  /** ¿Se pudo comprobar algo de lo que se decia? */
  afirmacionVerificada: boolean;
  /** Tipo de senal dominante. */
  tipoSenal: string;
  /**
   * Lo que se comprobo de lo que dicen los mensajes contra la cadena
   * (coherencia.ts). Sin el, no se comprueba nada.
   */
  coherencia?: Coherencia;
}

export type Nivel = 'descartado' | 'amarillo' | 'naranja' | 'rojo';

/**
 * Una regla del Robot 3 tal como se aplico: que exige, que valor tenia el
 * token y si la cumplio. Es lo que el panel ensena regla por regla, para
 * que quien revise vea exactamente que se comparo y por que salio el nivel.
 */
export interface ReglaAplicada {
  codigo: string;
  regla: string;
  robot: 'Robot 1' | 'Robot 2' | 'Robot 1 y 2';
  exige: string;
  valor: string;
  cumple: boolean;
  /** Donde esta definida: fichero de configuracion o funcion del codigo. */
  definida: string;
}

/** Lo que el Robot 3 compara, ya reducido a los valores que miran las reglas. */
export interface DatosComparados {
  tecnica: number;
  riesgo: number;
  vetado: boolean;
  evaluable: boolean;
  fuentesIndependientes: number;
  reputacionMedia: number;
  anticipacionSeg: number | null;
  contradicciones: number;
}

const CONFIG = 'config/robot3.yaml';
const CODIGO = 'src/robot3/convergencia.ts';

function numero(v: number): string {
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

function reglasComunes(d: DatosComparados): ReglaAplicada[] {
  return [
    {
      codigo: 'sin_veto',
      regla: 'El Robot 1 no ha vetado el token',
      robot: 'Robot 1',
      exige: 'sin veto',
      valor: d.vetado ? 'vetado' : 'sin veto',
      cumple: !d.vetado,
      definida: `${CODIGO} · decidir() (fijo, no se puede desactivar)`,
    },
    {
      codigo: 'evaluable',
      regla: 'El Robot 1 pudo comprobar lo esencial',
      robot: 'Robot 1',
      exige: 'si',
      valor: d.evaluable ? 'si' : 'no',
      cumple: d.evaluable,
      definida: 'config/scoring.yaml · evaluability',
    },
  ];
}

/**
 * Reglas del nivel maximo ("Convergencia fuerte"), el unico que avisa.
 * decidir() usa esta misma lista: lo que ensena el panel es lo que se aplico.
 */
export function reglasNivelMaximo(d: DatosComparados, u: Umbrales): ReglaAplicada[] {
  return [
    ...reglasComunes(d),
    {
      codigo: 'tecnica_minima',
      regla: 'Nota de oportunidad del Robot 1',
      robot: 'Robot 1',
      exige: `${u.tecnicaMinimaRojo} o mas`,
      valor: numero(d.tecnica),
      cumple: d.tecnica >= u.tecnicaMinimaRojo,
      definida: `${CONFIG} · nivel_maximo.tecnica_minima`,
    },
    {
      codigo: 'riesgo_maximo',
      regla: 'Nota de riesgo del Robot 1',
      robot: 'Robot 1',
      exige: `${u.riesgoMaximoRojo} o menos`,
      valor: numero(d.riesgo),
      cumple: d.riesgo <= u.riesgoMaximoRojo,
      definida: `${CONFIG} · nivel_maximo.riesgo_maximo`,
    },
    {
      codigo: 'fuentes_independientes',
      regla: 'Canales independientes (que no se copian entre si) con informacion util',
      robot: 'Robot 2',
      exige: `${u.fuentesIndepMinimasRojo} o mas`,
      valor: String(d.fuentesIndependientes),
      cumple: d.fuentesIndependientes >= u.fuentesIndepMinimasRojo,
      definida: `${CONFIG} · nivel_maximo.fuentes_independientes_minimas · recuento en src/robot3/fuentes.ts`,
    },
    {
      codigo: 'reputacion_minima',
      regla: 'Reputacion media de los canales que hablan del token',
      robot: 'Robot 2',
      exige: `${u.reputacionMinimaRojo} o mas`,
      valor: numero(d.reputacionMedia),
      cumple: d.reputacionMedia >= u.reputacionMinimaRojo,
      definida: `${CONFIG} · nivel_maximo.reputacion_minima · calculo en src/telegram/anticipacion.ts`,
    },
    {
      codigo: 'anticipacion',
      regla: 'La informacion aparecio antes del movimiento del precio',
      robot: 'Robot 2',
      exige: 'antes del movimiento',
      valor: describirAnticipacion(d.anticipacionSeg),
      cumple: puntuarAnticipacion(d.anticipacionSeg) > 0,
      definida: `${CODIGO} · puntuarAnticipacion()`,
    },
    {
      codigo: 'sin_contradicciones',
      regla: 'La blockchain no desmiente lo que dicen los mensajes',
      robot: 'Robot 1 y 2',
      exige: 'ninguna contradiccion',
      valor: d.contradicciones === 0 ? 'ninguna' : `${d.contradicciones} contradiccion(es)`,
      cumple: d.contradicciones === 0,
      definida: `src/robot3/coherencia.ts · verificarCoherencia() y ${CODIGO} · decidir()`,
    },
  ];
}

/** Reglas del nivel intermedio ("Convergencia"): interes alto con reservas. */
export function reglasNivelIntermedio(d: DatosComparados, u: Umbrales): ReglaAplicada[] {
  return [
    ...reglasComunes(d),
    {
      codigo: 'tecnica_minima',
      regla: 'Nota de oportunidad del Robot 1',
      robot: 'Robot 1',
      exige: `${u.tecnicaMinimaNaranja} o mas`,
      valor: numero(d.tecnica),
      cumple: d.tecnica >= u.tecnicaMinimaNaranja,
      definida: `${CONFIG} · nivel_intermedio.tecnica_minima`,
    },
    {
      codigo: 'riesgo_maximo',
      regla: 'Nota de riesgo del Robot 1',
      robot: 'Robot 1',
      exige: `${u.riesgoMaximoNaranja} o menos`,
      valor: numero(d.riesgo),
      cumple: d.riesgo <= u.riesgoMaximoNaranja,
      definida: `${CONFIG} · nivel_intermedio.riesgo_maximo`,
    },
    {
      codigo: 'fuentes_independientes',
      regla: 'Canales independientes con informacion util',
      robot: 'Robot 2',
      exige: '1 o mas',
      valor: String(d.fuentesIndependientes),
      cumple: d.fuentesIndependientes >= 1,
      definida: `${CODIGO} · decidir()`,
    },
  ];
}

export interface Veredicto {
  nivel: Nivel;
  /** Componentes separadas. Nunca se funden en un numero unico. */
  componentes: {
    tecnica: number;
    riesgo: number;
    social: number;
    fuentes: number;
    anticipacion: number;
    evidencia: number;
  };
  /** Motivo principal, en una linea, para la alerta. */
  motivo: string;
  /** Todo lo que se tuvo en cuenta, para poder explicarlo. */
  explicacion: string[];
  /** Contradicciones detectadas entre las dos fuentes. */
  contradicciones: string[];
  /** Cada regla de los dos niveles altos, con el valor que tenia el token. */
  reglas: { maximo: ReglaAplicada[]; intermedio: ReglaAplicada[] };
}

/** Umbrales. Todos configurables: ninguno va fijo en el codigo de decision. */
export interface Umbrales {
  tecnicaMinimaRojo: number;
  riesgoMaximoRojo: number;
  fuentesIndepMinimasRojo: number;
  reputacionMinimaRojo: number;
  tecnicaMinimaNaranja: number;
  riesgoMaximoNaranja: number;
}

export const UMBRALES_POR_DEFECTO: Umbrales = {
  // Deliberadamente exigentes. La especificacion pide pocas alertas y muy
  // filtradas: "prefiero 1 senal fuerte antes que 20 debiles".
  //
  // Los valores de produccion viven en config/robot3.yaml; estos son el
  // respaldo si el fichero faltara, y son los mismos. Antes el nivel maximo
  // pedia una nota tecnica de 70, pero en 9.552 resultados reales la nota
  // mas alta que el Robot 1 ha dado nunca es 60,1: el liston estaba por
  // encima de lo alcanzable y el aviso no podia dispararse. 55 es la franja
  // donde los datos ya demuestran el mejor comportamiento (5,6 % de rugs).
  tecnicaMinimaRojo: 55,
  riesgoMaximoRojo: 40,
  fuentesIndepMinimasRojo: 2,
  reputacionMinimaRojo: 50,
  tecnicaMinimaNaranja: 45,
  riesgoMaximoNaranja: 60,
};

/** Puntua la calidad de la senal social, 0-100. */
function puntuarSocial(r2: EntradaRobot2): number {
  let p = 0;
  // Fuentes independientes: lo que de verdad importa. Cinco canales
  // copiandose valen menos que dos que llegaron por su cuenta.
  p += Math.min(40, r2.fuentesIndependientes * 20);
  // Que ademas haya volumen de menciones suma, pero poco.
  p += Math.min(15, r2.fuentesTotal * 3);
  // Informacion concreta vale mas que entusiasmo.
  if (['listing', 'lanzamiento', 'partnership', 'whale'].includes(r2.tipoSenal)) p += 25;
  if (r2.afirmacionVerificada) p += 20;
  return Math.min(100, p);
}

/**
 * La anticipacion dicha en palabras, igual en todo el aviso.
 *
 * Antes la cabecera y los motivos la escribian cada uno a su manera, y un
 * mismo aviso decia "sin medir todavia" arriba y "0 min antes del
 * movimiento" abajo.
 */
export function describirAnticipacion(seg: number | null): string {
  if (seg === null) return 'sin medir todavia';
  if (seg < 0) return `${Math.max(1, Math.round(-seg / 60))} min despues del movimiento`;
  if (seg < 60) return 'menos de 1 min antes del movimiento';
  return `${Math.round(seg / 60)} min antes del movimiento`;
}

/** Puntua la anticipacion, 0-100. */
function puntuarAnticipacion(seg: number | null): number {
  if (seg === null) return 0;
  // Llego despues del movimiento: no aporta nada, y ademas avisa de que
  // la fuente sigue al mercado en vez de adelantarse.
  if (seg < 0) return 0;
  // Muy por delante (mas de 6 h) probablemente sea casualidad, no senal:
  // atribuir un movimiento a un mensaje de ayer es enganarse.
  if (seg > 6 * 3600) return 30;
  // El rango util: de unos minutos a un par de horas.
  if (seg <= 30 * 60) return 100;
  if (seg <= 2 * 3600) return 80;
  return 55;
}

export function decidir(
  r1: EntradaRobot1,
  r2: EntradaRobot2,
  umbrales: Umbrales = UMBRALES_POR_DEFECTO,
): Veredicto {
  const explicacion: string[] = [];
  const contradicciones: string[] = [];

  const componentes = {
    tecnica: r1.opportunity,
    riesgo: r1.risk,
    social: puntuarSocial(r2),
    fuentes: Math.round(r2.reputacionMedia),
    anticipacion: puntuarAnticipacion(r2.anticipacionSeg),
    evidencia: r2.afirmacionVerificada ? 100 : 0,
  };

  // Las reglas se calculan siempre, tambien al descartar: el panel ensena
  // cada una con su valor para que se vea en cual se quedo el token.
  const reglasCon = (nContradicciones: number) => {
    const datos: DatosComparados = {
      tecnica: componentes.tecnica,
      riesgo: componentes.riesgo,
      vetado: r1.vetoed,
      evaluable: r1.evaluable,
      fuentesIndependientes: r2.fuentesIndependientes,
      reputacionMedia: componentes.fuentes,
      anticipacionSeg: r2.anticipacionSeg,
      contradicciones: nContradicciones,
    };
    return { maximo: reglasNivelMaximo(datos, umbrales), intermedio: reglasNivelIntermedio(datos, umbrales) };
  };

  // ---- 1. Vetos: por encima de todo lo demas --------------------------
  if (r1.vetoed) {
    const contradiccionesVeto =
      r2.fuentesIndependientes >= 2
        ? ['Telegram lo presenta como oportunidad y los datos dicen que es una trampa.']
        : [];
    return {
      nivel: 'descartado',
      componentes,
      motivo: 'Descartado por veto del analisis tecnico',
      explicacion: [
        `El Robot 1 veto el token: ${r1.vetos.join('; ') || 'condicion critica'}.`,
        r2.fuentesTotal > 3
          ? `Habia ${r2.fuentesTotal} fuentes hablando de el, pero eso no cambia nada: ` +
            'un token del que no se puede salir no es una oportunidad.'
          : 'No se envia ninguna alerta.',
      ],
      contradicciones: contradiccionesVeto,
      reglas: reglasCon(contradiccionesVeto.length),
    };
  }

  // ---- 2. Sin datos suficientes ---------------------------------------
  if (!r1.evaluable) {
    return {
      nivel: 'descartado',
      componentes,
      motivo: 'No se pudo comprobar lo suficiente',
      explicacion: [
        'Faltan comprobaciones criticas del Robot 1.',
        'Cuando no se puede verificar, el sistema no afirma: se calla.',
      ],
      contradicciones: [],
      reglas: reglasCon(0),
    };
  }

  // ---- 3. Contradicciones entre las dos fuentes -----------------------
  if (r2.fuentesIndependientes >= 2 && r1.risk > 60) {
    contradicciones.push(
      `Varias fuentes independientes lo recomiendan pero el riesgo tecnico es ${r1.risk}/100.`,
    );
  }
  // Lo que dicen los mensajes que la cadena desmiente. Si la fuente se
  // equivoca en lo que se puede comprobar, no se le cree en lo demas.
  const desmentidas = r2.coherencia?.contradichas ?? [];
  contradicciones.push(...desmentidas);
  const yaAvisoDeProblema = desmentidas.some((d) => d.includes('avisa de un problema'));
  if (r2.tipoSenal === 'negativo' && r1.opportunity > 60 && !yaAvisoDeProblema) {
    contradicciones.push(
      'Telegram avisa de algo negativo mientras los datos tecnicos salen bien. ' +
        'Puede ser informacion adelantada que aun no se ve en los numeros.',
    );
  }
  // Y lo que la cadena confirma, que es la evidencia de verdad.
  explicacion.push(...(r2.coherencia?.confirmadas ?? []));
  if (r2.anticipacionSeg !== null && r2.anticipacionSeg < 0) {
    explicacion.push(
      'Las fuentes hablaron DESPUES de que el precio se moviera: van detras del mercado.',
    );
  }

  // ---- 4. Nivel ---------------------------------------------------------
  // Cada nivel se cumple si se cumplen TODAS sus reglas. Son las mismas que
  // ensena el panel, asi que lo que se ve es exactamente lo que se aplico.
  const reglas = reglasCon(contradicciones.length);
  const cumpleRojo = reglas.maximo.every((r) => r.cumple);

  if (cumpleRojo) {
    explicacion.push(
      `Analisis tecnico fuerte (${componentes.tecnica}) con riesgo bajo (${componentes.riesgo}).`,
      `${r2.fuentesIndependientes} fuentes independientes, no copias unas de otras.`,
      `La informacion aparecio ${describirAnticipacion(r2.anticipacionSeg)}.`,
    );
    // Con la coherencia comprobada, las confirmaciones ya estan arriba con
    // su detalle; la frase generica solo queda para cuando no la hay.
    if (r2.afirmacionVerificada && !r2.coherencia?.confirmadas.length) {
      explicacion.push('La afirmacion se pudo comprobar.');
    }
    return {
      nivel: 'rojo',
      componentes,
      motivo: 'Coincidencia fuerte entre informacion y datos objetivos',
      explicacion,
      contradicciones,
      reglas,
    };
  }

  const cumpleNaranja = reglas.intermedio.every((r) => r.cumple);

  if (cumpleNaranja) {
    explicacion.push(
      `El Robot 1 confirma datos aceptables (oportunidad ${componentes.tecnica}, riesgo ${componentes.riesgo}).`,
      `Hay ${r2.fuentesIndependientes} fuente(s) independiente(s), pero no se cumple todo lo exigido para maxima prioridad.`,
    );
    return {
      nivel: 'naranja',
      componentes,
      motivo: 'Interes alto, con reservas',
      explicacion,
      contradicciones,
      reglas,
    };
  }

  explicacion.push(
    'Telegram encontro algo, pero el analisis tecnico no lo respalda lo suficiente.',
    `Oportunidad ${componentes.tecnica}, riesgo ${componentes.riesgo}.`,
  );
  return {
    nivel: 'amarillo',
    componentes,
    motivo: 'Solo para observacion',
    explicacion,
    contradicciones,
    reglas,
  };
}
