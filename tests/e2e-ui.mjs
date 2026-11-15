import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { startCoordinator } from '../daemon/coordinator.mjs';
import { resolveChromiumPath } from '../daemon/local-exec.mjs';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startStaticDistServer(distDir) {
  const srv = http.createServer((req, res) => {
    const clean = new URL(req.url, 'http://127.0.0.1').pathname;
    const mapped = clean.endsWith('/') ? `${clean}index.html` : clean;
    const rel = mapped.replace(/^\/+/, '');
    let fp = path.join(distDir, rel);
    if (fs.existsSync(fp) && fs.statSync(fp).isDirectory()) {
      fp = path.join(fp, 'index.html');
    }
    if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  });
  return new Promise(resolve => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

async function main() {
  const distDir = path.resolve('dist/renderer');
  assert.ok(fs.existsSync(path.join(distDir, 'index.html')), 'dist/renderer/index.html missing; run npm run build first');

  const chromePath = resolveChromiumPath();
  assert.ok(chromePath, 'Playwright Chromium executable not found');

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-e2e-'));
  const coord = await startCoordinator({ dataDir: tmpDir, enableScheduler: false });
  coord.store.updateSettings({ firstRunDismissed: true });
  let coordRestart = null;
  const uiSrv = await startStaticDistServer(distDir);
  const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    const uiUrl = `http://127.0.0.1:${uiSrv.address().port}/?coordinator=${encodeURIComponent(coord.url)}`;
    const page = await browser.newPage({ viewport: { width: 1366, height: 840 } });
    page.on('pageerror', err => pageErrors.push(err.message));
    page.on('console', msg => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('response', resp => {
      if (resp.status() >= 400) consoleErrors.push(`HTTP ${resp.status()} ${resp.url()}`);
    });

    await page.goto(uiUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="sidebar"]');
    await page.waitForSelector('[data-testid="computer-pane"]');

    // Verify Mimir branding & real SVG inside + attach button
    const hasMimirTitle = await page.evaluate(() => document.body.innerText.includes('Mimir'));
    assert.ok(hasMimirTitle, 'Expected Mimir branding on main page');
    const hasAttachSvg = await page.evaluate(() => Boolean(document.querySelector('[data-testid="attach-file-btn"] svg')));
    assert.ok(hasAttachSvg, 'Expected real <svg> inside attach-file-btn');

    // Verify Forge 4-question follow-up tick-box wizard flow
    await page.click('[data-testid="nav-forge"]');
    await page.waitForSelector('[data-testid="forge-view"]');
    await page.click('[data-testid="start-4q-wizard-btn"]');
    await page.waitForSelector('[data-testid="forge-wizard-card"]');
    await page.click('text=Software Engineering & Code');
    await page.click('[data-testid="wizard-next-btn"]'); // Q1 -> Q2
    await page.waitForSelector('text=Question 2/4');
    await page.click('text=Inspect repo files & summarize architecture');
    await page.click('[data-testid="wizard-next-btn"]'); // Q2 -> Q3
    await page.waitForSelector('text=Question 3/4');
    await page.click('[data-testid="wizard-next-btn"]'); // Q3 -> Q4
    await page.waitForSelector('text=Question 4/4');
    await page.fill('[data-testid="forge-wizard-card"] input.input', 'Brok Custom Forge');
    await page.click('[data-testid="wizard-finish-btn"]');
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    await page.waitForSelector('text=Brok Custom Forge');

    // Switch back to Mimir (default bot) before testing Vault/Chat flow
    await page.click('[data-testid="bot-pill-bot-grok-default"]');

    // 1. Navigate across Vault tab and store an encrypted secret via UI
    await page.click('[data-testid="nav-vault"]');
    await page.waitForSelector('[data-testid="vault-view"]');
    await page.fill('[data-testid="vault-view"] input[placeholder*="github-pat"]', 'e2e-api-key');
    await page.fill('[data-testid="vault-view"] input[type="password"]', 'secret-val-999');
    await page.click('[data-testid="vault-add-btn"]');
    await page.waitForSelector('text=e2e-api-key');

    // Verify navigation across MCP, Routines, Settings
    await page.click('[data-testid="nav-mcp"]');
    await page.waitForSelector('[data-testid="mcp-view"]');
    await page.click('[data-testid="nav-routines"]');
    await page.waitForSelector('[data-testid="routines-view"]');
    await page.click('[data-testid="nav-settings"]');
    await page.waitForSelector('[data-testid="settings-view"]');

    // 2. Return to Chat and run a live Ollama qwen3:1.7b turn with Usage Review Gate approval
    await page.click('[data-testid="nav-chat"]');
    await page.waitForSelector('[data-testid="chat-input"]');

    await page.fill(
      '[data-testid="chat-input"]',
      'Use fs_write to create file e2e-note.txt with exact content E2E_VERIFIED_OK, then confirm done.'
    );
    await page.click('[data-testid="send-btn"]');

    // Approval gate must pause before fs_write executes & show Reversibility badge
    await page.waitForSelector('[data-testid="approval-banner"]', { timeout: 30000 });
    await page.waitForSelector('[data-testid="approval-reversibility-badge"]');
    await page.click('[data-testid="approve-once-btn"]');

    // Wait for tool execution card & final assistant reply
    await page.waitForSelector('.tool-card', { timeout: 60000 });
    await page.waitForFunction(
      () => {
        const sendBtn = document.querySelector('[data-testid="send-btn"]');
        const cards = document.querySelectorAll('.tool-card');
        return Boolean(sendBtn) && cards.length > 0;
      },
      { timeout: 60000 }
    );

    const writtenPath = path.join(coord.store.getBotWorkspace('bot-grok-default'), 'e2e-note.txt');
    assert.ok(fs.existsSync(writtenPath), 'Expected fs_write to create e2e-note.txt after UI approval');
    assert.ok(fs.readFileSync(writtenPath, 'utf8').includes('E2E_VERIFIED_OK'));

    // Verify Agents Roster, fresh session switch (never opens Configure modal), RSI view & responsive widths
    await page.click('[data-testid="nav-agents"]');
    await page.waitForSelector('[data-testid="agents-view"]');
    await page.click('[data-testid="agent-new-session-bot-grok-default"]');
    await page.waitForSelector('[data-testid="chat-input"]');
    assert.equal(await page.$('.modal-backdrop'), null, 'Clicking agent New Session must not open rename/configure modal');

    await page.click('[data-testid="nav-rsi"]');
    await page.waitForSelector('[data-testid="rsi-view"]');
    await page.waitForSelector('[data-testid="scale-telemetry-card"]');

    // Save desktop & responsive verification screenshots under qa/screenshots/
    const shotsDir = path.resolve('qa', 'screenshots');
    fs.mkdirSync(shotsDir, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });

    // Overview Showcase view
    await page.click('[data-testid="nav-overview"]');
    await page.waitForSelector('[data-testid="overview-view"]');
    await page.screenshot({ path: path.join(shotsDir, 'overview-1440x900.png'), fullPage: false });

    // Library & Foundry Deliverable creation + inline SVG & PDF preview
    await page.click('[data-testid="nav-library"]');
    await page.waitForSelector('[data-testid="library-view"]');
    await page.click('[data-testid="library-new-btn"]');
    await page.fill('[data-testid="library-create-title"]', 'E2E Bifrost Emblem');
    await page.selectOption('[data-testid="library-create-format"]', 'svg');
    await page.click('[data-testid="library-create-submit"]');
    await page.waitForSelector('text=E2E Bifrost Emblem', { timeout: 20000 });

    await page.click('[data-testid="library-new-btn"]');
    await page.fill('[data-testid="library-create-title"]', 'PDF Release Report');
    await page.selectOption('[data-testid="library-create-format"]', 'pdf');
    await page.click('[data-testid="library-create-submit"]');
    await page.waitForSelector('text=PDF Release Report', { timeout: 20000 });
    await page.screenshot({ path: path.join(shotsDir, 'library-1440x900.png'), fullPage: false });

    // Midgard Nine-Realms Map
    await page.click('[data-testid="nav-map"]');
    await page.waitForSelector('[data-testid="map-view"]');
    await page.waitForSelector('[data-testid="map-node-repo-main"]');
    await page.click('[data-testid="map-node-repo-main"]');
    await page.screenshot({ path: path.join(shotsDir, 'map-1440x900.png'), fullPage: false });

    // Plugins Hub search inside MCP Box
    await page.click('[data-testid="nav-mcp"]');
    await page.waitForSelector('[data-testid="plugins-hub"]');
    await page.fill('[data-testid="connector-search-input"]', 'GitHub');
    await page.waitForSelector('[data-testid="connector-card-github"]');
    await page.screenshot({ path: path.join(shotsDir, 'mcp-plugins-1440x900.png'), fullPage: false });
    await page.fill('[data-testid="connector-search-input"]', '');

    // Boardroom / Model Council tab check
    await page.click('[data-testid="nav-council"]');
    await page.waitForSelector('[data-testid="council-view"]');
    await page.waitForSelector('[data-testid="council-convene-btn"]');
    await page.screenshot({ path: path.join(shotsDir, 'council-1440x900.png'), fullPage: false });

    // Topbar Kill Switch + Mode Switcher + Live Voice Dialog at 1280x800
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.click('[data-testid="nav-chat"]');
    await page.waitForSelector('[data-testid="mode-pill-code"]');
    await page.click('[data-testid="mode-pill-code"]');
    await page.waitForSelector('[data-testid="mode-pill-code"][aria-pressed="true"]');
    await page.click('[data-testid="mode-pill-agent"]');
    await page.waitForSelector('[data-testid="mode-pill-agent"][aria-pressed="true"]');

    await page.click('[data-testid="live-voice-btn"]');
    await page.waitForSelector('dialog.voice-live-dialog[open]');
    await page.waitForSelector('[data-testid="voice-orb-btn"]');
    await page.waitForSelector('[data-testid="voice-attach-btn"]');
    await page.click('[data-testid="voice-transcript-toggle"]');
    await page.waitForSelector('.voice-live-transcript');
    await page.click('[data-testid="voice-pause-motion-btn"]');
    await page.screenshot({ path: path.join(shotsDir, 'voice-live-1280x800.png'), fullPage: false });
    await page.click('[data-testid="voice-end-call-btn"]');
    await page.waitForFunction(() => !document.querySelector('dialog.voice-live-dialog[open]'));

    // Drag-and-drop file onto ChatView stages file and auto-dispatches run
    await page.evaluate(async () => {
      const zone = document.querySelector('[data-testid="chat-drop-zone"]');
      const dt = new DataTransfer();
      dt.items.add(new File(['hello dropped mimir'], 'drop-auto.txt', { type: 'text/plain' }));
      zone.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt }));
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await page.waitForSelector('[data-testid="chat-drop-overlay"]');
    await page.evaluate(() => {
      const zone = document.querySelector('[data-testid="chat-drop-zone"]');
      const dt = new DataTransfer();
      dt.items.add(new File(['hello dropped mimir'], 'drop-auto.txt', { type: 'text/plain' }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
    });
    await page.waitForFunction(
      () => document.querySelector('[data-testid="chat-messages"]')?.textContent?.includes('drop-auto.txt')
    );
    const stagedDropPath = path.join(coord.store.getBotWorkspace('bot-grok-default'), 'uploads', 'drop-auto.txt');
    assert.ok(fs.existsSync(stagedDropPath), 'Dropped file must be staged in uploads/drop-auto.txt');

    await page.click('[data-testid="kill-switch-btn"]');
    await page.waitForSelector('[data-testid="kill-notice-pill"]');

    // Deploy 6-bot Chief of Staff topology & verify Team Topology, Workspace crates, and Overview Matrix
    await page.click('[data-testid="deploy-chief-team-btn"]');
    await page.waitForSelector('[data-testid="bot-pill-bot-chief-klaus"]');
    await page.waitForSelector('[data-testid="bot-pill-bot-spec-mara"]');
    await page.waitForSelector('[data-testid="mention-quickbar"]');

    await page.click('[data-testid="computer-pane"] button[role="tab"]:has-text("Team")');
    await page.waitForSelector('[data-testid="team-topology-pane"]');
    await page.click('[data-testid="computer-pane"] button[role="tab"]:has-text("Workspace")');
    await page.waitForSelector('[data-testid="workspace-persistence-pane"]');

    await page.click('[data-testid="nav-overview"]');
    await page.waitForSelector('[data-testid="reversibility-matrix-card"]');
    await page.waitForSelector('[data-testid="hybrid-stack-card"]');

    // Verify 11 Norse Specialists Panel
    await page.click('[data-testid="toggle-advanced-tools"]');
    await page.click('[data-testid="nav-agents"]');
    await page.waitForSelector('[data-testid="norse-registry-panel"]');
    for (const rid of ['mimir', 'scout', 'forge-master', 'artificer', 'sentinel']) {
      await page.waitForSelector(`[data-testid="norse-role-${rid}"]`);
    }

    // Verify Static Avatar Toggle in Settings updates Living Mimir SVG
    await page.click('[data-testid="nav-settings"]');
    await page.waitForSelector('[data-testid="static-avatar-checkbox"]');
    await page.check('[data-testid="static-avatar-checkbox"]');
    const isReduced = await page.getAttribute('[data-testid="mimir-living-avatar"]', 'data-reduced-motion');
    assert.equal(isReduced, 'true', 'Static avatar checkbox must enable reduced-motion Mimir avatar');

    // Verify Persistent Spaces creation in Sidebar
    await page.click('[data-testid="new-space-btn"]');
    await page.fill('[data-testid="new-space-title"]', 'Rust Forge');
    await page.selectOption('[data-testid="new-space-surface"]', 'code');
    await page.click('[data-testid="save-space-btn"]');
    await page.waitForSelector('[data-testid="spaces-list"] button:has-text("Rust Forge (code)")');

    await page.click('[data-testid="nav-chat"]');
    await page.screenshot({ path: path.join(shotsDir, 'viewport-1280x800.png'), fullPage: false });

    // Verify Browser Automation controls (real local navigation, Enlarge, Take Control)
    await page.click('#preview-tab-screen');
    await page.waitForSelector('[data-testid="browser-url-input"]');
    const localLandingUrl = `http://127.0.0.1:${uiSrv.address().port}/landing/`;
    await page.fill('[data-testid="browser-url-input"]', localLandingUrl);
    await page.click('[data-testid="browser-go-btn"]');
    await page.waitForSelector('.screen-frame img', { timeout: 25000 });
    await page.click('[data-testid="browser-enlarge-btn"]');
    await page.waitForSelector('[data-testid="computer-pane"].is-enlarged');
    await page.click('[data-testid="browser-enlarge-btn"]');
    await page.click('[data-testid="browser-take-control-btn"]');
    await page.waitForSelector('[data-testid="take-control-badge"]');
    await page.waitForSelector('[data-testid="take-control-bar"]');
    await page.click('[data-testid="browser-take-control-btn"]');

    // Reopen task after page reload (persisted thread + history must survive reload)
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForSelector('[data-testid="sidebar"]');
    await page.waitForSelector('[data-testid="chat-input"]');
    await page.waitForFunction(
      () => document.body?.innerText?.includes('e2e-note.txt') || document.querySelectorAll('[data-testid^="thread-item-"]').length > 0
    );

    // Responsive 1440x900, 768x1024 & 390x844 checks + screenshot capture
    for (const vp of [
      { width: 1440, height: 900, name: 'viewport-1440x900.png' },
      { width: 768, height: 1024, name: 'viewport-768x1024.png' },
      { width: 390, height: 844, name: 'viewport-390x844.png' },
    ]) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.waitForTimeout(160);
      const ov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(ov <= 2, `Expected zero overflow at ${vp.width}x${vp.height}, got ${ov}px`);
      await page.screenshot({ path: path.join(shotsDir, vp.name), fullPage: false });
    }

    // Check responsive zero horizontal overflow at narrow 320px mobile width & test drawer navigation
    await page.setViewportSize({ width: 320, height: 720 });
    await page.waitForSelector('.mobile-menu-btn');
    await page.click('.mobile-menu-btn');
    await page.click('[data-testid="nav-chat"]');
    await page.waitForTimeout(220);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 2, `Expected zero horizontal overflow at 320x720, got ${overflow}px`);
    await page.screenshot({ path: path.join(shotsDir, 'viewport-320x720.png'), fullPage: false });

    // Verify Landing Page interactive sandbox & responsive viewports at 1440px, 768px, 390px and 320px
    const landingUrl = `http://127.0.0.1:${uiSrv.address().port}/landing/`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(landingUrl, { waitUntil: 'networkidle' });
    const landingSvgs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('img')).every(img => img.complete && img.naturalWidth > 0)
    );
    assert.ok(landingSvgs, 'Expected all landing page images/SVGs to load cleanly');
    const initBadge = await page.textContent('#sbx-mode-badge');
    assert.ok(initBadge?.includes('Static Demo Fixture'), `Expected honest demo fixture badge, got ${initBadge}`);
    await page.click('[data-preset="pdf"]');
    const fixtureJson = await page.textContent('#sbx-json');
    assert.ok(fixtureJson?.includes('"verdict": "simulated-demo"'), 'Fixture JSON must declare simulated-demo verdict');
    assert.ok(!fixtureJson?.includes('"verdict": "verified"'), 'Fixture JSON must never declare verified verdict');

    for (const lvp of [
      { width: 1440, height: 900, shot: 'landing-1440x900.png' },
      { width: 768, height: 1024 },
      { width: 390, height: 844, shot: 'landing-390x844.png' },
      { width: 320, height: 720 },
    ]) {
      await page.setViewportSize({ width: lvp.width, height: lvp.height });
      await page.waitForTimeout(160);
      const lov = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(lov <= 2, `Expected zero landing overflow at ${lvp.width}px, got ${lov}px`);
      if (lvp.shot) await page.screenshot({ path: path.join(shotsDir, lvp.shot), fullPage: false });
    }

    // Verify /app.html without coordinator shows RuntimeConnectGate & supports explicit pairing + unpairing against auth-protected coordinator
    const authTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-e2e-auth-'));
    const authCoord = await startCoordinator({ dataDir: authTmp, enableScheduler: false, token: 'e2e-pairing-secret' });
  authCoord.store.updateSettings({ firstRunDismissed: true });
    const gateCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const gatePage = await gateCtx.newPage();
    gatePage.on('pageerror', err => pageErrors.push(`gatePage: ${err.message}`));
    try {
      await gatePage.goto(`http://127.0.0.1:${uiSrv.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
      await gatePage.waitForSelector('[data-testid="runtime-connect-gate"]', { timeout: 15000 });
      await gatePage.screenshot({ path: path.join(shotsDir, 'app-runtime-gate-1280x800.png'), fullPage: false });

      await gatePage.fill('[data-testid="runtime-url-input"]', authCoord.url);
      await gatePage.click('[data-testid="runtime-retry-btn"]');
      await gatePage.waitForSelector('[data-testid="pairing-request-btn"]', { timeout: 10000 });
      await gatePage.click('[data-testid="pairing-request-btn"]');
      await gatePage.waitForSelector('[data-testid="pairing-request-info"]', { timeout: 10000 });
      const pendingList = authCoord.listPendingPairings();
      assert.ok(pendingList.length >= 1, 'Expected pending pairing code on authCoord');
      const code = pendingList[pendingList.length - 1].code;
      await gatePage.fill('[data-testid="pairing-code-input"]', code);
      await gatePage.click('[data-testid="pairing-exchange-btn"]');
      await gatePage.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
      await gatePage.waitForSelector('[data-testid="chat-input"]', { timeout: 15000 });
      await gatePage.click('[data-testid="unpair-runtime-btn"]');
      await gatePage.waitForSelector('[data-testid="runtime-connect-gate"]', { timeout: 10000 });
    } finally {
      await gateCtx.close();
      await authCoord.close();
      fs.rmSync(authTmp, { recursive: true, force: true });
    }

    assert.equal(pageErrors.length, 0, `Uncaught page errors: ${pageErrors.join('; ')}`);
    assert.equal(consoleErrors.length, 0, `Console errors: ${consoleErrors.join('; ')}`);

    // Extra Functional QA Journeys:
    // A. Expired Session Recovery + B. No-Ollama & Offline Internet + C. Active Agent Abort + D. Real Coordinator Restart Persistence
    // A. Expired Pairing Session TTL -> UI detects 401 SESSION_EXPIRED and prompts re-pairing
    const expTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-e2e-exp-'));
    const expCoord = await startCoordinator({
      dataDir: expTmp,
      enableScheduler: false,
      token: 'exp-secret',
      pairingSessionTtlMs: 1500,
    });
    expCoord.store.updateSettings({ firstRunDismissed: true });
    const expCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const expPage = await expCtx.newPage();
    expPage.on('pageerror', err => pageErrors.push(`expPage: ${err.message}`));
    try {
      await expPage.goto(`http://127.0.0.1:${uiSrv.address().port}/app.html`, { waitUntil: 'domcontentloaded' });
      await expPage.waitForSelector('[data-testid="runtime-connect-gate"]', { timeout: 10000 });
      await expPage.fill('[data-testid="runtime-url-input"]', expCoord.url);
      await expPage.click('[data-testid="runtime-retry-btn"]');
      await expPage.waitForSelector('[data-testid="pairing-request-btn"]', { timeout: 10000 });
      await expPage.click('[data-testid="pairing-request-btn"]');
      await expPage.waitForSelector('[data-testid="pairing-request-info"]', { timeout: 10000 });
      const expCode = expCoord.listPendingPairings().at(-1).code;
      await expPage.fill('[data-testid="pairing-code-input"]', expCode);
      await expPage.click('[data-testid="pairing-exchange-btn"]');
      await expPage.waitForSelector('[data-testid="sidebar"]', { timeout: 15000 });
      await expPage.waitForTimeout(1700);
      if (await expPage.isVisible('[data-testid="nav-library"]')) {
        await expPage.click('[data-testid="nav-library"]');
      }
      await expPage.waitForSelector('[data-testid="runtime-connect-gate"]', { timeout: 10000 });
      const expiredHeading = await expPage.textContent('[data-testid="runtime-connect-gate"]');
      assert.ok(expiredHeading?.includes('Pairing session expired'), `Expected expired session gate text, got ${expiredHeading}`);
    } finally {
      await expCtx.close();
      await expCoord.close();
      fs.rmSync(expTmp, { recursive: true, force: true });
    }

    // B & C. No-Ollama status, Offline internet local PDF generation + download check, and Active Abort Button
    const offlineTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-e2e-off-'));
    const slowSrv = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      await new Promise(r => setTimeout(r, 3500));
      if (res.destroyed || res.writableEnded) return;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ model: 'slow-mock', choices: [{ message: { content: 'Slow finished' } }] }));
    });
    await new Promise(r => slowSrv.listen(0, '127.0.0.1', r));
    const offlineCoord = await startCoordinator({ dataDir: offlineTmp, enableScheduler: false });
  offlineCoord.store.updateSettings({ firstRunDismissed: true });
    await fetch(`${offlineCoord.url}/v1/settings`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'ollama', ollamaUrl: 'http://127.0.0.1:59996', ollamaModel: 'qwen3:1.7b' }),
    });
    const offCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // Simulate offline public internet while preserving local loopback runtime
    await offCtx.route('**/*', route => {
      const u = route.request().url();
      return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(u)
        ? route.continue()
        : route.abort('internetdisconnected');
    });
    const offPage = await offCtx.newPage();
    offPage.on('pageerror', err => pageErrors.push(`offPage: ${err.message}`));
    try {
      await offPage.goto(`http://127.0.0.1:${uiSrv.address().port}/?coordinator=${encodeURIComponent(offlineCoord.url)}`, { waitUntil: 'networkidle' });
      await offPage.waitForSelector('[data-testid="sidebar"]');
      await offPage.waitForFunction(
        () => {
          const txt = document.querySelector('[data-testid="sidebar"]')?.textContent || '';
          return txt.includes('Offline') && !txt.includes('Ollama Live');
        },
        { timeout: 10000 }
      );

      // Create & verify real PDF deliverable while public internet is offline
      await offPage.click('[data-testid="nav-library"]');
      await offPage.waitForSelector('[data-testid="library-view"]');
      await offPage.click('[data-testid="library-new-btn"]');
      await offPage.fill('[data-testid="library-create-title"]', 'Offline Local PDF');
      await offPage.selectOption('[data-testid="library-create-format"]', 'pdf');
      await offPage.click('[data-testid="library-create-submit"]');
      await offPage.waitForSelector('text=Offline Local PDF', { timeout: 20000 });
      const dlCheck = await offPage.evaluate(async base => {
        const data = await (await fetch(`${base}/v1/library/artifacts`)).json();
        const list = Array.isArray(data) ? data : data.artifacts || [];
        const found = list.find(a => a.title === 'Offline Local PDF');
        const okRes = await fetch(`${base}/v1/artifacts/${encodeURIComponent(found.id)}/download`);
        const badRes = await fetch(`${base}/v1/artifacts/nonexistent-pdf-id/download`);
        return { okStatus: okRes.status, head: (await okRes.text()).slice(0, 5), badStatus: badRes.status };
      }, offlineCoord.url);
      assert.equal(dlCheck.okStatus, 200);
      assert.equal(dlCheck.head, '%PDF-');
      assert.equal(dlCheck.badStatus, 404);

      // Switch to slow mock LLM to exercise clicking [data-testid="abort-btn"] during an active turn
      await fetch(`${offlineCoord.url}/v1/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'openai-compat',
          openaiBaseUrl: `http://127.0.0.1:${slowSrv.address().port}/v1`,
          openaiApiKey: 'mock-key',
          openaiModel: 'slow-mock',
        }),
      });
      await offPage.click('[data-testid="nav-chat"]');
      await offPage.waitForSelector('[data-testid="chat-input"]');
      await offPage.fill('[data-testid="chat-input"]', 'Explain local security policies slowly.');
      await offPage.click('[data-testid="send-btn"]');
      await offPage.waitForSelector('[data-testid="abort-btn"]', { timeout: 10000 });
      await offPage.click('[data-testid="abort-btn"]');
      await offPage.waitForSelector('[data-testid="send-btn"]', { timeout: 10000 });
    } finally {
      await offCtx.close();
      await offlineCoord.close();
      await new Promise(done => slowSrv.close(done));
      fs.rmSync(offlineTmp, { recursive: true, force: true });
    }

    // D. Real App Restart: close coord, launch fresh coordRestart on SAME tmpDir, reopen persisted task
    await coord.close();
    coordRestart = await startCoordinator({ dataDir: tmpDir, enableScheduler: false });
    const restartCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const restartPage = await restartCtx.newPage();
    restartPage.on('pageerror', err => pageErrors.push(`restartPage: ${err.message}`));
    try {
      await restartPage.goto(`http://127.0.0.1:${uiSrv.address().port}/?coordinator=${encodeURIComponent(coordRestart.url)}`, { waitUntil: 'networkidle' });
      await restartPage.waitForSelector('[data-testid="sidebar"]');
      await restartPage.waitForSelector('text=Brok Custom Forge');
      await restartPage.click('[data-testid="bot-pill-bot-grok-default"]');
      await restartPage.waitForFunction(
        () => document.body?.innerText?.includes('e2e-note.txt') || document.querySelectorAll('[data-testid^="thread-item-"]').length > 0,
        { timeout: 15000 }
      );
    } finally {
      await restartCtx.close();
    }

    assert.equal(pageErrors.length, 0, `Uncaught page errors (extended QA): ${pageErrors.join('; ')}`);

    console.log(
      JSON.stringify({
        ok: true,
        e2e: 'passed',
        writtenFile: writtenPath,
        pageErrors: 0,
        consoleErrors: 0,
      })
    );
  } finally {
    await browser.close();
    uiSrv.close();
    await (coordRestart || coord).close().catch(() => {});
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
