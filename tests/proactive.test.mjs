import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ProactiveEngine, isInQuietHours } from '../daemon/proactive.mjs';
import { RoutineManager } from '../daemon/routines.mjs';
import { AppStore } from '../daemon/store.mjs';
import { startCoordinator } from '../daemon/coordinator.mjs';

const MIN = 60_000;
const at = (h, m = 0, day = 10) => new Date(2026, 10, day, h, m, 0, 0).getTime(); // local time, Nov 2026

function makeHarness(t, { fail = () => false, rustBridge = null } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-proactive-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  const calls = [];
  const boot = () => {
    const store = new AppStore(dir);
    const routines = new RoutineManager({
      store,
      runPromptFn: async ({ userText }) => {
        calls.push(userText);
        if (fail(calls.length)) throw new Error('model offline');
        return { reply: `done: ${userText}`, threadId: `t-${calls.length}` };
      },
    });
    const engine = new ProactiveEngine({ store, routines, rustBridge });
    t.after(() => engine.stop());
    engine.updateConfig({ digestAt: '' });
    return { store, routines, engine };
  };
  return { calls, boot, ...boot() };
}

test('interval routine: runs when due, coalesces a long sleep into one run, never double-fires', async t => {
  const { routines, engine, calls } = makeHarness(t);
  routines.saveRoutine({ name: 'Pulse', prompt: 'pulse', intervalMinutes: 60 });

  const first = await engine.tick(at(9));
  assert.equal(first.started.length, 1);
  assert.equal(first.started[0].status, 'ok');

  // Same slot again (poll loop, duplicate timer, etc.) must not re-run.
  assert.equal((await engine.tick(Date.now() + MIN)).started.length, 0);
  assert.equal(calls.length, 1);

  // Host asleep for 9 hours: exactly one catch-up run, not nine.
  const woke = await engine.tick(Date.now() + 9 * 60 * MIN);
  assert.equal(woke.started.length, 1);
  assert.equal(calls.length, 2);
});

test('daily routine: fires once per local day, catches up after the slot, skips day of creation if slot passed', async t => {
  const { routines, engine, store, calls } = makeHarness(t);
  const r = routines.saveRoutine({ name: 'Morning brief', prompt: 'brief', dailyAt: '08:00' });
  const saved = store.state.routines.find(x => x.id === r.id);

  saved.createdAt = new Date(at(12, 0, 9)).toISOString(); // created the day before, after 08:00
  assert.equal((await engine.tick(at(13, 0, 9))).started.length, 0, 'no catch-up on creation day');
  assert.equal((await engine.tick(at(7, 59))).started.length, 0, 'not before the slot');
  assert.equal((await engine.tick(at(10, 30))).started.length, 1, 'late wake still runs the missed slot');
  assert.equal((await engine.tick(at(18))).started.length, 0, 'once per day');
  assert.equal((await engine.tick(at(8, 1, 11))).started.length, 1, 'next day fires again');
  assert.equal(calls.length, 2);

  assert.throws(() => routines.saveRoutine({ name: 'bad', prompt: 'x', dailyAt: '25:99' }), /HH:MM/);
});

test('failure path: backoff retry, then dead-letter + feed alert after maxAttempts', async t => {
  const { routines, engine, store, calls } = makeHarness(t, { fail: () => true });
  routines.saveRoutine({ name: 'Flaky', prompt: 'flaky', dailyAt: '08:00', maxAttempts: 2 });
  store.state.routines[0].createdAt = new Date(at(0, 0, 9)).toISOString();

  const a1 = await engine.tick(at(9));
  assert.equal(a1.started[0].status, 'failed');
  assert.equal(a1.started[0].attempt, 1);

  assert.equal((await engine.tick(at(9) + MIN / 2)).started.length, 0, 'backoff not elapsed yet');
  const a2 = await engine.tick(at(9, 2));
  assert.equal(a2.started[0].attempt, 2);
  assert.equal(a2.started[0].status, 'dead');
  assert.equal(a2.started[0].slotKey, a1.started[0].slotKey, 'retry stays on the same slot');

  assert.equal((await engine.tick(at(9, 12))).started.length, 0, 'dead slot is not retried');
  assert.equal(calls.length, 2);
  assert.ok(store.state.routineDlq.some(d => d.channel === 'run'));
  assert.ok(engine.getOverview().feed.some(f => f.kind === 'alert' && /gave up/.test(f.title)));
});

test('crash recovery: a run left "running" by a dead process is retried once after restart', async t => {
  const h = makeHarness(t);
  h.routines.saveRoutine({ name: 'Durable', prompt: 'durable', intervalMinutes: 30 });

  // Simulate the process dying mid-run: journal entry written, result never recorded.
  let release;
  h.routines.runPromptFn = () => new Promise(resolve => (release = resolve));
  const hung = h.engine.tick(at(9));
  await new Promise(r => setTimeout(r, 20));
  const journal = JSON.parse(fs.readFileSync(h.store.storePath, 'utf8'));
  assert.equal(journal.proactive.runs[0].status, 'running', 'run journaled before execution');

  const b = h.boot(); // "restart": fresh engine + store from the same disk state
  const res = await b.engine.tick(at(9, 1));
  assert.equal(res.started.length, 1);
  assert.equal(res.started[0].attempt, 2);
  assert.equal(res.started[0].status, 'ok');
  const statuses = b.engine.getOverview().runs.map(r => r.status);
  assert.deepEqual(statuses, ['ok', 'interrupted']);
  assert.equal((await b.engine.tick(at(9, 2))).started.length, 0, 'no duplicate after recovery');

  release({ reply: 'late' });
  await hung;
});

test('controls: pause, quiet hours, daily budget, config validation, digest', async t => {
  const { routines, engine, calls } = makeHarness(t);
  routines.saveRoutine({ name: 'A', prompt: 'a', intervalMinutes: 10 });
  routines.saveRoutine({ name: 'B', prompt: 'b', intervalMinutes: 10 });

  engine.updateConfig({ paused: true });
  assert.equal((await engine.tick(at(9))).skipped, 'paused');

  engine.updateConfig({ paused: false, quietHours: { start: '22:00', end: '07:00' } });
  assert.equal(isInQuietHours(at(23), { start: '22:00', end: '07:00' }), true);
  assert.equal(isInQuietHours(at(6, 59), { start: '22:00', end: '07:00' }), true);
  assert.equal(isInQuietHours(at(7), { start: '22:00', end: '07:00' }), false);
  assert.equal((await engine.tick(at(23))).skipped, 'quiet hours');
  assert.equal(calls.length, 0);

  engine.updateConfig({ quietHours: null, maxRunsPerDay: 1 });
  const res = await engine.tick(at(9));
  assert.equal(res.started.length, 1, 'budget of 1 lets one of two due routines run');
  assert.ok(engine.getOverview().feed.some(f => /budget/i.test(f.title)));

  assert.throws(() => engine.updateConfig({ maxRunsPerDay: -1 }), /maxRunsPerDay/);
  assert.throws(() => engine.updateConfig({ quietHours: { start: '9', end: '10:00' } }), /HH:MM/);

  engine.updateConfig({ digestAt: '08:00' });
  await engine.tick(at(9, 0, 11));
  await engine.tick(at(9, 30, 11));
  const digests = engine.getOverview().feed.filter(f => f.kind === 'digest');
  assert.equal(digests.length, 1, 'one digest per day');
  assert.match(digests[0].body, /Last 24h/);
});

test('daily slot inside quiet hours that cross midnight runs once when quiet hours end', async t => {
  const { routines, engine, store, calls } = makeHarness(t);
  routines.saveRoutine({ name: 'Late', prompt: 'late', dailyAt: '23:30' });
  store.state.routines[0].createdAt = new Date(at(12, 0, 9)).toISOString();
  engine.updateConfig({ quietHours: { start: '23:00', end: '07:00' } });

  assert.equal((await engine.tick(at(23, 31, 9))).skipped, 'quiet hours');
  assert.equal((await engine.tick(at(6, 0, 10))).skipped, 'quiet hours');
  const morning = await engine.tick(at(7, 0, 10));
  assert.equal(morning.started.length, 1, "yesterday's deferred slot runs in the morning");
  assert.equal((await engine.tick(at(12, 0, 10))).started.length, 0, 'and only once');
  assert.equal(calls.length, 1);
});

test('retryInterrupted=false: an interrupted run is dead-lettered, never re-executed', async t => {
  const h = makeHarness(t);
  h.routines.saveRoutine({ name: 'Sends mail', prompt: 'send', intervalMinutes: 30, retryInterrupted: false });
  let release;
  h.routines.runPromptFn = () => new Promise(resolve => (release = resolve));
  const hung = h.engine.tick(at(9));
  await new Promise(r => setTimeout(r, 20));

  const b = h.boot();
  assert.equal((await b.engine.tick(at(9, 1))).started.length, 0);
  assert.equal(b.engine.getOverview().runs[0].status, 'dead');
  assert.ok(b.store.state.routineDlq.some(d => d.channel === 'run'));
  assert.equal(h.calls.length, 0, 'prompt was not re-run');

  release({ reply: 'late' });
  await hung;
});

test('file trigger: a change runs the routine once after the debounce, then respects the cooldown', async t => {
  const { routines, engine, calls } = makeHarness(t);
  const watched = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-watch-'));
  t.after(() => fs.rmSync(watched, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
  routines.saveRoutine({ name: 'Inbox folder', prompt: 'triage', watchPath: watched });

  assert.equal((await engine.tick()).started.length, 0, 'no change yet');
  fs.writeFileSync(path.join(watched, 'new.txt'), 'hello');
  await new Promise(r => setTimeout(r, 300));
  assert.equal((await engine.tick(Date.now())).started.length, 0, 'still inside debounce window');

  const fired = await engine.tick(Date.now() + 3000);
  assert.equal(fired.started.length, 1);
  assert.match(fired.started[0].slotKey, /:f:\d+$/);

  fs.writeFileSync(path.join(watched, 'again.txt'), 'x');
  await new Promise(r => setTimeout(r, 300));
  assert.equal((await engine.tick(Date.now() + 3000)).started.length, 0, 'cooldown holds a rapid second change');
  assert.equal((await engine.tick(Date.now() + 2 * MIN)).started.length, 1, 'held change runs after the cooldown');
  assert.equal(calls.length, 2);

  routines.saveRoutine({ name: 'Missing', prompt: 'x', watchPath: path.join(watched, 'nope', 'deeper') });
  await engine.tick();
  await engine.tick();
  assert.equal(engine.getOverview().feed.filter(f => /File trigger/.test(f.title)).length, 1, 'bad path alerts once');
});

test('Rust ledger claim: a slot already claimed elsewhere is skipped; own claims are settled', async t => {
  const seen = new Map();
  const settled = [];
  let dedupeAll = false;
  const rustBridge = {
    isRunning: () => true,
    enqueueTask: async spec => {
      if (dedupeAll || seen.has(spec.idempotency_key)) return { deduplicated: true, task: seen.get(spec.idempotency_key) || { id: 'other' } };
      const task = { id: `task-${seen.size + 1}`, queue: spec.queue };
      seen.set(spec.idempotency_key, task);
      return { deduplicated: false, task };
    },
    claimTask: async (_w, { queue }) => ({ task: [...seen.values()].filter(x => x.queue === queue).pop() }),
    completeTask: async id => settled.push(['complete', id]),
    failTask: async id => settled.push(['fail', id]),
  };
  const { routines, engine, calls } = makeHarness(t, { rustBridge });
  routines.saveRoutine({ name: 'Shared', prompt: 'shared', intervalMinutes: 60 });

  const own = await engine.tick(at(9));
  assert.equal(own.started.length, 1);
  assert.deepEqual(settled, [['complete', 'task-1']]);
  assert.match([...seen.keys()][0], /^routine:.+:i:\d+#1$/);

  dedupeAll = true; // another coordinator process got to the next slot first
  const other = await engine.tick(Date.now() + 2 * 60 * MIN);
  assert.equal(other.started.length, 0);
  assert.equal(engine.getOverview().runs[0].status, 'skipped');
  assert.equal((await engine.tick(Date.now() + 2 * 60 * MIN + MIN)).started.length, 0, 'skipped slot is not re-planned');
  assert.equal(calls.length, 1);
});

test('HTTP: /v1/proactive overview + config, kill switch pauses scheduling, state survives restart', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-proactive-http-'));
  let coord = await startCoordinator({ dataDir: dir, enableScheduler: false, enableRust: false });
  t.after(async () => {
    await coord.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const call = async (p, body) => {
    const r = await fetch(coord.url + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    return { status: r.status, data: await r.json() };
  };

  const saved = await call('/v1/routines', { name: 'Nightly', prompt: 'check', dailyAt: '03:00' });
  assert.equal(saved.data.dailyAt, '03:00');
  assert.equal((await call('/v1/routines', { name: 'Bad', prompt: 'x', dailyAt: 'soon' })).status, 400);

  const overview = await call('/v1/proactive');
  assert.equal(overview.status, 200);
  assert.equal(overview.data.status.host, 'desktop');
  assert.ok(overview.data.status.upcoming.some(u => u.name === 'Nightly'));

  assert.equal((await call('/v1/proactive/config', { maxRunsPerDay: 'lots' })).status, 400);
  assert.equal((await call('/v1/proactive/config', { maxRunsPerDay: 12 })).data.maxRunsPerDay, 12);

  const pre = await call('/v1/preflight');
  assert.equal(pre.status, 200);
  assert.deepEqual(pre.data.checks.map(c => c.id), ['ollama', 'python', 'browser', 'rust-core']);
  const rustCheck = pre.data.checks.find(c => c.id === 'rust-core');
  assert.equal(rustCheck.ok, false, 'rust disabled in this test must be reported, not hidden');
  for (const c of pre.data.checks) assert.ok(c.ok || c.detail.length > 10, `${c.id} explains itself when not ready`);

  await call('/v1/kill-switch', {});
  assert.equal((await call('/v1/proactive')).data.status.paused, true);

  await coord.close();
  coord = await startCoordinator({ dataDir: dir, enableScheduler: false, enableRust: false });
  const after = await call('/v1/proactive');
  assert.equal(after.data.status.paused, true, 'pause survives restart');
  assert.equal(after.data.status.maxRunsPerDay, 12);
});
