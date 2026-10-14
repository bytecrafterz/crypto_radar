import { lazy } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError } from './api/client';
import { AuthProvider, RequireAuth } from './auth';
import { AppShell } from './components/layout/AppShell';
import { Login } from './pages/Login';

// Cada pagina se descarga la primera vez que se abre, no todas al entrar.
const Resumen = lazy(() => import('./pages/Resumen'));
const Tokens = lazy(() => import('./pages/Tokens'));
const TokenDetalle = lazy(() => import('./pages/TokenDetalle'));
const Alertas = lazy(() => import('./pages/Alertas'));
const Resultados = lazy(() => import('./pages/Resultados'));
const Telegram = lazy(() => import('./pages/Telegram'));
const Convergencia = lazy(() => import('./pages/Convergencia'));
const Sistema = lazy(() => import('./pages/Sistema'));
const NoEncontrada = lazy(() => import('./pages/NoEncontrada'));

const qc = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
      // Un 401 o un 404 no se arreglan reintentando.
      retry: (n, err) => !(err instanceof ApiError && [401, 403, 404].includes(err.status)) && n < 2,
    },
  },
});

export function App() {
  return (
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/entrar" element={<Login />} />
            <Route
              element={
                <RequireAuth>
                  <AppShell />
                </RequireAuth>
              }
            >
              <Route index element={<Resumen />} />
              <Route path="tokens" element={<Tokens />} />
              <Route path="token/:chain/:address" element={<TokenDetalle />} />
              <Route path="alertas" element={<Alertas />} />
              <Route path="resultados" element={<Resultados />} />
              <Route path="telegram" element={<Telegram />} />
              <Route path="convergencia" element={<Convergencia />} />
              <Route path="sistema" element={<Sistema />} />
              <Route path="*" element={<NoEncontrada />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
