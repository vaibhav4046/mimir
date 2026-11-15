import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

export function resolveRustBinaryPath() {
  const candidates = [
    process.env.MIMIR_RUST_BIN,
    path.join(ROOT_DIR, 'rust', 'target', 'release', process.platform === 'win32' ? 'mimir-daemon.exe' : 'mimir-daemon'),
    path.join(ROOT_DIR, 'rust', 'target', 'debug', process.platform === 'win32' ? 'mimir-daemon.exe' : 'mimir-daemon'),
  ].filter(Boolean);
  return candidates.find(p => fs.existsSync(p)) || null;
}

/**
 * Node-to-Rust sidecar bridge managing `mimir-daemon` for SQLite WAL durable leases,
 * ChaCha20-Poly1305 vault primitives, canonical path checks, redaction, artifact validation,
 * and horizontal `--worker` child nodes.
 */
export class RustCoreBridge {
  constructor({ dataDir, token, maxQueueDepth = 256, port = 0 }) {
    this.dataDir = dataDir;
    this.token = token || 'mimir-local-dev-token';
    this.maxQueueDepth = maxQueueDepth;
    this.requestedPort = port;
    this.binPath = resolveRustBinaryPath();
    this.proc = null;
    this.url = null;
    this.workerProcs = new Map();
    this.lastError = null;
  }

  isRunning() {
    return Boolean(this.url && this.proc && !this.proc.killed);
  }

  async start() {
    if (!this.binPath) {
      this.lastError = 'mimir-daemon binary not built yet';
      return { ok: false, reason: this.lastError };
    }
    if (this.isRunning()) return { ok: true, url: this.url };

    fs.mkdirSync(this.dataDir, { recursive: true });
    const args = [
      '--port',
      String(this.requestedPort),
      '--data-dir',
      this.dataDir,
      '--token',
      this.token,
      '--max-queue',
      String(this.maxQueueDepth),
    ];

    this.proc = spawn(this.binPath, args, {
      cwd: ROOT_DIR,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc.unref?.();

    const stderrLines = [];
    this.proc.stderr.on('data', chunk => {
      stderrLines.push(chunk.toString('utf8'));
    });

    const readyUrl = await new Promise((resolve, reject) => {
      let settled = false;
      const rl = readline.createInterface({ input: this.proc.stdout });
      const cleanup = () => {
        clearTimeout(timer);
        try {
          rl.close();
        } catch {}
      };
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Rust daemon startup timeout. stderr=${stderrLines.join('').slice(0, 300)}`));
      }, 8000);

      rl.on('line', line => {
        const prefix = 'MIMIR_RUST_DAEMON_READY ';
        if (line.startsWith(prefix) && !settled) {
          settled = true;
          cleanup();
          resolve(line.slice(prefix.length).trim());
        }
      });

      this.proc.once('error', err => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Rust daemon spawn error: ${err.message}`));
      });

      this.proc.once('exit', code => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new Error(`Rust daemon exited early (${code}): ${stderrLines.join('').slice(0, 300)}`));
      });
    });

    this.url = readyUrl.replace(/\/+$/, '');
    this.lastError = null;
    return { ok: true, url: this.url, binPath: this.binPath };
  }

  async #req(pathname, { method = 'GET', body } = {}) {
    if (!this.url) {
      throw new Error(this.lastError || 'Rust core daemon unavailable');
    }
    const res = await fetch(`${this.url}${pathname}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Mimir-Token': this.token,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000),
    });
    const text = await res.text();
    let parsed = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = { raw: text };
    }
    if (!res.ok) {
      const err = new Error(parsed?.error || `Rust core HTTP ${res.status}`);
      err.status = res.status;
      err.code = parsed?.code;
      throw err;
    }
    return parsed;
  }

  async health() {
    if (!this.url) return { ok: false, error: this.lastError || 'not started' };
    return this.#req('/health');
  }

  async metrics() {
    if (!this.url) return { ok: false, engine: 'unavailable', error: this.lastError };
    return this.#req('/v1/rust/metrics');
  }

  enqueueTask(spec) {
    return this.#req('/v1/rust/queue/enqueue', { method: 'POST', body: spec });
  }

  claimTask(workerId, { queue = null, leaseMs = 15000 } = {}) {
    return this.#req('/v1/rust/queue/claim', {
      method: 'POST',
      body: { worker_id: workerId, queue, lease_ms: leaseMs },
    });
  }

  heartbeatTask(taskId, workerId, leaseMs = 15000) {
    return this.#req('/v1/rust/queue/heartbeat', {
      method: 'POST',
      body: { task_id: taskId, worker_id: workerId, lease_ms: leaseMs },
    });
  }

  completeTask(taskId, workerId, result = {}) {
    return this.#req('/v1/rust/queue/complete', {
      method: 'POST',
      body: { task_id: taskId, worker_id: workerId, result },
    });
  }

  failTask(taskId, workerId, error, baseBackoffMs = 1000) {
    return this.#req('/v1/rust/queue/fail', {
      method: 'POST',
      body: { task_id: taskId, worker_id: workerId, error: String(error || 'failed'), base_backoff_ms: baseBackoffMs },
    });
  }

  reclaimStaleLeases() {
    return this.#req('/v1/rust/queue/reclaim', { method: 'POST', body: {} });
  }

  listTasks(status = '', limit = 100) {
    const q = new URLSearchParams();
    if (status) q.set('status', status);
    q.set('limit', String(limit));
    return this.#req(`/v1/rust/queue/tasks?${q.toString()}`);
  }

  requeueDlq(taskId) {
    return this.#req(`/v1/rust/queue/dlq/${encodeURIComponent(taskId)}/requeue`, { method: 'POST', body: {} });
  }

  registerWorker(worker) {
    return this.#req('/v1/rust/workers/register', { method: 'POST', body: worker });
  }

  listWorkers() {
    return this.#req('/v1/rust/workers');
  }

  checkSandbox(root, relPath) {
    return this.#req('/v1/rust/sandbox/check', { method: 'POST', body: { root, path: relPath } });
  }

  redactText(text, extraSecrets = []) {
    return this.#req('/v1/rust/redact', {
      method: 'POST',
      body: { text: String(text || ''), extra_secrets: extraSecrets },
    });
  }

  validateArtifact(filePath, format) {
    return this.#req('/v1/rust/artifacts/validate', {
      method: 'POST',
      body: { path: filePath, format },
    });
  }

  registerArtifact(record) {
    return this.#req('/v1/rust/artifacts', { method: 'POST', body: record });
  }

  listArtifacts() {
    return this.#req('/v1/rust/artifacts');
  }

  patchArtifact(id, patch) {
    return this.#req(`/v1/rust/artifacts/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
  }

  deleteArtifact(id) {
    return this.#req(`/v1/rust/artifacts/${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  listAudit() {
    return this.#req('/v1/rust/audit');
  }

  spawnWorkerNode({ workerId = `worker-${Date.now().toString(36)}`, concurrency = 2, once = false } = {}) {
    if (!this.binPath || !this.url) {
      throw new Error('Cannot spawn Rust worker node: core daemon is not running');
    }
    const args = [
      '--worker',
      '--coordinator',
      this.url,
      '--token',
      this.token,
      '--worker-id',
      workerId,
      '--concurrency',
      String(concurrency),
    ];
    if (once) args.push('--once');

    const child = spawn(this.binPath, args, {
      cwd: ROOT_DIR,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.workerProcs.set(workerId, child);
    child.stdout?.resume();
    child.stderr?.resume();
    child.once('error', () => {
      this.workerProcs.delete(workerId);
    });
    child.once('exit', () => {
      this.workerProcs.delete(workerId);
    });
    return { workerId, pid: child.pid };
  }

  #killAndAwait(child) {
    if (!child || child.exitCode !== null || child.killed) {
      try {
        child?.stdout?.destroy();
        child?.stderr?.destroy();
      } catch {}
      return Promise.resolve();
    }
    return new Promise(resolve => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(t);
        try {
          child.stdout?.destroy();
          child.stderr?.destroy();
        } catch {}
        resolve();
      };
      const t = setTimeout(() => {
        if (process.platform === 'win32' && child.pid) {
          spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        } else {
          try { child.kill('SIGKILL'); } catch {}
        }
        finish();
      }, 2000);
      child.once('exit', finish);
      try {
        child.kill('SIGTERM');
      } catch {
        finish();
      }
    });
  }

  async stopWorkerNode(workerId) {
    const child = this.workerProcs.get(workerId);
    if (!child) return false;
    this.workerProcs.delete(workerId);
    await this.#killAndAwait(child);
    return true;
  }

  async close() {
    const kills = [];
    for (const child of this.workerProcs.values()) {
      kills.push(this.#killAndAwait(child));
    }
    this.workerProcs.clear();
    if (this.proc) {
      kills.push(this.#killAndAwait(this.proc));
    }
    await Promise.all(kills);
    this.proc = null;
    this.url = null;
  }
}
