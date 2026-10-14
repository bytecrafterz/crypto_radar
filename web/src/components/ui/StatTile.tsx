import type { ReactNode } from 'react';
import { Skeleton } from './Skeleton';

interface StatTileProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  loading?: boolean;
}

/** Una cifra con su etiqueta y una pista debajo. */
export function StatTile({ label, value, hint, icon, loading }: StatTileProps) {
  return (
    <div className="card stat">
      <div className="stat__label">
        {icon && <span className="stat__icon">{icon}</span>}
        {label}
      </div>
      {loading ? (
        <>
          <Skeleton width="60%" height={28} />
          <Skeleton width="40%" height={12} />
        </>
      ) : (
        <>
          <div className="stat__value">{value}</div>
          {hint && <div className="stat__hint">{hint}</div>}
        </>
      )}
    </div>
  );
}
