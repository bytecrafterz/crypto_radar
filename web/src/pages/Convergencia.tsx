import { Link } from 'react-router-dom';
import { ArrowRight, Check, X } from 'lucide-react';
import { useApi, useFiltrosUrl } from '../api/hooks';
import { conParams } from '../api/client';
import type { ConvergenciaResumen, ListaVeredictos, Veredicto } from '../api/types';
import { PageHeader, Section } from '../components/ui/PageHeader';
import { Card } from '../components/ui/Card';
import { StatTile } from '../components/ui/StatTile';
import { Segmented } from '../components/ui/Segmented';
import { Pagination } from '../components/ui/Pagination';
import { Badge } from '../components/ui/Badge';
import { MeterRow } from '../components/ui/Meter';
import { EmptyState, ErrorState } from '../components/ui/States';
import { SkeletonText } from '../components/ui/Skeleton';
import { TokenCell } from '../components/domain/TokenCell';
import { LevelBadge } from '../components/domain/Badges';
import { Anticipation } from '../components/domain/Anticipation';
import { fmtNum, fmtPct, timeAgo } from '../lib/format';
import { NIVELES, ORDEN_NIVELES, colorTono } from '../lib/labels';

function TarjetaVeredicto({ v }: { v: Veredicto }) {
  const tono = NIVELES[v.nivel]?.tono ?? 'neutral';
  return (
    <Card accent={tono === 'neutral' ? undefined : colorTono[tono]}>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div className="stack" style={{ gap: 6, minWidth: 0 }}>
          <div className="row">
            <TokenCell chain={v.chain} address={v.address} symbol={v.symbol} />
            <LevelBadge nivel={v.nivel} />
            {v.vetado && <Badge tono="critical">vetado</Badge>}
            {v.avisado && <Badge tono="good">avisado</Badge>}
            {v.enSeguimiento && !v.avisado && v.nivel !== 'descartado' && <Badge tono="info">en seguimiento</Badge>}
          </div>
          <div className="row small muted">
            {v.fuentesIndep} de {v.fuentesTotal} fuentes independientes ·
            <Anticipation seg={v.anticipacionSeg} />
          </div>
        </div>
        <span className="dim small nowrap">{timeAgo(v.creado)}</span>
      </div>

      {(v.historial.length > 1 || v.cambioPrecioPct !== null) && (
        <div className="row small" style={{ marginTop: 10 }}>
          {v.historial.length > 1 &&
            v.historial.map((h, i) => (
              <span key={i} className="row" style={{ gap: 6 }}>
                {i > 0 && <ArrowRight size={13} className="dim" />}
                <span>{NIVELES[h.nivel]?.texto ?? h.nivel}</span>
                <span className="dim">({timeAgo(h.ts)})</span>
              </span>
            ))}
          {v.cambioPrecioPct !== null && (
            <span className="muted">
              · precio desde el veredicto:{' '}
              <b className={v.cambioPrecioPct >= 0 ? 'text-good' : 'text-critical'}>{fmtPct(v.cambioPrecioPct, 0, true)}</b>
            </span>
          )}
        </div>
      )}

      {(v.resumenes.length > 0 || v.confirmaciones.length > 0 || v.contradicciones.length > 0) && (
        <>
          <div className="divider" />
          {v.resumenes.length > 0 && (
            <div className="stack" style={{ gap: 8 }}>
              <span className="dim xs strong" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Lo que dicen los mensajes
              </span>
              {v.resumenes.map((r, i) => (
                <div key={i} className="quote">
                  {r.texto}
                  <div className="dim xs">
                    {r.canal ? `@${r.canal}` : ''}
                    {r.clase ? ` · ${r.clase}` : ''}
                  </div>
                </div>
              ))}
            </div>
          )}
          {(v.confirmaciones.length > 0 || v.contradicciones.length > 0) && (
            <div className="stack" style={{ gap: 4, marginTop: 10 }}>
              <span className="dim xs strong" style={{ textTransform: 'uppercase', letterSpacing: '.04em' }}>
                Comprobado contra la cadena
              </span>
              {v.confirmaciones.map((c, i) => (
                <span key={`c${i}`} className="small text-good row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <Check size={14} style={{ flex: 'none', marginTop: 3 }} /> {c}
                </span>
              ))}
              {v.contradicciones.map((c, i) => (
                <span key={`x${i}`} className="small text-critical row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                  <X size={14} style={{ flex: 'none', marginTop: 3 }} /> {c}
                </span>
              ))}
            </div>
          )}
        </>
      )}

      <div className="divider" />
      <div className="grid grid--2" style={{ gap: 20 }}>
        <div>
          <div className="dim small" style={{ marginBottom: 8 }}>
            Lo que dicen los datos (Robot 1)
          </div>
          <MeterRow label="Oportunidad" value={v.tecnica} />
          <MeterRow label="Riesgo" value={v.riesgo} invert />
        </div>
        <div>
          <div className="dim small" style={{ marginBottom: 8 }}>
            Lo que dice Telegram (Robot 2)
          </div>
          <MeterRow label="Senal social (incluye independencia)" value={v.social} />
          <MeterRow label="Reputacion de las fuentes" value={v.fuentes} />
          <MeterRow label="Evidencia" value={v.evidencia} />
        </div>
      </div>

      <div className="divider" />
      <div className="dim small" style={{ marginBottom: 6 }}>
        Reglas de Convergencia fuerte{v.reglasGuardadas ? '' : ' (recalculadas con las reglas actuales)'}
      </div>
      <ul className="reglas-mini">
        {v.reglas.map((r, i) => (
          <li key={i} className={r.cumple ? 'is-ok' : 'is-ko'}>
            {r.cumple ? <Check size={14} /> : <X size={14} />}
            <span>{r.regla}</span>
            <span className="reglas-mini__valor">
              {r.valor} <span className="dim">· exige {r.exige}</span>
            </span>
          </li>
        ))}
      </ul>
      <Link to={`/token/${v.chain}/${v.address}#decision-robot3`} className="row small" style={{ marginTop: 10, gap: 4 }}>
        Ver la decision completa: datos comparados, mensajes y codigo <ArrowRight size={14} />
      </Link>
    </Card>
  );
}

export default function Convergencia() {
  const { valores, cambiar, page } = useFiltrosUrl(['nivel'] as const, { size: '12' });
  const size = Number(valores.size) || 12;
  const resumen = useApi<ConvergenciaResumen>('/api/panel/convergencia', { refrescoMs: 60_000 });
  const lista = useApi<ListaVeredictos>(conParams('/api/panel/convergencia/veredictos', { nivel: valores.nivel, page, size }), {
    mantenerAnterior: true,
  });
  const r = resumen.data;
  const u = r?.umbrales;

  return (
    <>
      <PageHeader
        title="Convergencia"
        sub="El Robot 3 cruza las dos lecturas: lo que dicen los datos de la cadena y lo que se dice en Telegram. Solo avisa cuando coinciden."
      />

      <div className="grid grid--stats">
        {ORDEN_NIVELES.map((n) => (
          <button
            key={n}
            onClick={() => cambiar({ nivel: valores.nivel === n ? '' : n })}
            className="stat-button"
            aria-pressed={valores.nivel === n}
          >
            <StatTile
              loading={!r}
              label={NIVELES[n].texto}
              value={fmtNum(r?.porNivel[n])}
              hint={valores.nivel === n ? 'filtrando por este nivel' : NIVELES[n].descripcion}
            />
          </button>
        ))}
      </div>

      <Card title="Como decide" className="section">
        {!u ? (
          <SkeletonText lines={3} />
        ) : (
          <div className="stack muted small" style={{ gap: 8 }}>
            <p>
              Las dos notas nunca se suman en una sola: un token con mucho ruido en Telegram y un contrato peligroso no es "medio bueno", es un
              descarte. <b style={{ color: 'var(--text)' }}>El veto del Robot 1 manda siempre</b>: si el token no se puede vender, da igual
              cuanta gente hable de el.
            </p>
            <p>
              Para <b style={{ color: 'var(--text)' }}>Convergencia fuerte</b>, el unico nivel que avisa, hacen falta a la vez: oportunidad ≥{' '}
              <b>{u.tecnicaMinimaRojo}</b>, riesgo ≤ <b>{u.riesgoMaximoRojo}</b>, al menos <b>{u.fuentesIndepMinimasRojo}</b> fuentes que no se
              copien entre si con reputacion ≥ <b>{u.reputacionMinimaRojo}</b>, que hablaran antes del movimiento y que la cadena no desmienta
              nada. Para <b style={{ color: 'var(--text)' }}>Convergencia</b>: oportunidad ≥ <b>{u.tecnicaMinimaNaranja}</b>, riesgo ≤{' '}
              <b>{u.riesgoMaximoNaranja}</b> y una fuente. Se ajustan en config/robot3.yaml.
            </p>
            <p>
              Evaluados: <b>{fmtNum(r?.evaluados)}</b> · Con aviso enviado: <b>{fmtNum(r?.avisados)}</b> ·{' '}
              <Link to="/resultados#robot3">Cuanto acierta cada nivel</Link>
            </p>
          </div>
        )}
      </Card>

      <Section
        title="Veredictos"
        actions={
          <Segmented
            label="Nivel"
            value={valores.nivel || 'todos'}
            onChange={(v) => cambiar({ nivel: v === 'todos' ? '' : v })}
            options={[{ value: 'todos', label: 'Todos' }, ...ORDEN_NIVELES.map((n) => ({ value: n, label: NIVELES[n].texto }))]}
          />
        }
      >
        {lista.error && !lista.data ? (
          <Card>
            <ErrorState error={lista.error} onRetry={() => void lista.refetch()} />
          </Card>
        ) : lista.isPending ? (
          <div className="grid grid--2">
            {Array.from({ length: 4 }, (_, i) => (
              <Card key={i}>
                <SkeletonText lines={6} />
              </Card>
            ))}
          </div>
        ) : lista.data.items.length === 0 ? (
          <Card>
            <EmptyState
              title="Ningun veredicto todavia"
              text="El Robot 3 necesita que un token aparezca en Telegram y que el Robot 1 lo haya analizado; hasta que coinciden no hay nada que cruzar."
            />
          </Card>
        ) : (
          <>
            <div className="grid grid--2" style={{ opacity: lista.isPlaceholderData ? 0.55 : 1, transition: 'opacity 160ms' }}>
              {lista.data.items.map((v) => (
                <TarjetaVeredicto key={`${v.chain}:${v.address}:${v.creado}`} v={v} />
              ))}
            </div>
            <Card className="section" flush>
              <Pagination
                page={page}
                size={size}
                total={lista.data.total}
                loading={lista.isPlaceholderData}
                sizes={[12, 24, 48]}
                onPage={(p) => {
                  cambiar({ page: String(p) });
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                onSize={(s) => cambiar({ size: String(s) })}
              />
            </Card>
          </>
        )}
      </Section>
    </>
  );
}
