import { useState, type ReactNode } from 'react';
import { LineChart as IconoGrafico, Table2 } from 'lucide-react';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { fmtDate } from '../../lib/format';
import { LineChart, type Punto } from './LineChart';

interface ChartCardProps {
  title: string;
  sub?: ReactNode;
  points: Punto[];
  format: (v: number) => string;
  height?: number;
  extra?: ReactNode;
}

/**
 * Tarjeta con un grafico y su version en tabla. La tabla es el gemelo
 * accesible del grafico: los mismos valores, sin depender de ver la linea.
 */
export function ChartCard({ title, sub, points, format, height, extra }: ChartCardProps) {
  const [tabla, setTabla] = useState(false);
  const validos = points.filter((p) => p.value !== null);

  return (
    <Card
      title={title}
      sub={sub}
      actions={
        <>
          {extra}
          <Button
            size="sm"
            variant="ghost"
            iconOnly
            icon={tabla ? <IconoGrafico /> : <Table2 />}
            onClick={() => setTabla((t) => !t)}
            aria-label={tabla ? 'Ver grafico' : 'Ver tabla'}
            title={tabla ? 'Ver grafico' : 'Ver tabla'}
          />
        </>
      }
    >
      {tabla ? (
        <div className="table-wrap" style={{ maxHeight: height ?? 200, overflowY: 'auto' }}>
          <table className="table table--compact">
            <thead>
              <tr>
                <th>Momento</th>
                <th className="num">{title}</th>
              </tr>
            </thead>
            <tbody>
              {[...validos].reverse().map((p, i) => (
                <tr key={i}>
                  <td className="dim">{fmtDate(p.ts)}</td>
                  <td className="num">{format(p.value as number)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <LineChart points={points} format={format} label={title} height={height} />
      )}
    </Card>
  );
}
