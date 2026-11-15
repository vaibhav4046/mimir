import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveNumCtx, resolveResponseMode } from './llm-provider.mjs';

const execFileAsync = promisify(execFile);
const GB = 2 ** 30;
const gb = bytes => +(bytes / GB).toFixed(2);

let lastCpu = null;
/** Processor use since the previous call, 0-100. os.loadavg() is always 0 on Windows. */
function cpuPercent() {
  const now = os.cpus().reduce(
    (acc, c) => {
      const t = c.times;
      acc.idle += t.idle;
      acc.total += t.user + t.nice + t.sys + t.irq + t.idle;
      return acc;
    },
    { idle: 0, total: 0 },
  );
  const prev = lastCpu;
  lastCpu = now;
  if (!prev || now.total === prev.total) return null;
  return Math.round(100 * (1 - (now.idle - prev.idle) / (now.total - prev.total)));
}

let gpuCache = { at: 0, value: null };
async function gpuUsage(exec) {
  if (Date.now() - gpuCache.at < 2500) return gpuCache.value;
  let value = null;
  try {
    const { stdout } = await exec('nvidia-smi', ['--query-gpu=name,memory.used,memory.total,utilization.gpu', '--format=csv,noheader,nounits'], { timeout: 3000, windowsHide: true });
    const [name, used, total, util] = stdout.trim().split(/\r?\n/)[0].split(',').map(s => s.trim());
    if (Number(total) > 0) value = { name, usedGb: +(Number(used) / 1024).toFixed(2), totalGb: +(Number(total) / 1024).toFixed(2), percent: Number(util) };
  } catch {
    // No NVIDIA GPU or driver; other brands cannot be read reliably.
  }
  gpuCache = { at: Date.now(), value };
  return value;
}

/** Models Ollama has loaded right now and how much memory each holds. */
async function ollamaLoaded(baseUrl) {
  try {
    const res = await fetch(`${String(baseUrl || '').replace(/\/+$/, '')}/api/ps`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.models || []).map(m => ({
      name: m.name || m.model,
      memoryGb: gb(m.size || 0),
      gpuGb: gb(m.size_vram || 0),
      contextLength: m.context_length || null,
    }));
  } catch {
    return [];
  }
}

/** Token use of the chat: the latest reply's real counts from the model server. */
export function contextUsage(thread, settings) {
  const window = resolveNumCtx(settings);
  const last = [...(thread?.messages || [])].reverse().find(m => m.role === 'assistant' && m.usage);
  if (!last) return { usedTokens: 0, windowTokens: window, lastReply: null, messages: thread?.messages?.length || 0 };
  const u = last.usage;
  return {
    usedTokens: u.promptTokens + u.outputTokens,
    windowTokens: u.numCtx || window,
    lastReply: { promptTokens: u.promptTokens, outputTokens: u.outputTokens, tokPerSec: u.tokPerSec, model: last.model || null },
    messages: thread.messages.length,
  };
}

export async function systemUsage({ settings, thread, exec = execFileAsync }) {
  const [gpu, loaded] = await Promise.all([gpuUsage(exec), ollamaLoaded(settings.ollamaUrl)]);
  const total = os.totalmem();
  return {
    ram: { usedGb: gb(total - os.freemem()), totalGb: gb(total) },
    cpu: { percent: cpuPercent(), threads: os.cpus().length },
    gpu,
    mimir: { serviceGb: gb(process.memoryUsage().rss), modelsGb: +loaded.reduce((s, m) => s + m.memoryGb, 0).toFixed(2), loaded },
    context: contextUsage(thread, settings),
    mode: resolveResponseMode(settings) || (settings.ollamaThink ? 'reasoning' : 'standard'),
    fastModel: settings.autoTierModels?.fast_local || null,
    model: settings.provider === 'openai-compat' ? settings.openaiModel : settings.ollamaModel,
  };
}
