import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Gauge, Hourglass, Timer, Workflow } from 'lucide-react';
import { useApi } from '../api/hooks';
import type { Resultados as DatosResultados } from '../api/types';
import { PageHeader, Section } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { DataTable } from '../components/ui/DataTable';
import { StatTile } from '../components/ui/StatTile';
import { Callout } from '../components/ui/Callout';
import { ErrorState } from '../components/ui/States';
import { SkeletonText } from '../components/ui/Skeleton';
import { BarList } from '../components/charts/BarList';
import { TokenCell, rutaToken } from '../components/domain/TokenCell';
import { ChainBadge, LevelBadge, OutcomeBadge } from '../components/domain/Badges';
import { fmtMultiple, fmtNum, fmtPct, fmtSegundos } from '../lib/format';
import { RESULTADOS } from '../lib/labels';

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : '–');

export default function Resultados() {
  const navegar = useNavigate();
  const q = useApi<DatosResultados>('/api/panel/resultados');
  const d = q.data;
  const { hash } = useLocation();

  // Enlaces como /resultados#robot3: la seccion solo existe cuando llegan los datos.
  useEffect(() => {
    if (d && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [d, hash]);

  if (q.error && !d) {
    return (
      <>
        <PageHeader title="Resultados" />
        <Card>
          <ErrorState error={q.error} onRetry={() => void q.refetch()} />
        </Card>
      </>
    );
  }

  const cerrados = d?.resultados.reduce((a, r) => a + r.n, 0) ?? 0;

  return (
    <>
      <PageHeader
        title="Resultados"
        sub="Que paso de verdad con los tokens detectados. Es la base del backtesting: cuantos mas dias funcione el sistema, mas fiables son estos numeros."
      />

      {d && cerrados === 0 && (
        <Callout tone="info">
          Todavia no hay tokens cerrados. Cada token se sigue durante varios dias y al terminar se calcula su resultado.
        </Callout>
      )}

      <div className="grid grid--2">
        <Card title="Resultado de los tokens cerrados" sub={d ? `${fmtNum(cerrados)} tokens` : undefined}>
          {!d ? (
            <SkeletonText lines={6} />
          ) : (
            <BarList
              items={d.resultados.map((r) => ({
                label: RESULTADOS[r.outcome]?.texto ?? r.outcome,
                value: r.n,
                tono: RESULTADOS[r.outcome]?.tono ?? 'info',
                hint: RESULTADOS[r.outcome]?.descripcion,
              }))}
            />
          )}
        </Card>
        <Card title="Que significa cada resultado">
          <div className="stack" style={{ gap: 12 }}>
            {Object.entries(RESULTADOS).map(([k, r]) => (
              <div key={k} className="row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                <span style={{ width: 84, flex: 'none' }}>
                  <OutcomeBadge outcome={k} />
                </span>
                <span className="muted small">{r.descripcion}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Section
        title="¿Aciertan mas las notas altas que elegir al azar?"
        sub="La prueba que de verdad importa: los tokens con nota alta contra todos los analizados. Son medianas (el token tipico de cada grupo); el neto descuenta lo que costaria entrar y salir."
      >
        <Card flush>
          <DataTable
            columns={[
              { key: 'g', header: 'Grupo', cell: (c) => <b>{c.grupo}</b> },
              { key: 't', header: 'Tokens', align: 'right', cell: (c) => fmtNum(c.tokens) },
              { key: 'm', header: 'Multiplo mediano 24 h', align: 'right', cell: (c) => fmtMultiple(c.multiplo) },
              { key: 'n', header: 'Neto mediano tras costes', align: 'right', cell: (c) => fmtMultiple(c.neto) },
              { key: 'e', header: 'Suben 1,5x', align: 'right', cell: (c) => (c.pctExito !== null ? fmtPct(c.pctExito, 0) : '–') },
            ]}
            rows={d?.comparativa}
            rowKey={(c) => c.grupo}
            loading={q.isPending}
            skeletonRows={3}
            empty={{ title: 'Todavia no hay mediciones a 24 h' }}
          />
        </Card>
      </Section>

      <Section title="Velocidad del sistema">
        {d && !d.latencia ? (
          <Callout tone="info">Todavia no hay alertas con latencia medida. El dato aparece con la primera.</Callout>
        ) : (
          <div className="grid grid--stats">
            <StatTile loading={!d} icon={<Timer />} label="Latencia mediana" value={fmtSegundos(d?.latencia?.mediana)} hint="de la creacion del par a la alerta" />
            <StatTile loading={!d} icon={<Hourglass />} label="Percentil 90" value={fmtSegundos(d?.latencia?.p90)} hint="9 de cada 10 alertas, por debajo" />
            <StatTile loading={!d} icon={<Workflow />} label="Analisis completo" value={fmtSegundos(d?.latencia?.analisis)} hint="mediana" />
            <StatTile loading={!d} icon={<Gauge />} label="Muestras" value={fmtNum(d?.latencia?.muestras)} hint="alertas medidas" />
          </div>
        )}
      </Section>

      <Section
        title="Acierto segun la nota al detectarlo"
        sub="Si el sistema funciona, los tramos altos concentran mas exitos y menos rugs. Con estos datos se ajustan los umbrales de config/filters.yaml."
      >
        <Card flush>
          <DataTable
            columns={[
              { key: 'b', header: 'Nota', cell: (b) => <b>{b.tramo}</b> },
              { key: 't', header: 'Tokens', align: 'right', cell: (b) => fmtNum(b.total) },
              { key: 'e', header: 'Exitos', align: 'right', cell: (b) => <span className="text-good">{fmtNum(b.exitos)} ({pct(b.exitos, b.total)})</span> },
              { key: 'r', header: 'Rugs', align: 'right', cell: (b) => <span className="text-critical">{fmtNum(b.rugs)} ({pct(b.rugs, b.total)})</span> },
              { key: 'p', header: 'Maximo mediano', align: 'right', cell: (b) => fmtMultiple(b.picoMediano) },
            ]}
            rows={d?.porNota}
            rowKey={(b) => b.tramo}
            loading={q.isPending}
            skeletonRows={4}
            empty={{ title: 'Todavia no hay tokens cerrados' }}
          />
        </Card>
      </Section>

      <Section
        id="robot3"
        title="¿Acierta el Robot 3?"
        sub="Que hizo el precio en las 24 horas siguientes a que un token llegara a cada nivel. Los niveles altos tienen que subir mas y hundirse menos."
      >
        <div className="grid grid--2">
          <Card flush title="Por nivel">
            <DataTable
              columns={[
                { key: 'n', header: 'Nivel', cell: (f) => <LevelBadge nivel={f.nivel} /> },
                { key: 'c', header: 'Tokens', align: 'right', cell: (f) => fmtNum(f.n) },
                { key: 'm', header: 'Subida max. (mediana)', align: 'right', cell: (f) => (f.medianaMaxPct !== null ? fmtPct(f.medianaMaxPct, 0, true) : '–') },
                { key: 's', header: '+50%', align: 'right', cell: (f) => <span className="text-good">{pct(f.suben50, f.n)}</span> },
                { key: 'x', header: 'A la mitad', align: 'right', cell: (f) => <span className="text-critical">{pct(f.caen50, f.n)}</span> },
              ]}
              rows={d?.robot3.porNivel}
              rowKey={(f) => f.nivel}
              loading={q.isPending}
              skeletonRows={4}
              compact
            />
          </Card>
          <Card flush title="¿Salen mejor los tokens de los que habla Telegram?" sub="Entre los tokens ya cerrados por el seguimiento.">
            <DataTable
              columns={[
                { key: 'g', header: 'Grupo', cell: (g) => <b>{g.conTelegram ? 'Mencionados en Telegram' : 'Sin mencion'}</b> },
                { key: 'n', header: 'Tokens', align: 'right', cell: (g) => fmtNum(g.n) },
                { key: 'e', header: 'Exitos', align: 'right', cell: (g) => <span className="text-good">{pct(g.exitos, g.n)}</span> },
                { key: 'r', header: 'Rugs', align: 'right', cell: (g) => <span className="text-critical">{pct(g.rugs, g.n)}</span> },
                { key: 'p', header: 'Pico mediano', align: 'right', cell: (g) => fmtMultiple(g.picoMediano) },
              ]}
              rows={d?.robot3.grupos}
              rowKey={(g) => String(g.conTelegram)}
              loading={q.isPending}
              skeletonRows={2}
              compact
            />
          </Card>
        </div>
      </Section>

      <Section title="Los que mas subieron" sub="Los 20 tokens cerrados que mas subieron sin acabar en rug. Se dejan fuera los picos imposibles (mas de 1.000x), que salen de precios rotos.">
        <Card flush>
          <DataTable
            columns={[
              { key: 't', header: 'Token', cell: (b) => <TokenCell chain={b.chain} address={b.address} symbol={b.symbol} /> },
              { key: 'c', header: 'Cadena', cell: (b) => <ChainBadge chain={b.chain} />, hideOnMobile: true },
              { key: 'n', header: 'Nota', align: 'right', cell: (b) => b.nota ?? '–' },
              { key: 'p', header: 'Maximo', align: 'right', cell: (b) => <b>{fmtMultiple(b.pico)}</b> },
              { key: 'r', header: 'Resultado', cell: (b) => <OutcomeBadge outcome={b.outcome} /> },
            ]}
            rows={d?.mejores}
            rowKey={(b) => `${b.chain}:${b.address}`}
            loading={q.isPending}
            onRowClick={(b) => navegar(rutaToken(b.chain, b.address))}
            empty={{ title: 'Sin datos todavia' }}
          />
        </Card>
      </Section>
    </>
  );
}
