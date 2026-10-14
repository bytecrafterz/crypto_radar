import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';

/** Contenido plegado que se abre al pulsar (por ejemplo, el mensaje original). */
export function Disclosure({ summary, children }: { summary: ReactNode; children: ReactNode }) {
  return (
    <details className="disclosure">
      <summary>
        <ChevronRight />
        {summary}
      </summary>
      <div className="disclosure__body">{children}</div>
    </details>
  );
}
