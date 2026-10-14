/**
 * Cliente de la API del panel.
 *
 * Si la sesion caduca, cualquier llamada devuelve 401 y la aplicacion
 * vuelve a la pantalla de acceso sin perder la pagina en la que estaba.
 */

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Escucha = () => void;
const alCaducar = new Set<Escucha>();

/** Avisa cuando el servidor dice que no hay sesion. */
export function onSesionCaducada(f: Escucha): () => void {
  alCaducar.add(f);
  return () => alCaducar.delete(f);
}

async function pedir<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'same-origin',
      headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
      ...init,
    });
  } catch {
    throw new ApiError(0, 'No se pudo conectar con el servidor. Comprueba la conexion.');
  }

  if (res.status === 401 && !url.endsWith('/api/panel/sesion')) {
    alCaducar.forEach((f) => f());
  }

  if (!res.ok) {
    const cuerpo = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(res.status, cuerpo?.error ?? `Error ${res.status}`);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(url: string) => pedir<T>(url),
  post: <T>(url: string, body: unknown) => pedir<T>(url, { method: 'POST', body: JSON.stringify(body) }),
  del: <T>(url: string) => pedir<T>(url, { method: 'DELETE' }),
};

/** Construye la URL con los parametros que tienen valor. */
export function conParams(base: string, params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}
