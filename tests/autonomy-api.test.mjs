import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { AppStore } from '../daemon/store.mjs';
import { VaultManager } from '../daemon/vault.mjs';
import { McpManager } from '../daemon/mcp-manager.mjs';
import {
  LocalExecEngine,
  MAX_SUBAGENT_DEPTH,
  classifyToolApproval,
  filterToolsForExecutionMode,
} from '../daemon/local-exec.mjs';
import { AgentRunner } from '../daemon/agent-runner.mjs';
import { startCoordinator } from '../daemon/coordinator.mjs';

function makeTmpDir(prefix = 'mimir-autonomy-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function cleanupDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // ignore Windows file-lock cleanup race in temp dir
  }
}

async function startMockOpenAiServer(handler) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    const raw = Buffer.concat(chunks).toString('utf8');
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ method: req.method, url: req.url, body });

    if (req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'mock-model' }] }));
    }

    const out = await handler(body, requests.length, req);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
    });

    if (Array.isArray(out?.toolCalls) && out.toolCalls.length > 0) {
      const toolCallsDelta = out.toolCalls.map((tc, index) => ({
        index,
        id: tc.id || `call_${index + 1}`,
        type: 'function',
        function: {
          name: tc.name,
          arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {}),
        },
      }));
      res.write(`data: ${JSON.stringify({ model: out.model || body.model, choices: [{ delta: { tool_calls: toolCallsDelta }, finish_reason: 'tool_calls' }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      return res.end();
    }

    const text = String(out?.content ?? 'ok');
    res.write(`data: ${JSON.stringify({ model: out.model || body.model, choices: [{ delta: { content: text }, finish_reason: 'stop' }] })}\n\n`);
    res.write('data: [DONE]\n\n');
    return res.end();
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    requests,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

test('AppStore persists executionMode, parentBotId, specialistTag, per-thread override, and migrates legacy bots', t => {
  const dir = makeTmpDir();
  t.after(() => cleanupDir(dir));

  const store = new AppStore(dir);
  const defaultBots = store.listBots();
  assert.ok(defaultBots.length >= 1);
  assert.equal(defaultBots[0].executionMode, 'agent');
  assert.equal(defaultBots[0].parentBotId, null);
  assert.equal(defaultBots[0].specialistTag, null);

  const child = store.createBot({
    name: 'Code Ally',
    role: 'TypeScript Reviewer',
    executionMode: 'code',
    parentBotId: defaultBots[0].id,
    specialistTag: 'ts-reviewer',
    allowedTools: ['fs_read', 'shell_exec'],
  });
  assert.equal(child.executionMode, 'code');
  assert.equal(child.parentBotId, defaultBots[0].id);
  assert.equal(child.specialistTag, 'ts-reviewer');
  assert.deepEqual(child.allowedTools, ['fs_read', 'shell_exec']);

  const updated = store.updateBot(child.id, {
    executionMode: 'chat',
    specialistTag: 'read-only-helper',
  });
  assert.equal(updated.executionMode, 'chat');
  assert.equal(updated.specialistTag, 'read-only-helper');
  assert.equal(updated.parentBotId, defaultBots[0].id);

  // Invalid executionMode normalizes safely
  const invalidFallback = store.createBot({ name: 'Norm Bot', executionMode: 'unsafe-mode' });
  assert.equal(invalidFallback.executionMode, 'agent');

  // Per-thread executionMode override
  const thread = store.createThread({ botId: child.id, title: 'Override test', executionMode: 'code' });
  assert.equal(thread.executionMode, 'code');
  const patchedThread = store.updateThread(thread.id, { executionMode: 'agent' });
  assert.equal(patchedThread.executionMode, 'agent');

  // Legacy store migration preserves missing fields with clean defaults
  const storePath = path.join(dir, 'store.json');
  const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  raw.bots.push({
    id: 'legacy-bot',
    name: 'Legacy Bot',
    role: 'General',
    tools: { shell: true, fs: true, browser: true, memory: true, vault: false },
  });
  fs.writeFileSync(storePath, JSON.stringify(raw, null, 2), 'utf8');

  const reloaded = new AppStore(dir);
  const migrated = reloaded.getBot('legacy-bot');
  assert.equal(migrated.executionMode, 'agent');
  assert.equal(migrated.parentBotId, null);
  assert.equal(migrated.specialistTag, null);
  assert.equal(reloaded.getBot(child.id).executionMode, 'chat');
  assert.equal(reloaded.getThread(thread.id).executionMode, 'agent');
});

test('filterToolsForExecutionMode enforces chat/code/agent tool policies cleanly', () => {
  assert.equal(MAX_SUBAGENT_DEPTH, 2);

  const sampleTools = [
    'browser_open',
    'shell_exec',
    'fs_write',
    'desktop_control',
    'vault_use',
    'memory_save',
    'knowledge_ingest',
    'bot_spawn',
    'subagent_loop',
    'mcp__slack_send_message',
    'mcp__github_get_issue',
    'fs_read',
    'fs_list',
    'memory_read',
    'knowledge_search',
    'council_convene',
  ].map(name => ({ type: 'function', function: { name, parameters: { type: 'object' } } }));

  const names = list => list.map(t => t.function.name);

  const chatNames = names(filterToolsForExecutionMode(sampleTools, 'chat'));
  assert.ok(!chatNames.includes('shell_exec'));
  assert.ok(!chatNames.includes('fs_write'));
  assert.ok(!chatNames.includes('browser_open'));
  assert.ok(!chatNames.includes('desktop_control'));
  assert.ok(!chatNames.includes('vault_use'));
  assert.ok(!chatNames.includes('memory_save'));
  assert.ok(!chatNames.includes('knowledge_ingest'));
  assert.ok(!chatNames.includes('bot_spawn'));
  assert.ok(!chatNames.includes('subagent_loop'));
  assert.ok(!chatNames.includes('mcp__slack_send_message'));
  assert.deepEqual(chatNames, [
    'mcp__github_get_issue',
    'fs_read',
    'fs_list',
    'memory_read',
    'knowledge_search',
    'council_convene',
  ]);

  const codeNames = names(filterToolsForExecutionMode(sampleTools, 'code'));
  assert.equal(codeNames.length, sampleTools.length);
  const idxFsRead = codeNames.indexOf('fs_read');
  const idxShell = codeNames.indexOf('shell_exec');
  const idxSubagent = codeNames.indexOf('subagent_loop');
  const idxCouncil = codeNames.indexOf('council_convene');
  const idxBrowser = codeNames.indexOf('browser_open');
  assert.ok(idxFsRead < idxBrowser);
  assert.ok(idxShell < idxBrowser);
  assert.ok(idxSubagent < idxBrowser);
  assert.ok(idxCouncil < idxBrowser);

  const agentNames = names(filterToolsForExecutionMode(sampleTools, 'agent'));
  assert.deepEqual(agentNames, names(sampleTools));
});

test('bot_spawn enforces strict privilege non-escalation, sandboxes/<id>, and high-tier approval gating', async t => {
  const dir = makeTmpDir();
  t.after(() => cleanupDir(dir));

  const store = new AppStore(dir);
  const vault = new VaultManager(dir);
  const mcpManager = new McpManager(store);
  const events = [];
  const exec = new LocalExecEngine({
    store,
    vault,
    mcpManager,
    onEvent: (event, data) => events.push({ event, data }),
  });

  // Approval classification checks
  const gateDefault = classifyToolApproval('bot_spawn', { name: 'Spy', role: 'Helper' }, 'ask-writes');
  assert.equal(gateDefault.needsApproval, true);
  assert.equal(gateDefault.tier, 'high');

  const gateSession = classifyToolApproval('bot_spawn', { name: 'Ally', role: 'QA' }, 'ask-writes', {
    sessionApprovedTools: new Set(['bot_spawn']),
  });
  assert.equal(gateSession.needsApproval, false);
  assert.equal(gateSession.tier, 'high');

  const gateBotPolicy = classifyToolApproval('bot_spawn', { name: 'Ally', role: 'QA' }, 'ask-writes', {
    bot: { approvalPolicy: 'auto-approve' },
  });
  assert.equal(gateBotPolicy.needsApproval, false);

  assert.equal(classifyToolApproval('council_convene', { topic: 'arch' }, 'ask-writes').needsApproval, false);
  assert.equal(classifyToolApproval('council_convene', { topic: 'arch' }, 'ask-writes').tier, 'read');
  assert.equal(classifyToolApproval('subagent_loop', { goal: 'inspect' }, 'ask-writes').tier, 'delegation');

  const parentBot = store.createBot({
    name: 'Restricted Parent',
    role: 'Workspace Reader',
    executionMode: 'code',
    tools: { shell: false, fs: true, browser: false, memory: true, vault: false },
    allowedTools: ['fs_read', 'fs_write', 'memory_read', 'bot_spawn', 'subagent_loop'],
  });

  const outRaw = await exec.executeTool({
    bot: parentBot,
    toolName: 'bot_spawn',
    args: {
      name: 'Escalation Tester',
      role: 'Security QA',
      specialistTag: 'security-qa',
      executionMode: 'agent', // tries to escalate from parent's 'code' -> must clamp to 'code'
      allowedTools: ['shell_exec', 'vault_use', 'browser_open', 'fs_read', 'memory_save'],
    },
  });
  const parsed = JSON.parse(outRaw);
  assert.equal(parsed.ok, true);
  const child = store.getBot(parsed.bot.id);
  assert.ok(child);
  assert.equal(child.parentBotId, parentBot.id);
  assert.equal(child.specialistTag, 'security-qa');
  assert.equal(child.executionMode, 'code'); // clamped to parent's mode rank

  // Only fs_read overlaps both requestedTools and parent's effective allowedTools
  assert.deepEqual(child.allowedTools, ['fs_read']);
  assert.equal(child.tools.shell, false);
  assert.equal(child.tools.vault, false);
  assert.equal(child.tools.browser, false);
  assert.equal(child.tools.fs, true);

  // Child workspace strictly inside sandboxes/<newBotId>
  const expectedWorkspace = path.resolve(dir, 'sandboxes', child.id);
  assert.equal(path.resolve(parsed.workspace), expectedWorkspace);
  assert.ok(fs.existsSync(expectedWorkspace));

  // Child attempting disallowed tool is blocked at executeTool layer too
  const forbiddenRes = await exec.executeTool({
    bot: child,
    toolName: 'shell_exec',
    args: { command: 'echo pwned' },
  });
  assert.match(forbiddenRes, /^ERROR:/i);

  // Capability wildcard 'fs' must not escalate read-only parent into fs_write, and empty allowedMcpIds stays locked
  const readOnlyParent = store.createBot({
    name: 'ReadOnly Parent',
    role: 'Reader',
    executionMode: 'code',
    tools: { shell: false, fs: true, browser: false, memory: false, vault: false },
    allowedTools: ['fs_read', 'fs_list', 'bot_spawn'],
  });
  const capOut = await exec.executeTool({
    bot: readOnlyParent,
    toolName: 'bot_spawn',
    args: {
      name: 'NoEscalation Child',
      role: 'Reader Child',
      allowedTools: ['fs'],
      allowedMcpIds: [],
    },
  });
  const capParsed = JSON.parse(capOut);
  assert.equal(capParsed.ok, true);
  const capChild = store.getBot(capParsed.bot.id);
  assert.deepEqual(capChild.allowedTools, ['fs_list', 'fs_read']);
  assert.deepEqual(capChild.allowedMcpIds, ['__none__']);
  store.updateSettings({ mcpBoxServers: [{ id: 'srv-mock', name: 'Mock', enabled: true }] });
  mcpManager.clients.set('srv-mock', { status: 'connected', tools: [{ name: 'mock_ping', description: 'ping' }] });
  const parentMcp = await mcpManager.getToolSchemasForBot(readOnlyParent);
  const childMcp = await mcpManager.getToolSchemasForBot(capChild);
  assert.equal(parentMcp.schemas.length, 1);
  assert.equal(childMcp.schemas.length, 0);
  const writeBlocked = await exec.executeTool({
    bot: capChild,
    toolName: 'fs_write',
    args: { path: 'pwn.txt', content: 'no' },
  });
  assert.match(writeBlocked, /^ERROR:/i);

  assert.ok(events.some(e => e.event === 'swarm:step' && e.data.botId === child.id && e.data.status === 'done'));
});

test('subagent_loop enforces MAX_SUBAGENT_DEPTH <= 2, emits swarm:step, and AgentRunner stops cleanly above depth 2', async t => {
  const dir = makeTmpDir();
  t.after(() => cleanupDir(dir));

  const store = new AppStore(dir);
  const vault = new VaultManager(dir);
  const mcpManager = new McpManager(store);
  const events = [];

  const parent = store.createBot({ name: 'Parent Lead', role: 'Lead' });
  const ally = store.createBot({
    name: 'Audit Ally',
    role: 'Audit Specialist',
    parentBotId: parent.id,
    specialistTag: 'audit-sec',
  });

  const calls = [];
  const exec = new LocalExecEngine({
    store,
    vault,
    mcpManager,
    onEvent: (event, data) => events.push({ event, data }),
    runSubagentTurn: async opts => {
      calls.push(opts);
      return {
        ok: true,
        botId: opts.bot.id,
        reply: `Checked ${opts.goal} at depth ${opts.depth}`,
        stepsUsed: 2,
        summary: 'Audit complete',
      };
    },
  });

  const okRaw = await exec.executeTool({
    bot: parent,
    toolName: 'subagent_loop',
    args: { role: 'audit-sec', goal: 'Review sandbox guards', maxSteps: 3 },
    context: { depth: 0, threadId: 'thr-root' },
  });
  const okParsed = JSON.parse(okRaw);
  assert.equal(okParsed.ok, true);
  assert.equal(okParsed.botId, ally.id);
  assert.equal(okParsed.stepsUsed, 2);
  assert.match(okParsed.reply, /depth 1/);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].depth, 1);
  assert.ok(events.some(e => e.event === 'swarm:step' && e.data.status === 'running'));
  assert.ok(events.some(e => e.event === 'swarm:step' && e.data.status === 'done' && e.data.botId === ally.id));

  // Cross-bot hijack attempt targeting non-child bot is rejected
  const unrelatedBot = store.createBot({ name: 'Unrelated Sibling', role: 'Other' });
  const hijackAttempt = await exec.executeTool({
    bot: parent,
    toolName: 'subagent_loop',
    args: { botId: unrelatedBot.id, goal: 'Cross-bot escalation' },
    context: { depth: 0, threadId: 'thr-root' },
  });
  assert.match(hijackAttempt, /^ERROR:/i);
  assert.equal(calls.length, 1);

  // Depth 2 -> child would be 3 > MAX_SUBAGENT_DEPTH (even if args.depth attempts spoof = 1)
  const rejected = await exec.executeTool({
    bot: ally,
    toolName: 'subagent_loop',
    args: { botId: ally.id, goal: 'Recursive loop', depth: 1 },
    context: { depth: 2, threadId: 'thr-sub' },
  });
  assert.match(rejected, /^ERROR:.*Subagent depth 3 exceeds MAX_SUBAGENT_DEPTH \(2\)/);
  assert.equal(calls.length, 1);

  // AgentRunner directly rejects depth > 2 cleanly without model invocation
  const runner = new AgentRunner({
    store,
    vault,
    mcpManager,
    localExec: exec,
    broadcast: (event, data) => events.push({ event, data }),
  });
  const subStop = await runner.runSubagentTurn({ bot: ally, goal: 'Too deep', depth: 3 });
  assert.equal(subStop.ok, false);
  assert.equal(subStop.stepsUsed, 0);
  assert.match(subStop.reply, /exceeds MAX_SUBAGENT_DEPTH/);

  const turnStop = await runner.runTurn({ botId: ally.id, userText: 'Too deep', depth: 3 });
  assert.equal(turnStop.stoppedByDepthLimit, true);
  assert.equal(turnStop.stepsUsed, 0);
});

test('AgentRunner enforces executionMode, handles /council, /spawn, /research commands, and bounds 1.7B/4B Reflexion retry to 1', async t => {
  const dir = makeTmpDir();
  t.after(() => cleanupDir(dir));

  let mode = 'chat-check';
  let smallModelAttempts = 0;
  const mockServer = await startMockOpenAiServer((body, reqIdx) => {
    if (mode === 'chat-check') {
      return { content: 'Chat-only verified answer', model: body.model };
    }
    if (mode === 'spawn-task' || mode === 'research-synth') {
      return { content: 'Grounded synthesis response [1].', model: body.model };
    }
    if (mode === 'reflexion-recover') {
      smallModelAttempts++;
      if (smallModelAttempts === 1) {
        return { content: '<tool_call>{"name":"fs_read"}</tool_call>', model: 'qwen3:1.7b' };
      }
      return { content: 'Repaired cleanly after Reflexion feedback.', model: 'qwen3:1.7b' };
    }
    if (mode === 'reflexion-always-bad') {
      smallModelAttempts++;
      return {
        toolCalls: [{ id: `bad_${reqIdx}`, name: 'fs_read', arguments: { raw: '{bad json' } }],
        model: 'qwen3.5:4b',
      };
    }
    if (mode === 'large-model-bad') {
      smallModelAttempts++;
      return { content: '{"broken":', model: 'qwen3:32b' };
    }
    return { content: 'ok', model: body.model };
  });
  t.after(() => mockServer.close());

  const store = new AppStore(dir);
  store.updateSettings({
    provider: 'openai-compat',
    openaiBaseUrl: mockServer.baseUrl,
    openaiApiKey: 'test-key',
    openaiModel: 'qwen3:1.7b',
    localOnly: true,
    approvalPolicy: 'auto-approve',
  });
  const vault = new VaultManager(dir);
  const mcpManager = new McpManager(store);
  const events = [];
  const broadcast = (event, data) => events.push({ event, data });

  const localExec = new LocalExecEngine({ store, vault, mcpManager, onEvent: broadcast });
  const ragCalls = [];
  const mockRagEngine = {
    retrieve: async opts => {
      ragCalls.push(opts);
      return {
        query: opts.query,
        grade: 'CORRECT',
        confidence: 0.91,
        webUsed: false,
        citations: [{ title: 'LightRAG Spec', url: '', text: 'Hybrid graph + vector retrieval.', tags: ['[IsRelevant]'] }],
        graphEntities: [{ id: 'lightrag', label: 'LightRAG', hop: 0, score: 1 }],
        contextBlock: '[RAG Context]\n- [1] LightRAG Spec: Hybrid graph + vector retrieval.',
      };
    },
  };
  const councilCalls = [];
  const mockCouncil = {
    convene: async opts => {
      councilCalls.push(opts);
      return {
        runId: 'council-mock-1',
        consensus: 'Sandbox all dynamically spawned bots and enforce intersection permissions.',
        opinions: [{ seatId: 's1', name: 'Architect', model: 'qwen3:1.7b', response: 'Intersect permissions.' }],
        leaderboard: [{ seatId: 's1', name: 'Architect', model: 'qwen3:1.7b', bordaScore: 6 }],
        actionItems: [{ title: 'Add permission test', ownerRole: 'QA', prompt: 'Verify child intersection' }],
        citations: [],
      };
    },
  };

  const runner = new AgentRunner({
    store,
    vault,
    mcpManager,
    localExec,
    ragEngine: mockRagEngine,
    modelCouncil: mockCouncil,
    broadcast,
  });

  // 1) executionMode: 'chat' strips mutating/shell/browser tools from OpenAI request payload
  const chatBot = store.createBot({ name: 'Chat Bot', executionMode: 'chat' });
  const chatOut = await runner.runTurn({ botId: chatBot.id, userText: 'Summarize status' });
  assert.equal(chatOut.reply, 'Chat-only verified answer');
  const chatReqTools = mockServer.requests[mockServer.requests.length - 1].body.tools.map(t => t.function.name);
  assert.ok(!chatReqTools.includes('shell_exec'));
  assert.ok(!chatReqTools.includes('fs_write'));
  assert.ok(!chatReqTools.includes('browser_open'));
  assert.ok(!chatReqTools.includes('bot_spawn'));
  assert.ok(!chatReqTools.includes('subagent_loop'));
  assert.ok(chatReqTools.includes('fs_read'));
  assert.ok(chatReqTools.includes('council_convene'));

  // 2) /council command
  const agentBot = store.listBots()[0];
  const councilOut = await runner.runTurn({ botId: agentBot.id, userText: '/council Sandbox boundaries' });
  assert.equal(councilCalls.length, 1);
  assert.equal(councilCalls[0].topic, 'Sandbox boundaries');
  assert.match(councilOut.reply, /Sandbox all dynamically spawned bots/);
  assert.ok(events.some(e => e.event === 'swarm:step' && e.data.step?.id === 'council-run' && e.data.step?.status === 'done'));

  // 3) /spawn <role> | <goal>
  mode = 'spawn-task';
  const beforeCount = store.listBots().length;
  const spawnOut = await runner.runTurn({ botId: agentBot.id, userText: '/spawn sec-auditor | Check auth routes' });
  assert.equal(store.listBots().length, beforeCount + 1);
  const spawnedChild = store.listBots().find(b => b.parentBotId === agentBot.id && b.specialistTag === 'sec-auditor');
  assert.ok(spawnedChild);
  assert.match(spawnOut.reply, /Spawned Ally/);
  assert.match(spawnOut.reply, /Grounded synthesis response/);
  assert.ok(events.some(e => e.event === 'swarm:step' && e.data.step?.id === 'spawn-task' && e.data.step?.status === 'done'));

  // 4) /research <topic>
  mode = 'research-synth';
  const researchOut = await runner.runTurn({ botId: agentBot.id, userText: '/research LightRAG graph retrieval' });
  assert.equal(ragCalls.length, 1);
  assert.equal(ragCalls[0].useWebFallback, false); // localOnly: true disables web fallback
  assert.match(researchOut.reply, /LightRAG Spec/);
  assert.match(researchOut.reply, /CRAG CORRECT/);

  // 5) Reflexion repair retry on qwen3:1.7b succeeds after 1 bounded retry
  mode = 'reflexion-recover';
  smallModelAttempts = 0;
  const reqBase = mockServer.requests.length;
  const reflexOut = await runner.runTurn({ botId: agentBot.id, userText: 'Read note.txt' });
  assert.equal(smallModelAttempts, 2);
  assert.equal(reflexOut.reply, 'Repaired cleanly after Reflexion feedback.');
  const secondReqMsgs = mockServer.requests[reqBase + 1].body.messages;
  assert.ok(secondReqMsgs.some(m => m.role === 'user' && m.content.includes('[Reflexion Repair]')));

  // 6) Reflexion caps strictly at 1 retry even when model keeps emitting bad tool JSON (qwen3.5:4b)
  mode = 'reflexion-always-bad';
  smallModelAttempts = 0;
  store.updateSettings({ openaiModel: 'qwen3.5:4b' });
  await runner.runTurn({ botId: agentBot.id, userText: 'Read broken' });
  assert.equal(smallModelAttempts, 2);

  // 7) Larger non-small model does NOT invoke Reflexion repair retry loop
  mode = 'large-model-bad';
  smallModelAttempts = 0;
  store.updateSettings({ openaiModel: 'qwen3:32b' });
  await runner.runTurn({ botId: agentBot.id, userText: 'Say json' });
  assert.equal(smallModelAttempts, 1);
});

test('Coordinator autonomy HTTP routes enforce auth, vault redaction, localOnly, bot/thread fields, voice duplex fallback & close()', async t => {
  const dir = makeTmpDir();
  t.after(() => cleanupDir(dir));

  const secretVal = `sk-mimir-secret-${crypto.randomBytes(6).toString('hex')}`;
  const mockServer = await startMockOpenAiServer(() => ({
    content: `Agent reply containing ${secretVal}`,
    model: 'qwen3:1.7b',
  }));
  t.after(() => mockServer.close());

  let voiceClosed = false;
  let shouldFailTts = false;
  const voiceCalls = [];
  const mockVoiceEngine = {
    async getStatus() {
      return { ok: true, engines: ['sapi'] };
    },
    async synthesizeTurn(opts) {
      voiceCalls.push(opts);
      if (shouldFailTts) throw new Error(`TTS device missing (${secretVal})`);
      return {
        ok: true,
        buffer: Buffer.from('RIFFmockwav'),
        mime: 'audio/wav',
        engine: opts.localOnly ? 'sapi' : 'edge-tts',
        voice: opts.voice,
        fallbackUsed: Boolean(opts.localOnly),
      };
    },
    async close() {
      voiceClosed = true;
    },
  };

  const councilHistory = [];
  const mockCouncil = {
    async listCouncilSeats() {
      return [
        { seatId: 'perspective:architect', name: 'Architect', model: 'qwen3:1.7b', provider: 'ollama' },
        { seatId: 'perspective:skeptic', name: 'Skeptic', model: 'qwen3:1.7b', provider: 'ollama' },
      ];
    },
    listHistory({ limit = 20 } = {}) {
      return councilHistory.slice(0, limit);
    },
    async convene(opts) {
      if (opts.useRag && opts.ragEngine) {
        await opts.ragEngine.retrieve({ query: opts.topic, topK: 3, useWebFallback: true });
      }
      const rec = {
        id: 'council-run-1',
        topic: opts.topic,
        synthesis: `Consensus includes ${secretVal}`,
        consensus: `Consensus includes ${secretVal}`,
        opinions: [{ seatId: 'perspective:architect', name: 'Architect', response: `Safe view ${secretVal}` }],
        leaderboard: [{ seatId: 'perspective:architect', name: 'Architect', bordaScore: 3 }],
        actionItems: [{ title: 'Ship patch', ownerRole: 'Engineer', prompt: 'Verify routes' }],
      };
      councilHistory.unshift(rec);
      return rec;
    },
  };

  const ctx = await startCoordinator({
    dataDir: dir,
    token: 'tok-autonomy-123',
    enableRust: false,
    enableScheduler: false,
    modelCouncil: mockCouncil,
    voiceEngine: mockVoiceEngine,
  });
  let closedInTest = false;
  t.after(async () => {
    if (!closedInTest) await ctx.close();
  });

  ctx.vault.addEntry({ kind: 'secret', label: 'API_SECRET', fields: { value: secretVal } });
  ctx.store.updateSettings({
    provider: 'openai-compat',
    openaiBaseUrl: mockServer.baseUrl,
    openaiApiKey: 'mock-key',
    openaiModel: 'qwen3:1.7b',
    localOnly: true,
  });

  // Seed 1 doc into KnowledgeBase/RagEngine and verify localOnly disables web fallback
  let webCalled = false;
  ctx.ragEngine.fetchSearch = async () => {
    webCalled = true;
    return [{ title: 'External Web', url: 'https://example.com', snippet: 'Remote leak' }];
  };
  ctx.knowledge.ingestDocument({
    title: 'Local Autonomy Doc',
    source: 'test',
    content: `Council and LightRAG architecture uses ${secretVal} safely.`,
    yearTag: '2026',
  });

  const api = async (method, p, body = null, auth = 'Bearer tok-autonomy-123') => {
    const res = await fetch(`${ctx.url}${p}`, {
      method,
      headers: {
        ...(auth ? { Authorization: auth } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json() };
  };

  // Auth enforcement on new routes
  assert.equal((await api('GET', '/v1/council/seats', null, null)).status, 401);
  assert.equal((await api('GET', '/v1/council/history', null, null)).status, 401);
  assert.equal((await api('POST', '/v1/council/run', { topic: 'x' }, null)).status, 401);
  assert.equal((await api('GET', '/v1/rag/graph', null, null)).status, 401);
  assert.equal((await api('POST', '/v1/rag/query', { query: 'x' }, null)).status, 401);
  assert.equal((await api('POST', '/v1/voice/duplex', { text: 'hi' }, null)).status, 401);

  // Bot & thread persistence routes
  const createdBot = await api('POST', '/v1/bots', {
    name: 'Specialist Bot',
    executionMode: 'code',
    parentBotId: ctx.store.listBots()[0].id,
    specialistTag: 'backend-test',
  });
  assert.equal(createdBot.status, 201);
  assert.equal(createdBot.data.executionMode, 'code');
  assert.equal(createdBot.data.parentBotId, ctx.store.listBots()[0].id);
  assert.equal(createdBot.data.specialistTag, 'backend-test');

  const patchedBot = await api('PATCH', `/v1/bots/${createdBot.data.id}`, {
    executionMode: 'chat',
    specialistTag: 'chat-only',
  });
  assert.equal(patchedBot.status, 200);
  assert.equal(patchedBot.data.executionMode, 'chat');
  assert.equal(patchedBot.data.specialistTag, 'chat-only');

  const createdThr = await api('POST', '/v1/threads', { botId: createdBot.data.id, executionMode: 'agent' });
  assert.equal(createdThr.status, 201);
  assert.equal(createdThr.data.executionMode, 'agent');
  const patchedThr = await api('PATCH', `/v1/threads/${createdThr.data.id}`, { executionMode: 'code' });
  assert.equal(patchedThr.status, 200);
  assert.equal(patchedThr.data.executionMode, 'code');

  // RAG graph + query with localOnly + redaction
  const ragGraph = await api('GET', '/v1/rag/graph');
  assert.equal(ragGraph.status, 200);
  assert.ok(ragGraph.data.docCount >= 1);
  assert.ok(ragGraph.data.nodes >= 1);

  const ragQuery = await api('POST', '/v1/rag/query', { query: 'nonexistent-topic-xyz', useWebFallback: true });
  assert.equal(ragQuery.status, 200);
  assert.equal(webCalled, false);
  assert.equal(ragQuery.data.localOnlyBlockedWeb, true);

  const ragLocalHit = await api('POST', '/v1/rag/query', { query: 'LightRAG architecture' });
  assert.equal(ragLocalHit.status, 200);
  assert.ok(!JSON.stringify(ragLocalHit.data).includes(secretVal));
  assert.match(ragLocalHit.data.contextBlock, /\[REDACTED:vault:API_SECRET\]/);

  // Council seats, run, history with localOnly + redaction
  const seatsRes = await api('GET', '/v1/council/seats');
  assert.equal(seatsRes.status, 200);
  assert.equal(seatsRes.data.seats.length, 2);

  const runRes = await api('POST', '/v1/council/run', {
    topic: 'Evaluate workspace isolation',
    threadId: createdThr.data.id,
    useRag: true,
  });
  assert.equal(runRes.status, 200);
  assert.equal(webCalled, false);
  assert.ok(!JSON.stringify(runRes.data).includes(secretVal));
  assert.match(runRes.data.synthesis, /\[REDACTED:vault:API_SECRET\]/);

  const histRes = await api('GET', '/v1/council/history');
  assert.equal(histRes.status, 200);
  assert.equal(histRes.data.runs.length, 1);
  assert.ok(!JSON.stringify(histRes.data).includes(secretVal));

  // Voice duplex success + localOnly enforcement + secret redaction + TTS error fallback
  const duplexOk = await api('POST', '/v1/voice/duplex', {
    botId: createdBot.data.id,
    text: 'Check status aloud',
    engine: 'edge-tts',
    voice: 'en-GB-RyanNeural',
  });
  assert.equal(duplexOk.status, 200);
  assert.ok(duplexOk.data.threadId);
  assert.ok(!duplexOk.data.reply.includes(secretVal));
  assert.match(duplexOk.data.reply, /\[REDACTED:vault:API_SECRET\]/);
  assert.equal(duplexOk.data.audioBase64, Buffer.from('RIFFmockwav').toString('base64'));
  assert.equal(duplexOk.data.engine, 'sapi'); // localOnly clamps edge-tts -> sapi
  assert.equal(voiceCalls[0].localOnly, true);

  shouldFailTts = true;
  const duplexFallback = await api('POST', '/v1/voice/duplex', {
    botId: createdBot.data.id,
    threadId: duplexOk.data.threadId,
    text: 'Speak again',
  });
  assert.equal(duplexFallback.status, 200);
  assert.equal(duplexFallback.data.ok, true);
  assert.equal(duplexFallback.data.audioBase64, '');
  assert.equal(duplexFallback.data.fallbackUsed, true);
  assert.equal(duplexFallback.data.engine, 'none');
  assert.ok(!String(duplexFallback.data.ttsError || '').includes(secretVal));
  assert.match(String(duplexFallback.data.ttsError || ''), /\[REDACTED:vault:API_SECRET\]/);

  // Validation error on empty duplex text without attachments
  const duplexEmpty = await api('POST', '/v1/voice/duplex', { text: '   ' });
  assert.equal(duplexEmpty.status, 400);

  // Attachment-only duplex turn (drag-drop inside Live Voice) succeeds cleanly
  const duplexAttached = await api('POST', '/v1/voice/duplex', {
    botId: createdBot.data.id,
    threadId: duplexOk.data.threadId,
    text: '',
    attachments: [{ name: 'voice-drop.txt', path: 'uploads/voice-drop.txt', size: 18 }],
  });
  assert.equal(duplexAttached.status, 200);
  assert.equal(duplexAttached.data.ok, true);

  // localOnly blocks outbound /v1/rsi/knowledge/search
  const kbSearchBlocked = await api('POST', '/v1/rsi/knowledge/search', { query: 'Norse rag' });
  assert.equal(kbSearchBlocked.status, 403);
  assert.equal(kbSearchBlocked.data.error, 'Blocked by local-only policy');

  // Malformed request URL returns 400 cleanly instead of unhandled throw
  const coordPort = Number(new URL(ctx.url).port);
  const rawBadUrlResp = await new Promise((resolve, reject) => {
    const sock = net.connect(coordPort, '127.0.0.1', () => {
      sock.write('GET //127.0.0.1:99999/bad HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n');
    });
    let out = '';
    sock.setEncoding('utf8');
    sock.on('data', chunk => { out += chunk; });
    sock.on('end', () => resolve(out));
    sock.on('error', reject);
  });
  assert.match(rawBadUrlResp, /^HTTP\/1\.1 400 /);

  // close() cleanly awaits voiceEngine.close()
  await ctx.close();
  closedInTest = true;
  assert.equal(voiceClosed, true);
});


test('Chief of Staff preset, /workspace persistence subdirs, Teach-a-Task .md skill compiler, and Reversibility Matrix APIs', async t => {
  const dir = makeTmpDir('mimir-chief-team-');
  t.after(() => cleanupDir(dir));

  const mockLlm = await startMockOpenAiServer(async body => {
    const lastUser = [...(body.messages || [])].reverse().find(m => m.role === 'user')?.content || '';
    if (String(lastUser).includes('prospect')) {
      return { content: 'Looping in @Mara for fresh intelligence and @Cole to draft outreach.' };
    }
    return { content: 'Acknowledged cleanly.' };
  });
  t.after(() => mockLlm.close());

  const store = new AppStore(dir);
  store.updateSettings({
    provider: 'openai-compat',
    openaiBaseUrl: mockLlm.baseUrl,
    openaiApiKey: 'test-token',
    openaiModel: 'mock-model',
    localOnly: false,
  });

  const coord = await startCoordinator({ dataDir: dir, port: 0, host: '127.0.0.1' });
  t.after(() => coord.close());

  const api = async (method, p, body) => {
    const res = await fetch(`${coord.url}${p}`, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${coord.token}` },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, data: await res.json() };
  };

  // Reversibility classification unit assertions
  const irrevShell = classifyToolApproval('shell_exec', { command: 'echo hi' }, 'ask-writes');
  assert.equal(irrevShell.reversibility, 'irreversible');
  const revRead = classifyToolApproval('fs_read', { path: 'notes.txt' }, 'ask-writes');
  assert.equal(revRead.reversibility, 'reversible');

  // Deploy 6-bot Chief of Staff team preset & verify persistent /workspace subdirs
  const deployRes = await api('POST', '/v1/team/deploy-preset', { activateThread: true });
  assert.equal(deployRes.status, 201);
  assert.equal(deployRes.data.ok, true);
  assert.equal(deployRes.data.chief.id, 'bot-chief-klaus');
  assert.equal(deployRes.data.specialists.length, 5);
  assert.ok(deployRes.data.teamThreadId);

  const klausWs = coord.store.getBotWorkspace('bot-chief-klaus');
  for (const sub of ['bin', 'config', 'skills', 'state', 'uploads']) {
    assert.ok(fs.existsSync(path.join(klausWs, sub)), `Expected persistent /workspace/${sub}`);
  }

  // Team overview API exposes topology edges, activeWork, reversibilityMatrix, and volatile contrast
  const overviewRes = await api('GET', '/v1/team/overview?botId=bot-chief-klaus');
  assert.equal(overviewRes.status, 200);
  assert.equal(overviewRes.data.deployed, true);
  assert.equal(overviewRes.data.chief.id, 'bot-chief-klaus');
  assert.ok(overviewRes.data.edges.length >= 5);
  assert.ok(overviewRes.data.reversibilityMatrix.gatedIrreversible.length >= 4);
  assert.ok(overviewRes.data.workspaceLayout.volatilePaths.some(v => v.path === '/tmp'));

  // Teach-a-Task recording -> compile Markdown skill file inside /workspace/skills/
  const recRes = await api('POST', '/v1/recordings', {
    name: 'Weekly Competitor Metrics Extractor',
    botId: 'bot-chief-klaus',
    steps: [
      { toolName: 'browser_open', args: { url: 'https://example.com/reports' } },
      { toolName: 'fs_write', args: { path: 'state/metrics.csv', content: 'metric,val\na,1' } },
    ],
  });
  assert.equal(recRes.status, 201);
  const compileRes = await api('POST', `/v1/recordings/${encodeURIComponent(recRes.data.id)}/compile-skill`, {});
  assert.equal(compileRes.status, 201);
  assert.equal(compileRes.data.logicalPath, '/workspace/skills/weekly-competitor-metrics-extractor.md');
  assert.match(compileRes.data.content, /## Workflow/);
  assert.match(compileRes.data.content, /## Guardrails & Edge Cases/);

  const wsSkillsRes = await api('GET', '/v1/workspace/bot-chief-klaus/skills');
  assert.equal(wsSkillsRes.status, 200);
  assert.ok(wsSkillsRes.data.skills.some(s => s.fileName === 'weekly-competitor-metrics-extractor.md'));

  // Agent turn citing @Mara and @Cole attaches delegation connector targets to message
  const runRes = await api('POST', '/v1/agent/run', {
    botId: 'bot-chief-klaus',
    threadId: deployRes.data.teamThreadId,
    userText: 'Check latest prospect movement via @Mara',
  });
  assert.equal(runRes.status, 200);
  const threadRes = await api('GET', `/v1/threads/${encodeURIComponent(deployRes.data.teamThreadId)}`);
  assert.equal(threadRes.status, 200);
  const lastAssistant = [...threadRes.data.messages].reverse().find(m => m.role === 'assistant');
  assert.ok(lastAssistant?.delegation?.targets?.some(tgt => tgt.name === 'Mara'));
});
