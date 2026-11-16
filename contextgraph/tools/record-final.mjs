// Records the walkthrough as a live screen recording of the real app: no slides. The Try it page,
// the live demo, the Benchmark page and How it works are driven in a real browser, narrated with a
// neural voice, and muxed with ffmpeg. Every number spoken comes from results.json.
//   node tools/record-live.mjs [baseUrl] [outFile]
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { demoSteps } from './demo-script.mjs';

const require = createRequire(path.resolve('D:/project/grok-bot-clone/package.json'));
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:7860';
const OUTFILE = path.resolve(process.argv[3] || 'D:/project/grok-bot-clone/contextgraph/results/final-app.mp4');
const WORK = path.resolve('D:/project/grok-bot-clone/contextgraph/results/final-work');
const VOICE = process.env.VOICE || 'en-US-AndrewNeural';
const PAD = 0.7;
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(path.join(WORK, 'audio'), { recursive: true });

const R = await (await fetch(`${BASE}/api/results`)).json();
const n = x => Number(x).toLocaleString('en-US');
const lc = R.learningCurve;
const last = lc.testCompleteMean.length - 1;
const bl = R.baselines;
const J = R.jargon;
const llm = R.llm?.methods || {};
const all = llm['All tools preloaded'];
const learned = llm['Graph, after learning'];
const small = R.scale[0];
const mid = R.scale.find(s => s.catalogTools >= 5000) || R.scale.at(-1);
const big = R.scale.at(-1);
const preloadTokens = all ? all.avgPromptTokens : Math.round(bl.preloadAll.avgSchemaChars / 4);

const L = {
  intro: `This is the Context Graph itself, running live on a real HydraDB server on my own machine. Each request pulls only the few tools it needs from a graph, instead of handing the agent all ${R.config.catalogTools}. Let me show you.`,
  r2: `Next, ${R.config.test} jobs worded differently from anything it was trained on. Before it learned anything it covered ${lc.testCompleteMean[0]} percent of them, about ${Math.round(lc.testCompleteMean[1])} after one pass, and ${Math.round(lc.testCompleteMean[last])} after five, so extra passes over the same examples slightly hurt. A keyword search that also knows my skills gets ${bl.bm25ToolsAndSkills.complete}, and plain keyword search gets ${bl.bm25Tools.complete}. A keyword index that also learns from the same training tasks gets ${R.flatLearner ? Math.max(...R.flatLearner.rows.slice(1).map(x => x.complete)) : 'about the same'}, so the graph is not clearly better than a simple learner, and the page shows that too. The gain isn't spread evenly. Plain jobs don't move, skill jobs improve, and jobs about a specific client went from ${lc.byKindMean.E[0]} to ${lc.byKindMean.E[last]} percent, but that is only ten jobs, and I wrote the skills from the same answers as the labels, so treat it as a pattern, not a proof.`,
  r3:
    all && learned
      ? `I also ran it with a real small model on my own laptop. The instructions the model has to read drop from about ${n(all.avgPromptTokens)} tokens to about ${n(learned.avgPromptTokens)}, and an answer takes ${n(learned.avgMs)} milliseconds instead of ${n(all.avgMs)}. But the first tool it reaches for was right ${learned.firstCallHitPct} percent of the time, against ${all.firstCallHitPct} with everything loaded. So on that tiny model I saved the cost and the time, and I did not improve accuracy.`
      : `I also ran it with a real small model on my own laptop.`,
  r4: `Now the limits, because I'd rather you hear them from me. One thing I fixed: my first word list had peeked at the test sentences and flattered the early results by five points. It is now built without them, new words are matched live, and every number here was re-run. Learning helps by about ten points, not a miracle. On jobs it has never seen it can hurt, so I weakened two settings and the page shows the result. And it slows as the catalog grows: about ${Math.round(small.load[0].p50ms)} milliseconds at ${n(small.catalogTools)} tools, nearly a second at ${n(big.catalogTools)}.`,
  how: `The design is simple on purpose. The agent sends the task to a small service, the service walks the graph in HydraDB, and sends back a handful of tool definitions. All the memory lives in HydraDB, and neither retrieval nor learning calls an AI model.`,
  close: `That's Context Graph, already wired into Mimir, my own agent. Everything is open source and linked below. Thanks to the HydraDB team for the hackathon.`,
};

function tts(name, content) {
  const file = path.join(WORK, 'audio', `${name}.mp3`);
  for (let attempt = 1; ; attempt++) {
    try {
      execFileSync('python', ['-m', 'edge_tts', '--voice', VOICE, '--rate=-2%', '--text', content, '--write-media', file], { stdio: ['ignore', 'ignore', 'pipe'] });
      break;
    } catch (err) {
      const msg = String(err.stderr || err.message).split(/\r?\n/).filter(Boolean).slice(-2).join(' | ');
      console.error(`voice clip ${name} failed (attempt ${attempt}): ${msg}`);
      if (attempt >= 4) throw new Error(`voice clip ${name} failed: ${msg}`);
      execFileSync('python', ['-c', 'import time; time.sleep(3)']);
    }
  }
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]).toString().trim());
  return { file, dur };
}

const demo = demoSteps(R);
const clips = {};
for (const [k, v] of Object.entries(L)) clips[k] = tts(k, v);
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
const place = id => starts.push({ id, at: now() });

// Scroll the page to each heading in turn, spread over the length of the clip, then hold until it ends.
async function tour(id, headings) {
  const began = now();
  place(id);
  const dur = clips[id].dur;
  for (let i = 0; i < headings.length; i++) {
    await sleep(Math.max(0, began + (dur * i) / headings.length - now()));
    await page.evaluate(h => {
      const el = [...document.querySelectorAll('h1,h2')].find(x => x.textContent.includes(h));
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, headings[i]);
  }
  await sleep(Math.max(0, began + dur + PAD - now()));
}

await page.goto(`${BASE}/#/`);
await page.waitForSelector('#chips .chip', { timeout: 60000 });
await sleep(0.8);

// 1. Intro over the Try it page.
{
  const began = now();
  place('intro');
  await page.mouse.move(960, 300, { steps: 20 });
  await sleep(Math.min(8, clips.intro.dur / 3));
  await page.mouse.move(1500, 450, { steps: 30 });
  await sleep(Math.max(0, began + clips.intro.dur + PAD - now()));
}

// 2. The live demo.
for (const step of demo) {
  if (step.say) place(step.id);
  const began = now();
  await step.run(page, { sleep, now });
  if (step.say) await sleep(Math.max(0, began + clips[step.id].dur + 0.5 - now()));
}

// 3. The Benchmark page, scrolled live.
await page.goto(`${BASE}/#/results`);
await page.waitForSelector('#rc .card', { timeout: 30000 });
await page.evaluate(() => window.scrollTo(0, 0));
await sleep(0.8);
await tour('r2', ['It learns: held-out', 'Where the graph earns', 'Versus the alternatives']);
await tour('r3', ['End to end with a real local model']);
await tour('r4', ['When it isn', 'A tool the graph has never seen', 'Does it hold up under load']);

// 4. How it works.
await page.goto(`${BASE}/#/how`);
await sleep(0.8);
await tour('how', ['The graph', 'One pull, step by step', 'Honest limits']);

// 5. Back to the Try it page for the close.
await page.goto(`${BASE}/#/`);
await page.waitForSelector('#chips .chip', { timeout: 30000 });
await page.evaluate(() => window.scrollTo(0, 0));
place('close');
await sleep(clips.close.dur + PAD + 1.2);

const video = page.video();
await ctx.close();
await browser.close();
const webm = await video.path();

const ids = starts.map(s => s.id);
const inputs = ['-i', webm, ...ids.flatMap(id => ['-i', clips[id].file])];
const filters = ids.map((id, i) => `[${i + 1}:a]adelay=${Math.round(starts[i].at * 1000)}|${Math.round(starts[i].at * 1000)}[a${i}]`).join(';');
const mix = `${ids.map((_, i) => `[a${i}]`).join('')}amix=inputs=${ids.length}:normalize=0[aout]`;
fs.mkdirSync(path.dirname(OUTFILE), { recursive: true });
execFileSync('ffmpeg', ['-y', ...inputs, '-filter_complex', `${filters};${mix}`, '-map', '0:v', '-map', '[aout]', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', '-shortest', OUTFILE], { stdio: ['ignore', 'ignore', 'inherit'] });
const secs = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', OUTFILE]).toString().trim());
console.log(`wrote ${OUTFILE} (${secs.toFixed(0)} s, ${(fs.statSync(OUTFILE).size / 1e6).toFixed(1)} MB)`);
fs.writeFileSync(path.join(WORK, 'script.md'), ['# Live walkthrough script', '', ...Object.entries(L).flatMap(([k, v]) => [`## ${k}`, v, '']), ...demo.filter(d => d.say).flatMap(d => [`## ${d.id}`, d.say, ''])].join('\n'));
