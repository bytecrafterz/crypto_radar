import { EmptyState } from '../ui/States';

/** Motivos de una puntuacion con los puntos que aporta cada uno. */
export function ReasonList({
  items,
  kind,
  empty,
}: {
  items: Array<{ text: string; points: number }>;
  kind: 'good' | 'bad';
  empty: string;
}) {
  if (items.length === 0) return <EmptyState compact title={empty} />;
  return (
    <ul className="reasons">
      {items.map((r, i) => (
        <li key={i}>
          <span className={`reasons__pts ${kind === 'good' ? 'text-good' : 'text-critical'}`}>+{r.points}</span>
          <span>{r.text}</span>
        </li>
      ))}
    </ul>
  );
}
