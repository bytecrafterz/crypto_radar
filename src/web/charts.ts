/**
 * Graficos en SVG generados en el servidor.
 * Sin librerias ni JavaScript en el navegador: el panel carga al instante
 * incluso en un servidor pequeno.
 */
import { escapeHtml, fmtUsd } from '../core/util.js';

export interface Point {
  ts: Date;
  value: number | null;
}

interface ChartOptions {
  width?: number;
  height?: number;
  color?: string;
  fill?: boolean;
  label?: string;
  formatter?: (v: number) => string;
}

/** Grafico de linea con ejes minimos. */
export function lineChart(points: Point[], opts: ChartOptions = {}): string {
  const width = opts.width ?? 720;
  const height = opts.height ?? 200;
  const padLeft = 56;
  const padRight = 12;
  const padTop = 14;
  const padBottom = 24;
  const color = opts.color ?? '#58a6ff';
  const format = opts.formatter ?? ((v: number) => fmtUsd(v));

  const valid = points.filter((p) => p.value !== null && Number.isFinite(p.value)) as Array<{
    ts: Date;
    value: number;
  }>;

  if (valid.length < 2) {
    return `<div class="empty small">Todavia no hay suficientes mediciones para dibujar el grafico.</div>`;
  }

  const values = valid.map((p) => p.value);
  const times = valid.map((p) => p.ts.getTime());
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min = min * 0.95;
    max = max * 1.05 || 1;
  }
  const tMin = Math.min(...times);
  const tMax = Math.max(...times);
  const tSpan = tMax - tMin || 1;

  const plotW = width - padLeft - padRight;
  const plotH = height - padTop - padBottom;

  const x = (t: number) => padLeft + ((t - tMin) / tSpan) * plotW;
  const y = (v: number) => padTop + plotH - ((v - min) / (max - min)) * plotH;

  const path = valid
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.ts.getTime()).toFixed(1)},${y(p.value).toFixed(1)}`)
    .join(' ');

  const area = opts.fill
    ? `<path d="${path} L${x(tMax).toFixed(1)},${(padTop + plotH).toFixed(1)} L${x(tMin).toFixed(1)},${(padTop + plotH).toFixed(1)} Z" fill="${color}" opacity="0.10"/>`
    : '';

  // Tres lineas de referencia horizontales.
  const gridLines = [0, 0.5, 1]
    .map((f) => {
      const v = min + (max - min) * (1 - f);
      const yy = padTop + plotH * f;
      return `<line x1="${padLeft}" y1="${yy.toFixed(1)}" x2="${width - padRight}" y2="${yy.toFixed(1)}" stroke="#2a313c" stroke-width="1"/>
              <text x="${padLeft - 8}" y="${(yy + 4).toFixed(1)}" fill="#6e7681" font-size="10" text-anchor="end">${escapeHtml(format(v))}</text>`;
    })
    .join('');

  const fmtTime = (t: number) =>
    new Date(t).toLocaleString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${escapeHtml(opts.label ?? 'grafico')}">
    ${gridLines}
    ${area}
    <path d="${path}" fill="none" stroke="${color}" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="${padLeft}" y="${height - 6}" fill="#6e7681" font-size="10">${escapeHtml(fmtTime(tMin))}</text>
    <text x="${width - padRight}" y="${height - 6}" fill="#6e7681" font-size="10" text-anchor="end">${escapeHtml(fmtTime(tMax))}</text>
  </svg>`;
}

/** Mini grafico sin ejes para usar dentro de una tabla. */
export function sparkline(values: number[], color = '#58a6ff', width = 90, height = 24): string {
  const valid = values.filter((v) => Number.isFinite(v));
  if (valid.length < 2) return '<span class="dim small">–</span>';

  const min = Math.min(...valid);
  const max = Math.max(...valid);
  const span = max - min || 1;

  const path = valid
    .map((v, i) => {
      const x = (i / (valid.length - 1)) * (width - 2) + 1;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  const trend = valid[valid.length - 1] >= valid[0] ? '#3fb950' : '#f85149';

  return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="vertical-align:middle">
    <path d="${path}" fill="none" stroke="${color === 'auto' ? trend : color}" stroke-width="1.5" stroke-linejoin="round"/>
  </svg>`;
}

/** Barras horizontales para comparar categorias (usado en resultados). */
export function barList(
  items: Array<{ label: string; value: number; color?: string }>,
): string {
  if (items.length === 0) return '<div class="empty small">Sin datos todavia.</div>';
  const max = Math.max(...items.map((i) => i.value), 1);

  return `<div style="display:flex;flex-direction:column;gap:8px">
    ${items
      .map(
        (i) => `<div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px">
            <span>${escapeHtml(i.label)}</span><span class="num">${i.value}</span>
          </div>
          <div class="bar" style="width:100%;height:8px">
            <div style="width:${((i.value / max) * 100).toFixed(1)}%;background:${i.color ?? 'var(--blue)'}"></div>
          </div>
        </div>`,
      )
      .join('')}
  </div>`;
}
