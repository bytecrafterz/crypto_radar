import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmtDate } from '../../lib/format';
import { EmptyState } from '../ui/States';

export interface Punto {
  ts: string | null;
  value: number | null;
}

interface LineChartProps {
  points: Punto[];
  format: (v: number) => string;
  /** Nombre de la serie, para el lector de pantalla y el tooltip. */
  label: string;
  height?: number;
  color?: string;
}

const PAD = { top: 12, right: 12, bottom: 26, left: 58 };

/** Ancho real del contenedor, para dibujar a escala y no estirar el texto. */
function useAncho<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [ancho, setAncho] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setAncho(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, ancho] as const;
}

/**
 * Grafico de linea de una sola serie.
 *
 * Linea de 2 px con un velo del 10 % debajo, tres lineas de referencia
 * finas y un cursor vertical que se pega al punto mas cercano y ensena su
 * valor. Con una sola serie no hace falta leyenda: el titulo dice que es.
 */
export function LineChart({ points, format, label, height = 200, color = 'var(--series-1)' }: LineChartProps) {
  const [ref, ancho] = useAncho<HTMLDivElement>();
  const [activo, setActivo] = useState<number | null>(null);

  const validos = useMemo(
    () =>
      points
        .filter((p): p is { ts: string; value: number } => p.ts !== null && p.value !== null && Number.isFinite(p.value))
        .map((p) => ({ t: new Date(p.ts).getTime(), v: p.value, ts: p.ts })),
    [points],
  );

  // El contenedor se pinta siempre: es el que se mide, y si solo apareciera
  // con datos, el grafico se quedaria con el ancho minimo al llegar estos.
  if (validos.length < 2) {
    return (
      <div className="chart" ref={ref}>
        <EmptyState compact title="Aun no hay suficientes mediciones" text="El grafico aparece en cuanto haya al menos dos." />
      </div>
    );
  }

  const w = Math.max(ancho, 240);
  const plotW = w - PAD.left - PAD.right;
  const plotH = height - PAD.top - PAD.bottom;

  let min = Math.min(...validos.map((p) => p.v));
  let max = Math.max(...validos.map((p) => p.v));
  if (min === max) {
    min = min * 0.95;
    max = max * 1.05 || 1;
  }
  const t0 = validos[0].t;
  const t1 = validos[validos.length - 1].t;
  const span = t1 - t0 || 1;

  const x = (t: number) => PAD.left + ((t - t0) / span) * plotW;
  const y = (v: number) => PAD.top + plotH - ((v - min) / (max - min)) * plotH;

  const linea = validos.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const base = PAD.top + plotH;
  const area = `${linea} L${x(t1).toFixed(1)},${base} L${x(t0).toFixed(1)},${base} Z`;
  const ticks = [0, 0.5, 1].map((f) => ({ v: max - (max - min) * f, yy: PAD.top + plotH * f }));

  const cercano = (px: number) => {
    let mejor = 0;
    let dist = Infinity;
    validos.forEach((p, i) => {
      const d = Math.abs(x(p.t) - px);
      if (d < dist) {
        dist = d;
        mejor = i;
      }
    });
    return mejor;
  };

  const alMover = (e: PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setActivo(cercano(e.clientX - r.left + PAD.left));
  };

  const alTeclear = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key === 'ArrowRight') setActivo((a) => Math.min(validos.length - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setActivo((a) => Math.max(0, (a ?? validos.length) - 1));
    else if (e.key === 'Escape') setActivo(null);
  };

  const p = activo !== null ? validos[activo] : null;

  return (
    <div className="chart" ref={ref}>
      <svg
        width={w}
        height={height}
        viewBox={`0 0 ${w} ${height}`}
        role="img"
        aria-label={`${label}: de ${format(validos[0].v)} a ${format(validos[validos.length - 1].v)}`}
        tabIndex={0}
        onKeyDown={alTeclear}
        onBlur={() => setActivo(null)}
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={w - PAD.right} y1={t.yy} y2={t.yy} stroke="var(--chart-grid)" strokeWidth={1} />
            <text x={PAD.left - 8} y={t.yy + 4} textAnchor="end" fontSize={11} fill="var(--chart-axis)" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {format(t.v)}
            </text>
          </g>
        ))}
        <path d={area} fill={color} opacity={0.1} />
        <path d={linea} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        <text x={PAD.left} y={height - 6} fontSize={11} fill="var(--chart-axis)">
          {fmtDate(validos[0].ts)}
        </text>
        <text x={w - PAD.right} y={height - 6} fontSize={11} fill="var(--chart-axis)" textAnchor="end">
          {fmtDate(validos[validos.length - 1].ts)}
        </text>

        {p && (
          <g pointerEvents="none">
            <line x1={x(p.t)} x2={x(p.t)} y1={PAD.top} y2={base} stroke="var(--chart-axis)" strokeWidth={1} opacity={0.6} />
            <circle cx={x(p.t)} cy={y(p.v)} r={4.5} fill={color} stroke="var(--surface)" strokeWidth={2} />
          </g>
        )}

        <rect
          x={PAD.left}
          y={PAD.top}
          width={plotW}
          height={plotH}
          fill="transparent"
          onPointerMove={alMover}
          onPointerDown={alMover}
          onPointerLeave={() => setActivo(null)}
        />
      </svg>

      {p && (
        <div
          className="chart__tooltip"
          style={{ left: Math.min(Math.max(x(p.t), 80), w - 80), top: Math.max(0, y(p.v) - 64) }}
          role="status"
        >
          <div className="chart__tooltip-value">{format(p.v)}</div>
          <div className="chart__tooltip-label">
            <span className="chart__key" style={{ background: color }} />
            {label} · {fmtDate(p.ts)}
          </div>
        </div>
      )}
    </div>
  );
}
