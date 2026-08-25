/**
 * Comprueba que el PDF conserva los fondos de color.
 *
 * Chrome elimina los fondos al imprimir salvo que se le diga lo contrario, y
 * en ese caso los bloques de ejemplo de alerta saldrian en blanco sin que se
 * note hasta abrir el fichero. Aqui se descomprimen los flujos del PDF y se
 * buscan los operadores de relleno de color.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const pdf = readFileSync(process.argv[2]);
const marcaInicio = Buffer.from('stream');
const marcaFin = Buffer.from('endstream');

let pos = 0;
let flujos = 0;
let conColor = 0;
const colores = new Set();

while (true) {
  const ini = pdf.indexOf(marcaInicio, pos);
  if (ini === -1) break;
  const fin = pdf.indexOf(marcaFin, ini);
  if (fin === -1) break;

  // Saltar 'stream' y el salto de linea que le sigue.
  let datosIni = ini + marcaInicio.length;
  if (pdf[datosIni] === 0x0d) datosIni++;
  if (pdf[datosIni] === 0x0a) datosIni++;

  const bruto = pdf.subarray(datosIni, fin);
  pos = fin + marcaFin.length;

  let texto = '';
  try {
    texto = inflateSync(bruto).toString('latin1');
    flujos++;
  } catch {
    continue; // no era un flujo comprimido (imagen, fuente, etc.)
  }

  // Operadores de color de relleno: "r g b rg" y rectangulos rellenos "re f"
  const rellenos = texto.match(/[\d.]+ [\d.]+ [\d.]+ rg/g) ?? [];
  const rects = texto.match(/re\s*\n?f/g) ?? [];
  if (rellenos.length > 0) {
    conColor++;
    for (const r of rellenos) colores.add(r.trim());
  }
  if (rects.length > 0) conColor += 0;
}

console.log(`Flujos descomprimidos      : ${flujos}`);
console.log(`Flujos con color de relleno: ${conColor}`);
console.log(`Colores distintos usados   : ${colores.size}`);

// El fondo oscuro del bloque de alerta es #1c2128 -> 0.109 0.129 0.157
const oscuros = [...colores].filter((c) => {
  const [r, g, b] = c.split(' ').map(Number);
  return r < 0.3 && g < 0.3 && b < 0.3 && !(r === 0 && g === 0 && b === 0);
});
const claros = [...colores].filter((c) => {
  const [r, g, b] = c.split(' ').map(Number);
  return r > 0.85 && g > 0.85 && b > 0.9;
});

console.log('');
console.log(`Fondos oscuros (bloques de alerta) : ${oscuros.length > 0 ? 'SI -> ' + oscuros.slice(0, 3).join(' | ') : 'NO'}`);
console.log(`Fondos claros (tablas y avisos)    : ${claros.length > 0 ? 'SI -> ' + claros.slice(0, 3).join(' | ') : 'NO'}`);

const ok = colores.size > 5 && oscuros.length > 0;
console.log('');
console.log(ok ? 'RESULTADO: el PDF conserva los colores' : 'RESULTADO: FALTAN COLORES en el PDF');
process.exit(ok ? 0 : 1);
