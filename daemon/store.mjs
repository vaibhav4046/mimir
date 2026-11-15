import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { envVar } from './env.mjs';
import { finalizeReceiptHashChain, verifyReceiptChain } from './receipt.mjs';

export function resolveUserScope(reqOrValue = 'local-owner') {
  let raw = reqOrValue;
  if (reqOrValue && typeof reqOrValue === 'object' && 'headers' in reqOrValue) {
    const hdr = reqOrValue.headers?.['x-mimir-user'] || reqOrValue.headers?.['x-user-id'];
    raw = hdr || 'local-owner';
  }
  const clean = String(raw || 'local-owner').trim().replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return clean || 'local-owner';
}

export const BOT_SHAPES = [
  'mimir', 'mimir-head', 'all-father-warrior', 'young-archer', 'forge-bot-brok', 'forge-bot-sindri',
  'freya-valkyrie', 'odin-archivist', 'thor-thunderer', 'tyr-diplomat', 'angrboda-mystic',
  'heimdall-sentinel', 'durlin-crafter', 'lunda-smith',
  'leviathan', 'mjolnir', 'yggdrasil', 'valkyrie',
  'arch', 'bean', 'blob', 'capsule', 'cloud', 'clover', 'crystal', 'cylinder',
  'dome', 'egg', 'flower', 'gem', 'heart', 'hex', 'house', 'leaf',
  'pebble', 'pumpkin', 'shield', 'sparkle', 'square', 'squircle', 'star',
  'tablet', 'teardrop', 'wedge'
];

export const BOT_COLORS = [
  '#5cc8ff', '#d9a441', '#e85d2a', '#38b87c', '#8b6ce8', '#10a693', '#e54868', '#94a3b8'
];

export const WORKSPACE_SUBDIRS = Object.freeze(['bin', 'config', 'skills', 'state', 'uploads']);

export const VOLATILE_PATHS_CONTRAST = Object.freeze([
  { path: '/tmp', status: 'volatile', detail: 'Cleared on reboot or session restart' },
  { path: '/usr', status: 'volatile', detail: 'Read-only system packages, overwritten on VM update' },
  { path: '/home', status: 'volatile', detail: 'Ephemeral user home directory, wiped on reset' },
]);

export const CHIEF_OF_STAFF_TEAM_PRESET = Object.freeze({
  chief: {
    id: 'bot-chief-klaus',
    name: 'Klaus',
    role: 'Chief of Staff · Team Coordinator',
    shape: 'mimir-head',
    color: '#e54868',
    specialistTag: 'chief-of-staff',
    parentBotId: null,
    isTeamBot: true,
    slackChannel: '#growth-team',
    teamsChannel: 'Growth Team',
    tools: { shell: true, fs: true, browser: true, memory: true, vault: false },
    systemPrompt:
      'You are Klaus, the Chief of Staff orchestrating the autonomous Norse-pixel specialist team (@Mara Lead Scout, @Cole Copywriter, @Rina Visual Designer, @Vince Ops Tracker, @Jonathan CFO). NEVER try to do every specialist task alone when a team specialist owns it: delegate bounded sub-tasks cleanly via subagent_loop or @mention routing, keep outputs in persistent /workspace subdirs (skills/, state/, config/), and enforce the Reversibility Matrix (autonomous research/drafts/builds vs mandatory human approval for external sends, spend, or production writes).',
  },
  specialists: [
    {
      id: 'bot-spec-mara',
      name: 'Mara',
      role: 'Lead Scout · Research & Insights',
      shape: 'young-archer',
      color: '#3ac9ff',
      specialistTag: 'research',
      parentBotId: 'bot-chief-klaus',
      isTeamBot: true,
      slackChannel: '#growth-team',
      teamsChannel: 'Growth Team',
      tools: { shell: false, fs: true, browser: true, memory: true, vault: false },
      systemPrompt:
        'You are Mara, Lead Scout (Research & Insights). Charter: pull fresh live web/prospect intelligence, synthesize structured bullet insights, and persist findings under state/ or skills/. Reversibility boundary: web research and workspace summaries are autonomous (REVERSIBLE); never post or email externally.',
    },
    {
      id: 'bot-spec-cole',
      name: 'Cole',
      role: 'Copywriter · Messaging & Copy',
      shape: 'forge-bot-sindri',
      color: '#e6ab42',
      specialistTag: 'copy',
      parentBotId: 'bot-chief-klaus',
      isTeamBot: true,
      slackChannel: '#growth-team',
      teamsChannel: 'Growth Team',
      tools: { shell: false, fs: true, browser: true, memory: true, vault: false },
      systemPrompt:
        'You are Cole, Growth Copywriter (Messaging & Copy). Charter: draft crisp, personalized outreach emails, release posts, and docs grounded in @Mara research inside workspace files. CRITICAL BOUNDARY RULE: Drafting is REVERSIBLE; NEVER send external emails, DMs, or social posts (IRREVERSIBLE) without explicit human approval.',
    },
    {
      id: 'bot-spec-rina',
      name: 'Rina',
      role: 'Visual Designer · Brand & Design',
      shape: 'freya-valkyrie',
      color: '#10a693',
      specialistTag: 'design',
      parentBotId: 'bot-chief-klaus',
      isTeamBot: true,
      slackChannel: '#growth-team',
      teamsChannel: 'Growth Team',
      tools: { shell: false, fs: true, browser: true, memory: true, vault: false },
      systemPrompt:
        'You are Rina, Visual Designer (Brand & Design). Charter: produce crisp pixel SVG assets, UI mockups, and visual layout specs in workspace files while preserving Mimir dark-navy/gold/icy-cyan craft.',
    },
    {
      id: 'bot-spec-vince',
      name: 'Vince',
      role: 'Ops Tracker · Operations & Tracking',
      shape: 'forge-bot-brok',
      color: '#8b6ce8',
      specialistTag: 'ops',
      parentBotId: 'bot-chief-klaus',
      isTeamBot: true,
      slackChannel: '#growth-team',
      teamsChannel: 'Growth Team',
      tools: { shell: true, fs: true, browser: false, memory: true, vault: false },
      systemPrompt:
        'You are Vince, Ops Tracker (Operations & Tracking). Charter: track pipeline metrics, cron health, build checks, and persist durable run state in state/ and config/. Always obtain approval before mutating external or production infrastructure.',
    },
    {
      id: 'bot-spec-jonathan',
      name: 'Jonathan',
      role: 'CFO & Audit · Finance & Reversibility',
      shape: 'all-father-warrior',
      color: '#38d996',
      specialistTag: 'finance',
      parentBotId: 'bot-chief-klaus',
      isTeamBot: true,
      slackChannel: '#growth-team',
      teamsChannel: 'Growth Team',
      tools: { shell: false, fs: true, browser: false, memory: true, vault: false },
      systemPrompt:
        'You are Jonathan, CFO & Audit. Charter: verify budgets, unit economics, forecast math, and enforce strict human approval gates on any financial transaction or irreversible commitment.',
    },
  ],
});

export const EXECUTION_MODES = Object.freeze(['agent', 'code', 'chat']);

export function normalizeExecutionMode(mode, fallback = 'agent') {
  const clean = String(mode || '').trim().toLowerCase();
  return EXECUTION_MODES.includes(clean) ? clean : fallback;
}

function normalizeOptionalExecutionMode(mode) {
  if (mode === null || mode === undefined || mode === '') return null;
  const clean = String(mode).trim().toLowerCase();
  return EXECUTION_MODES.includes(clean) ? clean : null;
}

function normalizeNullableString(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  return s ? s : null;
}

export function resolveDataDir() {
  const fromEnv = envVar('DATA_DIR');
  if (fromEnv) return fromEnv;
  // Installs from before the rename keep their data where it already is.
  const legacy = path.join(os.homedir(), '.grokbot-clone');
  const current = path.join(os.homedir(), '.mimir');
  return !fs.existsSync(current) && fs.existsSync(legacy) ? legacy : current;
}

export function defaultSettings() {
  return {
    version: 1,
    themePreference: 'dark',
    provider: 'ollama',
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen3:1.7b',
    ollamaThink: false,
    openaiBaseUrl: 'http://127.0.0.1:20128/v1',
    openaiApiKey: '', // legacy plaintext slot; keys now live in the vault via openaiApiKeyRef
    openaiApiKeyRef: '',
    openaiModel: 'gpt-4o-mini',
    localOnly: false, // when true, no model call may leave this computer
    modelSetupDone: false,
    enableFallback: true,
    approvalPolicy: 'ask-writes', // 'ask-writes' | 'always-ask' | 'auto-approve'
    soundEffects: true,
    reducedMotion: false,
    mcpBoxServers: [],
    mcpDisabledToolsByServerId: {},
    mcpCustomInstructionsByServerId: {},
    slackWebhookUrl: '',
    teamsWebhookUrl: '',
  };
}

function defaultBots() {
  const now = new Date().toISOString();
  return [
    {
      id: 'bot-grok-default', // stable internal id kept from before the rename; threads, sandboxes and ledgers reference it
      name: 'Mimir',
      role: 'Local & Browser Sage',
      shape: 'mimir',
      color: '#5cc8ff',
      systemPrompt:
        'You are Mimir, the Norse sage and capable local desktop agent. You have real access to your sandboxed workspace, shell commands, browser automation, persistent memory, and MCP tools. Think concisely, call tools accurately when needed, verify results from actual tool output, and never invent outputs.',
      modelOverride: '',
      tools: { shell: true, fs: true, browser: true, memory: true, vault: true },
      allowedMcpIds: [],
      executionMode: 'agent',
      parentBotId: null,
      specialistTag: null,
      isTeamBot: false,
      webhookToken: crypto.randomBytes(8).toString('hex'),
      slackChannel: '',
      teamsChannel: '',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'bot-team-research',
      name: 'Research Analyst',
      role: 'Team Bot • Web & File Synthesis',
      shape: 'crystal',
      color: '#10a693',
      systemPrompt:
        'You are a Team Research Analyst bot. Use browser_open / fs_write / memory_save to investigate topics, extract facts carefully with citations, and write concise Markdown briefs in your workspace.',
      modelOverride: '',
      tools: { shell: false, fs: true, browser: true, memory: true, vault: false },
      allowedMcpIds: [],
      executionMode: 'agent',
      parentBotId: null,
      specialistTag: null,
      isTeamBot: true,
      webhookToken: crypto.randomBytes(8).toString('hex'),
      slackChannel: '#research-feed',
      teamsChannel: 'Research',
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'bot-team-ops',
      name: 'Local Ops Engineer',
      role: 'Team Bot • Shell & Diagnostics',
      shape: 'shield',
      color: '#10ab61',
      systemPrompt:
        'You are a Local Ops Engineer bot. Diagnose issues, inspect logs/processes cleanly with shell_exec, write reproducible checks, and summarize root causes concisely.',
      modelOverride: '',
      tools: { shell: true, fs: true, browser: false, memory: true, vault: true },
      allowedMcpIds: [],
      executionMode: 'agent',
      parentBotId: null,
      specialistTag: null,
      isTeamBot: true,
      webhookToken: crypto.randomBytes(8).toString('hex'),
      slackChannel: '#ops-alerts',
      teamsChannel: 'Infrastructure',
      createdAt: now,
      updatedAt: now,
    }
  ];
}

export class AppStore {
  constructor(dataDir = resolveDataDir()) {
    this.dataDir = dataDir;
    this.sandboxesDir = path.join(dataDir, 'sandboxes');
    this.stagingDir = path.join(dataDir, 'staging');
    this.storePath = path.join(dataDir, 'store.json');
    fs.mkdirSync(this.dataDir, { recursive: true });
    fs.mkdirSync(this.sandboxesDir, { recursive: true });
    fs.mkdirSync(this.stagingDir, { recursive: true });
    this.state = this.#load();
    this.ensureSandboxes();
  }

  #load() {
    if (fs.existsSync(this.storePath)) {
      try {
        const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
        const bots = Array.isArray(raw.bots) && raw.bots.length ? raw.bots : defaultBots();
        const threads = Array.isArray(raw.threads) ? raw.threads : [];
        for (const b of bots) {
          if (b.id === 'bot-grok-default' && (b.name === 'Grok Bot' || b.role === 'Norse Realm & Desktop Sage')) {
            b.name = 'Mimir';
            b.role = 'Local & Browser Sage';
            b.shape = 'mimir';
            b.color = '#5cc8ff';
          }
          b.executionMode = normalizeExecutionMode(b.executionMode, 'agent');
          b.parentBotId = normalizeNullableString(b.parentBotId);
          b.specialistTag = normalizeNullableString(b.specialistTag);
        }
        for (const th of threads) {
          th.executionMode = normalizeOptionalExecutionMode(th.executionMode);
        }
        return {
          ...raw, // keep keys owned by other modules (routineDlq, proactive, ...) across restarts
          settings: { ...defaultSettings(), ...(raw.settings || {}) },
          bots,
          threads,
          routines: Array.isArray(raw.routines) ? raw.routines : [],
          recordings: Array.isArray(raw.recordings) ? raw.recordings : [],
          memories: raw.memories && typeof raw.memories === 'object' ? raw.memories : {},
          receipts: Array.isArray(raw.receipts) ? raw.receipts : [],
          receiptAnchorHash: typeof raw.receiptAnchorHash === 'string' ? raw.receiptAnchorHash : '0'.repeat(64),
          runs: Array.isArray(raw.runs) ? raw.runs : [],
          researchRuns: Array.isArray(raw.researchRuns) ? raw.researchRuns : [],
          memoryTombstones: Array.isArray(raw.memoryTombstones) ? raw.memoryTombstones : [],
        };
      } catch (err) {
        if (err && !(err instanceof SyntaxError)) throw err;
        // Corrupted store falls back cleanly after preserving backup
        fs.copyFileSync(this.storePath, `${this.storePath}.corrupt-${Date.now()}`);
      }
    }
    const fresh = {
      settings: defaultSettings(),
      bots: defaultBots(),
      threads: [],
      routines: [
        {
          id: 'routine-health-check',
          name: 'Ollama & Workspace Health Check',
          botId: 'bot-team-ops',
          prompt: 'List files in the workspace with fs_list and confirm status cleanly.',
          intervalMinutes: 0,
          enabled: false,
          webhookToken: crypto.randomBytes(8).toString('hex'),
          notifySlack: false,
          notifyTeams: false,
          lastRunAt: null,
          lastStatus: 'idle',
          lastOutput: '',
          steps: []
        }
      ],
      recordings: [],
      memories: {},
      receipts: [],
      receiptAnchorHash: '0'.repeat(64),
      runs: [],
      researchRuns: [],
      memoryTombstones: [],
    };
    this.#writeSync(fresh);
    return fresh;
  }

  #writeSync(data = this.state) {
    const tmp = `${this.storePath}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeFileSync(fd, JSON.stringify(data, null, 2), 'utf8');
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    for (let i = 0; i < 5; i++) {
      try {
        fs.renameSync(tmp, this.storePath);
        return;
      } catch (err) {
        if (i === 4 || !['EPERM', 'EBUSY', 'EACCES'].includes(err?.code)) {
          try { fs.rmSync(tmp, { force: true }); } catch {}
          throw err;
        }
      }
    }
  }

  save() {
    this.#writeSync();
  }

  ensureWorkspaceDirs(dir) {
    fs.mkdirSync(dir, { recursive: true });
    for (const sub of WORKSPACE_SUBDIRS) {
      fs.mkdirSync(path.join(dir, sub), { recursive: true });
    }
    return dir;
  }

  ensureSandboxes() {
    for (const bot of this.state.bots) {
      this.getBotWorkspace(bot.id);
    }
  }

  getBotWorkspace(botId) {
    const safeId = String(botId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = path.join(this.sandboxesDir, safeId);
    return this.ensureWorkspaceDirs(dir);
  }

  listSkillFiles(botId) {
    const ws = this.getBotWorkspace(botId);
    const skillsDir = path.join(ws, 'skills');
    if (!fs.existsSync(skillsDir)) return [];
    const items = [];
    for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.md')) continue;
      const fullPath = path.join(skillsDir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        const content = fs.readFileSync(fullPath, 'utf8');
        const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
        const version = content.match(/\*\*Version:\*\*\s*(v\d+\.\d+)|\b(v\d+\.\d+)\b/i);
        const workflowSec = content.split(/^##\s+Workflow\s*$/im)[1]?.split(/^##\s+/m)[0] || '';
        const steps = workflowSec
          .split(/\r?\n/)
          .map(l => l.trim().match(/^\d+\.\s+(.+)$/)?.[1])
          .filter(Boolean)
          .map(s => s.replace(/\*\*/g, ''));
        const guardSec = content.split(/^##\s+Guardrails(?:\s*&\s*Edge Cases)?\s*$/im)[1]?.split(/^##\s+/m)[0] || '';
        const parsedGuardrails = guardSec
          .split(/\r?\n/)
          .map(l => l.trim().match(/^-\s+(.+)$/)?.[1])
          .filter(Boolean)
          .map(s => s.replace(/`/g, ''));
        const guardrails = parsedGuardrails.length
          ? parsedGuardrails
          : [
              'Do not change filters or date range',
              'Verify output file is non-empty (size > 0) inside /workspace/state/',
              'Respect Reversibility Matrix before external actions',
            ];
        const slug = entry.name.replace(/\.md$/i, '');
        items.push({
          fileName: entry.name,
          slug,
          title: heading || slug,
          version: version?.[1] || version?.[2] || 'v1.0',
          steps,
          guardrails,
          path: `skills/${entry.name}`,
          logicalPath: `/workspace/skills/${entry.name}`,
          size: stat.size,
          updatedAt: stat.mtime.toISOString(),
          preview: content.slice(0, 600),
          content,
        });
      } catch {
        // skip unreadable skill file
      }
    }
    return items.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  verifyAndSnapshotWorkspace(botId) {
    const ws = this.getBotWorkspace(botId);
    fs.mkdirSync(path.join(ws, 'state', 'sessions'), { recursive: true });
    const files = [];
    const walk = (dir, relBase = '') => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = relBase ? `${relBase}/${ent.name}` : ent.name;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) {
          walk(abs, rel);
        } else if (ent.isFile() && rel !== 'state/persistence-manifest.json') {
          const buf = fs.readFileSync(abs);
          files.push({
            path: `/workspace/${rel.replace(/\\/g, '/')}`,
            bytes: buf.length,
            sha256: crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16),
          });
        }
      }
    };
    walk(ws);
    const totalBytes = files.reduce((acc, f) => acc + f.bytes, 0);
    const manifest = {
      botId,
      verifiedAt: new Date().toISOString(),
      persistentRoot: '/workspace',
      directories: [...WORKSPACE_SUBDIRS],
      volatilePathsIsolated: VOLATILE_PATHS_CONTRAST.map(v => v.path),
      fileCount: files.length,
      totalBytes,
      files,
    };
    const manifestAbs = path.join(ws, 'state', 'persistence-manifest.json');
    fs.writeFileSync(manifestAbs, JSON.stringify(manifest, null, 2), 'utf8');
    const receipt = this.appendReceipt({
      botId,
      runId: `snapshot-${Date.now()}`,
      verdict: 'verified',
      summary: `/workspace snapshot verified (${WORKSPACE_SUBDIRS.length} persistent dirs, ${files.length} files, ${totalBytes}B)`,
      files: [{ path: 'state/persistence-manifest.json', bytes: fs.statSync(manifestAbs).size }],
      model: { provider: 'mimir-workspace', name: 'persistence-verifier', leftThisComputer: false },
    });
    return {
      ok: true,
      ...manifest,
      manifestPath: '/workspace/state/persistence-manifest.json',
      receipt,
    };
  }

  getWorkspaceLayout(botId) {
    const ws = this.getBotWorkspace(botId);
    const persistentSubdirs = WORKSPACE_SUBDIRS.map(name => {
      const subDir = path.join(ws, name);
      let fileCount = 0;
      try {
        fileCount = fs.readdirSync(subDir).length;
      } catch {}
      return {
        name,
        logicalPath: `/workspace/${name}`,
        hostPath: subDir,
        fileCount,
        status: 'persistent',
      };
    });
    return {
      botId,
      logicalMount: '/workspace',
      workspacePath: ws,
      persistentSubdirs,
      volatilePaths: VOLATILE_PATHS_CONTRAST,
      skillFiles: this.listSkillFiles(botId),
    };
  }

  deployChiefOfStaffTeam({ activateThread = true } = {}) {
    const now = new Date().toISOString();
    const specs = [CHIEF_OF_STAFF_TEAM_PRESET.chief, ...CHIEF_OF_STAFF_TEAM_PRESET.specialists];
    const deployedBots = [];

    for (const spec of specs) {
      let existing = this.getBot(spec.id);
      if (!existing) {
        existing = this.createBot(spec);
      } else {
        existing = this.updateBot(spec.id, {
          name: spec.name,
          role: spec.role,
          shape: spec.shape,
          color: spec.color,
          specialistTag: spec.specialistTag,
          parentBotId: spec.parentBotId,
          isTeamBot: true,
          slackChannel: spec.slackChannel,
          teamsChannel: spec.teamsChannel,
          systemPrompt: existing.systemPrompt || spec.systemPrompt,
          updatedAt: now,
        });
      }
      this.getBotWorkspace(existing.id);
      deployedBots.push(existing);
    }

    const channelTitles = ['#All Hands Prep', '#Executive Updates', '#Product Launch', '#Growth Team'];
    const channels = [];
    let growthThread = null;
    if (activateThread) {
      for (const title of channelTitles) {
        let thr = this.state.threads.find(
          t => t.botId === CHIEF_OF_STAFF_TEAM_PRESET.chief.id && t.title === title,
        );
        if (!thr) {
          thr = this.createThread({
            botId: CHIEF_OF_STAFF_TEAM_PRESET.chief.id,
            title,
            executionMode: 'agent',
          });
        }
        channels.push({ id: thr.id, title: thr.title });
        if (title === '#Growth Team') growthThread = thr;
      }
    } else {
      growthThread =
        this.state.threads.find(
          t => t.botId === CHIEF_OF_STAFF_TEAM_PRESET.chief.id && t.title === '#Growth Team',
        ) || null;
    }

    return {
      ok: true,
      chief: deployedBots[0],
      specialists: deployedBots.slice(1),
      deployedCount: deployedBots.length,
      teamThreadId: growthThread?.id || null,
      channels,
    };
  }

  runChiefDelegationPlaybook(botId = 'bot-chief-klaus') {
    const deployed = this.deployChiefOfStaffTeam({ activateThread: true });
    const chiefId = deployed.chief?.id || botId || 'bot-chief-klaus';
    const maraWs = this.getBotWorkspace('bot-spec-mara');
    const coleWs = this.getBotWorkspace('bot-spec-cole');
    const chiefWs = this.getBotWorkspace(chiefId);

    const signalsMd = [
      '# Prospect A Update (@Mara · Lead Scout)',
      '',
      '- **Signals Detected:**',
      '  - Viewed pricing page 3x this week',
      '  - New hiring for RevOps Lead',
      '  - Competitor mentions increasing across technical forums',
      `- **Updated:** ${new Date().toISOString()}`,
      '- **Status:** DONE (Reversible research stored under /workspace/state/)',
      '',
    ].join('\n');

    const outreachMd = [
      '# Personalized Outreach Draft (@Cole · Growth Copywriter)',
      '',
      '**Reversibility Gate:** REVERSIBLE LOCAL DRAFT (External send HELD for human OK)',
      '',
      'Subject: Simplifying RevOps agent workflows before your Q2 scale-up',
      '',
      'Hi Prospect A team,',
      'Noticed your RevOps hiring ramp and recent evaluation of autonomous agent workflows.',
      'Unlike ephemeral tab assistants, Mimir runs 24/7 with Chief-of-Staff delegation, persistent /workspace storage, and cryptographic execution receipts.',
      '',
      'Want a 10-minute walkthrough of our Reversibility Matrix?',
      '',
    ].join('\n');

    fs.mkdirSync(path.join(maraWs, 'state'), { recursive: true });
    fs.mkdirSync(path.join(coleWs, 'state'), { recursive: true });
    fs.mkdirSync(path.join(chiefWs, 'state'), { recursive: true });
    fs.writeFileSync(path.join(maraWs, 'state', 'prospect-a-signals.md'), signalsMd, 'utf8');
    fs.writeFileSync(path.join(chiefWs, 'state', 'prospect-a-signals.md'), signalsMd, 'utf8');
    fs.writeFileSync(path.join(coleWs, 'state', 'prospect-a-outreach-draft.md'), outreachMd, 'utf8');
    fs.writeFileSync(path.join(chiefWs, 'state', 'prospect-a-outreach-draft.md'), outreachMd, 'utf8');

    const threadId = deployed.teamThreadId;
    if (threadId) {
      const thr = this.getThread(threadId);
      const alreadyLogged = (thr?.messages || []).some(m => String(m.content || '').includes('prospect-a-outreach-draft.md'));
      if (!alreadyLogged) {
        if (!thr?.messages?.length) {
          this.appendMessage(threadId, {
            role: 'user',
            content: "What's the latest on Prospect A? Any movement or new signals?",
          });
        }
        this.appendMessage(threadId, {
          role: 'assistant',
          content: 'Got it. Delegating to @Mara to pull fresh intelligence and summarize.',
          provider: 'mimir-chief',
          model: 'chief-topology',
        });
        this.appendMessage(threadId, {
          role: 'assistant',
          speakerBotId: 'bot-spec-mara',
          speakerName: 'Mara',
          content:
            'Prospect A update (@Mara):\n• Viewed pricing 3x this week\n• New hiring for RevOps\n• Competitor mentions increasing\n\nSaved to `/workspace/state/prospect-a-signals.md`.',
          provider: 'mimir-specialist',
          model: 'mara-scout',
        });
        this.appendMessage(threadId, {
          role: 'assistant',
          content: 'Thanks @Mara. Looping in @Cole to shape the outreach message.',
          provider: 'mimir-chief',
          model: 'chief-topology',
        });
        this.appendMessage(threadId, {
          role: 'assistant',
          speakerBotId: 'bot-spec-cole',
          speakerName: 'Cole',
          content:
            'On it (@Cole). Drafted personalized outreach in `/workspace/state/prospect-a-outreach-draft.md`. External send held pending your OK per Reversibility Matrix.',
          provider: 'mimir-specialist',
          model: 'cole-copywriter',
        });
      }
    }

    const receipt = this.appendReceipt({
      botId: chiefId,
      threadId,
      runId: `playbook-${Date.now()}`,
      verdict: 'verified',
      summary: 'Chief of Staff playbook delegated @Mara research -> @Cole outreach draft (external send gated)',
      delegated: [
        { name: 'Mara', status: 'done' },
        { name: 'Cole', status: 'done' },
      ],
      files: [
        { path: 'state/prospect-a-signals.md', bytes: Buffer.byteLength(signalsMd) },
        { path: 'state/prospect-a-outreach-draft.md', bytes: Buffer.byteLength(outreachMd) },
      ],
      model: { provider: 'mimir-team', name: 'chief-of-staff-playbook', leftThisComputer: false },
    });

    return {
      ok: true,
      threadId,
      channelTitle: '#Growth Team',
      channels: deployed.channels,
      artifacts: ['/workspace/state/prospect-a-signals.md', '/workspace/state/prospect-a-outreach-draft.md'],
      receipt,
      overview: this.getTeamOverview([], chiefId),
    };
  }

  exportGrokBotBundle(botId = 'bot-chief-klaus') {
    const targetBotId = this.getBot(botId) ? botId : this.state.bots[0]?.id || 'bot-chief-klaus';
    const workspaceSnapshot = this.verifyAndSnapshotWorkspace(targetBotId);
    return {
      schema: 'mimir.grokbot.bundle.v1',
      exportedAt: new Date().toISOString(),
      botId: targetBotId,
      team: this.getTeamOverview([], targetBotId),
      skills: this.listSkillFiles(targetBotId),
      routines: this.state.routines || [],
      workspaceSnapshot,
    };
  }

  importGrokBotBundle(bundle = {}) {
    const deployed = this.deployChiefOfStaffTeam({ activateThread: true });
    const targetBotId = deployed.chief?.id || 'bot-chief-klaus';
    const ws = this.getBotWorkspace(targetBotId);
    const skillsDir = path.join(ws, 'skills');
    fs.mkdirSync(skillsDir, { recursive: true });

    let importedSkills = 0;
    for (const sk of Array.isArray(bundle?.skills) ? bundle.skills : []) {
      const slug = String(sk?.slug || sk?.fileName || 'imported-skill')
        .toLowerCase()
        .replace(/\.md$/i, '')
        .replace(/[^a-z0-9-_]+/g, '-')
        .slice(0, 64);
      if (!slug || !sk?.content) continue;
      fs.writeFileSync(path.join(skillsDir, `${slug}.md`), String(sk.content), 'utf8');
      importedSkills++;
    }

    let importedRoutines = 0;
    const list = this.state.routines || (this.state.routines = []);
    for (const rt of Array.isArray(bundle?.routines) ? bundle.routines : []) {
      if (!rt?.name || !rt?.prompt) continue;
      if (!list.some(existing => existing.name === rt.name && existing.botId === (rt.botId || targetBotId))) {
        list.unshift({
          ...rt,
          id: rt.id || `rtn-${crypto.randomBytes(5).toString('hex')}`,
          botId: rt.botId && this.getBot(rt.botId) ? rt.botId : targetBotId,
          updatedAt: new Date().toISOString(),
        });
        importedRoutines++;
      }
    }
    this.save();

    const workspaceSnapshot = this.verifyAndSnapshotWorkspace(targetBotId);
    return {
      ok: true,
      botId: targetBotId,
      deployedTeam: deployed,
      importedSkills,
      importedRoutines,
      workspaceSnapshot,
    };
  }

  getTeamOverview(activeStatuses = [], focusBotId = null) {
    const statusMap = new Map((activeStatuses || []).map(s => [s.botId, s]));
    const allBots = this.listBots();
    const chief =
      allBots.find(b => b.id === 'bot-chief-klaus') ||
      allBots.find(b => b.specialistTag === 'chief-of-staff') ||
      allBots[0];
    const specialists = allBots.filter(b => {
      if (!chief) return false;
      return b.parentBotId === chief.id || b.id.startsWith('bot-spec-') || (b.isTeamBot && b.id !== chief.id);
    });

    const formatNode = b => {
      const st = statusMap.get(b.id);
      return {
        id: b.id,
        name: b.name,
        role: b.role,
        shape: b.shape,
        color: b.color,
        specialistTag: b.specialistTag,
        parentBotId: b.parentBotId,
        state: st?.state === 'working' ? 'working' : 'waiting',
        activeThreadId: st?.activeThreadId || null,
      };
    };

    const chiefNode = chief ? formatNode(chief) : null;
    const specialistNodes = specialists.map(formatNode);
    const activeWork = specialistNodes.map(sp => {
      const relevantThreads = this.state.threads.filter(
        t => t.botId === sp.id || (chief && t.botId === chief.id),
      );
      const mentionedDone = relevantThreads.some(thr =>
        (thr.messages || []).some(
          m =>
            m.role === 'assistant' &&
            (m.speakerBotId === sp.id || String(m.content || '').toLowerCase().includes(`@${sp.name.toLowerCase()}`)),
        ),
      );
      let workStatus = 'PENDING';
      if (sp.state === 'working') workStatus = 'IN PROGRESS';
      else if (mentionedDone) workStatus = 'DONE';
      return {
        botId: sp.id,
        name: sp.name,
        tag: sp.specialistTag || sp.role.split('·')[0].trim(),
        color: sp.color,
        status: workStatus,
      };
    });

    const targetBotId = focusBotId || chief?.id || allBots[0]?.id;
    const activitySeries = new Array(14).fill(0);
    const nowMs = Date.now();
    for (const thr of this.state.threads) {
      for (const msg of thr.messages || []) {
        const ts = Date.parse(msg.createdAt || '');
        if (!Number.isFinite(ts)) continue;
        const bucket = Math.floor((nowMs - ts) / 600_000);
        if (bucket >= 0 && bucket < activitySeries.length) {
          activitySeries[activitySeries.length - 1 - bucket] += 1;
        }
      }
    }

    return {
      deployed: Boolean(allBots.some(b => b.id === 'bot-chief-klaus')),
      chief: chiefNode,
      specialists: specialistNodes,
      edges: specialistNodes.map(sp => ({ from: chiefNode?.id || '', to: sp.id })),
      activeWork,
      activitySeries,
      workspaceLayout: targetBotId ? this.getWorkspaceLayout(targetBotId) : null,
    };
  }

  /** Server-side settings, with the model API key resolved from the vault. Never send to the UI. */
  getSettings() {
    const s = {
      browserMode: 'embedded',
      userCdpUrl: 'http://127.0.0.1:9222',
      cloudBrowserWsUrl: '',
      maxConcurrentTasks: 3,
      rateLimitPerMinute: 40,
      workerNodes: [],
      ...this.state.settings,
    };
    if (s.openaiApiKeyRef && this.secretResolver) s.openaiApiKey = this.secretResolver(s.openaiApiKeyRef) || '';
    return s;
  }

  /** Settings safe for the renderer: the API key is replaced by a has-key flag. */
  getPublicSettings() {
    const s = this.getSettings();
    return { ...s, openaiApiKey: '', hasOpenaiApiKey: Boolean(s.openaiApiKey) };
  }

  updateSettings(patch) {
    const next = { ...patch };
    // An empty key from the UI means "unchanged" (the UI never receives the real key).
    if (next.openaiApiKey === '' || next.openaiApiKey === undefined) delete next.openaiApiKey;
    if (next.openaiApiKey && this.secretWriter) {
      next.openaiApiKeyRef = this.secretWriter('MODEL_API_KEY', next.openaiApiKey);
      next.openaiApiKey = '';
    }
    delete next.hasOpenaiApiKey;
    this.state.settings = { ...this.state.settings, ...next };
    this.save();
    return this.getPublicSettings();
  }

  listBots() {
    return this.state.bots;
  }

  getBot(id) {
    return this.state.bots.find(b => b.id === id) || null;
  }

  createBot(input) {
    const now = new Date().toISOString();
    const rawId = input.id ? String(input.id).trim().replace(/[^a-zA-Z0-9_-]/g, '_') : '';
    const id = rawId || `bot-${crypto.randomBytes(4).toString('hex')}`;
    const bot = {
      id,
      name: String(input.name || 'New Bot').trim(),
      role: String(input.role || 'Custom Agent').trim(),
      shape: BOT_SHAPES.includes(input.shape) ? input.shape : 'squircle',
      color: input.color || BOT_COLORS[this.state.bots.length % BOT_COLORS.length],
      systemPrompt: String(input.systemPrompt || 'You are a helpful local desktop agent.').trim(),
      modelOverride: String(input.modelOverride || '').trim(),
      tools: {
        shell: input.tools?.shell ?? true,
        fs: input.tools?.fs ?? true,
        browser: input.tools?.browser ?? true,
        memory: input.tools?.memory ?? true,
        vault: input.tools?.vault ?? false,
      },
      allowedMcpIds: Array.isArray(input.allowedMcpIds) ? input.allowedMcpIds : [],
      ...(Array.isArray(input.allowedTools) ? { allowedTools: input.allowedTools.map(String) } : {}),
      accessories: Array.isArray(input.accessories) ? input.accessories.filter(Boolean).slice(0, 8) : [],
      executionMode: normalizeExecutionMode(input.executionMode, 'agent'),
      parentBotId: normalizeNullableString(input.parentBotId),
      specialistTag: normalizeNullableString(input.specialistTag),
      norseRoleId: normalizeNullableString(input.norseRoleId),
      isTeamBot: Boolean(input.isTeamBot),
      webhookToken: crypto.randomBytes(8).toString('hex'),
      slackChannel: String(input.slackChannel || '').trim(),
      teamsChannel: String(input.teamsChannel || '').trim(),
      createdAt: now,
      updatedAt: now,
    };
    this.state.bots.push(bot);
    fs.mkdirSync(this.getBotWorkspace(bot.id), { recursive: true });
    this.save();
    return bot;
  }

  updateBot(id, patch = {}) {
    const bot = this.getBot(id);
    if (!bot) return null;
    const nextExecutionMode =
      'executionMode' in patch
        ? normalizeExecutionMode(patch.executionMode, normalizeExecutionMode(bot.executionMode, 'agent'))
        : normalizeExecutionMode(bot.executionMode, 'agent');
    const nextParentBotId =
      'parentBotId' in patch
        ? normalizeNullableString(patch.parentBotId)
        : normalizeNullableString(bot.parentBotId);
    const nextSpecialistTag =
      'specialistTag' in patch
        ? normalizeNullableString(patch.specialistTag)
        : normalizeNullableString(bot.specialistTag);
    const nextAllowedTools =
      'allowedTools' in patch
        ? (Array.isArray(patch.allowedTools) ? patch.allowedTools.map(String) : undefined)
        : bot.allowedTools;

    Object.assign(bot, {
      ...patch,
      id: bot.id,
      tools: patch.tools ? { ...bot.tools, ...patch.tools } : bot.tools,
      accessories: Array.isArray(patch.accessories)
        ? patch.accessories.filter(Boolean).slice(0, 8)
        : Array.isArray(bot.accessories)
          ? bot.accessories
          : [],
      executionMode: nextExecutionMode,
      parentBotId: nextParentBotId,
      specialistTag: nextSpecialistTag,
      updatedAt: new Date().toISOString(),
    });
    if ('allowedTools' in patch) {
      if (nextAllowedTools) bot.allowedTools = nextAllowedTools;
      else delete bot.allowedTools;
    }
    this.save();
    return bot;
  }

  deleteBot(id) {
    if (this.state.bots.length <= 1) {
      throw new Error('Cannot delete the last remaining bot');
    }
    const idx = this.state.bots.findIndex(b => b.id === id);
    if (idx < 0) return false;
    this.state.bots.splice(idx, 1);
    this.state.threads = this.state.threads.filter(t => t.botId !== id);
    if (this.state.memories && typeof this.state.memories === 'object') {
      delete this.state.memories[id];
    }
    if (Array.isArray(this.state.runs)) {
      this.state.runs = this.state.runs.filter(r => r.botId !== id);
    }
    if (Array.isArray(this.state.routines)) {
      this.state.routines = this.state.routines.filter(r => r.botId !== id);
    }
    if (this.sandboxesDir) {
      const ws = path.resolve(this.sandboxesDir, String(id));
      const root = path.resolve(this.sandboxesDir);
      if (ws.startsWith(root + path.sep)) {
        fs.rmSync(ws, { recursive: true, force: true });
      }
    }
    this.save();
    return true;
  }

  listThreads(botIdOrOpts = null, userId = null, extraOpts = {}) {
    let botId = botIdOrOpts;
    let resolvedUserId = userId;
    let spaceId = extraOpts?.spaceId || null;
    let includeSubagents = Boolean(extraOpts?.includeSubagents);
    if (botIdOrOpts && typeof botIdOrOpts === 'object') {
      botId = botIdOrOpts.botId || null;
      resolvedUserId = botIdOrOpts.userId ?? userId ?? null;
      spaceId = botIdOrOpts.spaceId || null;
      includeSubagents = Boolean(botIdOrOpts.includeSubagents);
    }
    const scope = resolvedUserId ? resolveUserScope(resolvedUserId) : null;
    const items = this.state.threads.filter(t => {
      if (!includeSubagents && t.isSubagent) return false;
      if (botId && t.botId !== botId) return false;
      if (spaceId && t.spaceId !== spaceId) return false;
      if (scope) {
        const owner = resolveUserScope(t.userId || 'local-owner');
        if (owner !== scope) return false;
      }
      return true;
    });
    return [...items].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  }

  getThread(id, userId = null) {
    const t = this.state.threads.find(x => x.id === id) || null;
    if (!t) return null;
    if (userId && resolveUserScope(t.userId || 'local-owner') !== resolveUserScope(userId)) {
      return null;
    }
    return t;
  }

  #resolveMessageAncestors(thread, leafMessageId = null) {
    const msgs = Array.isArray(thread?.messages) ? thread.messages : [];
    if (!msgs.length) return [];
    const byId = new Map();
    const indexById = new Map();
    msgs.forEach((m, idx) => {
      if (m?.id) {
        byId.set(m.id, m);
        indexById.set(m.id, idx);
      }
    });
    const targetLeafId =
      (leafMessageId && byId.has(leafMessageId) ? leafMessageId : null) ||
      (thread.activeLeafId && byId.has(thread.activeLeafId) ? thread.activeLeafId : null) ||
      msgs[msgs.length - 1]?.id ||
      null;
    if (!targetLeafId) return [...msgs];

    const chain = [];
    const visited = new Set();
    let curId = targetLeafId;
    while (curId && byId.has(curId) && !visited.has(curId)) {
      visited.add(curId);
      const node = byId.get(curId);
      chain.push(node);
      if (node.parentId !== undefined) {
        curId = node.parentId;
      } else {
        const idx = indexById.get(curId);
        curId = idx > 0 ? msgs[idx - 1]?.id || null : null;
      }
    }
    return chain.reverse();
  }

  getActiveMessages(threadId, userId = null) {
    const thread = this.getThread(threadId, userId);
    if (!thread) return [];
    return this.#resolveMessageAncestors(thread, thread.activeLeafId || null);
  }

  createThread({
    botId,
    title,
    executionMode = null,
    userId = 'local-owner',
    spaceId = null,
    isSubagent = false,
    parentThreadId = null,
    parentRunId = null,
  }) {
    const now = new Date().toISOString();
    const thread = {
      id: `thr-${crypto.randomBytes(5).toString('hex')}`,
      botId: botId || this.state.bots[0].id,
      userId: resolveUserScope(userId),
      title: String(title || 'New Chat').trim().slice(0, 80),
      executionMode: normalizeOptionalExecutionMode(executionMode),
      spaceId: normalizeNullableString(spaceId),
      isSubagent: Boolean(isSubagent),
      ...(parentThreadId ? { parentThreadId: String(parentThreadId) } : {}),
      ...(parentRunId ? { parentRunId: String(parentRunId) } : {}),
      activeLeafId: null,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    this.state.threads.unshift(thread);
    this.save();
    return thread;
  }

  updateThread(id, patch = {}) {
    const thread = this.getThread(id);
    if (!thread) return null;
    if ('title' in patch && patch.title !== undefined) {
      thread.title = String(patch.title || 'New Chat').trim().slice(0, 80);
    }
    if ('executionMode' in patch) {
      thread.executionMode = normalizeOptionalExecutionMode(patch.executionMode);
    }
    if ('botId' in patch && patch.botId) {
      const nextBotId = String(patch.botId).trim();
      if (this.getBot(nextBotId)) {
        thread.botId = nextBotId;
      }
    }
    if ('spaceId' in patch) {
      thread.spaceId = normalizeNullableString(patch.spaceId);
    }
    if ('activeLeafId' in patch) {
      const leafId = normalizeNullableString(patch.activeLeafId);
      if (!leafId || thread.messages.some(m => m.id === leafId)) {
        thread.activeLeafId = leafId;
      }
    }
    thread.updatedAt = new Date().toISOString();
    this.save();
    return thread;
  }

  appendMessage(threadId, msg) {
    const t = this.getThread(threadId);
    if (!t) return null;
    const msgId = msg.id || `msg-${crypto.randomBytes(5).toString('hex')}`;
    const hasExplicitParent = 'parentId' in msg && msg.parentId !== undefined;
    const defaultParentId =
      t.activeLeafId && t.messages.some(m => m.id === t.activeLeafId)
        ? t.activeLeafId
        : (t.messages.length ? t.messages[t.messages.length - 1].id : null);
    const entry = {
      id: msgId,
      createdAt: msg.createdAt || new Date().toISOString(),
      parentId: hasExplicitParent ? msg.parentId : defaultParentId,
      ...msg,
    };
    t.messages.push(entry);
    t.activeLeafId = entry.id;
    if (t.title === 'New Chat' && msg.role === 'user' && msg.content) {
      t.title = String(msg.content).trim().replace(/\s+/g, ' ').slice(0, 56);
    }
    t.updatedAt = new Date().toISOString();
    this.save();
    return t;
  }

  forkThread({ threadId, id = null, fromMessageId = null, newUserText = null, userId = null, title = null } = {}) {
    const src = this.getThread(threadId || id, userId);
    if (!src) return null;
    if (fromMessageId && !src.messages.some(m => m.id === fromMessageId)) {
      const err = new Error(`Message not found in thread: ${fromMessageId}`);
      err.status = 404;
      throw err;
    }
    const targetMsgId = fromMessageId || src.activeLeafId || src.messages.at(-1)?.id || null;
    const ancestors = this.#resolveMessageAncestors(src, targetMsgId);
    const cloned = ancestors.map((m, idx) => {
      const copy = JSON.parse(JSON.stringify(m));
      copy.parentId = idx === 0 ? null : ancestors[idx - 1].id;
      return copy;
    });
    const now = new Date().toISOString();
    const forked = {
      id: `thr-${crypto.randomBytes(5).toString('hex')}`,
      botId: src.botId,
      userId: resolveUserScope(userId || src.userId || 'local-owner'),
      title: String(title || `${src.title} (Fork)`).trim().slice(0, 80),
      executionMode: src.executionMode || null,
      spaceId: src.spaceId || null,
      isSubagent: Boolean(src.isSubagent),
      parentThreadId: src.id,
      forkedFromMessageId: targetMsgId,
      activeLeafId: cloned.at(-1)?.id || null,
      createdAt: now,
      updatedAt: now,
      messages: cloned,
    };
    this.state.threads.unshift(forked);
    if (typeof newUserText === 'string' && newUserText.trim()) {
      this.appendMessage(forked.id, { role: 'user', content: newUserText.trim() });
    } else {
      this.save();
    }
    return forked;
  }

  branchEditMessage({ threadId, id = null, messageId, newContent, userId = null } = {}) {
    const thread = this.getThread(threadId || id, userId);
    if (!thread) return null;
    const idx = thread.messages.findIndex(m => m.id === messageId);
    if (idx < 0) return null;

    for (let i = 0; i <= idx; i++) {
      if (thread.messages[i].parentId === undefined) {
        thread.messages[i].parentId = i === 0 ? null : thread.messages[i - 1].id;
      }
    }
    const target = thread.messages[idx];
    const branchGroupId = target.branchGroupId || `bg-${crypto.randomBytes(4).toString('hex')}`;
    target.branchGroupId = branchGroupId;
    const edited = {
      id: `msg-${crypto.randomBytes(5).toString('hex')}`,
      role: target.role || 'user',
      content: String(newContent ?? ''),
      createdAt: new Date().toISOString(),
      parentId: target.parentId ?? null,
      branchGroupId,
      editedFromMessageId: target.id,
    };
    thread.messages.push(edited);
    thread.activeLeafId = edited.id;
    thread.updatedAt = new Date().toISOString();
    this.save();
    return {
      thread,
      editedMessage: edited,
      message: edited,
      branchGroupId,
      activeMessages: this.#resolveMessageAncestors(thread, edited.id),
    };
  }

  switchThreadBranch(threadId, leafMessageId, userId = null) {
    const thread = this.getThread(threadId, userId);
    if (!thread || !thread.messages.some(m => m.id === leafMessageId)) return null;
    thread.activeLeafId = leafMessageId;
    thread.updatedAt = new Date().toISOString();
    this.save();
    return {
      thread,
      activeMessages: this.#resolveMessageAncestors(thread, leafMessageId),
    };
  }

  deleteThread(id) {
    const before = this.state.threads.length;
    this.state.threads = this.state.threads.filter(t => t.id !== id);
    if (this.state.threads.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  getMemories(botId, userId = null, opts = null) {
    const list = this.state.memories[botId] || [];
    const scope = userId ? resolveUserScope(userId) : null;
    const spaceId = opts && typeof opts === 'object' ? normalizeNullableString(opts.spaceId) : null;
    const spaceOnly = Boolean(opts && typeof opts === 'object' && opts.spaceOnly);
    return list.filter(m => {
      if (scope && resolveUserScope(m.userId || 'local-owner') !== scope) return false;
      if (spaceId) {
        if (spaceOnly) return m.spaceId === spaceId;
        return !m.spaceId || m.spaceId === spaceId;
      }
      return true;
    });
  }

  saveMemory(
    botId,
    key,
    value,
    {
      userId = 'local-owner',
      provenance = 'user',
      verified = true,
      confidence = 0.9,
      scope = 'global',
      spaceId = null,
      pinned = false,
      sourceThreadId = null,
    } = {},
  ) {
    const userScope = resolveUserScope(userId);
    const cleanKey = String(key);
    const memScope = scope === 'space' ? 'space' : scope === 'bot' ? 'bot' : 'global';
    const cleanSpaceId = normalizeNullableString(spaceId);
    const list = this.state.memories[botId] || (this.state.memories[botId] = []);
    const now = new Date().toISOString();
    // Respect tombstones unless user explicitly saves an updated value; clear active tombstone for same key
    if (Array.isArray(this.state.memoryTombstones)) {
      this.state.memoryTombstones = this.state.memoryTombstones.filter(
        t => !(t.botId === botId && t.key === cleanKey && resolveUserScope(t.userId || 'local-owner') === userScope),
      );
    }
    const existing = list.find(
      m =>
        m.key === cleanKey &&
        resolveUserScope(m.userId || 'local-owner') === userScope &&
        (cleanSpaceId ? m.spaceId === cleanSpaceId : !m.spaceId),
    );
    if (existing) {
      existing.value = String(value);
      existing.provenance = provenance;
      existing.verified = Boolean(verified);
      existing.confidence = Number(confidence) || 0.9;
      existing.scope = memScope;
      existing.spaceId = cleanSpaceId;
      existing.pinned = Boolean(pinned);
      if (sourceThreadId) existing.sourceThreadId = String(sourceThreadId);
      existing.updatedAt = now;
    } else {
      list.push({
        id: `mem-${crypto.randomBytes(4).toString('hex')}`,
        key: cleanKey,
        value: String(value),
        userId: userScope,
        provenance,
        verified: Boolean(verified),
        confidence: Number(confidence) || 0.9,
        scope: memScope,
        spaceId: cleanSpaceId,
        pinned: Boolean(pinned),
        sourceThreadId: normalizeNullableString(sourceThreadId),
        createdAt: now,
        updatedAt: now,
      });
    }
    this.save();
    return this.getMemories(botId, userId ? userScope : null);
  }

  updateBotMemory({
    botId = '__shared__',
    key,
    value,
    scope = 'global',
    spaceId = null,
    pinned,
    provenance = 'user',
    verified = true,
    confidence = 0.95,
    sourceThreadId = null,
    userId = 'local-owner',
  } = {}) {
    const cleanKey = String(key || '').trim();
    if (!cleanKey) throw new Error('Memory key is required');
    const targetBotId = String(botId || '__shared__');
    const userScope = resolveUserScope(userId);
    const memScope = scope === 'space' ? 'space' : scope === 'bot' ? 'bot' : 'global';
    const cleanSpaceId = memScope === 'space' ? normalizeNullableString(spaceId) : normalizeNullableString(spaceId);
    const list = this.state.memories[targetBotId] || (this.state.memories[targetBotId] = []);
    const now = new Date().toISOString();

    if (Array.isArray(this.state.memoryTombstones)) {
      this.state.memoryTombstones = this.state.memoryTombstones.filter(
        t => !(t.botId === targetBotId && t.key === cleanKey && resolveUserScope(t.userId || 'local-owner') === userScope),
      );
    }

    let existing =
      list.find(
        m =>
          (m.key === cleanKey || m.id === cleanKey) &&
          resolveUserScope(m.userId || 'local-owner') === userScope &&
          (cleanSpaceId ? m.spaceId === cleanSpaceId : true),
      ) || null;

    if (existing) {
      if (value !== undefined) existing.value = String(value);
      existing.scope = memScope;
      existing.spaceId = cleanSpaceId;
      if (pinned !== undefined) existing.pinned = Boolean(pinned);
      existing.provenance = String(provenance || existing.provenance || 'user');
      existing.verified = Boolean(verified);
      existing.confidence = Number(confidence ?? existing.confidence ?? 0.95);
      if (sourceThreadId !== undefined && sourceThreadId !== null) {
        existing.sourceThreadId = normalizeNullableString(sourceThreadId);
      }
      existing.updatedAt = now;
    } else {
      existing = {
        id: `mem-${crypto.randomBytes(4).toString('hex')}`,
        key: cleanKey,
        value: String(value ?? ''),
        userId: userScope,
        scope: memScope,
        spaceId: cleanSpaceId,
        pinned: Boolean(pinned),
        provenance: String(provenance || 'user'),
        verified: Boolean(verified),
        confidence: Number(confidence ?? 0.95),
        sourceThreadId: normalizeNullableString(sourceThreadId),
        createdAt: now,
        updatedAt: now,
      };
      list.push(existing);
    }
    this.save();
    return existing;
  }

  deleteMemory(botId, keyOrId, { userId = null, reason = 'user-deleted' } = {}) {
    const target = String(keyOrId);
    const scope = userId ? resolveUserScope(userId) : null;
    const list = this.state.memories[botId] || [];
    const removed = [];
    this.state.memories[botId] = list.filter(m => {
      const idOrKeyMatch = m.key === target || m.id === target;
      const scopeMatch = !scope || resolveUserScope(m.userId || 'local-owner') === scope;
      if (idOrKeyMatch && scopeMatch) {
        removed.push(m);
        return false;
      }
      return true;
    });
    if (!Array.isArray(this.state.memoryTombstones)) this.state.memoryTombstones = [];
    for (const r of removed) {
      this.state.memoryTombstones.unshift({
        id: r.id,
        botId,
        key: r.key,
        userId: resolveUserScope(r.userId || 'local-owner'),
        reason,
        deletedAt: new Date().toISOString(),
      });
    }
    if (this.state.memoryTombstones.length > 500) this.state.memoryTombstones.length = 500;
    this.save();
    return this.getMemories(botId, userId ? scope : null);
  }

  listTombstones({ botId = null, userId = null } = {}) {
    const scope = userId ? resolveUserScope(userId) : null;
    return (this.state.memoryTombstones || []).filter(t => {
      if (botId && t.botId !== botId) return false;
      if (scope && resolveUserScope(t.userId || 'local-owner') !== scope) return false;
      return true;
    });
  }

  appendReceipt(receipt) {
    if (!receipt || typeof receipt !== 'object') return null;
    if (!Array.isArray(this.state.receipts)) this.state.receipts = [];
    const last = this.state.receipts.length ? this.state.receipts[this.state.receipts.length - 1] : null;
    const prevHash = last?.eventHash || this.state.receiptAnchorHash || '0'.repeat(64);
    const chained = finalizeReceiptHashChain(
      {
        ...receipt,
        id: receipt.id || `rcpt-${crypto.randomBytes(6).toString('hex')}`,
        userId: resolveUserScope(receipt.userId || 'local-owner'),
        createdAt: receipt.createdAt || new Date().toISOString(),
      },
      prevHash,
    );
    this.state.receipts.push(chained);
    if (this.state.receipts.length > 300) {
      const dropped = this.state.receipts.slice(0, this.state.receipts.length - 300);
      this.state.receiptAnchorHash = dropped[dropped.length - 1]?.eventHash || this.state.receiptAnchorHash || '0'.repeat(64);
      this.state.receipts = this.state.receipts.slice(-300);
    }
    this.save();
    return chained;
  }

  listReceipts({ userId = null, threadId = null, runId = null, limit = 50 } = {}) {
    const scope = userId ? resolveUserScope(userId) : null;
    const items = (this.state.receipts || []).filter(r => {
      if (scope && resolveUserScope(r.userId || 'local-owner') !== scope) return false;
      if (threadId && r.threadId !== threadId) return false;
      if (runId && r.runId !== runId) return false;
      return true;
    });
    return [...items].reverse().slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
  }

  getReceipt(id, userId = null) {
    const r = (this.state.receipts || []).find(x => x.id === id || x.runId === id) || null;
    if (!r) return null;
    if (userId && resolveUserScope(r.userId || 'local-owner') !== resolveUserScope(userId)) return null;
    return r;
  }

  verifyReceiptLedger() {
    return verifyReceiptChain(this.state.receipts || [], this.state.receiptAnchorHash || '0'.repeat(64));
  }

  createRun({
    id = null,
    idempotencyKey = null,
    userId = 'local-owner',
    botId = null,
    threadId = null,
    goal = '',
    status = 'PENDING',
    executionMode = 'agent',
    leaseOwner = 'coordinator',
    leaseMs = 120_000,
    metadata = {},
  } = {}) {
    if (!Array.isArray(this.state.runs)) this.state.runs = [];
    const scope = resolveUserScope(userId);
    if (idempotencyKey) {
      const dup = this.state.runs.find(
        r => r.idempotencyKey === String(idempotencyKey) && resolveUserScope(r.userId || 'local-owner') === scope,
      );
      if (dup) return { run: dup, deduplicated: true };
    }
    const now = new Date().toISOString();
    const run = {
      id: id || `run-${crypto.randomBytes(6).toString('hex')}`,
      idempotencyKey: idempotencyKey ? String(idempotencyKey) : null,
      userId: scope,
      botId: botId || this.state.bots[0]?.id || 'bot-grok-default',
      threadId: threadId || null,
      goal: String(goal || '').slice(0, 2000),
      status,
      executionMode,
      leaseOwner,
      leaseExpiresAt: new Date(Date.now() + Math.max(5_000, Number(leaseMs) || 120_000)).toISOString(),
      heartbeatAt: now,
      checkpoints: [{ state: status, ts: now }],
      receiptId: null,
      error: null,
      metadata,
      createdAt: now,
      updatedAt: now,
    };
    this.state.runs.unshift(run);
    if (this.state.runs.length > 250) this.state.runs.length = 250;
    this.save();
    return { run, deduplicated: false };
  }

  updateRun(id, patch = {}) {
    if (!Array.isArray(this.state.runs)) this.state.runs = [];
    const run = this.state.runs.find(r => r.id === id);
    if (!run) return null;
    const now = new Date().toISOString();
    if (patch.status && patch.status !== run.status) {
      run.checkpoints = Array.isArray(run.checkpoints) ? run.checkpoints : [];
      run.checkpoints.push({ state: patch.status, ts: now, note: patch.note || null });
    }
    const nextStatus = patch.status || run.status;
    const leaseRenew = ['CLAIMED', 'RUNNING', 'VERIFYING'].includes(nextStatus) && !patch.leaseExpiresAt
      ? { leaseExpiresAt: new Date(Date.now() + 120_000).toISOString() }
      : {};
    Object.assign(run, { ...patch, ...leaseRenew, updatedAt: now, heartbeatAt: patch.heartbeatAt || now });
    delete run.note;
    this.save();
    return run;
  }

  getRun(id, userId = null) {
    const r = (this.state.runs || []).find(x => x.id === id) || null;
    if (!r) return null;
    if (userId && resolveUserScope(r.userId || 'local-owner') !== resolveUserScope(userId)) return null;
    return r;
  }

  listRuns({ userId = null, status = null, limit = 50 } = {}) {
    const scope = userId ? resolveUserScope(userId) : null;
    return (this.state.runs || [])
      .filter(r => {
        if (scope && resolveUserScope(r.userId || 'local-owner') !== scope) return false;
        if (status && r.status !== status) return false;
        return true;
      })
      .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)));
  }

  reclaimStaleRuns(nowMs = Date.now()) {
    let reclaimed = 0;
    const nowIso = new Date(nowMs).toISOString();
    for (const run of this.state.runs || []) {
      if (['CLAIMED', 'RUNNING', 'VERIFYING'].includes(run.status)) {
        const exp = Date.parse(run.leaseExpiresAt || '');
        if (Number.isFinite(exp) && exp < nowMs) {
          run.status = 'FAILED';
          run.error = 'Lease expired before completion (recovered on restart)';
          run.updatedAt = nowIso;
          run.checkpoints = [...(run.checkpoints || []), { state: 'FAILED', ts: nowIso, note: 'lease-reclaimed' }];
          reclaimed++;
        }
      }
    }
    if (reclaimed > 0) this.save();
    return reclaimed;
  }

  #normalizeSpace(s) {
    if (!s || typeof s !== 'object') return s;
    return {
      ...s,
      systemPrompt: typeof s.systemPrompt === 'string' ? s.systemPrompt : '',
      attachedPaths: Array.isArray(s.attachedPaths) ? s.attachedPaths.map(p => String(p).trim()).filter(Boolean).slice(0, 50) : [],
      defaultBotId: normalizeNullableString(s.defaultBotId),
      memoryScope: s.memoryScope === 'global' ? 'global' : 'space',
    };
  }

  listSpaces(userId = 'local-owner') {
    if (!Array.isArray(this.state.spaces)) {
      this.state.spaces = [
        {
          id: 'space-research',
          title: 'Research Briefs',
          surface: 'research',
          icon: 'search',
          pinned: true,
          filter: 'research',
          systemPrompt: '',
          attachedPaths: [],
          defaultBotId: null,
          memoryScope: 'space',
          createdAt: new Date().toISOString(),
        },
        {
          id: 'space-code',
          title: 'Build Workbench',
          surface: 'code',
          icon: 'code',
          pinned: true,
          filter: 'code',
          systemPrompt: '',
          attachedPaths: [],
          defaultBotId: null,
          memoryScope: 'space',
          createdAt: new Date().toISOString(),
        },
      ];
    }
    const scope = resolveUserScope(userId);
    return this.state.spaces
      .filter(s => !s.userId || resolveUserScope(s.userId) === scope)
      .map(s => this.#normalizeSpace(s));
  }

  getSpace(id, userId = null) {
    if (!id) return null;
    if (!Array.isArray(this.state.spaces)) this.listSpaces(userId || 'local-owner');
    const scope = userId ? resolveUserScope(userId) : null;
    const found = this.state.spaces.find(
      s => s.id === id && (!scope || !s.userId || resolveUserScope(s.userId) === scope),
    );
    return found ? this.#normalizeSpace(found) : null;
  }

  createSpace({
    title,
    surface = 'chat',
    icon = 'layers',
    description = '',
    pinned = true,
    userId = 'local-owner',
    systemPrompt = '',
    attachedPaths = [],
    defaultBotId = null,
    memoryScope = 'space',
  } = {}) {
    if (!Array.isArray(this.state.spaces)) this.listSpaces(userId);
    const now = new Date().toISOString();
    const space = this.#normalizeSpace({
      id: `space-${crypto.randomBytes(4).toString('hex')}`,
      userId: resolveUserScope(userId),
      title: String(title || 'Custom Space').trim().slice(0, 48),
      surface: String(surface || 'chat').trim().toLowerCase(),
      icon: String(icon || 'layers').trim(),
      description: String(description || '').trim().slice(0, 160),
      pinned: Boolean(pinned),
      systemPrompt: String(systemPrompt || '').slice(0, 4000),
      attachedPaths: Array.isArray(attachedPaths) ? attachedPaths.map(p => String(p).trim()).filter(Boolean).slice(0, 50) : [],
      defaultBotId: normalizeNullableString(defaultBotId),
      memoryScope: memoryScope === 'global' ? 'global' : 'space',
      createdAt: now,
      updatedAt: now,
    });
    this.state.spaces.push(space);
    this.save();
    return space;
  }

  updateSpace(id, patch = {}, userId = 'local-owner') {
    if (!Array.isArray(this.state.spaces)) this.listSpaces(userId);
    const scope = userId ? resolveUserScope(userId) : null;
    const idx = this.state.spaces.findIndex(
      s => s.id === id && (!scope || !s.userId || resolveUserScope(s.userId) === scope),
    );
    if (idx < 0) return null;
    const cur = this.#normalizeSpace(this.state.spaces[idx]);
    const next = { ...cur };
    if ('title' in patch && patch.title !== undefined) {
      next.title = String(patch.title || cur.title || 'Custom Space').trim().slice(0, 48);
    }
    if ('surface' in patch && patch.surface !== undefined) {
      next.surface = String(patch.surface || 'chat').trim().toLowerCase();
    }
    if ('icon' in patch && patch.icon !== undefined) {
      next.icon = String(patch.icon || 'layers').trim();
    }
    if ('description' in patch && patch.description !== undefined) {
      next.description = String(patch.description || '').trim().slice(0, 160);
    }
    if ('pinned' in patch && patch.pinned !== undefined) {
      next.pinned = Boolean(patch.pinned);
    }
    if ('systemPrompt' in patch && patch.systemPrompt !== undefined) {
      next.systemPrompt = String(patch.systemPrompt || '').slice(0, 4000);
    }
    if ('attachedPaths' in patch && patch.attachedPaths !== undefined) {
      next.attachedPaths = Array.isArray(patch.attachedPaths)
        ? patch.attachedPaths.map(p => String(p).trim()).filter(Boolean).slice(0, 50)
        : [];
    }
    if ('defaultBotId' in patch) {
      next.defaultBotId = normalizeNullableString(patch.defaultBotId);
    }
    if ('memoryScope' in patch && patch.memoryScope !== undefined) {
      next.memoryScope = patch.memoryScope === 'global' ? 'global' : 'space';
    }
    next.updatedAt = new Date().toISOString();
    this.state.spaces[idx] = next;
    this.save();
    return next;
  }

  deleteSpace(id, userId = 'local-owner') {
    if (!Array.isArray(this.state.spaces)) return false;
    const scope = resolveUserScope(userId);
    const before = this.state.spaces.length;
    this.state.spaces = this.state.spaces.filter(s => !(s.id === id && (!s.userId || resolveUserScope(s.userId) === scope)));
    if (this.state.spaces.length !== before) {
      this.save();
      return true;
    }
    return false;
  }

  toggleUiChecklistItem(itemId, checked = null) {
    if (!this.state.uiChecklists || typeof this.state.uiChecklists !== 'object') {
      this.state.uiChecklists = {};
    }
    const next = checked === null ? !this.state.uiChecklists[itemId] : Boolean(checked);
    this.state.uiChecklists[itemId] = next;
    this.save();
    return { itemId, checked: next };
  }

  getUiChecklists() {
    return this.state.uiChecklists && typeof this.state.uiChecklists === 'object' ? this.state.uiChecklists : {};
  }
}
