import { runChatTurn, isLoopbackUrl } from './llm-provider.mjs';

export { isLoopbackUrl };

/**
 * Model setup: discover local inference servers, describe cloud presets, and measure what a
 * chosen model can actually do. Every capability reported here comes from a live call; anything
 * the server does not report is returned as null ("not reported"), never guessed.
 */

/** Default ports of common local servers. Each is probed, nothing is assumed to be running. */
export const LOCAL_SERVER_CANDIDATES = [
  { id: 'ollama', label: 'Ollama', kind: 'ollama', baseUrl: 'http://127.0.0.1:11434' },
  { id: 'lmstudio', label: 'LM Studio', kind: 'openai-compat', baseUrl: 'http://127.0.0.1:1234/v1' },
  { id: 'llamacpp', label: 'llama.cpp server', kind: 'openai-compat', baseUrl: 'http://127.0.0.1:8080/v1' },
  { id: 'vllm', label: 'vLLM', kind: 'openai-compat', baseUrl: 'http://127.0.0.1:8000/v1' },
  { id: 'jan', label: 'Jan', kind: 'openai-compat', baseUrl: 'http://127.0.0.1:1337/v1' },
];

/**
 * Cloud providers reached through their OpenAI-compatible endpoints. Tool calling and streaming
 * support differ per provider and model, which is why the test step measures them instead of
 * trusting this list. An API key is required; a consumer chat subscription does not include one.
 */
export const CLOUD_PROVIDERS = [
  { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'anthropic', label: 'Anthropic (OpenAI-compatible endpoint)', baseUrl: 'https://api.anthropic.com/v1', keyUrl: 'https://console.anthropic.com/settings/keys' },
  { id: 'gemini', label: 'Google Gemini (OpenAI-compatible endpoint)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys' },
  { id: 'openrouter', label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys' },
];

const PROBE_TIMEOUT_MS = 3000;
const CALL_TIMEOUT_MS = 90_000;

const trimUrl = u => String(u || '').replace(/\/+$/, '');

async function listModels({ kind, baseUrl, apiKey }) {
  const headers = apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
  const url = kind === 'ollama' ? `${trimUrl(baseUrl)}/api/tags` : `${trimUrl(baseUrl)}/models`;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return kind === 'ollama'
    ? (data.models || []).map(m => m.name || m.model).filter(Boolean)
    : (data.data || []).map(m => m.id).filter(Boolean);
}

/** Probe the candidate list in parallel; only servers that answer are marked ok. */
export async function discoverLocalServers(candidates = LOCAL_SERVER_CANDIDATES) {
  return Promise.all(
    candidates.map(async c => {
      try {
        const models = await listModels(c);
        return { ...c, ok: true, models, error: null };
      } catch (err) {
        return { ...c, ok: false, models: [], error: err.name === 'TimeoutError' ? 'no answer' : err.message };
      }
    }),
  );
}

/** Ollama reports context length and capabilities via /api/show; other servers usually do not. */
async function ollamaModelInfo(baseUrl, model) {
  try {
    const res = await fetch(`${trimUrl(baseUrl)}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model }),
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (!res.ok) return {};
    const data = await res.json();
    const info = data.model_info || {};
    const ctxKey = Object.keys(info).find(k => k.endsWith('.context_length'));
    return {
      contextLength: ctxKey ? info[ctxKey] : null,
      vision: Array.isArray(data.capabilities) ? data.capabilities.includes('vision') : null,
    };
  } catch {
    return {};
  }
}

function settingsFor({ kind, baseUrl, apiKey, model }) {
  return kind === 'ollama'
    ? { provider: 'ollama', ollamaUrl: baseUrl, ollamaModel: model, ollamaThink: false, enableFallback: false }
    : { provider: 'openai-compat', openaiBaseUrl: baseUrl, openaiApiKey: apiKey || '', openaiModel: model, enableFallback: false };
}

async function timedCall(target, { messages, tools, onToken }) {
  const started = Date.now();
  let firstTokenMs = null;
  const res = await runChatTurn({
    settings: settingsFor(target),
    messages,
    tools,
    signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    onToken: tok => {
      if (firstTokenMs === null) firstTokenMs = Date.now() - started;
      onToken?.(tok);
    },
  });
  return { res, totalMs: Date.now() - started, firstTokenMs };
}

const TIME_TOOL = {
  type: 'function',
  function: {
    name: 'get_current_time',
    description: 'Returns the current time. Call this whenever the user asks for the time.',
    parameters: { type: 'object', properties: { timezone: { type: 'string' } }, required: [] },
  },
};

/**
 * Run four short live checks against one model. Each check passes, fails with the observed
 * reason, or errors. The prompts are fixed and contain no user data.
 */
export async function testModelCapabilities(target) {
  const checks = [];
  const record = (id, label, fn) =>
    fn()
      .then(out => checks.push({ id, label, ...out }))
      .catch(err => checks.push({ id, label, ok: false, detail: String(err?.message || err).slice(0, 200) }));

  let models = [];
  await record('connect', 'Connects and lists models', async () => {
    models = await listModels(target);
    const listed = models.includes(target.model);
    return { ok: listed, detail: listed ? `${models.length} model(s) listed` : `${target.model} is not in the server's model list` };
  });
  if (!checks[0].ok) return { ok: false, model: target.model, checks, contextLength: null, vision: null, latency: null };

  let latency = null;
  await record('stream', 'Streams a reply', async () => {
    let chunks = 0;
    const { res, totalMs, firstTokenMs } = await timedCall(target, {
      messages: [{ role: 'user', content: 'Reply with exactly the word: ready' }],
      onToken: () => (chunks += 1),
    });
    latency = { firstTokenMs, totalMs };
    const ok = /ready/i.test(res.content);
    return { ok, detail: ok ? `${chunks} chunk(s), first token ${firstTokenMs ?? '?'} ms` : `Unexpected reply: ${res.content.slice(0, 80)}` };
  });

  await record('tools', 'Calls a tool when asked', async () => {
    const { res } = await timedCall(target, {
      messages: [{ role: 'user', content: 'What time is it? Use the get_current_time tool.' }],
      tools: [TIME_TOOL],
    });
    const call = res.toolCalls.find(tc => tc.name === 'get_current_time');
    return { ok: Boolean(call), detail: call ? 'Returned a get_current_time call' : 'Answered without calling the tool' };
  });

  await record('json', 'Returns valid JSON on request', async () => {
    const { res } = await timedCall(target, {
      messages: [{ role: 'user', content: 'Return only this JSON object and nothing else: {"answer": 4}' }],
    });
    const text = res.content.replace(/```(?:json)?/g, '').trim();
    const match = text.match(/\{[\s\S]*\}/);
    let parsed = null;
    try {
      parsed = match ? JSON.parse(match[0]) : null;
    } catch {}
    const ok = parsed?.answer === 4;
    return { ok, detail: ok ? 'Parsed {"answer": 4}' : `Not valid JSON: ${text.slice(0, 80)}` };
  });

  const info = target.kind === 'ollama' ? await ollamaModelInfo(target.baseUrl, target.model) : {};
  return {
    ok: checks.every(c => c.ok),
    model: target.model,
    checks,
    contextLength: info.contextLength ?? null,
    vision: info.vision ?? null,
    latency,
  };
}
