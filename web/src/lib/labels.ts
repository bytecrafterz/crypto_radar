/**
 * Nombres y tonos de todo lo que tiene categorias en el panel.
 *
 * Un tono de estado nunca va solo: siempre acompana a su texto, para que se
 * entienda igual sin distinguir colores.
 */

export type Tono = 'good' | 'warning' | 'serious' | 'critical' | 'info' | 'violet' | 'neutral';

/** Riesgo 0-100 con los tramos del manual de uso. */
export function nivelRiesgo(r: number | null): { texto: string; tono: Tono } {
  if (r === null) return { texto: 'n/d', tono: 'neutral' };
  if (r <= 20) return { texto: 'BAJO', tono: 'good' };
  if (r <= 45) return { texto: 'MEDIO', tono: 'warning' };
  if (r <= 70) return { texto: 'ALTO', tono: 'serious' };
  return { texto: 'CRITICO', tono: 'critical' };
}

/** Oportunidad 0-100 con los tramos del manual de uso. */
export function nivelOportunidad(o: number | null): { texto: string; tono: Tono } {
  if (o === null) return { texto: 'n/d', tono: 'neutral' };
  if (o >= 85) return { texto: 'MUY FUERTE', tono: 'good' };
  if (o >= 70) return { texto: 'FUERTE', tono: 'good' };
  if (o >= 55) return { texto: 'INTERESANTE', tono: 'info' };
  if (o >= 40) return { texto: 'OBSERVAR', tono: 'neutral' };
  return { texto: 'DESCARTADO', tono: 'neutral' };
}

/** Color del relleno de un medidor de riesgo: la gravedad la lleva el relleno. */
export const colorTono: Record<Tono, string> = {
  good: 'var(--good)',
  warning: 'var(--warning)',
  serious: 'var(--serious)',
  critical: 'var(--critical)',
  info: 'var(--accent)',
  violet: '#9085e9',
  neutral: 'var(--neutral)',
};

export const ESTADOS_TOKEN: Record<string, { texto: string; tono: Tono }> = {
  nuevo: { texto: 'Nuevo', tono: 'info' },
  vigilado: { texto: 'Vigilado', tono: 'good' },
  alertado: { texto: 'Alertado', tono: 'good' },
  peligro: { texto: 'Peligro', tono: 'critical' },
  descartado: { texto: 'Descartado', tono: 'neutral' },
  archivado: { texto: 'Archivado', tono: 'neutral' },
};

/** Niveles del Robot 3. */
export const NIVELES: Record<string, { texto: string; tono: Tono; descripcion: string }> = {
  rojo: { texto: 'Convergencia fuerte', tono: 'critical', descripcion: 'El unico nivel que envia aviso' },
  naranja: { texto: 'Convergencia', tono: 'warning', descripcion: 'Interes alto con reservas' },
  amarillo: { texto: 'Seguimiento', tono: 'info', descripcion: 'Se habla del token, los datos no lo respaldan' },
  descartado: { texto: 'Descartado', tono: 'neutral', descripcion: 'Vetado o sin datos suficientes' },
};
export const ORDEN_NIVELES = ['rojo', 'naranja', 'amarillo', 'descartado'];

export const RESULTADOS: Record<string, { texto: string; tono: Tono; descripcion: string }> = {
  exito: { texto: 'Exito', tono: 'good', descripcion: 'Multiplico por 2 o mas su capitalizacion' },
  neutro: { texto: 'Neutro', tono: 'neutral', descripcion: 'Se movio poco desde la deteccion' },
  fracaso: { texto: 'Fracaso', tono: 'serious', descripcion: 'Perdio mas de la mitad de su valor' },
  rug: { texto: 'Rug', tono: 'critical', descripcion: 'Se retiro casi toda la liquidez' },
};

export const TIPOS_ALERTA: Record<string, { texto: string; tono: Tono }> = {
  oportunidad: { texto: 'Oportunidad', tono: 'good' },
  peligro: { texto: 'Peligro', tono: 'critical' },
  convergencia: { texto: 'Convergencia', tono: 'violet' },
};

export const CLASES_MENSAJE: Record<string, { texto: string; tono: Tono }> = {
  informacion: { texto: 'Informacion', tono: 'good' },
  promocion: { texto: 'Promocion', tono: 'warning' },
  hype: { texto: 'Hype', tono: 'neutral' },
  indeterminado: { texto: 'Indeterminado', tono: 'neutral' },
};

export const ESTADOS_CANAL: Record<string, { texto: string; tono: Tono }> = {
  unido: { texto: 'Dentro', tono: 'good' },
  candidato: { texto: 'Localizado', tono: 'info' },
  rechazado: { texto: 'Descartado', tono: 'neutral' },
  abandonado: { texto: 'Abandonado', tono: 'warning' },
};

/** Movimientos sospechosos que detecta el Robot 1. */
export const SOSPECHOSOS: Record<string, string> = {
  liquidity_removed: 'Liquidez retirada',
  price_crash: 'Caida de precio',
  bot_pattern: 'Patron de bots',
  wash_trading: 'Wash trading',
  sell_pressure: 'Presion vendedora',
  sniper_cluster: 'Compras en el mismo bloque',
  volume_without_holders: 'Volumen sin holders',
};

export const SEVERIDAD: Record<string, Tono> = { danger: 'critical', warn: 'warning', info: 'neutral' };
export const NIVEL_LOG: Record<string, Tono> = { error: 'critical', warn: 'warning', info: 'neutral' };
