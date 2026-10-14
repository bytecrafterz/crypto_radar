/**
 * Formato de numeros y fechas, en espanol y con la hora de Madrid.
 * Ningun componente formatea por su cuenta: asi todo el panel dice las
 * cosas igual.
 */

const ZONA = 'Europe/Madrid';
const nf0 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 });
const nfCompact = new Intl.NumberFormat('es-ES', { notation: 'compact', maximumFractionDigits: 1 });

export const ND = 'n/d';

const valido = (n: number | null | undefined): n is number => n !== null && n !== undefined && Number.isFinite(n);

export function fmtNum(n: number | null | undefined): string {
  return valido(n) ? nf0.format(n) : ND;
}

export function fmtCompact(n: number | null | undefined): string {
  return valido(n) ? nfCompact.format(n) : ND;
}

export function fmtUsd(n: number | null | undefined): string {
  if (!valido(n)) return ND;
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  if (a >= 1) return `$${n.toFixed(2)}`;
  if (n === 0) return '$0';
  return `$${n.toPrecision(3)}`;
}

/** Precio de un token: puede ser 0,0000004 o 2.016, se dan 4 cifras significativas. */
export function fmtPrice(n: number | null | undefined): string {
  if (!valido(n)) return ND;
  if (n === 0) return '$0';
  return Math.abs(n) >= 1 ? `$${n.toFixed(4)}` : `$${n.toPrecision(4)}`;
}

export function fmtPct(n: number | null | undefined, decimales = 1, signo = false): string {
  if (!valido(n)) return ND;
  const s = signo && n > 0 ? '+' : '';
  return `${s}${n.toFixed(decimales)}%`;
}

export function fmtMultiple(n: number | null | undefined): string {
  return valido(n) ? `${n.toFixed(2)}x` : ND;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ND;
  return new Date(iso).toLocaleString('es-ES', {
    timeZone: ZONA,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return ND;
  return new Date(iso).toLocaleTimeString('es-ES', { timeZone: ZONA, hour: '2-digit', minute: '2-digit' });
}

/** "hace 5 min", "hace 3 h", "hace 2 dias". */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ND;
  const seg = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seg < 60) return 'ahora mismo';
  const min = Math.round(seg / 60);
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} dias`;
}

/** Duracion en palabras a partir de milisegundos. */
export function fmtDuration(ms: number | null | undefined): string {
  if (!valido(ms)) return ND;
  const min = Math.round(ms / 60_000);
  if (min < 1) return 'menos de un minuto';
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} dias`;
}

/** Segundos en la unidad que se lee de un vistazo: 45 s, 12 min, 2 h 5 min. */
export function fmtSegundos(s: number | null | undefined): string {
  if (!valido(s)) return ND;
  if (s < 90) return `${Math.round(s)} s`;
  const min = Math.round(s / 60);
  if (min < 90) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h} h ${resto} min` : `${h} h`;
}

export function shortAddr(a: string | null | undefined, head = 6, tail = 4): string {
  if (!a) return ND;
  return a.length <= head + tail + 3 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;
}

/** Anticipacion de una mencion respecto al movimiento del precio. */
export function anticipacion(seg: number | null, veredicto?: string | null): { texto: string; tono: 'good' | 'critical' | 'neutral' } {
  if (veredicto === 'sin_datos') return { texto: 'no se pudo medir', tono: 'neutral' };
  if (veredicto === 'sin_movimiento') return { texto: 'sin movimiento', tono: 'neutral' };
  if (seg === null) return { texto: 'pendiente', tono: 'neutral' };
  if (seg === 0) return { texto: 'sin movimiento', tono: 'neutral' };
  const m = Math.round(seg / 60);
  if (seg > 0) return { texto: m < 1 ? 'menos de 1 min antes' : `${m} min antes`, tono: 'good' };
  return { texto: `${Math.max(1, Math.abs(m))} min tarde`, tono: 'critical' };
}
