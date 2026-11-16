// The short launch film (about 90 seconds): motion-design scenes, the live app, a deep sage voice.
// Reuses the deck and the real app; every number on screen is from results.json.
//   node tools/record-film.mjs [baseUrl] [outFile]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(path.resolve('D:/project/grok-bot-clone/package.json'));
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:7860';
const OUTFILE = path.resolve(process.argv[3] || 'D:/project/grok-bot-clone/contextgraph/results/launch-film.mp4');
const WORK = path.resolve('D:/project/grok-bot-clone/contextgraph/results/film-work');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(path.join(WORK, 'audio'), { recursive: true });

const R = await (await fetch(`${BASE}/api/results`)).json();
const J = R.jargon;
const L = [
  ['f0', 0, `Meet your AI agent. Before it answers a single question, it reads the instruction manual for every app you've connected. Every single time.`],
  ['f1', 1, `That's tens of thousands of words of instructions, before it even sees your question. That's Anthropic's own measurement, not mine.`],
  ['f2', 2, `Researchers found that if you hand an agent only the tools it needs, instead of all of them, it picks the right one more than three times as often.`],
  ['f5', 5, `So I built a memory for agents, on HydraDB, a graph database. It remembers which tools go with which jobs, and which apps belong to which clients. Ask for something, and it hands the agent just the few tools that job needs.`],
  ['f6a', 'demo-a', `Here it is, live, with two hundred sixty-four tools. I ask for something it has never seen, and it picks a handful, and shows you why.`],
  ['f6b', 'demo-b', `Now a harder job. It misses one tool, so I tell it what it needed. That one correction is all it takes.`],
  ['f6c', 'demo-c', `Ask for the same job in different words, and now it gets it.`],
  ['f7', 7, J ? `It learns your team's own shorthand too. A made-up word, like bluebird, goes from never found, to found nine times out of ten, after a single example. And it's honest about its limits: on everyday phrasing it only improves a little, and it gets slower as the catalog grows. Those are my next fixes.` : `It learns from every task.`],
  ['f11', 11, `It's open source, built on HydraDB, and the live demo is linked below. I'm Vaibhav. Thanks for watching.`],
];const clips = {};
for (const [id, , say] of L) {
  const file = path.join(WORK, 'audio', `${id}.mp3`);
  execFileSync('python', ['-m', 'edge_tts', '--voice', 'en-US-AndrewNeural', '--rate=-4%', '--text', say, '--write-media', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  clips[id] = { file, dur: Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim()) };
}
console.error('film audio:', Object.entries(clips).map(([k, c]) => `${k}=${c.dur.toFixed(1)}s`).join(' '), 'total', Object.values(clips).reduce((s, c) => s + c.dur, 0).toFixed(0), 's');

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: WORK, size: { width: 1920, height: 1080 } } });
await ctx.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;z-index:99999;width:26px;height:26px;border-radius:50%;background:rgba(255,91,31,.85);border:3px solid #fff;pointer-events:none;transform:translate(-50%,-50%);left:-50px;top:-50px;transition:left .3s ease,top .3s ease;box-shadow:0 4px 18px rgba(0,0,0,.5)';
    document.body.appendChild(c);
    addEventListener('mousemove', e => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
  });
});
const page = await ctx.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const sleep = s => new Promise(r => setTimeout(r, s * 1000));
const starts = [];
const at = (id, clip) => starts.push({ id, at: now() });

async function card(idx, id) {
  const clip = clips[id];
  at(id);
  await page.evaluate(i => window.deckApi.goto(i, 0), idx);
  const maxL = await page.evaluate(i => window.deckApi.maxLevel(i), idx);
  const began = now();
  for (let l = 1; l <= maxL; l++) {
    await sleep(Math.max(0, began + (clip.dur * l) / (maxL + 1) - now()));
    await page.evaluate(lv => window.deckApi.reveal(lv), l);
  }
  await sleep(Math.max(0, began + clip.dur + 0.6 - now()));
}
const glide = async sel => {
  const el = page.locator(sel).first();
  await el.scrollIntoViewIfNeeded();
  const b = await el.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 18 });
};
const click = async sel => { await glide(sel); await page.waitForTimeout(150); await page.locator(sel).first().click(); };
const ask = async text => {
  await click('#q');
  await page.locator('#q').fill('');
  await page.keyboard.type(text, { delay: 22 });
  const prev = await page.locator('#meta').textContent();
  await click('#go');
  await page.waitForFunction(p => document.querySelector('#meta').textContent !== p && document.querySelector('#out .tool'), prev, { timeout: 30000 });
  await page.waitForTimeout(500);
};

await page.goto(`${BASE}/#/deck?scene=1`);
await page.waitForFunction(() => window.deckApi, null, { timeout: 30000 });
await sleep(0.5);
await card(0, 'f0');
await card(1, 'f1');
await card(2, 'f2');
await card(5, 'f5');
// live app
await page.goto(`${BASE}/#/`);
await page.waitForSelector('#chips .chip', { timeout: 60000 });
await sleep(0.4);
const hold = async (id, work) => { const b = now(); at(id); await work(); await sleep(Math.max(0, b + clips[id].dur + 0.4 - now())); };
await hold('f6a', async () => { await ask('Do the competitor watch and note what is new'); await glide('.graph'); });
await hold('f6b', async () => {
  await ask('Handle the outage: dig into the errors and post an update');
  await click('#no');
  await page.waitForSelector('#ps');
  for (const id of ['slack__post_message', 'sentry__list_errors', 'sentry__get_error_details']) await click(`.pick[data-id="${id}"]`);
  await click('#ps');
  await page.keyboard.type('cloudwatch', { delay: 40 });
  await click('.pick[data-id="aws__cloudwatch_get_logs"]');
  await click('#teach');
  await page.waitForSelector('.learned', { timeout: 30000 });
});
await hold('f6c', async () => { await ask('Something broke after the release, investigate and tell everyone'); await glide('.graph'); });
await page.goto(`${BASE}/#/deck?scene=8`);
await page.waitForFunction(() => window.deckApi, null, { timeout: 30000 });
await card(7, 'f7');
await card(11, 'f11');
await sleep(1);
const video = page.video();
await ctx.close();
await browser.close();
const webm = await video.path();
const ids = starts.map(s => s.id);
const inputs = ['-i', webm, ...ids.flatMap(id => ['-i', clips[id].file])];
const filters = ids.map((id, i) => `[${i + 1}:a]adelay=${Math.round(starts[i].at * 1000)}|${Math.round(starts[i].at * 1000)}[a${i}]`).join(';');
execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', `${filters};${ids.map((_, i) => `[a${i}]`).join('')}amix=inputs=${ids.length}:normalize=0[aout]`, '-map', '0:v', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', OUTFILE].map(a => (a === '-pix_fmt' ? '-pix_fmt' : a)), { stdio: ['ignore', 'ignore', 'inherit'] });
const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUTFILE]).toString().trim());
console.log(`wrote ${OUTFILE} (${secs.toFixed(0)} s, ${(fs.statSync(OUTFILE).size / 1e6).toFixed(1)} MB)`);
