import { Link } from 'react-router-dom';
import { ArrowRight, GitMerge, Radar, Send } from 'lucide-react';
import type { ReactNode } from 'react';
import type { ResumenRobot } from '../../api/types';
import { Card } from '../ui/Card';
import { Badge } from '../ui/Badge';
import { Skeleton, SkeletonText } from '../ui/Skeleton';
import { colorTono, type Tono } from '../../lib/labels';
import { fmtDuration, fmtNum } from '../../lib/format';

const ICONOS: Record<ResumenRobot['id'], ReactNode> = {
  robot1: <Radar />,
  robot2: <Send />,
  robot3: <GitMerge />,
};

const ESTADOS: Record<ResumenRobot['estado'], { texto: string; tono: Tono }> = {
  funcionando: { texto: 'Funcionando', tono: 'good' },
  parado: { texto: 'Parado', tono: 'critical' },
  arrancando: { texto: 'Arrancando', tono: 'neutral' },
};

/** Un robot de un vistazo: si funciona, que ha sacado hoy y donde ver el detalle. */
export function RobotCard({ robot }: { robot: ResumenRobot }) {
  const estado = ESTADOS[robot.estado];
  return (
    <Card className="robot-card" accent={colorTono[estado.tono]}>
      <div className="robot-card__head">
        <span className="stat__icon">{ICONOS[robot.id]}</span>
        <h3 className="robot-card__name">{robot.nombre}</h3>
        <Badge tono={estado.tono} dot>
          {estado.texto}
        </Badge>
      </div>
      <p className="robot-card__func">{robot.funcion}</p>

      {robot.paradas.length > 0 && (
        <p className="robot-card__alarm">Sin dar senales: {robot.paradas.join(', ')}</p>
      )}

      <dl className="robot-card__nums">
        {robot.cifras.map((c) => (
          <div key={c.etiqueta}>
            <dt>{c.etiqueta}</dt>
            <dd className="num">{fmtNum(c.valor)}</dd>
          </div>
        ))}
      </dl>

      <div className="robot-card__lista">
        <div className="robot-card__lista-titulo">Cuales son (hoy)</div>
        {robot.tokens.length === 0 ? (
          <p className="dim small" style={{ margin: 0 }}>
            Hoy todavia no hay ninguno.
          </p>
        ) : (
          <ul>
            {robot.tokens.map((t) => (
              <li key={`${t.chain}:${t.address}`}>
                <Link to={`/token/${t.chain}/${t.address}${robot.id === 'robot3' ? '#decision-robot3' : ''}`} className="robot-card__token">
                  {t.symbol ?? t.address.slice(0, 6)}
                </Link>
                <Badge tono={t.tono}>{t.etiqueta}</Badge>
                <span className="robot-card__detalle">{t.detalle}</span>
              </li>
            ))}
          </ul>
        )}
        <Link to={robot.rutaLista} className="robot-card__link small">
          Ver la lista completa de hoy <ArrowRight />
        </Link>
      </div>

      {robot.nota && <p className="robot-card__note">{robot.nota}</p>}

      <div className="robot-card__foot">
        <span className="dim">
          {robot.ultimaVueltaMs === null ? 'Aun sin vueltas' : `Ultima vuelta hace ${fmtDuration(robot.ultimaVueltaMs)}`}
        </span>
        <Link to={robot.ruta} className="robot-card__link">
          Ver detalle <ArrowRight />
        </Link>
      </div>
    </Card>
  );
}

export function RobotCardSkeleton() {
  return (
    <Card className="robot-card">
      <div className="robot-card__head">
        <Skeleton width={28} height={28} />
        <Skeleton width="55%" height={16} />
      </div>
      <SkeletonText lines={2} />
      <dl className="robot-card__nums">
        {[0, 1, 2, 3].map((i) => (
          <div key={i}>
            <Skeleton width="70%" height={11} />
            <Skeleton width="45%" height={22} />
          </div>
        ))}
      </dl>
    </Card>
  );
}
