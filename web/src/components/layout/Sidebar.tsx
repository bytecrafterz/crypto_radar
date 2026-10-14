import { NavLink } from 'react-router-dom';
import { Bell, Coins, GitMerge, LayoutDashboard, Send, Settings2, TrendingUp } from 'lucide-react';
import type { ReactNode } from 'react';
import { Logo } from './Logo';

const SECCIONES: Array<{ titulo: string; items: Array<{ to: string; label: string; icon: ReactNode }> }> = [
  {
    titulo: 'Radar',
    items: [
      { to: '/', label: 'Resumen', icon: <LayoutDashboard /> },
      { to: '/tokens', label: 'Tokens', icon: <Coins /> },
      { to: '/alertas', label: 'Alertas', icon: <Bell /> },
      { to: '/resultados', label: 'Resultados', icon: <TrendingUp /> },
    ],
  },
  {
    titulo: 'Inteligencia',
    items: [
      { to: '/telegram', label: 'Telegram', icon: <Send /> },
      { to: '/convergencia', label: 'Convergencia', icon: <GitMerge /> },
    ],
  },
  {
    titulo: 'Administracion',
    items: [{ to: '/sistema', label: 'Sistema', icon: <Settings2 /> }],
  },
];

export function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Navegacion principal">
      <div className="sidebar__brand">
        <Logo size={26} />
        <span style={{ color: 'var(--text)' }}>
          Crypto <span>Radar</span>
        </span>
      </div>
      <nav className="sidebar__nav">
        {SECCIONES.map((s) => (
          <div key={s.titulo}>
            <div className="sidebar__section">{s.titulo}</div>
            {s.items.map((i) => (
              <NavLink key={i.to} to={i.to} end={i.to === '/'} className={({ isActive }) => `nav-item ${isActive ? 'is-active' : ''}`}>
                {i.icon}
                {i.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="sidebar__foot">
        Herramienta de deteccion y analisis. Lo que muestra no es una recomendacion de compra ni de venta: la decision
        siempre es tuya.
      </div>
    </aside>
  );
}
