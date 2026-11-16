// Screenshots the real pages the pitch quotes, with the quoted text highlighted, so the evidence
// shown in the video is the source itself and not a retyped number.
//   node tools/shoot-evidence.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire(path.resolve('D:/project/grok-bot-clone/package.json'));
const { chromium } = require('playwright-core');

const OUT = new URL('../app/public/evidence/', import.meta.url);
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const SHOTS = [
  { file: 'anthropic.png', url: 'https://www.anthropic.com/engineering/advanced-tool-use', find: ['134K tokens', '85% reduction'] },
  { file: 'rag-mcp.png', url: 'https://arxiv.org/abs/2505.03275', find: ['43.13%', '13.62%'] },
  { file: 'willison.png', url: 'https://simonwillison.net/2025/Aug/22/too-many-mcps/', find: ['55,000', 'perform worse'] },
];

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1.5 });
for (const s of SHOTS) {
  const page = await ctx.newPage();
  try {
    await page.goto(s.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2500);
    // Dismiss common cookie banners if present.
    for (const label of ['Reject all', 'Reject', 'Decline', 'Accept necessary only']) {
      const b = page.getByRole('button', { name: label }).first();
      if (await b.count().catch(() => 0)) await b.click({ timeout: 1500 }).catch(() => {});
    }
    const found = [];
    for (const term of s.find) {
      const ok = await page.evaluate(t => {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const n = walker.currentNode;
          const i = n.nodeValue.indexOf(t);
          if (i < 0) continue;
          const r = document.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + t.length);
          const mark = document.createElement('mark');
          mark.style.cssText = 'background:#ff5b1f;color:#000;padding:1px 3px;border-radius:3px';
          r.surroundContents(mark);
          mark.scrollIntoView({ block: 'center' });
          return true;
        }
        return false;
      }, term).catch(() => false);
      if (ok) found.push(term);
    }
    await page.waitForTimeout(600);
    await page.screenshot({ path: new URL(s.file, OUT).pathname.replace(/^\/([A-Za-z]:)/, '$1'), type: 'png' });
    console.log(s.file, 'highlighted:', found.join(' | ') || '(nothing found)');
  } catch (e) {
    console.log(s.file, 'FAILED', e.message.slice(0, 120));
  }
  await page.close();
}
await browser.close();
