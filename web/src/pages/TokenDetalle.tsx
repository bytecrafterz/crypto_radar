import { useEffect, type ReactNode } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Send, ShoppingCart } from 'lucide-react';
import { useApi } from '../api/hooks';
import { ApiError } from '../api/client';
import type { FichaToken } from '../api/types';
import { Section, useTitulo } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { StatTile } from '../components/ui/StatTile';
import { Callout } from '../components/ui/Callout';
import { KeyValue } from '../components/ui/KeyValue';
import { Badge } from '../components/ui/Badge';
import { EmptyState, ErrorState } from '../components/ui/States';
import { Skeleton, SkeletonText } from '../components/ui/Skeleton';
import { AddressLink } from '../components/ui/AddressLink';
import { DataTable } from '../components/ui/DataTable';
import { ChartCard } from '../components/charts/ChartCard';
import { ReasonList } from '../components/domain/ReasonList';
import { Anticipation } from '../components/domain/Anticipation';
import { DecisionRobot3 } from '../components/domain/DecisionRobot3';
import { Disclosure } from '../components/ui/Disclosure';
import { iniciales } from '../components/domain/TokenCell';
import {
  BoolBadge, ChainBadge, LevelBadge, MessageClassBadge, OpportunityBadge, RiskBadge, TokenStatusBadge,
} from '../components/domain/Badges';
import { fmtDate, fmtMultiple, fmtNum, fmtPct, fmtPrice, fmtUsd, timeAgo } from '../lib/format';
import { SEVERIDAD, SOSPECHOSOS } from '../lib/labels';

const pct = (v: number | null) => (v !== null ? fmtPct(v) : 'n/d');

function Enlace({ href, children, primary }: { href: string | null; children: ReactNode; primary?: boolean }) {
  if (!href) return null;
  return (
    <a className={`btn ${primary ? 'btn--primary' : 'btn--secondary'} btn--sm`} href={href} target="_blank" rel="noopener noreferrer">
      {primary ? <ShoppingCart /> : <ExternalLink />}
      {children}
    </a>
  );
}

function Cargando() {
  return (
    <>
      <div className="token-hero" style={{ marginBottom: 24 }}>
        <Skeleton width={56} height={56} radius={16} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Skeleton width={180} height={30} />
          <Skeleton width={260} height={14} />
        </div>
      </div>
      <div className="grid grid--stats">
        {Array.from({ length: 6 }, (_, i) => (
          <StatTile key={i} loading label="…" value="" />
        ))}
      </div>
      <div className="grid grid--2 section">
        <Card title="Por que es interesante">
          <SkeletonText lines={5} />
        </Card>
        <Card title="Riesgos detectados">
          <SkeletonText lines={5} />
        </Card>
      </div>
    </>
  );
}

export default function TokenDetalle() {
  const { chain = '', address = '' } = useParams();
  const q = useApi<FichaToken>(`/api/panel/token/${encodeURIComponent(chain)}/${encodeURIComponent(address)}`, {
    refrescoMs: 60_000,
  });
  useTitulo(q.data?.token.symbol ?? 'Token');

  // Enlaces directos a una seccion (#decision-robot3 desde Convergencia).
  const { hash } = useLocation();
  const hayDatos = Boolean(q.data);
  useEffect(() => {
    if (hayDatos && hash) document.getElementById(hash.slice(1))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [hayDatos, hash]);

  const volver = (
    <Link to="/tokens" className="row small" style={{ marginBottom: 16, color: 'var(--text-2)' }}>
      <ArrowLeft size={16} /> Tokens
    </Link>
  );

  if (q.isPending) {
    return (
      <>
        {volver}
        <Cargando />
      </>
    );
  }

  if (q.error) {
    const noExiste = q.error instanceof ApiError && q.error.status === 404;
    return (
      <>
        {volver}
        <Card>
          {noExiste ? (
            <EmptyState title="Token no encontrado" text="Ese token no esta en la base de datos." action={<Link to="/tokens">Volver al listado</Link>} />
          ) : (
            <ErrorState error={q.error} onRetry={() => void q.refetch()} />
          )}
        </Card>
      </>
    );
  }

  const { token: t, enlaces, puntuacion: s, seguridad: seg, holders: h, creador, telegram: tg } = q.data;
  const esSolana = t.chain === 'solana';

  return (
    <>
      {volver}
      <div className="token-hero" style={{ marginBottom: 20 }}>
        <div className="token-hero__avatar" aria-hidden="true">
          {iniciales(t.symbol)}
        </div>
        <div style={{ minWidth: 0 }}>
          <h1 className="token-hero__sym">{t.symbol ?? '???'}</h1>
          <div className="token-hero__name">{t.name}</div>
          <div style={{ marginTop: 6 }}>
            <AddressLink address={t.address} href={enlaces.explorador} full />
          </div>
        </div>
        <div className="token-hero__badges row">
          <ChainBadge chain={t.chain} />
          <TokenStatusBadge status={t.status} />
          {t.dex && <Badge>{t.dex}</Badge>}
        </div>
      </div>

      <div className="row" style={{ marginBottom: 20 }}>
        <Enlace href={enlaces.compra} primary>
          Comprar en {enlaces.compraNombre}
        </Enlace>
        <Enlace href={enlaces.dexscreener}>DexScreener</Enlace>
        <Enlace href={enlaces.explorador}>Explorador</Enlace>
        <Enlace href={enlaces.twitter}>X</Enlace>
        <Enlace href={enlaces.telegram}>Telegram</Enlace>
        <Enlace href={enlaces.web}>Web</Enlace>
      </div>

      <div className="grid grid--stats">
        <StatTile label="Oportunidad" value={<OpportunityBadge value={t.opportunity} />} hint="0-100, mas es mejor" />
        <StatTile label="Riesgo" value={<RiskBadge value={t.risk} />} hint="0-100, mas es peor" />
        <StatTile label="Precio" value={fmtPrice(t.price)} hint={`maximo ${fmtPrice(t.peakPrice)}`} />
        <StatTile label="Liquidez" value={fmtUsd(t.liquidity)} hint={`maxima ${fmtUsd(t.peakLiquidity)}`} />
        <StatTile label="Capitalizacion" value={fmtUsd(t.marketCap)} hint={`maxima ${fmtUsd(t.peakMarketCap)}`} />
        <StatTile label="Detectado" value={timeAgo(t.firstSeen)} hint={fmtDate(t.firstSeen)} />
      </div>

      <div className="stack" style={{ marginTop: 16 }}>
        {s && s.vetos.length > 0 && (
          <Callout tone="danger" title="Vetos criticos">
            <ul>
              {s.vetos.map((v, i) => (
                <li key={i}>{v}</li>
              ))}
            </ul>
          </Callout>
        )}
        {s && !s.evaluable && (
          <Callout tone="warning" title="No evaluable">
            Faltan comprobaciones criticas. El sistema no puede afirmar que este token sea seguro.
          </Callout>
        )}
        {s && s.faltan.length > 0 && (
          <Callout tone="warning" title="No se pudo comprobar">
            {s.faltan.join(', ')}. La puntuacion se calcula con lo que si se pudo verificar.
          </Callout>
        )}
        {s?.costeOperar && (
          <Callout tone="info" title="Coste real de operar">
            {s.costeOperar}
          </Callout>
        )}
      </div>

      <div className="grid grid--2 section">
        <Card title="Por que es interesante">
          <ReasonList items={s?.motivosOportunidad ?? []} kind="good" empty="Sin motivos registrados" />
        </Card>
        <Card title="Riesgos detectados">
          <ReasonList items={s?.motivosRiesgo ?? []} kind="bad" empty="No se han detectado riesgos" />
        </Card>
      </div>

      {s && (
        <div className="grid grid--2" style={{ marginTop: 16 }}>
          <Card title="Como sale la nota" sub="Calculo del Robot 1 (src/scoring/engine.ts, reglas en config/scoring.yaml)">
            <KeyValue
              items={[
                ['Puntos a favor', `${fmtNum(s.calculo.sumaAFavor)} de ${fmtNum(s.calculo.maximoPosible)} posibles`],
                ['Oportunidad antes de ajustes', `${fmtNum(s.calculo.sumaAFavor)} / ${fmtNum(s.calculo.maximoPosible)} x 100 = ${String(s.calculo.oportunidadBase).replace('.', ',')}`],
                s.calculo.ajuste !== 0 && ['Ajuste por riesgo alto o mercado', String(s.calculo.ajuste).replace('.', ',')],
                ['Oportunidad final', <b key="o">{String(s.calculo.oportunidad).replace('.', ',')}</b>],
                ['Riesgo', <b key="r">{`${String(s.calculo.sumaRiesgo).replace('.', ',')} puntos en contra (maximo 100; desde ${s.calculo.vetoRiesgo} veta)`}</b>],
              ]}
            />
            <p className="dim xs" style={{ margin: '10px 0 0' }}>
              La oportunidad es la suma de los puntos a favor sobre el maximo posible. Un riesgo de 50 o mas la rebaja, y el
              contexto del mercado general la ajusta un poco. El riesgo es la suma directa de los puntos en contra.
            </p>
          </Card>
          <Card title="De donde sale cada dato" flush>
            <DataTable
              compact
              columns={[
                {
                  key: 'dato',
                  header: 'Dato',
                  cell: (o) => (
                    <div className="stack" style={{ gap: 2 }}>
                      <span className="small">{o.dato}</span>
                      <span className="dim xs">{o.fuente}</span>
                      {o.enlace && (
                        <a className="xs" href={o.enlace} target="_blank" rel="noopener noreferrer">
                          ver la transaccion en la blockchain
                        </a>
                      )}
                    </div>
                  ),
                },
                { key: 'hora', header: 'Hora', cell: (o) => <span className="nowrap small">{fmtDate(o.hora)}</span> },
              ]}
              rows={q.data.origen}
              rowKey={(o) => o.dato}
            />
          </Card>
        </div>
      )}

      {tg && (
        <Section title="Telegram y Robot 3" sub="Lo que se dijo de este token en Telegram, resumido en espanol, y el veredicto del Robot 3.">
          <Card>
            <div className="row" style={{ marginBottom: 12 }}>
              <Send size={16} className="dim" />
              <span>
                <b>{tg.total}</b> menciones en <b>{tg.canales}</b> canal(es)
              </span>
              <span className="dim small">· primera {fmtDate(tg.primera)}</span>
              {tg.veredicto && (
                <>
                  <Link to="/convergencia">
                    <LevelBadge nivel={tg.veredicto.nivel} />
                  </Link>
                  {tg.veredicto.avisado && <Badge tono="good">avisado</Badge>}
                  <span className="dim small">
                    {tg.veredicto.fuentesIndep} de {tg.veredicto.fuentesTotal} fuentes independientes
                  </span>
                </>
              )}
            </div>
            {tg.veredicto && (tg.veredicto.confirmaciones.length > 0 || tg.veredicto.contradicciones.length > 0) && (
              <div className="stack" style={{ gap: 6, marginBottom: 12 }}>
                <span className="dim small">Comprobado contra la cadena</span>
                {tg.veredicto.confirmaciones.map((c, i) => (
                  <span key={`c${i}`} className="small text-good">
                    ✓ {c}
                  </span>
                ))}
                {tg.veredicto.contradicciones.map((c, i) => (
                  <span key={`x${i}`} className="small text-critical">
                    ✗ {c}
                  </span>
                ))}
              </div>
            )}
            <DataTable
              compact
              columns={[
                {
                  key: 'dice',
                  header: 'Lo que dice (en espanol)',
                  cell: (m) => (
                    <div className="stack" style={{ gap: 4, alignItems: 'flex-start' }}>
                      <span className={m.resumen ? 'small' : 'small dim'}>{m.resumen ?? m.texto.slice(0, 220)}</span>
                      {m.clase && <MessageClassBadge clase={m.clase} />}
                      {(m.resumen || m.texto.length > 220) && (
                        <Disclosure summary="Mensaje original">
                          <span className="small dim" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                            {m.texto}
                          </span>
                        </Disclosure>
                      )}
                    </div>
                  ),
                },
                { key: 'canal', header: 'Canal', cell: (m) => <span className="small">@{m.canal ?? '?'}</span> },
                {
                  key: 'hora',
                  header: 'Hora',
                  hideOnMobile: true,
                  cell: (m) => <span className="small nowrap">{fmtDate(m.postedAt)}</span>,
                },
                {
                  key: 'rep',
                  header: 'Reputacion del canal',
                  align: 'right',
                  cell: (m) => (m.reputacion === null ? <span className="dim small">sin historial</span> : <b>{fmtNum(m.reputacion)}</b>),
                },
                { key: 'ant', header: 'Anticipacion', cell: (m) => <Anticipation seg={m.anticipacionSeg} veredicto={m.veredicto} /> },
              ]}
              rows={tg.menciones}
              rowKey={(_, i) => i}
            />
            <p className="dim xs" style={{ margin: '10px 0 0' }}>
              Reputacion del canal: porcentaje de sus menciones medidas que aparecieron antes de que el precio subiera un 25 % en
              las 24 horas siguientes. Sale de su historial real y se recalcula sola cada 30 minutos.
            </p>
          </Card>
        </Section>
      )}

      {q.data.decision && <DecisionRobot3 d={q.data.decision} />}

      <Section
        title="Evolucion"
        sub={
          q.data.serieDesdeDeteccion
            ? 'Mediciones del seguimiento en las primeras 72 horas desde la deteccion.'
            : 'Mediciones del seguimiento de las ultimas 72 horas.'
        }
      >
        <div className="grid grid--3">
          <ChartCard title="Precio" points={q.data.serie.map((p) => ({ ts: p.ts, value: p.price }))} format={(v) => fmtPrice(v)} />
          <ChartCard title="Liquidez" points={q.data.serie.map((p) => ({ ts: p.ts, value: p.liquidity }))} format={(v) => fmtUsd(v)} />
          <ChartCard title="Holders" points={q.data.serie.map((p) => ({ ts: p.ts, value: p.holders }))} format={(v) => fmtNum(v)} />
        </div>
      </Section>

      {q.data.horizontes.length > 0 && (
        <Section title="Que paso despues" sub="Mediciones en el momento exacto de cada horizonte. El neto descuenta lo que costaria entrar y salir.">
          <Card flush>
            <DataTable
              compact
              columns={[
                { key: 'h', header: 'Momento', cell: (x) => <b>{x.horizonte}</b> },
                {
                  key: 'm',
                  header: 'Multiplo',
                  align: 'right',
                  cell: (x) => <span className={x.multiplo === null ? 'dim' : x.multiplo >= 1 ? 'text-good' : 'text-critical'}>{fmtMultiple(x.multiplo)}</span>,
                },
                {
                  key: 'n',
                  header: 'Neto',
                  align: 'right',
                  cell: (x) => <span className={x.neto === null ? 'dim' : x.neto >= 1 ? 'text-good' : 'text-critical'}>{fmtMultiple(x.neto)}</span>,
                },
                { key: 'l', header: 'Liquidez', align: 'right', cell: (x) => fmtUsd(x.liquidez) },
                { key: 'c', header: 'Capturado', cell: (x) => <span className="dim small">{fmtDate(x.capturado)}</span>, hideOnMobile: true },
              ]}
              rows={q.data.horizontes}
              rowKey={(x) => x.horizonte}
            />
          </Card>
        </Section>
      )}

      {q.data.cambios.length > 0 && (
        <Section title="Cambios despues de la deteccion">
          <Card flush>
            <ul className="feed">
              {q.data.cambios.map((c, i) => (
                <li key={i} className="feed__item">
                  <Badge tono={SEVERIDAD[c.severity] ?? 'neutral'}>{c.campo}</Badge>
                  <div className="feed__main small">{c.detail}</div>
                  <span className="feed__meta nowrap">{timeAgo(c.ts)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </Section>
      )}

      <div className="grid grid--2 section">
        <Card title="Seguridad">
          {!seg ? (
            <EmptyState compact title="Sin analisis profundo todavia" />
          ) : (
            <>
              <KeyValue
                items={[
                  esSolana && ['Mint authority', <BoolBadge value={seg.mintActiva} goodWhen={false} labels={['ACTIVA', 'revocada']} />],
                  esSolana && ['Freeze authority', <BoolBadge value={seg.freezeActiva} goodWhen={false} labels={['ACTIVA', 'revocada']} />],
                  esSolana && ['Token-2022', seg.token2022 ? `si${seg.extensiones ? ' (con extensiones)' : ''}` : 'no'],
                  !esSolana && ['Owner con permisos', <BoolBadge value={seg.ownerPuedeModificar} goodWhen={false} />],
                  !esSolana && ['Contrato verificado', <BoolBadge value={seg.verificado} goodWhen={true} />],
                  !esSolana && ['Honeypot', <BoolBadge value={seg.honeypot} goodWhen={false} labels={['SI', 'no']} />],
                  !esSolana && ['Blacklist', <BoolBadge value={seg.blacklist} goodWhen={false} />],
                  !esSolana && ['Proxy', <BoolBadge value={seg.proxy} goodWhen={false} />],
                  !esSolana && ['Comisiones compra / venta', `${seg.impuestoCompra ?? '?'}% / ${seg.impuestoVenta ?? '?'}%`],
                  ['Liquidez bloqueada', pct(seg.liquidezBloqueada)],
                  ['Liquidez quemada', pct(seg.liquidezQuemada)],
                ]}
              />
              {seg.notas.length > 0 && (
                <>
                  <div className="divider" />
                  <ul className="reasons">
                    {seg.notas.map((n, i) => (
                      <li key={i} className="small">
                        {n}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="dim small" style={{ marginTop: 12 }}>
                Fuentes: {seg.fuentes.length ? seg.fuentes.join(', ') : 'ninguna'}
                {seg.fallidas.length > 0 && ` · Sin respuesta: ${seg.fallidas.join(', ')}`}
              </p>
            </>
          )}
        </Card>

        <Card title="Holders y concentracion">
          {!h ? (
            <EmptyState compact title="Sin datos de holders todavia" />
          ) : (
            <>
              <KeyValue
                items={[
                  ['Holders totales', fmtNum(h.total)],
                  ['Top 10 real', pct(h.top10)],
                  ['Top 20 real', pct(h.top20)],
                  ['Mayor wallet', pct(h.mayor)],
                  ['El creador conserva', pct(h.creador)],
                ]}
              />
              {h.nota && <p className="dim small" style={{ marginTop: 12 }}>{h.nota}</p>}
              {h.top.length > 0 && (
                <div style={{ marginTop: 12, maxHeight: 320, overflowY: 'auto' }}>
                  <DataTable
                    compact
                    columns={[
                      { key: 'n', header: '#', cell: (x) => <span className="dim">{h.top.indexOf(x) + 1}</span> },
                      { key: 'a', header: 'Direccion', cell: (x) => <AddressLink address={x.address} href={x.explorador} /> },
                      {
                        key: 't',
                        header: 'Tipo',
                        cell: (x) => <Badge tono={x.tag === 'wallet' ? 'neutral' : x.tag === 'creador' ? 'critical' : 'info'}>{x.tag}</Badge>,
                      },
                      { key: 'p', header: '%', align: 'right', cell: (x) => `${x.pct.toFixed(2)}%` },
                    ]}
                    rows={h.top}
                    rowKey={(x) => x.address}
                  />
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <div className="grid grid--2" style={{ marginTop: 16 }}>
        <Card title="Creador">
          {!creador ? (
            <EmptyState compact title="No se ha podido identificar al creador" />
          ) : (
            <>
              <KeyValue
                items={[
                  ['Direccion', <AddressLink address={creador.address} href={creador.explorador} />],
                  ['Tokens anteriores', fmtNum(creador.tokensPrevios)],
                  [
                    'Historial',
                    creador.historial === 'bad' ? (
                      <Badge tono="critical">malo</Badge>
                    ) : creador.historial === 'good' ? (
                      <Badge tono="good">bueno</Badge>
                    ) : (
                      <Badge>desconocido</Badge>
                    ),
                  ],
                  creador.financiadoPor !== null && ['Financiado por', <AddressLink address={creador.financiadoPor} />],
                ]}
              />
              {creador.nota && <p className="dim small" style={{ marginTop: 12 }}>{creador.nota}</p>}
            </>
          )}
        </Card>

        <Card title="Movimientos sospechosos" flush>
          {q.data.sospechosos.length === 0 ? (
            <EmptyState compact title="No se han detectado movimientos sospechosos" />
          ) : (
            <ul className="feed">
              {q.data.sospechosos.map((m, i) => (
                <li key={i} className="feed__item">
                  <Badge tono={SEVERIDAD[m.severity] ?? 'neutral'}>{SOSPECHOSOS[m.kind] ?? m.kind}</Badge>
                  <div className="feed__main small">{m.detail}</div>
                  <span className="feed__meta nowrap">{timeAgo(m.ts)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
