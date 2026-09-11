import { createRequire } from 'node:module'; import { readFileSync, writeFileSync, renameSync } from 'node:fs';
const require = createRequire(import.meta.url); const { chromium } = require('/home/tommy/apps/Santtify/node_modules/playwright');
const [,, html, out, slidesJson, seconds] = process.argv;
let src = readFileSync(html, 'utf8').replace('<script>', `<script data-slides='${slidesJson.replace(/'/g, '&#39;')}'>`);
const tmp = html.replace(/\.html$/, '.run.html'); writeFileSync(tmp, src);
const b = await chromium.launch(); const dir = out.replace(/[^/]+$/, '');
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, recordVideo: { dir, size: { width: 1440, height: 900 } } });
const p = await ctx.newPage(); await p.goto('file://' + tmp); await p.waitForTimeout(Number(seconds) * 1000);
const path = await p.video().path(); await ctx.close(); await b.close(); renameSync(path, out); console.log('video', out);
