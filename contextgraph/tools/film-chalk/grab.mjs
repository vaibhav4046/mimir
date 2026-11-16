// node grab.mjs outDir t1 t2 ...  -> JPEG frames for review
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const require = createRequire('D:/project/grok-bot-clone/package.json');
const { chromium } = require('playwright-core');
const [out, ...ts] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(pathToFileURL(path.resolve('index.html')).href);
for (const t of ts) {
  const d = await p.evaluate(t => { renderAt(t); return document.getElementById('c').toDataURL('image/jpeg', 0.9).split(',')[1]; }, Number(t));
  fs.writeFileSync(path.join(out, `c${String(t).padStart(5, '0')}.jpg`), Buffer.from(d, 'base64'));
}
await b.close();
if (errs.length) { console.error('ERRORS', errs.slice(0, 5)); process.exit(1); }
console.log('ok', ts.length);
