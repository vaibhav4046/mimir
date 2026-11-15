/**
 * Unified streaming LLM adapter:
 * Default -> Local Ollama (/api/chat, /api/tags)
 * Fallback -> OpenAI-compatible (/chat/completions SSE, /models)
 */

function normalizeMessagesForOllama(messages) {
  return messages.map(m => {
    const out = { role: m.role, content: m.content ?? '' };
    if (m.tool_calls?.length) {
      out.tool_calls = m.tool_calls.map(tc => ({
        function: {
          name: tc.name,
          arguments: typeof tc.arguments === 'string' ? safeJson(tc.arguments) : (tc.arguments || {}),
        },
      }));
    }
    if (m.role === 'tool' && m.tool_name) out.tool_name = m.tool_name;
    return out;
  });
}

function normalizeMessagesForOpenAI(messages) {
  return messages.map(m => {
    if (m.role === 'tool') {
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id || m.id || 'call_0',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content ?? ''),
      };
    }
    if (m.role === 'assistant' && m.tool_calls?.length) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: m.tool_calls.map(tc => ({
          id: tc.id || 'call_0',
          type: 'function',
          function: {
            name: tc.name,
            arguments: typeof tc.arguments === 'string' ? tc.arguments : JSON.stringify(tc.arguments || {}),
          },
        })),
      };
    }
    return { role: m.role, content: m.content ?? '' };
  });
}

function safeJson(raw) {
  if (raw && typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw || '{}'));
  } catch {
    return { raw: String(raw || '') };
  }
}

function normalizeUrl(base) {
  return String(base || '').replace(/\/+$/, '');
}

export function isLoopbackUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '::1' || /^127\./.test(host);
  } catch {
    return false;
  }
}

export class LocalOnlyBlockedError extends Error {
  constructor(baseUrl) {
    super(`Local-only mode is on, so Mimir did not send this to ${baseUrl}. Use a model on this computer, or turn local-only off in Settings.`);
    this.code = 'LOCAL_ONLY_BLOCKED';
    this.status = 403;
  }
}

export async function probeModels(settings) {
  const result = { ollama: { ok: false, models: [], error: null }, openai: { ok: false, models: [], error: null } };
  if (settings.ollamaUrl && settings.localOnly && !isLoopbackUrl(settings.ollamaUrl)) {
    result.ollama.error = 'Skipped: local-only mode is on';
  } else {
    try {
      const res = await fetch(`${normalizeUrl(settings.ollamaUrl)}/api/tags`, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const data = await res.json();
        result.ollama = {
          ok: true,
          models: (data.models || []).map(m => m.name || m.model).filter(Boolean),
          error: null,
        };
      } else {
        result.ollama.error = `HTTP ${res.status}`;
      }
    } catch (err) {
      result.ollama.error = err.message;
    }
  }

  if (settings.openaiBaseUrl && settings.localOnly && !isLoopbackUrl(settings.openaiBaseUrl)) {
    result.openai.error = 'Skipped: local-only mode is on';
  } else if (settings.openaiBaseUrl) {
    try {
      const headers = {};
      if (settings.openaiApiKey) headers.Authorization = `Bearer ${settings.openaiApiKey}`;
      const res = await fetch(`${normalizeUrl(settings.openaiBaseUrl)}/models`, {
        headers,
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        const data = await res.json();
        result.openai = {
          ok: true,
          models: (data.data || []).map(m => m.id).filter(Boolean),
          error: null,
        };
      } else {
        result.openai.error = `HTTP ${res.status}`;
      }
    } catch (err) {
      result.openai.error = err.message;
    }
  }
  return result;
}

/** Context window Mimir asks Ollama for. Measured on a 6 GB GPU: 8k keeps a 1.7B model fully on
 *  the GPU at ~106 tok/s; 40k drops the same model to ~31 tok/s. */
export const DEFAULT_NUM_CTX = 8192;

export function resolveNumCtx(settings = {}) {
  const n = Number(settings.ollamaNumCtx);
  return Number.isInteger(n) && n >= 2048 && n <= 262144 ? n : DEFAULT_NUM_CTX;
}

export const RESPONSE_MODES = ['fast', 'standard', 'reasoning'];

/** fast = smallest installed model, no thinking; standard = default model; reasoning = default
 *  model, thinks before answering. Null until chosen, so the older ollamaThink setting still applies. */
export function resolveResponseMode(settings = {}) {
  return RESPONSE_MODES.includes(settings.responseMode) ? settings.responseMode : null;
}

function ollamaUsage(obj, numCtx) {
  const outputTokens = obj.eval_count || 0;
  const secs = (obj.eval_duration || 0) / 1e9;
  return { promptTokens: obj.prompt_eval_count || 0, outputTokens, numCtx, tokPerSec: secs > 0 ? +(outputTokens / secs).toFixed(1) : null };
}

function openaiUsage(u) {
  if (!u) return null;
  return { promptTokens: u.prompt_tokens || 0, outputTokens: u.completion_tokens || 0, numCtx: null, tokPerSec: null };
}

async function callOllama({ baseUrl, model, think, messages, tools, onToken, onThinking, signal, numCtx = DEFAULT_NUM_CTX }) {
  const body = {
    model,
    stream: true,
    think: Boolean(think),
    messages: normalizeMessagesForOllama(messages),
    // Always explicit: without it the window depends on whatever the host's Ollama defaults to.
    options: { num_ctx: numCtx },
  };
  if (tools?.length) body.tools = tools;

  const res = await fetch(`${normalizeUrl(baseUrl)}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Ollama HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  let thinking = '';
  const toolCalls = [];
  let usage = null;

  const handleObj = obj => {
    if (obj.done) usage = ollamaUsage(obj, numCtx);
    const msg = obj.message || {};
    if (msg.thinking) {
      thinking += msg.thinking;
      onThinking?.(msg.thinking);
    }
    if (msg.content) {
      content += msg.content;
      onToken?.(msg.content);
    }
    if (Array.isArray(msg.tool_calls)) {
      for (let i = 0; i < msg.tool_calls.length; i++) {
        const tc = msg.tool_calls[i];
        toolCalls.push({
          id: tc.id || `call_ollama_${toolCalls.length}`,
          name: tc.function?.name || '',
          arguments: safeJson(tc.function?.arguments),
        });
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      handleObj(JSON.parse(line));
    }
  }
  if (buf.trim()) handleObj(JSON.parse(buf.trim()));
  return { provider: 'ollama', model, content, thinking, toolCalls, usage };
}

async function callOpenAICompat({ baseUrl, apiKey, model, messages, tools, onToken, onThinking, signal }) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

  const body = {
    model,
    stream: true,
    messages: normalizeMessagesForOpenAI(messages),
  };
  if (tools?.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(`${normalizeUrl(baseUrl)}/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`OpenAI-compat HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('text/event-stream')) {
    const json = await res.json();
    const choice = json.choices?.[0]?.message || {};
    if (choice.reasoning_content) onThinking?.(choice.reasoning_content);
    if (choice.content) onToken?.(choice.content);
    const toolCalls = (choice.tool_calls || []).map((tc, i) => ({
      id: tc.id || `call_oai_${i}`,
      name: tc.function?.name || '',
      arguments: safeJson(tc.function?.arguments),
    }));
    return {
      provider: 'openai-compat',
      model,
      content: choice.content || '',
      thinking: choice.reasoning_content || '',
      toolCalls,
      usage: openaiUsage(json.usage),
    };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let content = '';
  let thinking = '';
  const pendingTools = new Map();
  let usage = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      const evt = JSON.parse(payload);
      if (evt.usage) usage = openaiUsage(evt.usage);
      const delta = evt.choices?.[0]?.delta || {};
      if (delta.reasoning_content) {
        thinking += delta.reasoning_content;
        onThinking?.(delta.reasoning_content);
      }
      if (delta.content) {
        content += delta.content;
        onToken?.(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0;
          const prev = pendingTools.get(idx) || { id: tc.id || `call_oai_${idx}`, name: '', argText: '' };
          if (tc.id) prev.id = tc.id;
          if (tc.function?.name) prev.name += tc.function.name;
          if (tc.function?.arguments) prev.argText += tc.function.arguments;
          pendingTools.set(idx, prev);
        }
      }
    }
  }

  const toolCalls = [...pendingTools.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, tc]) => ({ id: tc.id, name: tc.name, arguments: safeJson(tc.argText) }));

  return { provider: 'openai-compat', model, content, thinking, toolCalls, usage };
}

export async function runChatTurn({ settings, modelOverride, messages, tools, onToken, onThinking, signal }) {
  const primary = settings.provider === 'openai-compat' ? 'openai-compat' : 'ollama';
  // Every model call passes through here, including fallback, so this is the one place
  // local-only mode has to hold. Checked before any network request is made.
  const assertAllowed = baseUrl => {
    if (settings.localOnly && !isLoopbackUrl(baseUrl)) throw new LocalOnlyBlockedError(baseUrl);
  };
  const mode = resolveResponseMode(settings);
  const invoke = async target => {
    assertAllowed(target === 'ollama' ? settings.ollamaUrl : settings.openaiBaseUrl);
    if (target === 'ollama') {
      return callOllama({
        baseUrl: settings.ollamaUrl,
        model: (mode === 'fast' && settings.autoTierModels?.fast_local) || modelOverride || settings.ollamaModel || 'qwen3:1.7b',
        think: mode ? mode === 'reasoning' : settings.ollamaThink,
        numCtx: resolveNumCtx(settings),
        messages,
        tools,
        onToken,
        onThinking,
        signal,
      });
    }
    return callOpenAICompat({
      baseUrl: settings.openaiBaseUrl,
      apiKey: settings.openaiApiKey,
      model: modelOverride || settings.openaiModel || 'gpt-4o-mini',
      messages,
      tools,
      onToken,
      onThinking,
      signal,
    });
  };

  try {
    return await invoke(primary);
  } catch (primaryErr) {
    if (!settings.enableFallback || primaryErr instanceof LocalOnlyBlockedError) throw primaryErr;
    const secondary = primary === 'ollama' ? 'openai-compat' : 'ollama';
    if (secondary === 'openai-compat' && !settings.openaiBaseUrl) throw primaryErr;
    // A blocked fallback must not hide why the primary failed.
    if (settings.localOnly && !isLoopbackUrl(secondary === 'ollama' ? settings.ollamaUrl : settings.openaiBaseUrl)) throw primaryErr;
    const res = await invoke(secondary);
    res.fallbackFrom = `${primary} (${primaryErr.message})`;
    return res;
  }
}
