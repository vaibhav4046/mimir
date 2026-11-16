// End-to-end robustness check of Mimir + HydraDB tool memory through the real UI and daemon.
//   node tools/mimir-e2e-check.mjs [mimirUrl]
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('D:/project/grok-bot-clone/package.json'));
const { chromium } = require('playwright-core');
const BASE = process.argv[2] || 'http://127.0.0.1:4572';
const patch = body => fetch(`${BASE}/v1/settings`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const status = () => fetch(`${BASE}/v1/context-graph/status`).then(r => r.json());
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage();
const results = [];
async function ask(label, text, expect, { newChat = true } = {}) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  if (newChat) await page.getByRole('button', { name: /New Chat/i }).first().click().catch(() => {});
  const box = page.getByPlaceholder(/Message Mimir/i);
  await box.waitFor({ timeout: 20000 });
  await box.click();
  await page.keyboard.type(text, { delay: 5 });
  await page.keyboard.press('Enter');
  let ok = false;
  try {
    await page.waitForFunction(re => new RegExp(re).test(document.body.textContent), expect, { timeout: 150000 });
    ok = true;
  } catch {}
  const st = await status();
  results.push({ label, ok, status: JSON.stringify({ enabled: st.enabled, connected: st.connected, failures: st.failures, pulled: st.lastPull?.pulled, of: st.lastPull?.of, error: st.lastPull?.error }) });
  console.log(ok ? 'PASS' : 'FAIL', '-', label, '|', results.at(-1).status);
}
// 1. HydraDB unreachable: Mimir must still answer, using every tool.
await patch({ contextGraph: { enabled: true, url: 'http://127.0.0.1:1' } });
await ask('HydraDB unreachable, Mimir still answers', 'What is 12 times 12? Use your math tool.', '144');
// 2. HydraDB healthy: tools are pulled and the answer is right.
await patch({ contextGraph: { enabled: true, url: 'http://127.0.0.1:18443' } });
await ask('HydraDB healthy, answer correct', 'What is 17 times 23? Use your math tool.', '391');
// 3. Junk, unicode and a very long prompt: no crash.
await ask('unicode and symbols', '\u202e日本語 ✉️ <script>alert(1)</script> ${{7*7}} what is 2 plus 2? Use your math tool.', '4');
await ask('1,500-character prompt', ('please remember that I like tea. ').repeat(45) + ' Then tell me what 3 times 3 is using your math tool.', '9');
// 4. Turn it off again: normal Mimir.
await patch({ contextGraph: { enabled: false, url: 'http://127.0.0.1:18443' } });
await ask('switched off, normal Mimir', 'What is 5 times 5? Use your math tool.', '25');
await browser.close();
const bad = results.filter(r => !r.ok);
console.log(bad.length ? `${bad.length} FAILED` : 'ALL PASSED');
process.exit(bad.length ? 1 : 0);
