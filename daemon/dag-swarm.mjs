import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fetchLiveSearch } from './knowledge-rsi.mjs';
import { resolveActiveModel } from './agi-harness.mjs';
import { ModelCouncilEngine } from './model-council.mjs';

export const SWARM_RECIPES = Object.freeze([
  {
    id: 'research-and-brief',
    name: 'Research & Brief Pipeline',
    description: 'Young Archer scouts sources -> Mimir Clarifies -> Goldfish Audits -> Sindri Exports Brief.',
    steps: [
      { id: 'clarify', label: 'Clarified the deliverable', icon: 'clarify', role: 'Supervisor', dependsOn: [] },
      { id: 'scout', label: 'Searching the web & KB 2026', icon: 'web_search', role: 'Young Archer', dependsOn: ['clarify'] },
      { id: 'critic', label: 'Goldfish Zero-Context Audit', icon: 'goldfish_audit', role: 'Goldfish Critic', dependsOn: ['scout'] },
      { id: 'foundry', label: 'Verified Deliverable Export', icon: 'foundry', role: 'Forge-Bot Sindri', dependsOn: ['critic'] },
    ],
  },
  {
    id: 'elephant-goldfish-build',
    name: 'Elephant-Goldfish Build Gate',
    description: 'Elephant Architect Spec + KB Scout -> Brok Worker Execution -> Fresh Goldfish Refutation Pass.',
    steps: [
      { id: 'clarify', label: 'Clarified the deliverable', icon: 'clarify', role: 'Supervisor', dependsOn: [] },
      { id: 'elephant', label: 'Elephant Long-Horizon Spec', icon: 'elephant_spec', role: 'Elephant Architect', dependsOn: ['clarify'] },
      { id: 'search', label: 'Searching the web & local knowledge', icon: 'web_search', role: 'Young Archer', dependsOn: ['clarify'] },
      { id: 'build', label: 'Forge-Bot Brok Execution', icon: 'subagent', role: 'Forge-Bot Brok', dependsOn: ['elephant', 'search'] },
      { id: 'goldfish', label: 'Goldfish Zero-Context Refutation', icon: 'goldfish_audit', role: 'Goldfish Critic', dependsOn: ['build'] },
    ],
  },
  {
    id: 'perplexity-computer',
    name: 'Perplexity Computer Pipeline',
    description: 'Parallel Web Scout + LightRAG Graph -> Model Council Synthesis -> Goldfish Verifier.',
    steps: [
      { id: 'clarify', label: 'Clarify research scope', icon: 'clarify', role: 'Supervisor', dependsOn: [] },
      { id: 'scout', label: 'Web Scout live search', icon: 'web_search', role: 'Young Archer', dependsOn: ['clarify'] },
      { id: 'graph_rag', label: 'LightRAG Graph & CRAG retrieval', icon: 'elephant_spec', role: 'Odin Archivist', dependsOn: ['clarify'] },
      { id: 'council_synth', label: 'Council Multi-Perspective Synthesis', icon: 'subagent', role: 'Mimir Council', dependsOn: ['scout', 'graph_rag'] },
      { id: 'verifier', label: 'Goldfish & Deterministic Verifier', icon: 'goldfish_audit', role: 'Goldfish Critic', dependsOn: ['council_synth'] },
    ],
  },
  {
    id: 'council-review',
    name: 'Council Peer Review & Audit',
    description: 'Context Retrieval -> Multi-Model Council Stage 1-3 -> Goldfish Zero-Context Audit.',
    steps: [
      { id: 'context', label: 'Gather workspace & RAG context', icon: 'web_search', role: 'Odin Archivist', dependsOn: [] },
      { id: 'council', label: 'Model Council Stage 1-3', icon: 'subagent', role: 'Mimir Council', dependsOn: ['context'] },
      { id: 'audit', label: 'Goldfish Zero-Context Audit', icon: 'goldfish_audit', role: 'Goldfish Critic', dependsOn: ['council'] },
    ],
  },
]);

/**
 * Computes topological wavefront layers for a DAG of steps with `dependsOn`.
 * Steps inside the same wavefront have all dependencies satisfied and can execute concurrently.
 */
export function computeDagWavefronts(steps = []) {
  if (!Array.isArray(steps) || !steps.length) return [];
  const stepMap = new Map();
  for (const s of steps) {
    if (!s?.id) throw new Error('Every DAG step must have an id');
    if (stepMap.has(s.id)) throw new Error(`Duplicate DAG step id: ${s.id}`);
    stepMap.set(s.id, s);
  }
  for (const s of steps) {
    for (const dep of s.dependsOn || []) {
      if (!stepMap.has(dep)) {
        throw new Error(`DAG step "${s.id}" depends on unknown step "${dep}"`);
      }
    }
  }

  const remaining = new Map(stepMap);
  const done = new Set();
  const waves = [];

  while (remaining.size > 0) {
    const wave = [...remaining.values()].filter(s => (s.dependsOn || []).every(d => done.has(d)));
    if (wave.length === 0) {
      throw new Error(`DAG cycle detected among steps: ${[...remaining.keys()].join(', ')}`);
    }
    waves.push(wave);
    for (const s of wave) {
      done.add(s.id);
      remaining.delete(s.id);
    }
  }
  return waves;
}

export class DagSwarmEngine {
  constructor({ dataDir, store, agiHarness, knowledge, rustBridge, broadcast, modelCouncil = null, ragEngine = null } = {}) {
    this.dataDir = dataDir;
    this.store = store;
    this.agiHarness = agiHarness;
    this.knowledge = knowledge;
    this.rustBridge = rustBridge;
    this.broadcast = broadcast;
    this.modelCouncil = modelCouncil;
    this.ragEngine = ragEngine;
    this.runsPath = path.join(dataDir, 'swarm-runs.json');
    this.activeSwarms = new Map();
  }

  #readRuns() {
    try {
      if (fs.existsSync(this.runsPath)) {
        const list = JSON.parse(fs.readFileSync(this.runsPath, 'utf8'));
        return Array.isArray(list) ? list : [];
      }
    } catch {}
    return [];
  }

  #writeRuns(runs) {
    const tmp = `${this.runsPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(runs.slice(0, 50), null, 2), 'utf8');
    fs.renameSync(tmp, this.runsPath);
  }

  listRuns() {
    return this.#readRuns();
  }

  abortAll() {
    for (const [id, ctrl] of this.activeSwarms.entries()) {
      ctrl.abort();
      this.activeSwarms.delete(id);
    }
  }

  /**
   * Executes a bounded multi-node DAG Swarm in topological wavefronts (`dependsOn`),
   * running independent steps concurrently and emitting live timeline updates.
   */
  async runSwarm({
    botId,
    goal,
    recipeId = 'elephant-goldfish-build',
    customSteps = null,
    stepExecutors = null,
    runChatFn,
    settings,
    modelCouncil = null,
    ragEngine = null,
    fetchSearch = fetchLiveSearch,
    signal = null,
  }) {
    const bot = this.store.getBot(botId) || this.store.listBots()[0];
    if (!bot) throw new Error('No bot configured for swarm execution');

    const recipe = SWARM_RECIPES.find(r => r.id === recipeId) || SWARM_RECIPES.find(r => r.id === 'elephant-goldfish-build');
    const steps = Array.isArray(customSteps) && customSteps.length ? customSteps : recipe.steps;
    const wavefronts = computeDagWavefronts(steps);

    const swarmId = `swarm-${crypto.randomBytes(5).toString('hex')}`;
    const abortController = new AbortController();
    const onExternalAbort = () => abortController.abort();
    if (signal?.aborted) abortController.abort();
    else signal?.addEventListener?.('abort', onExternalAbort, { once: true });
    this.activeSwarms.set(swarmId, abortController);

    const timeline = [];
    const emitStep = step => {
      const idx = timeline.findIndex(s => s.id === step.id);
      if (idx >= 0) timeline[idx] = { ...timeline[idx], ...step };
      else timeline.push(step);
      this.broadcast?.('swarm:step', { swarmId, botId: bot.id, step, timeline: [...timeline] });
    };

    const runRecord = {
      id: swarmId,
      botId: bot.id,
      recipeId: customSteps ? 'custom' : recipe.id,
      goal,
      status: 'running',
      startedAt: new Date().toISOString(),
      wavefronts: wavefronts.map(w => w.map(s => s.id)),
      nodes: [],
      timeline,
    };

    const activeRag = ragEngine || this.ragEngine || this.knowledge?.rag || null;
    const activeCouncil =
      modelCouncil ||
      this.modelCouncil ||
      new ModelCouncilEngine({
        store: this.store,
        dataDir: this.dataDir,
        settingsGet: () => settings || this.store.getSettings(),
        chatFn: runChatFn,
        onEvent: this.broadcast,
      });

    const ctx = {
      goal,
      bot,
      settings,
      outputs: {},
    };

    const defaultExecutors = {
      clarify: async () => {
        if (this.rustBridge?.isRunning()) {
          await this.rustBridge.enqueueTask({
            id: `${swarmId}-sup`,
            idempotency_key: `${swarmId}-sup`,
            kind: 'swarm_node',
            payload: { swarmId, node: 'supervisor', goal },
          }).catch(() => {});
        }
        return { detail: goal.slice(0, 90), data: { goal } };
      },

      elephant: async () => {
        const spec = await this.agiHarness.runElephantPhase({ bot, goal, settings, runChatFn, signal: abortController.signal });
        runRecord.spec = spec;
        return { detail: `Spec ${spec.id}`, outputId: spec.id, data: spec };
      },

      search: async () => {
        const kbHits = this.knowledge ? this.knowledge.query(goal, 4) : [];
        return { detail: `${kbHits.length} grounded chunk(s)`, data: kbHits };
      },

      scout: async () => {
        let webResults = [];
        try {
          if (!settings?.localOnly && typeof fetchSearch === 'function') {
            webResults = (await fetchSearch(goal, 5)) || [];
          }
        } catch {
          webResults = [];
        }
        const kbHits = this.knowledge ? this.knowledge.query(goal, 4) : [];
        return {
          detail: `${webResults.length} web + ${kbHits.length} KB hit(s)`,
          data: { webResults, kbHits },
        };
      },

      graph_rag: async () => {
        let ragResult = null;
        if (activeRag?.retrieve) {
          ragResult = await activeRag.retrieve({ query: goal, topK: 5, useWebFallback: false });
        } else if (this.knowledge?.queryWithRag) {
          ragResult = await this.knowledge.queryWithRag(goal, { topK: 5, useWebFallback: false });
        } else if (this.knowledge?.query) {
          const hits = this.knowledge.query(goal, 5);
          ragResult = {
            query: goal,
            grade: hits.length ? 'AMBIGUOUS' : 'INCORRECT',
            confidence: hits.length ? 0.5 : 0,
            webUsed: false,
            citations: hits,
            graphEntities: [],
            contextBlock: hits.map(h => h.text).join('\n'),
          };
        }
        return {
          detail: `CRAG ${ragResult?.grade || 'NONE'} · ${ragResult?.graphEntities?.length || 0} entities`,
          data: ragResult,
        };
      },

      context: async () => {
        const ragResult = activeRag?.retrieve
          ? await activeRag.retrieve({ query: goal, topK: 5, useWebFallback: !settings?.localOnly })
          : { query: goal, grade: 'INCORRECT', confidence: 0, webUsed: false, citations: [], graphEntities: [], contextBlock: '' };
        return {
          detail: `${ragResult.citations?.length || 0} citations (${ragResult.grade})`,
          data: ragResult,
        };
      },

      build: async () => {
        const spec = ctx.outputs.elephant;
        const kbHits = ctx.outputs.search || [];
        let wsFiles = '';
        try {
          const ws = bot?.id && this.store?.getBotWorkspace ? this.store.getBotWorkspace(bot.id) : null;
          if (ws && fs.existsSync(ws)) {
            wsFiles = fs.readdirSync(ws).slice(0, 40).join(', ');
          }
        } catch {}
        const execRes = await runChatFn({
          settings: { ...settings, ollamaThink: false },
          modelOverride: resolveActiveModel(settings),
          messages: [
            {
              role: 'system',
              content: 'You are Forge-Bot Brok (Executor). Turn the Elephant Spec into an actionable, honest summary or implementation plan using only verified evidence.',
            },
            {
              role: 'user',
              content: `Goal: ${goal}\n\nWorkspace files: ${wsFiles || '(empty)'}\n\nElephant Spec:\n${spec?.specText || ''}\n\nKB Hits: ${kbHits.map(h => h.text).join('\n')}`,
            },
          ],
          tools: [],
          signal: abortController.signal,
        });
        runRecord.executionSummary = execRes.content;
        return { detail: execRes.model, data: execRes };
      },

      council_synth: async () => {
        const scoutData = ctx.outputs.scout || { webResults: [], kbHits: [] };
        const ragResult = ctx.outputs.graph_rag;
        const webContext = (scoutData.webResults || [])
          .slice(0, 5)
          .map((w, i) => `- [Web ${i + 1}] ${w.title} (${w.url}): ${w.snippet || ''}`)
          .join('\n');
        const combinedTopic = [
          goal,
          ragResult?.contextBlock ? `\n${ragResult.contextBlock}` : '',
          webContext ? `\nWeb Scout Evidence:\n${webContext}` : '',
        ].filter(Boolean).join('\n');
        const councilRun = await activeCouncil.convene({
          topic: combinedTopic,
          useRag: false,
          signal: abortController.signal,
        });
        runRecord.councilRun = councilRun;
        runRecord.executionSummary = councilRun.synthesis;
        return { detail: `Council ${councilRun.id} (${councilRun.opinions.length} seats)`, outputId: councilRun.id, data: councilRun };
      },

      council: async () => {
        const ragResult = ctx.outputs.context;
        const topicWithCtx = ragResult?.contextBlock ? `${goal}\n\n${ragResult.contextBlock}` : goal;
        const councilRun = await activeCouncil.convene({
          topic: topicWithCtx,
          useRag: false,
          signal: abortController.signal,
        });
        runRecord.councilRun = councilRun;
        runRecord.executionSummary = councilRun.synthesis;
        return { detail: `Council ${councilRun.id}`, outputId: councilRun.id, data: councilRun };
      },

      goldfish: async () => {
        const specText = ctx.outputs.elephant?.specText || goal;
        let targetSummary = ctx.outputs.build?.content || runRecord.executionSummary || '';
        let audit = await this.agiHarness.runGoldfishAudit({
          specText,
          targetSummary,
          settings,
          runChatFn,
          signal: abortController.signal,
        });
        let repaired = false;
        if (audit.verdict === 'FAIL' && ctx.outputs.build && !ctx.repairedOnce && !abortController.signal.aborted) {
          ctx.repairedOnce = true;
          const repairRes = await runChatFn({
            settings: { ...settings, ollamaThink: false },
            modelOverride: resolveActiveModel(settings),
            messages: [
              {
                role: 'system',
                content: 'You are Forge-Bot Brok (Executor). Address every concrete defect found by the Goldfish audit cleanly and concisely.',
              },
              {
                role: 'user',
                content: `Goal: ${goal}\n\nSpec:\n${specText.slice(0, 3000)}\n\nPrevious Draft:\n${String(targetSummary).slice(0, 3000)}\n\nGoldfish Audit Defects:\n${audit.critique}\n\nProduce a corrected, verified revision:`,
              },
            ],
            tools: [],
            signal: abortController.signal,
          });
          if (repairRes?.content) {
            repaired = true;
            targetSummary = repairRes.content;
            runRecord.executionSummary = targetSummary;
            ctx.outputs.build = repairRes;
            audit = await this.agiHarness.runGoldfishAudit({
              specText,
              targetSummary,
              settings,
              runChatFn,
              signal: abortController.signal,
            });
          }
        }
        runRecord.audit = audit;
        return {
          label: `Goldfish Review · ${audit.verdict}`,
          detail: repaired ? 'Evaluator-optimizer repair pass verified' : 'Zero-history isolated critique complete',
          status: audit.verdict === 'FAIL' ? 'warn' : 'done',
          verdict: audit.verdict,
          data: audit,
        };
      },

      critic: async () => {
        const scoutData = ctx.outputs.scout || { webResults: [], kbHits: [] };
        const targetSummary = JSON.stringify(scoutData).slice(0, 5000);
        const audit = await this.agiHarness.runGoldfishAudit({
          specText: goal,
          targetSummary,
          settings,
          runChatFn,
          signal: abortController.signal,
        });
        runRecord.audit = audit;
        return {
          label: `Goldfish Review · ${audit.verdict}`,
          detail: 'Zero-history isolated critique complete',
          status: audit.verdict === 'FAIL' ? 'warn' : 'done',
          verdict: audit.verdict,
          data: audit,
        };
      },

      verifier: async () => {
        const councilRun = ctx.outputs.council_synth;
        const audit = await this.agiHarness.runGoldfishAudit({
          specText: goal,
          targetSummary: councilRun?.synthesis || runRecord.executionSummary || '',
          settings,
          runChatFn,
          signal: abortController.signal,
        });
        runRecord.audit = audit;
        return {
          label: `Verifier · ${audit.verdict}`,
          detail: `${councilRun?.citations?.length || 0} citations verified`,
          status: audit.verdict === 'FAIL' ? 'warn' : 'done',
          verdict: audit.verdict,
          data: audit,
        };
      },

      audit: async () => {
        const councilRun = ctx.outputs.council;
        const audit = await this.agiHarness.runGoldfishAudit({
          specText: goal,
          targetSummary: councilRun?.synthesis || runRecord.executionSummary || '',
          settings,
          runChatFn,
          signal: abortController.signal,
        });
        runRecord.audit = audit;
        return {
          label: `Goldfish Audit · ${audit.verdict}`,
          detail: 'Zero-history isolated critique complete',
          status: audit.verdict === 'FAIL' ? 'warn' : 'done',
          verdict: audit.verdict,
          data: audit,
        };
      },

      foundry: async () => {
        const scoutData = ctx.outputs.scout || {};
        const criticData = ctx.outputs.critic || runRecord.audit;
        const res = await runChatFn({
          settings: { ...settings, ollamaThink: false },
          modelOverride: resolveActiveModel(settings),
          messages: [
            { role: 'system', content: 'Produce a concise verified Markdown brief from the scouted facts and Goldfish audit.' },
            { role: 'user', content: `Goal: ${goal}\n\nEvidence: ${JSON.stringify(scoutData).slice(0, 5000)}\n\nAudit: ${criticData?.critique || ''}` },
          ],
          tools: [],
          signal: abortController.signal,
        });
        runRecord.executionSummary = res.content;
        return { detail: res.model, data: res };
      },
    };

    try {
      for (let waveIndex = 0; waveIndex < wavefronts.length; waveIndex++) {
        if (abortController.signal.aborted) throw new Error('Swarm aborted by Kill Switch');
        const wave = wavefronts[waveIndex];

        const settled = await Promise.allSettled(
          wave.map(async step => {
            if (abortController.signal.aborted) throw new Error('Swarm aborted by Kill Switch');
            const startedAt = Date.now();
            emitStep({
              id: step.id,
              icon: step.icon || 'subagent',
              label: step.label || step.id,
              detail: `${step.role || 'Worker'} (wave ${waveIndex}) running`,
              status: 'running',
              waveIndex,
            });

            const execFn = stepExecutors?.[step.id] || defaultExecutors[step.id];
            if (!execFn) {
              throw new Error(`No executor defined for DAG step "${step.id}"`);
            }
            const out = await execFn({ step, ctx, signal: abortController.signal, waveIndex });
            const completedAt = Date.now();
            ctx.outputs[step.id] = out?.data !== undefined ? out.data : out;

            emitStep({
              id: step.id,
              icon: step.icon || 'subagent',
              label: out?.label || step.label || step.id,
              detail: out?.detail || 'Completed',
              status: out?.status || 'done',
              waveIndex,
            });

            runRecord.nodes.push({
              id: step.id,
              role: step.role || step.id,
              waveIndex,
              dependsOn: [...(step.dependsOn || [])],
              status: 'completed',
              startedAt,
              completedAt,
              durationMs: completedAt - startedAt,
              ...(out?.outputId ? { outputId: out.outputId } : {}),
              ...(out?.verdict ? { verdict: out.verdict } : {}),
            });
          })
        );
        const rejected = settled.find(r => r.status === 'rejected');
        if (rejected) {
          abortController.abort();
          throw rejected.reason;
        }
      }

      runRecord.status = 'completed';
      runRecord.completedAt = new Date().toISOString();
      const runs = this.#readRuns();
      runs.unshift(runRecord);
      this.#writeRuns(runs);
      return runRecord;
    } catch (err) {
      runRecord.status = abortController.signal.aborted ? 'aborted' : 'failed';
      runRecord.error = err?.message || String(err);
      const runs = this.#readRuns();
      runs.unshift(runRecord);
      this.#writeRuns(runs);
      throw err;
    } finally {
      signal?.removeEventListener?.('abort', onExternalAbort);
      this.activeSwarms.delete(swarmId);
    }
  }
}
