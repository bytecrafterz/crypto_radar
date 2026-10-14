import { useEffect, type ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
}

/** Pone el titulo de la pestana del navegador. */
export function useTitulo(title: string) {
  useEffect(() => {
    document.title = `${title} · Crypto Radar`;
  }, [title]);
}

/** Titulo de la pagina; tambien pone el de la pestana del navegador. */
export function PageHeader({ title, sub, actions }: PageHeaderProps) {
  useTitulo(title);

  return (
    <header className="page-header">
      <div style={{ minWidth: 0 }}>
        <h1 className="page-header__title">{title}</h1>
        {sub && <p className="page-header__sub">{sub}</p>}
      </div>
      {actions && <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export function Section({
  title,
  sub,
  actions,
  children,
  id,
}: {
  title: ReactNode;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section className="section" id={id}>
      <div className="section__head">
        <div style={{ minWidth: 0 }}>
          <h2 className="section__title">{title}</h2>
          {sub && <p className="section__sub">{sub}</p>}
        </div>
        {actions && <div className="row">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
