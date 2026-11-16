import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  AppStore,
  resolveDataDir,
  resolveUserScope,
  BOT_SHAPES,
  BOT_COLORS,
  CHIEF_OF_STAFF_TEAM_PRESET,
  WORKSPACE_SUBDIRS,
  VOLATILE_PATHS_CONTRAST,
} from './store.mjs';
import { VaultManager } from './vault.mjs';
import { McpManager } from './mcp-manager.mjs';
import { LocalExecEngine, REVERSIBILITY_MATRIX, resolveSafePath } from './local-exec.mjs';
import { AgentRunner } from './agent-runner.mjs';
import { RoutineManager } from './routines.mjs';
import { ProactiveEngine } from './proactive.mjs';
import { WORKFLOW_TEMPLATES, WorkflowEngine, makeModelPlanner } from './workflows.mjs';
import { runPreflight } from './preflight.mjs';
import { envVar } from './env.mjs';
import { CLOUD_PROVIDERS, discoverLocalServers, isLoopbackUrl, testModelCapabilities } from './model-setup.mjs';
import { McpOAuthManager } from './mcp-http.mjs';
import { ModelLibrary, OpenRouterAuth } from './model-library.mjs';
import { systemUsage } from './system-usage.mjs';
import { VERSION } from './version.mjs';
import { SHARED_MEMORY_SCOPE } from './context-recall.mjs';
import { assertSafeUrl, probeModels, RESPONSE_MODES } from './llm-provider.mjs';
import { RustCoreBridge } from './rust-bridge.mjs';
import { ArtifactFoundry } from './foundry.mjs';
import { hardenBrowserManager } from './browser-guard.mjs';
import { renderBrowserLabHtml, runBrowserAgentSuite } from './browser-agent-suite.mjs';
import { runDesktopAction } from './desktop-control.mjs';
import { VoiceEngine, evaluateVoiceTurn } from './voice.mjs';
import {
  AgiHarness,
  AGI_COMMANDS,
  MODEL_TIERS,
  HARDWARE_PROFILE,
  MIMIR_DIALOGUE_PROFILES,
} from './agi-harness.mjs';
import { DagSwarmEngine, SWARM_RECIPES } from './dag-swarm.mjs';
import { ConnectorHub } from './connectors.mjs';
import { buildMidgardProjectMap, buildMemoryAtlas } from './project-map.mjs';
import { buildRepositoryKnowledgeGraph, findGraphNeighborhood } from './code-understanding.mjs';
import { DeepResearchEngine, RESEARCH_TOPIC_PACKS } from './deep-research.mjs';
import { runEvalSuite } from './eval-runner.mjs';
import { runChatTurn } from './llm-provider.mjs';
import { RagEngine } from './rag-engine.mjs';
import { ModelCouncilEngine } from './model-council.mjs';
import { MimriPlatformEngine } from './mimri-platform.mjs';
import {
  SCHEMA_VERSION,
  TASK_LIFECYCLE_STATES,
  UI_STATUS_VOCABULARY,
  CONTROL_PLANE_POLICY,
  CONTRACT_SCHEMAS,
  CONTRACT_NAMES,
  validateContract,
  detectHardwareCapabilities,
} from './contracts.mjs';
import { SentinelPolicyService } from './sentinel.mjs';
import {
  NORSE_AGENT_REGISTRY,
  validateNorseRegistry,
  getNorseRegistryWithLiveState,
  selectNorseRoleForTask,
  seedNorseRosterIntoStore,
} from './norse-agents.mjs';
import { planUiSpecification, validateUiSpec } from './intelligent-ui.mjs';
import {
  scanLocalAiMemories,
  parseImportedContent,
  analyzeWorkAndProposeBot,
  synthesizeBotFromAnswers,
} from './memory-importer.mjs';

const TEAM_BOT_TEMPLATES = [
  {
    key: 'chief-klaus',
    name: CHIEF_OF_STAFF_TEAM_PRESET.chief.name,
    role: CHIEF_OF_STAFF_TEAM_PRESET.chief.role,
    shape: CHIEF_OF_STAFF_TEAM_PRESET.chief.shape,
    color: CHIEF_OF_STAFF_TEAM_PRESET.chief.color,
    tools: CHIEF_OF_STAFF_TEAM_PRESET.chief.tools,
    systemPrompt: CHIEF_OF_STAFF_TEAM_PRESET.chief.systemPrompt,
  },
  ...CHIEF_OF_STAFF_TEAM_PRESET.specialists.map(sp => ({
    key: sp.id,
    name: sp.name,
    role: sp.role,
    shape: sp.shape,
    color: sp.color,
    tools: sp.tools,
    systemPrompt: sp.systemPrompt,
  })),
  {
    key: 'research-analyst',
    name: 'Research Analyst',
    role: 'Team Bot • Web & Brief Synthesis',
    shape: 'crystal',
    color: '#10a693',
    tools: { shell: false, fs: true, browser: true, memory: true, vault: false },
    systemPrompt: 'Investigate topics using browser_open, take grounded notes with fs_write, and save durable facts in memory.',
  },
  {
    key: 'ops-engineer',
    name: 'Local Ops Engineer',
    role: 'Team Bot • Shell & Diagnostics',
    shape: 'shield',
    color: '#10ab61',
    tools: { shell: true, fs: true, browser: false, memory: true, vault: true },
    systemPrompt: 'Run local diagnostics cleanly with shell_exec, inspect workspace files, and summarize verified findings.',
  },
  {
    key: 'qa-verifier',
    name: 'QA Verifier',
    role: 'Team Bot • UI & Contract Testing',
    shape: 'gem',
    color: '#8351e4',
    tools: { shell: true, fs: true, browser: true, memory: false, vault: false },
    systemPrompt: 'Test local web apps and endpoints end-to-end with browser_open/browser_action and report exact observed pass/fail checks.',
  },
  {
    key: 'release-notifier',
    name: 'Release Notifier',
    role: 'Team Bot • Routines & Webhooks',
    shape: 'star',
    color: '#da830e',
    tools: { shell: true, fs: true, browser: false, memory: true, vault: false },
    systemPrompt: 'Compile concise release notes and routine status summaries for Slack and Teams channels.',
  },
];

const WORKSPACE_FILE_MIME_MAP = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.markdown': 'text/markdown; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.cjs': 'text/javascript; charset=utf-8',
  '.jsx': 'text/jsx; charset=utf-8',
  '.ts': 'text/typescript; charset=utf-8',
  '.tsx': 'text/tsx; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.py': 'text/x-python; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.yaml': 'text/yaml; charset=utf-8',
  '.yml': 'text/yaml; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};

function resolveBotWorkspaceFile(store, botId, rawPath) {
  const rel = String(rawPath || '').trim();
  if (!rel || rel === '.') {
    throw Object.assign(new Error('path must point to a file inside the bot workspace'), { status: 400 });
  }
  const wsDir = store.getBotWorkspace(botId);
  fs.mkdirSync(wsDir, { recursive: true });
  let absPath;
  try {
    absPath = resolveSafePath(wsDir, rel);
  } catch (err) {
    throw Object.assign(new Error(err.message), { status: 403 });
  }
  const baseAbs = path.resolve(wsDir);
  if (absPath === baseAbs) {
    throw Object.assign(new Error('path must point to a file inside the bot workspace'), { status: 400 });
  }
  const normalizedRel = path.relative(baseAbs, absPath).replace(/\\/g, '/');
  return { wsDir: baseAbs, absPath, relPath: normalizedRel };
}

function resolveActiveBranchMessages(thread) {
  const msgs = Array.isArray(thread?.messages) ? thread.messages : [];
  if (!msgs.length) return [];
  if (!thread?.activeLeafId) return msgs;
  const byId = new Map(msgs.map(m => [m.id, m]));
  if (!byId.has(thread.activeLeafId)) return msgs;
  const chain = [];
  const seen = new Set();
  let cur = byId.get(thread.activeLeafId);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return chain.reverse();
}

function computeLineDiffSummary(beforeText, afterText) {
  const a = String(beforeText || '').split(/\r?\n/);
  const b = String(afterText || '').split(/\r?\n/);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let aEnd = a.length - 1;
  let bEnd = b.length - 1;
  while (aEnd >= prefix && bEnd >= prefix && a[aEnd] === b[bEnd]) {
    aEnd -= 1;
    bEnd -= 1;
  }
  const removed = Math.max(0, aEnd - prefix + 1);
  const added = Math.max(0, bEnd - prefix + 1);
  const hunks = removed === 0 && added === 0
    ? []
    : [{
        startLine: prefix + 1,
        removedLines: a.slice(prefix, aEnd + 1),
        addedLines: b.slice(prefix, bEnd + 1),
      }];
  const diffSummary = removed === 0 && added === 0
    ? 'No changes'
    : `Changed lines starting at L${prefix + 1} (+${added} / -${removed})`;
  return { diffSummary, hunks };
}

function parseCanvasEditResponse(rawText, originalContent) {
  const text = String(rawText || '').trim();
  if (!text) return { updatedContent: originalContent, diffSummary: 'No changes returned' };
  const tryJson = candidate => {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed.updatedContent === 'string') {
        return {
          updatedContent: parsed.updatedContent,
          diffSummary: typeof parsed.diffSummary === 'string' ? parsed.diffSummary.trim() : '',
        };
      }
    } catch {}
    return null;
  };
  const direct = tryJson(text);
  if (direct) return direct;
  const jsonFence = text.match(/```json\s*([\s\S]*?)```/i);
  if (jsonFence) {
    const fromFence = tryJson(jsonFence[1].trim());
    if (fromFence) return fromFence;
  }
  const codeFence = text.match(/```[a-zA-Z0-9_-]*\s*\n([\s\S]*?)```/);
  if (codeFence) {
    return { updatedContent: codeFence[1].replace(/\n$/, ''), diffSummary: '' };
  }
  return { updatedContent: text, diffSummary: '' };
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const ch of req) {
    total += ch.length;
    if (total > 8 * 1024 * 1024) throw new Error('Request body too large');
    chunks.push(ch);
  }
  const text = Buffer.concat(chunks).toString('utf8').trim();
  return text ? JSON.parse(text) : {};
}

const DEFAULT_WEB_ORIGINS = new Set([
  'https://mimir-site-dusky.vercel.app',
]);

function buildOriginChecker(extraOrigins = []) {
  const envOrigins = String(envVar('ALLOWED_ORIGINS') || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  const allowedSet = new Set([...DEFAULT_WEB_ORIGINS, ...envOrigins, ...extraOrigins]);
  return function isAllowedOrigin(origin) {
    if (origin === undefined || origin === null || origin === '') return true;
    if (origin === 'null') return false;
    if (origin === 'file://') return true;
    if (origin.startsWith('file://')) return false;
    if (/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i.test(origin)) return true;
    return allowedSet.has(origin);
  };
}

export async function startCoordinator(options = {}) {
  const dataDir = options.dataDir || resolveDataDir();
  const token = options.token ?? envVar('TOKEN') ?? '';
  const port = Number(options.port ?? envVar('PORT') ?? 0);
  const isAllowedOrigin = buildOriginChecker(options.allowedOrigins || []);
  const pairingCodeTtlMs = Number(options.pairingCodeTtlMs ?? 5 * 60_000);
  const pairingSessionTtlMs = Number(options.pairingSessionTtlMs ?? 8 * 3600_000);
  const pairingRequests = new Map();
  const pairingSessions = new Map();
  const retiredSessions = new Set();
  const wsTickets = new Map();
  let pairingExchangeFailures = 0;

  const pruneWsTickets = () => {
    const now = Date.now();
    for (const [k, v] of wsTickets) {
      if (now >= v.expiresAt) wsTickets.delete(k);
    }
  };

  const makePairingCode = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = crypto.randomBytes(6);
    let out = '';
    for (let i = 0; i < 6; i++) out += alphabet[bytes[i] % alphabet.length];
    return out;
  };

  const prunePairingState = () => {
    const now = Date.now();
    for (const [id, req] of pairingRequests) {
      if (now >= req.expiresAt || req.used) pairingRequests.delete(id);
    }
    for (const [tok, sess] of pairingSessions) {
      if (now >= sess.expiresAt) {
        pairingSessions.delete(tok);
        retiredSessions.add(tok);
      }
    }
  };

  const verifyBearer = presented => {
    prunePairingState();
    const raw = String(presented || '').trim();
    if (!raw) {
      if (!token && !options.requirePairingSession) return { ok: true, mode: 'local-open' };
      return { ok: false, code: 'PAIRING_REQUIRED', error: 'Authorization or local runtime pairing required.' };
    }
    if (token && raw === token) return { ok: true, mode: 'master' };
    const sess = pairingSessions.get(raw);
    if (sess && Date.now() < sess.expiresAt) {
      return { ok: true, mode: 'session', session: sess };
    }
    if (retiredSessions.has(raw) || raw.startsWith('mimir_sess_')) {
      return { ok: false, code: 'SESSION_EXPIRED', error: 'Pairing session expired or revoked. Re-pair your local runtime.' };
    }
    if (!token && !options.requirePairingSession) return { ok: true, mode: 'local-open' };
    return { ok: false, code: 'UNAUTHORIZED', error: 'Unauthorized: invalid token or pairing session.' };
  };

  const store = new AppStore(dataDir);
  const vault = new VaultManager(dataDir, options.vaultPassphrase || null);
  const mcpManager = new McpManager(store);

  // Model API keys live in the encrypted vault; settings only hold a reference label.
  store.secretResolver = label => vault.resolveSecret(label)?.fields?.value || '';
  store.secretWriter = (label, value) => {
    const old = vault.resolveSecret(label);
    if (old) vault.deleteEntry(old.id);
    vault.addEntry({ kind: 'secret', label, fields: { value } });
    return label;
  };
  if (store.state.settings?.openaiApiKey && !store.state.settings.openaiApiKeyRef) {
    store.updateSettings({ openaiApiKey: store.state.settings.openaiApiKey }); // moves a pre-vault plaintext key into the vault
  }

  const modelLibrary = new ModelLibrary({
    getSettings: () => store.getSettings(),
    updateSettings: patch => store.updateSettings(patch),
    broadcast: (event, data) => broadcast(event, data), // defined further down; resolved at call time
  });
  const openRouter = new OpenRouterAuth({ baseUrl: options.openRouterBaseUrl });
  // Tiers follow whatever is installed on this machine; never blocks startup.
  modelLibrary.refreshTiers().catch(() => {});

  // MCP OAuth tokens: one vault entry per server, JSON in the value field.
  let publicUrl = null; // set once the server is listening; needed for the loopback redirect URI
  mcpManager.oauth = new McpOAuthManager({
    redirectUri: () => `${publicUrl}/v1/mcp/oauth/callback`,
    tokenStore: {
      load: id => {
        const raw = vault.resolveSecret(`MCP_OAUTH:${id}`)?.fields?.value;
        try {
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      },
      save: (id, record) => store.secretWriter(`MCP_OAUTH:${id}`, JSON.stringify(record)),
      remove: id => {
        const old = vault.resolveSecret(`MCP_OAUTH:${id}`);
        if (old) vault.deleteEntry(old.id);
      },
    },
  });

  /** Validate a wizard target: a known kind, an http(s) URL and a model name. */
  const resolveModelTarget = body => {
    const preset = CLOUD_PROVIDERS.find(p => p.id === body.providerId);
    const kind = body.kind === 'ollama' ? 'ollama' : 'openai-compat';
    const baseUrl = String(preset?.baseUrl || body.baseUrl || '').trim();
    const model = String(body.model || '').trim();
    if (!/^https?:\/\//i.test(baseUrl)) throw Object.assign(new Error('baseUrl must start with http:// or https://'), { status: 400 });
    if (!model) throw Object.assign(new Error('model is required'), { status: 400 });
    const sNow = store.getSettings();
    let apiKey = String(body.apiKey || '');
    if (!apiKey && body.useSavedKey && sNow.openaiApiKey && sNow.openaiBaseUrl) {
      try {
        if (new URL(baseUrl).origin === new URL(sNow.openaiBaseUrl).origin) {
          apiKey = sNow.openaiApiKey;
        }
      } catch {}
    }
    return { kind, baseUrl, model, apiKey };
  };

  const wsClients = new Set();
  const broadcast = (event, data) => {
    const packet = JSON.stringify({ event, data, ts: Date.now() });
    for (const ws of wsClients) {
      if (ws.readyState === 1 && ws.bufferedAmount < 4 * 1024 * 1024) ws.send(packet);
    }
  };

  const { KnowledgeBase, RsiPipeline } = await import('./knowledge-rsi.mjs');
  const { ScaleQueueManager, runMultiUserLoadBenchmark } = await import('./scale-queue.mjs');
  const knowledge = new KnowledgeBase(dataDir);
  const sInit = store.getSettings();
  const ragEngine =
    options.ragEngine ||
    knowledge.rag ||
    (RagEngine ? new RagEngine({ knowledgeBase: knowledge, knowledgeDir: knowledge.dir || path.join(dataDir, 'rsi') }) : null);
  const modelCouncil =
    options.modelCouncil ||
    (ModelCouncilEngine
      ? new ModelCouncilEngine({
          store,
          settingsGet: () => store.getSettings(),
          botsList: () => store.listBots(),
          ollamaBaseUrl: sInit.ollamaUrl,
          onEvent: broadcast,
          dataDir,
        })
      : null);

  const sentinel = new SentinelPolicyService({
    dataDir,
    onAuditEvent: ev => broadcast('sentinel:audit', ev),
  });
  const localExec = new LocalExecEngine({ store, vault, mcpManager, onEvent: broadcast });
  const runner = new AgentRunner({
    store,
    vault,
    mcpManager,
    localExec,
    knowledge,
    ragEngine,
    modelCouncil,
    sentinel,
    coordinatorUrl: () => publicUrl,
    broadcast,
  });
  const routines = new RoutineManager({
    store,
    runPromptFn: ({ botId, userText, title }) => runner.runTurn({ botId, userText, title }),
    broadcast,
  });
  const workflows = new WorkflowEngine({
    store,
    dataDir,
    runTurn: opts => runner.runTurn(opts),
    routines,
    broadcast: (event, data) => broadcast(event, data),
  });
  // A scheduled retry picks up a recently failed run at the step that failed.
  routines.runWorkflowFn = id => {
    const lastFailed = workflows.listRuns(id).find(r => r.status === 'failed' && Date.now() - Date.parse(r.startedAt) < 6 * 3600_000);
    return workflows.run(id, { resumeRunId: lastFailed?.id || null });
  };
  const planWorkflow = makeModelPlanner({ runChatFn: runChatTurn, getSettings: () => store.getSettings() });

  const rsi = new RsiPipeline(dataDir, store, knowledge, { ragEngine, modelCouncil });
  rsi.ragEngine = ragEngine;
  rsi.modelCouncil = modelCouncil;
  const scaleQueue = new ScaleQueueManager({
    maxConcurrent: sInit.maxConcurrentTasks || 3,
    rateLimitPerMinute: sInit.rateLimitPerMinute || 40,
  });
  const rustToken = token || crypto.randomBytes(16).toString('hex');
  const rustBridge = new RustCoreBridge({
    dataDir,
    token: rustToken,
    maxQueueDepth: sInit.maxQueueDepth || 256,
  });
  if (options.enableRust !== false) {
    await rustBridge.start().catch(() => {});
  }
  const foundry = new ArtifactFoundry({ dataDir, rustBridge, store, runChatFn: runChatTurn });
  store.reclaimStaleRuns?.();
  const deepResearch = new DeepResearchEngine({ store, knowledge, ragEngine, foundry });
  hardenBrowserManager(localExec.browser, { store, broadcast, rustBridge });
  const voiceEngine = options.voiceEngine || new VoiceEngine({ dataDir });
  const agiHarness = new AgiHarness({ dataDir, store, knowledge, rsi, foundry, scaleQueue });
  const dagSwarm = new DagSwarmEngine({ dataDir, store, agiHarness, knowledge, rustBridge, broadcast });
  const connectors = new ConnectorHub({ dataDir, store, vault });
  const mimriPlatform = new MimriPlatformEngine({ dataDir: path.join(dataDir, 'mimri-state'), store, knowledge });

  localExec.knowledge = knowledge;
  localExec.scaleQueue = scaleQueue;
  localExec.rustBridge = rustBridge;
  localExec.foundry = foundry;
  runner.rsi = rsi;
  runner.knowledge = knowledge;
  runner.ragEngine = ragEngine;
  runner.modelCouncil = modelCouncil;
  runner.scaleQueue = scaleQueue;
  runner.rustBridge = rustBridge;
  runner.foundry = foundry;
  runner.agiHarness = agiHarness;
  runner.dagSwarm = dagSwarm;
  runner.deepResearch = deepResearch;

  const proactive = new ProactiveEngine({
    store,
    routines,
    broadcast,
    rustBridge,
    getPendingApprovals: () => runner.listPendingApprovals(),
  });
  if (options.enableScheduler !== false) proactive.start();

  // One kill-switch path for the HTTP route and the chat `/kill` command.
  const pullKillSwitch = async source => {
    const runsKilled = runner.killAllRuns();
    proactive.pause(`kill switch (${source})`); // otherwise the scheduler would restart work seconds later
    await localExec.browser.abortAllSessions?.();
    broadcast('kill-switch:activated', { runsKilled, ts: Date.now() });
    return { ok: true, runsKilled, browserClosed: true };
  };
  const redactValue = val => {
    if (typeof val === 'string') return vault.redactText(val);
    if (Array.isArray(val)) return val.map(v => redactValue(v));
    if (val && typeof val === 'object' && !Buffer.isBuffer(val)) {
      const out = {};
      for (const [k, v] of Object.entries(val)) {
        out[k] = redactValue(v);
      }
      return out;
    }
    return val;
  };

  runner.commandHooks = {
    killSwitch: pullKillSwitch,
    projectMap: () => buildMidgardProjectMap({ store, foundry }),
    evalSuite: async () => {
      const report = await runEvalSuite({ ollamaUrl: store.getSettings().ollamaUrl });
      fs.writeFileSync(path.join(dataDir, 'latest-eval.json'), JSON.stringify(report, null, 2), 'utf8');
      return report;
    },
    speak: text => voiceEngine.synthesize({ text, localOnly: Boolean(store.getSettings().localOnly) }),
  };

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (!isAllowedOrigin(origin)) {
      return json(res, 403, { error: 'Origin rejected' });
    }
    if (origin && origin !== 'null') {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Mimir-User, X-User-Id');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Vary', 'Origin');
    }
    if (req.headers['access-control-request-private-network'] === 'true') {
      res.setHeader('Access-Control-Allow-Private-Network', 'true');
    }
    const userId = resolveUserScope(req);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    let urlObj;
    try {
      urlObj = new URL(req.url, 'http://127.0.0.1');
    } catch {
      return json(res, 400, { error: 'Invalid request URL' });
    }
    const p = urlObj.pathname;

    // Inbound hooks use their own webhook token path, skipping bearer token header
    if (req.method === 'POST' && p.startsWith('/v1/hooks/')) {
      try {
        const hookTok = decodeURIComponent(p.slice('/v1/hooks/'.length));
        const bot = store.listBots().find(b => b.webhookToken === hookTok);
        if (!bot) return json(res, 404, { error: 'Unknown webhook token' });
        const body = await readBody(req);
        const prompt = String(body.prompt || body.text || JSON.stringify(body)).trim();
        const result = await runner.runTurn({ botId: bot.id, userText: prompt, title: `Webhook: ${bot.name}` });
        return json(res, 200, { ok: true, botId: bot.id, ...result });
      } catch (err) {
        return json(res, 500, { error: err.message });
      }
    }

    // OAuth redirect from the user's browser. It cannot carry Mimir's bearer token; the one-time,
    // short-lived `state` value created by startOAuth is what authorizes this request.
    if (req.method === 'GET' && p === '/v1/mcp/oauth/callback') {
      const page = (title, body, status) => {
        const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
        res.end(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:16px system-ui;background:#081019;color:#e5edf4;padding:48px"><h1 style="color:#e6ab42">${esc(title)}</h1><p>${esc(body)}</p></body>`);
      };
      try {
        const q = urlObj.searchParams;
        const out = await mcpManager.completeOAuth({ state: q.get('state'), code: q.get('code'), error: q.get('error') });
        broadcast('mcp:updated', { serverId: out.serverId, status: out.status });
        return page('Connected to Mimir', `Sign-in finished (${out.status}). You can close this tab.`, 200);
      } catch (err) {
        return page('Sign-in did not finish', err.message, err.status || 500);
      }
    }

    // OpenRouter sign-in redirect. Like the MCP callback, it is authorized by its one-time state.
    if (req.method === 'GET' && p === '/v1/models/openrouter/callback') {
      const html = (title, body, status) => {
        const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
        res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
        res.end(`<!doctype html><meta charset="utf-8"><title>${esc(title)}</title><body style="font:16px system-ui;background:#081019;color:#e5edf4;padding:48px"><h1 style="color:#e6ab42">${esc(title)}</h1><p>${esc(body)}</p></body>`);
      };
      try {
        if (store.getSettings().localOnly) throw Object.assign(new Error('Local-only mode is on.'), { status: 403 });
        const key = await openRouter.complete({ state: urlObj.searchParams.get('state'), code: urlObj.searchParams.get('code') });
        // Start on a free, tool-capable model so signing in never costs money by itself.
        const models = await openRouter.listModels().catch(() => []);
        const starter = models.find(m => m.free && m.tools) || models.find(m => m.free) || null;
        store.updateSettings({
          provider: 'openai-compat',
          openaiBaseUrl: openRouter.apiBase,
          openaiApiKey: key,
          ...(starter ? { openaiModel: starter.id } : {}),
          openRouterSignedIn: true,
          modelSetupDone: true,
        });
        broadcast('settings:updated', { reason: 'openrouter-connected' });
        return html('Connected to Mimir', starter ? `Signed in. Mimir will start with the free model ${starter.id}. You can close this tab.` : 'Signed in. Pick a model in Mimir. You can close this tab.', 200);
      } catch (err) {
        return html('Sign-in did not finish', err.message, err.status || 500);
      }
    }

    if (req.method === 'GET' && (p === '/health' || p === '/v1/health')) {
      return json(res, 200, {
        ok: true,
        service: 'mimir-coordinator',
        version: VERSION,
        authRequired: Boolean(token || options.requirePairingSession),
        pairingSupported: true,
        provider: store.getSettings().provider,
        ollamaModel: store.getSettings().ollamaModel,
      });
    }

    // Explicit user-initiated pairing handshake: creates a one-time code displayed ONLY on the local
    // coordinator stdout / local desktop client, never returned in the HTTP response body.
    if (req.method === 'POST' && p === '/v1/pairing/request') {
      prunePairingState();
      if (pairingRequests.size >= 8) {
        return json(res, 429, { error: 'Too many active pairing requests. Wait a minute and retry.', code: 'PAIRING_RATE_LIMIT' });
      }
      const body = await readBody(req).catch(() => ({}));
      const requestId = `pair_${crypto.randomBytes(6).toString('hex')}`;
      const code = makePairingCode();
      const clientName = String(body.clientName || 'Mimir Web Workspace').slice(0, 64);
      const expiresAt = Date.now() + pairingCodeTtlMs;
      const entry = { id: requestId, code, clientName, origin: origin || 'local', createdAt: Date.now(), expiresAt, attempts: 0, used: false };
      pairingRequests.set(requestId, entry);
      if (options.logPairing !== false) {
        console.log(`[mimir] Pairing code for "${clientName}" (${entry.origin}): ${code} (expires in ${Math.round(pairingCodeTtlMs / 1000)}s)`);
      }
      broadcast('pairing:requested', { id: requestId, clientName, origin: entry.origin, expiresAt });
      return json(res, 201, {
        requestId,
        clientName,
        origin: entry.origin,
        expiresAt,
        ttlSeconds: Math.round(pairingCodeTtlMs / 1000),
        instructions: 'Enter the 6-character pairing code shown in your local Mimir Desktop or daemon terminal.',
      });
    }

    if (req.method === 'POST' && p === '/v1/pairing/exchange') {
      prunePairingState();
      const body = await readBody(req).catch(() => ({}));
      const presentedCode = String(body.code || '').trim().toUpperCase();
      const targetId = body.requestId ? String(body.requestId) : null;
      if (!presentedCode) {
        return json(res, 400, { error: 'Pairing code is required.', code: 'PAIRING_CODE_REQUIRED' });
      }
      let match = null;
      if (targetId) {
        const reqEntry = pairingRequests.get(targetId);
        if (!reqEntry || reqEntry.used || Date.now() >= reqEntry.expiresAt) {
          return json(res, 403, { error: 'Pairing request expired or unknown. Request a new code.', code: 'PAIRING_EXPIRED' });
        }
        reqEntry.attempts += 1;
        if (reqEntry.attempts > 5) {
          pairingRequests.delete(targetId);
          return json(res, 429, { error: 'Too many invalid pairing attempts. Request a new code.', code: 'PAIRING_LOCKED' });
        }
        if (reqEntry.code === presentedCode) match = reqEntry;
      } else {
        if (pairingExchangeFailures >= 5) {
          return json(res, 429, { error: 'Too many invalid pairing attempts. Request a new code.', code: 'PAIRING_LOCKED' });
        }
        for (const reqEntry of pairingRequests.values()) {
          if (!reqEntry.used && Date.now() < reqEntry.expiresAt && reqEntry.code === presentedCode) {
            match = reqEntry;
            break;
          }
        }
        if (!match) {
          pairingExchangeFailures += 1;
          for (const [id, reqEntry] of pairingRequests) {
            reqEntry.attempts += 1;
            if (reqEntry.attempts > 5) pairingRequests.delete(id);
          }
          if (pairingExchangeFailures > 5) {
            return json(res, 429, { error: 'Too many invalid pairing attempts. Request a new code.', code: 'PAIRING_LOCKED' });
          }
        }
      }
      if (!match) {
        return json(res, 403, { error: 'Invalid pairing code.', code: 'PAIRING_INVALID' });
      }
      pairingExchangeFailures = 0;
      match.used = true;
      pairingRequests.delete(match.id);
      const sessionToken = `mimir_sess_${crypto.randomBytes(24).toString('hex')}`;
      const expiresAt = Date.now() + pairingSessionTtlMs;
      pairingSessions.set(sessionToken, {
        token: sessionToken,
        clientName: match.clientName,
        origin: origin || match.origin,
        createdAt: Date.now(),
        expiresAt,
      });
      return json(res, 200, {
        ok: true,
        sessionToken,
        expiresAt,
        clientName: match.clientName,
        scope: 'session',
      });
    }

    if (req.method === 'GET' && p === '/v1/browser-lab') {
      const labHtml = renderBrowserLabHtml();
      const scriptMatch = labHtml.match(/<script>([\s\S]*?)<\/script>/);
      const scriptSrc = scriptMatch
        ? `'sha256-${crypto.createHash('sha256').update(scriptMatch[1], 'utf8').digest('base64')}'`
        : "'none'";
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': `default-src 'none'; script-src ${scriptSrc}; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
      });
      return res.end(labHtml);
    }

    const authHeader = req.headers.authorization || '';
    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
    const authCheck = verifyBearer(bearer);
    if (!authCheck.ok) {
      return json(res, 401, { error: authCheck.error, code: authCheck.code });
    }

    if (req.method === 'GET' && p === '/v1/auth/ws-ticket') {
      pruneWsTickets();
      if (wsTickets.size >= 256) {
        const oldestKey = wsTickets.keys().next().value;
        if (oldestKey) wsTickets.delete(oldestKey);
      }
      const ticket = `ws_tkt_${crypto.randomBytes(24).toString('hex')}`;
      const expiresInMs = 30_000;
      const expiresAt = Date.now() + expiresInMs;
      wsTickets.set(ticket, {
        expiresAt,
        mode: authCheck.mode,
        sessionToken: authCheck.session?.token || null,
      });
      return json(res, 200, { ok: true, ticket, expiresInMs, expiresAt });
    }

    if (req.method === 'GET' && p === '/v1/pairing/status') {
      return json(res, 200, {
        ok: true,
        mode: authCheck.mode,
        expiresAt: authCheck.session?.expiresAt || null,
        clientName: authCheck.session?.clientName || null,
      });
    }
    if (req.method === 'GET' && p === '/v1/pairing/pending') {
      if (authCheck.mode === 'session') {
        return json(res, 403, { error: 'Master or local authority required to list pending pairing codes.' });
      }
      prunePairingState();
      return json(res, 200, {
        pending: [...pairingRequests.values()].map(r => ({
          id: r.id,
          code: r.code,
          clientName: r.clientName,
          origin: r.origin,
          expiresAt: r.expiresAt,
        })),
      });
    }
    if (req.method === 'POST' && p === '/v1/pairing/revoke') {
      const body = await readBody(req).catch(() => ({}));
      const targetTok = authCheck.mode === 'master' && body.sessionToken ? String(body.sessionToken) : bearer;
      if (targetTok) {
        pairingSessions.delete(targetTok);
        retiredSessions.add(targetTok);
      }
      return json(res, 200, { ok: true, revoked: Boolean(targetTok) });
    }

    try {
      if (req.method === 'GET' && p === '/v1/meta') {
        return json(res, 200, { shapes: BOT_SHAPES, colors: BOT_COLORS, dataDir });
      }
      if (req.method === 'GET' && p === '/v1/settings') {
        return json(res, 200, store.getPublicSettings());
      }

      // Model setup wizard: discover -> connect -> test -> apply
      if (req.method === 'GET' && p === '/v1/models/discover') {
        return json(res, 200, { servers: await discoverLocalServers(), localOnly: Boolean(store.getSettings().localOnly) });
      }
      // Model library: hardware fit, one-click install, automatic tiers, OpenRouter sign-in
      if (req.method === 'GET' && p === '/v1/models/library') return json(res, 200, await modelLibrary.overview());
      if (req.method === 'GET' && p === '/v1/system/usage') {
        const threadId = urlObj.searchParams.get('threadId');
        return json(res, 200, await systemUsage({ settings: store.getSettings(), thread: threadId ? store.getThread(threadId) : null }));
      }
      if (req.method === 'POST' && p === '/v1/models/pull') {
        const body = await readBody(req);
        return json(res, 202, modelLibrary.startPull(body.name));
      }
      if (req.method === 'GET' && p === '/v1/models/pull') {
        return json(res, 200, { pull: modelLibrary.pullStatus(urlObj.searchParams.get('name') || '') });
      }
      if (req.method === 'POST' && p === '/v1/models/tiers/refresh') return json(res, 200, { tiers: await modelLibrary.refreshTiers() });
      if (req.method === 'POST' && p === '/v1/models/openrouter/login') {
        if (store.getSettings().localOnly) {
          return json(res, 403, { error: 'Local-only mode is on. Turn it off in Settings before connecting a cloud account.', code: 'LOCAL_ONLY_BLOCKED' });
        }
        // OpenRouter accepts http://localhost callbacks on any port.
        return json(res, 200, openRouter.begin(`http://localhost:${new URL(publicUrl).port}/v1/models/openrouter/callback`));
      }
      if (req.method === 'GET' && p === '/v1/models/openrouter/models') {
        const models = await openRouter.listModels();
        return json(res, 200, { models, signedIn: Boolean(store.getSettings().openRouterSignedIn) });
      }
      if (req.method === 'GET' && p === '/v1/models/providers') {
        return json(res, 200, { providers: CLOUD_PROVIDERS });
      }
      if (req.method === 'POST' && p === '/v1/models/test') {
        const target = resolveModelTarget(await readBody(req));
        await assertSafeUrl(target.baseUrl, { allowLoopback: true });
        if (store.getSettings().localOnly && !isLoopbackUrl(target.baseUrl)) {
          return json(res, 403, { error: 'Local-only mode is on. Turn it off before testing a cloud model.', code: 'LOCAL_ONLY_BLOCKED' });
        }
        return json(res, 200, await testModelCapabilities(target));
      }
      if (req.method === 'POST' && p === '/v1/models/apply') {
        const body = await readBody(req);
        const target = resolveModelTarget(body);
        await assertSafeUrl(target.baseUrl, { allowLoopback: true });
        const localOnly = Boolean(body.localOnly);
        if (localOnly && !isLoopbackUrl(target.baseUrl)) {
          return json(res, 400, { error: 'A cloud model cannot be the default while local-only mode is on.' });
        }
        const patch =
          target.kind === 'ollama'
            ? { provider: 'ollama', ollamaUrl: target.baseUrl, ollamaModel: target.model }
            : { provider: 'openai-compat', openaiBaseUrl: target.baseUrl, openaiModel: target.model, ...(body.apiKey ? { openaiApiKey: body.apiKey } : {}) };
        return json(res, 200, store.updateSettings({ ...patch, localOnly, autoTierRouting: Boolean(body.autoTierRouting), modelSetupDone: true }));
      }
      if (req.method === 'PATCH' && p === '/v1/settings') {
        const body = await readBody(req);
        if (body.responseMode !== undefined && !RESPONSE_MODES.includes(body.responseMode)) {
          return json(res, 400, { error: `responseMode must be one of ${RESPONSE_MODES.join(', ')}` });
        }
        // Fast mode needs to know the smallest installed model.
        if (body.responseMode === 'fast' && !store.getSettings().autoTierModels?.fast_local) await modelLibrary.refreshTiers();
        const updated = store.updateSettings(body);
        scaleQueue.configure({
          maxConcurrent: updated.maxConcurrentTasks,
          rateLimitPerMinute: updated.rateLimitPerMinute,
        });
        if (body.browserMode || body.userCdpUrl !== undefined || body.cloudBrowserWsUrl !== undefined) {
          await localExec.browser.switchModeCleanup();
        }
        return json(res, 200, updated);
      }
      if (req.method === 'GET' && p === '/v1/models') {
        return json(res, 200, await probeModels(store.getSettings()));
      }

      // Bots & Team Bots
      if (req.method === 'GET' && p === '/v1/bots') {
        return json(res, 200, store.listBots());
      }
      if (req.method === 'POST' && p === '/v1/bots') {
        const body = await readBody(req);
        return json(res, 201, store.createBot(body));
      }
      if (req.method === 'GET' && p === '/v1/team-bots/templates') {
        return json(res, 200, TEAM_BOT_TEMPLATES);
      }
      if (req.method === 'GET' && p === '/v1/team/overview') {
        const focusBotId = urlObj.searchParams.get('botId') || null;
        return json(res, 200, {
          ...store.getTeamOverview(runner.getActiveStatus(), focusBotId),
          reversibilityMatrix: REVERSIBILITY_MATRIX,
          workspaceSubdirs: WORKSPACE_SUBDIRS,
          volatilePaths: VOLATILE_PATHS_CONTRAST,
        });
      }
      if (req.method === 'POST' && p === '/v1/team/deploy-preset') {
        const body = await readBody(req);
        const result = store.deployChiefOfStaffTeam({ activateThread: body.activateThread !== false });
        broadcast('bots:updated', store.listBots());
        broadcast('agents:status', runner.getActiveStatus());
        return json(res, 201, {
          ...result,
          overview: store.getTeamOverview(runner.getActiveStatus(), result.chief?.id),
        });
      }
      if (req.method === 'POST' && p === '/v1/team/run-playbook') {
        const body = await readBody(req);
        const result = store.runChiefDelegationPlaybook(body.botId || 'bot-chief-klaus');
        broadcast('bots:updated', store.listBots());
        broadcast('agents:status', runner.getActiveStatus());
        if (result.threadId) broadcast('thread:updated', { threadId: result.threadId });
        if (result.receipt) broadcast('receipt:created', { threadId: result.threadId, receipt: result.receipt });
        return json(res, 200, {
          ...result,
          overview: store.getTeamOverview(runner.getActiveStatus(), 'bot-chief-klaus'),
        });
      }
      if (req.method === 'POST' && p === '/v1/workspace/import-grokbot') {
        const body = await readBody(req);
        const imported = store.importGrokBotBundle(body || {});
        const seededSkills = routines.seedPresetSkills(imported.botId || 'bot-chief-klaus');
        const playbook = store.runChiefDelegationPlaybook(imported.botId || 'bot-chief-klaus');
        const snapshot = store.verifyAndSnapshotWorkspace(imported.botId || 'bot-chief-klaus');
        broadcast('bots:updated', store.listBots());
        broadcast('agents:status', runner.getActiveStatus());
        if (playbook.threadId) broadcast('thread:updated', { threadId: playbook.threadId });
        if (snapshot.receipt) broadcast('receipt:created', { receipt: snapshot.receipt });
        return json(res, 201, {
          ok: true,
          botId: imported.botId,
          deployedTeam: imported.deployedTeam,
          skills: seededSkills,
          playbook,
          snapshot,
          overview: store.getTeamOverview(runner.getActiveStatus(), imported.botId || 'bot-chief-klaus'),
        });
      }
      const wsSkillsMatch = p.match(/^\/v1\/workspace\/([^/]+)\/skills$/);
      if (req.method === 'GET' && wsSkillsMatch) {
        const bId = decodeURIComponent(wsSkillsMatch[1]);
        return json(res, 200, {
          layout: store.getWorkspaceLayout(bId),
          skills: store.listSkillFiles(bId),
        });
      }
      const wsSeedMatch = p.match(/^\/v1\/workspace\/([^/]+)\/skills\/seed$/);
      if (req.method === 'POST' && wsSeedMatch) {
        const bId = decodeURIComponent(wsSeedMatch[1]);
        const skills = routines.seedPresetSkills(bId);
        return json(res, 201, {
          ok: true,
          skills,
          layout: store.getWorkspaceLayout(bId),
        });
      }
      const wsRunSkillMatch = p.match(/^\/v1\/workspace\/([^/]+)\/skills\/([^/]+)\/run$/);
      if (req.method === 'POST' && wsRunSkillMatch) {
        const bId = decodeURIComponent(wsRunSkillMatch[1]);
        const slug = decodeURIComponent(wsRunSkillMatch[2]);
        const out = await routines.executeSkillFile(bId, slug, { store });
        return json(res, 200, out);
      }
      const wsSnapMatch = p.match(/^\/v1\/workspace\/([^/]+)\/snapshot$/);
      if (req.method === 'POST' && wsSnapMatch) {
        const bId = decodeURIComponent(wsSnapMatch[1]);
        const snap = store.verifyAndSnapshotWorkspace(bId);
        if (snap.receipt) broadcast('receipt:created', { receipt: snap.receipt });
        return json(res, 200, snap);
      }
      const wsExportMatch = p.match(/^\/v1\/workspace\/([^/]+)\/export-grokbot$/);
      if (req.method === 'GET' && wsExportMatch) {
        const bId = decodeURIComponent(wsExportMatch[1]);
        return json(res, 200, store.exportGrokBotBundle(bId));
      }
      const wsFileMatch = p.match(/^\/v1\/workspace\/([^/]+)\/file$/);
      if (wsFileMatch) {
        const bId = decodeURIComponent(wsFileMatch[1]);
        if (req.method === 'GET') {
          const rawPath = urlObj.searchParams.get('path') || '';
          const { absPath, relPath } = resolveBotWorkspaceFile(store, bId, rawPath);
          if (!fs.existsSync(absPath)) return json(res, 404, { error: 'File not found' });
          const st = fs.statSync(absPath);
          if (!st.isFile()) return json(res, 400, { error: 'Target is not a regular file' });
          if (st.size > 2 * 1024 * 1024) {
            return json(res, 413, { error: 'File exceeds 2 MB canvas editor limit' });
          }
          const content = fs.readFileSync(absPath, 'utf8');
          const mime = WORKSPACE_FILE_MIME_MAP[path.extname(absPath).toLowerCase()] || 'text/plain; charset=utf-8';
          return json(res, 200, {
            ok: true,
            path: relPath,
            content,
            mime,
            size: st.size,
            mtimeMs: st.mtimeMs,
          });
        }
        if (req.method === 'PUT') {
          const body = await readBody(req);
          if (typeof body.content !== 'string') {
            return json(res, 400, { error: 'content string is required' });
          }
          const { absPath, relPath } = resolveBotWorkspaceFile(store, bId, body.path);
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          const tmpPath = `${absPath}.tmp-${crypto.randomBytes(4).toString('hex')}`;
          try {
            fs.writeFileSync(tmpPath, body.content, 'utf8');
            fs.renameSync(tmpPath, absPath);
          } catch (writeErr) {
            try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch {}
            throw writeErr;
          }
          const st = fs.statSync(absPath);
          let receipt = null;
          if (body.threadId || body.recordReceipt) {
            receipt = store.appendReceipt({
              botId: bId,
              threadId: body.threadId || null,
              userId,
              runId: `canvas-save-${Date.now()}`,
              verdict: 'verified',
              summary: `Saved workspace file ${relPath} (${st.size} bytes)`,
              files: [{ path: relPath, bytes: st.size }],
              model: { provider: 'mimir-canvas', name: 'workspace-editor', leftThisComputer: false },
            });
            if (receipt) broadcast('receipt:created', { botId: bId, threadId: body.threadId || null, receipt });
          }
          broadcast('workspace:updated', { botId: bId, path: relPath, size: st.size, mtimeMs: st.mtimeMs });
          return json(res, 200, {
            ok: true,
            path: relPath,
            size: st.size,
            mtimeMs: st.mtimeMs,
            ...(receipt ? { receipt } : {}),
          });
        }
      }
      if (req.method === 'POST' && p === '/v1/canvas/edit') {
        const body = await readBody(req);
        const instruction = String(body.instruction || '').trim();
        if (!instruction) return json(res, 400, { error: 'instruction is required' });
        const botId = body.botId || store.listBots()[0]?.id || 'bot-grok-default';
        let originalContent = typeof body.content === 'string' ? body.content : null;
        let relPath = body.path ? String(body.path).trim() : '';
        if (originalContent === null && relPath) {
          const { absPath, relPath: safeRel } = resolveBotWorkspaceFile(store, botId, relPath);
          relPath = safeRel;
          if (!fs.existsSync(absPath)) return json(res, 404, { error: 'Workspace file not found' });
          originalContent = fs.readFileSync(absPath, 'utf8');
        }
        originalContent = originalContent ?? '';
        const s = store.getSettings();
        const bot = store.getBot(botId);
        const gate = sentinel.evaluateToolRequest({
          agentId: bot?.norseRoleId || 'mimir',
          toolName: 'fs_write',
          args: { path: relPath || 'canvas-buffer.txt', instruction },
          bot,
          executionMode: body.executionMode || bot?.executionMode || 'agent',
          approvalPolicy: 'auto-approve',
          localOnly: Boolean(s.localOnly),
          approved: true,
          runId: `canvas-edit-${Date.now()}`,
        });
        if (gate.decision === 'DENY') {
          return json(res, 403, { ok: false, gate, error: gate.reason });
        }
        const sel = body.selection && typeof body.selection === 'object' ? body.selection : null;
        let selectionNote = '';
        if (sel && Number.isFinite(Number(sel.startLine)) && Number.isFinite(Number(sel.endLine))) {
          const lines = originalContent.split(/\r?\n/);
          const startIdx = Math.max(0, Number(sel.startLine) - 1);
          const endIdx = Math.min(lines.length, Number(sel.endLine));
          selectionNote = `\nFocus on lines ${startIdx + 1}-${endIdx}:\n\`\`\`\n${lines.slice(startIdx, endIdx).join('\n')}\n\`\`\`\n`;
        }
        const messages = [
          {
            role: 'system',
            content: 'You are Mimir Canvas Editor. Apply the user instruction to the provided file/code content and respond ONLY with a JSON object: {"updatedContent":"<full updated file text>","diffSummary":"<one concise sentence summarizing the edit>"}. Preserve unmodified sections intact.',
          },
          {
            role: 'user',
            content: `File: ${relPath || '(untitled)'}\nInstruction: ${instruction}${selectionNote}\nOriginal Content:\n\`\`\`\n${originalContent}\n\`\`\``,
          },
        ];
        try {
          const llmOut = await runChatTurn({
            settings: s,
            modelOverride: body.model || bot?.model || null,
            messages,
          });
          const parsed = parseCanvasEditResponse(llmOut?.content || '', originalContent);
          const computed = computeLineDiffSummary(originalContent, parsed.updatedContent);
          return json(res, 200, {
            ok: true,
            path: relPath || null,
            updatedContent: parsed.updatedContent,
            diffSummary: parsed.diffSummary || computed.diffSummary,
            hunks: computed.hunks,
          });
        } catch (err) {
          const status = err?.status || (err?.name === 'LocalOnlyBlockedError' ? 403 : 500);
          return json(res, status, { error: err?.message || 'Canvas edit failed' });
        }
      }
      const botMemMatch = p.match(/^\/v1\/bots\/([^/]+)\/memories(?:\/([^/]+))?$/);
      if (botMemMatch) {
        const botId = decodeURIComponent(botMemMatch[1]);
        const key = botMemMatch[2] ? decodeURIComponent(botMemMatch[2]) : null;
        if (req.method === 'GET') return json(res, 200, store.getMemories(botId, userId));
        if (req.method === 'POST') {
          const body = await readBody(req);
          return json(res, 200, store.saveMemory(botId, body.key, body.value, {
            userId,
            ...(body.scope ? { scope: body.scope } : {}),
            ...(body.spaceId !== undefined ? { spaceId: body.spaceId } : {}),
            ...(body.pinned !== undefined ? { pinned: Boolean(body.pinned) } : {}),
          }));
        }
        if (req.method === 'PATCH' && key) {
          const body = await readBody(req);
          if (typeof store.updateBotMemory === 'function') {
            const updated = store.updateBotMemory({
              botId,
              key,
              value: body.value,
              scope: body.scope,
              spaceId: body.spaceId,
              pinned: body.pinned,
              userId,
            });
            if (!updated) return json(res, 404, { error: 'Memory entry not found' });
            return json(res, 200, { ok: true, memory: updated, memories: store.getMemories(botId, userId) });
          }
          const existing = store.getMemories(botId, userId).find(m => m.key === key || m.id === key);
          if (!existing && body.value === undefined) {
            return json(res, 404, { error: 'Memory entry not found' });
          }
          const nextValue = body.value !== undefined ? String(body.value) : existing.value;
          const list = store.saveMemory(botId, existing?.key || key, nextValue, { userId, provenance: existing?.provenance || 'user' });
          const target = list.find(m => m.key === (existing?.key || key));
          if (target) {
            if (body.scope !== undefined) target.scope = body.scope;
            if (body.spaceId !== undefined) target.spaceId = body.spaceId || null;
            if (body.pinned !== undefined) target.pinned = Boolean(body.pinned);
            store.save?.();
          }
          return json(res, 200, { ok: true, memory: target || null, memories: list });
        }
        if (req.method === 'DELETE' && key) return json(res, 200, store.deleteMemory(botId, key, { userId }));
      }
      const botMatch = p.match(/^\/v1\/bots\/([^/]+)$/);
      if (botMatch) {
        const botId = decodeURIComponent(botMatch[1]);
        if (req.method === 'PATCH') {
          const body = await readBody(req);
          const updated = store.updateBot(botId, body);
          return updated ? json(res, 200, updated) : json(res, 404, { error: 'Not found' });
        }
        if (req.method === 'DELETE') {
          return json(res, 200, { ok: store.deleteBot(botId) });
        }
      }

      // Threads
      if (req.method === 'GET' && p === '/v1/threads') {
        const botId = urlObj.searchParams.get('botId') || null;
        const spaceId = urlObj.searchParams.get('spaceId') || null;
        const includeSubagents = urlObj.searchParams.get('includeSubagents') === '1';
        let list = store.listThreads(botId, userId, { spaceId, includeSubagents });
        if (!includeSubagents) list = list.filter(t => !t.isSubagent);
        if (spaceId) list = list.filter(t => t.spaceId === spaceId);
        return json(res, 200, list);
      }
      if (req.method === 'POST' && p === '/v1/threads') {
        const body = await readBody(req);
        const created = store.createThread({ ...body, spaceId: body.spaceId || null, userId });
        if (body.spaceId && created && created.spaceId !== body.spaceId) {
          created.spaceId = body.spaceId;
          store.save?.();
        }
        return json(res, 201, created);
      }
      const thrActionMatch = p.match(/^\/v1\/threads\/([^/]+)\/(fork|branch-edit|export)$/);
      if (thrActionMatch) {
        const id = decodeURIComponent(thrActionMatch[1]);
        const op = thrActionMatch[2];
        const scopedThread = store.getThread(id, userId);
        if (!scopedThread) return json(res, 404, { error: 'Not found' });
        if (op === 'fork' && req.method === 'POST') {
          if (typeof store.forkThread !== 'function') {
            return json(res, 501, { error: 'forkThread is not available on store' });
          }
          const body = await readBody(req);
          const forked = store.forkThread({
            threadId: id,
            fromMessageId: body.fromMessageId || null,
            newUserText: body.newUserText,
            userId,
            title: body.title,
          });
          if (!forked) return json(res, 404, { error: 'Thread or message not found' });
          broadcast('thread:created', { thread: forked });
          return json(res, 201, { ok: true, thread: forked });
        }
        if (op === 'branch-edit' && req.method === 'POST') {
          if (typeof store.branchEditMessage !== 'function') {
            return json(res, 501, { error: 'branchEditMessage is not available on store' });
          }
          const body = await readBody(req);
          if (!body.messageId || typeof body.newContent !== 'string') {
            return json(res, 400, { error: 'messageId and newContent are required' });
          }
          const updated = store.branchEditMessage({
            threadId: id,
            messageId: body.messageId,
            newContent: body.newContent,
            userId,
          });
          if (!updated) return json(res, 404, { error: 'Thread or message not found' });
          const threadObj = updated.thread || updated;
          broadcast('thread:updated', { threadId: id, thread: threadObj });
          let started = false;
          if (body.run && typeof runner?.runTurn === 'function' && !runner.activeRuns?.has(id)) {
            started = true;
            runner.runTurn({
              threadId: id,
              botId: body.botId || threadObj.botId,
              userText: body.newContent,
              userId,
              trustedUserInput: true,
              skipUserAppend: true,
              ...(body.researchMode ? { researchMode: body.researchMode } : {}),
              ...(body.executionMode ? { executionMode: body.executionMode } : {}),
            }).catch(() => {});
          }
          return json(res, 200, {
            ok: true,
            thread: threadObj,
            ...(started ? { started: true, runStarted: true } : {}),
            ...(updated.editedMessage ? { editedMessage: updated.editedMessage } : {}),
            ...(updated.branchGroupId ? { branchGroupId: updated.branchGroupId } : {}),
            ...(updated.activeMessages ? { activeMessages: updated.activeMessages } : {}),
          });
        }
        if (op === 'export' && req.method === 'GET') {
          const format = (urlObj.searchParams.get('format') || 'md').toLowerCase();
          const messages = resolveActiveBranchMessages(scopedThread);
          const slug = String(scopedThread.title || scopedThread.id)
            .toLowerCase()
            .replace(/[^a-z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 48) || scopedThread.id;
          if (format === 'json') {
            const payload = JSON.stringify({
              id: scopedThread.id,
              title: scopedThread.title,
              botId: scopedThread.botId,
              spaceId: scopedThread.spaceId || null,
              createdAt: scopedThread.createdAt,
              updatedAt: scopedThread.updatedAt,
              activeLeafId: scopedThread.activeLeafId || null,
              messages,
            }, null, 2);
            res.writeHead(200, {
              'Content-Type': 'application/json; charset=utf-8',
              'Content-Disposition': `attachment; filename="${slug}.json"`,
              'Content-Length': String(Buffer.byteLength(payload, 'utf8')),
              'X-Content-Type-Options': 'nosniff',
              'Cache-Control': 'no-store',
            });
            return res.end(payload);
          }
          const lines = [
            `# ${scopedThread.title || 'Mimir Thread'}`,
            '',
            `- Thread ID: \`${scopedThread.id}\``,
            `- Bot ID: \`${scopedThread.botId}\``,
            ...(scopedThread.spaceId ? [`- Space ID: \`${scopedThread.spaceId}\``] : []),
            `- Updated: ${scopedThread.updatedAt || ''}`,
            '',
          ];
          for (const m of messages) {
            const roleLabel = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : String(m.role || 'Message');
            lines.push(`## ${roleLabel}${m.createdAt ? ` (${m.createdAt})` : ''}`, '', String(m.content || ''), '');
          }
          const mdText = lines.join('\n');
          res.writeHead(200, {
            'Content-Type': 'text/markdown; charset=utf-8',
            'Content-Disposition': `attachment; filename="${slug}.md"`,
            'Content-Length': String(Buffer.byteLength(mdText, 'utf8')),
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store',
          });
          return res.end(mdText);
        }
      }
      const thrMatch = p.match(/^\/v1\/threads\/([^/]+)$/);
      if (thrMatch) {
        const id = decodeURIComponent(thrMatch[1]);
        const scopedThread = store.getThread(id, userId);
        if (!scopedThread) return json(res, 404, { error: 'Not found' });
        if (req.method === 'GET') return json(res, 200, scopedThread);
        if (req.method === 'PATCH') {
          const body = await readBody(req);
          const updated = store.updateThread(id, body);
          if (!updated) return json(res, 404, { error: 'Not found' });
          let extraSaved = false;
          if ('botId' in body && body.botId && updated.botId !== body.botId) {
            updated.botId = String(body.botId);
            extraSaved = true;
          }
          if ('spaceId' in body && updated.spaceId !== (body.spaceId || null)) {
            updated.spaceId = body.spaceId || null;
            extraSaved = true;
          }
          if (extraSaved) store.save?.();
          broadcast('thread:updated', { threadId: id, thread: updated });
          return json(res, 200, updated);
        }
        if (req.method === 'DELETE') {
          return json(res, 200, { ok: store.deleteThread(id) });
        }
      }

      // Agent Execution & Approvals
      // Workflows: describe -> review draft -> save -> runs on its trigger
      if (req.method === 'GET' && p === '/v1/workflows') {
        return json(res, 200, {
          workflows: workflows.list().map(w => ({ ...w, lastRun: workflows.listRuns(w.id)[0] || null, running: workflows.active.has(w.id) })),
          templates: WORKFLOW_TEMPLATES,
        });
      }
      if (req.method === 'POST' && p === '/v1/workflows/draft') {
        const body = await readBody(req);
        return json(res, 200, await workflows.draft(body.description, { planWithModel: body.useModel === false ? null : planWorkflow }));
      }
      if (req.method === 'POST' && p === '/v1/workflows') return json(res, 201, workflows.save(await readBody(req)));
      const wfMatch = p.match(/^\/v1\/workflows\/([^/]+)(?:\/(run|runs))?$/);
      if (wfMatch) {
        const wfId = decodeURIComponent(wfMatch[1]);
        if (req.method === 'DELETE' && !wfMatch[2]) return json(res, 200, { ok: workflows.delete(wfId) });
        if (req.method === 'GET' && wfMatch[2] === 'runs') return json(res, 200, { runs: workflows.listRuns(wfId).slice(0, 20) });
        if (req.method === 'POST' && wfMatch[2] === 'run') {
          const body = await readBody(req);
          if (!workflows.get(wfId)) return json(res, 404, { error: 'Workflow not found' });
          if (workflows.active.has(wfId)) return json(res, 409, { error: 'This workflow is already running' });
          const started = workflows.run(wfId, { resumeRunId: body.resumeRunId || null });
          if (body.wait) return json(res, 200, await started.then(r => ({ ok: true, run: r.run }), err => ({ ok: false, error: err.message, runId: err.runId })));
          started.catch(() => {}); // outcome is recorded on the run and broadcast
          return json(res, 202, { started: true });
        }
      }

      if (req.method === 'GET' && p === '/v1/memory/shared') {
        return json(res, 200, { facts: store.getMemories(SHARED_MEMORY_SCOPE) });
      }
      const sharedMemMatch = p.match(/^\/v1\/memory\/shared\/([^/]+)$/);
      if (sharedMemMatch) {
        const key = decodeURIComponent(sharedMemMatch[1]);
        if (req.method === 'PATCH') {
          const body = await readBody(req);
          if (typeof store.updateBotMemory === 'function') {
            const updated = store.updateBotMemory({
              botId: SHARED_MEMORY_SCOPE,
              key,
              value: body.value,
              scope: body.scope,
              spaceId: body.spaceId,
              pinned: body.pinned,
              userId,
            });
            if (!updated) return json(res, 404, { error: 'Shared memory entry not found' });
            return json(res, 200, { ok: true, memory: updated, facts: store.getMemories(SHARED_MEMORY_SCOPE) });
          }
          const existing = store.getMemories(SHARED_MEMORY_SCOPE).find(m => m.key === key || m.id === key);
          if (!existing && body.value === undefined) return json(res, 404, { error: 'Shared memory entry not found' });
          const nextValue = body.value !== undefined ? String(body.value) : existing.value;
          const facts = store.saveMemory(SHARED_MEMORY_SCOPE, existing?.key || key, nextValue, { provenance: existing?.provenance || 'user' });
          return json(res, 200, { ok: true, facts });
        }
        if (req.method === 'DELETE') {
          return json(res, 200, { facts: store.deleteMemory(SHARED_MEMORY_SCOPE, key) });
        }
      }
      if (req.method === 'POST' && p === '/v1/agent/run') {
        const raw = await readBody(req);
        // Internal run controls (depth, parent bot, root thread) are never accepted from a client.
        const { depth: _d, parentBotId: _p, rootThreadId: _r, ...body } = raw;
        body.trustedUserInput = true; // this route is the user's own chat box
        body.userId = userId;
        if (body.threadId && !store.getThread(body.threadId, userId)) {
          return json(res, 404, { error: 'Thread not found in user scope' });
        }
        if (body.async) {
          let thread = body.threadId ? store.getThread(body.threadId, userId) : null;
          if (!thread) {
            thread = store.createThread({
              botId: body.botId,
              userId,
              title: body.title || 'New Chat',
              ...(body.executionMode ? { executionMode: body.executionMode } : {}),
            });
          }
          runner.runTurn({ ...body, threadId: thread.id, userId }).catch(() => {});
          return json(res, 202, { started: true, threadId: thread.id });
        }
        const out = await runner.runTurn(body);
        return json(res, 200, out);
      }
      if (req.method === 'POST' && p === '/v1/agent/abort') {
        const body = await readBody(req);
        return json(res, 200, { aborted: runner.abortThread(body.threadId) });
      }
      if (req.method === 'GET' && p === '/v1/approvals') {
        const items = runner.listPendingApprovals(urlObj.searchParams.get('threadId'))
          .filter(a => !a.threadId || store.getThread(a.threadId, userId));
        return json(res, 200, items);
      }
      const aprMatch = p.match(/^\/v1\/approvals\/([^/]+)$/);
      if (req.method === 'POST' && aprMatch) {
        const aprId = decodeURIComponent(aprMatch[1]);
        const targetApr = runner.listPendingApprovals(null).find(a => a.id === aprId);
        if (targetApr?.threadId && !store.getThread(targetApr.threadId, userId)) {
          return json(res, 404, { error: 'Approval not found or already resolved' });
        }
        const body = await readBody(req);
        const ok = runner.resolveApproval(aprId, body.decision);
        return ok ? json(res, 200, { ok: true }) : json(res, 404, { error: 'Approval not found or already resolved' });
      }

      // MCP Box
      if (req.method === 'GET' && p === '/v1/mcps') {
        return json(res, 200, mcpManager.listConfigured());
      }
      if (req.method === 'POST' && p === '/v1/mcps') {
        const body = await readBody(req);
        return json(res, 200, mcpManager.saveServer(body));
      }
      const mcpDiscMatch = p.match(/^\/v1\/mcps\/([^/]+)\/discover$/);
      if (req.method === 'POST' && mcpDiscMatch) {
        return json(res, 200, await mcpManager.connectAndDiscover(decodeURIComponent(mcpDiscMatch[1])));
      }
      const mcpToggleMatch = p.match(/^\/v1\/mcps\/([^/]+)\/tools\/([^/]+)\/toggle$/);
      if (req.method === 'POST' && mcpToggleMatch) {
        const body = await readBody(req);
        return json(
          res,
          200,
          mcpManager.setToolDisabled(
            decodeURIComponent(mcpToggleMatch[1]),
            decodeURIComponent(mcpToggleMatch[2]),
            Boolean(body.disabled)
          )
        );
      }
      const mcpOauthMatch = p.match(/^\/v1\/mcps\/([^/]+)\/oauth\/(start|revoke)$/);
      if (req.method === 'POST' && mcpOauthMatch) {
        const id = decodeURIComponent(mcpOauthMatch[1]);
        if (mcpOauthMatch[2] === 'revoke') return json(res, 200, await mcpManager.revokeOAuth(id));
        const body = await readBody(req);
        return json(res, 200, await mcpManager.startOAuth(id, { clientId: body.clientId ? String(body.clientId) : null }));
      }
      const mcpDelMatch = p.match(/^\/v1\/mcps\/([^/]+)$/);
      if (req.method === 'DELETE' && mcpDelMatch) {
        const id = decodeURIComponent(mcpDelMatch[1]);
        await mcpManager.oauth?.revoke(id).catch(() => {}); // removing a server also drops its tokens
        return json(res, 200, { ok: mcpManager.deleteServer(id) });
      }

      // Vault
      if (req.method === 'GET' && p === '/v1/vault') {
        return json(res, 200, vault.listMasked());
      }
      if (req.method === 'POST' && p === '/v1/vault') {
        const body = await readBody(req);
        return json(res, 201, vault.addEntry(body));
      }
      const vaultDelMatch = p.match(/^\/v1\/vault\/([^/]+)$/);
      if (req.method === 'DELETE' && vaultDelMatch) {
        return json(res, 200, { ok: vault.deleteEntry(decodeURIComponent(vaultDelMatch[1])) });
      }

      // Routines & Teach-a-Task Recordings
      if (req.method === 'GET' && p === '/v1/routines') return json(res, 200, routines.listRoutines());
      if (req.method === 'POST' && p === '/v1/routines') return json(res, 200, routines.saveRoutine(await readBody(req)));
      const rtnRunMatch = p.match(/^\/v1\/routines\/([^/]+)\/run$/);
      if (req.method === 'POST' && rtnRunMatch) return json(res, 200, await routines.runRoutineNow(decodeURIComponent(rtnRunMatch[1])));
      const rtnDelMatch = p.match(/^\/v1\/routines\/([^/]+)$/);
      if (req.method === 'DELETE' && rtnDelMatch) return json(res, 200, { ok: routines.deleteRoutine(decodeURIComponent(rtnDelMatch[1])) });

      if (req.method === 'GET' && p === '/v1/recordings') return json(res, 200, routines.listRecordings());
      if (req.method === 'POST' && p === '/v1/recordings') return json(res, 201, routines.saveRecording(await readBody(req)));
      const recConvMatch = p.match(/^\/v1\/recordings\/([^/]+)\/to-routine$/);
      if (req.method === 'POST' && recConvMatch) {
        return json(res, 201, routines.recordingToRoutine(decodeURIComponent(recConvMatch[1]), await readBody(req)));
      }
      const recSkillMatch = p.match(/^\/v1\/recordings\/([^/]+)\/compile-skill$/);
      if (req.method === 'POST' && recSkillMatch) {
        return json(res, 201, routines.compileRecordingToSkillFile(decodeURIComponent(recSkillMatch[1]), await readBody(req)));
      }
      const recDelMatch = p.match(/^\/v1\/recordings\/([^/]+)$/);
      if (req.method === 'DELETE' && recDelMatch) return json(res, 200, { ok: routines.deleteRecording(decodeURIComponent(recDelMatch[1])) });

      // Cross-App AI Memory Import & Bot Forge
      if (req.method === 'GET' && p === '/v1/memory-import/scan') {
        return json(res, 200, { files: scanLocalAiMemories() });
      }
      if (req.method === 'POST' && p === '/v1/memory-import/read-local') {
        const body = await readBody(req);
        const target = String(body.path || '').trim();
        const allowed = scanLocalAiMemories().find(f => f.path === target);
        if (!allowed) return json(res, 403, { error: 'Path is not in discovered AI memory locations' });
        const rawText = fs.readFileSync(allowed.path, 'utf8');
        return json(res, 200, parseImportedContent({ source: allowed.source, filename: allowed.name, text: rawText }));
      }
      if (req.method === 'POST' && p === '/v1/memory-import/parse') {
        const body = await readBody(req);
        return json(res, 200, parseImportedContent(body));
      }
      if (req.method === 'POST' && p === '/v1/memory-import/analyze') {
        const body = await readBody(req);
        return json(
          res,
          200,
          await analyzeWorkAndProposeBot({
            settings: store.getSettings(),
            importedItems: body.importedItems || [],
          })
        );
      }
      if (req.method === 'POST' && p === '/v1/forge/create') {
        const body = await readBody(req);
        const bot = store.createBot(body.botConfig || {});
        for (const m of body.memories || []) {
          if (m?.key && m?.value) store.saveMemory(bot.id, m.key, m.value);
        }
        let routine = null;
        if (body.routineConfig?.prompt) {
          routine = routines.saveRoutine({ ...body.routineConfig, botId: bot.id });
        }
        let startedThreadId = null;
        if (body.runStarterPrompt) {
          const thr = store.createThread({ botId: bot.id, title: 'Forge Automation Run' });
          startedThreadId = thr.id;
          runner.runTurn({ botId: bot.id, threadId: thr.id, userText: body.runStarterPrompt }).catch(() => {});
        }
        return json(res, 201, { bot, routine, startedThreadId });
      }
      if (req.method === 'POST' && p === '/v1/forge/from-answers') {
        const body = await readBody(req);
        const plan = await synthesizeBotFromAnswers({ settings: store.getSettings(), answers: body.answers || {} });
        const bot = store.createBot(plan.botConfig);
        for (const m of plan.memories || []) {
          store.saveMemory(bot.id, m.key, m.value);
        }
        let routine = null;
        if (plan.routineConfig) {
          routine = routines.saveRoutine({ ...plan.routineConfig, botId: bot.id });
        }
        let startedThreadId = null;
        if (body.runImmediately !== false) {
          const thr = store.createThread({ botId: bot.id, title: 'Initial Automation Task' });
          startedThreadId = thr.id;
          runner.runTurn({ botId: bot.id, threadId: thr.id, userText: plan.starterTaskPrompt }).catch(() => {});
        }
        return json(res, 201, { bot, routine, startedThreadId, plan });
      }

      // Live Computer Preview Controls
      const compMatch = p.match(/^\/v1\/computer\/([^/]+)\/(state|open|action|screenshot|stage-file|relay|resume-challenge|control|run-agent-suite)$/);
      if (compMatch) {
        const botId = decodeURIComponent(compMatch[1]);
        const op = compMatch[2];
        if (req.method === 'GET' && op === 'state') {
          return json(res, 200, localExec.getComputerState(botId));
        }
        if (req.method === 'POST' && op === 'open') {
          const body = await readBody(req);
          return json(res, 200, await localExec.browser.open(botId, body.url));
        }
        if (req.method === 'POST' && op === 'action') {
          const body = await readBody(req);
          const normalized = { ...body, action: body.action || body.type };
          return json(res, 200, await localExec.browser.action(botId, normalized));
        }
        if (req.method === 'POST' && op === 'screenshot') {
          return json(res, 200, await localExec.browser.screenshot(botId));
        }
        if (req.method === 'POST' && op === 'control') {
          const body = await readBody(req);
          const mode = body?.mode === 'user' ? 'user' : 'agent';
          return json(res, 200, await localExec.browser.setControlMode(botId, mode));
        }
        if (req.method === 'POST' && op === 'run-agent-suite') {
          const addr = server.address();
          const base = publicUrl || (addr && typeof addr === 'object' ? `http://127.0.0.1:${addr.port}` : `http://127.0.0.1:${port}`);
          return json(res, 200, await runBrowserAgentSuite({
            browser: localExec.browser,
            botId,
            baseUrl: base,
            broadcast,
          }));
        }
        if (req.method === 'POST' && op === 'relay') {
          const body = await readBody(req);
          if (body.stop) {
            await localExec.browser.stopFreeCloudRelay();
            return json(res, 200, { stopped: true, wsEndpoint: '' });
          }
          const relay = await localExec.browser.startFreeCloudRelay();
          store.updateSettings({ browserMode: 'free-cloud', cloudBrowserWsUrl: relay.wsEndpoint });
          return json(res, 200, relay);
        }
        if (req.method === 'POST' && op === 'stage-file') {
          const body = await readBody(req);
          const safeName = path.basename(String(body.name || 'attachment.bin')).replace(/[^a-zA-Z0-9._-]/g, '_');
          const wsDir = store.getBotWorkspace(botId);
          const dest = path.join(wsDir, 'uploads', safeName);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          const buf = Buffer.from(String(body.contentBase64 || ''), 'base64');
          fs.writeFileSync(dest, buf);
          return json(res, 201, { name: safeName, path: `uploads/${safeName}`, size: buf.length });
        }
        if (req.method === 'POST' && op === 'resume-challenge') {
          return json(res, 200, localExec.browser.resumeFromChallenge(botId));
        }
      }
      const compSessionsMatch = p.match(/^\/v1\/computer\/([^/]+)\/sessions(?:\/([^/]+)(?:\/(restore))?|\/(save))?$/);
      if (compSessionsMatch) {
        const botId = decodeURIComponent(compSessionsMatch[1]);
        const seg2 = compSessionsMatch[2] ? decodeURIComponent(compSessionsMatch[2]) : null;
        const restoreOp = compSessionsMatch[3] || null;
        const saveOp = compSessionsMatch[4] || null;
        if (req.method === 'GET' && !seg2 && !saveOp) {
          return json(res, 200, { sessions: localExec.browser.listSessionHandoffs(botId) });
        }
        if (req.method === 'POST' && (saveOp === 'save' || seg2 === 'save')) {
          const body = await readBody(req);
          const session = await localExec.browser.saveSessionHandoff(botId, body || {});
          const receipt = store.appendReceipt({
            botId,
            runId: `handoff-save-${Date.now()}`,
            verdict: 'verified',
            summary: `Saved zero-password browser session handoff "${session.label}" (${session.cookieCount} cookie(s))`,
            files: [{ path: `state/sessions/${session.id}.json`, bytes: 1 }],
            model: { provider: 'mimir-browser', name: 'session-handoff', leftThisComputer: false },
          });
          broadcast('receipt:created', { botId, receipt });
          return json(res, 201, { ok: true, session, receipt });
        }
        if (req.method === 'POST' && seg2 && restoreOp === 'restore') {
          const restored = await localExec.browser.restoreSessionHandoff(botId, seg2);
          const receipt = store.appendReceipt({
            botId,
            runId: `handoff-restore-${Date.now()}`,
            verdict: 'verified',
            summary: `Restored browser session handoff "${restored.session.label}" into active context`,
            model: { provider: 'mimir-browser', name: 'session-handoff', leftThisComputer: false },
          });
          broadcast('receipt:created', { botId, receipt });
          return json(res, 200, { ...restored, receipt });
        }
        if (req.method === 'DELETE' && seg2 && !restoreOp) {
          return json(res, 200, localExec.browser.deleteSessionHandoff(botId, seg2));
        }
      }

      // Agents Roster Status + Live Scaling Metrics + Horizontal Worker Nodes
      if (req.method === 'GET' && p === '/v1/agents/status') {
        return json(res, 200, runner.getActiveStatus());
      }
      if (req.method === 'GET' && p === '/v1/metrics') {
        const rustMetrics = await rustBridge.metrics().catch(err => ({ ok: false, error: err.message }));
        return json(res, 200, { ...scaleQueue.getMetrics(), rust: rustMetrics });
      }
      if (req.method === 'GET' && p === '/v1/rust/health') {
        return json(res, 200, await rustBridge.health());
      }
      if (req.method === 'GET' && p === '/v1/rust/queue/tasks') {
        const status = urlObj.searchParams.get('status') || '';
        const limit = Number(urlObj.searchParams.get('limit') || 100);
        return json(res, 200, await rustBridge.listTasks(status, limit));
      }
      if (req.method === 'POST' && p === '/v1/rust/queue/enqueue') {
        const body = await readBody(req);
        return json(res, 201, await rustBridge.enqueueTask(body));
      }
      if (req.method === 'POST' && p === '/v1/rust/queue/reclaim') {
        return json(res, 200, await rustBridge.reclaimStaleLeases());
      }
      const dlqRequeueMatch = p.match(/^\/v1\/rust\/queue\/dlq\/([^/]+)\/requeue$/);
      if (req.method === 'POST' && dlqRequeueMatch) {
        return json(res, 200, await rustBridge.requeueDlq(decodeURIComponent(dlqRequeueMatch[1])));
      }
      if (req.method === 'GET' && p === '/v1/rust/workers') {
        return json(res, 200, await rustBridge.listWorkers());
      }
      if (req.method === 'POST' && p === '/v1/rust/workers/spawn') {
        const body = await readBody(req);
        return json(res, 201, rustBridge.spawnWorkerNode(body));
      }
      if (req.method === 'POST' && p === '/v1/rust/workers/stop') {
        const body = await readBody(req);
        return json(res, 200, { ok: await rustBridge.stopWorkerNode(body.workerId) });
      }
      if (req.method === 'POST' && p === '/v1/rust/sandbox/check') {
        const body = await readBody(req);
        return json(res, 200, await rustBridge.checkSandbox(body.root || dataDir, body.path || ''));
      }
      if (req.method === 'POST' && p === '/v1/rust/redact') {
        const body = await readBody(req);
        return json(res, 200, await rustBridge.redactText(body.text || '', body.extraSecrets || []));
      }
      if (req.method === 'GET' && p === '/v1/rust/audit') {
        return json(res, 200, await rustBridge.listAudit());
      }
      if (req.method === 'POST' && p === '/v1/workers/probe') {
        const body = await readBody(req);
        const urls = Array.isArray(body.urls) ? body.urls : store.getSettings().workerNodes || [];
        return json(res, 200, { workers: await scaleQueue.probeWorkers(urls) });
      }
      if (req.method === 'POST' && p === '/v1/workers/dispatch') {
        const body = await readBody(req);
        const s = store.getSettings();
        await scaleQueue.probeWorkers(s.workerNodes || []);
        const peer = scaleQueue.pickHealthyWorker(s.workerNodes || []);
        if (peer && !body.forceLocal) {
          scaleQueue.metrics.dispatchedHorizontal++;
          const remoteRes = await fetch(`${peer.url}/v1/chat/send`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ botId: body.botId, userText: body.userText, title: body.title || 'Distributed Task' }),
            signal: AbortSignal.timeout(15000),
          });
          const payload = await remoteRes.json().catch(() => ({}));
          return json(res, remoteRes.ok ? 200 : 502, { dispatchedTo: peer.url, remote: payload });
        }
        const localRes = await runner.runTurn({
          botId: body.botId,
          userText: body.userText,
          title: body.title || 'Scaled Worker Task',
          priority: body.priority || 3,
          idempotencyKey: body.idempotencyKey || null,
        });
        return json(res, 200, { dispatchedTo: 'local-pool', ...localRes });
      }

      // Live 2026 Knowledge + RSI Pipeline + Post-Training Compilation
      if (req.method === 'GET' && p === '/v1/rsi/state') {
        const botId = urlObj.searchParams.get('botId') || null;
        return json(res, 200, {
          stats: rsi.getStats(botId),
          rules: rsi.listRules(botId),
          docs: knowledge.listDocs(),
          sftSample: rsi.readJsonlTail(rsi.sftPath, 10),
          dpoSample: rsi.readJsonlTail(rsi.dpoPath, 10),
        });
      }
      if (req.method === 'POST' && p === '/v1/rsi/knowledge/search') {
        if (store.getSettings().localOnly) {
          return json(res, 403, { error: 'Blocked by local-only policy', code: 'LOCAL_ONLY_BLOCKED' });
        }
        const body = await readBody(req);
        return json(res, 200, await knowledge.ingestFromWebQuery(body.query || '', body.maxResults || 5));
      }
      if (req.method === 'POST' && p === '/v1/rsi/knowledge/ingest-url') {
        const body = await readBody(req);
        if (store.getSettings().localOnly && !isLoopbackUrl(body.url)) {
          return json(res, 403, { error: 'Blocked by local-only policy', code: 'LOCAL_ONLY_BLOCKED' });
        }
        const { fetchUrlText } = await import('./knowledge-rsi.mjs');
        const page = await fetchUrlText(body.url);
        return json(res, 201, knowledge.ingestDocument({ title: page.title, source: 'manual-url', url: page.url, content: page.text, yearTag: '2026' }));
      }
      if (req.method === 'POST' && p === '/v1/rsi/knowledge/ingest-note') {
        const body = await readBody(req);
        return json(res, 201, knowledge.ingestDocument({ title: body.title || '2026 Note', source: 'manual-note', content: body.content || '', yearTag: '2026' }));
      }
      const kDelMatch = p.match(/^\/v1\/rsi\/knowledge\/([^/]+)$/);
      if (req.method === 'DELETE' && kDelMatch) {
        return json(res, 200, { ok: knowledge.deleteDoc(decodeURIComponent(kDelMatch[1])) });
      }
      if (req.method === 'POST' && p === '/v1/rsi/rules') {
        const body = await readBody(req);
        return json(res, 201, rsi.addRule(body));
      }
      const rDelMatch = p.match(/^\/v1\/rsi\/rules\/([^/]+)$/);
      if (req.method === 'DELETE' && rDelMatch) {
        return json(res, 200, { ok: rsi.deleteRule(decodeURIComponent(rDelMatch[1])) });
      }
      if (req.method === 'POST' && p === '/v1/rsi/compile-model') {
        const body = await readBody(req);
        const bot = store.getBot(body.botId || store.listBots()[0]?.id);
        return json(
          res,
          200,
          await rsi.compileDistilledModel({
            bot,
            settings: store.getSettings(),
            baseModel: body.baseModel,
            targetModelName: body.targetModelName || 'mimir-rsi:latest',
          })
        );
      }
      if (req.method === 'POST' && p === '/v1/rsi/pull-model') {
        const body = await readBody(req);
        return json(res, 200, await rsi.pullOllamaModel({ settings: store.getSettings(), model: body.model }));
      }

      // Artifact Foundry & Library View routes
      if (req.method === 'GET' && (p === '/v1/library/artifacts' || p === '/v1/artifacts')) {
        return json(res, 200, { artifacts: await foundry.listArtifacts() });
      }
      if (req.method === 'POST' && (p === '/v1/library/create' || p === '/v1/artifacts/create')) {
        const body = await readBody(req);
        return json(res, 201, await foundry.createArtifact(body));
      }
      const artPatchMatch = p.match(/^\/v1\/(?:library\/artifacts|artifacts)\/([^/]+)$/);
      if (req.method === 'PATCH' && artPatchMatch) {
        const body = await readBody(req);
        return json(res, 200, await foundry.updateMeta(decodeURIComponent(artPatchMatch[1]), body));
      }
      if (req.method === 'DELETE' && artPatchMatch) {
        return json(res, 200, { ok: await foundry.deleteArtifact(decodeURIComponent(artPatchMatch[1])) });
      }
      const artPreviewMatch = p.match(/^\/v1\/(?:library\/artifacts|artifacts)\/([^/]+)\/preview-data$/);
      if (req.method === 'GET' && artPreviewMatch) {
        const previewData = await foundry.getArtifactPreview(decodeURIComponent(artPreviewMatch[1]));
        if (!previewData) return json(res, 404, { error: 'Artifact preview not found' });
        return json(res, 200, {
          artifact: previewData.artifact,
          preview: previewData.preview,
          hasWebmPreview: previewData.hasWebmPreview,
        });
      }
      const artDlMatch = p.match(/^\/v1\/artifacts\/([^/]+)\/download$/);
      if (req.method === 'GET' && artDlMatch) {
        const id = decodeURIComponent(artDlMatch[1]);
        const art = await foundry.getArtifact(id);
        if (!art || !art.file_path || !fs.existsSync(art.file_path)) {
          return json(res, 404, { error: 'Artifact file not found' });
        }
        const wantPreviewVideo = urlObj.searchParams.get('preview_video') === '1';
        const wantPoster = urlObj.searchParams.get('poster') === '1';
        const dir = path.dirname(art.file_path);
        const sidecarWebm = path.join(dir, 'preview.webm');
        const sidecarPoster = path.join(dir, 'poster.png');
        const targetPath = wantPoster && fs.existsSync(sidecarPoster)
          ? sidecarPoster
          : (wantPreviewVideo && fs.existsSync(sidecarWebm) ? sidecarWebm : art.file_path);
        const mimeMap = {
          pdf: 'application/pdf',
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          md: 'text/markdown; charset=utf-8',
          html: 'text/html; charset=utf-8',
          json: 'application/json; charset=utf-8',
          txt: 'text/plain; charset=utf-8',
          png: 'image/png',
          svg: 'image/svg+xml; charset=utf-8',
          zip: 'application/zip',
          webapp: 'application/zip',
          game: 'application/zip',
          csv: 'text/csv; charset=utf-8',
          glb: 'model/gltf-binary',
          obj: 'text/plain; charset=utf-8',
          stl: 'model/stl',
          webm: 'video/webm',
          mp4: 'video/mp4',
          gif: 'image/gif',
          wav: 'audio/wav',
          music: 'audio/wav',
        };
        const inline = urlObj.searchParams.get('inline') === '1';
        const fname = path.basename(targetPath).replace(/["\r\n]/g, '_');
        const effectiveExt = wantPoster && targetPath === sidecarPoster
          ? 'png'
          : (wantPreviewVideo && targetPath === sidecarWebm ? 'webm' : String(art.format || '').toLowerCase());
        const mime = mimeMap[effectiveExt] || 'application/octet-stream';
        const stat = fs.statSync(targetPath);
        const headers = {
          'Content-Type': mime,
          'Content-Length': String(stat.size),
          'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${fname}"`,
          'X-Content-Type-Options': 'nosniff',
          'Cache-Control': 'no-store',
        };
        if (effectiveExt === 'svg' || effectiveExt === 'html') {
          headers['Content-Security-Policy'] = "default-src 'none'; style-src 'unsafe-inline'";
        }
        res.writeHead(200, headers);
        const stream = fs.createReadStream(targetPath);
        stream.on('error', () => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
        return stream.pipe(res);
      }

      // Phase 2-7: Kill Switch, Own-Computer Desktop, Voice, Elephant-Goldfish AGI, Swarm, Connectors, Midgard Map
      if (req.method === 'POST' && p === '/v1/kill-switch') {
        return json(res, 200, await pullKillSwitch('api'));
      }
      if (req.method === 'GET' && p === '/v1/desktop/windows') {
        return json(res, 200, await runDesktopAction({ action: 'list_windows' }));
      }
      if (req.method === 'POST' && p === '/v1/desktop/action') {
        const body = await readBody(req);
        const s = store.getSettings();
        const bot = body.botId ? store.getBot(body.botId) : null;
        const gate = sentinel.evaluateToolRequest({
          agentId: body.agentId || bot?.norseRoleId || 'mimir',
          toolName: 'desktop_control',
          args: body,
          bot,
          executionMode: body.executionMode || s.executionMode || 'agent',
          approvalPolicy: s.approvalPolicy || 'ask-writes',
          localOnly: Boolean(s.localOnly),
          approved: Boolean(body.approved),
          runId: body.runId || `desktop-${Date.now()}`,
        });
        if (gate.decision !== 'ALLOW') {
          return json(res, gate.decision === 'DENY' ? 403 : 202, { ok: false, gate, error: gate.reason });
        }
        return json(res, 200, await runDesktopAction(body));
      }
      if (req.method === 'GET' && p === '/v1/voice/status') {
        return json(res, 200, await voiceEngine.getStatus());
      }
      if (req.method === 'POST' && p === '/v1/voice/tts') {
        const body = await readBody(req);
        const localOnly = Boolean(store.getSettings().localOnly);
        const out = await voiceEngine.synthesize({
          ...body,
          ...(localOnly ? { engine: 'sapi', localOnly: true } : {}),
        });
        if (urlObj.searchParams.get('format') === 'json') {
          const audioBase64 = out.buffer ? out.buffer.toString('base64') : fs.readFileSync(out.outPath).toString('base64');
          return json(res, 200, { ...out, buffer: undefined, audioBase64 });
        }
        const bytes = out.buffer || fs.readFileSync(out.outPath);
        res.writeHead(200, {
          'Content-Type': out.mime,
          'Content-Length': String(bytes.length),
          'Cache-Control': 'no-store',
        });
        return res.end(bytes);
      }
      if (req.method === 'POST' && p === '/v1/voice/stt') {
        const body = await readBody(req);
        return json(res, 200, await voiceEngine.transcribeBase64(body));
      }
      if (req.method === 'POST' && p === '/v1/voice/turn-evaluate') {
        const body = await readBody(req);
        return json(res, 200, evaluateVoiceTurn(body));
      }
      if (req.method === 'POST' && p === '/v1/voice/duplex') {
        const body = await readBody(req);
        const attachments = Array.isArray(body.attachments) ? body.attachments : [];
        let userText = String(body.text || '').trim();
        if (!userText && attachments.length > 0) {
          userText = `Inspect and summarize attached file(s): ${attachments.map(a => a.name || a.path).join(', ')}`;
        }
        if (!userText) return json(res, 400, { error: 'text is required' });

        const s = store.getSettings();
        const localOnly = Boolean(s.localOnly);
        const requestedEngine = localOnly ? 'sapi' : String(body.engine || s.voiceEngine || 'auto');
        const requestedVoice = body.voice || s.voiceName || (localOnly ? 'en-US-David' : 'en-GB-RyanNeural');

        const turn = await runner.runTurn({
          botId: body.botId,
          threadId: body.threadId || null,
          userText,
          title: body.title || 'Live Voice',
          attachments,
          executionMode: body.executionMode,
          trustedUserInput: true, // the user's own spoken words
        });
        const reply = vault.redactText(String(turn?.reply || '').trim());

        let audioBase64 = '';
        let mime = 'audio/wav';
        let engineUsed = 'none';
        let voiceUsed = requestedVoice;
        let fallbackUsed = false;
        let ttsError = null;

        if (reply) {
          try {
            const ttsFn = typeof voiceEngine.synthesizeTurn === 'function'
              ? voiceEngine.synthesizeTurn.bind(voiceEngine)
              : voiceEngine.synthesize.bind(voiceEngine);
            const ttsOut = await ttsFn({
              text: reply,
              voice: requestedVoice,
              engine: requestedEngine,
              rate: Number.isFinite(Number(body.rate)) ? Number(body.rate) : 0,
              localOnly,
            });
            if (ttsOut?.audioBase64) {
              audioBase64 = ttsOut.audioBase64;
            } else if (Buffer.isBuffer(ttsOut?.buffer)) {
              audioBase64 = ttsOut.buffer.toString('base64');
            } else if (ttsOut?.outPath && fs.existsSync(ttsOut.outPath)) {
              audioBase64 = fs.readFileSync(ttsOut.outPath).toString('base64');
            }
            mime = ttsOut?.mime || mime;
            engineUsed = ttsOut?.engine || requestedEngine;
            voiceUsed = ttsOut?.voice || requestedVoice;
            fallbackUsed = Boolean(ttsOut?.fallbackUsed);
          } catch (err) {
            fallbackUsed = true;
            ttsError = vault.redactText(err?.message || String(err));
          }
        } else {
          fallbackUsed = true;
        }

        return json(res, 200, {
          ok: true,
          threadId: turn.threadId,
          reply,
          audioBase64,
          mime,
          engine: engineUsed,
          voice: voiceUsed,
          fallbackUsed,
          ...(ttsError ? { ttsError } : {}),
        });
      }
      if (req.method === 'GET' && p === '/v1/agi/state') {
        const evalPath = path.join(dataDir, 'latest-eval.json');
        let evalReport = null;
        if (fs.existsSync(evalPath)) {
          try {
            evalReport = JSON.parse(fs.readFileSync(evalPath, 'utf8'));
          } catch {}
        }
        return json(res, 200, {
          commands: AGI_COMMANDS,
          tiers: Object.values(MODEL_TIERS),
          hardware: HARDWARE_PROFILE,
          dialogueProfiles: Object.values(MIMIR_DIALOGUE_PROFILES),
          budget: agiHarness.getBudgetState(),
          specs: agiHarness.listSpecs(),
          swarmRuns: dagSwarm.listRuns(),
          recipes: SWARM_RECIPES,
          ...(evalReport ? { evalReport } : {}),
        });
      }
      if (req.method === 'POST' && p === '/v1/agi/elephant') {
        const body = await readBody(req);
        const bot = store.getBot(body.botId || store.listBots()[0]?.id);
        return json(res, 201, await agiHarness.runElephantPhase({
          bot,
          goal: body.goal || 'Analyze workspace cleanly',
          settings: store.getSettings(),
          runChatFn: runChatTurn,
        }));
      }
      if (req.method === 'POST' && p === '/v1/agi/goldfish') {
        const body = await readBody(req);
        return json(res, 200, await agiHarness.runGoldfishAudit({
          specText: body.specText || '',
          targetSummary: body.targetSummary || '',
          settings: store.getSettings(),
          runChatFn: runChatTurn,
        }));
      }
      if (req.method === 'POST' && p === '/v1/agi/eval') {
        const body = await readBody(req);
        const s = store.getSettings();
        const report = await runEvalSuite({
          ollamaUrl: s.ollamaUrl,
          models: body.models || null,
          modes: Array.isArray(body.modes) && body.modes.length ? body.modes : ['baseline', 'harnessed'],
          candidates: body.candidates,
          maxRefine: body.maxRefine,
          agiHarness,
          councilEngine: modelCouncil,
          store,
        });
        fs.writeFileSync(path.join(dataDir, 'latest-eval.json'), JSON.stringify(report, null, 2), 'utf8');
        return json(res, 200, report);
      }
      if (req.method === 'GET' && p === '/v1/agi/eval') {
        const evalPath = path.join(dataDir, 'latest-eval.json');
        if (fs.existsSync(evalPath)) {
          try {
            return json(res, 200, JSON.parse(fs.readFileSync(evalPath, 'utf8')));
          } catch {
            return json(res, 200, { ok: true, benchmarked: [], installedModels: [], corrupt: true });
          }
        }
        return json(res, 200, { ok: true, benchmarked: [], installedModels: [] });
      }
      if (req.method === 'GET' && p === '/v1/swarm/recipes') {
        return json(res, 200, { recipes: SWARM_RECIPES, runs: dagSwarm.listRuns() });
      }
      if (req.method === 'POST' && p === '/v1/swarm/run') {
        const body = await readBody(req);
        return json(res, 200, await dagSwarm.runSwarm({
          botId: body.botId,
          goal: body.goal || 'Analyze & verify repository',
          recipeId: body.recipeId || 'elephant-goldfish-build',
          runChatFn: runChatTurn,
          settings: store.getSettings(),
        }));
      }
      if (req.method === 'GET' && p === '/v1/connectors') {
        const filter = urlObj.searchParams.get('filter') || 'all';
        const query = urlObj.searchParams.get('q') || '';
        return json(res, 200, { connectors: connectors.listConnectors({ filter, query }) });
      }
      const connActMatch = p.match(/^\/v1\/connectors\/([^/]+)\/(connect|test)$/);
      if (req.method === 'POST' && connActMatch) {
        const id = decodeURIComponent(connActMatch[1]);
        const action = connActMatch[2];
        const body = await readBody(req);
        if (action === 'connect') {
          return json(res, 200, connectors.connectAccount(id, body));
        }
        return json(res, 200, await connectors.testConnection(id));
      }
      const connDelMatch = p.match(/^\/v1\/connectors\/([^/]+)$/);
      if (req.method === 'DELETE' && connDelMatch) {
        return json(res, 200, connectors.uninstallConnector(decodeURIComponent(connDelMatch[1])));
      }
      if (req.method === 'GET' && p === '/v1/preflight') return json(res, 200, await runPreflight({ store, rustBridge }));
      if (req.method === 'GET' && p === '/v1/proactive') return json(res, 200, proactive.getOverview());
      if (req.method === 'POST' && p === '/v1/proactive/config') {
        return json(res, 200, proactive.updateConfig(await readBody(req)));
      }
      if (req.method === 'POST' && p === '/v1/proactive/feed/read') {
        proactive.markFeedRead();
        return json(res, 200, { ok: true });
      }
      if (req.method === 'GET' && p === '/v1/routines/dlq') {
        return json(res, 200, { dlq: routines.listDlq() });
      }
      if (req.method === 'GET' && p === '/v1/projects/map') {
        return json(res, 200, await buildMidgardProjectMap({ store, foundry }));
      }
      // Read-only local code graph. Uses Understand Anything's .ua graph when installed.
      // Otherwise scans Mimir's own source. Does not execute repositories or upload code.
      if (req.method === 'GET' && p === '/v1/projects/knowledge-graph') {
        const graph = buildRepositoryKnowledgeGraph();
        const query = urlObj.searchParams.get('q') || '';
        if (!query.trim()) return json(res, 200, graph);
        const matched = findGraphNeighborhood(graph, query, 1, 250);
        const nodeIds = new Set(matched.map(node => node.id));
        return json(res, 200, {
          ...graph,
          nodes: matched,
          edges: graph.edges.filter(edge => nodeIds.has(edge.from) && nodeIds.has(edge.to)),
          query,
          matchCount: matched.length,
        });
      }

      // Model Council (Karpathy Stage 1-3 — Opt-In Policy)
      if (req.method === 'GET' && p === '/v1/council/seats') {
        if (!modelCouncil) return json(res, 503, { error: 'Model Council engine unavailable' });
        const seats = await modelCouncil.listCouncilSeats();
        return json(
          res,
          200,
          redactValue({
            seats,
            councilEnabledByDefault: CONTROL_PLANE_POLICY.councilEnabledByDefault,
            policy: CONTROL_PLANE_POLICY.councilPolicy,
          }),
        );
      }
      if (req.method === 'GET' && p === '/v1/council/history') {
        if (!modelCouncil) return json(res, 503, { error: 'Model Council engine unavailable' });
        const limit = Math.max(1, Math.min(50, Number(urlObj.searchParams.get('limit') || 20)));
        const runs = modelCouncil.listHistory({ limit });
        return json(res, 200, redactValue({ runs }));
      }
      if (req.method === 'POST' && p === '/v1/council/run') {
        if (!modelCouncil) return json(res, 503, { error: 'Model Council engine unavailable' });
        const body = await readBody(req);
        const cleanTopic = String(body.topic || '').trim();
        if (!cleanTopic) return json(res, 400, { error: 'topic is required' });
        const s = store.getSettings();
        const effectiveRag = s.localOnly && ragEngine
          ? { retrieve: opts => ragEngine.retrieve({ ...opts, useWebFallback: false }) }
          : ragEngine;
        const run = await modelCouncil.convene({
          topic: cleanTopic,
          threadId: body.threadId || null,
          seatIds: Array.isArray(body.seatIds) ? body.seatIds : null,
          chairmanSeatId: body.chairmanSeatId || null,
          mode: body.mode || 'standard',
          useRag: body.useRag !== false,
          ragEngine: effectiveRag,
        });
        return json(res, 200, redactValue(run));
      }

      // LightRAG Graph + CRAG Retrieval
      if (req.method === 'GET' && p === '/v1/rag/graph') {
        if (!ragEngine) return json(res, 503, { error: 'RAG engine unavailable' });
        const summary = ragEngine.getGraphSummary();
        const topEntities = ragEngine.graph?.nodes
          ? Object.values(ragEngine.graph.nodes)
              .sort((a, b) => (b.mentions || 0) - (a.mentions || 0))
              .slice(0, 16)
              .map(n => ({ id: n.id, label: n.label, type: n.type, mentions: n.mentions || 0 }))
          : [];
        return json(res, 200, redactValue({ ...summary, topEntities }));
      }
      if (req.method === 'POST' && p === '/v1/rag/query') {
        if (!ragEngine) return json(res, 503, { error: 'RAG engine unavailable' });
        const body = await readBody(req);
        const q = String(body.query || '').trim();
        if (!q) return json(res, 400, { error: 'query is required' });
        const s = store.getSettings();
        const allowWeb = s.localOnly ? false : body.useWebFallback !== false;
        const out = await ragEngine.retrieve({
          query: q,
          topK: body.topK ?? 5,
          useWebFallback: allowWeb,
        });
        return json(
          res,
          200,
          redactValue({
            ...out,
            ...(s.localOnly && body.useWebFallback === true ? { localOnlyBlockedWeb: true } : {}),
          })
        );
      }

      // Hash-Chained Execution Receipts Ledger
      if (req.method === 'GET' && p === '/v1/receipts/verify') {
        return json(res, 200, store.verifyReceiptLedger());
      }
      if (req.method === 'GET' && p === '/v1/receipts') {
        const limit = Number(urlObj.searchParams.get('limit') || 50);
        const threadId = urlObj.searchParams.get('threadId') || null;
        const runId = urlObj.searchParams.get('runId') || null;
        return json(res, 200, {
          receipts: store.listReceipts({ userId, threadId, runId, limit }),
          chain: store.verifyReceiptLedger(),
          userId,
        });
      }
      const rcptMatch = p.match(/^\/v1\/receipts\/([^/]+)$/);
      if (req.method === 'GET' && rcptMatch) {
        const r = store.getReceipt(decodeURIComponent(rcptMatch[1]), userId);
        return r ? json(res, 200, { receipt: r, chain: store.verifyReceiptLedger() }) : json(res, 404, { error: 'Receipt not found' });
      }

      // Durable Run State Machine (/v1/runs)
      const executeRunRecord = async run => {
        try {
          store.updateRun(run.id, { status: 'CLAIMED', note: 'worker claimed lease' });
          store.updateRun(run.id, { status: 'RUNNING', note: 'executing' });
          let out;
          if (run.metadata?.kind === 'research') {
            out = await deepResearch.runResearch({
              query: run.goal,
              mode: run.metadata.mode || 'offline',
              maxSources: run.metadata.maxSources || 8,
              userId: run.userId,
              botId: run.botId,
              exportFormat: run.metadata.exportFormat || null,
              seedCorpus: run.metadata.seedCorpus || null,
            });
          } else {
            out = await runner.runTurn({
              botId: run.botId,
              threadId: run.threadId,
              userText: run.goal,
              title: run.metadata?.title || run.goal.slice(0, 48) || 'Scheduled Run',
              executionMode: run.executionMode || 'agent',
              trustedUserInput: true,
              userId: run.userId,
              runId: run.id,
            });
          }
          store.updateRun(run.id, { status: 'VERIFYING', note: 'checking citations and receipt' });
          const finalReceipt = out?.receipt || store.listReceipts({ userId: run.userId, runId: run.id, limit: 1 })[0] || null;
          const updated = store.updateRun(run.id, {
            status: 'COMPLETED',
            threadId: out?.threadId || run.threadId,
            receiptId: finalReceipt?.id || null,
            note: 'completed with verified receipt',
          });
          return { ok: true, run: updated, receipt: finalReceipt, result: out };
        } catch (err) {
          const updated = store.updateRun(run.id, {
            status: 'FAILED',
            error: vault.redactText(err?.message || String(err)),
            note: 'failed during execution',
          });
          return { ok: false, run: updated, error: updated?.error };
        }
      };

      if (req.method === 'GET' && p === '/v1/runs') {
        const status = urlObj.searchParams.get('status') || null;
        const limit = Number(urlObj.searchParams.get('limit') || 50);
        return json(res, 200, { runs: store.listRuns({ userId, status, limit }), userId });
      }
      if (req.method === 'POST' && p === '/v1/runs') {
        const body = await readBody(req);
        const goal = String(body.goal || body.prompt || '').trim();
        if (!goal) return json(res, 400, { error: 'goal is required' });
        if (body.threadId && !store.getThread(body.threadId, userId)) {
          return json(res, 404, { error: 'Thread not found for current user scope' });
        }
        const { run, deduplicated } = store.createRun({
          idempotencyKey: body.idempotencyKey || null,
          userId,
          botId: body.botId || store.listBots()[0]?.id,
          threadId: body.threadId || null,
          goal,
          executionMode: body.executionMode || 'agent',
          metadata: {
            kind: body.kind || 'agent',
            mode: body.mode || 'offline',
            maxSources: body.maxSources || 8,
            exportFormat: body.exportFormat || null,
            seedCorpus: Array.isArray(body.seedCorpus) ? body.seedCorpus : null,
            title: body.title || null,
          },
        });
        if (deduplicated) {
          const receipt = run.receiptId ? store.getReceipt(run.receiptId, userId) : null;
          return json(res, 200, { ok: true, deduplicated: true, run, receipt });
        }
        if (body.requireApproval) {
          const paused = store.updateRun(run.id, { status: 'WAITING_FOR_APPROVAL', note: 'human approval required before execution' });
          return json(res, 202, { ok: true, run: paused, waitingForApproval: true });
        }
        if (body.async) {
          executeRunRecord(run).catch(() => {});
          return json(res, 202, { ok: true, started: true, run });
        }
        const execOut = await executeRunRecord(run);
        return json(res, execOut.ok ? 200 : 500, execOut);
      }
      const runActMatch = p.match(/^\/v1\/runs\/([^/]+)(?:\/(approve|cancel))?$/);
      if (runActMatch) {
        const runId = decodeURIComponent(runActMatch[1]);
        const op = runActMatch[2] || null;
        const run = store.getRun(runId, userId);
        if (!run) return json(res, 404, { error: 'Run not found' });
        if (req.method === 'GET' && !op) {
          const receipt = run.receiptId ? store.getReceipt(run.receiptId, userId) : null;
          return json(res, 200, { run, receipt });
        }
        if (req.method === 'POST' && op === 'cancel') {
          if (run.threadId) runner.abortThread(run.threadId);
          const cancelled = store.updateRun(run.id, { status: 'CANCELLED', note: 'cancelled by user' });
          return json(res, 200, { ok: true, run: cancelled });
        }
        if (req.method === 'POST' && op === 'approve') {
          if (['CLAIMED', 'RUNNING', 'VERIFYING', 'COMPLETED', 'CANCELLED'].includes(run.status)) {
            return json(res, 409, { error: `Run is already ${run.status}` });
          }
          const body = await readBody(req);
          if (body.decision === 'deny') {
            const cancelled = store.updateRun(run.id, { status: 'CANCELLED', note: 'approval denied' });
            return json(res, 200, { ok: true, denied: true, run: cancelled });
          }
          const execOut = await executeRunRecord(run);
          return json(res, execOut.ok ? 200 : 500, execOut);
        }
      }

      // Deep Research Engine (Offline Corpus + Live Web + Multi-Topic Harvester + Brutal Stress Suite)
      if (req.method === 'GET' && p === '/v1/research/packs') {
        return json(res, 200, {
          packs: RESEARCH_TOPIC_PACKS,
          campaigns: deepResearch.listCampaigns({ userId }),
          automation: deepResearch.getAutomationState(),
          latestBrutalReport: deepResearch.getLatestBrutalReport(),
          knowledge: knowledge.getGraphSummary?.() || null,
        });
      }
      if (req.method === 'POST' && p === '/v1/research/run') {
        const body = await readBody(req);
        const queryText = String(body.query || '').trim();
        if (!queryText) return json(res, 400, { error: 'query is required' });
        const out = await deepResearch.runResearch({
          query: queryText,
          mode: body.mode || 'offline',
          maxSources: body.maxSources || 8,
          userId,
          botId: body.botId || null,
          exportFormat: body.exportFormat || null,
          exportFormats: Array.isArray(body.exportFormats) ? body.exportFormats : null,
          seedCorpus: Array.isArray(body.seedCorpus) ? body.seedCorpus : null,
        });
        return json(res, 200, redactValue(out));
      }
      if (req.method === 'POST' && p === '/v1/research/campaign') {
        const body = await readBody(req);
        const out = await deepResearch.runResearchCampaign({
          packId: body.packId || 'all',
          topics: Array.isArray(body.topics) ? body.topics : [],
          mode: body.mode || 'offline',
          maxSourcesPerTopic: body.maxSourcesPerTopic || 6,
          ingestIntoKnowledge: body.ingestIntoKnowledge !== false,
          exportFormat: body.exportFormat !== undefined ? body.exportFormat : 'csv',
          exportFormats: Array.isArray(body.exportFormats) ? body.exportFormats : null,
          botId: body.botId || null,
          userId,
          seedCorpus: Array.isArray(body.seedCorpus) ? body.seedCorpus : null,
        });
        return json(res, 200, redactValue(out));
      }
      if (req.method === 'POST' && p === '/v1/research/export') {
        const body = await readBody(req);
        const reqFormats = Array.isArray(body.formats) && body.formats.length
          ? body.formats
          : ['md', 'docx', 'pdf'];
        if (!body.runId && !body.campaignId && !body.reportMarkdown && body.query) {
          const run = await deepResearch.runResearch({
            query: String(body.query).trim(),
            mode: body.mode || 'offline',
            maxSources: body.maxSources || 6,
            userId,
            botId: body.botId || null,
            exportFormats: reqFormats,
          });
          return json(res, 200, redactValue({
            ok: true,
            runId: run.id,
            documents: run.artifacts || [],
            artifacts: run.artifacts || [],
          }));
        }
        const out = await deepResearch.exportResearchDocuments({
          runId: body.runId || null,
          campaignId: body.campaignId || null,
          title: body.title || '',
          subtitle: body.subtitle || '',
          reportMarkdown: body.reportMarkdown || '',
          sections: Array.isArray(body.sections) ? body.sections : [],
          rows: Array.isArray(body.rows) ? body.rows : [],
          formats: reqFormats,
          botId: body.botId || null,
        });
        return json(res, 200, redactValue({
          ok: true,
          documents: out.documents || [],
          artifacts: out.documents || [],
        }));
      }
      if (req.method === 'POST' && p === '/v1/research/automate') {
        const body = await readBody(req);
        const out = await deepResearch.configureAutomation({
          enabled: body.enabled !== false,
          intervalMinutes: body.intervalMinutes ?? 60,
          dailyAt: body.dailyAt || '',
          packId: body.packId || 'all',
          topics: Array.isArray(body.topics) ? body.topics : [],
          mode: body.mode || 'offline',
          botId: body.botId || null,
          userId,
          routines,
          runNow: body.runNow !== false,
        });
        return json(res, 200, redactValue(out));
      }
      if (req.method === 'POST' && p === '/v1/research/brutal-test') {
        const body = await readBody(req);
        const out = await deepResearch.runBrutalStressSuite({
          userId,
          botId: body.botId || null,
          routines,
        });
        return json(res, 200, redactValue(out));
      }
      if (req.method === 'GET' && p === '/v1/research/runs') {
        return json(res, 200, { runs: deepResearch.listResearchRuns({ userId }), userId });
      }
      const resRunMatch = p.match(/^\/v1\/research\/runs\/([^/]+)$/);
      if (req.method === 'GET' && resRunMatch) {
        const r = deepResearch.getResearchRun(decodeURIComponent(resRunMatch[1]), userId);
        return r ? json(res, 200, redactValue(r)) : json(res, 404, { error: 'Research run not found' });
      }

      // Yggdrasil Memory Atlas & Tombstone Delete
      if (req.method === 'GET' && p === '/v1/memory/atlas') {
        const q = urlObj.searchParams.get('q') || '';
        const typeFilter = urlObj.searchParams.get('type') || 'all';
        const includeStale = urlObj.searchParams.get('stale') !== '0';
        return json(
          res,
          200,
          await buildMemoryAtlas({ store, foundry, ragEngine, userId, query: q, typeFilter, includeStale }),
        );
      }
      if (req.method === 'POST' && p === '/v1/memory/query') {
        const body = await readBody(req);
        return json(
          res,
          200,
          await buildMemoryAtlas({
            store,
            foundry,
            ragEngine,
            userId,
            query: body.query || '',
            typeFilter: body.typeFilter || 'all',
            includeStale: body.includeStale !== false,
          }),
        );
      }
      const memDelMatch = p.match(/^\/v1\/memory\/([^/]+)$/);
      if (req.method === 'DELETE' && memDelMatch) {
        const target = decodeURIComponent(memDelMatch[1]);
        let deleted = 0;
        for (const bot of store.listBots()) {
          const before = store.getMemories(bot.id, userId).length;
          const afterList = store.deleteMemory(bot.id, target, { userId, reason: 'atlas-tombstone' });
          if (afterList.length < before) deleted += before - afterList.length;
        }
        return json(res, 200, { ok: deleted > 0, deleted, tombstones: store.listTombstones({ userId }) });
      }

      // Multi-User Load Benchmark Metrics
      if (req.method === 'GET' && p === '/v1/metrics/benchmark') {
        const bench = await runMultiUserLoadBenchmark({ userCounts: [1, 2, 4, 8] });
        return json(res, 200, { ...bench, queue: scaleQueue.getMetrics() });
      }

      // Authoritative Control Plane Contracts & Hardware Capability Registry
      if (req.method === 'GET' && p === '/v1/contracts') {
        return json(res, 200, {
          ok: true,
          schemaVersion: SCHEMA_VERSION,
          lifecycleStates: TASK_LIFECYCLE_STATES,
          uiStatusVocabulary: UI_STATUS_VOCABULARY,
          controlPlanePolicy: CONTROL_PLANE_POLICY,
          contractCount: CONTRACT_NAMES.length,
          contracts: CONTRACT_SCHEMAS,
        });
      }
      if (req.method === 'POST' && p === '/v1/contracts/validate') {
        const body = await readBody(req);
        const result = validateContract(body.type, body.payload);
        return json(res, result.ok ? 200 : 400, result);
      }
      if (req.method === 'GET' && p === '/v1/hardware/capabilities') {
        const s = store.getSettings();
        const mlOverview = await modelLibrary?.overview?.().catch(() => null);
        const installedModels = mlOverview
          ? [
              ...(mlOverview.catalog || []).filter(m => m.installed).map(m => m.name),
              ...(mlOverview.extras || []).map(m => m.name),
            ]
          : [];
        return json(
          res,
          200,
          detectHardwareCapabilities({ ollamaModels: installedModels, settings: s }),
        );
      }

      // Mimri 14-Capability Unified Architecture Routes (Subordinated to Primary Node+Rust+SQLite Control Plane)
      if (req.method === 'GET' && p === '/v1/mimri/status') {
        const ov = mimriPlatform.getOverview();
        return json(
          res,
          200,
          redactValue({
            ...ov,
            controlPlaneAuthority: 'node-rust-sqlite-primary',
            pythonRole: 'subordinate-worker-only',
            controlPlanePolicy: CONTROL_PLANE_POLICY,
          }),
        );
      }
      if (req.method === 'GET' && p === '/v1/mimri/infra/traces') {
        return json(res, 200, redactValue(mimriPlatform.getPhoenixTraces()));
      }
      if (req.method === 'POST' && p.startsWith('/v1/mimri/')) {
        const mimriPostHandlers = {
          '/v1/mimri/run-all-phases': b => mimriPlatform.runAllFourPhases(b),
          '/v1/mimri/coding/cli-run': b => mimriPlatform.runCliCodingAgent(b),
          '/v1/mimri/coding/acp-spawn': b => mimriPlatform.spawnAcpSession(b),
          '/v1/mimri/coding/async-sentry': b => mimriPlatform.ingestAsyncErrorWebhook(b),
          '/v1/mimri/coding/pr-review': b => mimriPlatform.reviewPullRequest(b),
          '/v1/mimri/coding/app-builder': b => mimriPlatform.buildWebApp(b),
          '/v1/mimri/evals/swe-bench': b => mimriPlatform.runSweBenchEval(b),
          '/v1/mimri/evals/computer-use': b => mimriPlatform.runComputerUseEval(b),
          '/v1/mimri/evals/reasoning-dsl': b => mimriPlatform.runReasoningDslEval(b),
          '/v1/mimri/infra/sandbox-run': b => mimriPlatform.runEphemeralSandbox(b),
          '/v1/mimri/infra/memory-sync': b => mimriPlatform.syncPersistentMemory(b),
          '/v1/mimri/infra/crawl4ai': b => mimriPlatform.crawlPageToMarkdown(b),
          '/v1/mimri/infra/mcp-hub': b => mimriPlatform.callFastMcpHub(b),
          '/v1/mimri/voice/room-turn': b => mimriPlatform.processLiveKitRoomTurn(b),
        };
        const handler = mimriPostHandlers[p];
        if (handler) {
          const body = await readBody(req);
          return json(res, 200, redactValue(handler(body)));
        }
      }

      // Norse Agent Role Registry (11 functional personas)
      if (req.method === 'GET' && p === '/v1/agents/registry') {
        const probe = await probeModels(store.getSettings()).catch(() => ({ models: [] }));
        const roles = getNorseRegistryWithLiveState({
          installedModels: probe.models || [],
          agentStatuses: runner.getActiveStatus(),
          sentinelStats: sentinel.getStats(),
        });
        return json(res, 200, {
          ok: true,
          count: roles.length,
          roles,
          validation: validateNorseRegistry(),
          sentinelStats: sentinel.getStats(),
        });
      }
      if (req.method === 'POST' && p === '/v1/agents/norse/seed') {
        const created = seedNorseRosterIntoStore(store);
        broadcast('bots:updated', store.listBots());
        return json(res, 200, { ok: true, createdCount: created.length, bots: store.listBots() });
      }
      if (req.method === 'POST' && p === '/v1/agents/route') {
        const body = await readBody(req);
        const role = selectNorseRoleForTask(body.prompt || '', body.surface || '');
        return json(res, 200, { ok: true, role });
      }

      // Independent Sentinel Policy Service & Audit Gateway
      if (req.method === 'GET' && p === '/v1/sentinel/audit') {
        const limit = Number(urlObj.searchParams.get('limit') || 50);
        return json(res, 200, {
          ok: true,
          stats: sentinel.getStats(),
          events: sentinel.listAuditEvents(limit),
        });
      }
      if (req.method === 'POST' && p === '/v1/sentinel/evaluate') {
        const body = await readBody(req);
        const resEval = sentinel.evaluateToolRequest({
          agentId: body.agentId || 'mimir',
          toolName: body.toolName || '',
          args: body.args || {},
          bot: body.botId ? store.getBot(body.botId) : null,
          executionMode: body.executionMode || 'agent',
          localOnly: Boolean(body.localOnly ?? store.getSettings().localOnly),
          approved: Boolean(body.approved),
          runId: body.runId || 'run-eval',
        });
        return json(res, resEval.decision === 'DENY' ? 403 : 200, resEval);
      }

      // Schema-Driven Intelligent UI Planner, Validator & Action Gateway
      if (req.method === 'POST' && p === '/v1/ui/plan') {
        const body = await readBody(req);
        const planned = planUiSpecification({
          prompt: body.prompt || '',
          requestedSurface: body.surface || '',
          answerText: body.answerText || '',
          sources: Array.isArray(body.sources) ? body.sources : [],
          artifacts: Array.isArray(body.artifacts) ? body.artifacts : [],
          toolEvents: Array.isArray(body.toolEvents) ? body.toolEvents : [],
          approval: body.approval || null,
          receipt: body.receipt || null,
          checklist: Array.isArray(body.checklist) ? body.checklist : null,
          comparisonRows: Array.isArray(body.comparisonRows) ? body.comparisonRows : null,
          chartSeries: Array.isArray(body.chartSeries) ? body.chartSeries : null,
          codeFiles: Array.isArray(body.codeFiles) ? body.codeFiles : null,
          browserState: body.browserState || null,
          yggdrasilStats: body.yggdrasilStats || null,
          runId: body.runId || null,
          taskId: body.taskId || null,
        });
        return json(res, planned.valid ? 200 : 400, planned);
      }
      if (req.method === 'POST' && p === '/v1/ui/validate') {
        const body = await readBody(req);
        const result = validateUiSpec(body.spec || body);
        return json(res, result.valid ? 200 : 400, result);
      }
      if (req.method === 'POST' && p === '/v1/ui/action') {
        const body = await readBody(req);
        const gate = sentinel.evaluateUiAction({
          actionId: body.actionId || '',
          payload: body.payload || {},
          surface: body.surface || 'chat',
          approved: (authCheck.mode === 'master' || authCheck.mode === 'local-open') && Boolean(body.approved),
          roleId: body.roleId || 'mimir',
        });
        if (gate.decision !== 'ALLOW') {
          return json(res, gate.decision === 'DENY' ? 403 : 202, { ok: false, gate });
        }
        let actionResult = { actionId: body.actionId, status: 'executed' };
        if (body.actionId === 'toggle_checklist_item' && body.payload?.itemId) {
          actionResult = store.toggleUiChecklistItem(String(body.payload.itemId), body.payload.checked ?? null);
          broadcast('ui:checklist', actionResult);
        } else if (body.actionId === 'pin_space') {
          const sp = store.createSpace({
            title: body.payload?.title || 'Pinned Workspace',
            surface: body.payload?.surface || 'chat',
            description: body.payload?.description || '',
            userId,
          });
          broadcast('spaces:updated', store.listSpaces(userId));
          actionResult = { space: sp };
        }
        return json(res, 200, { ok: true, gate, result: actionResult });
      }
      if (req.method === 'GET' && p === '/v1/ui/checklists') {
        return json(res, 200, { ok: true, items: store.getUiChecklists() });
      }

      // Persistent User Spaces (Muse Spaces)
      if (req.method === 'GET' && p === '/v1/spaces') {
        return json(res, 200, { ok: true, spaces: store.listSpaces(userId) });
      }
      if (req.method === 'POST' && p === '/v1/spaces') {
        const body = await readBody(req);
        const space = store.createSpace({ ...body, userId });
        broadcast('spaces:updated', store.listSpaces(userId));
        return json(res, 201, { ok: true, space });
      }
      const spaceItemMatch = p.match(/^\/v1\/spaces\/([a-zA-Z0-9_-]+)$/);
      if (spaceItemMatch) {
        const spaceId = spaceItemMatch[1];
        if (req.method === 'PATCH') {
          const body = await readBody(req);
          let space = null;
          if (typeof store.updateSpace === 'function') {
            space = store.updateSpace(spaceId, body, userId);
          } else {
            const list = store.listSpaces(userId);
            space = list.find(s => s.id === spaceId) || null;
            if (space) {
              if ('title' in body && body.title !== undefined) space.title = String(body.title || 'Custom Space').trim().slice(0, 48);
              if ('surface' in body && body.surface !== undefined) space.surface = String(body.surface || 'chat').trim().toLowerCase();
              if ('icon' in body && body.icon !== undefined) space.icon = String(body.icon || 'layers').trim();
              if ('description' in body && body.description !== undefined) space.description = String(body.description || '').trim().slice(0, 160);
              if ('pinned' in body) space.pinned = Boolean(body.pinned);
              if ('systemPrompt' in body) space.systemPrompt = String(body.systemPrompt || '');
              if ('attachedPaths' in body) space.attachedPaths = Array.isArray(body.attachedPaths) ? body.attachedPaths.map(String) : [];
              if ('defaultBotId' in body) space.defaultBotId = body.defaultBotId ? String(body.defaultBotId) : null;
              if ('memoryScope' in body) space.memoryScope = body.memoryScope === 'global' ? 'global' : 'space';
              store.save?.();
            }
          }
          if (!space) return json(res, 404, { error: 'Space not found' });
          broadcast('spaces:updated', store.listSpaces(userId));
          return json(res, 200, { ok: true, space });
        }
        if (req.method === 'DELETE') {
          const deleted = store.deleteSpace(spaceId, userId);
          broadcast('spaces:updated', store.listSpaces(userId));
          return json(res, deleted ? 200 : 404, { ok: deleted, deleted });
        }
      }

      return json(res, 404, { error: `Unknown route: ${req.method} ${p}` });
    } catch (err) {
      return json(res, err?.status || 500, { error: err?.message || String(err), code: err?.code });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    if (!isAllowedOrigin(req.headers.origin)) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    let urlObj;
    try {
      urlObj = new URL(req.url, 'http://127.0.0.1');
    } catch {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }
    if (urlObj.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    const ticketParam = urlObj.searchParams.get('ticket') || '';
    let wsAuth;
    if (ticketParam) {
      pruneWsTickets();
      const entry = wsTickets.get(ticketParam);
      wsTickets.delete(ticketParam);
      if (!entry || Date.now() >= entry.expiresAt) {
        wsAuth = { ok: false, code: 'WS_TICKET_INVALID' };
      } else if (entry.mode === 'session' && (!entry.sessionToken || !pairingSessions.has(entry.sessionToken))) {
        wsAuth = { ok: false, code: 'SESSION_EXPIRED' };
      } else {
        wsAuth = { ok: true, mode: entry.mode };
      }
    } else {
      const headerAuth = String(req.headers.authorization || '');
      const bearerTok = headerAuth.startsWith('Bearer ') ? headerAuth.slice(7).trim() : '';
      wsAuth = verifyBearer(urlObj.searchParams.get('token') || bearerTok || '');
    }
    if (!wsAuth.ok) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => {
      wsClients.add(ws);
      ws.on('close', () => wsClients.delete(ws));
    });
  });

  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const actualPort = server.address().port;
  const info = { port: actualPort, url: `http://127.0.0.1:${actualPort}`, token };
  publicUrl = info.url;

  return {
    ...info,
    store,
    vault,
    mcpManager,
    localExec,
    runner,
    routines,
    knowledge,
    ragEngine,
    modelCouncil,
    rsi,
    scaleQueue,
    rustBridge,
    foundry,
    voiceEngine,
    agiHarness,
    dagSwarm,
    connectors,
    proactive,
    deepResearch,
    mimriPlatform,
    listPendingPairings() {
      prunePairingState();
      return [...pairingRequests.values()].map(r => ({ ...r }));
    },
    async close() {
      runner.killAllRuns();
      dagSwarm.abortAll?.();
      proactive.stop();
      mcpManager.disconnectAll();
      await localExec.browser.closeAll();
      await voiceEngine.close?.();
      await rustBridge.close();
      for (const ws of wsClients) {
        try { ws.close(); } catch {}
        setTimeout(() => { try { ws.terminate?.(); } catch {} }, 100).unref?.();
      }
      server.closeAllConnections?.();
      await new Promise(resolve => server.close(resolve));
    },
  };
}

// Run standalone when invoked directly (`node daemon/coordinator.mjs` or `fork()`)
const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntrypoint) {
  startCoordinator()
    .then(ctx => {
      const payload = { port: ctx.port, url: ctx.url, token: ctx.token };
      console.log(`COORDINATOR_READY ${JSON.stringify(payload)}`);
      process.send?.({ type: 'COORDINATOR_READY', ...payload });

      const shutdown = async () => {
        await ctx.close();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    })
    .catch(err => {
      console.error(err);
      process.exit(1);
    });
}
