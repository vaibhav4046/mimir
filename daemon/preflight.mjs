import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolvePythonExe } from './foundry.mjs';
import { resolveChromiumPath } from './local-exec.mjs';
import { probeModels } from './llm-provider.mjs';

const execFileAsync = promisify(execFile);

/** Python import name -> { pip package, feature that needs it }. Mirrors scripts/requirements.txt. */
const PY_MODULES = {
  reportlab: { pip: 'reportlab', feature: 'PDF artifacts' },
  fitz: { pip: 'pymupdf', feature: 'PDF artifacts' },
  docx: { pip: 'python-docx', feature: 'DOCX artifacts' },
  pptx: { pip: 'python-pptx', feature: 'PPTX artifacts' },
  xlsxwriter: { pip: 'xlsxwriter', feature: 'XLSX artifacts' },
  PIL: { pip: 'pillow', feature: 'PNG artifacts, desktop capture' },
  uiautomation: { pip: 'uiautomation', feature: 'desktop control' },
  edge_tts: { pip: 'edge-tts', feature: 'neural voice (optional)' },
  faster_whisper: { pip: 'faster-whisper', feature: 'speech-to-text (optional)' },
};

async function checkPython() {
  const exe = resolvePythonExe();
  const probe = `import importlib.util,json,sys;print(json.dumps({"version":sys.version.split()[0],"mods":{m:bool(importlib.util.find_spec(m)) for m in ${JSON.stringify(Object.keys(PY_MODULES))}}}))`;
  try {
    const { stdout } = await execFileAsync(exe, ['-c', probe], { windowsHide: true, timeout: 20000 });
    const { version, mods } = JSON.parse(stdout.trim().split(/\r?\n/).pop());
    const missing = Object.keys(PY_MODULES).filter(m => !mods[m]);
    return {
      id: 'python',
      ok: missing.length === 0,
      detail: missing.length
        ? `Python ${version} found; missing: ${missing.map(m => `${PY_MODULES[m].pip} (${PY_MODULES[m].feature})`).join(', ')}`
        : `Python ${version} with all packages`,
      fix: missing.length ? `python -m pip install ${missing.map(m => PY_MODULES[m].pip).join(' ')}` : '',
    };
  } catch {
    return {
      id: 'python',
      ok: false,
      detail: 'Python not found. Voice, desktop control and the artifact foundry are unavailable.',
      fix: 'winget install Python.Python.3.13   (then: python -m pip install -r scripts/requirements.txt)',
    };
  }
}

/** Report which optional runtimes are present. Read-only: never installs anything. */
export async function runPreflight({ store, rustBridge }) {
  const settings = store.getSettings();
  const [models, python] = await Promise.all([probeModels(settings), checkPython()]);
  const wanted = settings.ollamaModel;
  const hasModel = models.ollama.models.includes(wanted);
  const browser = resolveChromiumPath();
  const checks = [
    {
      id: 'ollama',
      ok: models.ollama.ok && hasModel,
      detail: !models.ollama.ok
        ? `Ollama is not reachable at ${settings.ollamaUrl} (${models.ollama.error}). Chat needs it unless an OpenAI-compatible endpoint is set.`
        : hasModel
          ? `Ollama running with ${wanted}`
          : `Ollama running, but model ${wanted} is not pulled`,
      fix: !models.ollama.ok ? 'winget install Ollama.Ollama' : hasModel ? '' : `ollama pull ${wanted}`,
    },
    python,
    {
      id: 'browser',
      ok: Boolean(browser),
      detail: browser ? `Browser automation uses ${browser}` : 'No Chromium, Chrome or Edge found. Browser tools are unavailable.',
      fix: browser ? '' : 'winget install Google.Chrome',
    },
    {
      id: 'rust-core',
      ok: Boolean(rustBridge?.isRunning()),
      detail: rustBridge?.isRunning() ? 'Rust core sidecar running' : `Rust core sidecar not running (${rustBridge?.lastError || 'disabled'}). Queue ledger and artifact validation are off.`,
      fix: '',
    },
  ];
  return { ok: checks.every(c => c.ok), checks };
}
