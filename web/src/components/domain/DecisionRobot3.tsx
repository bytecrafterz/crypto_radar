import { CheckCircle2, XCircle } from 'lucide-react';
import type { FichaToken } from '../../api/types';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Callout } from '../ui/Callout';
import { DataTable } from '../ui/DataTable';
import { Disclosure } from '../ui/Disclosure';
import { KeyValue } from '../ui/KeyValue';
import { Section } from '../ui/PageHeader';
import { LevelBadge, MessageClassBadge } from './Badges';
import { Anticipation } from './Anticipation';
import { ReasonList } from './ReasonList';
import { fmtDate, fmtNum, fmtPrice } from '../../lib/format';
import { NIVELES } from '../../lib/labels';

type Decision = NonNullable<FichaToken['decision']>;
type Regla = Decision['reglas']['maximo'][number];

const decimal = (n: number | null | undefined) => (n === null || n === undefined ? 'n/d' : String(Math.round(n * 10) / 10).replace('.', ','));

/** Tabla de reglas: lo que exige cada una, el valor del token y si lo cumple. */
export function ReglasTabla({ reglas, conDefinicion = true }: { reglas: Regla[]; conDefinicion?: boolean }) {
  return (
    <DataTable
      compact
      columns={[
        {
          key: 'regla',
          header: 'Regla',
          cell: (r) => (
            <div className="stack" style={{ gap: 3 }}>
              <span>{r.regla}</span>
              <span className="dim xs">{r.robot}</span>
            </div>
          ),
        },
        { key: 'exige', header: 'Exige', cell: (r) => <span className="nowrap">{r.exige}</span> },
        { key: 'valor', header: 'Valor del token', cell: (r) => <b className="nowrap">{r.valor}</b> },
        {
          key: 'res',
          header: 'Resultado',
          cell: (r) =>
            r.cumple ? (
              <Badge tono="good" icon={<CheckCircle2 />}>
                cumple
              </Badge>
            ) : (
              <Badge tono="critical" icon={<XCircle />}>
                no cumple
              </Badge>
            ),
        },
        ...(conDefinicion
          ? [{ key: 'def', header: 'Definida en', hideOnMobile: true, cell: (r: Regla) => <span className="mono xs dim">{r.definida}</span> }]
          : []),
      ]}
      rows={reglas}
      rowKey={(r) => r.codigo}
    />
  );
}

function conclusion(reglas: Regla[], nivel: string) {
  const fallan = reglas.filter((r) => !r.cumple);
  if (fallan.length === 0) return 'Cumple todas las reglas: por eso el Robot 3 lo selecciono como Convergencia fuerte.';
  return `No llega a Convergencia fuerte porque no cumple: ${fallan.map((r) => r.regla.toLowerCase()).join('; ')}. Nivel asignado: ${NIVELES[nivel]?.texto ?? nivel}.`;
}

/**
 * La decision del Robot 3 sobre un token, entera: reglas con su resultado,
 * los datos de cada robot que se compararon, la explicacion, el historial
 * de niveles y donde esta cada cosa para quien quiera revisarlo.
 */
export function DecisionRobot3({ d }: { d: Decision }) {
  const c = d.robot1.calculo;
  return (
    <Section
      id="decision-robot3"
      title="Decision del Robot 3"
      sub="Que datos del Robot 1 y del Robot 2 se compararon, que reglas se aplicaron y que resultado dio cada una."
    >
      <div className="stack" style={{ gap: 16 }}>
        <Card>
          <div className="row" style={{ marginBottom: 10 }}>
            <LevelBadge nivel={d.nivel} />
            <span className="small">
              Decidido el <b>{fmtDate(d.momento)}</b>
            </span>
            {d.avisadoEn && <Badge tono="good">aviso enviado el {fmtDate(d.avisadoEn)}</Badge>}
            {d.primeraMencion && <span className="dim small">· primera mencion en Telegram: {fmtDate(d.primeraMencion)}</span>}
          </div>
          {!d.reglasGuardadas && (
            <div style={{ marginBottom: 12 }}>
              <Callout tone="info">
                Este veredicto es anterior a que cada decision guardara sus reglas (15 de octubre). Se muestran recalculadas con los
                valores que si se guardaron del veredicto y las reglas actuales de config/robot3.yaml.
              </Callout>
            </div>
          )}
          <p className="small" style={{ margin: '0 0 10px' }}>
            <b>Reglas de Convergencia fuerte</b> (el unico nivel que envia aviso): hacen falta todas a la vez.
          </p>
          <ReglasTabla reglas={d.reglas.maximo} />
          <p className="small" style={{ margin: '12px 0 0' }}>
            {conclusion(d.reglas.maximo, d.nivel)}
          </p>
          <div style={{ marginTop: 12 }}>
            <Disclosure summary="Reglas del nivel intermedio (Convergencia)">
              <ReglasTabla reglas={d.reglas.intermedio} />
            </Disclosure>
          </div>
        </Card>

        <div className="grid grid--2">
          <Card title="Lo que aporto el Robot 1" sub={`Nota vigente en el momento de la decision: ${fmtDate(d.robot1.notaEn)}`}>
            <KeyValue
              items={[
                ['Oportunidad', <b key="o">{decimal(d.robot1.oportunidad)}</b>],
                ['Riesgo', <b key="r">{decimal(d.robot1.riesgo)}</b>],
                ['Veto', d.robot1.vetado ? <span className="text-critical">{d.robot1.vetos.join('; ') || 'vetado'}</span> : 'ninguno'],
                d.robot1.faltan.length > 0 && ['Datos que faltaron', d.robot1.faltan.join(', ')],
                c && ['Suma a favor', `${decimal(c.sumaAFavor)} de ${fmtNum(c.maximoPosible)} puntos posibles = ${decimal(c.oportunidadBase)}`],
                c && c.ajuste !== 0 && ['Ajuste por riesgo alto o mercado', decimal(c.ajuste)],
                c && ['Riesgo', `suma de los puntos en contra: ${decimal(c.sumaRiesgo)} (maximo 100; desde ${c.vetoRiesgo} veta)`],
              ]}
            />
            {c && (
              <div style={{ marginTop: 12 }}>
                <Disclosure summary={`Ver los ${c.aFavor.length + c.enContra.length} motivos con sus puntos`}>
                  <div className="stack" style={{ gap: 12 }}>
                    <ReasonList items={c.aFavor.map((m) => ({ text: m.texto, points: m.puntos }))} kind="good" empty="Sin motivos a favor" />
                    <ReasonList items={c.enContra.map((m) => ({ text: m.texto, points: m.puntos }))} kind="bad" empty="Sin riesgos" />
                  </div>
                </Disclosure>
              </div>
            )}
          </Card>

          <Card title="Lo que aporto el Robot 2" sub="Lo que se habia dicho en Telegram hasta el momento de la decision">
            <KeyValue
              items={[
                ['Canales que hablaron del token', fmtNum(d.robot2.fuentesTotal)],
                ['Canales independientes con informacion util', <b key="i">{fmtNum(d.robot2.fuentesIndep)}</b>],
                ['Reputacion media de esos canales', <b key="rep">{decimal(d.robot2.reputacionMedia)}</b>],
                ['Anticipacion sobre el precio', d.robot2.anticipacion],
              ]}
            />
            <p className="dim xs" style={{ margin: '10px 0 0' }}>
              La reputacion de un canal es el porcentaje de sus menciones medidas que aparecieron antes de que el precio subiera
              un 25 %. Se recalcula sola cada 30 minutos con resultados reales (src/telegram/anticipacion.ts).
            </p>
          </Card>
        </div>

        <Card title="Canales que aportaron informacion" sub="Primera mencion de cada canal, con el mensaje original." flush>
          {d.robot2.independientesRecalculados && (
            <p className="dim xs" style={{ margin: '0 20px 8px' }}>
              Que canales cuentan como independientes se ha recalculado con la misma funcion del Robot 3 (src/robot3/fuentes.ts)
              y la clasificacion actual de los mensajes.
            </p>
          )}
          <DataTable
            compact
            columns={[
              {
                key: 'canal',
                header: 'Canal',
                cell: (m) => (
                  <div className="stack" style={{ gap: 4, alignItems: 'flex-start' }}>
                    <span className="nowrap">@{m.canal ?? '?'}</span>
                    {m.independiente ? <Badge tono="good">independiente</Badge> : <Badge>no cuenta</Badge>}
                  </div>
                ),
              },
              { key: 'hora', header: 'Primera mencion', cell: (m) => <span className="nowrap small">{fmtDate(m.primera)}</span> },
              {
                key: 'msg',
                header: 'Mensaje original',
                cell: (m) => (
                  <div className="stack" style={{ gap: 4, alignItems: 'flex-start' }}>
                    {m.resumen && <span className="small">{m.resumen}</span>}
                    <span className="small dim" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                      {m.texto}
                    </span>
                    {m.clase && <MessageClassBadge clase={m.clase} />}
                  </div>
                ),
              },
              {
                key: 'rep',
                header: 'Reputacion',
                align: 'right',
                cell: (m) =>
                  m.reputacion === null ? (
                    <span className="dim small">sin historial</span>
                  ) : (
                    <div className="stack" style={{ gap: 2, alignItems: 'flex-end' }}>
                      <b>{decimal(m.reputacion)}</b>
                      <span className="dim xs nowrap">
                        {fmtNum(m.vecesPrimero)} veces primero de {fmtNum(m.tokensCitados)}
                      </span>
                    </div>
                  ),
              },
              { key: 'ant', header: 'Anticipacion', cell: (m) => <Anticipation seg={m.anticipacionSeg} veredicto={m.veredicto} /> },
            ]}
            rows={d.robot2.canales}
            rowKey={(m, i) => `${m.canal}-${i}`}
          />
        </Card>

        <div className="grid grid--2">
          <Card title="Explicacion del Robot 3">
            {d.motivo && (
              <p className="small" style={{ marginTop: 0 }}>
                <b>{d.motivo}</b>
              </p>
            )}
            <div className="stack" style={{ gap: 6 }}>
              {d.explicacion.map((e, i) => (
                <span key={`e${i}`} className="small">
                  • {e}
                </span>
              ))}
              {d.confirmaciones.map((e, i) => (
                <span key={`c${i}`} className="small text-good">
                  ✓ {e}
                </span>
              ))}
              {d.contradicciones.map((e, i) => (
                <span key={`x${i}`} className="small text-critical">
                  ✗ {e}
                </span>
              ))}
            </div>
          </Card>

          <Card title="Historial de niveles" sub="Cada cambio de nivel, con los valores y el precio de ese momento" flush>
            <DataTable
              compact
              columns={[
                { key: 'ts', header: 'Momento', cell: (h) => <span className="nowrap small">{fmtDate(h.ts)}</span> },
                { key: 'n', header: 'Nivel', cell: (h) => <LevelBadge nivel={h.nivel} /> },
                { key: 'o', header: 'Oport.', align: 'right', cell: (h) => decimal(h.tecnica) },
                { key: 'r', header: 'Riesgo', align: 'right', cell: (h) => decimal(h.riesgo) },
                { key: 'f', header: 'Fuentes', align: 'right', cell: (h) => fmtNum(h.fuentes) },
                { key: 'p', header: 'Precio', align: 'right', cell: (h) => <span className="nowrap">{fmtPrice(h.precio)}</span> },
              ]}
              rows={d.historial}
              rowKey={(h, i) => `${h.ts}-${i}`}
            />
          </Card>
        </div>

        <Card title="Para revisarlo en el codigo y en la base de datos">
          <KeyValue
            items={[
              ['Veredicto', <span key="v" className="mono xs">tg_candidatos · id {d.traza.candidatoId}</span>],
              ['Cambios de nivel', <span key="h" className="mono xs">tg_candidatos_historial · candidato_id {d.traza.candidatoId}</span>],
              d.traza.scoreId !== null && ['Nota del Robot 1 usada', <span key="s" className="mono xs">scores · id {d.traza.scoreId}</span>],
              d.traza.tokenId !== null && ['Token', <span key="t" className="mono xs">tokens · id {d.traza.tokenId}</span>],
              ['Menciones de Telegram', <span key="m" className="mono xs">tg_mentions + tg_messages + tg_channels</span>],
              d.traza.alertaId !== null && ['Aviso enviado', <span key="a" className="mono xs">alerts · id {d.traza.alertaId}</span>],
              ['Reglas y decision', <span key="r" className="mono xs">src/robot3/convergencia.ts · reglasNivelMaximo(), decidir()</span>],
              ['Umbrales', <span key="u" className="mono xs">config/robot3.yaml</span>],
              ['Recogida de los datos', <span key="e" className="mono xs">src/robot3/evaluador.ts · evaluarToken()</span>],
              ['Fuentes independientes', <span key="f" className="mono xs">src/robot3/fuentes.ts · contarFuentes()</span>],
              ['Reputacion y anticipacion', <span key="ra" className="mono xs">src/telegram/anticipacion.ts</span>],
              ['Nota del Robot 1', <span key="n" className="mono xs">src/scoring/engine.ts + config/scoring.yaml</span>],
              ['Registro de actividad', <span key="l" className="mono xs">journalctl -u crypto-radar · tabla activity_log</span>],
            ]}
          />
          <pre className="codeblock">{`SELECT * FROM tg_candidatos WHERE id = ${d.traza.candidatoId};
SELECT * FROM tg_candidatos_historial WHERE candidato_id = ${d.traza.candidatoId} ORDER BY ts;${
            d.traza.scoreId !== null ? `\nSELECT * FROM scores WHERE id = ${d.traza.scoreId};` : ''
          }`}</pre>
        </Card>
      </div>
    </Section>
  );
}
