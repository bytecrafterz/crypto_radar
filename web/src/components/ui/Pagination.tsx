import { ChevronLeft, ChevronRight } from 'lucide-react';
import { fmtNum } from '../../lib/format';
import { Spinner } from './Spinner';

interface PaginationProps {
  page: number;
  size: number;
  total: number;
  onPage: (page: number) => void;
  onSize?: (size: number) => void;
  sizes?: number[];
  loading?: boolean;
}

/** Numeros de pagina a ensenar: primera, ultima y las cercanas, con huecos. */
function paginas(actual: number, total: number): Array<number | '…'> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, actual - 1, actual, actual + 1].filter((p) => p >= 1 && p <= total));
  const orden = [...set].sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  orden.forEach((p, i) => {
    if (i > 0 && p - orden[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

export function Pagination({ page, size, total, onPage, onSize, sizes = [10, 25, 50, 100], loading }: PaginationProps) {
  const totalPaginas = Math.max(1, Math.ceil(total / size));
  const desde = total === 0 ? 0 : (page - 1) * size + 1;
  const hasta = Math.min(total, page * size);

  return (
    <nav className="pagination" aria-label="Paginacion">
      <div className="row">
        <span>
          {fmtNum(desde)}–{fmtNum(hasta)} de <b>{fmtNum(total)}</b>
        </span>
        {loading && <Spinner size={14} />}
      </div>

      <div className="pagination__pages">
        <button className="pagination__page" onClick={() => onPage(page - 1)} disabled={page <= 1} aria-label="Pagina anterior">
          <ChevronLeft size={16} />
        </button>
        {paginas(page, totalPaginas).map((p, i) =>
          p === '…' ? (
            <span key={`h${i}`} className="dim" style={{ padding: '0 4px' }}>
              …
            </span>
          ) : (
            <button
              key={p}
              className={`pagination__page ${p === page ? 'is-active' : ''}`}
              onClick={() => onPage(p)}
              aria-current={p === page ? 'page' : undefined}
            >
              {p}
            </button>
          ),
        )}
        <button
          className="pagination__page"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPaginas}
          aria-label="Pagina siguiente"
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {onSize && (
        <label className="pagination__size">
          <span>Por pagina</span>
          <select className="select" value={size} onChange={(e) => onSize(Number(e.target.value))}>
            {sizes.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      )}
    </nav>
  );
}
