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

  // ---- 1. Vetos: por encima de todo lo demas --------------------------
  if (r1.vetoed) {
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
      contradicciones:
        r2.fuentesIndependientes >= 2
          ? ['Telegram lo presenta como oportunidad y los datos dicen que es una trampa.']
          : [],
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
  const cumpleRojo =
    componentes.tecnica >= umbrales.tecnicaMinimaRojo &&
    componentes.riesgo <= umbrales.riesgoMaximoRojo &&
    r2.fuentesIndependientes >= umbrales.fuentesIndepMinimasRojo &&
    componentes.fuentes >= umbrales.reputacionMinimaRojo &&
    componentes.anticipacion > 0 &&
    contradicciones.length === 0;

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
    };
  }

  const cumpleNaranja =
    componentes.tecnica >= umbrales.tecnicaMinimaNaranja &&
    componentes.riesgo <= umbrales.riesgoMaximoNaranja &&
    r2.fuentesIndependientes >= 1;

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
  };
}
