import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startCoordinator } from '../daemon/coordinator.mjs';
import { parseTrigger, splitSteps, assignBot, groupWaves, weekdaysIn, evalCondition, emailDraft } from '../daemon/workflows.mjs';
import { normalizeWeekdays } from '../daemon/routines.mjs';
import { findUnbackedClaims } from '../daemon/receipt.mjs';
import { resolveTargetConcurrency } from '../daemon/agent-runner.mjs';

test('plain words become a trigger and steps', () => {
  assert.deepEqual(parseTrigger('Every day at 8am, check competitor prices').trigger, { type: 'daily', dailyAt: '08:00' });
  assert.deepEqual(parseTrigger('every day at 6:30 pm send me a recap').trigger, { type: 'daily', dailyAt: '18:30' });
  assert.deepEqual(parseTrigger('Every morning, summarize the news').trigger, { type: 'daily', dailyAt: '08:00' });
  assert.deepEqual(parseTrigger('every 30 minutes check the queue').trigger, { type: 'interval', intervalMinutes: 30 });
  assert.deepEqual(parseTrigger('every 2 hours scan the feed').trigger, { type: 'interval', intervalMinutes: 120 });
  assert.deepEqual(parseTrigger('Whenever a new file lands in D:\\inbox\\invoices, sort it').trigger, { type: 'file', watchPath: 'D:\\inbox\\invoices' });
  assert.equal(parseTrigger('every week write the report').trigger.intervalMinutes, 10080);
  assert.deepEqual(parseTrigger('every monday write the report').trigger, { type: 'daily', dailyAt: '09:00', weekdays: [1] });
  assert.match(parseTrigger('every week write the report').note, /Name a day/);
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
  assert.equal(draft.name, 'Research competitor pricing', 'the name is the first clause, not the first six words');
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


test('weekday words become day numbers; only schedule words count, not any mention of a day', () => {
  assert.deepEqual(parseTrigger('Every weekday at 9am, check the inbox').trigger, { type: 'daily', dailyAt: '09:00', weekdays: [1, 2, 3, 4, 5] });
  assert.deepEqual(parseTrigger('every Monday and Thursday at 6:30pm send the recap').trigger, { type: 'daily', dailyAt: '18:30', weekdays: [1, 4] });
  assert.deepEqual(parseTrigger('Every Tuesday, Wednesday and Friday at 7 am post an update').trigger, { type: 'daily', dailyAt: '07:00', weekdays: [2, 3, 5] });
  assert.deepEqual(parseTrigger('on weekends at 10 post the roundup').trigger, { type: 'daily', dailyAt: '10:00', weekdays: [0, 6] });
  assert.deepEqual(parseTrigger('Monday to Friday at 8am summarize the news').trigger, { type: 'daily', dailyAt: '08:00', weekdays: [1, 2, 3, 4, 5] });
  assert.equal(weekdaysIn("write about Monday's meeting and Friday's launch"), null, 'a day name alone is not a schedule');
  assert.deepEqual(parseTrigger("Summarize Monday's meeting notes").trigger, { type: 'manual' });
  assert.deepEqual(parseTrigger('every day at 8am check the prices').trigger, { type: 'daily', dailyAt: '08:00' }, 'plain daily is unchanged');
  assert.deepEqual(normalizeWeekdays([1, 1, 9, '3', 'x', -1]), [1, 3]);
  assert.deepEqual(normalizeWeekdays([0, 1, 2, 3, 4, 5, 6]), [], 'all seven days means every day');
  assert.deepEqual(normalizeWeekdays(undefined), []);
});

test('conditions decide whether a step runs; emails are drafts, never sent', () => {
  assert.equal(evalCondition({ when: 'previous_mentions', text: 'Price Cut' }, 'The rival announced a price cut today'), true);
  assert.equal(evalCondition({ when: 'previous_mentions', text: 'price cut' }, 'Nothing changed'), false);
  assert.equal(evalCondition({ when: 'previous_lacks', text: 'nothing new' }, 'Nothing new this week'), false);
  assert.equal(evalCondition({ when: 'previous_lacks', text: 'nothing new' }, 'Three changes found'), true);
  assert.equal(evalCondition({ when: 'previous_nonempty' }, '   '), false);
  assert.equal(evalCondition({ when: 'previous_nonempty' }, 'something'), true);
  assert.equal(evalCondition({ when: 'previous_mentions', text: '' }, 'anything'), false, 'a phrase condition with no phrase never runs the step');
  const d = emailDraft('boss@example.com', 'Weekly: result', 'Line one & two\nLine three');
  assert.equal(d.mailto, 'mailto:boss%40example.com?subject=Weekly%3A%20result&body=Line%20one%20%26%20two%0ALine%20three');
  assert.equal(emailDraft('a@b.co', 's', 'x'.repeat(5000)).body.length, 1500);
});

async function startHarness(t, extra = {}) {
  const model = await startModel(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-wfc-'));
  const coord = await startCoordinator({ dataDir: dir, enableScheduler: false, enableRust: false });
  t.after(async () => {
    await coord.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  coord.store.updateSettings({ provider: 'openai-compat', openaiBaseUrl: model.baseUrl, openaiModel: 'scripted', enableFallback: false, ...extra });
  const api = async (method, p, body) => {
    const r = await fetch(coord.url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  };
  await api('POST', '/v1/team/deploy-preset', {});
  const bots = coord.store.listBots();
  const mara = bots.find(b => b.name === 'Mara').id;
  const cole = bots.find(b => b.name === 'Cole').id;
  return { model, coord, api, mara, cole };
}

test('a step with a condition is skipped or stops the workflow; saving validates conditions', async t => {
  const { api, mara, cole } = await startHarness(t);
  const base = { name: 'Cond', trigger: { type: 'manual' } };
  const steps = cond => [
    { title: 'Find', instruction: 'research competitor pricing', botId: mara },
    { title: 'Brief', instruction: 'write a short brief', botId: cole, condition: cond },
    { title: 'Idea', instruction: 'draft one reply idea', botId: cole },
  ];
  // validation
  assert.equal((await api('POST', '/v1/workflows', { ...base, steps: steps({ when: 'previous_mentions', text: '' }) })).status, 400);
  const saved = (await api('POST', '/v1/workflows', { ...base, steps: [{ ...steps(null)[0], condition: { when: 'previous_nonempty' } }, ...steps(null).slice(1)] })).data;
  assert.equal(saved.steps[0].condition, undefined, 'the first step has nothing before it to look at');

  // condition met: runs
  const met = (await api('POST', '/v1/workflows', { ...base, name: 'Met', steps: steps({ when: 'previous_mentions', text: 'rival cut price' }) })).data;
  const r1 = (await api('POST', `/v1/workflows/${met.id}/run`, { wait: true })).data;
  assert.deepEqual(r1.run.steps.map(s => s.status), ['done', 'done', 'done']);

  // condition not met, otherwise "skip": the step is skipped and the workflow carries on
  const skip = (await api('POST', '/v1/workflows', { ...base, name: 'Skip', steps: steps({ when: 'previous_mentions', text: 'no such phrase', otherwise: 'skip' }) })).data;
  const r2 = (await api('POST', `/v1/workflows/${skip.id}/run`, { wait: true })).data;
  assert.equal(r2.ok, true);
  assert.deepEqual(r2.run.steps.map(s => s.status), ['done', 'skipped', 'done']);
  assert.match(r2.run.steps[1].note, /do not mention "no such phrase"/);
  assert.equal(r2.run.events.some(e => e.kind === 'step-skipped'), true);
  assert.equal(r2.run.deliverable, r2.run.steps[2].file);

  // condition not met, otherwise "stop": everything after is skipped, the run still counts as done
  const stop = (await api('POST', '/v1/workflows', { ...base, name: 'Stop', steps: steps({ when: 'previous_lacks', text: 'FINDINGS', otherwise: 'stop' }) })).data;
  const r3 = (await api('POST', `/v1/workflows/${stop.id}/run`, { wait: true })).data;
  assert.equal(r3.ok, true);
  assert.deepEqual(r3.run.steps.map(s => s.status), ['done', 'skipped', 'skipped']);
  assert.match(r3.run.stopped, /Stopped at "Brief"/);
  assert.ok(r3.run.events.some(e => e.kind === 'stopped'));
  assert.equal(r3.run.deliverable, r3.run.steps[0].file, 'the last finished step is the deliverable');
});

test('a finished workflow posts to Slack/Teams webhooks and prepares an email draft', async t => {
  const hooks = [];
  const hookSrv = http.createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    hooks.push({ url: req.url, body: JSON.parse(body) });
    res.writeHead(200);
    res.end('ok');
  });
  await new Promise(r => hookSrv.listen(0, '127.0.0.1', r));
  t.after(() => new Promise(r => { hookSrv.closeAllConnections?.(); hookSrv.close(r); }));
  const base = `http://127.0.0.1:${hookSrv.address().port}`;
  const { api, mara, cole, coord } = await startHarness(t, { slackWebhookUrl: `${base}/slack`, localOnly: true });

  assert.equal((await api('POST', '/v1/workflows', { name: 'Bad', steps: [{ instruction: 'do it now', botId: mara }], notify: { email: 'not an email' } })).status, 400);
  const wf = (await api('POST', '/v1/workflows', {
    name: 'Tell people',
    steps: [{ title: 'Find', instruction: 'research competitor pricing', botId: mara }, { title: 'Brief', instruction: 'write a short brief', botId: cole }],
    notify: { slack: true, teams: true, email: 'boss@example.com' },
  })).data;
  assert.deepEqual(wf.notify, { slack: true, teams: true, email: 'boss@example.com' });
  const out = (await api('POST', `/v1/workflows/${wf.id}/run`, { wait: true })).data;
  assert.equal(out.ok, true);
  assert.equal(hooks.length, 1, 'Slack got exactly one message');
  assert.equal(hooks[0].url, '/slack');
  assert.match(hooks[0].body.text, /Tell people/);
  assert.match(hooks[0].body.text, /BRIEF built on/, 'the message carries the result, not just a status line');
  const kinds = out.run.events.map(e => e.kind);
  assert.ok(kinds.includes('notified') && kinds.includes('notify-skipped'), `Teams has no webhook set: said so (${kinds})`);
  assert.equal(out.run.emailDraft.to, 'boss@example.com');
  assert.match(out.run.emailDraft.mailto, /^mailto:boss%40example\.com\?subject=/);
  // scheduling it must not make the routine post a second copy
  const routine = coord.routines.listRoutines().find(r => r.workflowId === wf.id);
  assert.equal(routine, undefined, 'manual workflow has no schedule');
  const scheduled = (await api('POST', '/v1/workflows', { ...wf, id: wf.id, trigger: { type: 'daily', dailyAt: '08:00', weekdays: [1, 3] } })).data;
  const r = coord.routines.listRoutines().find(x => x.workflowId === scheduled.id);
  assert.deepEqual([r.notifySlack, r.notifyTeams, r.weekdays], [false, false, [1, 3]]);
  assert.deepEqual(scheduled.trigger, { type: 'daily', dailyAt: '08:00', weekdays: [1, 3] });
});

test('teammates answer one at a time on a shared local model, unless the user raises it', () => {
  const same = [{ name: 'Mara' }, { name: 'Cole' }, { name: 'Ivy' }];
  const ollama = { provider: 'ollama', ollamaModel: 'qwen3:1.7b' };
  assert.equal(resolveTargetConcurrency(same, ollama), 1, 'automatic: one runner, no thrashing');
  assert.equal(resolveTargetConcurrency(same, { ...ollama, delegationConcurrency: 3 }), 3, 'the user can allow three at once');
  assert.equal(resolveTargetConcurrency(same, { ...ollama, delegationConcurrency: 9 }), 3, 'never more than there are teammates');
  assert.equal(resolveTargetConcurrency([...same, { name: 'D' }, { name: 'E' }], { ...ollama, delegationConcurrency: 9 }), 4, 'hard cap of four');
  assert.equal(resolveTargetConcurrency(same, { provider: 'openai-compat' }), 2, 'a cloud model already runs two at a time');
  assert.equal(resolveTargetConcurrency([{ name: 'Mara' }], { ...ollama, delegationConcurrency: 4 }), 1);
  assert.equal(resolveTargetConcurrency(same, { ...ollama, delegationConcurrency: 'x' }), 1, 'junk falls back to automatic');
});
