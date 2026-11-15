import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startCoordinator } from '../daemon/coordinator.mjs';

test('chat slash commands run deterministically without a model call', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-cmd-'));
  const coord = await startCoordinator({ dataDir: dir, enableScheduler: false, enableRust: false });
  t.after(async () => {
    await coord.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const botId = coord.store.listBots()[0].id;
  const say = userText => coord.runner.runTurn({ botId, userText, title: 'cmd test' });

  const lib = await say('/library');
  assert.equal(lib.agiCommand, '/library');
  assert.equal(lib.ok, true);
  assert.match(lib.reply, /Library is empty/);

  const badForge = await say('/forge');
  assert.equal(badForge.ok, false);
  assert.match(badForge.reply, /Usage/);

  const map = await say('/map');
  assert.equal(map.ok, true);
  assert.match(map.reply, /9 realms/);

  // Voice depends on Python/SAPI being present; either way it must answer, not throw.
  const voice = await say('/voice hello');
  assert.equal(voice.agiCommand, '/voice');
  assert.ok(voice.ok ? /hello/.test(voice.reply) : /failed/.test(voice.reply));

  assert.equal(coord.proactive.getConfig().paused, false);
  const kill = await say('/kill');
  assert.equal(kill.ok, true);
  assert.match(kill.reply, /Kill switch pulled/);
  assert.equal(coord.proactive.getConfig().paused, true, '/kill pauses the scheduler like the HTTP route');

  const thread = coord.store.getThread(kill.threadId);
  const last = thread.messages.at(-1);
  assert.equal(last.role, 'assistant');
  assert.equal(last.provider, 'mimir-command');
});
