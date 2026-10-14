import type { CSSProperties } from 'react';

export function Spinner({ size = 18, label = 'Cargando' }: { size?: number; label?: string }) {
  return <span className="spinner" role="status" aria-label={label} style={{ '--spinner-size': `${size}px` } as CSSProperties} />;
}

/** Mientras llega una pagina entera (al entrar por primera vez en ella). */
export function PageLoader({ text = 'Cargando…' }: { text?: string }) {
  return (
    <div className="page-loader">
      <Spinner size={30} />
      <span>{text}</span>
    </div>
  );
}

/** Barra fina arriba del todo mientras hay datos en camino. */
export function TopProgress() {
  return <div className="topbar-progress" role="progressbar" aria-label="Actualizando datos" />;
}
