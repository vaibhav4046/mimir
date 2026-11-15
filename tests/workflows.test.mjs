import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startCoordinator } from '../daemon/coordinator.mjs';
import { parseTrigger, splitSteps, assignBot, groupWaves } from '../daemon/workflows.mjs';
import { findUnbackedClaims } from '../daemon/receipt.mjs';

test('plain words become a trigger and steps', () => {
  assert.deepEqual(parseTrigger('Every day at 8am, check competitor prices').trigger, { type: 'daily', dailyAt: '08:00' });
  assert.deepEqual(parseTrigger('every day at 6:30 pm send me a recap').trigger, { type: 'daily', dailyAt: '18:30' });
  assert.deepEqual(parseTrigger('Every morning, summarize the news').trigger, { type: 'daily', dailyAt: '08:00' });
  assert.deepEqual(parseTrigger('every 30 minutes check the queue').trigger, { type: 'interval', intervalMinutes: 30 });
  assert.deepEqual(parseTrigger('every 2 hours scan the feed').trigger, { type: 'interval', intervalMinutes: 120 });
  assert.deepEqual(parseTrigger('Whenever a new file lands in D:\\inbox\\invoices, sort it').trigger, { type: 'file', watchPath: 'D:\\inbox\\invoices' });
  assert.equal(parseTrigger('every week write the report').trigger.intervalMinutes, 10080);
  assert.match(parseTrigger('every monday write the report').note, /weekday is not supported/);
  assert.deepEqual(parseTrigger('Research a topic and write about it').trigger, { type: 'manual' });

  assert.deepEqual(splitSteps('Every day at 8am, research competitor pricing, then write a short brief; finally draft one reply idea'), [
    'Every day at 8am, research competitor pricing',
    'write a short brief',
    'draft one reply idea',
  ]);
  assert.equal(splitSteps('Summarize my notes').length, 1);

  const bots = [
    { id: 'chief', name: 'Klaus', role: 'Chief of Staff' },
    { id: 'mara', name: 'Mara', role: 'Lead Scout', specialistTag: 'research' },
    { id: 'cole', name: 'Cole', role: 'Copywriter' },
  ];
  assert.equal(assignBot('research competitor pricing', bots, 'chief'), 'mara');
  assert.equal(assignBot('write a short brief', bots, 'chief'), 'cole');
  assert.equal(assignBot('decide what to do', bots, 'chief'), 'chief');
  assert.equal(assignBot('design a banner', bots, 'chief'), 'chief', 'no designer on this team: falls back, never invents a bot');
});

test('claims with no matching action are caught; honest statements are not', () => {
  const none = { actions: [], delegated: [], rememberedFacts: [] };
  assert.deepEqual(findUnbackedClaims('I have saved the report file and sent the email to the team.', none).map(c => c.kind), ['file', 'send']);
  assert.equal(findUnbackedClaims("I've searched the web for prices.", none)[0].missing, 'a search or page visit');
  assert.deepEqual(findUnbackedClaims('Paris is the capital of France.', none), []);
  assert.deepEqual(findUnbackedClaims('I can save the file if you want. I have not sent anything.', none), []);
  assert.deepEqual(findUnbackedClaims('The article says "we sent the files yesterday".', none), []);
  const wrote = { actions: [{ tool: 'fs_write', status: 'done' }], delegated: [], rememberedFacts: [] };
  assert.deepEqual(findUnbackedClaims('I have saved the report file.', wrote), []);
  assert.equal(findUnbackedClaims('I have saved the report file.', { ...wrote, actions: [{ tool: 'fs_write', status: 'failed' }] }).length, 1);
});

/** Scripted model: answers by which step it is asked to do; can be told to fail one step. */
async function startModel(t) {
  const ctl = { failStep: null, calls: [], planReply: null };
  const srv = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url.endsWith('/models')) return json({ data: [{ id: 'scripted' }] });
    const parsed = JSON.parse(body);
    const system = parsed.messages.find(m => m.role === 'system')?.content || '';
    const user = [...parsed.messages].reverse().find(m => m.role === 'user')?.content || '';
    if (system.startsWith('Split the job')) return json({ choices: [{ message: { role: 'assistant', content: ctl.planReply ?? 'not json at all' } }] });
    const step = Number(user.match(/doing step (\d+) of/)?.[1] || 0);
    ctl.calls.push({ step, user, tools: (parsed.tools || []).map(x => x.function.name) });
    if (ctl.failStep === step) { res.writeHead(500); return res.end('model crashed'); }
    const text = step === 1 ? 'FINDINGS: rival cut price to 39.' : step === 2 ? `BRIEF built on -> ${user.includes('rival cut price to 39') ? 'saw findings' : 'MISSING findings'}` : 'IDEA: match the price for a week.';
    json({ choices: [{ message: { role: 'assistant', content: text } }] });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }));
  return { baseUrl: `http://127.0.0.1:${srv.address().port}/v1`, ctl };
}

test('workflow end to end: draft from a sentence, run with hand-offs, fail, resume, schedule', async t => {
  const model = await startModel(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-wf-'));
  const coord = await startCoordinator({ dataDir: dir, enableScheduler: false, enableRust: false });
  t.after(async () => {
    await coord.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  coord.store.updateSettings({ provider: 'openai-compat', openaiBaseUrl: model.baseUrl, openaiModel: 'scripted', enableFallback: false });
  const api = async (method, p, body) => {
    const r = await fetch(coord.url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  };
  await api('POST', '/v1/team/deploy-preset', {});
  const nameOf = id => coord.store.getBot(id).name;

  // Draft: the user spelled out three steps, so those are the steps. Nothing is saved yet.
  const sentence = 'Every day at 8am, research competitor pricing, then write a short brief about competitor moves, then draft one reply idea';
  const draft = (await api('POST', '/v1/workflows/draft', { description: sentence })).data;
  assert.equal(draft.plannedBy, 'wording');
  assert.deepEqual(draft.trigger, { type: 'daily', dailyAt: '08:00' });
  assert.deepEqual(draft.steps.map(s => s.instruction), ['research competitor pricing', 'write a short brief about competitor moves', 'draft one reply idea'], 'schedule words are not part of step 1');
  assert.deepEqual(draft.steps.map(s => nameOf(s.botId)), ['Mara', 'Cole', 'Cole'], 'the opening verb decides: writing about competitors is still writing');
  assert.equal((await api('GET', '/v1/workflows')).data.workflows.length, 0);

  // A job given as one undivided sentence is planned by the model, when its plan is valid JSON.
  const blob = 'Handle the weekly competitor pricing review for my bakery';
  assert.equal((await api('POST', '/v1/workflows/draft', { description: blob })).data.plannedBy, 'wording', 'unusable model plan falls back to the sentence');
  model.ctl.planReply = '```json\n[{"title":"Scan rivals","instruction":"Research competitor pricing pages."},{"title":"Write brief","instruction":"Write a short brief of what changed."}]\n```';
  const planned = (await api('POST', '/v1/workflows/draft', { description: blob })).data;
  assert.equal(planned.plannedBy, 'model');
  assert.deepEqual(planned.steps.map(s => s.title), ['Scan rivals', 'Write brief']);
  assert.deepEqual(planned.steps.map(s => nameOf(s.botId)), ['Mara', 'Cole']);

  assert.equal((await api('POST', '/v1/workflows', { name: 'x', steps: [] })).status, 400);
  assert.equal((await api('POST', '/v1/workflows', { name: 'x', steps: [{ instruction: 'do it', botId: 'nope' }] })).status, 400);

  const wf = (await api('POST', '/v1/workflows', draft)).data;
  // Saving a scheduled workflow registers its schedule with the proactive engine.
  const sched = coord.routines.listRoutines().find(r => r.workflowId === wf.id);
  assert.equal(sched.dailyAt, '08:00');
  assert.ok((await api('GET', '/v1/proactive')).data.status.upcoming.some(u => u.name === `Workflow: ${wf.name}`));

  // Run 1: step 2 fails. Step 1 is kept, the run is marked failed at step 2.
  model.ctl.failStep = 2;
  const r1 = (await api('POST', `/v1/workflows/${wf.id}/run`, { wait: true })).data;
  assert.equal(r1.ok, false);
  assert.match(r1.error, /Step 2 .* failed/);
  let run = (await api('GET', `/v1/workflows/${wf.id}/runs`)).data.runs[0];
  assert.deepEqual(run.steps.map(s => s.status), ['done', 'failed', 'waiting']);
  assert.ok(fs.existsSync(run.steps[0].file), 'step 1 output is on disk even though the run failed');

  // Resume: step 1 is NOT run again; step 2 receives step 1's result; all outputs are files.
  model.ctl.failStep = null;
  const step1CallsBefore = model.ctl.calls.filter(c => c.step === 1).length;
  const r2 = (await api('POST', `/v1/workflows/${wf.id}/run`, { wait: true, resumeRunId: r1.runId })).data;
  assert.equal(r2.ok, true);
  assert.equal(model.ctl.calls.filter(c => c.step === 1).length, step1CallsBefore, 'finished step not repeated');
  run = r2.run;
  assert.equal(run.id, r1.runId);
  assert.deepEqual(run.steps.map(s => s.status), ['done', 'done', 'done']);
  assert.match(run.steps[1].output, /saw findings/, 'step 2 was handed step 1 output');
  for (const s of run.steps) assert.match(fs.readFileSync(s.file, 'utf8'), new RegExp(s.output.slice(0, 12).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(run.deliverable, run.steps[2].file);
  assert.match(fs.readFileSync(run.deliverable, 'utf8'), /match the price for a week/);

  // Each step only gets the tools its kind of work needs: research may search, writing gets none.
  const toolsSeen = step => model.ctl.calls.filter(c => c.step === step).at(-1).tools;
  assert.ok(toolsSeen(1).includes('browser_search') && !toolsSeen(1).includes('shell_exec') && !toolsSeen(1).includes('fs_write'));
  assert.deepEqual(toolsSeen(2), [], 'the writing step is given no tools');

  // The schedule path runs the same workflow and reports its result.
  const viaSchedule = await coord.routines.runRoutineNow(sched.id);
  assert.equal(viaSchedule.ok, true);
  assert.match(viaSchedule.reply, /finished 3 step/);
  assert.equal((await api('GET', `/v1/workflows/${wf.id}/runs`)).data.runs.length, 2);

  // Deleting the workflow removes its schedule too.
  assert.equal((await api('DELETE', `/v1/workflows/${wf.id}`)).data.ok, true);
  assert.ok(!coord.routines.listRoutines().some(r => r.workflowId === wf.id));
});

test('steps marked "at the same time" run side by side, then hand both results on', async t => {
  assert.deepEqual(groupWaves([{}, { parallel: true }, {}, { parallel: true }, { parallel: true }]), [[0, 1], [2, 3, 4]]);
  assert.deepEqual(groupWaves([{ parallel: true }, {}]), [[0], [1]], 'the first step always starts a stage');

  const model = await startModel(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-wfp-'));
  const coord = await startCoordinator({ dataDir: dir, enableScheduler: false, enableRust: false });
  t.after(async () => {
    await coord.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  coord.store.updateSettings({ provider: 'openai-compat', openaiBaseUrl: model.baseUrl, openaiModel: 'scripted', enableFallback: false });
  const api = async (method, p, body) => {
    const r = await fetch(coord.url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  };
  await api('POST', '/v1/team/deploy-preset', {});

  const draft = (await api('POST', '/v1/workflows/draft', { description: 'Research competitor pricing, then at the same time write a short note on our own prices, then draft one reply idea', useModel: false })).data;
  assert.deepEqual(draft.steps.map(s => s.parallel), [false, true, false]);
  assert.equal(draft.steps[1].instruction, 'write a short note on our own prices', 'the marker words are not part of the step');

  const wf = (await api('POST', '/v1/workflows', draft)).data;
  const out = (await api('POST', `/v1/workflows/${wf.id}/run`, { wait: true })).data;
  assert.equal(out.ok, true);
  const run = out.run;
  assert.deepEqual(run.steps.map(s => s.status), ['done', 'done', 'done']);
  // Step 2 ran beside step 1, so it was not handed step 1's result; step 3 got both.
  assert.match(run.steps[1].output, /MISSING findings/);
  const step3 = model.ctl.calls.filter(c => c.step === 3).at(-1).user;
  assert.ok(step3.includes('rival cut price to 39') && step3.includes('BRIEF built on'), 'the next stage receives every result of the stage before');
  assert.ok(new Date(run.steps[1].startedAt) <= new Date(run.steps[0].finishedAt), 'step 2 started before step 1 finished');
  for (const s of run.steps) assert.ok(s.startedAt && s.finishedAt);

  const kinds = run.events.map(e => e.kind);
  assert.equal(kinds[0], 'started');
  assert.equal(kinds.at(-1), 'finished');
  assert.equal(kinds.filter(k => k === 'step-done').length, 3);
  assert.equal(kinds.filter(k => k === 'handoff').length, 1, 'one hand-off: stage 1 to stage 2');
  assert.match(run.events.find(e => e.kind === 'handoff').text, / and .* handed results to /);
});
