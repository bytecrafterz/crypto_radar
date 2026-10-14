import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { anticipacion } from '../../lib/format';

/**
 * Cuanto se adelanto (o se retraso) una mencion respecto al movimiento del
 * precio. Va con flecha ademas de color.
 */
export function Anticipation({ seg, veredicto }: { seg: number | null; veredicto?: string | null }) {
  const a = anticipacion(seg, veredicto);
  const clase = a.tono === 'good' ? 'text-good' : a.tono === 'critical' ? 'text-critical' : 'dim';
  const Icono = a.tono === 'good' ? ArrowUpRight : a.tono === 'critical' ? ArrowDownRight : Minus;
  return (
    <span className={`row nowrap ${clase}`} style={{ gap: 4 }}>
      <Icono size={14} aria-hidden="true" />
      {a.texto}
    </span>
  );
}
