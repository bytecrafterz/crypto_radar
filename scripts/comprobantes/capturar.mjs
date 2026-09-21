// Captura real del panel de Crypto Radar: capturas y video.
// Uso:  PANEL_PASSWORD=... node capturar.mjs <dir_salida> [grupo]
//   grupo = r12  -> solo las paginas de los Robots 1 y 2, video 'recorrido-robots-1-y-2'
//   grupo = r3   -> solo la pagina del Robot 3,          video 'recorrido-robot-3'
//   sin grupo    -> todas las paginas
// Sin PANEL_PASSWORD solo captura la pantalla de entrada (publica).
import { createRequire } from 'node:module';
import { mkdirSync, globSync } from 'node:fs';
const require = createRequire(import.meta.url);
// Playwright no es una dependencia del proyecto: solo hace falta para sacar
// estas capturas, y no tiene por que viajar en la entrega. Se busca alla
// donde este instalado en la maquina, y si no aparece se dice como ponerlo,
// en vez de fallar con un error de modulo que no explica nada.
const CANDIDATOS = [
  'playwright',
  '/home/tommy/apps/my portfolio/node_modules/playwright',
  '/home/tommy/apps/Santtify/node_modules/playwright',
  '/usr/lib/node_modules/playwright',
];
let chromium = null;
for (const ruta of CANDIDATOS) {
  try { ({ chromium } = require(ruta)); break; } catch { /* se prueba el siguiente */ }
}
if (!chromium) {
  console.error('No encuentro playwright. Instalalo con:  npm i -g playwright && npx playwright install chromium');
  process.exit(1);
}

const BASE = 'http://127.0.0.1:3000';
const OUT = process.argv[2] || '.';
const GRUPO = process.argv[3] || '';
const PASS = process.env.PANEL_PASSWORD || '';
mkdirSync(OUT, { recursive: true });

const TODAS = [
  ['/',             '01-panel-principal',     'r12'],
  ['/tokens',       '02-tokens-detectados',   'r12'],
  ['/alertas',      '03-alertas-enviadas',    'r12'],
  ['/resultados',   '04-resultados',          'r12'],
  ['/sistema',      '05-estado-del-sistema',  'r12'],
  ['/telegram',     '06-robot2-telegram',     'r12'],
  ['/convergencia', '07-robot3-convergencia', 'r3'],
];
const PAGINAS = GRUPO ? TODAS.filter((p) => p[2] === GRUPO) : TODAS;
const NOMBRE_VIDEO = GRUPO === 'r12' ? 'recorrido-robots-1-y-2' : GRUPO === 'r3' ? 'recorrido-robot-3' : 'recorrido-panel';

// La version de playwright instalada y los navegadores descargados no
// siempre coinciden de numero. Si el que espera no esta, se usa el que si
// hay en la cache, en vez de pedir una descarga de 150 MB que aqui no hace
// falta.
function navegadorInstalado() {
  const cache = `${process.env.HOME}/.cache/ms-playwright`;
  for (const patron of ['chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell',
                        'chromium-*/chrome-linux/chrome']) {
    const encontrados = globSync(`${cache}/${patron}`);
    if (encontrados.length) return encontrados.sort().at(-1);
  }
  return undefined;
}
const browser = await chromium.launch({ executablePath: navegadorInstalado() });
async function sesion(viewport, etiqueta, video) {
  const ctx = await browser.newContext({
    viewport, deviceScaleFactor: 1.5,
    ...(video ? { recordVideo: { dir: OUT, size: viewport } } : {}),
    ...(etiqueta === 'movil' ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await ctx.newPage();
  await page.goto(BASE + '/entrar', { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/00-entrada-${etiqueta}.png`, fullPage: true });
  if (PASS) {
    await page.fill('input[name="password"]', PASS);
    await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle' }), page.keyboard.press('Enter')]);
    for (const [ruta, nombre] of PAGINAS) {
      // 'domcontentloaded' y no 'networkidle': la pagina de Telegram mide
      // veinte mil pixeles y nunca llega a quedarse quieta del todo, asi que
      // esperar al silencio de red acababa siempre en timeout. Se espera a
      // que el HTML este y luego se da un margen fijo para que pinte.
      await page.goto(BASE + ruta, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await page.waitForTimeout(1200);
      // En el video se deja tiempo para leer y se baja despacio por la pagina.
      if (video) { await page.waitForTimeout(1500); await page.evaluate(async () => { for (let y = 0; y < Math.min(document.body.scrollHeight, 6000); y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 120)); } window.scrollTo(0, 0); }); await page.waitForTimeout(800); }
      else await page.waitForTimeout(400);
      await page.screenshot({ path: `${OUT}/${nombre}-${etiqueta}.png`, fullPage: true });
      console.log(`  ${nombre}-${etiqueta}.png`);
    }
  } else {
    console.log(`  00-entrada-${etiqueta}.png  (sin PANEL_PASSWORD: solo la entrada)`);
  }
  const ruta = video ? await page.video()?.path() : null;
  await ctx.close();
  return ruta;
}
const v = await sesion({ width: 1440, height: 900 }, 'escritorio', true);
await sesion({ width: 390, height: 844 }, 'movil', false);
await browser.close();
if (v) { const { renameSync } = await import('node:fs'); const dest = `${OUT}/${NOMBRE_VIDEO}.webm`; renameSync(v, dest); console.log('video:', dest); }
