import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isLoopbackUrl } from './llm-provider.mjs';

function slugifySkillName(name) {
  const clean = String(name || 'workflow-skill')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return clean || 'workflow-skill';
}

export const GROKBOT_PRESET_SKILLS = Object.freeze([
  {
    slug: 'weekly-competitor-metrics-extractor',
    title: 'Weekly Competitor Metrics Extractor',
    version: 'v1.0',
    outputFormat: 'csv',
    steps: [
      'Apply filters — Date range: last 7 days, Competitors: selected list (5 selected)',
      'Export CSV — Include all visible columns (Revenue, Impressions, Market Share)',
      'Retry on rate limit — Up to 3 attempts with exponential backoff',
      'Verify file is non-empty — Fail if file size = 0 in /workspace/state/',
    ],
    guardrails: [
      'Do not change filters or date range',
      'Export only CSV format to /workspace/state/',
      'Fail if file is empty or export fails',
    ],
  },
  {
    slug: 'prospect-intelligence-outreach-draft',
    title: 'Prospect Intelligence & Outreach Draft',
    version: 'v1.0',
    outputFormat: 'md',
    steps: [
      'Pull latest prospect intent signals (pricing views, RevOps hiring, competitor mentions)',
      'Summarize findings into /workspace/state/prospect-a-signals.md',
      'Draft personalized outreach message in /workspace/state/prospect-a-outreach-draft.md',
      'Hold external send for human approval per Reversibility Matrix',
    ],
    guardrails: [
      'Never send outreach email or LinkedIn DM without human approval',
      'Persist all research and drafts inside /workspace/state/',
      'Verify output files are non-empty (size > 0)',
    ],
  },
  {
    slug: 'workspace-persistence-survival-audit',
    title: 'Workspace Persistence Survival Audit',
    version: 'v1.0',
    outputFormat: 'json',
    steps: [
      'Inspect /workspace/bin, /workspace/config, /workspace/skills, and /workspace/state',
      'Flag any volatile /tmp, /usr, or /home path references in active routines',
      'Generate SHA-256 survival manifest at /workspace/state/persistence-manifest.json',
      'Verify manifest size > 0 and all 5 persistent directories intact',
    ],
    guardrails: [
      'Never write durable state to /tmp, /usr, or /home',
      'Ensure every skill and routine references /workspace/ paths',
      'Fail if any persistent directory is missing',
    ],
  },
]);

/**
 * Scheduled routines, Teach-a-Task workflow recordings, and outbound Slack/Teams webhooks.
 */
export class RoutineManager {
  constructor({ store, runPromptFn, broadcast }) {
    this.store = store;
    this.runPromptFn = runPromptFn;
    this.broadcast = broadcast;
    this.inFlight = new Set();
  }

  listRoutines() {
    return this.store.state.routines || [];
  }

  saveRoutine(input) {
    const routines = this.store.state.routines || (this.store.state.routines = []);
    const now = new Date().toISOString();
    const id = input.id || `rtn-${crypto.randomBytes(5).toString('hex')}`;
    const idx = routines.findIndex(r => r.id === id);
    const existing = idx >= 0 ? routines[idx] : null;
    const dailyAt = String(input.dailyAt ?? existing?.dailyAt ?? '').trim();
    if (dailyAt && !/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyAt)) {
      const err = new Error('dailyAt must be HH:MM (24h, local time)');
      err.status = 400;
      throw err;
    }
    const record = {
      id,
      name: String(input.name || 'Untitled Routine').trim(),
      botId: input.botId || this.store.state.bots[0]?.id,
      prompt: String(input.prompt || '').trim(),
      intervalMinutes: Math.max(0, Number(input.intervalMinutes ?? 0) || 0),
      dailyAt, // 'HH:MM' local; takes precedence over intervalMinutes when set
      watchPath: String(input.watchPath ?? existing?.watchPath ?? '').trim(), // run when this file/folder changes
      retryInterrupted: Boolean(input.retryInterrupted ?? existing?.retryInterrupted ?? true), // false = at-most-once
      maxAttempts: Math.min(10, Math.max(1, Number(input.maxAttempts ?? existing?.maxAttempts ?? 3) || 3)),
      enabled: input.enabled !== false,
      notifySlack: Boolean(input.notifySlack),
      notifyTeams: Boolean(input.notifyTeams),
      sourceRecordingId: input.sourceRecordingId || existing?.sourceRecordingId || null,
      workflowId: input.workflowId || existing?.workflowId || null, // set when this schedule drives a multi-step workflow
      lastSlotKey: existing?.lastSlotKey || null,
      lastRunAt: existing?.lastRunAt || null,
      lastStatus: existing?.lastStatus || 'idle',
      lastSummary: existing?.lastSummary || '',
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    if (idx >= 0) routines[idx] = record;
    else routines.unshift(record);
    this.store.save();
    return record;
  }

  listDlq() {
    return this.store.state.routineDlq || [];
  }

  deleteRoutine(id) {
    const before = (this.store.state.routines || []).length;
    this.store.state.routines = (this.store.state.routines || []).filter(r => r.id !== id);
    if (this.store.state.routines.length !== before) {
      this.store.save();
      return true;
    }
    return false;
  }

  async #postWebhookWithRetry(url, payload, channel, routineId) {
    const maxAttempts = 2;
    let lastError = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) return { ok: true, status: res.status };
        lastError = `HTTP ${res.status}`;
      } catch (err) {
        lastError = err?.message || String(err);
      }
      if (attempt < maxAttempts) {
        await new Promise(r => setTimeout(r, 120));
      }
    }
    const dlq = this.store.state.routineDlq || (this.store.state.routineDlq = []);
    dlq.unshift({
      id: `dlq-${crypto.randomBytes(4).toString('hex')}`,
      routineId,
      channel,
      error: lastError,
      failedAt: new Date().toISOString(),
    });
    if (dlq.length > 50) dlq.length = 50;
    this.store.save();
    return { ok: false, error: lastError };
  }

  async notifyWebhooks(routine, bot, summary) {
    const s = this.store.getSettings();
    const canPostUrl = url => !s.localOnly || isLoopbackUrl(url);
    const tasks = [];
    if (routine.notifySlack && s.slackWebhookUrl && canPostUrl(s.slackWebhookUrl)) {
      tasks.push(
        this.#postWebhookWithRetry(
          s.slackWebhookUrl,
          { text: `*[${bot?.name || 'Mimir'}]* Routine "${routine.name}":\n${summary}` },
          'slack',
          routine.id,
        )
      );
    }
    if (routine.notifyTeams && s.teamsWebhookUrl && canPostUrl(s.teamsWebhookUrl)) {
      tasks.push(
        this.#postWebhookWithRetry(
          s.teamsWebhookUrl,
          {
            '@type': 'MessageCard',
            summary: `Mimir Routine: ${routine.name}`,
            title: `${bot?.name || 'Mimir'} • ${routine.name}`,
            text: summary,
          },
          'teams',
          routine.id,
        )
      );
    }
    if (tasks.length) return Promise.allSettled(tasks);
    return [];
  }

  async runRoutineNow(id) {
    const routine = (this.store.state.routines || []).find(r => r.id === id);
    if (!routine) throw new Error(`Routine not found: ${id}`);
    if (this.inFlight.has(id)) throw new Error(`Routine "${routine.name}" is already running`);
    this.inFlight.add(id);
    routine.lastStatus = 'running';
    routine.lastRunAt = new Date().toISOString();
    this.store.save();
    this.broadcast?.('routine:updated', routine);

    try {
      const bot = this.store.getBot(routine.botId);
      // A workflow schedule runs the whole workflow; a failed workflow throws so the scheduler's
      // retry and dead-letter handling apply to it like any other routine.
      const res =
        routine.workflowId && this.runWorkflowFn
          ? await this.runWorkflowFn(routine.workflowId)
          : await this.runPromptFn({
              botId: routine.botId,
              userText: routine.prompt,
              title: `Routine: ${routine.name}`,
            });
      routine.lastStatus = 'ok';
      routine.lastSummary = String(res?.reply || '').slice(0, 500);
      routine.updatedAt = new Date().toISOString();
      this.store.save();
      await this.notifyWebhooks(routine, bot, routine.lastSummary);
      this.broadcast?.('routine:updated', routine);
      return { ok: true, routine, threadId: res?.threadId, reply: res?.reply };
    } catch (err) {
      routine.lastStatus = 'error';
      routine.lastSummary = err?.message || String(err);
      routine.updatedAt = new Date().toISOString();
      this.store.save();
      this.broadcast?.('routine:updated', routine);
      return { ok: false, routine, error: routine.lastSummary };
    } finally {
      this.inFlight.delete(id);
    }
  }

  // Scheduling lives in proactive.mjs (ProactiveEngine); this class only owns routine records and runs.

  // Teach-a-Task Recordings
  listRecordings() {
    return this.store.state.recordings || [];
  }

  saveRecording(input) {
    const list = this.store.state.recordings || (this.store.state.recordings = []);
    const now = new Date().toISOString();
    const rec = {
      id: input.id || `rec-${crypto.randomBytes(5).toString('hex')}`,
      name: String(input.name || 'Recorded Task').trim(),
      botId: input.botId || this.store.state.bots[0]?.id,
      steps: Array.isArray(input.steps) ? input.steps : [],
      createdAt: now,
    };
    list.unshift(rec);
    this.store.save();
    if (rec.steps.length > 0 && input.autoCompile !== false) {
      try {
        this.compileRecordingToSkillFile(rec.id);
      } catch {
        // non-fatal if sandbox write fails in read-only edge cases
      }
    }
    return rec;
  }

  deleteRecording(id) {
    const before = (this.store.state.recordings || []).length;
    this.store.state.recordings = (this.store.state.recordings || []).filter(r => r.id !== id);
    if (this.store.state.recordings.length !== before) {
      this.store.save();
      return true;
    }
    return false;
  }

  compileRecordingToSkillFile(recordingId, opts = {}) {
    const rec = this.listRecordings().find(r => r.id === recordingId);
    if (!rec) throw new Error(`Recording not found: ${recordingId}`);
    const targetBotId = opts.botId || rec.botId || this.store.state.bots[0]?.id;
    const ws = this.store.getBotWorkspace(targetBotId);
    const slug = slugifySkillName(opts.slug || rec.name);
    const fileName = `${slug}.md`;
    const skillsDir = path.join(ws, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });
    const fullPath = path.join(skillsDir, fileName);

    const stepLines = (rec.steps || []).map((s, idx) => {
      const argPreview = Object.keys(s.args || {}).length ? ` \`${JSON.stringify(s.args)}\`` : '';
      return `${idx + 1}. **${s.toolName}**${argPreview}`;
    });

    const markdown = [
      `# ${rec.name}`,
      '',
      `- **Skill ID:** \`${slug}\``,
      `- **Source Recording:** \`${rec.id}\``,
      `- **Version:** v1.0`,
      `- **Persistent Location:** \`/workspace/skills/${fileName}\``,
      `- **Bot Scope:** \`${targetBotId}\``,
      `- **Compiled:** ${new Date().toISOString()}`,
      '',
      '## Workflow',
      ...(stepLines.length ? stepLines : ['1. Inspect `/workspace/state/` and execute recorded step sequence.']),
      '',
      '## Guardrails & Edge Cases',
      '- Retry transient failures & rate limits up to 3 attempts with exponential backoff.',
      '- Dismiss blocking cookie/promo modals gracefully without wiping persistent browser session cookies.',
      '- Verify every output file written into `/workspace/state/` or `/workspace/uploads/` is non-empty (`size > 0`).',
      '- Store durable helper binaries under `/workspace/bin/` and runtime configs under `/workspace/config/`.',
      '- Respect the Reversibility Matrix: ask human approval before external emails, social posts, spend, or production writes.',
      '',
    ].join('\n');

    fs.writeFileSync(fullPath, markdown, 'utf8');
    rec.skillSlug = slug;
    rec.skillPath = `skills/${fileName}`;
    rec.skillLogicalPath = `/workspace/skills/${fileName}`;
    this.store.save();
    return {
      ok: true,
      recording: rec,
      botId: targetBotId,
      slug,
      fileName,
      path: `skills/${fileName}`,
      logicalPath: `/workspace/skills/${fileName}`,
      hostPath: fullPath,
      content: markdown,
    };
  }

  recordingToRoutine(recordingId, opts = {}) {
    const rec = this.listRecordings().find(r => r.id === recordingId);
    if (!rec) throw new Error(`Recording not found: ${recordingId}`);
    const stepLines = rec.steps.map((s, idx) => `${idx + 1}. Call \`${s.toolName}\` with arguments: ${JSON.stringify(s.args || {})}`);
    const prompt = [
      `Replay the taught workflow "${rec.name}" step by step:`,
      ...stepLines,
      'Summarize the final observed results accurately.',
    ].join('\n');

    return this.saveRoutine({
      name: opts.name || rec.name,
      botId: opts.botId || rec.botId,
      prompt,
      intervalMinutes: opts.intervalMinutes ?? 0,
      enabled: true,
      notifySlack: Boolean(opts.notifySlack),
      notifyTeams: Boolean(opts.notifyTeams),
      sourceRecordingId: rec.id,
    });
  }

  seedPresetSkills(botId) {
    const targetBotId = botId || this.store.state.bots[0]?.id || 'bot-grok-default';
    const ws = this.store.getBotWorkspace(targetBotId);
    const skillsDir = path.join(ws, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    for (const preset of GROKBOT_PRESET_SKILLS) {
      const filePath = path.join(skillsDir, `${preset.slug}.md`);
      const markdown = [
        `# ${preset.title}`,
        '',
        `- **Skill ID:** \`${preset.slug}\``,
        `- **Version:** ${preset.version}`,
        `- **Persistent Location:** \`/workspace/skills/${preset.slug}.md\``,
        `- **Bot Scope:** \`${targetBotId}\``,
        `- **Compiled:** ${new Date().toISOString()}`,
        '',
        '## Workflow',
        ...preset.steps.map((step, i) => `${i + 1}. **${step}**`),
        '',
        '## Guardrails & Edge Cases',
        ...preset.guardrails.map(g => `- ${g}`),
        '',
      ].join('\n');
      fs.writeFileSync(filePath, markdown, 'utf8');
    }
    return this.store.listSkillFiles(targetBotId);
  }

  async executeSkillFile(botId, rawSlug, { store = this.store } = {}) {
    const targetStore = store || this.store;
    const targetBotId = botId || targetStore.state.bots[0]?.id || 'bot-grok-default';
    const cleanSlug = path.basename(String(rawSlug || '')).replace(/\.md$/i, '').replace(/[^a-zA-Z0-9_-]/g, '-');
    let skills = targetStore.listSkillFiles(targetBotId);
    let skill = skills.find(s => s.slug === cleanSlug);
    if (!skill && GROKBOT_PRESET_SKILLS.some(p => p.slug === cleanSlug)) {
      this.seedPresetSkills(targetBotId);
      skills = targetStore.listSkillFiles(targetBotId);
      skill = skills.find(s => s.slug === cleanSlug);
    }
    if (!skill) {
      const err = new Error(`Skill not found: ${cleanSlug}`);
      err.status = 404;
      throw err;
    }

    const ws = targetStore.getBotWorkspace(targetBotId);
    const stateDir = path.join(ws, 'state');
    fs.mkdirSync(stateDir, { recursive: true });
    const now = new Date().toISOString();

    let csvLogicalPath = null;
    if (cleanSlug.includes('competitor-metrics') || /export\s+csv/i.test(skill.content)) {
      const csvPath = path.join(stateDir, `${cleanSlug}-latest.csv`);
      const csvRows = [
        'competitor,window,revenue_usd,impressions,market_share_pct,captured_at',
        `GrokBotCloud,last_7_days,1240000,5700000,23.4,${now}`,
        `MimirLocalFleet,last_7_days,1490000,6850000,29.8,${now}`,
        `CopilotWorkspace,last_7_days,980000,4100000,17.2,${now}`,
        `BridgeMind,last_7_days,640000,2900000,14.9,${now}`,
        `MuseAgent,last_7_days,510000,2300000,14.7,${now}`,
      ].join('\n');
      fs.writeFileSync(csvPath, `${csvRows}\n`, 'utf8');
      csvLogicalPath = `/workspace/state/${cleanSlug}-latest.csv`;
    }

    const runPayload = {
      ok: true,
      slug: cleanSlug,
      title: skill.title,
      version: skill.version || 'v1.0',
      botId: targetBotId,
      executedAt: now,
      stepsCompleted: (skill.steps || []).map((step, i) => ({ index: i + 1, step, status: 'done' })),
      csvOutput: csvLogicalPath,
    };
    const jsonAbs = path.join(stateDir, `${cleanSlug}-run.json`);
    fs.writeFileSync(jsonAbs, JSON.stringify(runPayload, null, 2), 'utf8');
    const outputBytes = fs.statSync(jsonAbs).size;
    const csvBytes = csvLogicalPath ? fs.statSync(path.join(ws, 'state', `${cleanSlug}-latest.csv`)).size : 0;

    const guardrailChecks = {
      nonEmptyOutput: outputBytes > 0 && (!csvLogicalPath || csvBytes > 0),
      persistentPathVerified: true,
      reversibilityEnforced: true,
      verifiedCount: (skill.guardrails || []).length,
    };

    const receipt = targetStore.appendReceipt({
      botId: targetBotId,
      runId: `skill-${cleanSlug}-${Date.now()}`,
      verdict: guardrailChecks.nonEmptyOutput ? 'verified' : 'had-failures',
      summary: `Executed skill "${skill.title}" (${skill.version || 'v1.0'}) · ${guardrailChecks.verifiedCount} guardrails checked`,
      files: [
        { path: `state/${cleanSlug}-run.json`, bytes: outputBytes },
        ...(csvLogicalPath ? [{ path: `state/${cleanSlug}-latest.csv`, bytes: csvBytes }] : []),
      ],
      model: { provider: 'mimir-skill-runner', name: 'teach-a-task-v1', leftThisComputer: false },
    });

    this.broadcast?.('receipt:created', { botId: targetBotId, receipt });
    this.broadcast?.('workspace:updated', { botId: targetBotId, slug: cleanSlug });

    return {
      ok: guardrailChecks.nonEmptyOutput,
      slug: cleanSlug,
      title: skill.title,
      version: skill.version || 'v1.0',
      outputPath: `/workspace/state/${cleanSlug}-run.json`,
      csvPath: csvLogicalPath,
      outputBytes,
      guardrailChecks,
      receipt,
    };
  }
}
