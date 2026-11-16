// node record.mjs out.mp4 workDir  -> frame-stepped render at 25 fps (JPEG q.95), soundtrack, mux.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const require = createRequire('D:/project/grok-bot-clone/package.json');
const { chromium } = require('playwright-core');
const CUES = new Function(fs.readFileSync('cues.js', 'utf8') + ';return CUES;')();
const [OUT, WORK] = [path.resolve(process.argv[2]), path.resolve(process.argv[3])];
const FPS = 25, FRAMES = Math.round(CUES.total * FPS);
fs.mkdirSync(path.join(WORK, 'frames'), { recursive: true });
const wav = path.join(WORK, 'film.wav');
execFileSync(process.execPath, [path.resolve('audio.mjs'), wav], { stdio: 'inherit' });
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
const errs = [];
p.on('pageerror', e => errs.push(e.message));
await p.goto(pathToFileURL(path.resolve('index.html')).href);
for (let i = 0; i < FRAMES; i++) {
  const d = await p.evaluate(t => { renderAt(t); return document.getElementById('c').toDataURL('image/jpeg', 0.95).split(',')[1]; }, i / FPS);
  fs.writeFileSync(path.join(WORK, 'frames', `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(d, 'base64'));
}
await b.close();
if (errs.length) throw new Error('page errors: ' + errs.slice(0, 3).join('; '));
execFileSync('ffmpeg', ['-y', '-framerate', String(FPS), '-i', path.join(WORK, 'frames', 'f%05d.jpg'), '-i', wav, '-vf', 'format=yuv420p', '-c:v', 'libx264', '-preset', 'medium', '-crf', '17', '-r', String(FPS), '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', OUT], { stdio: ['ignore', 'ignore', 'inherit'] });
console.log('wrote', OUT);
