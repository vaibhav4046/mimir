// Screenshots every deck scene at 1920x1080 (all reveals shown) so the layout can be checked.
//   node tools/shoot-deck.mjs [baseUrl]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(path.resolve('D:/project/grok-bot-clone/package.json'));
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:7860';
const OUT = path.resolve('D:/project/grok-bot-clone/contextgraph/results/deck-shots');
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
await page.goto(`${BASE}/#/deck?scene=1`);
await page.waitForFunction(() => window.deckApi);
await page.addStyleTag({ content: '*{transition:none!important}' });
for (let i = 0; i < 10; i++) {
  await page.evaluate(n => window.deckApi.goto(n, 9), i);
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(n => {
    const sc = document.querySelector(`.scene[data-i="${n}"]`);
    const r = sc.getBoundingClientRect();
    return [...sc.querySelectorAll('*')].filter(e => { const b = e.getBoundingClientRect(); return b.width && (b.right > r.right + 2 || b.bottom > r.bottom + 2); }).map(e => e.className || e.tagName).slice(0, 3);
  }, i);
  await page.screenshot({ path: path.join(OUT, `scene-${String(i + 1).padStart(2, '0')}.png`) });
  console.log(`scene ${i + 1}`, overflow.length ? `OVERFLOW: ${overflow.join(', ')}` : 'fits');
}
await browser.close();
