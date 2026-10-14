import type { ReactNode } from 'react';

/** Lista de pares etiqueta / valor, alineados en dos columnas. */
export function KeyValue({ items }: { items: Array<[ReactNode, ReactNode] | false | null | undefined> }) {
  return (
    <dl className="kv">
      {items
        .filter((x): x is [ReactNode, ReactNode] => Array.isArray(x))
        .map(([k, v], i) => (
          <div key={i} style={{ display: 'contents' }}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}
