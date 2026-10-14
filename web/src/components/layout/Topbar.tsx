import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BellOff, BellRing, LogOut, Menu, Moon, Search, Sun, TriangleAlert } from 'lucide-react';
import { useApi } from '../../api/hooks';
import type { EstadoPanel } from '../../api/types';
import { useSesion } from '../../auth';
import { useTema } from '../../lib/theme';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const navegar = useNavigate();
  const { salir } = useSesion();
  const [tema, alternarTema] = useTema();
  const [busqueda, setBusqueda] = useState('');
  const estado = useApi<EstadoPanel>('/api/panel/estado', { refrescoMs: 60_000 });

  const buscar = (e: FormEvent) => {
    e.preventDefault();
    const q = busqueda.trim();
    navegar(q ? `/tokens?q=${encodeURIComponent(q)}` : '/tokens');
  };

  const caidas = estado.data?.tareasCaidas ?? [];

  return (
    <header className="topbar">
      <Button className="topbar__menu" variant="ghost" iconOnly icon={<Menu />} onClick={onMenu} aria-label="Abrir el menu" />

      <form className="topbar__search" onSubmit={buscar} role="search">
        <Search />
        <input
          className="input"
          type="search"
          placeholder="Buscar token por simbolo o direccion…"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          aria-label="Buscar token"
        />
      </form>

      <div className="topbar__right">
        {caidas.length > 0 && (
          <Link to="/sistema" title={caidas.join(', ')}>
            <Badge tono="critical" icon={<TriangleAlert />}>
              {caidas.length} robot{caidas.length > 1 ? 's' : ''} parado{caidas.length > 1 ? 's' : ''}
            </Badge>
          </Link>
        )}
        {estado.data && (
          <Link to="/sistema" title="Cambiar en Sistema">
            {estado.data.pausado ? (
              <Badge tono="warning" icon={<BellOff />}>
                Avisos pausados
              </Badge>
            ) : (
              <Badge tono="good" icon={<BellRing />}>
                Avisos activos
              </Badge>
            )}
          </Link>
        )}
        <Button
          variant="ghost"
          iconOnly
          icon={tema === 'light' ? <Moon /> : <Sun />}
          onClick={alternarTema}
          aria-label={tema === 'light' ? 'Tema oscuro' : 'Tema claro'}
          title={tema === 'light' ? 'Tema oscuro' : 'Tema claro'}
        />
        <Button variant="ghost" iconOnly icon={<LogOut />} onClick={() => void salir()} aria-label="Salir" title="Salir" />
      </div>
    </header>
  );
}
