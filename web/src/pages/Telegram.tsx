import { useNavigate } from 'react-router-dom';
import { Hash, Languages, MessagesSquare, Radio, Trash2 } from 'lucide-react';
import { useApi, useFiltrosUrl } from '../api/hooks';
import { conParams } from '../api/client';
import type { ListaDescubiertos, ListaFuentes, ListaMenciones, ListaMensajes, TelegramResumen } from '../api/types';
import { PageHeader } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { StatTile } from '../components/ui/StatTile';
import { DataTable } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { Segmented } from '../components/ui/Segmented';
import { Badge } from '../components/ui/Badge';
import { Disclosure } from '../components/ui/Disclosure';
import { TokenCell, rutaToken } from '../components/domain/TokenCell';
import { LevelBadge, MessageClassBadge } from '../components/domain/Badges';
import { Anticipation } from '../components/domain/Anticipation';
import { fmtDate, fmtNum, timeAgo } from '../lib/format';
import { ESTADOS_CANAL } from '../lib/labels';

type Vista = 'menciones' | 'mensajes' | 'fuentes' | 'canales';
const CLAVES = ['vista', 'clase', 'estado'] as const;

/** Paginacion comun de las cuatro listas. */
function Paginas({ total, page, size, loading, cambiar }: {
  total: number; page: number; size: number; loading: boolean;
  cambiar: (c: Partial<Record<'page' | 'size', string>>) => void;
}) {
  if (total === 0) return null;
  return (
    <Pagination
      page={page}
      size={size}
      total={total}
      loading={loading}
      onPage={(p) => cambiar({ page: String(p) })}
      onSize={(s) => cambiar({ size: String(s) })}
    />
  );
}

export default function Telegram() {
  const navegar = useNavigate();
  const { valores, cambiar, page } = useFiltrosUrl(CLAVES, { vista: 'menciones', size: '20' });
  const vista = (valores.vista || 'menciones') as Vista;
  const size = Number(valores.size) || 20;

  const resumen = useApi<TelegramResumen>('/api/panel/telegram', { refrescoMs: 60_000 });
  const r = resumen.data;

  // Cada pestana pide sus datos solo cuando se abre.
  const menciones = useApi<ListaMenciones>(vista === 'menciones' ? conParams('/api/panel/telegram/menciones', { page, size }) : null, { mantenerAnterior: true });
  const mensajes = useApi<ListaMensajes>(vista === 'mensajes' ? conParams('/api/panel/telegram/mensajes', { page, size, clase: valores.clase }) : null, { mantenerAnterior: true });
  const fuentes = useApi<ListaFuentes>(vista === 'fuentes' ? conParams('/api/panel/telegram/fuentes', { page, size, estado: valores.estado }) : null, { mantenerAnterior: true });
  const canales = useApi<ListaDescubiertos>(vista === 'canales' ? conParams('/api/panel/telegram/descubiertos', { page, size, estado: valores.estado }) : null, { mantenerAnterior: true });

  const idiomas = r?.idiomas;
  const mezcla = idiomas && idiomas.muestra > 0 ? `ES ${idiomas.es}% · PT ${idiomas.pt}% · EN ${idiomas.en}%` : 'sin datos aun';

  return (
    <>
      <PageHeader title="Telegram" sub="Lo que esta leyendo el Robot 2 y lo que ha sacado en claro, resumido en espanol." />

      <div className="grid grid--stats">
        <StatTile loading={!r} icon={<Radio />} label="Canales" value={fmtNum(r?.canales)} hint="se leen ahora" />
        <StatTile loading={!r} icon={<MessagesSquare />} label="Mensajes" value={fmtNum(r?.mensajes)} hint="guardados en bruto" />
        <StatTile loading={!r} icon={<Trash2 />} label="Ruido filtrado" value={`${r?.pctDescarte ?? 0}%`} hint="descartado por el primer filtro" />
        <StatTile loading={!r} icon={<Hash />} label="Tokens" value={fmtNum(r?.tokens)} hint="identificados" />
        <StatTile loading={!r} icon={<Languages />} label="Idiomas" value={<span style={{ fontSize: 17 }}>{mezcla}</span>} hint="de lo que informa, 7 dias" />
      </div>

      <div className="row" style={{ margin: '24px 0 16px', justifyContent: 'space-between' }}>
        <Segmented<Vista>
          label="Vista"
          value={vista}
          onChange={(v) => cambiar({ vista: v, clase: '', estado: '' })}
          options={[
            { value: 'menciones', label: 'Tokens mencionados', count: r?.menciones },
            { value: 'mensajes', label: 'Mensajes', count: r?.candidatos },
            { value: 'fuentes', label: 'Fuentes' },
            { value: 'canales', label: 'Canales encontrados', count: r ? Object.values(r.descubiertos).reduce((a, n) => a + n, 0) : undefined },
          ]}
        />

        {vista === 'mensajes' && (
          <Segmented
            label="Clase"
            value={valores.clase || 'todas'}
            onChange={(v) => cambiar({ clase: v === 'todas' ? '' : v })}
            options={[
              { value: 'todas', label: 'Todas' },
              { value: 'informacion', label: 'Informacion' },
              { value: 'promocion', label: 'Promocion' },
              { value: 'hype', label: 'Hype' },
              { value: 'sin_clasificar', label: 'Sin clasificar' },
            ]}
          />
        )}
        {vista === 'fuentes' && (
          <Segmented
            label="Estado"
            value={valores.estado || 'todos'}
            onChange={(v) => cambiar({ estado: v === 'todos' ? '' : v })}
            options={[
              { value: 'todos', label: 'Todos' },
              { value: 'activos', label: 'Se leen' },
            ]}
          />
        )}
        {vista === 'canales' && (
          <Segmented
            label="Estado"
            value={valores.estado || 'todos'}
            onChange={(v) => cambiar({ estado: v === 'todos' ? '' : v })}
            options={[
              { value: 'todos', label: 'Todos' },
              ...Object.entries(ESTADOS_CANAL).map(([k, e]) => ({ value: k, label: e.texto, count: r?.descubiertos[k] ?? 0 })),
            ]}
          />
        )}
      </div>

      {vista === 'menciones' && (
        <Card flush title="Tokens detectados en Telegram" sub="Cada mencion con lo que dice el mensaje y si se adelanto al movimiento del precio.">
          <DataTable<ListaMenciones['items'][number]>
            columns={[
              {
                key: 'token',
                header: 'Token',
                cell: (m) => (
                  <div className="stack" style={{ gap: 6 }}>
                    <div className="row">
                      <TokenCell chain={m.chain} address={m.address} symbol={m.symbol} />
                      {m.esPrimera && <Badge tono="info">1.ª vez</Badge>}
                      {m.nivel && <LevelBadge nivel={m.nivel} />}
                    </div>
                    {m.resumen && <span className="small muted">{m.resumen}</span>}
                  </div>
                ),
              },
              { key: 'canal', header: 'Canal', cell: (m) => <span className="small">{m.canal}</span>, hideOnMobile: true },
              { key: 'como', header: 'Como', cell: (m) => <Badge>{m.resueltoPor}</Badge>, hideOnMobile: true },
              { key: 'ant', header: 'Anticipacion', cell: (m) => <Anticipation seg={m.anticipacionSeg} veredicto={m.veredicto} /> },
              { key: 'op', header: 'Oport.', align: 'right', cell: (m) => m.opportunity ?? '–', hideOnMobile: true },
              { key: 'rk', header: 'Riesgo', align: 'right', cell: (m) => m.risk ?? '–', hideOnMobile: true },
              { key: 'cuando', header: 'Cuando', cell: (m) => <span className="dim small nowrap">{timeAgo(m.postedAt)}</span> },
            ]}
            rows={menciones.data?.items}
            rowKey={(m, i) => `${m.chain}:${m.address}:${m.postedAt}:${i}`}
            loading={menciones.isPending}
            refetching={menciones.isPlaceholderData}
            error={menciones.error}
            onRetry={() => void menciones.refetch()}
            onRowClick={(m) => navegar(rutaToken(m.chain, m.address))}
            empty={{ title: 'Todavia no se ha identificado ningun token' }}
          />
          <Paginas total={menciones.data?.total ?? 0} page={page} size={size} loading={menciones.isPlaceholderData} cambiar={cambiar} />
        </Card>
      )}

      {vista === 'mensajes' && (
        <Card flush title="Mensajes con algo que decir" sub="Los que pasaron el primer filtro, resumidos en espanol. El original, en su idioma, esta plegado debajo.">
          <DataTable<ListaMensajes['items'][number]>
            columns={[
              {
                key: 'msg',
                header: 'Mensaje',
                cell: (m) => (
                  <div className="stack" style={{ gap: 6, maxWidth: 760 }}>
                    <div className="row">
                      <MessageClassBadge clase={m.clase} />
                      {m.idioma && <Badge>{m.idioma.toUpperCase()}</Badge>}
                      <span className="dim small">{m.canal}</span>
                    </div>
                    {m.resumen && <span>{m.resumen}</span>}
                    {m.motivo && <span className="dim small">{m.motivo}</span>}
                    <Disclosure summary="Mensaje original">{m.texto}</Disclosure>
                  </div>
                ),
              },
              { key: 'cuando', header: 'Fecha', cell: (m) => <span className="dim small nowrap">{fmtDate(m.postedAt)}</span>, hideOnMobile: true },
            ]}
            rows={mensajes.data?.items}
            rowKey={(m) => m.id}
            loading={mensajes.isPending}
            refetching={mensajes.isPlaceholderData}
            error={mensajes.error}
            onRetry={() => void mensajes.refetch()}
            empty={{ title: 'Sin mensajes de esta clase' }}
          />
          <Paginas total={mensajes.data?.total ?? 0} page={page} size={size} loading={mensajes.isPlaceholderData} cambiar={cambiar} />
        </Card>
      )}

      {vista === 'fuentes' && (
        <Card
          flush
          title="Fuentes"
          sub="Reputacion de cada canal = de sus menciones que se pudieron medir, el porcentaje que aparecio antes de que el precio subiera un 25 % en las 24 horas siguientes. Es la reputacion que usa el Robot 3 (media de los canales que hablan de un token, minimo 50 para Convergencia fuerte). Se calcula sola con resultados reales: src/telegram/anticipacion.ts."
        >
          <DataTable<ListaFuentes['items'][number]>
            columns={[
              {
                key: 'canal',
                header: 'Canal',
                cell: (f) => (
                  <div className="row">
                    <b>{f.title ?? f.username ?? 'sin nombre'}</b>
                    {!f.active && <Badge>ya no se lee</Badge>}
                  </div>
                ),
              },
              { key: 'm', header: 'Mensajes', align: 'right', cell: (f) => fmtNum(f.mensajes), hideOnMobile: true },
              { key: 'me', header: 'Menciones', align: 'right', cell: (f) => fmtNum(f.menciones) },
              { key: 'p', header: 'Primero', align: 'right', cell: (f) => fmtNum(f.primeras), hideOnMobile: true },
              {
                key: 'a',
                header: 'Se adelanto',
                align: 'right',
                cell: (f) => (
                  <span>
                    {fmtNum(f.adelantadas)}
                    <span className="dim small"> de {fmtNum(f.medibles)}</span>
                  </span>
                ),
              },
              {
                key: 'ac',
                header: 'Reputacion',
                align: 'right',
                cell: (f) =>
                  f.acierto === null ? (
                    <span className="dim">sin datos</span>
                  ) : (
                    <Badge tono={f.acierto >= 50 ? 'good' : f.acierto >= 25 ? 'warning' : 'critical'}>{f.acierto}%</Badge>
                  ),
              },
            ]}
            rows={fuentes.data?.items}
            rowKey={(f, i) => `${f.username ?? f.title}:${i}`}
            loading={fuentes.isPending}
            refetching={fuentes.isPlaceholderData}
            error={fuentes.error}
            onRetry={() => void fuentes.refetch()}
            empty={{ title: 'Ningun canal vigilado todavia' }}
          />
          <Paginas total={fuentes.data?.total ?? 0} page={page} size={size} loading={fuentes.isPlaceholderData} cambiar={cambiar} />
        </Card>
      )}

      {vista === 'canales' && (
        <Card
          flush
          title="Canales encontrados por el propio sistema"
          sub="Busca sus fuentes en tres idiomas, por enlaces y reenvios; entra como mucho en tres al dia y sale de los que no aportan."
        >
          <DataTable<ListaDescubiertos['items'][number]>
            columns={[
              {
                key: 'c',
                header: 'Canal',
                cell: (d) => (
                  <div>
                    <a href={`https://t.me/${encodeURIComponent(d.username)}`} target="_blank" rel="noopener noreferrer" className="strong">
                      @{d.username}
                    </a>
                    {d.title && <div className="dim small truncate" style={{ maxWidth: 280 }}>{d.title}</div>}
                  </div>
                ),
              },
              { key: 'm', header: 'Miembros', align: 'right', cell: (d) => fmtNum(d.miembros), hideOnMobile: true },
              { key: 's', header: 'Nota', align: 'right', cell: (d) => d.score ?? '–' },
              {
                key: 'p',
                header: 'Como se encontro',
                cell: (d) => (
                  <div>
                    <span className="small">{d.descubiertoPor}</span>
                    {d.motivo && <div className="dim small truncate" style={{ maxWidth: 300 }}>{d.motivo}</div>}
                  </div>
                ),
                hideOnMobile: true,
              },
              {
                key: 'e',
                header: 'Estado',
                cell: (d) => {
                  const e = ESTADOS_CANAL[d.estado] ?? { texto: d.estado, tono: 'neutral' as const };
                  return <Badge tono={e.tono} dot>{e.texto}</Badge>;
                },
              },
            ]}
            rows={canales.data?.items}
            rowKey={(d) => d.username}
            loading={canales.isPending}
            refetching={canales.isPlaceholderData}
            error={canales.error}
            onRetry={() => void canales.refetch()}
            empty={{ title: 'Ningun canal en este estado' }}
          />
          <Paginas total={canales.data?.total ?? 0} page={page} size={size} loading={canales.isPlaceholderData} cambiar={cambiar} />
        </Card>
      )}
    </>
  );
}
