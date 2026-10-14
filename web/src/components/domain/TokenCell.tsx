import { Link } from 'react-router-dom';

export const rutaToken = (chain: string, address: string) => `/token/${chain}/${encodeURIComponent(address)}`;

/** Iniciales del simbolo, para el circulo que hace de icono. */
export function iniciales(symbol: string | null): string {
  const s = (symbol ?? '?').replace(/[^\p{L}\p{N}]/gu, '');
  // Un caracter chino o japones ocupa lo que dos latinos: con uno basta.
  // 0x24F es el final del alfabeto latino extendido.
  const letras = [...s];
  const largo = letras.some((c) => (c.codePointAt(0) ?? 0) > 0x24f) ? 1 : 3;
  return (letras.slice(0, largo).join('') || '?').toUpperCase();
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
