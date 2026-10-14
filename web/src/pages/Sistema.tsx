import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BellOff, BellRing } from 'lucide-react';
import { useApi, useFiltrosUrl } from '../api/hooks';
import { api, conParams } from '../api/client';
import type { ListaActividad, Sistema as DatosSistema } from '../api/types';
import { PageHeader, Section } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { DataTable } from '../components/ui/DataTable';
import { Pagination } from '../components/ui/Pagination';
import { Segmented } from '../components/ui/Segmented';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Callout } from '../components/ui/Callout';
import { KeyValue } from '../components/ui/KeyValue';
import { ErrorState } from '../components/ui/States';
import { SkeletonText } from '../components/ui/Skeleton';
import { fmtDate, fmtDuration, fmtNum, fmtUsd } from '../lib/format';
import { NIVEL_LOG } from '../lib/labels';

export default function Sistema() {
  const qc = useQueryClient();
  const q = useApi<DatosSistema>('/api/panel/sistema', { refrescoMs: 30_000 });
  const { valores, cambiar, page } = useFiltrosUrl(['nivel'] as const, { size: '25' });
  const size = Number(valores.size) || 25;
  const actividad = useApi<ListaActividad>(conParams('/api/panel/actividad', { nivel: valores.nivel, page, size }), {
    mantenerAnterior: true,
  });

  const avisos = useMutation({
    mutationFn: (pausar: boolean) => api.post<{ pausado: boolean }>('/api/panel/avisos', { pausar }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['/api/panel/sistema'] });
      void qc.invalidateQueries({ queryKey: ['/api/panel/estado'] });
    },
  });

  const d = q.data;
  const caidas = d?.tareas.filter((t) => t.caida) ?? [];

  if (q.error && !d) {
    return (
      <>
        <PageHeader title="Sistema" />
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Sistema" sub="Estado de los robots, avisos, configuracion activa y consumo de los servicios externos." />

      <Card
        title="Avisos por Telegram y Discord"
        actions={
          d &&
          (d.pausado ? (
            <Badge tono="warning" icon={<BellOff />}>
              Pausados
            </Badge>
          ) : (
            <Badge tono="good" icon={<BellRing />}>
              Activos
            </Badge>
          ))
        }
      >
        {!d ? (
          <SkeletonText lines={2} />
        ) : (
          <div className="toggle-row">
            <p className="muted" style={{ maxWidth: 640 }}>
              {d.pausado
                ? 'No se esta enviando ningun aviso. El sistema sigue detectando, analizando y guardandolo todo: solo deja de escribirte.'
                : 'Recibes las oportunidades, los avisos de peligro y los de convergencia. Pausar no detiene el analisis.'}
            </p>
            <Button
              variant={d.pausado ? 'primary' : 'danger'}
              icon={d.pausado ? <BellRing /> : <BellOff />}
              loading={avisos.isPending}
              onClick={() => {
                if (!d.pausado && !window.confirm('¿Pausar todos los avisos? El analisis sigue funcionando.')) return;
                avisos.mutate(!d.pausado);
              }}
            >
              {d.pausado ? 'Reanudar los avisos' : 'Pausar los avisos'}
            </Button>
          </div>
        )}
        {avisos.error && (
          <div style={{ marginTop: 12 }}>
            <Callout tone="danger">{avisos.error.message}</Callout>
          </div>
        )}
      </Card>

      <Section
        title="Estado de los robots"
        sub="Cada tarea deja constancia de su ultima vuelta. Si alguna se queda callada mas de lo debido, el sistema avisa en vez de aparentar que funciona."
      >
        {d && (
          <div style={{ marginBottom: 12 }}>
            {caidas.length === 0 ? (
              <Callout tone="good">Todas las tareas estan al dia.</Callout>
            ) : (
              <Callout tone="danger" title={`${caidas.length} tarea(s) sin dar senales`}>
                {caidas.map((c) => c.nombre).join(', ')}
              </Callout>
            )}
          </div>
        )}
        <Card flush>
          <DataTable
            compact
            columns={[
              { key: 'n', header: 'Tarea', cell: (t) => <b className="mono">{t.nombre}</b> },
              {
                key: 'u',
                header: 'Ultima vuelta',
                cell: (t) => (t.calladaMs === null ? <span className="dim">aun no ha dado la primera</span> : `hace ${fmtDuration(t.calladaMs)}`),
              },
              {
                key: 'e',
                header: 'Estado',
                cell: (t) =>
                  t.caida ? (
                    <Badge tono="critical" dot>
                      parada
                    </Badge>
                  ) : t.arrancando ? (
                    <Badge dot>arrancando</Badge>
                  ) : (
                    <Badge tono="good" dot>
                      al dia
                    </Badge>
                  ),
              },
            ]}
            rows={d?.tareas}
            rowKey={(t) => t.nombre}
            loading={q.isPending}
            skeletonRows={8}
          />
        </Card>
      </Section>

      {d && d.avisosConfig.length > 0 && (
        <div className="section">
          <Callout tone="warning" title="Avisos de configuracion">
            <ul>
              {d.avisosConfig.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Callout>
        </div>
      )}

      <div className="grid grid--2 section">
        <Card title="Fuentes en uso">
          {!d ? (
            <SkeletonText lines={6} />
          ) : (
            <>
              <KeyValue
                items={[
                  ['Solana', d.fuentes.solana],
                  ['Base', d.fuentes.base],
                  ['Basescan', d.fuentes.basescan],
                  ['Mercado', d.fuentes.mercado],
                  ['Seguridad', d.fuentes.seguridad],
                  [
                    'Canales de aviso',
                    d.fuentes.canales.length > 0 ? (
                      <span className="row" style={{ justifyContent: 'flex-end' }}>
                        {d.fuentes.canales.map((c) => (
                          <Badge key={c} tono="good">
                            {c}
                          </Badge>
                        ))}
                      </span>
                    ) : (
                      <Badge tono="critical">ninguno</Badge>
                    ),
                  ],
                ]}
              />
              <p className="dim small" style={{ marginTop: 12 }}>
                Los avisos salen por todos los canales a la vez; si uno falla, los demas siguen funcionando.
              </p>
            </>
          )}
        </Card>
        <Card title="Filtros activos">
          {!d ? (
            <SkeletonText lines={8} />
          ) : (
            <>
              <KeyValue
                items={[
                  ['Cadenas', d.filtros.cadenas.join(', ')],
                  ['Deteccion cada', `${d.filtros.deteccionCadaSeg} s`],
                  ['Liquidez', `${fmtUsd(d.filtros.liquidezMin)} – ${fmtUsd(d.filtros.liquidezMax)}`],
                  ['Volumen 24 h min.', fmtUsd(d.filtros.volumen24hMin)],
                  ['Antiguedad max.', `${d.filtros.antiguedadMaxH} h`],
                  ['Analisis por hora', fmtNum(d.filtros.analisisPorHora)],
                  ['Oportunidad min. para avisar', d.filtros.oportunidadMinAlerta],
                  ['Riesgo max. para avisar', d.filtros.riesgoMaxAlerta],
                  ['Riesgo que veta', d.filtros.riesgoVeto],
                ]}
              />
              <p className="dim small" style={{ marginTop: 12 }}>
                Se editan en config/filters.yaml y config/scoring.yaml y se recargan solos en menos de un minuto.
              </p>
            </>
          )}
        </Card>
      </div>

      <Section title="Consumo de servicios" sub="Llamadas de hoy desde el ultimo arranque.">
        <Card flush>
          <DataTable
            compact
            columns={[
              { key: 'p', header: 'Servicio', cell: (u) => <b className="mono">{u.proveedor}</b> },
              { key: 'l', header: 'Llamadas hoy', align: 'right', cell: (u) => fmtNum(u.llamadasHoy) },
              { key: 'd', header: 'Limite diario', align: 'right', cell: (u) => (u.limiteDiario > 0 ? fmtNum(u.limiteDiario) : 'sin limite'), hideOnMobile: true },
              { key: 'r', header: 'Ritmo', align: 'right', cell: (u) => `${u.rps}/s`, hideOnMobile: true },
              {
                key: 'e',
                header: 'Estado',
                cell: (u) =>
                  u.estado === 'caido' ? (
                    <Badge tono="critical" dot>
                      caido
                    </Badge>
                  ) : u.estado === 'esperando' ? (
                    <Badge tono="warning" dot>
                      esperando
                    </Badge>
                  ) : u.esperas > 0 ? (
                    <Badge dot>{fmtNum(u.esperas)} esperas</Badge>
                  ) : (
                    <Badge tono="good" dot>
                      ok
                    </Badge>
                  ),
              },
            ]}
            rows={d?.apis}
            rowKey={(u) => u.proveedor}
            loading={q.isPending}
            empty={{ title: 'Sin llamadas registradas todavia' }}
          />
        </Card>
      </Section>

      <Section
        title="Registro de actividad"
        actions={
          <Segmented
            label="Nivel"
            value={valores.nivel || 'todos'}
            onChange={(v) => cambiar({ nivel: v === 'todos' ? '' : v })}
            options={[
              { value: 'todos', label: 'Todo' },
              { value: 'info', label: 'Info' },
              { value: 'warn', label: 'Avisos' },
              { value: 'error', label: 'Errores' },
            ]}
          />
        }
      >
        <Card flush>
          <DataTable
            compact
            columns={[
              { key: 'f', header: 'Fecha', cell: (a) => <span className="dim nowrap small">{fmtDate(a.ts)}</span> },
              { key: 'a', header: 'Area', cell: (a) => <Badge tono={NIVEL_LOG[a.level] ?? 'neutral'}>{a.area}</Badge> },
              { key: 'm', header: 'Mensaje', cell: (a) => <span className="small break">{a.message}</span> },
            ]}
            rows={actividad.data?.items}
            rowKey={(a, i) => `${a.ts}:${i}`}
            loading={actividad.isPending}
            refetching={actividad.isPlaceholderData}
            error={actividad.error}
            onRetry={() => void actividad.refetch()}
            empty={{ title: 'Sin actividad registrada' }}
          />
          {actividad.data && actividad.data.total > 0 && (
            <Pagination
              page={page}
              size={size}
              total={actividad.data.total}
              loading={actividad.isPlaceholderData}
              onPage={(p) => cambiar({ page: String(p) })}
              onSize={(s) => cambiar({ size: String(s) })}
            />
          )}
        </Card>
      </Section>
    </>
  );
}
