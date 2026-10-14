import { useNavigate } from 'react-router-dom';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useApi, useFiltrosUrl } from '../api/hooks';
import { conParams } from '../api/client';
import type { ListaAlertas } from '../api/types';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { DataTable } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { Segmented } from '../components/ui/Segmented';
import { Badge } from '../components/ui/Badge';
import { TokenCell, rutaToken } from '../components/domain/TokenCell';
import { AlertKindBadge, ChainBadge } from '../components/domain/Badges';
import { fmtDate } from '../lib/format';

type Fila = ListaAlertas['items'][number];

export default function Alertas() {
  const navegar = useNavigate();
  const { valores, cambiar, page } = useFiltrosUrl(['tipo'] as const, { size: '25' });
  const size = Number(valores.size) || 25;
  const q = useApi<ListaAlertas>(conParams('/api/panel/alertas', { tipo: valores.tipo, page, size }), { mantenerAnterior: true });
  const pt = q.data?.porTipo ?? {};
  const todas = Object.values(pt).reduce((a, n) => a + n, 0);

  return (
    <>
      <PageHeader title="Alertas" sub="Historico completo de avisos enviados, entregados o no, con el resultado en cada canal." />

      <div style={{ marginBottom: 16 }}>
        <Segmented
          label="Tipo de alerta"
          value={valores.tipo || 'todas'}
          onChange={(v) => cambiar({ tipo: v === 'todas' ? '' : v })}
          options={[
            { value: 'todas', label: 'Todas', count: q.data ? todas : undefined },
            { value: 'oportunidad', label: 'Oportunidad', count: pt.oportunidad },
            { value: 'peligro', label: 'Peligro', count: pt.peligro },
            { value: 'convergencia', label: 'Convergencia', count: pt.convergencia },
          ]}
        />
      </div>

      <Card flush>
        <DataTable<Fila>
          columns={[
            { key: 'fecha', header: 'Fecha', cell: (a) => <span className="dim nowrap">{fmtDate(a.ts)}</span> },
            { key: 'tipo', header: 'Tipo', cell: (a) => <AlertKindBadge kind={a.kind} /> },
            { key: 'token', header: 'Token', cell: (a) => <TokenCell chain={a.chain} address={a.address} symbol={a.symbol} /> },
            { key: 'chain', header: 'Cadena', cell: (a) => <ChainBadge chain={a.chain} />, hideOnMobile: true },
            {
              key: 'notas',
              header: 'Oport. / Riesgo',
              align: 'right',
              cell: (a) => (
                <span className="num">
                  {a.opportunity ?? '–'} / {a.risk ?? '–'}
                </span>
              ),
              hideOnMobile: true,
            },
            {
              key: 'entrega',
              header: 'Entrega',
              cell: (a) =>
                a.canales.length > 0 ? (
                  <span className="row">
                    {a.canales.map((c) => (
                      <Badge key={c.canal} tono={c.ok ? 'good' : 'critical'} icon={c.ok ? <CheckCircle2 /> : <XCircle />} title={c.error ?? undefined}>
                        {c.canal}
                      </Badge>
                    ))}
                  </span>
                ) : (
                  <Badge tono={a.sentOk ? 'good' : 'warning'}>{a.sentOk ? 'entregada' : 'no entregada'}</Badge>
                ),
            },
          ]}
          rows={q.data?.items}
          rowKey={(a) => a.id}
          loading={q.isPending}
          refetching={q.isPlaceholderData}
          error={q.error}
          onRetry={() => void q.refetch()}
          onRowClick={(a) => navegar(rutaToken(a.chain, a.address))}
          skeletonRows={10}
          empty={{ title: 'Aun no se ha enviado ninguna alerta de este tipo' }}
        />
        {q.data && q.data.total > 0 && (
          <Pagination
            page={page}
            size={size}
            total={q.data.total}
            loading={q.isPlaceholderData}
            onPage={(p) => cambiar({ page: String(p) })}
            onSize={(s) => cambiar({ size: String(s) })}
          />
        )}
      </Card>
    </>
  );
}
