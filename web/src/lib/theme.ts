/**
 * Tema claro u oscuro. Lo elegido se recuerda en este navegador; si no se
 * elige nada, se sigue el del sistema (index.html lo aplica antes de pintar).
 */
import { useCallback, useState } from 'react';

export type Tema = 'light' | 'dark';
const CLAVE = 'radar-tema';

function actual(): Tema {
  return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
}

export function useTema(): [Tema, () => void] {
  const [tema, setTema] = useState<Tema>(actual);

  const alternar = useCallback(() => {
    const nuevo: Tema = actual() === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', nuevo);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', nuevo === 'light' ? '#f5f6f8' : '#0b0e13');
    try {
      localStorage.setItem(CLAVE, nuevo);
    } catch {
      // Navegacion privada o almacenamiento bloqueado: el tema vale para esta visita.
    }
    setTema(nuevo);
  }, []);

  return [tema, alternar];
}
