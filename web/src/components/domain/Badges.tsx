/**
 * Insignias de las categorias del radar. Cada una con su texto: el color
 * nunca es lo unico que distingue un estado de otro.
 */
import { AlertTriangle, CheckCircle2, Octagon, ShieldAlert } from 'lucide-react';
import { Badge } from '../ui/Badge';
import {
  CLASES_MENSAJE, ESTADOS_TOKEN, NIVELES, RESULTADOS, TIPOS_ALERTA, nivelOportunidad, nivelRiesgo,
} from '../../lib/labels';

export function ChainBadge({ chain }: { chain: string }) {
  return chain === 'solana' ? <Badge tono="violet">Solana</Badge> : <Badge tono="info">Base</Badge>;
}

export function TokenStatusBadge({ status }: { status: string }) {
  const e = ESTADOS_TOKEN[status] ?? { texto: status, tono: 'neutral' as const };
  return (
    <Badge tono={e.tono} dot>
      {e.texto}
    </Badge>
  );
}

export function RiskBadge({ value }: { value: number | null }) {
  const n = nivelRiesgo(value);
  const icono = n.tono === 'critical' ? <Octagon /> : n.tono === 'serious' ? <ShieldAlert /> : n.tono === 'warning' ? <AlertTriangle /> : <CheckCircle2 />;
  return (
    <Badge tono={n.tono} icon={value !== null ? icono : undefined}>
      {value !== null ? `${Math.round(value)} · ${n.texto}` : 'n/d'}
    </Badge>
  );
}

export function OpportunityBadge({ value }: { value: number | null }) {
  const n = nivelOportunidad(value);
  return <Badge tono={n.tono}>{value !== null ? `${Math.round(value)} · ${n.texto}` : 'n/d'}</Badge>;
}

export function LevelBadge({ nivel }: { nivel: string }) {
  const n = NIVELES[nivel] ?? { texto: nivel, tono: 'neutral' as const };
  return (
    <Badge tono={n.tono} dot>
      {n.texto}
    </Badge>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  const r = RESULTADOS[outcome] ?? { texto: outcome, tono: 'neutral' as const };
  return <Badge tono={r.tono}>{r.texto}</Badge>;
}

export function AlertKindBadge({ kind }: { kind: string }) {
  const t = TIPOS_ALERTA[kind] ?? { texto: kind, tono: 'neutral' as const };
  return (
    <Badge tono={t.tono} dot>
      {t.texto}
    </Badge>
  );
}

export function MessageClassBadge({ clase }: { clase: string | null }) {
  if (!clase) return <Badge tono="info">Sin clasificar</Badge>;
  const c = CLASES_MENSAJE[clase] ?? { texto: clase, tono: 'neutral' as const };
  return <Badge tono={c.tono}>{c.texto}</Badge>;
}

/** Verdadero o falso, con el sentido de bueno o malo que tenga cada campo. */
export function BoolBadge({
  value,
  goodWhen,
  labels = ['si', 'no'],
}: {
  value: boolean | null;
  goodWhen: boolean;
  labels?: [string, string];
}) {
  if (value === null) return <Badge>n/d</Badge>;
  const bueno = value === goodWhen;
  return (
    <Badge tono={bueno ? 'good' : 'critical'} icon={bueno ? <CheckCircle2 /> : <Octagon />}>
      {value ? labels[0] : labels[1]}
    </Badge>
  );
}
