import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { useIsFetching } from '@tanstack/react-query';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { PageLoader, TopProgress } from '../ui/Spinner';

/**
 * Esqueleto de todas las paginas con sesion. Las paginas se cargan bajo
 * demanda: mientras llega el codigo de una, se ve el indicador de carga
 * dentro del esqueleto, sin perder la barra lateral.
 */
export function AppShell() {
  const [cajon, setCajon] = useState(false);
  const loc = useLocation();
  // Solo lo que el usuario esta esperando: lo que aun no tiene datos (una
  // pagina nueva de una tabla, una ficha). Los refrescos de fondo no cuentan.
  const cargando = useIsFetching({ predicate: (q) => q.state.data === undefined });

  // Al cambiar de pagina se cierra el menu del movil y se vuelve arriba.
  useEffect(() => {
    setCajon(false);
    window.scrollTo({ top: 0 });
  }, [loc.pathname]);

  return (
    <div className={`app ${cajon ? 'is-drawer-open' : ''}`}>
      {cargando > 0 && <TopProgress />}
      <Sidebar />
      <div className="drawer-backdrop" onClick={() => setCajon(false)} aria-hidden="true" />
      <div className="main">
        <Topbar onMenu={() => setCajon(true)} />
        <main className="content">
          <Suspense fallback={<PageLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
