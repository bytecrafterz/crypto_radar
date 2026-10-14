import type { ReactNode } from 'react';

export interface SegOption<V extends string> {
  value: V;
  label: ReactNode;
  count?: number;
}

interface SegmentedProps<V extends string> {
  options: Array<SegOption<V>>;
  value: V;
  onChange: (v: V) => void;
  label: string;
}

/** Pestanas compactas para filtrar o cambiar de vista. */
export function Segmented<V extends string>({ options, value, onChange, label }: SegmentedProps<V>) {
  return (
    <div className="seg" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={`seg__btn ${o.value === value ? 'is-active' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && <span className="seg__count">{o.count.toLocaleString('es-ES')}</span>}
        </button>
      ))}
    </div>
  );
}
