import { Link } from 'react-router-dom';

export const rutaToken = (chain: string, address: string) => `/token/${chain}/${encodeURIComponent(address)}`;

/** Iniciales del simbolo, para el circulo que hace de icono. */
export function iniciales(symbol: string | null): string {
  const s = (symbol ?? '?').replace(/[^\p{L}\p{N}]/gu, '');
  return (s.slice(0, 3) || '?').toUpperCase();
}

interface TokenCellProps {
  chain: string;
  address: string;
  symbol: string | null;
  name?: string | null;
  /** Sin enlace (por ejemplo, dentro de una fila que ya navega). */
  plain?: boolean;
}

export function TokenCell({ chain, address, symbol, name, plain }: TokenCellProps) {
  const contenido = (
    <span className="token-cell">
      <span className="token-cell__avatar" aria-hidden="true">
        {iniciales(symbol)}
      </span>
      <span style={{ minWidth: 0 }}>
        <span className="token-cell__sym">{symbol ?? '???'}</span>
        {name && <span className="token-cell__name truncate" style={{ display: 'block' }}>{name}</span>}
      </span>
    </span>
  );
  return plain ? (
    contenido
  ) : (
    <Link to={rutaToken(chain, address)} onClick={(e) => e.stopPropagation()} style={{ color: 'inherit' }}>
      {contenido}
    </Link>
  );
}
