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
 * veredictos guardados antes siguen con los numeros viejos, y algunos
 * muestran imposibles como "4 de 1 fuentes independientes".
 *
 * QUE HACE CON CADA VEREDICTO
 *   - Si aun estan sus mensajes de Telegram: se vuelve a evaluar con el
 *     mismo codigo del robot, sin enviar ningun aviso.
 *   - Si los mensajes ya no estan (el periodo recuperado del 9 al 21 de
 *     septiembre): no se puede recontar, asi que se limita al maximo que
 *     permite la regla corregida, que es el numero de canales.
 *   - Si ya se aviso al cliente: NO se toca. Es el registro de lo que se
 *     envio, y reescribirlo seria falsear el historial.
 */
import { query, exec, logActivity, closeDb } from '../src/core/db.js';
import { calcularVeredicto, evaluar } from '../src/robot3/evaluador.js';
import type { Chain } from '../src/core/types.js';

const aplicar = process.argv.includes('--aplicar');

interface Fila {
  chain: Chain;
  address: string;
  symbol: string | null;
  primera_mencion: Date;
  nivel: string;
  fuentes_total: number;
  fuentes_indep: number;
}

// --- 1. Veredictos que aun tienen sus mensajes ------------------------------
const conMensajes = await query<Fila>(
  `SELECT c.chain, c.address, t.symbol, c.primera_mencion, c.nivel, c.fuentes_total, c.fuentes_indep
     FROM tg_candidatos c
     LEFT JOIN tokens t ON t.chain = c.chain AND t.address = c.address
    WHERE c.enviado_at IS NULL
      AND EXISTS (SELECT 1 FROM tg_mentions me WHERE me.chain = c.chain AND me.address = c.address)
    ORDER BY c.primera_mencion`,
);

let recontados = 0;
let sinCambios = 0;
const saltados: string[] = [];
const cambios: string[] = [];
for (const f of conMensajes) {
  const nombre = f.symbol ?? f.address.slice(0, 8);
  const c = await calcularVeredicto(f.chain, f.address);
  if (!c) {
    saltados.push(`${nombre} (falta el analisis del Robot 1)`);
    continue;
  }
  // El robot guarda el veredicto bajo la primera mencion que conoce. Si
  // desde entonces aparecio una mas antigua, evaluar() crearia otra fila
  // en vez de corregir esta: mejor dejarla y decirlo.
  if (c.primera?.ts?.getTime() !== f.primera_mencion.getTime()) {
    saltados.push(`${nombre} (hay menciones mas antiguas que su veredicto)`);
    continue;
  }
  const antes = `${f.fuentes_indep} de ${f.fuentes_total}, ${f.nivel}`;
  const despues = `${c.r2.fuentesIndependientes} de ${c.r2.fuentesTotal}, ${c.veredicto.nivel}`;
  if (antes === despues) sinCambios++;
  else cambios.push(`${nombre.padEnd(14)} ${antes.padEnd(22)} -> ${despues}`);
  if (aplicar) await evaluar(f.chain, f.address, { avisar: false });
  recontados++;
}

// --- 2. Veredictos sin mensajes y con un recuento imposible ----------------
const sinMensajes = `
  enviado_at IS NULL AND fuentes_indep > fuentes_total
  AND NOT EXISTS (SELECT 1 FROM tg_mentions me WHERE me.chain = tg_candidatos.chain
                                                AND me.address = tg_candidatos.address)`;
const limitar = await query<{ nivel: string; n: number }>(
  `SELECT nivel, COUNT(*)::int AS n FROM tg_candidatos WHERE ${sinMensajes} GROUP BY nivel ORDER BY nivel`,
);
let limitados = 0;
if (aplicar) {
  // La nota social sumaba 20 puntos por fuente independiente, con tope de
  // 40: se le quita lo que aportaban las fuentes que no eran tales. El
  // nivel no cambia: ninguno de estos llego al maximo, y el intermedio solo
  // pide una fuente, que se sigue teniendo.
  limitados = await exec(
    `UPDATE tg_candidatos SET
       score_social  = GREATEST(0, score_social - LEAST(40, fuentes_indep * 20) + LEAST(40, fuentes_total * 20)),
       fuentes_indep = fuentes_total
     WHERE ${sinMensajes}`,
  );
}

// --- 3. Avisos ya enviados: se dejan como estan -----------------------------
const enviados = await query<{ symbol: string | null; address: string; fuentes_indep: number; fuentes_total: number }>(
  `SELECT t.symbol, c.address, c.fuentes_indep, c.fuentes_total
     FROM tg_candidatos c LEFT JOIN tokens t ON t.chain = c.chain AND t.address = c.address
    WHERE c.enviado_at IS NOT NULL ORDER BY c.enviado_at`,
);

console.log(`\n${aplicar ? 'APLICADO' : 'SOLO MUESTRA (anade --aplicar para guardar)'}\n`);
console.log(`Con mensajes, reevaluados con el codigo corregido: ${recontados}`);
console.log(`  sin cambios: ${sinCambios}   con cambios: ${cambios.length}`);
for (const c of cambios) console.log(`    ${c}`);
if (saltados.length) {
  console.log(`  no se pueden reevaluar: ${saltados.length}`);
  for (const s of saltados) console.log(`    ${s}`);
}
const totalLimitar = limitar.reduce((s, x) => s + x.n, 0);
console.log(`\nSin mensajes y con mas fuentes que canales, limitados al numero de canales: ${aplicar ? limitados : totalLimitar}`);
for (const x of limitar) console.log(`    ${x.nivel.padEnd(11)} ${x.n}`);
console.log(`\nAvisos ya enviados, que no se tocan: ${enviados.length}`);
for (const e of enviados) {
  console.log(`    ${(e.symbol ?? e.address.slice(0, 8)).padEnd(14)} ${e.fuentes_indep} de ${e.fuentes_total}`);
}

if (aplicar) {
  await logActivity(
    'info',
    'robot3',
    `Recuento de fuentes independientes corregido: ${recontados} veredictos reevaluados ` +
      `(${cambios.length} con cambios), ${limitados} limitados al numero de canales. ` +
      `Los ${enviados.length} avisos ya enviados se conservan tal cual.`,
    { recontados, cambios: cambios.length, limitados, saltados: saltados.length },
  );
}
console.log();
await closeDb();
process.exit(0);
