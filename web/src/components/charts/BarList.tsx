import { colorTono, type Tono } from '../../lib/labels';
import { fmtNum } from '../../lib/format';
import { EmptyState } from '../ui/States';

export interface BarItem {
  label: string;
  value: number;
  tono?: Tono;
  hint?: string;
}

/**
 * Barras horizontales para comparar categorias. Cada barra lleva su nombre
 * y su valor escritos: el color acompana, no sustituye al texto.
 */
export function BarList({ items }: { items: BarItem[] }) {
  if (items.length === 0) return <EmptyState compact title="Sin datos todavia" />;
  const max = Math.max(...items.map((i) => i.value), 1);
  const total = items.reduce((a, i) => a + i.value, 0);

  return (
    <div className="barlist">
      {items.map((i) => (
        <div className="barlist__row" key={i.label} title={i.hint}>
          <span className="barlist__label">{i.label}</span>
          <span className="barlist__value">
            {fmtNum(i.value)}
            <span className="dim" style={{ fontWeight: 400 }}>
              {' '}
              · {total > 0 ? Math.round((i.value / total) * 100) : 0}%
            </span>
          </span>
          <span className="barlist__track">
            <span
              className="barlist__fill"
              style={{ display: 'block', width: `${(i.value / max) * 100}%`, background: colorTono[i.tono ?? 'info'] }}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
