import { useState, type MouseEvent } from 'react';
import { Check, Copy, ExternalLink } from 'lucide-react';
import { shortAddr } from '../../lib/format';

interface AddressLinkProps {
  address: string;
  href?: string;
  full?: boolean;
}

/** Direccion acortada, con enlace al explorador y boton para copiarla entera. */
export function AddressLink({ address, href, full }: AddressLinkProps) {
  const [copiada, setCopiada] = useState(false);

  const copiar = async (e: MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(address);
      setCopiada(true);
      setTimeout(() => setCopiada(false), 1500);
    } catch {
      // Sin permiso de portapapeles: la direccion sigue visible para copiarla a mano.
    }
  };

  const texto = full ? address : shortAddr(address, 6, 6);
  return (
    <span className="address">
      {href ? (
        <a href={href} target="_blank" rel="noopener noreferrer" className="break" title={address} onClick={(e) => e.stopPropagation()}>
          {texto} <ExternalLink size={12} style={{ display: 'inline', verticalAlign: '-1px' }} />
        </a>
      ) : (
        <span className="break" title={address}>
          {texto}
        </span>
      )}
      <button
        className="btn btn--ghost btn--icon btn--sm"
        style={{ width: 24, height: 24 }}
        onClick={copiar}
        aria-label={copiada ? 'Copiada' : 'Copiar direccion'}
        title={copiada ? 'Copiada' : 'Copiar direccion'}
      >
        {copiada ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </span>
  );
}
