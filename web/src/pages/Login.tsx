import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { Eye, EyeOff, LogIn } from 'lucide-react';
import { useSesion } from '../auth';
import { Logo } from '../components/layout/Logo';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';

export function Login() {
  const { estado, entrar } = useSesion();
  const navegar = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [ver, setVer] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  // Solo rutas del propio panel: un ?volver= hacia fuera no se sigue.
  const volver = params.get('volver');
  const destino = volver && volver.startsWith('/') && !volver.startsWith('//') ? volver : '/';

  useEffect(() => {
    document.title = 'Acceso · Crypto Radar';
  }, []);

  if (estado === 'dentro') return <Navigate to={destino} replace />;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setEnviando(true);
    try {
      await entrar(password);
      navegar(destino, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo entrar.');
      setEnviando(false);
    }
  };

  return (
    <div className="login">
      <div className="card login__card">
        <div className="login__brand">
          <Logo size={30} />
          <span style={{ color: 'var(--text)' }}>
            Crypto <span>Radar</span>
          </span>
        </div>
        <p className="login__sub">Introduce la contrasena del panel para continuar.</p>

        <form onSubmit={enviar} className="stack" style={{ gap: 14 }}>
          {error && <Callout tone="danger">{error}</Callout>}
          <label className="field">
            <span className="field__label">Contrasena</span>
            <span className="password">
              <input
                className="input"
                type={ver ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                autoFocus
                required
              />
              <Button
                variant="ghost"
                iconOnly
                size="sm"
                icon={ver ? <EyeOff /> : <Eye />}
                onClick={() => setVer((v) => !v)}
                aria-label={ver ? 'Ocultar contrasena' : 'Mostrar contrasena'}
              />
            </span>
          </label>
          <Button type="submit" variant="primary" block loading={enviando} icon={<LogIn />}>
            Entrar
          </Button>
        </form>
      </div>
    </div>
  );
}
