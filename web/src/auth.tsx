/**
 * Sesion del panel.
 *
 * Al arrancar se pregunta una vez si la cookie sigue valida. Si en algun
 * momento la API responde 401 (la sesion caduco), se vuelve a la pantalla
 * de acceso y, al entrar de nuevo, a la pagina en la que se estaba.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { api, onSesionCaducada } from './api/client';
import { PageLoader } from './components/ui/Spinner';

type Estado = 'comprobando' | 'dentro' | 'fuera';

interface Sesion {
  estado: Estado;
  entrar: (password: string) => Promise<void>;
  salir: () => Promise<void>;
}

const Ctx = createContext<Sesion | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<Estado>('comprobando');
  const navegar = useNavigate();
  const qc = useQueryClient();

  useEffect(() => {
    api
      .get('/api/panel/sesion')
      .then(() => setEstado('dentro'))
      .catch(() => setEstado('fuera'));
  }, []);

  useEffect(
    () =>
      onSesionCaducada(() => {
        setEstado('fuera');
        qc.clear();
      }),
    [qc],
  );

  const entrar = useCallback(async (password: string) => {
    await api.post('/api/panel/sesion', { password });
    setEstado('dentro');
  }, []);

  const salir = useCallback(async () => {
    await api.del('/api/panel/sesion').catch(() => undefined);
    qc.clear();
    setEstado('fuera');
    navegar('/entrar', { replace: true });
  }, [navegar, qc]);

  return <Ctx.Provider value={{ estado, entrar, salir }}>{children}</Ctx.Provider>;
}

export function useSesion(): Sesion {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSesion fuera de AuthProvider');
  return s;
}

/** Envuelve las paginas que necesitan sesion. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { estado } = useSesion();
  const loc = useLocation();
  if (estado === 'comprobando') return <PageLoader text="Comprobando la sesion…" />;
  if (estado === 'fuera') {
    const volver = loc.pathname + loc.search;
    return <Navigate to={`/entrar${volver !== '/' ? `?volver=${encodeURIComponent(volver)}` : ''}`} replace />;
  }
  return <>{children}</>;
}
