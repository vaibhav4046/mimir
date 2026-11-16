import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const require = createRequire(path.resolve('D:/project/grok-bot-clone/package.json'));
const { chromium } = require('playwright-core');

const WORK = path.resolve('D:/project/grok-bot-clone/contextgraph/results/mimir-intro-work');
const OUT = path.resolve('D:/project/grok-bot-clone/contextgraph/results/mimir-intro.mp4');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

const say = `Meet Mimir, our local-first AI agent workspace. When Mimir connects to dozens of tools on a small local model, the tool manuals alone overflow its eight-thousand-token window. So we wired HydraDB directly into Mimir's agent loop—here it is live, pulling five of eighteen tools per turn inside Mimir.`;
const audio = path.join(WORK, 'intro.mp3');
for (let attempt = 1; ; attempt++) {
  try {
    execFileSync('python', ['-m', 'edge_tts', '--voice', 'en-US-AndrewNeural', '--rate=-2%', '--text', say, '--write-media', audio], { stdio: ['ignore', 'ignore', 'pipe'] });
    break;
  } catch (e) {
    if (attempt >= 4) throw e;
    execFileSync('python', ['-c', 'import time; time.sleep(3)']);
  }
}
const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', audio]).toString().trim());

const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, recordVideo: { dir: WORK, size: { width: 1920, height: 1080 } }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
await page.goto('http://127.0.0.1:47999/mimir/landing/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(4500);
await page.evaluate(() => window.scrollTo({ top: 480, behavior: 'smooth' }));
await page.waitForTimeout(2500);
await page.goto('http://127.0.0.1:4570/', { waitUntil: 'networkidle', timeout: 30000 });
await page.waitForTimeout(1500);
const newChat = page.locator('button:has-text("New Chat")').first();
if (await newChat.count()) await newChat.click().catch(() => {});
await page.waitForTimeout(Math.max(2000, Math.round((dur - 8.0) * 1000)));
const video = page.video();
await ctx.close();
await browser.close();
const webm = await video.path();
execFileSync('ffmpeg', ['-y', '-i', webm, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', '25', '-c:a', 'aac', '-b:a', '160k', '-ar', '24000', '-ac', '1', '-shortest', OUT], { stdio: ['ignore', 'ignore', 'inherit'] });
console.log('mimir-intro duration:', dur.toFixed(1));
