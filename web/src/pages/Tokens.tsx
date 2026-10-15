import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { RotateCcw } from 'lucide-react';
import { useApi, useFiltrosUrl } from '../api/hooks';
import { conParams } from '../api/client';
import type { ListaTokens, TokenFila } from '../api/types';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { DataTable, type Column } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { Field, Input, Select } from '../components/ui/Field';
import { Button } from '../components/ui/Button';
import { Meter } from '../components/ui/Meter';
import { TokenCell, rutaToken } from '../components/domain/TokenCell';
import { ChainBadge, TokenStatusBadge } from '../components/domain/Badges';
import { fmtDate, fmtNum, fmtUsd } from '../lib/format';

const columnas: Array<Column<TokenFila>> = [
  { key: 'token', header: 'Token', cell: (t) => <TokenCell chain={t.chain} address={t.address} symbol={t.symbol} name={t.name} /> },
  { key: 'chain', header: 'Cadena', cell: (t) => <ChainBadge chain={t.chain} />, hideOnMobile: true },
  { key: 'status', header: 'Estado', cell: (t) => <TokenStatusBadge status={t.status} /> },
  { key: 'op', header: 'Oportunidad', cell: (t) => <Meter value={t.opportunity} /> },
  { key: 'risk', header: 'Riesgo', cell: (t) => <Meter value={t.risk} kind="risk" /> },
  { key: 'liq', header: 'Liquidez', align: 'right', cell: (t) => fmtUsd(t.liquidity), hideOnMobile: true },
  { key: 'mc', header: 'Cap.', align: 'right', cell: (t) => fmtUsd(t.marketCap), hideOnMobile: true },
  { key: 'dex', header: 'DEX', cell: (t) => <span className="dim small">{t.dex ?? '–'}</span>, hideOnMobile: true },
  { key: 'fecha', header: 'Detectado', cell: (t) => <span className="dim small nowrap">{fmtDate(t.firstSeen)}</span>, hideOnMobile: true },
];

const CLAVES = ['q', 'chain', 'status', 'minop', 'maxrisk', 'orden', 'periodo'] as const;

export default function Tokens() {
  const navegar = useNavigate();
  const { valores, cambiar, page } = useFiltrosUrl(CLAVES, { size: '25', orden: 'reciente' });
  const size = Number(valores.size) || 25;

  // El texto de busqueda se aplica al dejar de escribir, no con cada tecla.
  const [texto, setTexto] = useState(valores.q);
  useEffect(() => setTexto(valores.q), [valores.q]);
  useEffect(() => {
    if (texto === valores.q) return;
    const t = setTimeout(() => cambiar({ q: texto }), 350);
    return () => clearTimeout(t);
  }, [texto, valores.q, cambiar]);

  const url = conParams('/api/panel/tokens', { ...valores, page, size });
  const q = useApi<ListaTokens>(url, { mantenerAnterior: true });
  const hayFiltros = CLAVES.some((k) => k !== 'orden' && valores[k]);

  return (
    <>
      <PageHeader
        title="Tokens"
        sub={q.data ? `${fmtNum(q.data.total)} tokens con estos filtros. Todo lo que el radar ha visto, incluido lo descartado.` : 'Todo lo que el radar ha visto.'}
      />

      <div className="filters">
        <Field label="Buscar" grow>
          <Input type="search" placeholder="Simbolo, nombre o direccion" value={texto} onChange={(e) => setTexto(e.target.value)} />
        </Field>
        <Field label="Periodo">
          <Select value={valores.periodo} onChange={(e) => cambiar({ periodo: e.target.value })} options={[['', 'Todo'], ['hoy', 'Analizados hoy']]} />
        </Field>
        <Field label="Cadena">
          <Select value={valores.chain} onChange={(e) => cambiar({ chain: e.target.value })} options={[['', 'Todas'], ['solana', 'Solana'], ['base', 'Base']]} />
        </Field>
        <Field label="Estado">
          <Select
            value={valores.status}
            onChange={(e) => cambiar({ status: e.target.value })}
            options={[['', 'Todos'], ['nuevo', 'Nuevo'], ['vigilado', 'Vigilado'], ['alertado', 'Alertado'], ['peligro', 'Peligro'], ['descartado', 'Descartado'], ['archivado', 'Archivado']]}
          />
        </Field>
        <Field label="Oportunidad min.">
          <Input type="number" min={0} max={100} style={{ width: 110 }} value={valores.minop} onChange={(e) => cambiar({ minop: e.target.value })} />
        </Field>
        <Field label="Riesgo max.">
          <Input type="number" min={0} max={100} style={{ width: 110 }} value={valores.maxrisk} onChange={(e) => cambiar({ maxrisk: e.target.value })} />
        </Field>
        <Field label="Ordenar por">
          <Select
            value={valores.orden}
            onChange={(e) => cambiar({ orden: e.target.value })}
            options={[['reciente', 'Mas reciente'], ['oportunidad', 'Oportunidad'], ['riesgo', 'Riesgo'], ['liquidez', 'Liquidez']]}
          />
        </Field>
        {hayFiltros && (
          <Button variant="ghost" icon={<RotateCcw />} onClick={() => cambiar({ q: '', chain: '', status: '', minop: '', maxrisk: '', orden: '', periodo: '' })}>
            Limpiar
          </Button>
        )}
      </div>

      <Card flush>
        <DataTable
          columns={columnas}
          rows={q.data?.items}
          rowKey={(t) => `${t.chain}:${t.address}`}
          loading={q.isPending}
          refetching={q.isPlaceholderData}
          error={q.error}
          onRetry={() => void q.refetch()}
          onRowClick={(t) => navegar(rutaToken(t.chain, t.address))}
          skeletonRows={10}
          empty={{ title: 'Ningun token coincide con estos filtros', text: 'Prueba a quitar alguno.' }}
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
