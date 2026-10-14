import type { ReactNode } from 'react';
import { AlertOctagon, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

const ICONOS = {
  info: <Info />,
  warning: <AlertTriangle />,
  danger: <AlertOctagon />,
  good: <CheckCircle2 />,
};

export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: keyof typeof ICONOS;
  title?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={`callout callout--${tone}`} role={tone === 'danger' ? 'alert' : undefined}>
      {ICONOS[tone]}
      <div style={{ minWidth: 0 }}>
        {title && <div className="callout__title">{title}</div>}
        {children}
      </div>
    </div>
  );
}
