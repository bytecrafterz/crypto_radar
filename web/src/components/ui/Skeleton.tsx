import type { CSSProperties } from 'react';

interface SkeletonProps {
  width?: number | string;
  height?: number | string;
  radius?: number;
  style?: CSSProperties;
}

/** Hueco con brillo que ocupa el sitio de lo que esta cargando. */
export function Skeleton({ width = '100%', height = 14, radius, style }: SkeletonProps) {
  return <span className="skeleton" aria-hidden="true" style={{ width, height, borderRadius: radius, ...style }} />;
}

/** Filas de tabla de relleno, con el mismo numero de columnas que la tabla real. */
export function SkeletonRows({ rows = 8, cols }: { rows?: number; cols: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r} aria-hidden="true">
          {Array.from({ length: cols }, (_, c) => (
            <td key={c}>
              <Skeleton width={c === 0 ? '70%' : `${45 + ((r * 7 + c * 13) % 40)}%`} height={c === 0 ? 16 : 12} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

/** Bloque de lineas de texto de relleno. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} width={i === lines - 1 ? '60%' : '100%'} height={12} />
      ))}
    </div>
  );
}
