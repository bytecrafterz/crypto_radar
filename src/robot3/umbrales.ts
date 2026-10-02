/**
 * Traduce config/robot3.yaml a los umbrales que entiende el motor.
 *
 * El motor (convergencia.ts) es puro a proposito: recibe numeros y decide,
 * sin leer ficheros ni base de datos, para que se pueda probar aislado. La
 * lectura de la configuracion se hace aqui, en un solo sitio, y la usan el
 * evaluador, el panel y el script de calibracion.
 */
import { getRobot3 } from '../core/config.js';
import { UMBRALES_POR_DEFECTO, type Umbrales } from './convergencia.js';

export function umbralesActuales(): Umbrales {
  try {
    const c = getRobot3();
    return {
      tecnicaMinimaRojo: c.nivel_maximo.tecnica_minima,
      riesgoMaximoRojo: c.nivel_maximo.riesgo_maximo,
      fuentesIndepMinimasRojo: c.nivel_maximo.fuentes_independientes_minimas,
      reputacionMinimaRojo: c.nivel_maximo.reputacion_minima,
      tecnicaMinimaNaranja: c.nivel_intermedio.tecnica_minima,
      riesgoMaximoNaranja: c.nivel_intermedio.riesgo_maximo,
    };
  } catch {
    return UMBRALES_POR_DEFECTO;
  }
}

export function avisosPorDia(): number {
  try {
    return getRobot3().avisos_por_dia;
  } catch {
    return 3;
  }
}

/** Horas que puede esperar un aviso retenido por el tope o la pausa. */
export function horasValidezAviso(): number {
  try {
    return getRobot3().aviso_caduca_horas ?? 2;
  } catch {
    return 2;
  }
}
