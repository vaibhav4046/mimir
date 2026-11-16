import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { MODEL_CATALOG, rateFit, recommendModel, pickTiers, memoryNeededGb } from '../daemon/model-library.mjs';
import { startCoordinator } from '../daemon/coordinator.mjs';

const hw = (ramGb, gpu = null) => ({ platform: 'test', arch: 'x64', cores: 8, ramGb, gpu });
const nvidia = vramGb => ({ name: `Test GPU ${vramGb}GB`, vramGb, unified: false });
const byName = n => MODEL_CATALOG.find(m => m.name === n);

test('fit ratings match the measured laptop and scale to other machines', () => {
  // The owner's laptop (RTX 3050 6 GB, 15.7 GB RAM): measured 1.7B and 4B fully on GPU, 9B half on CPU.
  const laptop = hw(15.7, nvidia(6));
  assert.equal(rateFit(byName('qwen3:1.7b'), laptop).rating, 'fast');
  assert.equal(rateFit(byName('qwen3.5:4b'), laptop).rating, 'fast');
  assert.equal(rateFit(byName('qwen3.5:9b'), laptop).rating, 'slow');
  assert.equal(rateFit(byName('qwen3:30b'), laptop).rating, 'too-big');

  // No GPU, 8 GB RAM: only small models are usable; nothing is called fast.
  const basic = hw(8);
  assert.equal(rateFit(byName('qwen3:1.7b'), basic).rating, 'ok');
  assert.equal(rateFit(byName('qwen3:4b'), basic).rating, 'slow');
  assert.equal(rateFit(byName('qwen3:8b'), basic).rating, 'too-big');
  assert.ok(!MODEL_CATALOG.some(m => rateFit(m, basic).rating === 'fast'));

  // 4 GB RAM: honest about not fitting.
  assert.equal(rateFit(byName('qwen3:4b'), hw(4)).rating, 'too-big');

  // 24 GB GPU and Apple Silicon unified memory.
  assert.equal(rateFit(byName('qwen3:30b'), hw(64, nvidia(24))).rating, 'fast');
  assert.equal(rateFit(byName('qwen3:8b'), hw(16, { name: 'Apple Silicon', vramGb: 10.4, unified: true })).rating, 'fast');

  for (const m of MODEL_CATALOG) assert.ok(memoryNeededGb(m) > m.sizeGb, `${m.name} needs more than its download size`);
});

test('recommendation and automatic tiers come from the machine, not a fixed list', () => {
  assert.equal(recommendModel(hw(15.7, nvidia(6))).name, 'qwen3.5:4b');
  assert.equal(recommendModel(hw(8)).name, 'qwen3:1.7b', 'no GPU: largest tool-capable model that still runs well');
  assert.equal(recommendModel(hw(32, nvidia(12))).name, 'qwen3:8b', 'first install stays under 6 GB even on a bigger GPU');
  assert.equal(recommendModel(hw(4)).rating, 'slow', 'weak machine still gets the least-bad option, labelled slow');

  const installed = [
    { name: 'qwen3.5:9b', sizeGb: 6.55 },
    { name: 'qwen3:1.7b', sizeGb: 1.36 },
    { name: 'qwen3.5:4b', sizeGb: 3.32 },
    { name: 'nomic-embed-text:latest', sizeGb: 0.27 },
  ];
  assert.deepEqual(pickTiers(installed, hw(15.7, nvidia(6))), { fast_local: 'qwen3:1.7b', balanced_local: 'qwen3.5:4b', heavy_local: 'qwen3.5:9b' });
  assert.deepEqual(pickTiers([{ name: 'llama3.2:3b', sizeGb: 2.02 }], hw(8)), { fast_local: 'llama3.2:3b', balanced_local: 'llama3.2:3b', heavy_local: 'llama3.2:3b' });
  assert.deepEqual(pickTiers([], hw(8)), {});
});

/** Fake Ollama (tags + pull) and fake OpenRouter (auth + models) on one loopback server. */
async function startFakes(t) {
  const state = { installed: [{ name: 'llama3.2:1b', size: 1.32e9 }], pullFail: false, issued: new Map(), challenges: new Map() };
  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    let body = '';
    for await (const c of req) body += c;
    const json = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (url.pathname === '/api/tags') return json(200, { models: state.installed });
    if (url.pathname === '/api/pull') {
      const { model } = JSON.parse(body);
      res.writeHead(200, { 'Content-Type': 'application/x-ndjson' });
      res.write(JSON.stringify({ status: 'pulling manifest' }) + '\n');
      if (state.pullFail) { res.write(JSON.stringify({ error: 'pull model manifest: file does not exist' }) + '\n'); return res.end(); }
      res.write(JSON.stringify({ status: 'pulling abc', total: 1000, completed: 400 }) + '\n');
      res.write(JSON.stringify({ status: 'pulling abc', total: 1000, completed: 1000 }) + '\n');
      state.installed.push({ name: model, size: 2.5e9 });
      res.write(JSON.stringify({ status: 'success' }) + '\n');
      return res.end();
    }
    if (url.pathname === '/auth') {
      const code = crypto.randomBytes(6).toString('hex');
      state.challenges.set(code, url.searchParams.get('code_challenge'));
      const back = new URL(url.searchParams.get('callback_url'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state'));
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (url.pathname === '/api/v1/auth/keys') {
      const b = JSON.parse(body);
      const expected = state.challenges.get(b.code);
      const got = crypto.createHash('sha256').update(b.code_verifier || '').digest('base64url');
      state.challenges.delete(b.code);
      if (!expected || expected !== got) return json(403, { error: 'Invalid code or code_verifier' });
      return json(200, { key: 'sk-or-v1-test-key-abcdef123456' });
    }
    if (url.pathname === '/api/v1/models') {
      return json(200, { data: [
        { id: 'vendor/paid-big', name: 'Paid Big', context_length: 200000, pricing: { prompt: '0.000003', completion: '0.000015' }, supported_parameters: ['tools'] },
        { id: 'vendor/free-chat:free', name: 'Free Chat', context_length: 32000, pricing: { prompt: '0', completion: '0' }, supported_parameters: [] },
        { id: 'vendor/free-tools:free', name: 'Free Tools', context_length: 64000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
      ] });
    }
    res.writeHead(404); res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }));
  return { url: `http://127.0.0.1:${srv.address().port}`, state };
}

test('library API: overview, one-click install with progress, tiers updated, sign-in connects a free model', async t => {
  const fake = await startFakes(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-lib-'));
  fs.writeFileSync(path.join(dir, 'store.json'), JSON.stringify({ settings: { ollamaUrl: fake.url, ollamaModel: 'not-installed:1b' } }));
  const coord = await startCoordinator({ dataDir: dir, enableScheduler: false, enableRust: false, openRouterBaseUrl: fake.url });
  t.after(async () => {
    await coord.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const api = async (method, p, body) => {
    const r = await fetch(coord.url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  };

  const lib = (await api('GET', '/v1/models/library')).data;
  assert.equal(lib.ollama.running, true);
  assert.ok(lib.hardware.ramGb > 0 && lib.hardware.cores > 0);
  assert.equal(lib.catalog.length, MODEL_CATALOG.length);
  assert.ok(lib.catalog.every(m => ['fast', 'ok', 'slow', 'too-big'].includes(m.rating) && m.reason));
  assert.equal(lib.catalog.find(m => m.name === 'llama3.2:1b').installed, true);
  assert.equal(lib.catalog.filter(m => m.recommended).length, 1);
  assert.ok(lib.ollama.installCommand);

  // Install: returns at once, progress is observable, model ends up installed and routed to.
  assert.equal((await api('POST', '/v1/models/pull', { name: 'bad name; rm -rf' })).status, 400);
  assert.equal((await api('POST', '/v1/models/pull', { name: 'qwen3:4b' })).status, 202);
  let pull = null;
  for (let i = 0; i < 100 && !pull?.done; i++) {
    await new Promise(r => setTimeout(r, 20));
    pull = (await api('GET', '/v1/models/pull?name=qwen3:4b')).data.pull;
  }
  assert.equal(pull.done, true);
  assert.equal(pull.percent, 100);
  assert.equal(pull.error, null);
  const after = (await api('GET', '/v1/models/library')).data;
  assert.equal(after.catalog.find(m => m.name === 'qwen3:4b').installed, true);
  assert.ok(Object.values(after.tiers).includes('qwen3:4b') || Object.values(after.tiers).includes('llama3.2:1b'));
  assert.notEqual(coord.store.getSettings().ollamaModel, 'not-installed:1b', 'a default that is not installed is replaced by one that is');

  // A failed download reports the real error instead of pretending.
  fake.state.pullFail = true;
  await api('POST', '/v1/models/pull', { name: 'nope:1b' });
  let failed = null;
  for (let i = 0; i < 100 && !failed?.done; i++) {
    await new Promise(r => setTimeout(r, 20));
    failed = (await api('GET', '/v1/models/pull?name=nope:1b')).data.pull;
  }
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /does not exist/);

  // Cloud list marks free and paid from the provider's own prices.
  const cloud = (await api('GET', '/v1/models/openrouter/models')).data;
  assert.deepEqual(cloud.models.filter(m => m.free).map(m => m.id), ['vendor/free-chat:free', 'vendor/free-tools:free']);
  assert.equal(cloud.models.find(m => m.id === 'vendor/paid-big').pricePerMTokIn, 3);

  // Sign-in: local-only blocks it; otherwise browser hop -> key in vault -> free tool-capable model selected.
  coord.store.updateSettings({ localOnly: true });
  assert.equal((await api('POST', '/v1/models/openrouter/login', {})).status, 403);
  coord.store.updateSettings({ localOnly: false });
  const login = await api('POST', '/v1/models/openrouter/login', {});
  const authUrl = new URL(login.data.authorizeUrl);
  assert.equal(authUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.match(authUrl.searchParams.get('callback_url'), /^http:\/\/localhost:\d+\/v1\/models\/openrouter\/callback$/);
  const hop = await fetch(authUrl, { redirect: 'manual' });
  const callback = hop.headers.get('location').replace('http://localhost:', 'http://127.0.0.1:');
  const forged = new URL(callback); forged.searchParams.set('state', 'forged');
  assert.equal((await fetch(forged)).status, 400);
  const done = await fetch(callback);
  assert.equal(done.status, 200);
  assert.match(await done.text(), /free model vendor\/free-tools:free/);
  assert.equal((await fetch(callback)).status, 400, 'sign-in link works once');

  const s = coord.store.getSettings();
  assert.equal(s.provider, 'openai-compat');
  assert.equal(s.openaiModel, 'vendor/free-tools:free');
  assert.equal(s.openaiApiKey, 'sk-or-v1-test-key-abcdef123456');
  const pub = (await api('GET', '/v1/settings')).data;
  assert.equal(pub.openaiApiKey, '');
  assert.equal(pub.hasOpenaiApiKey, true);
  assert.ok(!fs.readFileSync(path.join(dir, 'store.json'), 'utf8').includes('sk-or-v1-test-key'), 'key is in the vault, not in settings');
});

test('embedding-only models are never offered or chosen as a chat model', async () => {
  const { isEmbeddingModel, chatModelsOnly } = await import('../daemon/embedding-models.mjs');
  for (const name of ['all-minilm:latest', 'nomic-embed-text:latest', 'mxbai-embed-large', 'bge-m3:latest', 'snowflake-arctic-embed:335m', 'paraphrase-multilingual:latest']) assert.equal(isEmbeddingModel(name), true, name);
  for (const name of ['qwen3.5:4b', 'qwen3:1.7b', 'llama3.2:3b', 'gemma3:4b', 'mistral:7b', 'phi4-mini', 'deepseek-r1:8b']) assert.equal(isEmbeddingModel(name), false, name);
  assert.deepEqual(chatModelsOnly(['all-minilm:latest', 'qwen3.5:4b']), ['qwen3.5:4b']);
  const installed = [{ name: 'all-minilm:latest', sizeGb: 0.05 }, { name: 'qwen3:1.7b', sizeGb: 1.4 }, { name: 'qwen3.5:4b', sizeGb: 3.4 }];
  const tiers = pickTiers(installed, hw(15.7, nvidia(6)));
  for (const name of Object.values(tiers)) assert.notEqual(name, 'all-minilm:latest');
});
