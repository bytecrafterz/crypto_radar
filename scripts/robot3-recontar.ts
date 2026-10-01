/**
 * Robot 3: corrige los veredictos guardados con el recuento antiguo de fuentes.
 *
 *     node --import tsx scripts/robot3-recontar.ts              (solo muestra)
 *     node --import tsx scripts/robot3-recontar.ts --aplicar    (guarda)
 *
 * POR QUE HACE FALTA
 * Hasta ahora las fuentes independientes se contaban por textos distintos
 * y no por canales: un canal que hablaba dos veces de un token sumaba dos
 * fuentes. El codigo ya esta corregido (src/robot3/fuentes.ts), pero los
 * veredictos guardados antes conservan los numeros viejos, y algunos
 * muestran imposibles como "4 de 1 fuentes independientes".
 *
 * QUE CORRIGE, Y QUE NO
 * Solo el recuento. Con la regla nueva las fuentes independientes nunca
 * pasan del numero de canales, que es justo donde el recuento viejo se
 * pasaba: se limitan a ese numero y la nota social pierde lo que esas
 * fuentes de mas le sumaban. Comparado con los mensajes que aun se
 * conservan, da exactamente el valor de la regla nueva.
 *
 * NO se vuelve a evaluar el veredicto entero. Hacerlo usaria lo que se
 * supo despues (la nota final del Robot 1, mensajes clasificados mas
 * tarde) y reescribiria el pasado con ventaja: un token que luego salio
 * mal apareceria descartado a toro pasado, y el Robot 3 pareceria mejor
 * de lo que fue.
 *
 * Los avisos ya enviados no se tocan: son el registro de lo que recibio
 * el cliente.
 *
 * VEREDICTOS DUPLICADOS
 * Por otro fallo, ya corregido en evaluador.ts, cuando aparecia una
 * mencion mas antigua de un token ya evaluado se creaba una fila nueva y
 * la anterior se quedaba congelada a medias. De cada token se conserva la
 * fila que el robot siguio actualizando (la de la primera mencion mas
 * antigua, o la del aviso si se envio) y se borran las congeladas.
 *
 * AVISOS REESCRITOS DESPUES DE ENVIARSE
 * Antes de corregirse evaluador.ts, las vueltas siguientes a un aviso
 * podian reescribir su fila. Le paso a TRENDS: salio como alta
 * convergencia con oportunidad 55,4 y riesgo 10, y su fila acabo en
 * "amarillo" con 41 y 25. Se devuelve a lo que dice el propio aviso.
 */
import { query, exec, logActivity, closeDb } from '../src/core/db.js';
import { umbralesActuales } from '../src/robot3/umbrales.js';

const aplicar = process.argv.includes('--aplicar');
const minimoRojo = umbralesActuales().fuentesIndepMinimasRojo;

// --- 0. Avisos cuya fila se reescribio despues de enviarse -----------------
// Los valores salen del texto del aviso tal como llego a Discord el
// 19/09/2026 a las 01:57 UTC. Las notas se guardan redondeadas, como hace
// evaluador.ts.
const AVISOS_REESCRITOS = [
  { chain: 'solana', address: '3W3K5i4T2vARM1UzJHh48dw4uNhjtg3Wk8GS2inmNUZV', simbolo: 'TRENDS', tecnica: 55, riesgo: 10 },
];
let restaurados = 0;
for (const a of AVISOS_REESCRITOS) {
  const filtro = `chain = $1 AND address = $2 AND enviado_at IS NOT NULL
                  AND (nivel <> 'rojo' OR score_tecnica <> $3 OR score_riesgo <> $4)`;
  const pendiente = await query(`SELECT 1 FROM tg_candidatos WHERE ${filtro}`, [a.chain, a.address, a.tecnica, a.riesgo]);
  if (pendiente.length === 0) continue;
  console.log(`Aviso reescrito despues de enviarse: ${a.simbolo} -> rojo, oportunidad ${a.tecnica}, riesgo ${a.riesgo}`);
  if (aplicar) {
    restaurados += await exec(
      `UPDATE tg_candidatos SET nivel = 'rojo', score_tecnica = $3, score_riesgo = $4 WHERE ${filtro}`,
      [a.chain, a.address, a.tecnica, a.riesgo],
    );
  }
}

// --- 1. Filas congeladas de tokens con mas de un veredicto -----------------
const congeladas = `
  c.enviado_at IS NULL
  AND EXISTS (SELECT 1 FROM tg_candidatos o
               WHERE o.chain = c.chain AND o.address = c.address AND o.id <> c.id
                 AND (o.enviado_at IS NOT NULL OR o.primera_mencion < c.primera_mencion))`;
const duplicadas = await query<{ symbol: string | null; address: string; nivel: string; fuentes: string }>(
  `SELECT t.symbol, c.address, c.nivel, c.fuentes_indep || ' de ' || c.fuentes_total AS fuentes
     FROM tg_candidatos c LEFT JOIN tokens t ON t.chain = c.chain AND t.address = c.address
    WHERE ${congeladas} ORDER BY c.primera_mencion`,
);
let borradas = 0;
if (aplicar) borradas = await exec(`DELETE FROM tg_candidatos c WHERE ${congeladas}`);

// --- 2. Fuentes independientes por encima del numero de canales -------------
const filas = await query<{
  symbol: string | null; address: string; nivel: string; fuentes_indep: number; fuentes_total: number;
}>(
  `SELECT t.symbol, c.address, c.nivel, c.fuentes_indep, c.fuentes_total
     FROM tg_candidatos c LEFT JOIN tokens t ON t.chain = c.chain AND t.address = c.address
    WHERE c.enviado_at IS NULL AND c.fuentes_indep > c.fuentes_total
      AND NOT (${congeladas})
    ORDER BY c.primera_mencion`,
);

let corregidos = 0;
if (aplicar) {
  // El nivel solo puede cambiar en uno de maxima prioridad que se quede
  // por debajo del minimo de fuentes; el resto de sus condiciones son mas
  // duras que las del nivel intermedio, asi que baja a ese.
  corregidos = await exec(
    `UPDATE tg_candidatos SET
       score_social  = GREATEST(0, score_social - LEAST(40, fuentes_indep * 20) + LEAST(40, fuentes_total * 20)),
       nivel         = CASE WHEN nivel = 'rojo' AND fuentes_total < $1 THEN 'naranja' ELSE nivel END,
       fuentes_indep = fuentes_total
     WHERE enviado_at IS NULL AND fuentes_indep > fuentes_total`,
    [minimoRojo],
  );
}

const enviados = await query<{ symbol: string | null; address: string; fuentes_indep: number; fuentes_total: number }>(
  `SELECT t.symbol, c.address, c.fuentes_indep, c.fuentes_total
     FROM tg_candidatos c LEFT JOIN tokens t ON t.chain = c.chain AND t.address = c.address
    WHERE c.enviado_at IS NOT NULL ORDER BY c.enviado_at`,
);

console.log(`\n${aplicar ? 'APLICADO' : 'SOLO MUESTRA (anade --aplicar para guardar)'}\n`);
console.log(`Veredictos duplicados que se quedaron congelados: ${aplicar ? borradas : duplicadas.length}`);
for (const d of duplicadas.slice(0, 8)) {
  console.log(`    ${(d.symbol ?? d.address.slice(0, 8)).padEnd(14)} ${d.nivel.padEnd(11)} ${d.fuentes}`);
}
if (duplicadas.length > 8) console.log(`    ... y ${duplicadas.length - 8} mas`);

console.log(`\nVeredictos con mas fuentes independientes que canales: ${filas.length}`);
const porNivel = new Map<string, number>();
for (const f of filas) porNivel.set(f.nivel, (porNivel.get(f.nivel) ?? 0) + 1);
for (const [nivel, n] of porNivel) console.log(`    ${nivel.padEnd(11)} ${n}`);
const bajan = filas.filter((f) => f.nivel === 'rojo' && f.fuentes_total < minimoRojo);
console.log(`  bajan del nivel maximo al intermedio: ${bajan.length}`);
for (const f of filas.slice(0, 12)) {
  console.log(`    ${(f.symbol ?? f.address.slice(0, 8)).padEnd(14)} ${f.fuentes_indep} de ${f.fuentes_total} -> ${f.fuentes_total} de ${f.fuentes_total}`);
}
if (filas.length > 12) console.log(`    ... y ${filas.length - 12} mas`);
if (aplicar) console.log(`\nCorregidos: ${corregidos}`);

console.log(`\nAvisos ya enviados, que no se recalculan: ${enviados.length}`);
for (const e of enviados) {
  console.log(`    ${(e.symbol ?? e.address.slice(0, 8)).padEnd(14)} ${e.fuentes_indep} de ${e.fuentes_total}`);
}

if (aplicar) {
  await logActivity(
    'info',
    'robot3',
    `Veredictos del Robot 3 corregidos: ${borradas} duplicados congelados borrados, ` +
      `${corregidos} con mas fuentes independientes que canales limitados a ese numero y ` +
      `${restaurados} aviso enviado devuelto a lo que decia el aviso.`,
    { borradas, corregidos, restaurados },
  );
}
console.log();
await closeDb();
process.exit(0);
