import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { runChatTurn } from './llm-provider.mjs';

export const HARDWARE_PROFILE = Object.freeze({
  gpu: 'NVIDIA GeForce RTX 3050 6GB Laptop GPU',
  vramTotalMiB: 6144,
  note: '1.7B & 4B quantized models fit inside 6GB VRAM; 9B spills partially to system RAM/CPU with higher latency. Local models do NOT match frontier models without BYOK escalation.',
});

export const MODEL_TIERS = Object.freeze({
  fast_local: {
    id: 'fast_local',
    label: 'Fast Local (Qwen3 1.7B)',
    provider: 'ollama',
    model: 'qwen3:1.7b',
    vramEstMiB: 1600,
    usdPer1kTokens: 0,
    bestFor: 'Instant triage, voice formatting, single tool calls',
  },
  balanced_local: {
    id: 'balanced_local',
    label: 'Balanced Local (Qwen3.5 4B)',
    provider: 'ollama',
    model: 'qwen3.5:4b',
    vramEstMiB: 3600,
    usdPer1kTokens: 0,
    bestFor: 'Default daily work, planning, JSON tools inside 6GB VRAM',
  },
  heavy_local: {
    id: 'heavy_local',
    label: 'Heavy Local (Qwen3.5 9B)',
    provider: 'ollama',
    model: 'qwen3.5:9b',
    vramEstMiB: 6600,
    usdPer1kTokens: 0,
    bestFor: 'Deep multi-file synthesis (slower CPU/RAM offload on 6GB GPU)',
  },
  cloud_byok: {
    id: 'cloud_byok',
    label: 'Frontier Cloud (BYOK OpenAI-Compat)',
    provider: 'openai-compat',
    model: null,
    vramEstMiB: 0,
    usdPer1kTokens: 0.006,
    bestFor: 'Complex multi-step reasoning when local eval accuracy is insufficient',
  },
});

export const MIMIR_DIALOGUE_PROFILES = Object.freeze({
  counselor: {
    id: 'counselor',
    label: 'Mimir Counselor (Scottish Norse Wit)',
    promptPrefix: [
      'Voice & Dialogue Persona: Speak as Mimir, this app\'s own ancient counselor of the Well of Wisdom: warm, dry wit, plain words, the occasional Norse image. Write original lines; never quote or imitate catchphrases from games, films or books.',
      'Honesty Rule: Never invent facts, tools, files, or benchmarks. When uncertain, say clearly what has not been verified yet.',
      'Style: Terse, practical, dry humor, zero purple prose. Keep technical outputs crisp.',
    ].join('\n'),
  },
  minimal: {
    id: 'minimal',
    label: 'Minimal Precision (No Persona)',
    promptPrefix: 'Voice & Dialogue Persona: Crisp senior engineer tone. Zero fluff, exact observations only.',
  },
  raw: {
    id: 'raw',
    label: 'Raw Technical Output',
    promptPrefix: 'Output direct facts, code, and structured JSON without conversational framing.',
  },
});

export const AGI_COMMANDS = Object.freeze([
  { cmd: '/elephant', syntax: '/elephant <goal>', desc: 'Long-horizon Architect phase: reads workspace + memory -> writes SPEC without blind coding' },
  { cmd: '/goldfish', syntax: '/goldfish <spec-or-topic>', desc: 'Zero-context fresh adversarial reviewer: exposes hidden blind spots and security gaps' },
  { cmd: '/swarm', syntax: '/swarm <goal>', desc: 'Run multi-agent DAG (Supervisor -> Planner -> Executor -> Goldfish Critic -> Integrator)' },
  { cmd: '/council', syntax: '/council <topic>', desc: 'Convene multi-model LLM Council (Stage 1 Opinions -> Anonymized Borda Critique -> Chairman Synthesis)' },
  { cmd: '/spawn', syntax: '/spawn <role> | <goal>', desc: 'Spawn a specialist sub-agent worker with an explicit role and bounded goal' },
  { cmd: '/research', syntax: '/research <topic>', desc: 'Run LightRAG entity graph + CRAG web-fallback retrieval with Self-RAG citations' },
  { cmd: '/voice', syntax: '/voice <phrase>', desc: 'Synthesize offline/neural Mimir voice playback and attach spoken response' },
  { cmd: '/eval', syntax: '/eval', desc: 'Run quantitative local model eval probe across installed Ollama tiers' },
  { cmd: '/forge', syntax: '/forge <title> | <format>', desc: 'Generate verified deliverable artifact (pdf/docx/pptx/xlsx/png/svg/zip)' },
  { cmd: '/rea', syntax: '/rea [focus]', desc: 'Reverse-engineer app modules, routes, and live runtime architecture' },
  { cmd: '/library', syntax: '/library', desc: 'List Library artifacts and Foundry storage summary' },
  { cmd: '/map', syntax: '/map', desc: 'Inspect Midgard Nine-Realms workspace topology summary' },
  { cmd: '/kill', syntax: '/kill', desc: 'Emergency Kill Switch: abort all active runs and close browser sessions' },
]);

export function parseAgiCommand(rawText) {
  const text = String(rawText || '').trim();
  const match = text.match(/^\/([a-z]+)(?:\s+([\s\S]+))?$/i);
  if (!match) return null;
  const cmd = `/${match[1].toLowerCase()}`;
  const arg = String(match[2] || '').trim();
  const known = AGI_COMMANDS.find(c => c.cmd === cmd);
  if (!known) return null;
  return { cmd, arg, def: known };
}

/**
 * Formats a tool gate or routine step into an x.ai/bot-style "Needs your OK" dialogue card.
 */
export function buildDialogueCard({
  id,
  threadId,
  botId,
  toolName,
  args = {},
  reason = '',
  reversibility = null,
  reversibilityLabel = '',
  customTitle = '',
  customSubtitle = '',
}) {
  const cleanArgs = JSON.stringify(args || {}).slice(0, 140);
  let title = customTitle || `${toolName}`;
  let subtitle = customSubtitle || reason || cleanArgs || 'Awaiting confirmation before running action';
  let primaryLabel = 'Approve & Run';
  let secondaryLabel = 'Review first';
  const inferredRev = reversibility || (toolName === 'fs_write' ? 'reversible' : 'irreversible');
  const revLabel = reversibilityLabel || (inferredRev === 'irreversible' ? 'Irreversible · Human Gate' : 'Reversible · Sandboxed Write');

  if (toolName === 'shell_exec') {
    title = `Shell Command`;
    subtitle = `${String(args.command || '').slice(0, 120)}`;
    primaryLabel = 'Run it';
    secondaryLabel = 'Deny';
  } else if (toolName === 'fs_write') {
    title = `Write File · ${args.path || 'workspace'}`;
    subtitle = `${String(args.content || '').length} bytes into workspace`;
    primaryLabel = 'Save file';
    secondaryLabel = 'Review diff';
  } else if (toolName === 'desktop_control') {
    title = `Own Computer · ${args.action || 'action'}`;
    subtitle = args.text ? `Input text (${String(args.text).length} chars)` : reason;
    primaryLabel = 'Allow action';
  } else if (String(toolName || '').includes('send') || String(toolName || '').includes('email')) {
    title = `Outbound Send · ${args.to || toolName}`;
    subtitle = `${args.subject || cleanArgs}`;
    primaryLabel = 'Send it';
    secondaryLabel = 'Edit first';
  }

  return {
    id,
    threadId,
    botId,
    toolName,
    args,
    badge: 'Needs your OK',
    reversibility: inferredRev,
    reversibilityLabel: revLabel,
    title,
    subtitle,
    primaryLabel,
    secondaryLabel,
    timestampLabel: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }),
  };
}

function isTrivialChatPrompt(prompt, verifierFn, ragContext) {
  if (typeof verifierFn === 'function') return false;
  if (String(ragContext || '').trim().length > 0) return false;
  const clean = String(prompt || '').trim();
  if (!clean) return true;
  const hardSignalRe = /\b(json|schema|code|bug|error|debug|fix|implement|refactor|plan|architect|compare|analyze|audit|verify|constraint|must|exactly|step|steps|regex|sql|function|class|test|migrate|cite|diagnose)\b/i;
  if (clean.length <= 60 && !hardSignalRe.test(clean) && !/[{}\[\]`]|\n|^\s*\d+\./m.test(clean)) {
    return true;
  }
  return false;
}

async function normalizeVerifierCheck(verifierFn, reply) {
  if (typeof verifierFn !== 'function') {
    const ok = Boolean(String(reply || '').trim());
    return { ok, reason: ok ? '' : 'Empty response' };
  }
  const raw = await verifierFn(reply);
  if (typeof raw === 'boolean') {
    return { ok: raw, reason: raw ? '' : 'Failed deterministic verifier check' };
  }
  if (raw && typeof raw === 'object') {
    const ok = Boolean(raw.ok ?? raw.passed ?? raw.valid);
    return { ok, reason: String(raw.reason || raw.feedback || raw.error || (ok ? '' : 'Failed deterministic verifier check')) };
  }
  return { ok: Boolean(raw), reason: raw ? '' : 'Failed deterministic verifier check' };
}

function scoreHeuristicCandidate(text, prompt) {
  const clean = String(text || '').trim();
  if (!clean || /^error:/i.test(clean)) return -1;
  let score = Math.min(clean.length, 600) / 600;
  const pWords = String(prompt || '').toLowerCase().split(/\W+/).filter(w => w.length >= 4);
  const cLower = clean.toLowerCase();
  let hits = 0;
  for (const w of new Set(pWords)) {
    if (cLower.includes(w)) hits++;
  }
  if (pWords.length) score += (hits / Math.min(pWords.length, 10)) * 0.6;
  if (/^\s*[\[{]/.test(clean) || /^\s*1\.\s+/m.test(clean)) score += 0.25;
  return score;
}

export class AgiHarness {
  constructor({ dataDir = os.tmpdir(), store = null, knowledge = null, rsi = null, foundry = null, scaleQueue = null, runChatFn = null } = {}) {
    this.dataDir = dataDir;
    this.store = store;
    this.knowledge = knowledge;
    this.rsi = rsi;
    this.foundry = foundry;
    this.scaleQueue = scaleQueue;
    this.runChatFn = runChatFn;
    this.budgetPath = path.join(dataDir, 'budget-ledger.json');
    this.specsPath = path.join(dataDir, 'elephant-specs.json');
  }

  static async runSmallModelBoostedTurn(opts = {}) {
    const instance = new AgiHarness({
      dataDir: opts.dataDir || opts.store?.dataDir || os.tmpdir(),
      store: opts.store || null,
      runChatFn: opts.runChatFn || null,
    });
    return instance.runSmallModelBoostedTurn(opts);
  }

  getBudgetState() {
    try {
      if (fs.existsSync(this.budgetPath)) {
        return JSON.parse(fs.readFileSync(this.budgetPath, 'utf8'));
      }
    } catch {}
    return { month: new Date().toISOString().slice(0, 7), totalTokens: 0, spentUsd: 0, turns: 0 };
  }

  recordUsage({ model = '', tokens = 0, provider = 'ollama' }) {
    const s = this.store.getSettings();
    const curMonth = new Date().toISOString().slice(0, 7);
    let ledger = this.getBudgetState();
    if (ledger.month !== curMonth) {
      ledger = { month: curMonth, totalTokens: 0, spentUsd: 0, turns: 0 };
    }
    const rate = provider === 'openai-compat' ? MODEL_TIERS.cloud_byok.usdPer1kTokens : 0;
    const cost = (Number(tokens) / 1000) * rate;
    ledger.totalTokens += Number(tokens) || 0;
    ledger.spentUsd = Number((ledger.spentUsd + cost).toFixed(6));
    ledger.turns += 1;
    ledger.lastModel = model;
    ledger.monthlyLimitUsd = Number(s.monthlyBudgetUsd ?? 25);
    const tmp = `${this.budgetPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2), 'utf8');
    fs.renameSync(tmp, this.budgetPath);
    return ledger;
  }

  checkBudgetCeiling() {
    const s = this.store.getSettings();
    const limit = Number(s.monthlyBudgetUsd ?? 25);
    const ledger = this.getBudgetState();
    if (limit > 0 && ledger.spentUsd >= limit) {
      throw new Error(`Budget ceiling reached ($${ledger.spentUsd.toFixed(2)} >= $${limit.toFixed(2)}/mo). Raise ceiling or route to free local Ollama tier.`);
    }
    return ledger;
  }

  selectModelRoute({ userText = '', settings = {}, tierOverride = null }) {
    const text = String(userText || '');
    let tierId = tierOverride || settings.defaultModelTier || 'balanced_local';
    if (!tierOverride && !settings.defaultModelTier) {
      if (text.length < 70 && !/\b(architect|plan|audit|security|multi-file|refactor|research)\b/i.test(text)) {
        tierId = 'fast_local';
      } else if (/\b(deep synthesis|entire repo|full architecture|complex proof)\b/i.test(text)) {
        tierId = settings.openaiBaseUrl && settings.openaiApiKey && !settings.localOnly ? 'cloud_byok' : 'heavy_local';
      } else {
        tierId = 'balanced_local';
      }
    }
    const tier = MODEL_TIERS[tierId] || MODEL_TIERS.balanced_local;
    // Tiers map to whatever this machine has installed (model-library.mjs pickTiers). The names
    // in MODEL_TIERS are only a fallback for a machine where detection has not run yet.
    const installedForTier = tier.provider === 'ollama' ? settings.autoTierModels?.[tier.id] : null;
    return {
      ...tier,
      ...(installedForTier ? { model: installedForTier } : {}),
      resolvedModel: installedForTier || tier.model || settings.openaiModel || settings.ollamaModel || 'qwen3.5:4b',
      hardwareNote: HARDWARE_PROFILE.note,
    };
  }

  #listSpecs() {
    try {
      if (fs.existsSync(this.specsPath)) {
        const list = JSON.parse(fs.readFileSync(this.specsPath, 'utf8'));
        return Array.isArray(list) ? list : [];
      }
    } catch {}
    return [];
  }

  #saveSpec(spec) {
    const all = this.#listSpecs();
    all.unshift(spec);
    if (all.length > 40) all.length = 40;
    const tmp = `${this.specsPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(all, null, 2), 'utf8');
    fs.renameSync(tmp, this.specsPath);
  }

  listSpecs() {
    return this.#listSpecs();
  }

  /**
   * ELEPHANT PHASE (Long-Horizon Memory Architect):
   * Reads workspace tree, memories, and 2026 knowledge base; writes strict SPEC; NEVER executes blind code mutations.
   */
  async runElephantPhase({ bot, goal, settings, runChatFn, signal = null }) {
    const ws = this.store.getBotWorkspace(bot.id);
    const files = fs.existsSync(ws) ? fs.readdirSync(ws).slice(0, 30) : [];
    const memories = this.store.getMemories(bot.id).slice(0, 12);
    const kbHits = this.knowledge ? this.knowledge.query(goal, 5) : [];

    const sys = [
      'You are the ELEPHANT (Long-Horizon Architect) inside Mimir’s Elephant-Goldfish Harness.',
      'RULE: Produce ONLY a concrete, testable Engineering Specification. Never write implementation code or claim work is already done.',
      'Sections required: 1) Goal & Non-Goals, 2) Exact Files/Modules Touched, 3) Invariants & Security Boundaries, 4) Failure Modes, 5) Verification Commands.',
    ].join('\n');

    const prompt = [
      `Goal: ${goal}`,
      `Bot: ${bot.name} (${bot.role})`,
      `Workspace files (${ws}): ${files.join(', ') || '(empty workspace)'}`,
      `Memories: ${memories.map(m => `${m.key}=${m.value}`).join('; ') || 'none'}`,
      `Knowledge 2026 hits: ${kbHits.map(k => `[${k.title}] ${k.text.slice(0, 160)}`).join(' | ') || 'none'}`,
    ].join('\n\n');

    const res = await runChatFn({
      settings: { ...settings, ollamaThink: false },
      modelOverride: settings.ollamaModel || MODEL_TIERS.balanced_local.model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: prompt },
      ],
      tools: [],
      signal,
    });

    const spec = {
      id: `spec-${crypto.randomBytes(4).toString('hex')}`,
      role: 'elephant',
      botId: bot.id,
      goal,
      specText: res.content || '',
      model: res.model,
      createdAt: new Date().toISOString(),
    };
    this.#saveSpec(spec);
    this.knowledge?.ingestDocument?.({
      title: `Elephant Spec: ${goal.slice(0, 50)}`,
      source: 'elephant-architect',
      content: spec.specText,
      yearTag: '2026',
    });
    return spec;
  }

  /**
   * GOLDFISH PHASE (Stateless Zero-Context Adversarial Reviewer):
   * Receives ZERO conversation history — ONLY the spec/target artifact — to expose unstated assumptions and bugs.
   */
  async runGoldfishAudit({ specText, targetSummary = '', settings, runChatFn, signal = null }) {
    const sys = [
      'You are the GOLDFISH (Zero-Context Adversarial Reviewer) inside Mimir.',
      'You have ZERO conversational memory of prior debates. Treat every claim skeptically.',
      'Evaluate the specification or deliverable below and list: (a) Hidden assumptions/ambiguities, (b) Security/sandbox/concurrency risks, (c) Missing verification checks.',
      'End cleanly with a single line: VERDICT: PASS or VERDICT: FLAG or VERDICT: FAIL.',
    ].join('\n');

    const user = [
      '=== SPECIFICATION / DELIVERABLE TO REFUTE ===',
      String(specText || '').slice(0, 6000),
      targetSummary ? `\n=== TARGET CONTEXT ===\n${String(targetSummary).slice(0, 2000)}` : '',
    ].join('\n');

    const res = await runChatFn({
      settings: { ...settings, ollamaThink: false },
      modelOverride: settings.ollamaModel || MODEL_TIERS.balanced_local.model,
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      tools: [],
      signal,
    });

    const txt = String(res.content || '');
    const verdictMatch = txt.match(/VERDICT:\s*(PASS|FLAG|FAIL)/i);
    const verdict = verdictMatch ? verdictMatch[1].toUpperCase() : 'FLAG';

    return {
      id: `gf-${crypto.randomBytes(4).toString('hex')}`,
      role: 'goldfish',
      verdict,
      critique: txt,
      model: res.model,
      contextIsolated: true,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Snell et al. (2024) Adaptive Test-Time Compute + Best-of-N + Shinn (2023) Reflexion critique loop.
   */
  async runSmallModelBoostedTurn({
    prompt,
    model = 'qwen3:1.7b',
    candidates = 3,
    verifierFn = null,
    ragContext = '',
    maxRefine = 2,
    signal = null,
    runChatFn = null,
    settings = null,
  } = {}) {
    const startedMs = performance.now();
    const cleanPrompt = String(prompt || '').trim();
    const chatFn = runChatFn || this.runChatFn || runChatTurn;
    const baseSettings = settings || this.store?.getSettings?.() || {
      provider: 'ollama',
      ollamaUrl: 'http://127.0.0.1:11434',
      ollamaModel: model,
      ollamaThink: false,
    };
    const effSettings = { ...baseSettings, ollamaThink: false };
    const ctxBlock = String(ragContext || '').trim();
    const userPrompt = ctxBlock ? `${cleanPrompt}\n\nGrounded Context:\n${ctxBlock}` : cleanPrompt;
    const reflectionNotes = [];
    let candidatesTried = 0;

    const checkAborted = () => {
      if (signal?.aborted) throw new Error('Boosted turn aborted');
    };
    const recordEstUsage = content => {
      if (!this.store?.getSettings) return;
      const tokens = Math.ceil((cleanPrompt.length + String(content || '').length) / 4);
      try {
        this.recordUsage({ model, tokens, provider: effSettings.provider || 'ollama' });
      } catch {
        // Never fail boosted turn on ledger persistence issues
      }
    };

    // Adaptive test-time compute: skip N>1 on trivial chat when no verifier is required
    if (isTrivialChatPrompt(cleanPrompt, verifierFn, ctxBlock)) {
      checkAborted();
      const res = await chatFn({
        settings: effSettings,
        modelOverride: model,
        messages: [
          { role: 'system', content: 'Respond concisely and honestly.' },
          { role: 'user', content: userPrompt },
        ],
        tools: [],
        signal,
      });
      candidatesTried = 1;
      const reply = String(res?.content || '').trim();
      recordEstUsage(reply);
      const v = await normalizeVerifierCheck(verifierFn, reply);
      return {
        reply,
        candidatesTried,
        passedVerifier: v.ok,
        reflectionNotes,
        totalMs: Math.round(performance.now() - startedMs),
      };
    }

    const strategies = [
      'Follow every explicit format, JSON, length, and keyword constraint literally.',
      'Reason carefully through every requirement and edge case before emitting the final answer.',
      'Check for hidden pitfalls, negative constraints, and exact output formatting before answering.',
      'Synthesize a direct, high-precision response grounded strictly in provided context.',
    ];
    const targetN = Math.max(1, Math.min(Number(candidates) || 3, 6));
    const attempts = [];

    for (let i = 0; i < targetN; i++) {
      checkAborted();
      const strategy = strategies[i % strategies.length];
      let content = '';
      let callErr = null;
      try {
        const res = await chatFn({
          settings: effSettings,
          modelOverride: model,
          messages: [
            { role: 'system', content: `You are Mimir running adaptive test-time compute (candidate ${i + 1}/${targetN}). ${strategy}` },
            { role: 'user', content: userPrompt },
          ],
          tools: [],
          signal,
        });
        content = String(res?.content || '').trim();
        recordEstUsage(content);
      } catch (err) {
        if (signal?.aborted) throw err;
        callErr = err?.message || String(err);
      }
      candidatesTried++;
      const v = callErr
        ? { ok: false, reason: callErr }
        : await normalizeVerifierCheck(verifierFn, content);

      if (typeof verifierFn === 'function' && v.ok) {
        return {
          reply: content,
          candidatesTried,
          passedVerifier: true,
          reflectionNotes,
          totalMs: Math.round(performance.now() - startedMs),
        };
      }
      attempts.push({
        content,
        reason: v.reason,
        heuristic: scoreHeuristicCandidate(content, cleanPrompt),
      });
    }

    attempts.sort((a, b) => b.heuristic - a.heuristic);
    let best = attempts[0] || { content: '', reason: 'No candidate produced', heuristic: -1 };

    if (typeof verifierFn !== 'function') {
      const v = await normalizeVerifierCheck(null, best.content);
      return {
        reply: best.content,
        candidatesTried,
        passedVerifier: v.ok,
        reflectionNotes,
        totalMs: Math.round(performance.now() - startedMs),
      };
    }

    // Shinn (2023) Reflexion critique + refine loop
    const refineLimit = Math.max(0, Math.min(Number(maxRefine) || 0, 4));
    for (let r = 0; r < refineLimit; r++) {
      checkAborted();
      let reflection = `Attempt failed verifier: ${best.reason || 'constraint mismatch'}`;
      try {
        const critRes = await chatFn({
          settings: effSettings,
          modelOverride: model,
          messages: [
            {
              role: 'system',
              content: 'You are a Reflexion critic. State in 1-2 crisp sentences why the previous attempt failed verification and the exact change needed.',
            },
            {
              role: 'user',
              content: `Task:\n${userPrompt}\n\nFailed Output:\n${best.content || '(empty)'}\n\nVerifier Feedback:\n${best.reason}`,
            },
          ],
          tools: [],
          signal,
        });
        const critText = String(critRes?.content || '').trim();
        if (critText) reflection = critText;
        recordEstUsage(critText);
      } catch (err) {
        if (signal?.aborted) throw err;
      }
      reflectionNotes.push(reflection);

      checkAborted();
      let refined = '';
      let refineErr = null;
      try {
        const refRes = await chatFn({
          settings: effSettings,
          modelOverride: model,
          messages: [
            {
              role: 'system',
              content: 'Apply the Reflexion self-critique below to fix all verifier failures. Output ONLY the corrected final answer.',
            },
            {
              role: 'user',
              content: `Task:\n${userPrompt}\n\nPrevious Attempt:\n${best.content}\n\nReflexion Critique:\n${reflection}\n\nVerifier Failure:\n${best.reason}\n\nProduce the fixed output now:`,
            },
          ],
          tools: [],
          signal,
        });
        refined = String(refRes?.content || '').trim();
        recordEstUsage(refined);
      } catch (err) {
        if (signal?.aborted) throw err;
        refineErr = err?.message || String(err);
      }
      candidatesTried++;

      const v = refineErr
        ? { ok: false, reason: refineErr }
        : await normalizeVerifierCheck(verifierFn, refined);
      if (v.ok) {
        return {
          reply: refined,
          candidatesTried,
          passedVerifier: true,
          reflectionNotes,
          totalMs: Math.round(performance.now() - startedMs),
        };
      }
      best = {
        content: refined || best.content,
        reason: v.reason,
        heuristic: scoreHeuristicCandidate(refined, cleanPrompt),
      };
    }

    return {
      reply: best.content,
      candidatesTried,
      passedVerifier: false,
      reflectionNotes,
      totalMs: Math.round(performance.now() - startedMs),
    };
  }
}
