import type { ReactNode } from 'react';
import { SkeletonRows } from './Skeleton';
import { EmptyState, ErrorState } from './States';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right';
  width?: number | string;
  /** Se oculta en pantallas estrechas para que la tabla quepa. */
  hideOnMobile?: boolean;
}

interface DataTableProps<T> {
  columns: Array<Column<T>>;
  rows: T[] | undefined;
  rowKey: (row: T, i: number) => string | number;
  /** Primera carga: filas de relleno. */
  loading?: boolean;
  /** Recarga con datos ya en pantalla: se atenuan, no desaparecen. */
  refetching?: boolean;
  error?: unknown;
  onRetry?: () => void;
  onRowClick?: (row: T) => void;
  empty?: { title: string; text?: ReactNode };
  skeletonRows?: number;
  compact?: boolean;
}

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading,
  refetching,
  error,
  onRetry,
  onRowClick,
  empty = { title: 'Sin resultados' },
  skeletonRows = 8,
  compact,
}: DataTableProps<T>) {
  if (error && !rows) return <ErrorState error={error} onRetry={onRetry} compact />;

  const vacia = !loading && rows !== undefined && rows.length === 0;

  return (
    <div className={`table-wrap ${refetching ? 'is-refetching' : ''}`} aria-busy={loading || refetching || undefined}>
      <table className={`table ${compact ? 'table--compact' : ''}`}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                className={`${c.align === 'right' ? 'num' : ''} ${c.hideOnMobile ? 'hide-mobile' : ''}`}
                style={{ width: c.width }}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !rows ? (
            <SkeletonRows rows={skeletonRows} cols={columns.length} />
          ) : (
            rows?.map((row, i) => (
              <tr
                key={rowKey(row, i)}
                className={onRowClick ? 'is-clickable' : undefined}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((c) => (
                  <td key={c.key} className={`${c.align === 'right' ? 'num' : ''} ${c.hideOnMobile ? 'hide-mobile' : ''}`}>
                    {c.cell(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
      {vacia && <EmptyState compact title={empty.title} text={empty.text} />}
    </div>
  );
}
