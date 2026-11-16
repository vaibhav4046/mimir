// Uploads an MP4 to Loom through the signed-in Comet browser (CDP on 9333) and prints the share URL.
//   node tools/loom-upload.mjs <file.mp4> [title]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire('D:/project/grok-bot-clone/package.json');
const { chromium } = require('playwright-core');
const file = path.resolve(process.argv[2]);
const title = process.argv[3] || '';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
const page = await ctx.newPage();
await page.setViewportSize({ width: 1400, height: 900 });
await page.goto('https://www.loom.com/looms/videos', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(5000);
await page.getByRole('button', { name: /New video/i }).first().click();
await page.waitForTimeout(1000);
await page.getByText(/Upload a video/i).first().click();
await page.waitForTimeout(1500);
const chooserP = page.waitForEvent('filechooser', { timeout: 30000 });
await page.getByText(/browse files/i).first().click();
const chooser = await chooserP;
await chooser.setFiles(file);
console.error('file chosen, uploading', file);
// Poll the library for a share link that was not there before (the dialog text is unreliable).
const known = new Set(['2528c92e151447ffb309f0b16df119de', '531f18cf15de4206a6de623873fb6671', '461ae98b078a45d6a444c2f65af54b4a']);
const lib = await ctx.newPage();
await lib.setViewportSize({ width: 1400, height: 900 });
for (let i = 0; i < 40; i++) {
  await lib.goto('https://www.loom.com/looms/videos', { waitUntil: 'domcontentloaded' });
  await lib.waitForTimeout(6000);
  const hrefs = await lib.evaluate(() => [...document.querySelectorAll('a[href*="/share/"]')].map(a => a.href.split('?')[0]));
  const fresh = hrefs.find(h => !known.has(h.split('/share/')[1]));
  if (fresh) { console.log(fresh); break; }
  console.error('not listed yet', i);
}
process.exit(0);
