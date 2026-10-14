import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Activity, Bell } from 'lucide-react';
import { useApi } from '../api/hooks';
import type { Resumen as DatosResumen, ResumenRobot, TokenFila } from '../api/types';
import { PageHeader, Section } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Meter } from '../components/ui/Meter';
import { Segmented } from '../components/ui/Segmented';
import { EmptyState, ErrorState } from '../components/ui/States';
import { SkeletonText } from '../components/ui/Skeleton';
import { Badge } from '../components/ui/Badge';
import { ChartCard } from '../components/charts/ChartCard';
import { TokenCell, rutaToken } from '../components/domain/TokenCell';
import { AlertKindBadge, ChainBadge } from '../components/domain/Badges';
import { RobotCard, RobotCardSkeleton } from '../components/domain/RobotCard';
import { fmtNum, fmtUsd, timeAgo } from '../lib/format';
import { NIVEL_LOG } from '../lib/labels';

const columnasTop: Array<Column<TokenFila>> = [
  { key: 'token', header: 'Token', cell: (t) => <TokenCell chain={t.chain} address={t.address} symbol={t.symbol} name={t.name} /> },
  { key: 'chain', header: 'Cadena', cell: (t) => <ChainBadge chain={t.chain} />, hideOnMobile: true },
  { key: 'op', header: 'Oportunidad', cell: (t) => <Meter value={t.opportunity} /> },
  { key: 'risk', header: 'Riesgo', cell: (t) => <Meter value={t.risk} kind="risk" /> },
  { key: 'liq', header: 'Liquidez', align: 'right', cell: (t) => fmtUsd(t.liquidity), hideOnMobile: true },
  { key: 'mc', header: 'Capitalizacion', align: 'right', cell: (t) => fmtUsd(t.marketCap), hideOnMobile: true },
  { key: 'edad', header: 'Detectado', cell: (t) => <span className="dim nowrap">{timeAgo(t.firstSeen)}</span>, hideOnMobile: true },
];

export default function Resumen() {
  const navegar = useNavigate();
  const q = useApi<DatosResumen>('/api/panel/resumen', { refrescoMs: 60_000 });
  const robots = useApi<ResumenRobot[]>('/api/panel/robots', { refrescoMs: 60_000 });
  const [serie, setSerie] = useState<'detectados' | 'analizados'>('detectados');
  const d = q.data;

  return (
    <>
      <PageHeader title="Resumen" sub="Estado de los tres robots en tiempo real. Se actualiza solo cada minuto." />

      {q.error && !d ? (
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      ) : (
        <>
          <Section
            title="Los 3 robots"
            sub="Si cada robot esta funcionando y lo que ha sacado hoy. Cada tarjeta lleva a su pagina con todo el detalle."
          >
            {robots.error && !robots.data ? (
              <Card>
                <ErrorState error={robots.error} onRetry={() => void robots.refetch()} />
              </Card>
            ) : (
              <div className="grid grid--3">
                {robots.data
                  ? robots.data.map((r) => <RobotCard key={r.id} robot={r} />)
                  : [0, 1, 2].map((i) => <RobotCardSkeleton key={i} />)}
              </div>
            )}
          </Section>

          <div style={{ marginTop: 16 }}>
            <ChartCard
              title={serie === 'detectados' ? 'Tokens detectados por hora' : 'Tokens analizados por hora'}
              sub="Ultimas 24 horas completas"
              height={190}
              desdeCero
              format={(v) => fmtNum(v)}
              points={(d?.porHora ?? []).map((h) => ({ ts: h.ts, value: serie === 'detectados' ? h.detectados : h.analizados }))}
              extra={
                <Segmented
                  label="Serie"
                  value={serie}
                  onChange={setSerie}
                  options={[
                    { value: 'detectados', label: 'Detectados' },
                    { value: 'analizados', label: 'Analizados' },
                  ]}
                />
              }
            />
          </div>

          <Section
            title="Mejores oportunidades"
            sub="Los 10 tokens con mejor nota de las ultimas 24 horas que siguen en juego."
            actions={<Link to="/tokens">Ver todos</Link>}
          >
            <Card flush>
              <DataTable
                columns={columnasTop}
                rows={d?.top}
                rowKey={(t) => `${t.chain}:${t.address}`}
                loading={q.isPending}
                error={q.error}
                onRetry={() => void q.refetch()}
                onRowClick={(t) => navegar(rutaToken(t.chain, t.address))}
                skeletonRows={6}
                empty={{ title: 'Ningun token destacado en las ultimas 24 horas', text: 'Los que pasen de 40 de oportunidad apareceran aqui.' }}
              />
            </Card>
          </Section>

          <div className="grid grid--2 section">
            <Card title="Ultimas alertas" actions={<Link to="/alertas" className="small">Ver todas</Link>} flush>
              {!d ? (
                <div className="card__body">
                  <SkeletonText lines={6} />
                </div>
              ) : d.alertas.length === 0 ? (
                <EmptyState compact icon={<Bell />} title="Aun no se ha enviado ninguna alerta" />
              ) : (
                <ul className="feed">
                  {d.alertas.map((a) => (
                    <li key={a.id} className="feed__item">
                      <div className="feed__main">
                        <div className="row">
                          <AlertKindBadge kind={a.kind} />
                          <Link to={rutaToken(a.chain, a.address)} className="strong" style={{ color: 'var(--text)' }}>
                            {a.symbol ?? '???'}
                          </Link>
                          {!a.sentOk && <Badge tono="warning">no entregada</Badge>}
                        </div>
                        <div className="feed__meta">
                          Oportunidad {a.opportunity ?? '–'} · Riesgo {a.risk ?? '–'}
                        </div>
                      </div>
                      <span className="feed__meta nowrap">{timeAgo(a.ts)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title="Actividad del sistema" actions={<Link to="/sistema" className="small">Ver registro</Link>} flush>
              {!d ? (
                <div className="card__body">
                  <SkeletonText lines={6} />
                </div>
              ) : d.actividad.length === 0 ? (
                <EmptyState compact icon={<Activity />} title="Sin actividad registrada" />
              ) : (
                <ul className="feed">
                  {d.actividad.map((a, i) => (
                    <li key={i} className="feed__item">
                      <div className="feed__main">
                        <div className="row" style={{ alignItems: 'flex-start', flexWrap: 'nowrap' }}>
                          <Badge tono={NIVEL_LOG[a.level] ?? 'neutral'}>{a.area}</Badge>
                          <span className="small break">{a.message}</span>
                        </div>
                      </div>
                      <span className="feed__meta nowrap">{timeAgo(a.ts)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </>
      )}
    </>
  );
}
