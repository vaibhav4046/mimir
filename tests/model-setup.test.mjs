import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { discoverLocalServers, testModelCapabilities } from '../daemon/model-setup.mjs';
import { runChatTurn } from '../daemon/llm-provider.mjs';
import { startCoordinator } from '../daemon/coordinator.mjs';

/** Minimal OpenAI-compatible server. Model "no-tools" ignores tool schemas. */
async function startFakeProvider(t) {
  const seen = [];
  const srv = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    seen.push({ path: req.url, auth: req.headers.authorization || '' });
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ data: [{ id: 'fake-1' }, { id: 'no-tools' }] }));
    }
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      const parsed = JSON.parse(body);
      const prompt = parsed.messages.at(-1).content;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = delta => res.write(`data: ${JSON.stringify({ choices: [{ delta }] })}\n\n`);
      if (parsed.tools && parsed.model !== 'no-tools') {
        send({ tool_calls: [{ index: 0, id: 'c1', function: { name: 'get_current_time', arguments: '{}' } }] });
      } else if (/JSON/.test(prompt)) {
        send({ content: '{"answer": ' });
        send({ content: '4}' });
      } else {
        send({ content: 'rea' });
        send({ content: 'dy' });
      }
      res.write('data: [DONE]\n\n');
      return res.end();
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => srv.close(r)));
  return { baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, seen };
}

test('discovery reports only servers that answer', async t => {
  const fake = await startFakeProvider(t);
  const servers = await discoverLocalServers([
    { id: 'fake', label: 'Fake', kind: 'openai-compat', baseUrl: fake.baseUrl },
    { id: 'dead', label: 'Dead', kind: 'openai-compat', baseUrl: 'http://127.0.0.1:9/v1' },
  ]);
  assert.deepEqual(servers.find(s => s.id === 'fake').models, ['fake-1', 'no-tools']);
  assert.equal(servers.find(s => s.id === 'fake').ok, true);
  assert.equal(servers.find(s => s.id === 'dead').ok, false);
});

test('capability test measures each check live, including a failing tool check', async t => {
  const fake = await startFakeProvider(t);
  const good = await testModelCapabilities({ kind: 'openai-compat', baseUrl: fake.baseUrl, model: 'fake-1' });
  assert.equal(good.ok, true, JSON.stringify(good.checks));
  assert.deepEqual(good.checks.map(c => c.id), ['connect', 'stream', 'tools', 'json']);
  assert.ok(good.latency.totalMs >= 0);
  assert.equal(good.contextLength, null, 'not reported by this server, so not guessed');

  const noTools = await testModelCapabilities({ kind: 'openai-compat', baseUrl: fake.baseUrl, model: 'no-tools' });
  assert.equal(noTools.ok, false);
  assert.equal(noTools.checks.find(c => c.id === 'tools').ok, false);
  assert.equal(noTools.checks.find(c => c.id === 'stream').ok, true);

  const missing = await testModelCapabilities({ kind: 'openai-compat', baseUrl: fake.baseUrl, model: 'not-there' });
  assert.equal(missing.checks.length, 1, 'stops after a failed connect check');
  assert.match(missing.checks[0].detail, /not in the server's model list/);
});

test('local-only blocks non-loopback model calls before any request, including fallback', async t => {
  const fake = await startFakeProvider(t);
  const messages = [{ role: 'user', content: 'private text' }];

  await assert.rejects(
    runChatTurn({ settings: { provider: 'openai-compat', openaiBaseUrl: 'http://203.0.113.9/v1', localOnly: true }, messages }),
    err => err.code === 'LOCAL_ONLY_BLOCKED',
  );

  // Primary local server is down; the cloud fallback must not be used and the real error must surface.
  await assert.rejects(
    runChatTurn({
      settings: { provider: 'ollama', ollamaUrl: 'http://127.0.0.1:9', enableFallback: true, openaiBaseUrl: 'http://203.0.113.9/v1', localOnly: true },
      messages,
    }),
    err => err.code !== 'LOCAL_ONLY_BLOCKED' && /fetch failed|ECONNREFUSED/i.test(String(err.message + (err.cause?.code || ''))),
  );

  // A loopback OpenAI-compatible server (LM Studio, llama.cpp) is allowed in local-only mode.
  const res = await runChatTurn({ settings: { provider: 'openai-compat', openaiBaseUrl: fake.baseUrl, openaiModel: 'fake-1', localOnly: true }, messages });
  assert.equal(res.content, 'ready');
});

test('HTTP setup flow: apply stores the key in the vault, never in settings or responses', async t => {
  const fake = await startFakeProvider(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-models-'));
  // Pre-rename install with a plaintext key in store.json must be migrated, not lost.
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ settings: { openaiApiKey: 'sk-legacy-plaintext-123' } }));
  let coord = await startCoordinator({ dataDir: dir, enableScheduler: false, enableRust: false });
  t.after(async () => {
    await coord.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const call = async (p, body, method = body ? 'POST' : 'GET') => {
    const r = await fetch(coord.url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  };
  const storeText = () => fs.readFileSync(path.join(dir, 'store.json'), 'utf8');

  assert.equal(coord.store.getSettings().openaiApiKey, 'sk-legacy-plaintext-123', 'migrated key still resolves');
  assert.ok(!storeText().includes('sk-legacy-plaintext-123'), 'plaintext key removed from store.json');

  const providers = await call('/v1/models/providers');
  assert.ok(providers.data.providers.some(p => p.id === 'openrouter'));

  const tested = await call('/v1/models/test', { kind: 'openai-compat', baseUrl: fake.baseUrl, model: 'fake-1', apiKey: 'sk-test-abc12345' });
  assert.equal(tested.data.ok, true);
  assert.ok(fake.seen.some(s => s.auth === 'Bearer sk-test-abc12345'));

  const applied = await call('/v1/models/apply', { kind: 'openai-compat', baseUrl: fake.baseUrl, model: 'fake-1', apiKey: 'sk-test-abc12345', localOnly: true });
  assert.equal(applied.status, 200);
  assert.equal(applied.data.openaiApiKey, '');
  assert.equal(applied.data.hasOpenaiApiKey, true);
  assert.equal(applied.data.localOnly, true);
  assert.equal(applied.data.modelSetupDone, true);

  const pub = await call('/v1/settings');
  assert.equal(pub.data.openaiApiKey, '');
  assert.ok(!JSON.stringify(pub.data).includes('sk-test-abc12345'), 'key never sent to the UI');
  assert.ok(!storeText().includes('sk-test-abc12345'), 'key not written to store.json');
  assert.equal(coord.store.getSettings().openaiApiKey, 'sk-test-abc12345', 'server side resolves it from the vault');

  // Saving the settings form (which only ever has an empty key) must not wipe the stored key.
  await call('/v1/settings', { openaiApiKey: '', ollamaThink: false }, 'PATCH');
  assert.equal(coord.store.getSettings().openaiApiKey, 'sk-test-abc12345');

  assert.equal((await call('/v1/models/test', { providerId: 'openai', model: 'gpt-x' })).status, 403, 'cloud test refused in local-only');
  assert.equal((await call('/v1/models/apply', { providerId: 'openai', model: 'gpt-x', localOnly: true })).status, 400);
  assert.equal((await call('/v1/models/test', { kind: 'openai-compat', baseUrl: 'ftp://x', model: 'm' })).status, 400);

  await coord.close();
  coord = await startCoordinator({ dataDir: dir, enableScheduler: false, enableRust: false });
  assert.equal(coord.store.getSettings().openaiApiKey, 'sk-test-abc12345', 'key survives restart');
});
