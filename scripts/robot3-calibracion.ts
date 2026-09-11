/**
 * Robot 3: que nivel alcanzaria cada token evaluado con los umbrales ACTUALES.
 *
 *     npm run robot3:calibracion
 *     (o: node --import tsx scripts/robot3-calibracion.ts)
 *
 * PARA QUE SIRVE
 * Los veredictos guardados en tg_candidatos llevan el nivel que se calculo
 * en su momento, con los umbrales de entonces. Al cambiar config/robot3.yaml
 * conviene saber, ANTES de esperar dias, cuantos de los tokens ya evaluados
 * habrian llegado a cada nivel con los umbrales nuevos. Es la forma honesta
 * de calibrar: contra los datos que ya hay, no contra lo que uno espera.
 *
 * No escribe nada. Solo lee y cuenta.
 */
import { query } from '../src/core/db.js';
import { decidir, type EntradaRobot1, type EntradaRobot2, type Nivel } from '../src/robot3/convergencia.js';
import { umbralesActuales } from '../src/robot3/umbrales.js';

interface Fila {
  chain: string; address: string; symbol: string | null;
  nivel: Nivel; fuentes_total: number; fuentes_indep: number; anticipacion_seg: number | null;
  score_fuentes: number; score_evidencia: number; score_tecnica: number; score_riesgo: number; vetado: boolean;
}

const filas = await query<Fila>(
  `SELECT c.chain, c.address, t.symbol, c.nivel, c.fuentes_total, c.fuentes_indep, c.anticipacion_seg,
          c.score_fuentes, c.score_evidencia, c.score_tecnica, c.score_riesgo, c.vetado
     FROM tg_candidatos c
     LEFT JOIN tokens t ON t.chain = c.chain AND t.address = c.address
    WHERE c.nivel IS NOT NULL
    ORDER BY c.primera_mencion DESC`,
);

const umbrales = umbralesActuales();

const guardado: Record<Nivel, number> = { descartado: 0, amarillo: 0, naranja: 0, rojo: 0 };
const nuevo: Record<Nivel, number> = { descartado: 0, amarillo: 0, naranja: 0, rojo: 0 };
const suben: string[] = [];
const bloqueos = { tecnica: 0, riesgo: 0, fuentes: 0, reputacion: 0, anticipacion: 0 };

for (const f of filas) {
  guardado[f.nivel]++;
  const r1: EntradaRobot1 = {
    opportunity: f.score_tecnica, risk: f.score_riesgo, vetoed: f.vetado, evaluable: true, vetos: [], motivosRiesgo: [],
  };
  const r2: EntradaRobot2 = {
    fuentesTotal: f.fuentes_total, fuentesIndependientes: f.fuentes_indep, anticipacionSeg: f.anticipacion_seg,
    reputacionMedia: f.score_fuentes, afirmacionVerificada: f.score_evidencia >= 100, tipoSenal: 'llamada',
  };
  const v = decidir(r1, r2, umbrales);
  nuevo[v.nivel]++;
  if (v.nivel === 'rojo' && f.nivel !== 'rojo') suben.push(`${f.symbol ?? f.address.slice(0, 8)} (${f.chain})`);
  // Que le falta a cada uno para el nivel maximo: dice donde esta el cuello de botella.
  if (!f.vetado && v.nivel !== 'rojo') {
    if (f.score_tecnica < umbrales.tecnicaMinimaRojo) bloqueos.tecnica++;
    if (f.score_riesgo > umbrales.riesgoMaximoRojo) bloqueos.riesgo++;
    if (f.fuentes_indep < umbrales.fuentesIndepMinimasRojo) bloqueos.fuentes++;
    if (f.score_fuentes < umbrales.reputacionMinimaRojo) bloqueos.reputacion++;
    if (!(f.anticipacion_seg && f.anticipacion_seg > 0)) bloqueos.anticipacion++;
  }
}

const etiqueta: Record<Nivel, string> = {
  rojo: 'Convergencia fuerte (avisa)', naranja: 'Convergencia', amarillo: 'Seguimiento', descartado: 'Descartado',
};
console.log(`ROBOT 3 · CALIBRACION SOBRE ${filas.length} TOKENS YA EVALUADOS`);
console.log(`Umbrales en config/robot3.yaml: tecnica>=${umbrales.tecnicaMinimaRojo} riesgo<=${umbrales.riesgoMaximoRojo} fuentes_indep>=${umbrales.fuentesIndepMinimasRojo} reputacion>=${umbrales.reputacionMinimaRojo}`);
console.log();
console.log('nivel                          guardado   con umbrales actuales');
for (const n of ['rojo', 'naranja', 'amarillo', 'descartado'] as Nivel[]) {
  console.log(`${etiqueta[n].padEnd(30)} ${String(guardado[n]).padStart(8)}   ${String(nuevo[n]).padStart(8)}`);
}
console.log();
if (suben.length) console.log(`Alcanzarian el nivel maximo: ${suben.join(', ')}`);
else console.log('Ningun token evaluado hasta ahora alcanza el nivel maximo con estos umbrales.');
console.log();
console.log('De los que no llegan al nivel maximo, cuantos fallan cada condicion:');
console.log(`  nota tecnica insuficiente     ${bloqueos.tecnica}`);
console.log(`  riesgo demasiado alto         ${bloqueos.riesgo}`);
console.log(`  menos de 2 fuentes indep.     ${bloqueos.fuentes}`);
console.log(`  reputacion insuficiente       ${bloqueos.reputacion}`);
console.log(`  sin anticipacion medida       ${bloqueos.anticipacion}`);
console.log();
console.log('Un token debe cumplir TODAS a la vez. La condicion con el numero mas alto es el cuello de botella real.');
process.exit(0);
