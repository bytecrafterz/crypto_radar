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
 */
import { query, exec, logActivity, closeDb } from '../src/core/db.js';
import { umbralesActuales } from '../src/robot3/umbrales.js';

const aplicar = process.argv.includes('--aplicar');
const minimoRojo = umbralesActuales().fuentesIndepMinimasRojo;

const filas = await query<{
  symbol: string | null; address: string; nivel: string; fuentes_indep: number; fuentes_total: number;
}>(
  `SELECT t.symbol, c.address, c.nivel, c.fuentes_indep, c.fuentes_total
     FROM tg_candidatos c LEFT JOIN tokens t ON t.chain = c.chain AND t.address = c.address
    WHERE c.enviado_at IS NULL AND c.fuentes_indep > c.fuentes_total
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
console.log(`Veredictos con mas fuentes independientes que canales: ${filas.length}`);
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

console.log(`\nAvisos ya enviados, que se conservan tal cual: ${enviados.length}`);
for (const e of enviados) {
  console.log(`    ${(e.symbol ?? e.address.slice(0, 8)).padEnd(14)} ${e.fuentes_indep} de ${e.fuentes_total}`);
}

if (aplicar) {
  await logActivity(
    'info',
    'robot3',
    `Recuento de fuentes independientes corregido en ${corregidos} veredictos guardados: ` +
      `ya no pasan del numero de canales. Los ${enviados.length} avisos enviados se conservan tal cual.`,
    { corregidos },
  );
}
console.log();
await closeDb();
process.exit(0);
