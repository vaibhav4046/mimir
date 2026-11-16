// Posts text with a video to X through the signed-in Comet browser. Prints the post URL.
//   node tools/x-post.mjs <textfile> <video.mp4>
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const require = createRequire('D:/project/grok-bot-clone/package.json');
const { chromium } = require('playwright-core');
const text = fs.readFileSync(process.argv[2], 'utf8').trim();
const video = path.resolve(process.argv[3]);
const b = await chromium.connectOverCDP('http://127.0.0.1:9333');
const p = await b.contexts()[0].newPage();
await p.setViewportSize({ width: 1300, height: 900 });
const REPLY_TO = process.env.REPLY_TO;
await p.goto(REPLY_TO ? `https://x.com/intent/post?in_reply_to=${REPLY_TO}` : 'https://x.com/compose/post', { waitUntil: 'domcontentloaded', timeout: 60000 });
const box = p.locator('[data-testid="tweetTextarea_0"]').first();
await box.waitFor({ timeout: 30000 });
await box.click();
await p.keyboard.insertText(text);
await p.locator('input[type="file"]').first().setInputFiles(video, { timeout: 180000 });
console.error('video attached, waiting for processing');
const post = p.locator('[data-testid="tweetButton"]').first();
for (let i = 0; i < 120; i++) { if (await post.isEnabled().catch(() => false) && (await p.locator('[data-testid="attachments"] video, [data-testid="attachments"] img, [data-testid="attachments"]').count())) break; await p.waitForTimeout(2000); }
await p.waitForTimeout(8000);
await post.click();
await p.waitForTimeout(8000);
await p.goto(REPLY_TO ? 'https://x.com/mikeflag43/with_replies' : 'https://x.com/mikeflag43', { waitUntil: 'domcontentloaded' });
await p.waitForTimeout(5000);
const url = await p.evaluate(() => [...document.querySelectorAll('article')].map(a => ({ t: a.innerText, l: [...a.querySelectorAll('a[href*="/status/"]')].map(x => x.href)[0] })).find(x => new RegExp(process.env.MATCH || 'hydra_db').test(x.t))?.l || '');
console.log(url);
await p.close(); await b.close();
