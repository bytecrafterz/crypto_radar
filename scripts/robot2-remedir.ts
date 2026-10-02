/**
 * Robot 2: vuelve a medir la anticipacion de las menciones ya medidas.
 *
 *     node --import tsx scripts/robot2-remedir.ts              (solo muestra)
 *     node --import tsx scripts/robot2-remedir.ts --aplicar    (guarda)
 *
 * POR QUE HACE FALTA
 * La medida tenia dos fallos, ya corregidos en src/telegram/anticipacion.ts:
 *   - Buscaba la subida previa al reves y detectaba caidas en vez de
 *     subidas: un canal que publicaba a mitad de una subida salia como
 *     "se adelanto" y ganaba reputacion por llegar tarde.
 *   - "No se movio" y "sin datos" se guardaban como 0 segundos, que el
 *     Robot 3 leia como la anticipacion perfecta.
 *   - Si el precio ya aparecia subido en la primera medicion despues del
 *     mensaje, contaba como adelanto aunque lo mas probable fuera que
 *     hubiera subido antes de publicarse.
 * Las menciones ya medidas conservan esos valores. Este script las mide
 * otra vez con el codigo corregido, sobre los mismos precios guardados.
 *
 * Las que aun no tienen la ventana de 24 h cumplida y no muestran
 * movimiento se dejan pendientes: las cerrara el robot cuando toque. La
 * reputacion de los canales se recalcula sola en la siguiente media hora.
 */
import { query, exec, logActivity, closeDb } from '../src/core/db.js';
import { calcularAnticipacion, VEREDICTOS_CON_MOVIMIENTO } from '../src/telegram/anticipacion.js';

const aplicar = process.argv.includes('--aplicar');
const VENTANA_HORAS = 24;

const medidas = await query<{
  id: number; token_id: number; posted_at: Date; seg: number | null; veredicto: string; cumplida: boolean;
}>(
  `SELECT m.id, t.id AS token_id, m.posted_at, m.anticipacion_seg AS seg, m.anticipacion_veredicto AS veredicto,
          m.posted_at < now() - ($1 || ' hours')::interval AS cumplida
     FROM tg_mentions m
     JOIN tokens t ON t.chain = m.chain AND t.address = m.address
    WHERE m.anticipacion_veredicto IS NOT NULL
    ORDER BY m.posted_at`,
  [VENTANA_HORAS],
);

const cambios = new Map<string, number>();
let cambiadas = 0;
for (const m of medidas) {
  const a = await calcularAnticipacion(m.token_id, new Date(m.posted_at));
  const conMovimiento = (VEREDICTOS_CON_MOVIMIENTO as readonly string[]).includes(a.veredicto);
  // Sin movimiento y con la ventana aun abierta: no se puede cerrar todavia.
  const nuevoVeredicto = conMovimiento || m.cumplida ? a.veredicto : null;
  const nuevoSeg = conMovimiento ? a.segundos : null;
  if (nuevoVeredicto === m.veredicto && nuevoSeg === m.seg) continue;

  const clave = `${m.veredicto} -> ${nuevoVeredicto ?? 'pendiente'}`;
  cambios.set(clave, (cambios.get(clave) ?? 0) + 1);
  cambiadas++;
  if (aplicar) {
    await exec(
      'UPDATE tg_mentions SET anticipacion_seg = $2, anticipacion_veredicto = $3 WHERE id = $1',
      [m.id, nuevoSeg, nuevoVeredicto],
    );
  }
}

console.log(`\n${aplicar ? 'APLICADO' : 'SOLO MUESTRA (anade --aplicar para guardar)'}\n`);
console.log(`Menciones ya medidas: ${medidas.length}   cambian: ${cambiadas}`);
for (const [clave, n] of [...cambios].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${clave.padEnd(34)} ${n}`);
}
console.log('\n("x -> x" con el mismo nombre es una mencion que conserva el veredicto pero');
console.log(' deja de guardar 0 segundos cuando no hubo movimiento.)\n');

if (aplicar) {
  await logActivity(
    'info',
    'robot2',
    `Anticipacion medida otra vez con el codigo corregido: ${cambiadas} de ${medidas.length} menciones cambian.`,
    Object.fromEntries(cambios),
  );
}
await closeDb();
process.exit(0);
