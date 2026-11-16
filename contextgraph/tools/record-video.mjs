// Records the pitch video: the deck and the live app are driven in a real browser, narrated with a
// neural voice, and muxed with ffmpeg. Everything on screen is the real running app.
//   node tools/record-video.mjs [baseUrl] [outFile]
// Needs: Chrome, ffmpeg + ffprobe on PATH, python with edge-tts (pip install edge-tts), internet for the voice.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { narration, mimirLines } from './narration.mjs';
import { demoSteps } from './demo-script.mjs';

const require = createRequire(path.resolve('D:/project/grok-bot-clone/package.json'));
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:7860';
const OUTFILE = path.resolve(process.argv[3] || 'D:/project/grok-bot-clone/contextgraph/results/pitch.mp4');
const WORK = path.resolve('D:/project/grok-bot-clone/contextgraph/results/video-work');
const VOICE = process.env.VOICE || 'en-US-AndrewNeural';
const PAD = 0.8;
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(path.join(WORK, 'audio'), { recursive: true });

const R = await (await fetch(`${BASE}/api/results`)).json();
const text = narration(R);
const demo = demoSteps(R);

function tts(name, content, sage = false) {
  const file = path.join(WORK, 'audio', `${name}.mp3`);
  const voice = sage ? ['--voice', 'en-GB-RyanNeural', '--rate=-10%', '--pitch=-12Hz'] : ['--voice', VOICE, '--rate=-2%'];
  execFileSync('python', ['-m', 'edge_tts', ...voice, '--text', content, '--write-media', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
  return { file, dur };
}

const clips = {};
for (const [k, v] of Object.entries(text)) clips[`s${k}`] = tts(`s${k}`, v);
for (const [k, v] of Object.entries(mimirLines)) clips[`m`] = tts(`m`, v, true);
for (const [k, v] of Object.entries(mimirLines)) clips[`m${k}`] = tts(`m${k}`, v, false);
for (const step of demo) if (step.say) clips[step.id] = tts(step.id, step.say);
console.error('audio:', Object.entries(clips).map(([k, c]) => `${k}=${c.dur.toFixed(1)}s`).join(' '));

const browser = await chromium.launch({ executablePath: process.env.CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: WORK, size: { width: 1920, height: 1080 } }, deviceScaleFactor: 1 });
await ctx.addInitScript(() => {
  addEventListener('DOMContentLoaded', () => {
    const c = document.createElement('div');
    c.style.cssText = 'position:fixed;z-index:99999;width:26px;height:26px;border-radius:50%;background:rgba(255,91,31,.85);border:3px solid #fff;pointer-events:none;transform:translate(-50%,-50%);left:-50px;top:-50px;transition:left .35s ease,top .35s ease,transform .12s;box-shadow:0 4px 18px rgba(0,0,0,.5)';
    document.body.appendChild(c);
    addEventListener('mousemove', e => { c.style.left = `${e.clientX}px`; c.style.top = `${e.clientY}px`; }, true);
    addEventListener('mousedown', () => { c.style.transform = 'translate(-50%,-50%) scale(.7)'; }, true);
    addEventListener('mouseup', () => { c.style.transform = 'translate(-50%,-50%) scale(1)'; }, true);
  });
});
const page = await ctx.newPage();
const t0 = Date.now();
const now = () => (Date.now() - t0) / 1000;
const starts = [];
const sleep = s => new Promise(r => setTimeout(r, s * 1000));
const place = (id, at = now()) => starts.push({ id, at });

async function slide(n, clip, id = `s${n}`) {
  const hold = clip.dur + PAD;
  place(id);
  await page.evaluate(i => window.deckApi.goto(i, 0), n);
  const maxL = await page.evaluate(i => window.deckApi.maxLevel(i), n);
  const began = now();
  for (let l = 1; l <= maxL; l++) {
    const until = began + (clip.dur * l) / (maxL + 1);
    await sleep(Math.max(0, until - now()));
    await page.evaluate(lv => window.deckApi.reveal(lv), l);
  }
  await sleep(Math.max(0, began + hold - now()));
}

await page.goto(`${BASE}/#/deck?scene=1`);
await page.waitForFunction(() => window.deckApi, null, { timeout: 30000 });
await sleep(0.6);
await slide(0, clips.m0, 'm0');
for (const n of [1, 2, 3, 4, 5]) await slide(n, clips[`s${n}`]);

// Scene 6: title card while the intro line plays, then the live app.
{
  const clip = clips.s6;
  place('s6');
  await page.evaluate(() => window.deckApi.goto(6, 0));
  await sleep(clip.dur + PAD);
  await page.goto(`${BASE}/#/`);
  await page.waitForSelector('#chips .chip', { timeout: 60000 });
  await sleep(0.8);
  for (const step of demo) {
    if (step.say) place(step.id);
    const began = now();
    await step.run(page, { sleep, now });
    if (step.say) await sleep(Math.max(0, began + clips[step.id].dur + 0.5 - now()));
  }
  await page.goto(`${BASE}/#/deck?scene=8`);
  await page.waitForFunction(() => window.deckApi, null, { timeout: 30000 });
}
for (const n of [7, 8, 9, 10]) await slide(n, clips[`s${n}`]);
await slide(11, clips.m11, 'm11');
await sleep(1.5);

const video = page.video();
await ctx.close();
await browser.close();
const webm = await video.path();

// Mux: place every clip at its recorded start time.
const ids = starts.map(s => s.id);
const inputs = ['-i', webm, ...ids.flatMap(id => ['-i', clips[id].file])];
const filters = ids.map((id, i) => `[${i + 1}:a]adelay=${Math.round(starts[i].at * 1000)}|${Math.round(starts[i].at * 1000)}[a${i}]`).join(';');
const mix = `${ids.map((_, i) => `[a${i}]`).join('')}amix=inputs=${ids.length}:normalize=0[aout]`;
fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', `${filters};${mix}`, '-map', '0:v', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', OUTFILE], { stdio: ['ignore', 'ignore', 'inherit'] });
const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUTFILE]).toString().trim());
console.log(`wrote ${OUTFILE} (${secs.toFixed(0)} s, ${(fs.statSync(OUTFILE).size / 1e6).toFixed(1)} MB)`);
fs.writeFileSync(path.join(WORK, 'timeline.json'), JSON.stringify({ starts, clips: Object.fromEntries(Object.entries(clips).map(([k, v]) => [k, v.dur])) }, null, 1));
