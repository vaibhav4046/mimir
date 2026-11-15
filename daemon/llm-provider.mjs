import dns from 'node:dns/promises';
import net from 'node:net';

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
        ...(tc.id ? { id: tc.id } : {}),
        function: {
          name: tc.name,
          arguments: typeof tc.arguments === 'string' ? safeJson(tc.arguments) : (tc.arguments || {}),
        },
      }));
    }
    if (m.role === 'tool' && m.tool_name) out.tool_name = m.tool_name;
    if (m.role === 'tool' && m.tool_call_id) out.tool_call_id = m.tool_call_id;
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

export function isPrivateIp(ip, { allowLoopback = false } = {}) {
  const clean = String(ip || '').toLowerCase().replace(/^::ffff:/, '');
  if (!clean) return false;
  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map(Number);
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 127) return !allowLoopback;
    if (a === 0 || a === 10) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }
  if (net.isIPv6(clean)) {
    if (clean === '::1') return !allowLoopback;
    if (clean === '::' || clean.startsWith('fe80:') || clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('ff')) {
      return true;
    }
    return false;
  }
  return false;
}

export async function assertSafeUrl(rawUrl, { allowLoopback = false } = {}) {
  let u;
  try {
    u = new URL(String(rawUrl));
  } catch {
    throw Object.assign(new Error(`Invalid URL: ${rawUrl}`), { status: 400 });
  }
  if (!['http:', 'https:'].includes(u.protocol)) {
    throw Object.assign(new Error(`Unsupported URL protocol: ${u.protocol}`), { status: 400 });
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1' || /^127\./.test(host)) {
    if (!allowLoopback) {
      throw Object.assign(new Error(`Loopback URL blocked: ${rawUrl}`), { status: 400 });
    }
    return { url: u.toString(), isLoopback: true };
  }
  if (host === 'metadata.google.internal' || host === 'metadata' || host.endsWith('.internal')) {
    throw Object.assign(new Error(`Internal/metadata host blocked: ${host}`), { status: 403 });
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host, { allowLoopback })) {
      throw Object.assign(new Error(`Private or metadata IP blocked: ${host}`), { status: 403 });
    }
    return { url: u.toString(), isLoopback: false };
  }
  try {
    const resolved = await dns.lookup(host, { all: true, verbatim: true });
    for (const entry of resolved || []) {
      if (isPrivateIp(entry.address, { allowLoopback })) {
        throw Object.assign(new Error(`Host ${host} resolves to private/metadata IP ${entry.address}`), { status: 403 });
      }
    }
  } catch (err) {
    if (err?.status === 403) throw err;
    // Allow normal fetch DNS error handling when offline or unresolvable
  }
  return { url: u.toString(), isLoopback: false };
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
export const DEFAULT_OPENAI_NUM_CTX = 65536;

export function resolveNumCtx(settings = {}) {
  const isOpenAI = settings.provider === 'openai-compat';
  const raw = isOpenAI ? (settings.openaiNumCtx ?? settings.numCtx ?? settings.ollamaNumCtx) : (settings.ollamaNumCtx ?? settings.numCtx);
  const n = Number(raw);
  if (Number.isInteger(n) && n >= 2048 && n <= 262144) return n;
  return isOpenAI ? DEFAULT_OPENAI_NUM_CTX : DEFAULT_NUM_CTX;
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

const hostOf = url => {
  try {
    return new URL(url).host;
  } catch {
    return String(url);
  }
};

/** A refused or dropped connection arrives as "fetch failed". Stops and timeouts pass through. */
function unreachable(err, message) {
  if (err?.name === 'AbortError' || err?.name === 'TimeoutError') return err;
  return Object.assign(new Error(message, { cause: err }), { code: 'MODEL_UNREACHABLE' });
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
  }).catch(err => {
    throw unreachable(err, isLoopbackUrl(baseUrl)
      ? "Can't reach Ollama, the free app that runs AI models on this computer. Open Ollama, or install it from https://ollama.com/download"
      : `Can't reach the AI model server at ${hostOf(baseUrl)}. Check that it is running and reachable.`);
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

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          handleObj(JSON.parse(line));
        } catch {
          // Ignore malformed partial NDJSON line from stream interruption
        }
      }
    }
    if (buf.trim()) {
      try {
        handleObj(JSON.parse(buf.trim()));
      } catch {
        // Ignore truncated trailing frame
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
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
  }).catch(err => {
    throw unreachable(err, isLoopbackUrl(baseUrl)
      ? `Can't reach the AI model server on this computer (${hostOf(baseUrl)}). Check that it is running.`
      : `Can't reach the AI service at ${hostOf(baseUrl)}. Check your internet connection.`);
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
  const idToIdx = new Map();
  let nextFallbackIdx = 0;
  let usage = null;

  const consumeLine = (rawLine) => {
    const line = rawLine.trim();
    if (!line.startsWith('data:')) return;
    const payload = line.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let evt;
    try {
      evt = JSON.parse(payload);
    } catch {
      return;
    }
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
        let idx = tc.index;
        if (idx == null) {
          if (tc.id && idToIdx.has(tc.id)) idx = idToIdx.get(tc.id);
          else {
            idx = nextFallbackIdx++;
            if (tc.id) idToIdx.set(tc.id, idx);
          }
        }
        const prev = pendingTools.get(idx) || { id: tc.id || `call_oai_${idx}`, name: '', argText: '' };
        if (tc.id) {
          prev.id = tc.id;
          idToIdx.set(tc.id, idx);
        }
        if (tc.function?.name) prev.name += tc.function.name;
        if (tc.function?.arguments) prev.argText += tc.function.arguments;
        pendingTools.set(idx, prev);
      }
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        consumeLine(line);
      }
    }
    if (buf.trim()) consumeLine(buf);
  } finally {
    reader.cancel().catch(() => {});
  }

  const toolCalls = [...pendingTools.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, tc]) => ({ id: tc.id, name: tc.name, arguments: safeJson(tc.argText) }));

  return { provider: 'openai-compat', model, content, thinking, toolCalls, usage };
}

function isTransientLlmError(err) {
  const msg = String(err?.message || '');
  return /\bHTTP (?:429|502|503|504)\b|ECONNRESET|ETIMEDOUT|socket hang up/i.test(msg);
}

async function withTransientRetry(fn, signal) {
  const delays = [150, 400];
  let lastErr;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (signal?.aborted || err?.name === 'AbortError' || attempt === delays.length || !isTransientLlmError(err)) {
        throw err;
      }
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, delays[attempt]);
        signal?.addEventListener?.('abort', () => {
          clearTimeout(timer);
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        }, { once: true });
      });
    }
  }
  throw lastErr;
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
      return withTransientRetry(() => callOllama({
        baseUrl: settings.ollamaUrl,
        model: (mode === 'fast' && settings.autoTierModels?.fast_local) || modelOverride || settings.ollamaModel || 'qwen3:1.7b',
        think: mode ? mode === 'reasoning' : settings.ollamaThink,
        numCtx: resolveNumCtx({ ...settings, provider: 'ollama' }),
        messages,
        tools,
        onToken,
        onThinking,
        signal,
      }), signal);
    }
    return withTransientRetry(() => callOpenAICompat({
      baseUrl: settings.openaiBaseUrl,
      apiKey: settings.openaiApiKey,
      model: modelOverride || settings.openaiModel || 'gpt-4o-mini',
      messages,
      tools,
      onToken,
      onThinking,
      signal,
    }), signal);
  };

  try {
    return await invoke(primary);
  } catch (primaryErr) {
    if (!settings.enableFallback || primaryErr instanceof LocalOnlyBlockedError) throw primaryErr;
    const secondary = primary === 'ollama' ? 'openai-compat' : 'ollama';
    if (secondary === 'openai-compat' && !settings.openaiBaseUrl) throw primaryErr;
    // A blocked fallback must not hide why the primary failed.
    if (settings.localOnly && !isLoopbackUrl(secondary === 'ollama' ? settings.ollamaUrl : settings.openaiBaseUrl)) throw primaryErr;
    let res;
    try {
      res = await invoke(secondary);
    } catch (secondaryErr) {
      // The backup failed too. What the person needs to know is why their chosen model
      // did not answer, not why a backup they may never have set up is missing.
      if (secondaryErr?.name === 'AbortError') throw secondaryErr;
      primaryErr.fallbackError = secondaryErr.message;
      throw primaryErr;
    }
    res.fallbackFrom = `${primary} (${primaryErr.message})`;
    return res;
  }
}
