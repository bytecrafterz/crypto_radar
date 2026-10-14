import { colorTono, nivelRiesgo } from '../../lib/labels';

/**
 * Medidor de una nota 0-100. La gravedad la lleva el relleno: azul para
 * las notas "buenas cuanto mas altas" y el color de estado para el riesgo.
 * El numero va siempre al lado: el color solo no dice el valor.
 */
export function Meter({ value, kind = 'opportunity' }: { value: number | null; kind?: 'opportunity' | 'risk' }) {
  if (value === null) return <span className="dim">n/d</span>;
  const v = Math.max(0, Math.min(100, value));
  const color = kind === 'risk' ? colorTono[nivelRiesgo(v).tono] : 'var(--accent)';
  return (
    <span className="meter" title={`${v}/100`}>
      <span className="meter__track">
        <span className="meter__fill" style={{ width: `${v}%`, background: color, display: 'block' }} />
      </span>
      <span className="meter__value">{Math.round(v)}</span>
    </span>
  );
}

/** Medidor con su etiqueta encima: para desgloses de componentes. */
export function MeterRow({ label, value, invert }: { label: string; value: number; invert?: boolean }) {
  const v = Math.max(0, Math.min(100, value));
  const color = invert ? colorTono[nivelRiesgo(v).tono] : 'var(--accent)';
  return (
    <div className="meter-row">
      <span className="meter-row__label">{label}</span>
      <span className="meter-row__value">{Math.round(v)}</span>
      <span className="meter__track">
        <span className="meter__fill" style={{ width: `${v}%`, background: color, display: 'block' }} />
      </span>
    </div>
  );
}
