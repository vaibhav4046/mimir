import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { runChatTurn, probeModels, isLoopbackUrl } from './llm-provider.mjs';

const MAX_HISTORY_RUNS = 50;
const MAX_STAGE_CONCURRENCY = 3;

const PERSPECTIVE_TEMPLATES = Object.freeze([
  {
    seatId: 'perspective:architect',
    name: 'Architect',
    role: 'System & Interface Architect',
    systemPrompt:
      'You are the Architect on the Mimir Council. Analyze structure, boundaries, data flow, failure invariants, and clean modular design. Be concise and concrete.',
  },
  {
    seatId: 'perspective:skeptic',
    name: 'Skeptic',
    role: 'Adversarial Skeptic',
    systemPrompt:
      'You are the Skeptic on the Mimir Council. Hunt for hidden assumptions, edge cases, security/privacy gaps, unverified claims, and failure modes. Challenge weak reasoning.',
  },
  {
    seatId: 'perspective:pragmatist',
    name: 'Pragmatist',
    role: '6GB Local Pragmatist',
    systemPrompt:
      'You are the Pragmatist on the Mimir Council. Focus on minimal executable steps, local latency/VRAM budgets (6GB GPU), concrete verification commands, and practical trade-offs.',
  },
]);

async function runBounded(items, concurrency, fn) {
  const cap = Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1));
  const results = new Array(items.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < items.length) {
      const idx = nextIdx++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  await Promise.all(Array.from({ length: cap }, () => worker()));
  return results;
}

function shuffleWithCrypto(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function extractJsonObject(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  const fenced = text.replace(/```json\s*|```/gi, '').trim();
  const tryParse = candidate => {
    try {
      return JSON.parse(candidate);
    } catch {
      return null;
    }
  };
  let parsed = tryParse(fenced);
  if (parsed && typeof parsed === 'object') return parsed;

  const start = fenced.indexOf('{');
  const end = fenced.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = fenced.slice(start, end + 1);
    parsed = tryParse(sliced);
    if (parsed && typeof parsed === 'object') return parsed;

    // Repair trailing commas and literal newlines inside string literals
    const cleaned = sliced
      .replace(/,\s*([}\]])/g, '$1')
      .replace(/"((?:[^"\\]|\\.)*)"/g, (_, inner) => `"${inner.replace(/\r?\n/g, '\\n').replace(/\t/g, '\\t')}"`);
    parsed = tryParse(cleaned);
    if (parsed && typeof parsed === 'object') return parsed;
  }
  return null;
}

function unescapePartialJsonString(raw) {
  return String(raw || '')
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .trim();
}

function parseActionLines(block) {
  const actionItems = [];
  for (const rawLine of String(block || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^none\.?$/i.test(line)) continue;
    const stripped = line.replace(/^(?:[-*]|\d+\.)\s+/, '').trim();
    if (!stripped) continue;
    const parts = stripped.split('|').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2) {
      actionItems.push({
        title: parts[0],
        ownerRole: parts[2] ? parts[1] : 'Executor',
        prompt: parts[2] || parts[1],
      });
    } else {
      const m = stripped.match(/^\*{0,2}([^:*\n]{3,90})\*{0,2}(?::\s*(.+))?$/);
      if (m) {
        actionItems.push({
          title: m[1].trim(),
          ownerRole: 'Executor',
          prompt: (m[2] || m[1]).trim(),
        });
      }
    }
  }
  return actionItems.slice(0, 6);
}

function parseSectionedChairmanOutput(text) {
  const headerRe = /^(?:===\s*(CONSENSUS|SYNTHESIS|MINORITY[_\s]*DISSENTS?|ACTION[_\s]*ITEMS?)\s*===|#{2,3}\s*(CONSENSUS|SYNTHESIS|MINORITY[_\s]*DISSENTS?|ACTION[_\s]*ITEMS?)\s*:?\s*)$/gim;
  const matches = [...String(text || '').matchAll(headerRe)];
  if (!matches.length) return null;

  const sections = {};
  for (let i = 0; i < matches.length; i++) {
    const labelRaw = (matches[i][1] || matches[i][2] || '').toUpperCase().replace(/[^A-Z]/g, '');
    const bodyStart = matches[i].index + matches[i][0].length;
    const bodyEnd = i + 1 < matches.length ? matches[i + 1].index : text.length;
    const body = text.slice(bodyStart, bodyEnd).trim();
    if (labelRaw.startsWith('SYNTH')) sections.synthesis = body;
    else if (labelRaw.startsWith('CONSENS')) sections.consensus = body;
    else if (labelRaw.startsWith('MINORITY')) sections.dissents = body;
    else if (labelRaw.startsWith('ACTION')) sections.actions = body;
  }

  const synthesis = (sections.synthesis || sections.consensus || '').trim();
  if (!synthesis) return null;
  const consensus = (sections.consensus || synthesis.split(/\r?\n/)[0] || synthesis).trim();
  const minorityDissents = String(sections.dissents || '')
    .split(/\r?\n/)
    .map(l => l.replace(/^(?:[-*]|\d+\.)\s+/, '').trim())
    .filter(l => l && !/^none\.?$/i.test(l));
  const actionItems = parseActionLines(sections.actions || '');

  return { synthesis, consensus, minorityDissents, actionItems };
}

function parsePeerReviewOutput(rawText, labels) {
  const labelSet = new Set(labels);
  const parsed = extractJsonObject(rawText);
  const ranking = [];
  const critiques = {};

  const pushLabel = raw => {
    const s = String(raw || '').trim();
    const match = s.match(/Response\s+([A-Z])/i) || s.match(/^([A-Z])$/i);
    const norm = match ? `Response ${match[1].toUpperCase()}` : s;
    if (labelSet.has(norm) && !ranking.includes(norm)) {
      ranking.push(norm);
    }
  };

  if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.ranking)) {
      for (const item of parsed.ranking) pushLabel(item);
    }
    if (parsed.critiques && typeof parsed.critiques === 'object') {
      for (const [k, v] of Object.entries(parsed.critiques)) {
        const match = k.match(/Response\s+([A-Z])/i) || k.match(/^([A-Z])$/i);
        const norm = match ? `Response ${match[1].toUpperCase()}` : k;
        if (labelSet.has(norm) && v) {
          critiques[norm] = String(v).trim();
        }
      }
    }
  }

  // Fallback regex extraction if small local model responded in prose instead of JSON
  if (ranking.length < labels.length) {
    const matches = String(rawText || '').matchAll(/Response\s+([A-Z])\b/gi);
    for (const m of matches) {
      pushLabel(`Response ${m[1].toUpperCase()}`);
    }
  }
  for (const lbl of labels) {
    if (!ranking.includes(lbl)) ranking.push(lbl);
  }

  return { ranking, critiques };
}

function parseChairmanOutput(rawText, fallbackCitations = [], fallbackTopOpinion = '') {
  const text = String(rawText || '').trim();
  const sectioned = parseSectionedChairmanOutput(text);
  if (sectioned) {
    return { ...sectioned, citations: fallbackCitations };
  }

  const parsed = extractJsonObject(text);
  if (
    parsed &&
    typeof parsed === 'object' &&
    ('synthesis' in parsed || 'consensus' in parsed || 'minorityDissents' in parsed || 'actionItems' in parsed)
  ) {
    const synthesis = String(parsed.synthesis || parsed.consensus || text || '').trim();
    const consensus = String(parsed.consensus || parsed.synthesis || synthesis).trim();
    const minorityDissents = Array.isArray(parsed.minorityDissents)
      ? parsed.minorityDissents.map(d => String(d).trim()).filter(Boolean)
      : [];
    const actionItems = Array.isArray(parsed.actionItems)
      ? parsed.actionItems
          .filter(a => a && typeof a === 'object' && (a.title || a.prompt))
          .map(a => ({
            title: String(a.title || 'Follow-up Action').trim(),
            ownerRole: String(a.ownerRole || a.owner || 'Executor').trim(),
            prompt: String(a.prompt || a.title || '').trim(),
          }))
      : [];
    return { synthesis, consensus, minorityDissents, actionItems, citations: fallbackCitations };
  }

  // Guard against leaking a malformed outer Chairman JSON wrapper ("consensus"/"synthesis")
  if (/^\s*\{[\s\S]*"(?:consensus|synthesis)"\s*:/.test(text)) {
    const synthMatch = text.match(/"synthesis"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    const consMatch = text.match(/"consensus"\s*:\s*"((?:[^"\\]|\\.)*)"/s);
    const recovered = unescapePartialJsonString(synthMatch?.[1] || consMatch?.[1] || '');
    const cleanFallback = String(fallbackTopOpinion || '').trim();
    if (recovered && !cleanFallback) {
      return {
        synthesis: recovered,
        consensus: recovered,
        minorityDissents: ['Chairman JSON partially recovered'],
        actionItems: [],
        citations: fallbackCitations,
      };
    }
    if (cleanFallback) {
      return {
        synthesis: cleanFallback,
        consensus: recovered || cleanFallback.split(/\r?\n/)[0],
        minorityDissents: ['Chairman JSON envelope malformed; fell back to Stage 2 Borda leader'],
        actionItems: [],
        citations: fallbackCitations,
      };
    }
  }

  const actionItems = [];
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^(?:[-*]|\d+\.)\s+\*{0,2}([^:*\n]{4,90})\*{0,2}(?::\s*(.+))?$/);
    if (m && /action|next|step|verify|build|audit|check|implement/i.test(line)) {
      actionItems.push({
        title: m[1].trim(),
        ownerRole: 'Executor',
        prompt: (m[2] || m[1]).trim(),
      });
    }
  }
  return {
    synthesis: text || String(fallbackTopOpinion || '').trim(),
    consensus: text || String(fallbackTopOpinion || '').trim(),
    minorityDissents: [],
    actionItems: actionItems.slice(0, 6),
    citations: fallbackCitations,
  };
}

export class ModelCouncilEngine {
  constructor({
    store = null,
    settingsGet = null,
    botsList = null,
    ollamaBaseUrl = null,
    onEvent = null,
    dataDir = null,
    chatFn = runChatTurn,
    probeFn = probeModels,
  } = {}) {
    this.store = store;
    this.settingsGet = settingsGet || (() => this.store?.getSettings?.() || {});
    this.botsList = botsList || (() => this.store?.listBots?.() || []);
    this.ollamaBaseUrl = ollamaBaseUrl;
    this.onEvent = onEvent;
    this.dataDir = dataDir || store?.dataDir || os.tmpdir();
    this.historyPath = path.join(this.dataDir, 'council-history.json');
    this.chatFn = chatFn;
    this.probeFn = probeFn;
  }

  #effectiveSettings() {
    const s = { ...(this.settingsGet?.() || {}) };
    if (this.ollamaBaseUrl) s.ollamaUrl = this.ollamaBaseUrl;
    if (!s.ollamaUrl) s.ollamaUrl = 'http://127.0.0.1:11434';
    return s;
  }

  #readHistory() {
    try {
      if (fs.existsSync(this.historyPath)) {
        const parsed = JSON.parse(fs.readFileSync(this.historyPath, 'utf8'));
        return Array.isArray(parsed) ? parsed : [];
      }
    } catch {
      // Ignore corrupt history file
    }
    return [];
  }

  #writeHistory(runs) {
    fs.mkdirSync(path.dirname(this.historyPath), { recursive: true });
    const capped = runs.slice(0, MAX_HISTORY_RUNS);
    const tmp = `${this.historyPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(capped, null, 2), 'utf8');
    fs.renameSync(tmp, this.historyPath);
  }

  listHistory({ limit = 20 } = {}) {
    const cap = Math.max(1, Math.min(Number(limit) || 20, MAX_HISTORY_RUNS));
    return this.#readHistory().slice(0, cap);
  }

  getRun(id) {
    if (!id) return null;
    return this.#readHistory().find(r => r.id === id) || null;
  }

  async listCouncilSeats() {
    const settings = this.#effectiveSettings();
    let probe = { ollama: { ok: false, models: [] }, openai: { ok: false, models: [] } };
    try {
      probe = await this.probeFn(settings);
    } catch {
      // Offline or unreachable model probe must still synthesize fallback seats
    }

    const ollamaModels = Array.isArray(probe?.ollama?.models) ? probe.ollama.models.filter(Boolean) : [];
    const byokAllowed = Boolean(
      settings.openaiBaseUrl && (!settings.localOnly || isLoopbackUrl(settings.openaiBaseUrl))
    );
    const probedOpenAi = byokAllowed && Array.isArray(probe?.openai?.models) ? probe.openai.models.filter(Boolean) : [];
    const configuredByokModels = byokAllowed && (settings.openaiApiKey || isLoopbackUrl(settings.openaiBaseUrl))
      ? (probedOpenAi.length
          ? probedOpenAi
          : (settings.openaiApiKey && settings.openaiModel ? [settings.openaiModel] : []))
      : [];

    const fallbackOllamaModel = ollamaModels[0] || settings.ollamaModel || 'qwen3:1.7b';
    const distinctModels = new Set([...ollamaModels, ...configuredByokModels]);
    const bots = Array.isArray(this.botsList?.()) ? this.botsList() : [];
    for (const b of bots) {
      if (b?.modelOverride) {
        const isCloud = configuredByokModels.includes(b.modelOverride) && !ollamaModels.includes(b.modelOverride);
        if (!isCloud || byokAllowed) distinctModels.add(b.modelOverride);
      }
    }

    const seats = [];
    const seenIds = new Set();
    const pushSeat = seat => {
      if (seenIds.has(seat.seatId)) return;
      seenIds.add(seat.seatId);
      seats.push(seat);
    };

    for (const bot of bots) {
      if (!bot?.id) continue;
      const override = String(bot.modelOverride || '').trim();
      const useByok = override
        ? configuredByokModels.includes(override) && !ollamaModels.includes(override)
        : !ollamaModels.length && configuredByokModels.length > 0 && settings.provider === 'openai-compat';
      const provider = useByok ? 'openai-compat' : 'ollama';
      const model = override || (useByok ? configuredByokModels[0] : fallbackOllamaModel);
      if (provider === 'openai-compat' && !byokAllowed) continue;

      pushSeat({
        seatId: `bot:${bot.id}`,
        kind: 'bot',
        name: bot.name || bot.id,
        role: bot.role || 'User Bot',
        provider,
        model,
        systemPrompt: bot.systemPrompt || `You are ${bot.name || 'a Mimir councilor'}. Provide rigorous, honest analysis.`,
        syntheticPerspective: false,
      });
    }

    for (const m of ollamaModels) {
      pushSeat({
        seatId: `ollama:${m}`,
        kind: 'ollama',
        name: `Ollama (${m})`,
        role: 'Local Ollama Model',
        provider: 'ollama',
        model: m,
        systemPrompt: `You are an independent technical councilor running on local model ${m}. Give concise, verified reasoning.`,
        syntheticPerspective: false,
      });
    }

    for (const m of configuredByokModels) {
      pushSeat({
        seatId: `byok:${m}`,
        kind: 'byok',
        name: `BYOK (${m})`,
        role: 'Configured OpenAI-Compatible Endpoint',
        provider: 'openai-compat',
        model: m,
        systemPrompt: `You are an independent councilor running on ${m}. Give concise, verified reasoning.`,
        syntheticPerspective: false,
      });
    }

    // If only 1 model is available offline, synthesize 3 distinct role perspectives so Stage 1-3 never fails.
    if (distinctModels.size <= 1) {
      const singleModel = [...distinctModels][0] || fallbackOllamaModel;
      const singleProvider = configuredByokModels.includes(singleModel) && !ollamaModels.includes(singleModel)
        ? 'openai-compat'
        : 'ollama';
      for (const tpl of PERSPECTIVE_TEMPLATES) {
        pushSeat({
          seatId: tpl.seatId,
          kind: 'perspective',
          name: tpl.name,
          role: tpl.role,
          provider: singleProvider,
          model: singleModel,
          systemPrompt: tpl.systemPrompt,
          syntheticPerspective: true,
        });
      }
    }

    return seats;
  }

  #selectPanelSeats(allSeats, seatIds) {
    if (Array.isArray(seatIds) && seatIds.length > 0) {
      const byId = new Map(allSeats.map(s => [s.seatId, s]));
      const chosen = seatIds.map(id => byId.get(id)).filter(Boolean);
      if (chosen.length > 0) return chosen;
    }

    const perspectives = allSeats.filter(s => s.syntheticPerspective);
    const nonSyntheticModels = new Set(
      allSeats.filter(s => !s.syntheticPerspective).map(s => `${s.provider}:${s.model}`)
    );
    if (perspectives.length === 3 && nonSyntheticModels.size <= 1) {
      return perspectives;
    }

    // Prefer diverse models/bots up to 5 seats so local GPU stays responsive
    const picked = [];
    const seenModels = new Set();
    for (const s of allSeats) {
      if (s.kind !== 'bot') continue;
      const key = `${s.provider}:${s.model}`;
      if (!seenModels.has(key)) {
        seenModels.add(key);
        picked.push(s);
      }
    }
    for (const s of allSeats) {
      if (s.syntheticPerspective) continue;
      const key = `${s.provider}:${s.model}`;
      if (!seenModels.has(key)) {
        seenModels.add(key);
        picked.push(s);
      }
    }
    if (picked.length < 3) {
      for (const s of allSeats) {
        if (!picked.some(p => p.seatId === s.seatId)) picked.push(s);
        if (picked.length >= 3) break;
      }
    }
    return picked.slice(0, 5);
  }

  async #invokeSeat({ seat, settings, messages, signal }) {
    if (signal?.aborted) {
      throw new Error('Council run aborted');
    }
    if (seat.provider === 'openai-compat' && settings.localOnly && !isLoopbackUrl(settings.openaiBaseUrl)) {
      throw new Error('Blocked by localOnly policy');
    }
    const callSettings = {
      ...settings,
      provider: seat.provider,
      ollamaThink: false,
      enableFallback: false,
    };
    return this.chatFn({
      settings: callSettings,
      modelOverride: seat.model,
      messages,
      tools: [],
      signal,
    });
  }

  async convene({
    topic,
    threadId = null,
    seatIds = null,
    chairmanSeatId = null,
    mode = 'standard',
    useRag = true,
    ragEngine = null,
    signal = null,
  } = {}) {
    const cleanTopic = String(topic || '').trim();
    if (!cleanTopic) throw new Error('Council topic is required');
    if (signal?.aborted) throw new Error('Council run aborted');

    const runId = `council-${crypto.randomBytes(4).toString('hex')}`;
    const startedAtMs = performance.now();
    const settings = this.#effectiveSettings();
    const emit = (stage, detail, extra = {}) => {
      this.onEvent?.('council:step', { runId, threadId, stage, detail, ...extra });
    };

    // Optional RAG Grounding
    let ragResult = null;
    if (useRag && ragEngine) {
      emit('rag', 'Retrieving LightRAG/CRAG context for topic');
      try {
        ragResult = await ragEngine.retrieve({ query: cleanTopic, topK: 5, useWebFallback: !settings.localOnly });
      } catch {
        ragResult = null;
      }
    }

    const allSeats = await this.listCouncilSeats();
    const selectedSeats = this.#selectPanelSeats(allSeats, seatIds);
    if (!selectedSeats.length) {
      throw new Error('No eligible council seats available');
    }

    const chairman =
      (chairmanSeatId && allSeats.find(s => s.seatId === chairmanSeatId)) ||
      selectedSeats.find(s => s.provider === 'openai-compat') ||
      selectedSeats.find(s => /9b|4b/i.test(s.model)) ||
      selectedSeats[0];

    const ragBlock = ragResult?.contextBlock ? `\n\nGrounded Reference Context:\n${ragResult.contextBlock}` : '';

    // Stage 1: First Opinions (bounded concurrency <= 3 for 6GB VRAM safety)
    emit('stage1:start', `Stage 1: Gathering ${selectedSeats.length} first opinions (concurrency <= ${MAX_STAGE_CONCURRENCY})`, {
      seatCount: selectedSeats.length,
    });

    const opinions = await runBounded(selectedSeats, MAX_STAGE_CONCURRENCY, async seat => {
      const t0 = performance.now();
      try {
        const res = await this.#invokeSeat({
          seat,
          settings,
          signal,
          messages: [
            { role: 'system', content: seat.systemPrompt },
            {
              role: 'user',
              content: `Council Topic: ${cleanTopic}${ragBlock}\n\nProvide your independent Stage 1 analysis. Be concrete, concise, and explicit about risks or unknowns. If the Topic specifies an exact output format (JSON schema, numbered steps, character limit, or exact string), satisfy all constraints strictly.`,
            },
          ],
        });
        const latencyMs = Math.round(performance.now() - t0);
        const entry = {
          seatId: seat.seatId,
          name: seat.name,
          model: res?.model || seat.model,
          provider: seat.provider,
          response: String(res?.content || '').trim(),
          latencyMs,
          ok: Boolean(String(res?.content || '').trim()),
        };
        emit('stage1:seat', `${seat.name} answered`, { seatId: seat.seatId, ok: entry.ok, latencyMs });
        return entry;
      } catch (err) {
        const latencyMs = Math.round(performance.now() - t0);
        const entry = {
          seatId: seat.seatId,
          name: seat.name,
          model: seat.model,
          provider: seat.provider,
          response: '',
          latencyMs,
          ok: false,
          error: err?.message || String(err),
        };
        emit('stage1:seat', `${seat.name} failed`, { seatId: seat.seatId, ok: false, latencyMs, error: entry.error });
        return entry;
      }
    });

    const okOpinions = opinions.filter(o => o.ok);
    emit('stage1:done', `Stage 1 complete (${okOpinions.length}/${opinions.length} succeeded)`, {
      okCount: okOpinions.length,
      totalCount: opinions.length,
    });

    if (signal?.aborted) throw new Error('Council run aborted');

    // Stage 2: Anonymized Peer Critique & Ranking (Borda Count)
    let leaderboard = [];
    if (okOpinions.length >= 2) {
      emit('stage2:start', `Stage 2: Anonymized peer critique across ${okOpinions.length} responses`);
      const shuffled = shuffleWithCrypto(okOpinions);
      const anonymized = shuffled.map((op, i) => ({
        label: `Response ${String.fromCharCode(65 + i)}`,
        opinion: op,
      }));
      const labels = anonymized.map(a => a.label);
      const anonymizedPromptBody = anonymized
        .map(a => `### ${a.label}\n${a.opinion.response}`)
        .join('\n\n');

      const reviewers = mode === 'fast' ? selectedSeats.slice(0, 2) : selectedSeats;
      const ballots = await runBounded(reviewers, MAX_STAGE_CONCURRENCY, async reviewer => {
        try {
          const res = await this.#invokeSeat({
            seat: reviewer,
            settings,
            signal,
            messages: [
              {
                role: 'system',
                content:
                  'You are an impartial peer reviewer. Evaluate ONLY the anonymized responses below without guessing authors. Return valid JSON: {"critiques":{"Response A":"..."},"ranking":["Response A","Response B"]}.',
              },
              {
                role: 'user',
                content: `Topic: ${cleanTopic}\n\n${anonymizedPromptBody}\n\nCritique each response briefly and rank ALL labels (${labels.join(', ')}) from best to worst in JSON.`,
              },
            ],
          });
          const parsed = parsePeerReviewOutput(res?.content || '', labels);
          emit('stage2:critique', `${reviewer.name} submitted anonymized ranking`, { seatId: reviewer.seatId });
          return { ok: true, reviewer: reviewer.name, ...parsed };
        } catch (err) {
          emit('stage2:critique', `${reviewer.name} critique failed`, { seatId: reviewer.seatId, ok: false, error: err?.message });
          return { ok: false, reviewer: reviewer.name, ranking: [], critiques: {} };
        }
      });

      const stats = new Map(
        anonymized.map(a => [a.label, { ...a, sumRank: 0, ballotCount: 0, bordaScore: 0, critiques: [] }])
      );
      const validBallots = ballots.filter(b => b.ok && b.ranking.length === labels.length);
      const mCount = labels.length;

      for (const b of validBallots) {
        b.ranking.forEach((lbl, idx) => {
          const st = stats.get(lbl);
          if (!st) return;
          st.sumRank += idx + 1;
          st.ballotCount += 1;
          st.bordaScore += mCount - 1 - idx;
        });
        for (const [lbl, txt] of Object.entries(b.critiques || {})) {
          const st = stats.get(lbl);
          if (st && txt) st.critiques.push(`[${b.reviewer}] ${txt}`);
        }
      }

      leaderboard = [...stats.values()]
        .map((st, idx) => ({
          label: st.label,
          seatId: st.opinion.seatId,
          name: st.opinion.name,
          model: st.opinion.model,
          avgRank: st.ballotCount > 0 ? Number((st.sumRank / st.ballotCount).toFixed(2)) : idx + 1,
          bordaScore: st.bordaScore,
          critiques: st.critiques,
        }))
        .sort((a, b) => (b.bordaScore - a.bordaScore) || (a.avgRank - b.avgRank));

      emit('stage2:done', `Stage 2 complete (leader: ${leaderboard[0]?.name || 'none'})`, {
        leaderSeatId: leaderboard[0]?.seatId || null,
      });
    } else if (okOpinions.length === 1) {
      const only = okOpinions[0];
      leaderboard = [{
        label: 'Response A',
        seatId: only.seatId,
        name: only.name,
        model: only.model,
        avgRank: 1,
        bordaScore: 0,
        critiques: [],
      }];
      emit('stage2:done', 'Stage 2 skipped (single valid opinion)');
    } else {
      emit('stage2:done', 'Stage 2 skipped (no valid Stage 1 opinions)');
    }

    if (signal?.aborted) throw new Error('Council run aborted');

    // Stage 3: Chairman Synthesis
    emit('stage3:start', `Stage 3: Chairman (${chairman.name}) synthesizing consensus & action items`, {
      chairmanSeatId: chairman.seatId,
    });

    const citations = ragResult?.citations || [];
    let stage3 = {
      synthesis: '',
      consensus: '',
      minorityDissents: [],
      actionItems: [],
      citations,
    };

    if (okOpinions.length > 0) {
      const topOp = leaderboard[0]
        ? okOpinions.find(o => o.seatId === leaderboard[0].seatId) || okOpinions[0]
        : okOpinions[0];
      const leaderSummary = leaderboard
        .map(l => `- ${l.label} (${l.name} | ${l.model}): borda=${l.bordaScore}, avgRank=${l.avgRank}${l.critiques.length ? ` | critiques: ${l.critiques.join(' ; ')}` : ''}`)
        .join('\n');
      const opinionText = okOpinions
        .map(o => `### ${o.name} (${o.model})\n${o.response}`)
        .join('\n\n');

      try {
        const chairRes = await this.#invokeSeat({
          seat: chairman,
          settings,
          signal,
          messages: [
            {
              role: 'system',
              content: [
                'You are the Council Chairman. Synthesize the top Borda-ranked consensus, preserve minority dissents, cite RAG sources [S1]/[S2] if present, and list follow-up actions.',
                'Respond using ONLY these exact section headers:',
                '=== CONSENSUS ===',
                '(1-2 concise sentences summarizing council agreement)',
                '=== SYNTHESIS ===',
                '(Direct final answer/deliverable ONLY. Satisfy EVERY format, JSON schema, keyword, line-count, and character-length constraint in Topic literally with NO extra framing inside this section.)',
                '=== MINORITY_DISSENTS ===',
                '- (key caveat or "None")',
                '=== ACTION_ITEMS ===',
                '- Title | OwnerRole | Prompt',
              ].join('\n'),
            },
            {
              role: 'user',
              content: `Topic: ${cleanTopic}\n\nTop Borda Winner (${topOp?.name}):\n${topOp?.response || ''}\n\nBorda Leaderboard:\n${leaderSummary}\n\nMember Opinions:\n${opinionText}${ragBlock}`,
            },
          ],
        });
        stage3 = parseChairmanOutput(chairRes?.content || '', citations, topOp?.response || '');
      } catch (err) {
        stage3 = {
          synthesis: topOp?.response || `Chairman call failed: ${err?.message || String(err)}`,
          consensus: topOp?.response || '',
          minorityDissents: [`Chairman synthesis fallback used (${err?.message || String(err)})`],
          actionItems: [],
          citations,
        };
      }
    } else {
      stage3 = {
        synthesis: 'No council members returned a valid Stage 1 opinion.',
        consensus: '',
        minorityDissents: opinions.filter(o => o.error).map(o => `${o.name}: ${o.error}`),
        actionItems: [],
        citations,
      };
    }

    emit('stage3:done', 'Stage 3 synthesis complete', { actionItemCount: stage3.actionItems.length });

    const runRecord = {
      id: runId,
      topic: cleanTopic,
      threadId,
      mode,
      useRag: Boolean(useRag),
      chairman: { seatId: chairman.seatId, name: chairman.name, model: chairman.model },
      seats: selectedSeats.map(s => ({
        seatId: s.seatId,
        name: s.name,
        role: s.role,
        model: s.model,
        provider: s.provider,
        syntheticPerspective: s.syntheticPerspective,
      })),
      opinions,
      leaderboard,
      synthesis: stage3.synthesis,
      consensus: stage3.consensus,
      minorityDissents: stage3.minorityDissents,
      citations: stage3.citations,
      rag: ragResult
        ? {
            grade: ragResult.grade,
            confidence: ragResult.confidence,
            webUsed: ragResult.webUsed,
            graphEntities: ragResult.graphEntities,
          }
        : null,
      actionItems: stage3.actionItems,
      totalMs: Math.round(performance.now() - startedAtMs),
      createdAt: new Date().toISOString(),
    };

    const history = this.#readHistory();
    history.unshift(runRecord);
    this.#writeHistory(history);

    return runRecord;
  }
}
