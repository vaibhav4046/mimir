import crypto from 'node:crypto';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Model library: what this particular computer can run, a catalog to choose from, one-click
 * install through Ollama, automatic tier choice from what is installed, and OpenRouter sign-in
 * for cloud models (free and paid) without pasting an API key.
 *
 * Download sizes were read from the Ollama registry on 2026-11-13. `tools` is what the model
 * family is expected to support; the setup wizard's live test is what actually confirms it.
 */
export const MODEL_CATALOG = [
  { name: 'gemma3:1b', sizeGb: 0.81, family: 'Gemma 3', kind: 'general', tools: false, note: 'Smallest. Chat only, for very modest PCs.' },
  { name: 'qwen2.5-coder:1.5b', sizeGb: 0.99, family: 'Qwen 2.5 Coder', kind: 'code', tools: true, note: 'Small coding helper.' },
  { name: 'deepseek-r1:1.5b', sizeGb: 1.12, family: 'DeepSeek R1', kind: 'reasoning', tools: false, note: 'Small step-by-step reasoner.' },
  { name: 'llama3.2:1b', sizeGb: 1.32, family: 'Llama 3.2', kind: 'general', tools: true, note: 'Very fast general model.' },
  { name: 'qwen3:1.7b', sizeGb: 1.36, family: 'Qwen 3', kind: 'general', tools: true, verified: true, note: 'Fast everyday model with reliable tool use. Mimir\'s default.' },
  { name: 'granite3.3:2b', sizeGb: 1.55, family: 'Granite 3.3', kind: 'general', tools: true, note: 'Compact business-task model.' },
  { name: 'llama3.2:3b', sizeGb: 2.02, family: 'Llama 3.2', kind: 'general', tools: true, note: 'Balanced small model.' },
  { name: 'phi4-mini:latest', sizeGb: 2.49, family: 'Phi-4 mini', kind: 'general', tools: true, note: 'Strong reasoning for its size.' },
  { name: 'qwen3:4b', sizeGb: 2.5, family: 'Qwen 3', kind: 'general', tools: true, note: 'Better planning than 1.7B, still light.' },
  { name: 'qwen3.5:4b', sizeGb: 3.32, family: 'Qwen 3.5', kind: 'vision', tools: true, verified: true, note: 'Planning plus image understanding.' },
  { name: 'gemma3:4b', sizeGb: 3.35, family: 'Gemma 3', kind: 'vision', tools: false, note: 'Good writing and image understanding.' },
  { name: 'mistral:7b', sizeGb: 4.37, family: 'Mistral', kind: 'general', tools: true, note: 'Solid general 7B.' },
  { name: 'qwen2.5-coder:7b', sizeGb: 4.68, family: 'Qwen 2.5 Coder', kind: 'code', tools: true, note: 'Capable coding model.' },
  { name: 'llama3.1:8b', sizeGb: 4.92, family: 'Llama 3.1', kind: 'general', tools: true, note: 'Well-rounded 8B.' },
  { name: 'qwen3:8b', sizeGb: 5.23, family: 'Qwen 3', kind: 'general', tools: true, note: 'Strong general 8B.' },
  { name: 'deepseek-r1:8b', sizeGb: 5.23, family: 'DeepSeek R1', kind: 'reasoning', tools: false, note: 'Deeper reasoning, slower replies.' },
  { name: 'qwen3.5:9b', sizeGb: 6.55, family: 'Qwen 3.5', kind: 'vision', tools: true, note: 'High quality with images. Needs an 8 GB+ GPU to be quick.' },
  { name: 'qwen3:14b', sizeGb: 9.28, family: 'Qwen 3', kind: 'general', tools: true, note: 'For 12 GB+ GPUs.' },
  { name: 'gemma3:27b', sizeGb: 17.41, family: 'Gemma 3', kind: 'vision', tools: false, note: 'For 24 GB GPUs.' },
  { name: 'qwen3:30b', sizeGb: 18.56, family: 'Qwen 3', kind: 'general', tools: true, note: 'For 24 GB GPUs.' },
];

const DESKTOP_VRAM_RESERVE_GB = 1.5; // what the OS and browser typically hold on the GPU
const RATING_ORDER = { fast: 3, ok: 2, slow: 1, 'too-big': 0 };

/** RAM/VRAM a model needs at an 8k window: download size plus working memory. */
export const memoryNeededGb = model => +(model.sizeGb + 0.4).toFixed(2);

let hardwareCache = null;

/** Detect what this computer has. Works with no GPU, NVIDIA GPUs and Apple Silicon. */
export async function detectHardware({ exec = execFileAsync, fresh = false } = {}) {
  if (hardwareCache && !fresh && Date.now() - hardwareCache.at < 60_000) return hardwareCache.value;
  const ramGb = +(os.totalmem() / 2 ** 30).toFixed(1);
  const base = { platform: process.platform, arch: process.arch, cores: os.cpus().length, ramGb, gpu: null };
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    // Unified memory: the GPU can use most of system RAM.
    base.gpu = { name: 'Apple Silicon', vramGb: +(ramGb * 0.65).toFixed(1), unified: true };
  } else {
    try {
      const { stdout } = await exec('nvidia-smi', ['--query-gpu=name,memory.total', '--format=csv,noheader,nounits'], { timeout: 4000, windowsHide: true });
      const [name, mib] = stdout.trim().split(/\r?\n/)[0].split(',').map(s => s.trim());
      if (name && Number(mib) > 0) base.gpu = { name, vramGb: +(Number(mib) / 1024).toFixed(1), unified: false };
    } catch {
      // No NVIDIA GPU or driver: models run on the CPU. Other GPU brands are treated the same
      // because their usable memory cannot be read reliably.
    }
  }
  hardwareCache = { at: Date.now(), value: base };
  return base;
}

/** How a model will run on given hardware: fast, ok, slow or too-big, with the reason in words. */
export function rateFit(model, hw) {
  const need = memoryNeededGb(model);
  const gpuRoom = hw.gpu ? hw.gpu.vramGb - (hw.gpu.unified ? 0 : DESKTOP_VRAM_RESERVE_GB) : 0;
  if (hw.gpu && need <= gpuRoom) return { rating: 'fast', reason: `Fits on your ${hw.gpu.name} (${need} GB needed)` };
  if (need <= 2.2 && hw.ramGb >= 8) return { rating: 'ok', reason: 'Small enough to run well on the processor alone' };
  if (need <= hw.ramGb * 0.55) {
    return { rating: 'slow', reason: hw.gpu ? `Larger than your GPU's ${hw.gpu.vramGb} GB, so part runs on the processor` : 'Runs on the processor only; expect slow replies' };
  }
  return { rating: 'too-big', reason: `Needs about ${need} GB; this computer has ${hw.ramGb} GB of memory` };
}

const usable = r => RATING_ORDER[r] >= RATING_ORDER.ok;

/** Pick a first model for this computer: the largest tool-capable general model that runs well. */
export function recommendModel(hw, catalog = MODEL_CATALOG) {
  const rated = catalog.filter(m => m.tools && m.kind !== 'code').map(m => ({ ...m, ...rateFit(m, hw) }));
  const good = rated.filter(m => m.rating === 'fast').sort((a, b) => b.sizeGb - a.sizeGb);
  // Above ~6 GB the gain per extra download gigabyte is small for a first install.
  // On processor-only machines every candidate is small, so prefer the one whose tool use has
  // actually been measured in Mimir over a slightly larger untested one.
  const okOnes = rated.filter(m => m.rating === 'ok').sort((a, b) => Number(Boolean(b.verified)) - Number(Boolean(a.verified)) || b.sizeGb - a.sizeGb);
  const pick = good.find(m => m.sizeGb <= 6) || good[0] || okOnes[0];
  return pick || rated.filter(m => m.rating === 'slow').sort((a, b) => a.sizeGb - b.sizeGb)[0] || null;
}

/**
 * Choose routing tiers from the models that are actually installed.
 * fast = smallest usable, balanced = largest that runs fast, heavy = largest that fits at all.
 */
export function pickTiers(installed, hw) {
  const rated = installed
    .map(m => ({ name: m.name, sizeGb: m.sizeGb, ...rateFit(m, hw) }))
    .filter(m => m.rating !== 'too-big' && !/embed/i.test(m.name))
    .sort((a, b) => a.sizeGb - b.sizeGb);
  if (!rated.length) return {};
  const good = rated.filter(m => usable(m.rating));
  const fast = (good[0] || rated[0]).name;
  const fastOnes = rated.filter(m => m.rating === 'fast');
  const balanced = (fastOnes.at(-1) || good.at(-1) || rated[0]).name;
  return { fast_local: fast, balanced_local: balanced, heavy_local: rated.at(-1).name };
}

const trimUrl = u => String(u || '').replace(/\/+$/, '');
const VALID_MODEL_NAME = /^[a-z0-9][a-z0-9._/-]{0,80}(:[a-zA-Z0-9._-]{1,40})?$/;

export class ModelLibrary {
  constructor({ getSettings, updateSettings, broadcast }) {
    this.getSettings = getSettings;
    this.updateSettings = updateSettings;
    this.broadcast = broadcast;
    this.pulls = new Map(); // name -> { name, status, percent, error, done }
  }

  async #installed() {
    const base = trimUrl(this.getSettings().ollamaUrl);
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      return { running: true, models: (data.models || []).map(m => ({ name: m.name || m.model, sizeGb: +((m.size || 0) / 1e9).toFixed(2) })) };
    } catch (err) {
      return { running: false, models: [], error: err.name === 'TimeoutError' ? 'no answer' : err.message };
    }
  }

  /** Everything the library screen needs in one call. */
  async overview() {
    const [hardware, ollama] = await Promise.all([detectHardware(), this.#installed()]);
    const installedNames = new Set(ollama.models.map(m => m.name));
    const recommended = recommendModel(hardware);
    const catalog = MODEL_CATALOG.map(m => ({
      ...m,
      ...rateFit(m, hardware),
      neededGb: memoryNeededGb(m),
      installed: installedNames.has(m.name) || installedNames.has(m.name.replace(/:latest$/, '')),
      recommended: recommended?.name === m.name,
      pull: this.pulls.get(m.name) || null,
    }));
    const extras = ollama.models
      .filter(m => !MODEL_CATALOG.some(c => c.name === m.name))
      .map(m => ({ ...m, family: 'Installed', kind: 'general', installed: true, ...rateFit(m, hardware) }));
    return {
      hardware,
      ollama: { running: ollama.running, error: ollama.error || null, installUrl: 'https://ollama.com/download', installCommand: process.platform === 'win32' ? 'winget install Ollama.Ollama' : 'curl -fsSL https://ollama.com/install.sh | sh' },
      recommended: recommended?.name || null,
      catalog,
      otherInstalled: extras,
      tiers: this.getSettings().autoTierModels || {},
    };
  }

  /** Recompute routing tiers from installed models; pick a default if the current one is gone. */
  async refreshTiers() {
    const [hardware, ollama] = await Promise.all([detectHardware(), this.#installed()]);
    if (!ollama.running) return {};
    const tiers = pickTiers(ollama.models, hardware);
    const patch = { autoTierModels: tiers };
    const current = this.getSettings().ollamaModel;
    if (tiers.balanced_local && !ollama.models.some(m => m.name === current)) patch.ollamaModel = tiers.balanced_local;
    this.updateSettings(patch);
    return tiers;
  }

  pullStatus(name) {
    return this.pulls.get(name) || null;
  }

  /** Start downloading a model through Ollama. Returns immediately; progress is broadcast. */
  startPull(name) {
    const model = String(name || '').trim();
    if (!VALID_MODEL_NAME.test(model)) throw Object.assign(new Error('That is not a valid model name'), { status: 400 });
    const existing = this.pulls.get(model);
    if (existing && !existing.done) return existing;
    const state = { name: model, status: 'starting', percent: 0, error: null, done: false };
    this.pulls.set(model, state);
    const emit = () => this.broadcast?.('model:pull', { ...state });
    emit();
    this.#runPull(model, state, emit).catch(err => {
      state.error = err?.message || String(err);
      state.status = 'failed';
      state.done = true;
      emit();
    });
    return state;
  }

  async #runPull(model, state, emit) {
    const res = await fetch(`${trimUrl(this.getSettings().ollamaUrl)}/api/pull`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, stream: true }),
    });
    if (!res.ok || !res.body) throw new Error(`Ollama refused the download (HTTP ${res.status})`);
    const decoder = new TextDecoder();
    let buf = '';
    let lastEmit = 0;
    for await (const chunk of res.body) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        const evt = JSON.parse(line);
        if (evt.error) throw new Error(evt.error);
        state.status = evt.status || state.status;
        if (evt.total && evt.completed) state.percent = Math.max(state.percent, Math.min(99, Math.floor((evt.completed / evt.total) * 100)));
        if (Date.now() - lastEmit > 400) {
          lastEmit = Date.now();
          emit();
        }
      }
    }
    if (state.status !== 'success') throw new Error(`Download ended early (${state.status})`);
    state.percent = 100;
    state.done = true;
    await this.refreshTiers();
    emit();
  }
}

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * OpenRouter browser sign-in (OAuth PKCE). The user signs in on openrouter.ai and approves; Mimir
 * receives a key the user controls and can revoke there. Free models need no payment method;
 * paid models bill the user's own OpenRouter account.
 */
export class OpenRouterAuth {
  constructor({ baseUrl = 'https://openrouter.ai' } = {}) {
    this.baseUrl = trimUrl(baseUrl);
    this.pending = new Map(); // state -> { verifier, expiresAt }
  }

  get apiBase() {
    return `${this.baseUrl}/api/v1`;
  }

  begin(callbackUrl) {
    for (const [k, p] of this.pending) if (p.expiresAt < Date.now()) this.pending.delete(k);
    const verifier = b64url(crypto.randomBytes(32));
    const state = b64url(crypto.randomBytes(24));
    this.pending.set(state, { verifier, expiresAt: Date.now() + 10 * 60_000 });
    const url = new URL(`${this.baseUrl}/auth`);
    url.searchParams.set('callback_url', callbackUrl);
    url.searchParams.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest()));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('key_label', 'Mimir');
    return { authorizeUrl: url.toString() };
  }

  /** Exchange the code from the callback for the user's key. `state` is single-use. */
  async complete({ state, code }) {
    const p = this.pending.get(String(state || ''));
    if (!p || p.expiresAt < Date.now()) throw Object.assign(new Error('Unknown or expired sign-in. Start again from Mimir.'), { status: 400 });
    this.pending.delete(state);
    if (!code) throw Object.assign(new Error('Sign-in was cancelled'), { status: 400 });
    const res = await fetch(`${this.apiBase}/auth/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: p.verifier, code_challenge_method: 'S256' }),
      signal: AbortSignal.timeout(15_000),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.key) throw new Error(`OpenRouter did not issue a key (${data.error?.message || data.error || `HTTP ${res.status}`})`);
    return data.key;
  }

  /** Public model list, marked free or paid from OpenRouter's own pricing fields. */
  async listModels() {
    const res = await fetch(`${this.apiBase}/models`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) throw new Error(`OpenRouter model list failed (HTTP ${res.status})`);
    const data = await res.json();
    return (data.data || []).map(m => ({
      id: m.id,
      name: m.name || m.id,
      contextLength: m.context_length || null,
      free: Number(m.pricing?.prompt) === 0 && Number(m.pricing?.completion) === 0,
      tools: Array.isArray(m.supported_parameters) ? m.supported_parameters.includes('tools') : null,
      pricePerMTokIn: m.pricing?.prompt != null ? +(Number(m.pricing.prompt) * 1e6).toFixed(3) : null,
      pricePerMTokOut: m.pricing?.completion != null ? +(Number(m.pricing.completion) * 1e6).toFixed(3) : null,
    }));
  }
}
