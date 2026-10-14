import type { CSSProperties, ReactNode } from 'react';

interface CardProps {
  title?: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  /** Sin margen interior: para tablas y listas que llegan al borde. */
  flush?: boolean;
  /** Color de la franja izquierda (variables CSS de tono). */
  accent?: string;
  className?: string;
  id?: string;
}

export function Card({ title, sub, actions, children, flush, accent, className = '', id }: CardProps) {
  const style = accent ? ({ '--card-accent': accent } as CSSProperties) : undefined;
  return (
    <section id={id} className={`card ${accent ? 'card--accent-left' : ''} ${className}`} style={style}>
      {(title || actions) && (
        <header className="card__head">
          <div style={{ minWidth: 0 }}>
            {title && <h3 className="card__title">{title}</h3>}
            {sub && <p className="card__sub">{sub}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'card__body--flush' : 'card__body'}>{children}</div>
    </section>
  );
}
