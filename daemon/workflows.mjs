import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Workflows: a job described once, run end to end.
 *
 * A workflow is a trigger plus ordered steps. Each step goes to one bot; that bot's result is
 * handed to the next step. The engine, not the model, does the bookkeeping: it saves every
 * step's output to disk, checkpoints after each step, resumes from the step that failed, and
 * hands scheduling to the proactive engine (catch-up, retries, quiet hours, daily budget).
 *
 * Irreversible actions inside a step still stop at the normal approval gate.
 */

const MAX_STEPS = 8;
const HANDOFF_CHARS = 1500; // per earlier step, so the chain fits a small model's window
const MAX_RUNS_KEPT = 60;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const slug = s => String(s || 'step').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'step';
const bad = msg => Object.assign(new Error(msg), { status: 400 });

/** Which kind of bot suits a step, judged from its wording. First match wins. */
const ROLE_HINTS = [
  { role: 'research', words: /\b(research|find|search|scan|look up|monitor|collect|gather|check|browse|scrape|competitor|news|prices?)\b/i, bots: /research|scout|analyst/i },
  { role: 'design', words: /\b(design|image|graphic|banner|logo|svg|visual|thumbnail|mock-?up)\b/i, bots: /design|artificer/i },
  { role: 'finance', words: /\b(audit|budget|costs?|invoice|expenses?|finance|numbers|reconcile)\b/i, bots: /cfo|audit|financ/i },
  { role: 'ops', words: /\b(track|update the board|notify|alert|log|file away|organi[sz]e|status)\b/i, bots: /ops|track/i },
  { role: 'writing', words: /\b(write|draft|summari[sz]e|rewrite|copy|email|post|newsletter|report|brief|reply|caption|script)\b/i, bots: /copy|writer/i },
];

/** research | design | finance | ops | writing | general, from the step's wording. */
export function roleOf(text) {
  const opening = String(text).trim().split(/\s+/).slice(0, 4).join(' ');
  for (const scope of [opening, text]) {
    const hit = ROLE_HINTS.find(h => h.words.test(scope));
    if (hit) return hit.role;
  }
  return 'general';
}

/**
 * Tools a step may use. Small models given every tool tend to wander through searches instead
 * of producing the result, so a step only gets the tools its kind of work needs.
 */
const RESEARCH_TOOLS = ['browser_search', 'browser_open', 'knowledge_search', 'fs_read', 'fs_list'];
export const toolsForRole = role => (role === 'research' ? RESEARCH_TOOLS : role === 'ops' || role === 'finance' ? ['fs_read', 'fs_list'] : []);

export function assignBot(text, bots, fallbackId) {
  // The opening words say what the step does ("Write a brief about competitor prices" is
  // writing, not research), so they are checked before the rest of the sentence.
  const opening = String(text).trim().split(/\s+/).slice(0, 4).join(' ');
  for (const scope of [opening, text]) {
    for (const hint of ROLE_HINTS) {
      if (!hint.words.test(scope)) continue;
      const match = bots.find(b => hint.bots.test(`${b.name} ${b.role} ${b.specialistTag || ''}`));
      if (match) return match.id;
    }
  }
  return fallbackId;
}

/** Read a schedule or trigger out of plain words. Returns { trigger, note? }. */
export function parseTrigger(text) {
  const t = String(text || '');
  const file = t.match(/\bwhen(?:ever)?\b[^.]*?\b(?:file|files|folder|document|download)s?\b[^.]*?\b(?:in|to|into|inside)\s+((?:[A-Za-z]:\\|\/)[^\s,;'"]+)/i);
  if (file) return { trigger: { type: 'file', watchPath: file[1].replace(/[.]+$/, '') } };
  const at = t.match(/\b(?:every ?day|daily|each day|every (?:morning|evening|night))\b[^.]*?\bat\s+(\d{1,2})(?::(\d\d))?\s*(am|pm)?/i) || t.match(/\bat\s+(\d{1,2})(?::(\d\d))?\s*(am|pm)\b[^.]*?\b(?:every ?day|daily|each day)/i);
  if (at) {
    let h = Number(at[1]);
    const ampm = (at[3] || '').toLowerCase();
    if (ampm === 'pm' && h < 12) h += 12;
    if (ampm === 'am' && h === 12) h = 0;
    if (h <= 23) return { trigger: { type: 'daily', dailyAt: `${String(h).padStart(2, '0')}:${at[2] || '00'}` } };
  }
  if (/\bevery morning\b/i.test(t)) return { trigger: { type: 'daily', dailyAt: '08:00' } };
  if (/\bevery (?:evening|night)\b/i.test(t)) return { trigger: { type: 'daily', dailyAt: '18:00' } };
  if (/\b(?:every ?day|daily|each day)\b/i.test(t)) return { trigger: { type: 'daily', dailyAt: '09:00' } };
  const every = t.match(/\bevery\s+(\d+)\s*(minute|min|hour|hr)s?\b/i);
  if (every) return { trigger: { type: 'interval', intervalMinutes: Math.max(5, Number(every[1]) * (/^h/i.test(every[2]) ? 60 : 1)) } };
  if (/\b(?:every hour|hourly)\b/i.test(t)) return { trigger: { type: 'interval', intervalMinutes: 60 } };
  if (/\b(?:every week|weekly|every (?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i.test(t)) {
    return { trigger: { type: 'interval', intervalMinutes: 7 * 24 * 60 }, note: 'Runs every 7 days from the first run. Picking a specific weekday is not supported yet.' };
  }
  return { trigger: { type: 'manual' } };
}

/** Split a description into steps without a model: numbered lists, "then", semicolons, lines. */
export function splitSteps(description) {
  const body = String(description || '').replace(/\s+/g, ' ').trim();
  const parts = body
    .split(/\s*(?:\b(?:and then|then|after that|afterwards|finally|next)\b[,:]?|;|\s\d+[.)]\s|\.\s+(?=[A-Z]))\s*/i)
    .map(s => s.replace(/^[,.\s]+|[,.\s]+$/g, ''))
    .filter(s => s.length > 8 && !/^(?:every|each|daily|when(?:ever)?)\b[^,]*$/i.test(s));
  return (parts.length ? parts : [body]).slice(0, MAX_STEPS);
}

const titleOf = text => {
  const clean = String(text).replace(/^(?:please|first|then|and)\s+/i, '').trim();
  const short = clean.split(/\s+/).slice(0, 6).join(' ');
  return short.charAt(0).toUpperCase() + short.slice(1);
};

export const WORKFLOW_TEMPLATES = [
  {
    id: 'competitor-watch',
    name: 'Competitor watch',
    description: 'Every day at 8am, research what changed on competitor sites and pricing, then write a short brief of what matters, then draft one response idea for me to review.',
  },
  {
    id: 'morning-brief',
    name: 'Morning brief',
    description: 'Every morning, search for the top news in my industry, then summarize the five items that matter most in plain words.',
  },
  {
    id: 'content-pipeline',
    name: 'Content pipeline',
    description: 'Research one trending topic in my field, then draft a post about it in my voice, then design a matching banner image idea, then write three caption options.',
  },
  {
    id: 'weekly-report',
    name: 'Weekly report',
    description: 'Every week, collect what the team finished from the workspace notes, then write a one-page report, then check the numbers in it and list anything that looks wrong.',
  },
];

export class WorkflowEngine {
  constructor({ store, dataDir, runTurn, routines, broadcast }) {
    this.store = store;
    this.dir = path.join(dataDir, 'workflows');
    this.runTurn = runTurn;
    this.routines = routines;
    this.broadcast = broadcast;
    this.active = new Set();
    this.recoverInterrupted();
  }

  recoverInterrupted() {
    let changed = false;
    for (const r of this.#state.workflowRuns) {
      if (r.status === 'running' && !this.active.has(r.workflowId)) {
        r.status = 'failed';
        r.error = r.error || 'Interrupted by daemon restart';
        r.finishedAt = r.finishedAt || new Date().toISOString();
        for (const s of r.steps || []) {
          if (s.status === 'running') {
            s.status = 'failed';
            s.error = s.error || 'Interrupted by daemon restart';
          }
        }
        changed = true;
      }
    }
    if (changed) this.store.save();
  }

  get #state() {
    const s = this.store.state;
    if (!s.workflows) s.workflows = [];
    if (!s.workflowRuns) s.workflowRuns = [];
    return s;
  }

  list() {
    return this.#state.workflows;
  }

  get(id) {
    return this.list().find(w => w.id === id) || null;
  }

  listRuns(workflowId = null) {
    return this.#state.workflowRuns.filter(r => !workflowId || r.workflowId === workflowId);
  }

  /**
   * Turn a plain description into a workflow draft the user can review before saving.
   * Uses the model to split steps when it returns valid JSON; otherwise splits by wording.
   */
  async draft(description, { planWithModel = null } = {}) {
    const text = String(description || '').trim();
    if (text.length < 12) throw bad('Describe the job in a sentence or two.');
    const all = this.store.listBots();
    const fallbackId = all.find(b => all.some(x => x.parentBotId === b.id))?.id || all[0].id;
    // The chief's own specialists are considered before any other bot with a similar role.
    const bots = [...all.filter(b => b.parentBotId === fallbackId), ...all.filter(b => b.parentBotId !== fallbackId)];
    const { trigger, note } = parseTrigger(text);

    // If the user already spelled out the steps ("…, then …, then …"), those are the steps.
    // The model is only asked to plan when the job came as one undivided sentence.
    const worded = splitSteps(text);
    let rawSteps = worded.length >= 2 ? worded.map(s => ({ title: titleOf(s), instruction: s })) : null;
    let plannedBy = 'wording';
    if (!rawSteps && planWithModel) {
      try {
        const planned = await planWithModel(text);
        if (Array.isArray(planned) && planned.length && planned.length <= MAX_STEPS && planned.every(s => typeof s?.instruction === 'string' && s.instruction.trim().length > 5)) {
          rawSteps = planned.map(s => ({ title: String(s.title || titleOf(s.instruction)).slice(0, 60), instruction: s.instruction.trim() }));
          plannedBy = 'model';
        }
      } catch {
        // A model that cannot produce the plan is not an error: fall back to the wording.
      }
    }
    if (!rawSteps) rawSteps = worded.map(s => ({ title: titleOf(s), instruction: s }));
    // The schedule is already captured in the trigger; keep it out of the first step's text.
    const stripped = rawSteps[0].instruction.replace(/^(?:every|each|daily|when(?:ever)?)\b[^,]*,\s*/i, '');
    if (stripped && stripped !== rawSteps[0].instruction) rawSteps[0] = { title: titleOf(stripped), instruction: stripped };

    return {
      name: titleOf(text.replace(/^(?:every|each|when(?:ever)?)\b[^,]*,\s*/i, '')),
      description: text,
      trigger,
      triggerNote: note || null,
      plannedBy,
      steps: rawSteps.map(s => ({ ...s, botId: assignBot(`${s.title} ${s.instruction}`, bots, fallbackId) })),
    };
  }

  save(input) {
    const name = String(input.name || '').trim();
    if (!name) throw bad('Give the workflow a name.');
    const steps = (Array.isArray(input.steps) ? input.steps : [])
      .map(s => ({ title: String(s.title || '').trim().slice(0, 60), instruction: String(s.instruction || '').trim(), botId: s.botId }))
      .filter(s => s.instruction);
    if (!steps.length || steps.length > MAX_STEPS) throw bad(`A workflow needs 1 to ${MAX_STEPS} steps.`);
    for (const s of steps) {
      if (!this.store.getBot(s.botId)) throw bad(`Step "${s.title || s.instruction.slice(0, 30)}" has no valid bot.`);
      if (!s.title) s.title = titleOf(s.instruction);
    }
    const t = input.trigger || { type: 'manual' };
    const trigger = { type: ['manual', 'daily', 'interval', 'file'].includes(t.type) ? t.type : 'manual' };
    if (trigger.type === 'daily') {
      if (!HHMM.test(String(t.dailyAt || ''))) throw bad('Daily time must be HH:MM.');
      trigger.dailyAt = t.dailyAt;
    }
    if (trigger.type === 'interval') trigger.intervalMinutes = Math.max(5, Number(t.intervalMinutes) || 60);
    if (trigger.type === 'file') {
      if (!String(t.watchPath || '').trim()) throw bad('Choose the folder to watch.');
      trigger.watchPath = String(t.watchPath).trim();
    }

    const existing = input.id ? this.get(input.id) : null;
    const now = new Date().toISOString();
    const wf = {
      id: existing?.id || `wf-${crypto.randomBytes(5).toString('hex')}`,
      name: name.slice(0, 80),
      description: String(input.description || existing?.description || '').slice(0, 1000),
      trigger,
      steps,
      enabled: input.enabled !== false,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    const list = this.#state.workflows;
    const idx = list.findIndex(w => w.id === wf.id);
    if (idx >= 0) list[idx] = wf;
    else list.unshift(wf);
    this.#syncSchedule(wf);
    this.store.save();
    return wf;
  }

  /** The schedule lives in the routine system so workflows get its catch-up and retry rules. */
  #syncSchedule(wf) {
    const routineId = `rtn-${wf.id}`;
    if (wf.trigger.type === 'manual') {
      this.routines.deleteRoutine(routineId);
      return;
    }
    this.routines.saveRoutine({
      id: routineId,
      name: `Workflow: ${wf.name}`,
      botId: wf.steps[0].botId,
      prompt: `Run workflow "${wf.name}"`,
      workflowId: wf.id,
      enabled: wf.enabled,
      intervalMinutes: wf.trigger.type === 'interval' ? wf.trigger.intervalMinutes : 0,
      dailyAt: wf.trigger.type === 'daily' ? wf.trigger.dailyAt : '',
      watchPath: wf.trigger.type === 'file' ? wf.trigger.watchPath : '',
      maxAttempts: 2,
    });
  }

  delete(id) {
    const before = this.list().length;
    this.#state.workflows = this.list().filter(w => w.id !== id);
    this.routines.deleteRoutine(`rtn-${id}`);
    this.store.save();
    return this.list().length !== before;
  }

  /**
   * Run a workflow. With `resumeRunId`, continue a failed run from the step that failed,
   * reusing the outputs of the steps that already finished.
   */
  async run(id, { resumeRunId = null } = {}) {
    const wf = this.get(id);
    if (!wf) throw Object.assign(new Error(`Workflow not found: ${id}`), { status: 404 });
    if (this.active.has(id)) throw Object.assign(new Error(`"${wf.name}" is already running`), { status: 409 });
    this.active.add(id);

    const runs = this.#state.workflowRuns;
    let run = resumeRunId ? runs.find(r => r.id === resumeRunId && r.workflowId === id && r.status === 'failed') : null;
    if (!run) {
      run = {
        id: `wfr-${crypto.randomBytes(5).toString('hex')}`,
        workflowId: id,
        workflowName: wf.name,
        startedAt: new Date().toISOString(),
        finishedAt: null,
        status: 'running',
        steps: wf.steps.map(s => ({ title: s.title, botId: s.botId, botName: this.store.getBot(s.botId)?.name || s.botId, status: 'waiting', output: '', file: null, error: null })),
        deliverable: null,
      };
      runs.unshift(run);
      if (runs.length > MAX_RUNS_KEPT) runs.length = MAX_RUNS_KEPT;
    } else {
      run.status = 'running';
      run.finishedAt = null;
    }
    const outDir = path.join(this.dir, id, run.id);
    fs.mkdirSync(outDir, { recursive: true });
    const checkpoint = () => {
      this.store.save();
      this.broadcast?.('workflow:run', run);
    };
    checkpoint();

    try {
      for (let i = 0; i < wf.steps.length; i++) {
        const step = wf.steps[i];
        const rec = run.steps[i];
        if (!rec || rec.status === 'done') continue; // missing or finished in an earlier attempt
        rec.status = 'running';
        rec.error = null;
        checkpoint();

        const earlier = run.steps
          .slice(0, i)
          .map((r, n) => `Step ${n + 1} (${r.title}) by ${r.botName}:\n${String(r.output).slice(0, HANDOFF_CHARS)}`)
          .join('\n\n');
        const userText =
          `You are doing step ${i + 1} of ${wf.steps.length} in the workflow "${wf.name}".\n` +
          `Your step: ${step.instruction}\n` +
          (earlier ? `\nResults handed to you from earlier steps (use them; do not redo them):\n${earlier}\n` : '') +
          '\nReply with the finished result of your step only.';

        const title = `Workflow: ${wf.name} · ${step.title}`;
        const attempt = async (text, toolNames) => {
          try {
            return await this.runTurn({ botId: step.botId, userText: text, title, toolNames, maxSteps: 4 });
          } catch (err) {
            return { reply: '', error: err?.message || String(err) };
          }
        };
        let out = await attempt(userText, toolsForRole(roleOf(`${step.title} ${step.instruction}`)));
        if (!out?.error && !out?.aborted && !String(out?.reply || '').trim()) {
          // The bot used up its turn on tools without writing anything. Ask once more, with no
          // tools, for the result itself.
          rec.note = 'Finished without tools after the first try produced no result';
          out = await attempt(`${userText}\n\nWrite the result now from what you already know and what was handed to you. Do not use tools.`, []);
        }
        const reply = String(out?.reply || '').trim();
        if (out?.error || out?.aborted || !reply || reply.startsWith('Error:')) {
          rec.status = 'failed';
          rec.error = (out?.error || (out?.aborted ? 'Stopped' : reply) || 'The bot returned nothing').slice(0, 300);
          throw new Error(`Step ${i + 1} (${step.title}) failed: ${rec.error}`);
        }
        // The engine writes the result to disk itself, so a step's output exists whether or
        // not the model remembered to save anything.
        const file = path.join(outDir, `${String(i + 1).padStart(2, '0')}-${slug(step.title)}.md`);
        fs.writeFileSync(file, `# ${step.title}\n\n${reply}\n`, 'utf8');
        rec.output = reply;
        rec.file = file;
        rec.threadId = out.threadId || null;
        rec.status = 'done';
        checkpoint();
      }
      run.status = 'done';
      run.deliverable = run.steps.at(-1).file;
      return { ok: true, reply: `Workflow "${wf.name}" finished ${run.steps.length} step(s). Result: ${run.steps.at(-1).output.slice(0, 400)}`, runId: run.id, run };
    } catch (err) {
      run.status = 'failed';
      run.error = err.message;
      throw Object.assign(err, { runId: run.id });
    } finally {
      run.finishedAt = new Date().toISOString();
      this.active.delete(id);
      checkpoint();
    }
  }
}

/** Ask a model for the step list as JSON. Returns an array or throws. */
export function makeModelPlanner({ runChatFn, getSettings }) {
  return async description => {
    const res = await runChatFn({
      settings: getSettings(),
      messages: [
        {
          role: 'system',
          content:
            'Split the job into 1 to 6 ordered steps for a small team. Reply with ONLY a JSON array, no prose. ' +
            'Each item: {"title": "3-6 words", "instruction": "one clear sentence telling a teammate what to produce"}. ' +
            'Do not include scheduling words (every day, at 8am) in the steps.',
        },
        { role: 'user', content: description },
      ],
      signal: AbortSignal.timeout(60_000),
    });
    const match = String(res.content || '').replace(/```(?:json)?/g, '').match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in the plan');
    return JSON.parse(match[0]);
  };
}
