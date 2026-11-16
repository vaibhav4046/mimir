// Records a live segment of the real Mimir app using its HydraDB tool memory: Settings card, then a real
// chat turn, then the header chip. Nothing is mocked; the numbers on screen come from the running daemon.
//   node tools/record-mimir-live.mjs [mimirUrl] [outFile]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(path.resolve('D:/project/grok-bot-clone/package.json'));
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:4571';
const OUT = path.resolve(process.argv[3] || 'D:/project/grok-bot-clone/contextgraph/results/mimir-live.mp4');
const WORK = path.resolve('D:/project/grok-bot-clone/contextgraph/results/mimir-live-work');
const VOICE = process.env.VOICE || 'en-US-AndrewNeural';
const ASK = 'What is 17 times 23? Use your math tool.';
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(path.join(WORK, 'audio'), { recursive: true });

const sleep = s => new Promise(r => setTimeout(r, s * 1000));
function tts(name, text) {
  const file = path.join(WORK, 'audio', `${name}.mp3`);
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync('python', ['-m', 'edge_tts', '--voice', VOICE, '--rate=-2%', '--text', text, '--write-media', file], { stdio: ['ignore', 'ignore', 'pipe'] });
      break;
    } catch (err) {
      if (attempt >= 4) throw err;
      execFileSync('python', ['-c', 'import time; time.sleep(3)']);
    }
  }
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
  return { file, dur };
}

const L = {
  a: `Now the product this plugs into: Mimir, my local AI agent workspace. In Settings there is a new card, Tool memory. It keeps a graph of what every tool does in a HydraDB node on this computer. I turn it on.`,
  b: `Now I ask Mimir for something real. Normally the model would read the manuals for every tool before it answers. This time HydraDB picks the few tools this request needs.`,
  c: `Look at the header: tool memory offered only a handful of Mimir's eighteen tools, in milliseconds, the model used the math tool, and the graph learned from that. If HydraDB is ever down or unsure, Mimir quietly offers every tool, exactly as before.`,
};
const clips = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, tts(k, v)]));

const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, recordVideo: { dir: WORK, size: { width: 1600, height: 900 } }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;z-index:99999;width:26px;height:26px;border-radius:50%;background:rgba(255,91,31,.85);border:3px solid #fff;pointer-events:none;transform:translate(-50%,-50%);left:-50px;top:-50px';
    document.body.appendChild(c);
    addEventListener('mousemove', e => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
  });
});
const page = await ctx.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const starts = [];
const place = id => starts.push({ id, at: now() });
const moveTo = async loc => {
  const b = await loc.boundingBox();
  if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 25 });
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await sleep(1.2);

// A. Settings -> Tool memory card -> turn it on.
place('a');
const aStart = now();
await page.getByText('Settings', { exact: true }).first().click();
const card = page.locator('[data-testid=context-graph-card]');
await card.waitFor({ timeout: 20000 });
await card.scrollIntoViewIfNeeded();
await sleep(2.5);
const toggle = page.locator('[data-testid=context-graph-toggle]');
await moveTo(toggle);
await sleep(Math.max(1, clips.a.dur - 9 - (now() - aStart)));
await toggle.click();
await page.locator('[data-testid=context-graph-status]').getByText(/^On/).waitFor({ timeout: 15000 });
await sleep(Math.max(0.5, aStart + clips.a.dur + 0.7 - now()));

// B. Ask a real question in chat.
await page.getByText('Chat', { exact: true }).first().click();
const box = page.getByPlaceholder(/Message Mimir/i);
await box.waitFor({ timeout: 20000 });
place('b');
const bStart = now();
await moveTo(box);
await box.click();
await page.keyboard.type(ASK, { delay: 55 });
await sleep(0.6);
await page.keyboard.press('Enter');

// Wait for the real answer (17 x 23 = 391) and the chip.
await page.waitForFunction(() => document.body.textContent.includes('391') && /Tool memory: \d+ of \d+/.test(document.body.textContent), null, { timeout: 170000 });
await sleep(2);
const chip = page.locator('[data-testid=context-graph-chip]');
await chip.waitFor({ timeout: 20000 });
await moveTo(chip);
const chipText = (await chip.textContent())?.trim();
console.error('chip:', chipText);
await sleep(Math.max(0.5, bStart + clips.b.dur + 0.5 - now()));

// C. Point at the chip while explaining.
place('c');
await sleep(clips.c.dur + 1.2);

const video = page.video();
await ctx.close();
await browser.close();
const webm = await video.path();
const ids = starts.map(s => s.id);
const inputs = ['-i', webm, ...ids.flatMap(id => ['-i', clips[id].file])];
const filters = ids.map((id, i) => `[${i + 1}:a]adelay=${Math.round(starts[i].at * 1000)}|${Math.round(starts[i].at * 1000)}[a${i}]`).join(';');
const mix = `${ids.map((_, i) => `[a${i}]`).join('')}amix=inputs=${ids.length}:normalize=0[aout]`;
execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', `${filters};${mix};[0:v]scale=1920:1080:flags=lanczos,fps=25[v]`, '-map', '[v]', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', OUT], { stdio: ['ignore', 'ignore', 'inherit'] });
const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUT]).toString().trim());
console.log(`wrote ${OUT} (${secs.toFixed(0)} s) chip="${chipText}"`);
