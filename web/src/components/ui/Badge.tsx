import type { ReactNode } from 'react';
import type { Tono } from '../../lib/labels';

interface BadgeProps {
  tono?: Tono;
  icon?: ReactNode;
  dot?: boolean;
  title?: string;
  children: ReactNode;
}

export function Badge({ tono = 'neutral', icon, dot, title, children }: BadgeProps) {
  return (
    <span className={`badge badge--${tono} ${dot ? 'badge--dot' : ''}`} title={title}>
      {icon}
      {children}
    </span>
  );
}
