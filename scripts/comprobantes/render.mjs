import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('/home/tommy/apps/Santtify/node_modules/playwright');
const [,, ...pairs] = process.argv;
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
const p = await ctx.newPage();
for (let i = 0; i < pairs.length; i += 2) { await p.goto('file://' + pairs[i], { waitUntil: 'load' }); await p.waitForTimeout(300); const h = await p.evaluate(() => document.querySelector('.wrap').getBoundingClientRect().height); await p.setViewportSize({ width: 1400, height: Math.ceil(h) }); await p.screenshot({ path: pairs[i+1], fullPage: true }); console.log('ok', pairs[i+1], Math.ceil(h)+'px'); }
await b.close();
