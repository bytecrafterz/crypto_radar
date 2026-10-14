/**
 * Ganchos para pedir datos.
 *
 * Mientras se cambia de pagina en una tabla se sigue viendo la anterior
 * atenuada (keepPreviousData): nada salta ni parpadea.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from './client';

export function useApi<T>(
  url: string | null,
  opciones: { refrescoMs?: number; mantenerAnterior?: boolean } = {},
) {
  return useQuery<T, ApiError>({
    queryKey: [url],
    queryFn: () => api.get<T>(url as string),
    enabled: url !== null,
    refetchInterval: opciones.refrescoMs,
    placeholderData: opciones.mantenerAnterior ? keepPreviousData : undefined,
  });
}

/**
 * Filtros y pagina guardados en la direccion (?page=2&chain=base).
 *
 * Asi una vista filtrada se puede compartir o guardar, y el boton de
 * volver del navegador deshace el ultimo cambio de filtro.
 */
export function useFiltrosUrl<K extends string>(
  claves: readonly K[],
  porDefecto: Partial<Record<K | 'page' | 'size', string>> = {},
) {
  const [params, setParams] = useSearchParams();

  const valores = useMemo(() => {
    const v = {} as Record<K | 'page' | 'size', string>;
    for (const k of [...claves, 'page', 'size'] as Array<K | 'page' | 'size'>) {
      v[k] = params.get(k) ?? porDefecto[k] ?? '';
    }
    return v;
  }, [params]);

  /** Cambia filtros; cualquier cambio que no sea de pagina vuelve a la pagina 1. */
  const cambiar = useCallback(
    (cambios: Partial<Record<K | 'page' | 'size', string>>) => {
      setParams(
        (prev) => {
          const sig = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(cambios) as Array<[string, string | undefined]>) {
            if (v === undefined || v === '' || v === porDefecto[k as K]) sig.delete(k);
            else sig.set(k, v);
          }
          if (!('page' in cambios)) sig.delete('page');
          return sig;
        },
        { replace: false },
      );
    },
    [setParams],
  );

  const page = Math.max(1, Number(valores.page) || 1);
  return { valores, cambiar, page };
}
