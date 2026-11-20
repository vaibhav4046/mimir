import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startCoordinator } from '../daemon/coordinator.mjs';
import { summarizeArgs } from '../daemon/telegram.mjs';

// ---- a local stand-in for api.telegram.org (the real API is never contacted) ----------------------------

const TOKEN = '123456789:AAHstubTOKENvalue_abcdefghijklmnopqrstu';

async function startStub(t, { holdMs = 250 } = {}) {
  const s = { token: TOKEN, holdMs, calls: [], getUpdatesAt: [], queue: [], nextUpdate: 1, nextMsg: 100, waiters: new Set(), failGetUpdates: 0, cb: 0 };
  const wake = () => { for (const w of [...s.waiters]) w(); };
  const srv = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
    const m = /^\/bot([^/]+)\/(\w+)$/.exec(req.url);
    if (!m || m[1] !== s.token) return send(401, { ok: false, error_code: 401, description: `Unauthorized (${req.url})` });
    const body = raw ? JSON.parse(raw) : {};
    if (m[2] === 'getUpdates') {
      s.getUpdatesAt.push(Date.now());
      if (s.failGetUpdates > 0) { s.failGetUpdates--; return send(500, { ok: false, description: `Internal error at ${req.url}` }); }
      s.queue = s.queue.filter(u => u.update_id >= (body.offset || 0));
      if (!s.queue.length) {
        await new Promise(r => {
          const done = () => { s.waiters.delete(done); clearTimeout(tm); r(); };
          const tm = setTimeout(done, s.holdMs);
          s.waiters.add(done);
          res.on('close', done);
        });
      }
      if (res.destroyed) return;
      return send(200, { ok: true, result: s.queue.filter(u => u.update_id >= (body.offset || 0)) });
    }
    s.calls.push({ method: m[2], body, messageId: s.nextMsg });
    if (m[2] === 'getMe') return send(200, { ok: true, result: { id: 42, is_bot: true, username: 'mimir_test_bot' } });
    if (m[2] === 'sendMessage') return send(200, { ok: true, result: { message_id: s.nextMsg++, chat: { id: body.chat_id } } });
    return send(200, { ok: true, result: true });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }));
  s.url = `http://127.0.0.1:${srv.address().port}`;
  s.sent = method => s.calls.filter(c => c.method === method);
  s.push = u => { s.queue.push({ ...u, update_id: s.nextUpdate++ }); wake(); };
  const push = s.push;
  s.text = (chatId, text, { date = Math.floor(Date.now() / 1000), type = 'private' } = {}) =>
    push({ message: { message_id: 1, date, chat: { id: chatId, type }, from: { id: chatId }, text } });
  s.press = (chatId, data, messageId = 1) =>
    push({ callback_query: { id: `cb${++s.cb}`, from: { id: chatId }, message: { message_id: messageId, chat: { id: chatId, type: 'private' }, date: Math.floor(Date.now() / 1000) }, data } });
  return s;
}

async function until(fn, ms = 4000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for: ${fn}`);
    await new Promise(r => setTimeout(r, 15));
  }
}

/** Waits until every update already pushed has been handled (a later poll means the earlier batch is done). */
async function settle(stub) {
  const n = stub.getUpdatesAt.length;
  await until(() => stub.getUpdatesAt.length >= n + 2);
}

// ---- a scripted model that asks for one tool, then answers ------------------------------------------------

async function startModel(t, toolCall) {
  const srv = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url.endsWith('/models')) return res.end(JSON.stringify({ data: [{ id: 'scripted' }] }));
    const parsed = JSON.parse(body);
    const afterTool = parsed.messages.at(-1)?.role === 'tool';
    const message = afterTool || !toolCall
      ? { role: 'assistant', content: 'All done.' }
      : { role: 'assistant', content: '', tool_calls: [{ id: 'call_0', type: 'function', function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) } }] };
    res.end(JSON.stringify({ choices: [{ message }] }));
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }));
  return `http://127.0.0.1:${srv.address().port}/v1`;
}

const FS_WRITE = { name: 'fs_write', arguments: { path: 'phone.txt', content: 'written after a phone approval' } };

async function startMimir(t, stub, { toolCall = FS_WRITE, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-tg-')), bridge = {}, noCleanup = false } = {}) {
  const coord = await startCoordinator({
    dataDir: dir,
    enableScheduler: false,
    enableRust: false,
    telegramBaseUrl: stub.url,
    telegramBridgeOptions: { minSendIntervalMs: 0, pollTimeoutSec: 1, backoffBaseMs: 40, backoffMaxMs: 1000, reconcileMs: 100, ...bridge },
  });
  if (toolCall !== null) {
    const baseUrl = await startModel(t, toolCall);
    coord.store.updateSettings({ provider: 'openai-compat', openaiBaseUrl: baseUrl, openaiModel: 'scripted', enableFallback: false, approvalPolicy: 'ask-writes' });
  }
  const api = async (method, p, body) => {
    const r = await fetch(coord.url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const raw = await r.text();
    return { status: r.status, raw, data: raw ? JSON.parse(raw) : null };
  };
  if (!noCleanup) {
    t.after(async () => {
      await coord.close().catch(() => {});
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    });
  }
  return { coord, api, dir };
}

/** Connects the bot and pairs a phone (private chat `chatId`). */
async function pair(stub, api, chatId = 555) {
  const connected = await api('POST', '/v1/telegram/connect', { token: TOKEN });
  assert.equal(connected.status, 200, connected.raw);
  stub.text(chatId, `/pair ${connected.data.code}`);
  await until(async () => (await api('GET', '/v1/telegram/status')).data.paired);
  return connected.data;
}

/** Starts an agent run in the background and waits for its approval message to reach the phone. */
async function runUntilApprovalMessage(stub, api, nth = 0) {
  const running = api('POST', '/v1/agent/run', { botId: 'bot-grok-default', userText: 'please do the thing' });
  const msg = await until(() => stub.sent('sendMessage').filter(c => c.body.text?.startsWith('Mimir needs your OK'))[nth]);
  const pending = (await api('GET', '/v1/approvals')).data;
  return { running, msg: msg.body, messageId: msg.messageId, pending };
}
const buttons = body => body.reply_markup.inline_keyboard.flat();
const pendingCount = async api => (await api('GET', '/v1/approvals')).data.length;
const lastEdit = stub => stub.sent('editMessageText').at(-1)?.body;

// ---- tests ----------------------------------------------------------------------------------------------

test('connect validates the bot, returns a pairing code, and /pair stores exactly that chat', async t => {
  const stub = await startStub(t);
  const { api, dir } = await startMimir(t, stub, { toolCall: null });

  assert.deepEqual((await api('GET', '/v1/telegram/status')).data, { connected: false, configured: false, paired: false, botUsername: '', lastError: '', localOnly: false, pairingOpen: false });
  assert.equal((await api('POST', '/v1/telegram/pair-code')).status, 409, 'no code before a bot is connected');

  const connected = await api('POST', '/v1/telegram/connect', { token: TOKEN });
  assert.equal(connected.status, 200, connected.raw);
  assert.match(connected.data.code, /^\d{6}$/);
  assert.equal(connected.data.botUsername, 'mimir_test_bot');
  assert.equal(connected.data.paired, false);
  assert.ok(stub.sent('getMe').length >= 1, 'token was validated with getMe');
  assert.ok(Date.parse(connected.data.expiresAt) - Date.now() <= 5 * 60_000 && Date.parse(connected.data.expiresAt) - Date.now() > 4 * 60_000, 'code lives about five minutes');

  stub.text(555, `/pair ${connected.data.code}`);
  const status = await until(async () => { const s = (await api('GET', '/v1/telegram/status')).data; return s.paired && s; });
  assert.equal(status.connected, true);
  assert.equal(status.pairingOpen, false, 'the code was consumed');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'telegram.json'), 'utf8')), { chatId: 555, botUsername: 'mimir_test_bot' });
  assert.match(stub.sent('sendMessage').at(-1).body.text, /Paired/);

  // Single use: the same code from another chat does nothing, and gets no reply.
  const before = stub.sent('sendMessage').length;
  stub.text(777, `/pair ${connected.data.code}`);
  await settle(stub);
  assert.equal(stub.sent('sendMessage').length, before);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'telegram.json'), 'utf8')).chatId, 555);

  // A new code is available on demand, and the status never shows it.
  const again = await api('POST', '/v1/telegram/pair-code');
  assert.equal(again.status, 200);
  assert.notEqual(again.data.code, connected.data.code);
  assert.ok(!(await api('GET', '/v1/telegram/status')).raw.includes(again.data.code));
});

test('bad tokens are refused before anything is saved', async t => {
  const stub = await startStub(t);
  const { api, coord } = await startMimir(t, stub, { toolCall: null });

  const junk = await api('POST', '/v1/telegram/connect', { token: 'not a token/../x' });
  assert.equal(junk.status, 400);
  assert.equal(stub.calls.length, 0, 'garbage never reaches the network');

  const rejected = await api('POST', '/v1/telegram/connect', { token: '999999999:AAHwrongTOKENvalue_abcdefghijklmnopqrstu' });
  assert.equal(rejected.status, 400);
  assert.match(rejected.data.error, /did not accept/);
  assert.ok(!rejected.raw.includes('AAHwrongTOKEN'), 'the rejected token is not echoed back');
  assert.equal(coord.vault.resolveSecret('TELEGRAM_BOT_TOKEN'), null, 'nothing saved');
  assert.equal((await api('GET', '/v1/telegram/status')).data.configured, false);
});

test('a wrong code does not pair, five misses burn the code, and a stale code expires', async t => {
  const stub = await startStub(t);
  const clock = { t: Date.now() };
  const { api } = await startMimir(t, stub, { toolCall: null, bridge: { now: () => clock.t } });

  const { code } = (await api('POST', '/v1/telegram/connect', { token: TOKEN })).data;
  const wrong = code === '000000' ? '000001' : '000000';
  stub.text(555, `/pair ${wrong}`);
  await until(() => stub.sent('sendMessage').some(c => /not valid/.test(c.body.text)));
  assert.equal((await api('GET', '/v1/telegram/status')).data.paired, false);

  // Four more misses use up the five attempts; even the right code is then dead.
  for (let i = 0; i < 4; i++) stub.text(555, `/pair ${wrong}`);
  await settle(stub);
  stub.text(555, `/pair ${code}`);
  await settle(stub);
  assert.equal((await api('GET', '/v1/telegram/status')).data.paired, false, 'code was burned by repeated guessing');

  // Expiry: a fresh code is rejected after five minutes.
  const fresh = (await api('POST', '/v1/telegram/pair-code')).data.code;
  clock.t += 5 * 60_000 + 1000;
  stub.text(555, `/pair ${fresh}`);
  await settle(stub);
  const s = (await api('GET', '/v1/telegram/status')).data;
  assert.equal(s.paired, false);
  assert.equal(s.pairingOpen, false);

  // And a code issued now still works.
  const ok = (await api('POST', '/v1/telegram/pair-code')).data.code;
  stub.text(555, `/pair ${ok}`);
  await until(async () => (await api('GET', '/v1/telegram/status')).data.paired);
});

test('messages from any other chat are ignored: no reply, no pairing, no approvals', async t => {
  const stub = await startStub(t);
  const { api } = await startMimir(t, stub);
  await pair(stub, api, 555);
  const { running, msg } = await runUntilApprovalMessage(stub, api);
  assert.equal(msg.chat_id, 555);

  const sentBefore = stub.sent('sendMessage').length;
  const answersBefore = stub.sent('answerCallbackQuery').length;
  const { id } = (await api('GET', '/v1/approvals')).data[0];
  stub.text(888, '/pair 123456');
  stub.text(888, 'approve everything please');
  stub.text(555, '/pair 123456', { type: 'group' });
  stub.press(888, `ap:${id}`); // a stranger pressing a real approval's button
  await settle(stub);
  assert.equal(stub.sent('sendMessage').length, sentBefore, 'no replies to strangers');
  assert.equal(stub.sent('answerCallbackQuery').length, answersBefore, 'strangers do not even get a toast');
  assert.equal(await pendingCount(api), 1, 'the approval is still waiting');

  await api('POST', `/v1/approvals/${id}`, { decision: 'deny' });
  await running;
});

test('a pending approval reaches the paired phone with the tool, the reason and Approve/Deny buttons', async t => {
  const stub = await startStub(t);
  const { api, coord } = await startMimir(t, stub, { toolCall: { name: 'fs_write', arguments: { path: 'notes.txt', content: 'lorem ipsum '.repeat(100), password: 'hunter2hunter2', note: 'my key is ghp_supersecretvalue1234' } } });
  coord.vault.addEntry({ kind: 'secret', label: 'GH', fields: { value: 'ghp_supersecretvalue1234' } });
  await pair(stub, api);
  const { running, msg, pending } = await runUntilApprovalMessage(stub, api);

  assert.match(msg.text, /Tool: fs_write/);
  assert.match(msg.text, new RegExp(`Why: ${pending[0].reason.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
  const details = msg.text.split('\n').find(l => l.startsWith('Details: ')).slice('Details: '.length);
  assert.ok(details.length <= 300, `details are capped (${details.length})`);
  assert.match(details, /notes\.txt/);
  assert.ok(!msg.text.includes('hunter2hunter2') && !msg.text.includes('ghp_supersecretvalue1234'), 'secrets never leave the PC');
  assert.deepEqual(buttons(msg).map(b => b.text), ['Approve once', 'Deny']);
  assert.deepEqual(buttons(msg).map(b => b.callback_data), [`ap:${pending[0].id}`, `dn:${pending[0].id}`]);
  assert.ok(buttons(msg).every(b => Buffer.byteLength(b.callback_data) <= 64));

  await api('POST', `/v1/approvals/${pending[0].id}`, { decision: 'deny' });
  await running;
});

test('the Settings card is wired to the routes and keeps the token out of state it renders', () => {
  const card = fs.readFileSync(new URL('../renderer/components/TelegramCard.jsx', import.meta.url), 'utf8');
  for (const id of ['telegram-card', 'telegram-status', 'telegram-token-input', 'telegram-connect', 'telegram-pair-code', 'telegram-new-code', 'telegram-unpair', 'telegram-disconnect']) assert.ok(card.includes(`data-testid="${id}"`), id);
  for (const route of ['/v1/telegram/status', '/v1/telegram/connect', '/v1/telegram/pair-code', '/v1/telegram/unpair', '/v1/telegram/disconnect']) assert.ok(card.includes(route), route);
  assert.match(card, /type="password"/);
  assert.ok(fs.readFileSync(new URL('../renderer/components/SettingsView.jsx', import.meta.url), 'utf8').includes('<TelegramCard />'));
});

test('summarizeArgs hides secrets and caps the length', () => {
  const s = summarizeArgs('browser_action', { url: 'https://x.test', apiKey: 'abc', nested: { Authorization: 'Bearer abcdefghijkl', text: 'hello sk-abcdefghijklmnopqrstuv' }, big: 'word '.repeat(200) }, t => t.replace('hello', 'HI'));
  assert.ok(s.length <= 300);
  assert.ok(!/abcdefghijkl|sk-abc/.test(s));
  assert.match(s, /\[hidden\]/);
  assert.equal(summarizeArgs('vault_use', { label: 'x', field: 'password' }), '(hidden: uses a vault secret)');
  assert.equal(summarizeArgs('x', undefined), '{}');
});

test('Approve once resolves the approval through the normal path and the message shows the decision', async t => {
  const stub = await startStub(t);
  const { api, coord } = await startMimir(t, stub);
  await pair(stub, api);
  const { running, pending, msg, messageId } = await runUntilApprovalMessage(stub, api);

  stub.press(555, `ap:${pending[0].id}`, messageId);
  const run = await running;
  assert.equal(run.status, 200, run.raw);
  assert.equal(run.data.reply, 'All done.');
  const written = path.join(coord.store.getBotWorkspace('bot-grok-default'), 'phone.txt');
  assert.equal(fs.readFileSync(written, 'utf8'), 'written after a phone approval', 'the tool really ran');
  const toolMsg = coord.store.getThread(run.data.threadId).messages.find(m => m.role === 'tool');
  assert.equal(toolMsg.approved, true);

  await until(() => lastEdit(stub));
  const edit = lastEdit(stub);
  assert.equal(edit.chat_id, 555);
  assert.equal(edit.message_id, messageId);
  assert.match(edit.text, /Approved from your phone/);
  assert.deepEqual(edit.reply_markup.inline_keyboard, [], 'buttons removed');
  assert.ok(edit.text.startsWith(msg.text), 'original request kept above the decision');
  const answer = stub.sent('answerCallbackQuery').at(-1).body;
  assert.equal(answer.callback_query_id, 'cb1');
  assert.equal(answer.text, 'Approved');
  assert.equal(await pendingCount(api), 0);
});

test('Deny blocks the tool and reports the denial to the agent', async t => {
  const stub = await startStub(t);
  const { api, coord } = await startMimir(t, stub);
  await pair(stub, api);
  const { running, pending, messageId } = await runUntilApprovalMessage(stub, api);

  stub.press(555, `dn:${pending[0].id}`, messageId);
  const run = await running;
  assert.equal(run.status, 200, run.raw);
  const toolMsg = coord.store.getThread(run.data.threadId).messages.find(m => m.role === 'tool');
  assert.match(toolMsg.content, /DENIED_BY_USER/);
  assert.equal(fs.existsSync(path.join(coord.store.getBotWorkspace('bot-grok-default'), 'phone.txt')), false);
  await until(() => lastEdit(stub));
  assert.match(lastEdit(stub).text, /Denied from your phone/);
  assert.equal(stub.sent('answerCallbackQuery').at(-1).body.text, 'Denied');
});

test('an irreversible approval needs a second tap, and the confirm step cannot be skipped', async t => {
  const stub = await startStub(t);
  const { api, coord } = await startMimir(t, stub, { toolCall: { name: 'shell_exec', arguments: { command: 'echo phone-confirmed' } } });
  await pair(stub, api);
  const first = await runUntilApprovalMessage(stub, api);
  const id = first.pending[0].id;
  const mid = first.messageId;
  assert.equal(first.pending[0].dialogueCard.reversibility, 'irreversible');

  // Skipping straight to the confirm button does nothing.
  stub.press(555, `cf:${id}`, mid);
  await until(() => stub.sent('answerCallbackQuery').length >= 1);
  assert.equal(await pendingCount(api), 1);
  assert.equal(stub.sent('answerCallbackQuery').at(-1).body.show_alert, true);

  // First tap only asks for confirmation.
  stub.press(555, `ap:${id}`, mid);
  await until(() => lastEdit(stub));
  assert.match(lastEdit(stub).text, /cannot be undone/);
  assert.deepEqual(buttons(lastEdit(stub)).map(b => b.callback_data), [`cf:${id}`, `dn:${id}`]);
  assert.equal(await pendingCount(api), 1, 'still waiting after one tap');

  // Second tap approves, and the command runs.
  stub.press(555, `cf:${id}`, mid);
  const run = await first.running;
  assert.equal(run.status, 200, run.raw);
  const toolMsg = coord.store.getThread(run.data.threadId).messages.find(m => m.role === 'tool');
  assert.equal(toolMsg.approved, true);
  assert.match(toolMsg.content, /phone-confirmed/);
  await until(() => /Approved from your phone/.test(lastEdit(stub)?.text || ''));
});

test('an approval resolved in the app updates the phone message, and its buttons then do nothing', async t => {
  const stub = await startStub(t);
  const { api } = await startMimir(t, stub);
  await pair(stub, api);
  const { running, pending, messageId } = await runUntilApprovalMessage(stub, api);

  await api('POST', `/v1/approvals/${pending[0].id}`, { decision: 'approve-once' });
  await running;
  await until(() => /Resolved in the app \(approved\)/.test(lastEdit(stub)?.text || ''));
  assert.deepEqual(lastEdit(stub).reply_markup.inline_keyboard, []);

  const edits = stub.sent('editMessageText').length;
  stub.press(555, `dn:${pending[0].id}`, messageId);
  await until(() => stub.sent('answerCallbackQuery').length >= 1);
  const toast = stub.sent('answerCallbackQuery').at(-1).body;
  assert.equal(toast.show_alert, true);
  assert.match(toast.text, /no longer pending/);
  assert.equal(stub.sent('editMessageText').length, edits, 'nothing else edited');
});

test('a stale or unknown callback id gets an error toast and changes nothing', async t => {
  const stub = await startStub(t);
  const { api } = await startMimir(t, stub);
  await pair(stub, api);
  const { running, pending } = await runUntilApprovalMessage(stub, api);

  stub.press(555, 'ap:apr-0000000000');
  stub.press(555, 'zz:garbage');
  stub.press(555, 'dn:');
  await until(() => stub.sent('answerCallbackQuery').length >= 3);
  for (const c of stub.sent('answerCallbackQuery')) {
    assert.equal(c.body.show_alert, true);
    assert.match(c.body.text, /no longer pending/);
  }
  assert.equal(await pendingCount(api), 1, 'the real approval is untouched');
  await api('POST', `/v1/approvals/${pending[0].id}`, { decision: 'deny' });
  await running;
});

test('the token is in no API response, no state file, no log line, and no error text', async t => {
  const logged = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => { logged.push(a.map(String).join(' ')); };
  t.after(() => Object.assign(console, orig));

  const stub = await startStub(t);
  const { api, coord, dir } = await startMimir(t, stub);
  const bodies = [];
  const get = async p => { const r = await api('GET', p); bodies.push(r.raw); return r; };

  const connect = await api('POST', '/v1/telegram/connect', { token: TOKEN });
  bodies.push(connect.raw);
  stub.text(555, `/pair ${connect.data.code}`);
  await until(async () => (await api('GET', '/v1/telegram/status')).data.paired);
  const { running, pending } = await runUntilApprovalMessage(stub, api);
  bodies.push((await api('POST', '/v1/telegram/pair-code')).raw);

  // Telegram's error text echoes the URL (token included); the bridge must scrub it.
  stub.failGetUpdates = 2;
  stub.text(555, 'wake the poller');
  const failing = await until(async () => { const s = (await api('GET', '/v1/telegram/status')).data; return s.lastError && s; });
  assert.match(failing.lastError, /Internal error at \/bot\*\*\*\/getUpdates/);

  for (const p of ['/v1/telegram/status', '/v1/settings', '/v1/vault', '/v1/approvals', '/v1/preflight']) await get(p);
  assert.ok(!(await get('/v1/vault')).raw.includes('TELEGRAM_BOT_TOKEN'), 'the vault list does not even show the entry');
  bodies.push(JSON.stringify(coord.store.getPublicSettings()), JSON.stringify(coord.telegram.status()), JSON.stringify(coord.telegram));
  for (const b of bodies) assert.ok(!b.includes(TOKEN) && !b.includes('AAHstubTOKEN'), `leak in response: ${b.slice(0, 120)}`);

  await api('POST', `/v1/approvals/${pending[0].id}`, { decision: 'deny' });
  await running;
  await coord.close();
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(dir);
  assert.ok(files.some(f => f.endsWith('store.json')) && files.some(f => f.endsWith('vault.enc.json')) && files.some(f => f.endsWith('telegram.json')));
  for (const f of files) assert.ok(!fs.readFileSync(f).includes('AAHstubTOKEN'), `token found on disk in ${path.relative(dir, f)} (the vault is encrypted, so it must not be there either)`);
  assert.ok(!logged.join('\n').includes('AAHstubTOKEN'), 'token appeared in console output');

  // It is retrievable only through the vault, i.e. it was stored like the other secrets.
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-tg-v-'));
  t.after(() => fs.rmSync(dir2, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const second = await startMimir(t, stub, { toolCall: null, dir: dir2 });
  await second.api('POST', '/v1/telegram/connect', { token: TOKEN });
  assert.equal(second.coord.vault.resolveSecret('TELEGRAM_BOT_TOKEN').fields.value, TOKEN);
  assert.ok(!second.coord.vault.redactText(`here: ${TOKEN}`).includes(TOKEN), 'and the vault redacts it from any text');
});

test('Local-only mode refuses to start the bridge, and turning it on later stops polling', async t => {
  const stub = await startStub(t);
  const { api, coord } = await startMimir(t, stub, { toolCall: null });
  coord.store.updateSettings({ localOnly: true });
  const refused = await api('POST', '/v1/telegram/connect', { token: TOKEN });
  assert.equal(refused.status, 403);
  assert.match(refused.data.error, /Local-only mode is on/);
  assert.equal(stub.calls.length + stub.getUpdatesAt.length, 0, 'not a single request left the machine');
  assert.equal((await api('GET', '/v1/telegram/status')).data.localOnly, true);
  assert.equal((await api('POST', '/v1/telegram/pair-code')).status, 403);

  coord.store.updateSettings({ localOnly: false });
  await pair(stub, api);
  coord.store.updateSettings({ localOnly: true });
  const s = await until(async () => { const x = (await api('GET', '/v1/telegram/status')).data; return !x.connected && x; });
  assert.match(s.lastError, /Local-only/);
  const polls = stub.getUpdatesAt.length;
  await new Promise(r => setTimeout(r, 400));
  assert.equal(stub.getUpdatesAt.length, polls, 'polling really stopped');
});

test('server errors back off exponentially, then the bridge recovers by itself', async t => {
  const stub = await startStub(t);
  const { api } = await startMimir(t, stub, { toolCall: null, bridge: { backoffBaseMs: 60 } });
  stub.failGetUpdates = 4;
  const connected = await api('POST', '/v1/telegram/connect', { token: TOKEN });
  assert.equal(connected.status, 200);

  await until(() => stub.getUpdatesAt.length >= 6);
  const at = stub.getUpdatesAt;
  const gaps = [1, 2, 3, 4].map(i => at[i] - at[i - 1]);
  // waits are 60, 120, 240, 480 ms; timers never fire meaningfully early
  [60, 120, 240, 480].forEach((min, i) => assert.ok(gaps[i] >= min * 0.9, `gap ${i} was ${gaps[i]}ms, expected at least ${min}ms (${gaps})`));
  assert.ok(gaps[3] > gaps[0] * 3, 'waits keep growing');

  const healthy = await until(async () => { const s = (await api('GET', '/v1/telegram/status')).data; return s.connected && s; });
  assert.equal(healthy.lastError, '');
  stub.text(555, `/pair ${connected.data.code}`);
  await until(async () => (await api('GET', '/v1/telegram/status')).data.paired);
});

test('old messages from before startup and non-text updates are ignored', async t => {
  const stub = await startStub(t);
  const { api } = await startMimir(t, stub, { toolCall: null });
  const { code } = (await api('POST', '/v1/telegram/connect', { token: TOKEN })).data;

  const now = Math.floor(Date.now() / 1000);

  stub.text(555, `/pair ${code}`, { date: now - 300 }); // five minutes old: backlog
  stub.push({ message: { message_id: 2, date: now, chat: { id: 555, type: 'private' }, from: { id: 555 }, photo: [{ file_id: 'x' }], caption: `/pair ${code}` } });
  stub.push({ edited_message: { message_id: 3, date: now, chat: { id: 555, type: 'private' }, from: { id: 555 }, text: `/pair ${code}` } });
  await settle(stub);
  assert.equal((await api('GET', '/v1/telegram/status')).data.paired, false, 'backlog, photos and edits cannot pair');
  assert.equal(stub.sent('sendMessage').length, 0, 'and get no reply');

  stub.text(555, `/pair ${code}`, { date: now - 100 }); // inside the two-minute window
  await until(async () => (await api('GET', '/v1/telegram/status')).data.paired);
});

test('closing the daemon stops polling promptly, even mid long-poll', async t => {
  const stub = await startStub(t, { holdMs: 10_000 });
  const { api, coord } = await startMimir(t, stub, { toolCall: null, noCleanup: true });
  t.after(() => fs.rmSync(coord.store.dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  await api('POST', '/v1/telegram/connect', { token: TOKEN });
  await until(() => stub.getUpdatesAt.length >= 1);

  const t0 = Date.now();
  await coord.close();
  assert.ok(Date.now() - t0 < 3000, `close took ${Date.now() - t0}ms with a 10 s long poll in flight`);
  assert.equal(coord.telegram.status().connected, false);
  const polls = stub.getUpdatesAt.length;
  await new Promise(r => setTimeout(r, 400));
  assert.equal(stub.getUpdatesAt.length, polls, 'no polls after close');
});

test('a restarted daemon resumes from the vault token and the saved chat; unpair and disconnect forget them', async t => {
  const stub = await startStub(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-tg-restart-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const first = await startMimir(t, stub, { toolCall: null, dir, noCleanup: true });
  await pair(stub, first.api, 555);
  await first.coord.close();

  const { api, coord } = await startMimir(t, stub, { dir, noCleanup: true });
  t.after(() => coord.close().catch(() => {}));
  const resumed = await until(async () => { const s = (await api('GET', '/v1/telegram/status')).data; return s.connected && s; });
  assert.equal(resumed.paired, true);
  assert.equal(resumed.botUsername, 'mimir_test_bot');

  // Approvals still reach the phone after the restart.
  const { running, pending } = await runUntilApprovalMessage(stub, api);
  await api('POST', `/v1/approvals/${pending[0].id}`, { decision: 'deny' });
  await running;

  // Unpair keeps the bot but stops sending approvals anywhere.
  const unpaired = await api('POST', '/v1/telegram/unpair');
  assert.equal(unpaired.data.paired, false);
  assert.equal(unpaired.data.connected, true);
  const sent = stub.sent('sendMessage').length;
  const quiet = api('POST', '/v1/agent/run', { botId: 'bot-grok-default', userText: 'again' });
  const waiting = await until(async () => { const p = (await api('GET', '/v1/approvals')).data; return p.length && p; });
  await settle(stub);
  assert.equal(stub.sent('sendMessage').length, sent, 'nothing is sent once unpaired');
  await api('POST', `/v1/approvals/${waiting[0].id}`, { decision: 'deny' });
  await quiet;

  const gone = await api('POST', '/v1/telegram/disconnect');
  assert.deepEqual(gone.data, { connected: false, configured: false, paired: false, botUsername: '', lastError: '', localOnly: false, pairingOpen: false });
  assert.equal(coord.vault.resolveSecret('TELEGRAM_BOT_TOKEN'), null);
  assert.equal(fs.existsSync(path.join(dir, 'telegram.json')), false);
});
