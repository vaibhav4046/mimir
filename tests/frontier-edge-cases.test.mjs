import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { buildStructuredStateNote, compactToolText, fitHistoryToWindow, recallFromOmitted } from '../daemon/context-recall.mjs';
import { assertSafeUrl, resolveNumCtx, runChatTurn } from '../daemon/llm-provider.mjs';
import { SentinelPolicyService } from '../daemon/sentinel.mjs';
import { LocalExecEngine, resolveSafePath } from '../daemon/local-exec.mjs';
import { AgentRunner } from '../daemon/agent-runner.mjs';
import { DagSwarmEngine } from '../daemon/dag-swarm.mjs';
import { ModelCouncilEngine } from '../daemon/model-council.mjs';
import { VaultManager } from '../daemon/vault.mjs';
import { AppStore } from '../daemon/store.mjs';
import { DeepResearchEngine } from '../daemon/deep-research.mjs';
import { startCoordinator } from '../daemon/coordinator.mjs';

function makeTmp(prefix = 'mimir-frontier-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {}
}

function startCustomOpenAiServer(handler) {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    await handler(req, res, body);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
        close: () => new Promise(done => server.close(done)),
      });
    });
  });
}

test('context-recall compacts huge trailing tool output atomically and preserves omitted tool recall', () => {
  const giantTool = 'Z'.repeat(20000);
  const compact = compactToolText(giantTool, 1200);
  assert.ok(compact.length < 1500);
  assert.ok(compact.includes('compacted'));

  const messages = [
    { role: 'user', content: 'old prompt alpha keyword' },
    { role: 'assistant', content: 'old answer alpha' },
    { role: 'tool', toolName: 'fs_read', content: 'alpha deployment checklist port 9443 verified' },
    { role: 'assistant', content: '', toolCalls: [{ id: 'tc1', name: 'fs_read', arguments: { path: 'big.log' } }] },
    { role: 'tool', toolCallId: 'tc1', toolName: 'fs_read', content: giantTool },
  ];
  const fitted = fitHistoryToWindow(messages, { numCtx: 2048, overheadChars: 400 });
  assert.ok(fitted.kept.length >= 2, 'newest assistant+tool atomic unit must be preserved, not wiped empty');
  assert.ok(fitted.omitted.length >= 2);
  const note = buildStructuredStateNote(fitted.omitted, 1000);
  assert.ok(note.includes('old prompt alpha keyword') || note.includes('Omitted'));
  const recalled = recallFromOmitted(fitted.omitted, 'deployment checklist 9443', 2);
  assert.ok(recalled.some(r => r.includes('9443')));
});

test('llm-provider resolveNumCtx, SSRF assertSafeUrl, SSE missing tc.index + malformed frames + 429 retry', async () => {
  assert.equal(resolveNumCtx({ provider: 'openai-compat' }), 65536);
  assert.equal(resolveNumCtx({ provider: 'ollama' }), 8192);
  assert.equal(resolveNumCtx({ provider: 'openai-compat', openaiNumCtx: 16384 }), 16384);

  await assert.rejects(() => assertSafeUrl('http://169.254.169.254/latest/meta-data/'), /blocked/i);
  await assert.rejects(() => assertSafeUrl('http://10.0.0.5/admin'), /blocked/i);
  await assert.rejects(() => assertSafeUrl('http://metadata.google.internal/computeMetadata/v1/'), /blocked/i);
  await assert.rejects(() => assertSafeUrl('http://127.0.0.1:4567/', { allowLoopback: false }), /blocked/i);
  const safeLocal = await assertSafeUrl('http://127.0.0.1:4567/health', { allowLoopback: true });
  assert.equal(safeLocal.isLoopback, true);
  assert.ok(safeLocal.url.startsWith('http://127.0.0.1:4567/'));

  let attempts = 0;
  const mock = await startCustomOpenAiServer(async (req, res) => {
    attempts++;
    if (attempts === 1) {
      res.writeHead(429, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'rate limit' } }));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    res.write('data: {malformed-json\n\n');
    res.write(`data: ${JSON.stringify({
      model: 'mock-gpt',
      choices: [{ delta: { tool_calls: [{ id: 'call_a', function: { name: 'fs_list', arguments: '{"path":"."}' } }] } }],
    })}\n\n`);
    res.write(`data: ${JSON.stringify({
      model: 'mock-gpt',
      choices: [{ delta: { content: 'Recovered ok' }, finish_reason: 'stop' }],
    })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  });

  try {
    const out = await runChatTurn({
      settings: { provider: 'openai-compat', openaiBaseUrl: mock.baseUrl, openaiApiKey: 'k', openaiModel: 'mock-gpt' },
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(attempts, 2);
    assert.equal(out.content, 'Recovered ok');
    assert.equal(out.toolCalls.length, 1);
    assert.equal(out.toolCalls[0].name, 'fs_list');
    assert.deepEqual(out.toolCalls[0].arguments, { path: '.' });
  } finally {
    await mock.close();
  }
});

test('sentinel REQUIRE_APPROVAL, local-only browser search block, symlink escape block, fs_read line range, shell_exec abort', async () => {
  const tmp = makeTmp('mimir-sec-');
  const outside = makeTmp('mimir-outside-');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'top-secret', 'utf8');
  try {
    const sentinel = new SentinelPolicyService({ dataDir: tmp });
    const reqWrite = sentinel.evaluateToolRequest({
      toolName: 'fs_write',
      args: { path: 'a.txt', content: 'hi' },
      approved: false,
      approvalPolicy: 'ask-writes',
    });
    assert.equal(reqWrite.decision, 'REQUIRE_APPROVAL');

    const localBlocked = sentinel.evaluateToolRequest({
      toolName: 'browser_search',
      args: { query: 'news' },
      localOnly: true,
    });
    assert.equal(localBlocked.decision, 'DENY');
    assert.equal(localBlocked.policyRuleId, 'SENTINEL_LOCAL_ONLY');

    const store = new AppStore(tmp);
    const ws = store.getBotWorkspace('bot-grok-default');
    fs.writeFileSync(path.join(ws, 'lines.txt'), 'L1\nL2\nL3\nL4\nL5', 'utf8');

    assert.throws(() => resolveSafePath(ws, '../outside/secret.txt'), /Path traversal blocked/i);
    const linkPath = path.join(ws, 'escape-dir');
    try {
      fs.symlinkSync(outside, linkPath, process.platform === 'win32' ? 'junction' : 'dir');
      assert.throws(() => resolveSafePath(ws, 'escape-dir/secret.txt'), /escapes workspace|Symlink/i);
    } catch (err) {
      if (err?.code && !['EPERM', 'EACCES'].includes(err.code)) throw err;
    }

    const bot = store.getBot('bot-grok-default');
    const engine = new LocalExecEngine({ store });
    const sliceRes = await engine.executeTool({
      bot,
      toolName: 'fs_read',
      args: { path: 'lines.txt', startLine: 2, endLine: 4 },
    });
    assert.match(sliceRes, /2: L2\n3: L3\n4: L4/);
    assert.ok(!sliceRes.includes('L1'));
    assert.ok(!sliceRes.includes('L5'));

    const ac = new AbortController();
    setTimeout(() => ac.abort(), 120);
    const execRes = await engine.executeTool({
      bot,
      toolName: 'shell_exec',
      args: { command: `node -e "setTimeout(() => {}, 5000)"` },
      context: { signal: ac.signal },
    });
    assert.match(execRes, /^ERROR:.*(?:abort|timed out|failed)/i);
  } finally {
    cleanup(tmp);
    cleanup(outside);
  }
});

test('AgentRunner executes parallel read burst, enforces doom-loop breaker with synthesis, and synthesizes team handoff', async () => {
  const tmp = makeTmp('mimir-runner-');
  let callNum = 0;
  const mock = await startCustomOpenAiServer(async (_req, res, body) => {
    callNum++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8' });
    const sendSse = delta => {
      res.write(`data: ${JSON.stringify({ model: 'mock-gpt', choices: [{ delta }] })}\n\n`);
    };
    if (callNum === 1) {
      // Parallel read burst: two fs_read calls in one turn
      sendSse({
        tool_calls: [
          { index: 0, id: 'r1', function: { name: 'fs_read', arguments: JSON.stringify({ path: 'a.txt' }) } },
          { index: 1, id: 'r2', function: { name: 'fs_read', arguments: JSON.stringify({ path: 'b.txt' }) } },
        ],
      });
    } else if (callNum === 2) {
      // Verify both tool results arrived back in messages
      const toolMsgs = body.messages.filter(m => m.role === 'tool');
      assert.equal(toolMsgs.length, 2);
      sendSse({ content: 'Both files read cleanly.' });
    } else if (callNum >= 3 && callNum <= 5) {
      // Trigger doom loop with identical arguments 3 times
      sendSse({
        tool_calls: [
          { index: 0, id: `dl_${callNum}`, function: { name: 'fs_read', arguments: JSON.stringify({ path: 'missing.txt' }) } },
        ],
      });
    } else {
      // Forced final synthesis turn when tools: []
      assert.equal((body.tools || []).length, 0);
      sendSse({ content: 'Synthesized final fallback after repeated tool loop.' });
    }
    res.write(`data: ${JSON.stringify({ model: 'mock-gpt', choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    res.end();
  });

  try {
    const store = new AppStore(tmp);
    store.updateSettings({
      provider: 'openai-compat',
      openaiBaseUrl: mock.baseUrl,
      openaiApiKey: 'k',
      openaiModel: 'mock-gpt',
      approvalPolicy: 'auto-approve',
    });
    const ws = store.getBotWorkspace('bot-grok-default');
    fs.writeFileSync(path.join(ws, 'a.txt'), 'ALPHA', 'utf8');
    fs.writeFileSync(path.join(ws, 'b.txt'), 'BRAVO', 'utf8');

    const sentinel = new SentinelPolicyService({ dataDir: tmp });
    const localExec = new LocalExecEngine({ store });
    const runner = new AgentRunner({
      store,
      vault: new VaultManager(tmp),
      mcpManager: { getToolSchemasForBot: async () => ({ schemas: [], dispatchMap: new Map() }) },
      localExec,
      sentinel,
      broadcast: () => {},
    });

    const th1 = store.createThread({ botId: 'bot-grok-default', title: 'Parallel Read' });
    const res1 = await runner.runTurn({ threadId: th1.id, botId: 'bot-grok-default', userText: 'Read a.txt and b.txt' });
    assert.equal(res1.reply, 'Both files read cleanly.');

    const th2 = store.createThread({ botId: 'bot-grok-default', title: 'Doom Loop' });
    const res2 = await runner.runTurn({ threadId: th2.id, botId: 'bot-grok-default', userText: 'Try missing file repeatedly' });
    assert.equal(res2.reply, 'Synthesized final fallback after repeated tool loop.');
  } finally {
    await mock.close();
    cleanup(tmp);
  }
});

test('DagSwarm Evaluator-Optimizer repairs FAIL->PASS and sibling abort on failure; ModelCouncil ignores bad ballots', async () => {
  const tmp = makeTmp('mimir-swarm-');
  try {
    const store = new AppStore(tmp);
    const bot = store.listBots()[0];
    let auditCount = 0;
    const agiStub = {
      async runElephantPhase() {
        return { spec: 'Build modular widget' };
      },
      async runGoldfishAudit({ targetSummary }) {
        auditCount++;
        if (auditCount === 1) {
          assert.ok(!targetSummary.includes('REPAIRED'));
          return { verdict: 'FAIL', critique: 'Missing edge-case guard' };
        }
        return { verdict: 'PASS', critique: 'All checks verified' };
      },
    };
    const swarm = new DagSwarmEngine({ dataDir: tmp, store, agiHarness: agiStub, broadcast: () => {} });
    const swarmOut = await swarm.runSwarm({
      botId: bot.id,
      goal: 'Ship repaired module',
      recipeId: 'elephant-goldfish-build',
      settings: { provider: 'openai-compat', openaiModel: 'mock-gpt' },
      fetchSearch: async () => [],
      runChatFn: async ({ messages }) => {
        const isRepair = messages.some(m => String(m.content).includes('Fix EVERY flaw'));
        return { content: isRepair ? 'REPAIRED implementation complete' : 'Initial draft', model: 'mock-gpt' };
      },
    });
    assert.equal(swarmOut.audit?.verdict, 'PASS');
    assert.equal(auditCount, 2);

    // Parallel sibling abort on failure
    let siblingAborted = false;
    await assert.rejects(
      () =>
        swarm.runSwarm({
          botId: bot.id,
          goal: 'Abort test',
          customSteps: [
            { id: 'failer', label: 'Failer', dependsOn: [] },
            { id: 'slow', label: 'Slow', dependsOn: [] },
          ],
          stepExecutors: {
            failer: async () => {
              await new Promise(r => setTimeout(r, 20));
              throw new Error('boom');
            },
            slow: async ctx => {
              await new Promise((_resolve, reject) => {
                ctx.signal.addEventListener('abort', () => {
                  siblingAborted = true;
                  reject(new Error('aborted'));
                });
                setTimeout(() => reject(new Error('timeout')), 2000);
              });
            },
          },
          settings: {},
          runChatFn: async () => ({ content: 'ok' }),
        }),
      /boom/i
    );
    assert.equal(siblingAborted, true);

    // ModelCouncil: unparseable Stage 2 peer review does not fabricate ranking
    const council = new ModelCouncilEngine({
      dataDir: tmp,
      store,
      probeFn: async () => ({ ollama: { models: [] }, openai: { ok: false } }),
      chatFn: async ({ messages }) => {
        const sys = messages[0]?.content || '';
        const usr = messages[messages.length - 1]?.content || '';
        if (usr.includes('Blind Peer-Review')) {
          return { content: 'Not valid JSON or ranking prose at all.', model: 'mock-gpt' };
        }
        if (usr.includes('=== CONSENSUS ===')) {
          return { content: '=== CONSENSUS ===\nAgreed.\n\n=== SYNTHESIS ===\nFinal answer.', model: 'mock-gpt' };
        }
        return { content: `Opinion from ${sys.slice(0, 20)}`, model: 'mock-gpt' };
      },
    });
    const convened = await council.convene({ topic: 'Compare designs', useRag: false });
    assert.ok(convened.leaderboard.length > 0);
    assert.ok(convened.leaderboard.every(l => l.bordaScore === 0));
  } finally {
    cleanup(tmp);
  }
});

test('VaultManager backs up corrupt file, AppStore preserves >300 receipt chain anchor, Coordinator enforces security & approve race', async () => {
  const tmpVault = makeTmp('mimir-vault-');
  const vaultFile = path.join(tmpVault, 'vault.enc.json');
  fs.writeFileSync(vaultFile, '{broken-json', 'utf8');
  try {
    assert.throws(() => new VaultManager(tmpVault), /could not be decrypted or parsed/i);
    const files = fs.readdirSync(tmpVault);
    assert.ok(files.some(f => f.startsWith('vault.enc.json.corrupt-')));
  } finally {
    cleanup(tmpVault);
  }

  const tmpStore = makeTmp('mimir-store-');
  try {
    const store = new AppStore(tmpStore);
    for (let i = 0; i < 305; i++) {
      store.appendReceipt({
        id: `r-${i}`,
        runId: `run-${i}`,
        userId: 'local-owner',
        botId: 'bot-grok-default',
        toolCalls: [],
        verified: true,
        unbackedClaims: [],
      });
    }
    const ledger = store.verifyReceiptLedger();
    assert.equal(ledger.valid, true);
    assert.equal(ledger.count, 300);
  } finally {
    cleanup(tmpStore);
  }

  const tmpCoord = makeTmp('mimir-coord-sec-');
  const coord = await startCoordinator({
    dataDir: tmpCoord,
    enableScheduler: false,
    token: 'test-token',
    pairingSessionTtlMs: 60000,
  });
  try {
    // Origin: null rejected with 403
    const nullOriginRes = await fetch(`${coord.url}/v1/health`, { headers: { Origin: 'null' } });
    assert.equal(nullOriginRes.status, 403);

    // Global pairing failure limit even when requestId is omitted
    const reqPair = await fetch(`${coord.url}/v1/pairing/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientName: 'test' }),
    });
    assert.equal(reqPair.status, 201);
    for (let i = 0; i < 6; i++) {
      const bad = await fetch(`${coord.url}/v1/pairing/exchange`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'WRONG1' }),
      });
      if (i < 5) assert.equal(bad.status, 403);
      else assert.equal(bad.status, 429);
    }

    // useSavedKey cross-origin stripping returns error / does not forward saved key
    coord.store.updateSettings({ openaiBaseUrl: 'https://api.openai.com/v1', openaiApiKey: 'sk-saved-secret' });
    const crossTest = await fetch(`${coord.url}/v1/models/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ kind: 'openai-compat', baseUrl: 'http://127.0.0.1:1/v1', useSavedKey: true, model: 'x' }),
    });
    const crossJson = await crossTest.json();
    assert.equal(crossJson.ok, false);

    // Run approve double-claim conflict (409) using deterministic offline research run
    const { run: createdRun } = coord.store.createRun({
      botId: 'bot-grok-default',
      userId: 'local-owner',
      goal: 'Approve race test',
      status: 'AWAITING_APPROVAL',
      metadata: { kind: 'research', mode: 'offline' },
    });
    const appr1 = await fetch(`${coord.url}/v1/runs/${encodeURIComponent(createdRun.id)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: '{}',
    });
    assert.equal(appr1.status, 200);
    // Keep run active while issuing second approve
    coord.store.updateRun(createdRun.id, { status: 'RUNNING' });
    const appr2 = await fetch(`${coord.url}/v1/runs/${encodeURIComponent(createdRun.id)}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: '{}',
    });
    assert.equal(appr2.status, 409);
  } finally {
    await coord.close();
    cleanup(tmpCoord);
  }
});

test('Sentinel inspects leaf strings for .env/secrets, blocks IPv6 metadata, tightens null policy writes, and flushes async audit log', async () => {
  const tmp = makeTmp('mimir-sentinel-leaf-');
  try {
    const store = new AppStore(tmp);
    const bot = store.listBots()[0];
    const sentinel = new SentinelPolicyService({ dataDir: tmp });

    for (const args of [
      { path: '.env' },
      { nested: { target: '/app/secrets/vault.enc' } },
      { files: ['readme.md', '/home/user/.ssh/id_rsa'] },
      { file: 'config/credentials.json' },
    ]) {
      const dec = sentinel.evaluateToolRequest({ bot, toolName: 'fs_read', args });
      assert.equal(dec.decision, 'DENY', `Expected DENY for ${JSON.stringify(args)}, got ${dec.decision}`);
    }

    for (const url of ['http://[fd00:ec2::254]/latest/meta-data', 'http://[fe80::1]/status']) {
      const dec = sentinel.evaluateToolRequest({ bot, toolName: 'browser_open', args: { target: url } });
      assert.equal(dec.decision, 'DENY', `Expected DENY for IPv6 metadata ${url}`);
      assert.match(dec.reason, /metadata/i);
    }

    const writeNullPolicy = sentinel.evaluateToolRequest({
      bot,
      toolName: 'fs_write',
      args: { path: 'notes.txt', content: 'ok' },
      approvalPolicy: null,
    });
    assert.equal(writeNullPolicy.decision, 'REQUIRE_APPROVAL');

    const readNullPolicy = sentinel.evaluateToolRequest({
      bot,
      toolName: 'fs_read',
      args: { path: 'notes.txt' },
      approvalPolicy: null,
    });
    assert.equal(readNullPolicy.decision, 'ALLOW');

    // In-memory ring buffer is synchronously updated while file writes are queued asynchronously
    const events = sentinel.listAuditEvents(10);
    assert.ok(events.length >= 7);
    await sentinel.flushAuditLog();
    const auditText = fs.readFileSync(path.join(tmp, 'sentinel-audit.jsonl'), 'utf8');
    const lines = auditText.trim().split('\n').filter(Boolean);
    assert.ok(lines.length >= 7);
  } finally {
    cleanup(tmp);
  }
});

test('AppStore supports forkThread, branchEditMessage, isSubagent filtering, space schema, and updateBotMemory provenance', () => {
  const tmp = makeTmp('mimir-store-branch-');
  try {
    const store = new AppStore(tmp);
    const bot = store.listBots()[0];

    const space = store.createSpace({
      name: 'Research Lab',
      systemPrompt: 'Follow strict citation discipline.',
      attachedPaths: ['docs/spec.md', 'src/index.mjs'],
      defaultBotId: bot.id,
      memoryScope: 'space',
    });
    assert.equal(space.systemPrompt, 'Follow strict citation discipline.');
    assert.deepEqual(space.attachedPaths, ['docs/spec.md', 'src/index.mjs']);
    assert.equal(space.defaultBotId, bot.id);
    assert.equal(space.memoryScope, 'space');

    const mem = store.updateBotMemory({
      botId: bot.id,
      key: 'project_codename',
      value: 'Project Atlas',
      scope: 'space',
      spaceId: space.id,
      provenance: 'user:explicit',
      verified: true,
      confidence: 0.95,
    });
    assert.equal(mem.provenance, 'user:explicit');
    assert.equal(mem.scope, 'space');
    assert.equal(mem.spaceId, space.id);

    const otherSpaceMem = store.updateBotMemory({
      botId: bot.id,
      key: 'other_space_only',
      value: 'Secret Beta',
      scope: 'space',
      spaceId: 'space-other',
    });
    assert.equal(otherSpaceMem.spaceId, 'space-other');

    const botScopedMem = store.updateBotMemory({
      botId: bot.id,
      key: 'bot_pref',
      value: 'concise',
      scope: 'bot',
    });
    assert.equal(botScopedMem.scope, 'bot');

    const scopedMems = store.getMemories(bot.id, 'local-owner', { spaceId: space.id });
    assert.ok(scopedMems.some(m => m.key === 'project_codename'));
    assert.ok(!scopedMems.some(m => m.key === 'other_space_only'));

    const mainThread = store.createThread({ botId: bot.id, spaceId: space.id, title: 'Main Branch' });
    const m1 = store.appendMessage(mainThread.id, { role: 'user', content: 'First question' }).messages.at(-1);
    const m2 = store.appendMessage(mainThread.id, { role: 'assistant', content: 'First answer' }).messages.at(-1);
    const m3 = store.appendMessage(mainThread.id, { role: 'user', content: 'Second question' }).messages.at(-1);
    assert.equal(store.getThread(mainThread.id).activeLeafId, m3.id);

    // Branch edit m2 -> creates sibling branch excluding m3 from activeMessages
    const edited = store.branchEditMessage({
      threadId: mainThread.id,
      messageId: m2.id,
      newContent: 'Edited first answer',
    });
    assert.equal(edited.editedMessage.parentId, m1.id);
    assert.ok(edited.editedMessage.branchGroupId);
    const activeIds = store.getActiveMessages(mainThread.id).map(m => m.id);
    assert.deepEqual(activeIds, [m1.id, edited.editedMessage.id]);

    // Fork from m1 with a new user prompt
    const forked = store.forkThread({
      threadId: mainThread.id,
      fromMessageId: m1.id,
      newUserText: 'Alternative follow-up',
    });
    assert.equal(forked.parentThreadId, mainThread.id);
    assert.equal(forked.forkedFromMessageId, m1.id);
    assert.equal(forked.spaceId, space.id);
    assert.equal(forked.messages.length, 2);
    assert.equal(forked.messages[1].content, 'Alternative follow-up');

    // Subagent thread filtering
    const sub = store.createThread({
      botId: bot.id,
      isSubagent: true,
      parentThreadId: mainThread.id,
      title: 'Subagent: helper',
    });
    assert.ok(store.getThread(sub.id));
    assert.ok(!store.listThreads().some(t => t.id === sub.id));
    assert.ok(store.listThreads({ includeSubagents: true }).some(t => t.id === sub.id));
  } finally {
    cleanup(tmp);
  }
});

test('AgentRunner injects Space context, filters subagent threads, runs bounded parallel @mentions, and DeepResearch auto falls back', async () => {
  const tmp = makeTmp('mimir-runner-space-');
  const seenSystems = [];
  const server = await startCustomOpenAiServer(async (_req, res, body) => {
    const sys = (body.messages || []).find(m => m.role === 'system')?.content || '';
    seenSystems.push(sys);
    const lastUser = [...(body.messages || [])].reverse().find(m => m.role === 'user')?.content || '';
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      choices: [{ message: { role: 'assistant', content: `Ack: ${String(lastUser).slice(0, 40)}` } }],
    }));
  });
  try {
    const store = new AppStore(tmp);
    store.updateSettings({
      provider: 'openai-compat',
      openaiBaseUrl: server.baseUrl,
      openaiModel: 'test-model',
      approvalPolicy: 'reversibility',
      localOnly: false,
    });
    const bots = store.listBots();
    const lead = bots[0];
    const allyA = store.createBot({ name: 'AtlasA', role: 'Analyst A', systemPrompt: 'You are AtlasA.' });
    const allyB = store.createBot({ name: 'AtlasB', role: 'Analyst B', systemPrompt: 'You are AtlasB.' });

    const space = store.createSpace({
      name: 'Apollo Space',
      systemPrompt: 'SPACE_DIRECTIVE_ALPHA: Always cite workspace artifacts.',
      attachedPaths: ['specs/apollo.md'],
      defaultBotId: lead.id,
      memoryScope: 'space',
    });
    store.updateBotMemory({
      botId: lead.id,
      key: 'apollo_budget',
      value: '12M',
      scope: 'space',
      spaceId: space.id,
      provenance: 'user:test',
    });

    const events = [];
    const runner = new AgentRunner({
      store,
      localExec: new LocalExecEngine({ store }),
      mcpManager: { getToolSchemasForBot: async () => ({ schemas: [], dispatchMap: new Map() }) },
      broadcast: (ev, data) => events.push({ ev, data }),
    });

    const thread = store.createThread({ botId: lead.id, spaceId: space.id, title: 'Apollo Thread' });
    const out = await runner.runTurn({
      threadId: thread.id,
      botId: lead.id,
      userText: 'Check launch readiness with @AtlasA and @AtlasB',
      trustedUserInput: true,
    });

    assert.ok(out.reply);
    assert.ok(seenSystems.some(s => s.includes('SPACE_DIRECTIVE_ALPHA')));
    assert.ok(seenSystems.some(s => s.includes('specs/apollo.md')));
    assert.ok(seenSystems.some(s => s.includes('apollo_budget: 12M')));

    // Both @AtlasA and @AtlasB reported in order, followed by lead assistant reply
    const msgs = store.getThread(thread.id).messages;
    assert.equal(msgs[1].speakerName, 'AtlasA');
    assert.equal(msgs[2].speakerName, 'AtlasB');
    assert.equal(msgs[3].role, 'assistant');

    // Subagent threads exist via getThread but are excluded from default listThreads()
    const visibleIds = new Set(store.listThreads().map(t => t.id));
    assert.ok(visibleIds.has(thread.id));
    assert.equal(store.listThreads().filter(t => t.isSubagent).length, 0);
    assert.ok(store.listThreads({ includeSubagents: true }).filter(t => t.isSubagent).length >= 2);

    // DeepResearch 'auto' mode emits research:progress phases and falls back offline cleanly on web error
    const researchProgress = [];
    const dr = new DeepResearchEngine({
      store,
      searchFn: async () => { throw new Error('network unreachable'); },
      broadcast: (ev, data) => {
        if (ev === 'research:progress') researchProgress.push(data);
      },
    });
    const res = await dr.runResearch({
      query: 'local-first encryption security',
      mode: 'auto',
      threadId: thread.id,
      maxSources: 4,
    });
    assert.equal(res.requestedMode, 'auto');
    assert.equal(res.offlineFallback, true);
    assert.ok(res.corpusHits >= 1);
    const phases = new Set(researchProgress.map(p => p.phase));
    for (const reqPhase of ['planning', 'searching', 'reading', 'synthesizing']) {
      assert.ok(phases.has(reqPhase), `Expected phase ${reqPhase}`);
    }
    const synthEvt = [...researchProgress].reverse().find(p => p.phase === 'synthesizing');
    assert.ok(Array.isArray(synthEvt?.fetchedSources));
    assert.ok(synthEvt.fetchedSources.length >= 1);
    assert.equal(synthEvt.fetchedSources[0].status, 'verified');

    // skipUserAppend re-run (e.g. branch-edit rerun) appends assistant without duplicating user message
    const branchThread = store.createThread({ botId: lead.id, title: 'Branch Rerun' });
    store.appendMessage(branchThread.id, { role: 'user', content: 'Original prompt' });
    const countBefore = store.getThread(branchThread.id).messages.length;
    await runner.run({ threadId: branchThread.id, botId: lead.id, skipUserAppend: true });
    const branchMsgs = store.getThread(branchThread.id).messages;
    assert.equal(branchMsgs.length, countBefore + 1);
    assert.equal(branchMsgs.at(-1).role, 'assistant');
  } finally {
    await server.close();
    cleanup(tmp);
  }
});
