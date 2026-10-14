import type { ReactNode } from 'react';
import { AlertTriangle, Inbox, RotateCw } from 'lucide-react';
import { Button } from './Button';

interface EmptyStateProps {
  title: string;
  text?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
}

export function EmptyState({ title, text, icon, action, compact }: EmptyStateProps) {
  return (
    <div className={`empty ${compact ? 'empty--compact' : ''}`}>
      <div className="empty__icon">{icon ?? <Inbox />}</div>
      <div className="empty__title">{title}</div>
      {text && <div className="empty__text">{text}</div>}
      {action}
    </div>
  );
}

/** Cuando una peticion falla: se dice que paso y se ofrece reintentar. */
export function ErrorState({ error, onRetry, compact }: { error: unknown; onRetry?: () => void; compact?: boolean }) {
  const mensaje = error instanceof Error ? error.message : 'Error desconocido';
  return (
    <EmptyState
      compact={compact}
      icon={<AlertTriangle />}
      title="No se han podido cargar los datos"
      text={mensaje}
      action={
        onRetry && (
          <Button size="sm" icon={<RotateCw />} onClick={onRetry} style={{ marginTop: 8 }}>
            Reintentar
          </Button>
        )
      }
    />
  );
}
