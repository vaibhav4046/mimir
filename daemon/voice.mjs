import { execFile, spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { resolvePythonExe } from './foundry.mjs';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const VOICE_SCRIPT = path.resolve(__dirname, '..', 'scripts', 'voice_engine.py');

const ABBREVIATIONS_RE = /(?:^|\s)(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|etc|e\.g|i\.e|Fig|No|v\d+)\.$/i;

const BACKCHANNEL_RE = /^(?:mm+[- ]?h+m+|uh+[- ]?h+u+h|mhm|yeah|yep|yup|yea|okay|ok|right|sure|got\s+it|ah+|oh+|cool|nice|alright)[.!?,]*$/i;

/**
 * Classifies short conversational backchannels vs genuine user interruptions (barge-in).
 * Backchannels during active TTS do not cancel speech playback.
 */
export function evaluateVoiceTurn({ transcript = '', durationMs = 0, ttsActive = false } = {}) {
  const clean = String(transcript || '').trim();
  const wordCount = clean ? clean.split(/\s+/).length : 0;
  const dur = Number(durationMs) || 0;
  const isBackchannel = Boolean(clean) && wordCount <= 3 && (dur === 0 || dur < 1200) && BACKCHANNEL_RE.test(clean);
  const bargeInTriggered = Boolean(ttsActive) && Boolean(clean) && !isBackchannel;
  return {
    ok: true,
    transcript: clean,
    wordCount,
    durationMs: dur,
    ttsActive: Boolean(ttsActive),
    isBackchannel,
    backchannelIgnored: Boolean(ttsActive) && isBackchannel,
    bargeInTriggered,
    ttsCancelled: bargeInTriggered,
    action: !clean
      ? 'ignore_silence'
      : isBackchannel
        ? 'ignore_backchannel'
        : bargeInTriggered
          ? 'barge_in_interrupt'
          : 'process_turn',
  };
}

function stripMarkdownForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' code block omitted. ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitLongClause(clause, maxLen = 220) {
  if (clause.length <= maxLen) return [clause];
  const out = [];
  const subParts = clause.split(/(?<=[,;:\u2014-])\s+/);
  let current = '';
  for (const part of subParts) {
    if (!part) continue;
    if (!current) {
      if (part.length <= maxLen) {
        current = part;
      } else {
        // Split very long unbroken text on word boundaries.
        const words = part.split(/\s+/);
        let line = '';
        for (const w of words) {
          if (!line) {
            line = w;
          } else if (line.length + 1 + w.length <= maxLen) {
            line += ` ${w}`;
          } else {
            out.push(line);
            line = w;
          }
        }
        if (line) current = line;
      }
    } else if (current.length + 1 + part.length <= maxLen) {
      current += ` ${part}`;
    } else {
      out.push(current);
      current = part;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Splits prose into natural conversational sentence chunks for responsive TTS playback.
 */
export function splitSpeechChunks(text, { maxChunkLength = 220 } = {}) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];

  const chunks = [];
  const paragraphs = normalized.split(/\n+/);
  for (const para of paragraphs) {
    const cleanPara = para.replace(/\s+/g, ' ').trim();
    if (!cleanPara) continue;

    const rawSentences = cleanPara.split(/(?<=[.!?]["')\]]*)\s+/);
    const mergedSentences = [];
    for (const seg of rawSentences) {
      const piece = seg.trim();
      if (!piece) continue;
      if (mergedSentences.length > 0 && ABBREVIATIONS_RE.test(mergedSentences[mergedSentences.length - 1])) {
        mergedSentences[mergedSentences.length - 1] += ` ${piece}`;
      } else {
        mergedSentences.push(piece);
      }
    }

    for (const sentence of mergedSentences) {
      for (const piece of splitLongClause(sentence, maxChunkLength)) {
        if (piece) chunks.push(piece);
      }
    }
  }
  return chunks;
}

function concatWavBuffers(buffers) {
  if (buffers.length === 1) return buffers[0];
  let fmtChunk = null;
  const dataParts = [];

  for (const buf of buffers) {
    if (!Buffer.isBuffer(buf) || buf.length < 44) continue;
    if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') continue;
    let offset = 12;
    while (offset + 8 <= buf.length) {
      const id = buf.toString('ascii', offset, offset + 4);
      const size = buf.readUInt32LE(offset + 4);
      const dataStart = offset + 8;
      const dataEnd = Math.min(buf.length, dataStart + size);
      if (id === 'fmt ' && !fmtChunk) {
        fmtChunk = buf.subarray(dataStart, dataEnd);
      } else if (id === 'data') {
        dataParts.push(buf.subarray(dataStart, dataEnd));
      }
      offset = dataStart + size + (size % 2);
    }
  }

  if (!fmtChunk || dataParts.length === 0) {
    return Buffer.concat(buffers);
  }

  const pcm = Buffer.concat(dataParts);
  const header = Buffer.alloc(12 + 8 + fmtChunk.length + 8);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(4 + 8 + fmtChunk.length + 8 + pcm.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(fmtChunk.length, 16);
  fmtChunk.copy(header, 20);
  const dataOffset = 20 + fmtChunk.length;
  header.write('data', dataOffset, 'ascii');
  header.writeUInt32LE(pcm.length, dataOffset + 4);
  return Buffer.concat([header, pcm]);
}

function concatMp3Buffers(buffers) {
  if (buffers.length === 1) return buffers[0];
  const parts = buffers.map((buf, idx) => {
    if (idx > 0 && buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
      const tagSize =
        ((buf[6] & 0x7f) << 21) |
        ((buf[7] & 0x7f) << 14) |
        ((buf[8] & 0x7f) << 7) |
        (buf[9] & 0x7f);
      return buf.subarray(Math.min(buf.length, 10 + tagSize));
    }
    return buf;
  });
  return Buffer.concat(parts);
}

export class VoiceEngine {
  #proc = null;
  #stdoutBuf = '';
  #stderrTail = '';
  #pending = null;
  #queue = Promise.resolve();
  #nextId = 1;
  #closed = false;
  #bufferCache = new Map();
  #daemonStartCount = 0;

  constructor({
    dataDir,
    pythonExe,
    scriptPath = VOICE_SCRIPT,
    requestTimeoutMs = 25000,
    maxCacheEntries = 32,
  }) {
    this.dataDir = dataDir;
    this.voiceDir = path.join(dataDir, 'voice-cache');
    fs.mkdirSync(this.voiceDir, { recursive: true });
    this.pythonExe = pythonExe || resolvePythonExe();
    this.scriptPath = scriptPath;
    this.requestTimeoutMs = requestTimeoutMs;
    this.maxCacheEntries = maxCacheEntries;
  }

  getDaemonStats() {
    const running = Boolean(this.#proc && this.#proc.exitCode === null && !this.#proc.killed);
    return {
      running,
      pid: running ? this.#proc.pid : null,
      startCount: this.#daemonStartCount,
      cacheSize: this.#bufferCache.size,
      closed: this.#closed,
    };
  }

  #setCache(key, entry) {
    if (this.#bufferCache.has(key)) {
      this.#bufferCache.delete(key);
    }
    while (this.#bufferCache.size >= this.maxCacheEntries) {
      const oldestKey = this.#bufferCache.keys().next().value;
      if (oldestKey === undefined) break;
      this.#bufferCache.delete(oldestKey);
    }
    this.#bufferCache.set(key, entry);
  }

  #killDaemonImmediate(proc = this.#proc) {
    if (!proc) return;
    if (this.#proc === proc) {
      this.#proc = null;
    }
    const pid = proc.pid;
    try { proc.removeAllListeners(); } catch {}
    try { proc.stdout?.removeAllListeners(); proc.stdout?.destroy(); } catch {}
    try { proc.stderr?.removeAllListeners(); proc.stderr?.destroy(); } catch {}
    try { proc.stdin?.removeAllListeners(); proc.stdin?.destroy(); } catch {}
    try {
      if (process.platform === 'win32' && pid) {
        // Sweep child powershell.exe workers spawned during SAPI5 synthesis
        const tk = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        tk.on('error', () => {});
        tk.unref?.();
      }
      if (proc.exitCode === null && !proc.killed) {
        proc.kill();
      }
    } catch {}
    try { proc.unref?.(); } catch {}
  }

  #pruneVoiceCacheDir(maxFiles = 64) {
    try {
      const files = fs
        .readdirSync(this.voiceDir)
        .filter(name => /^(?:tts|turn)-/i.test(name))
        .map(name => {
          const full = path.join(this.voiceDir, name);
          const st = fs.statSync(full);
          return { full, mtimeMs: st.mtimeMs };
        })
        .sort((a, b) => b.mtimeMs - a.mtimeMs);
      for (const stale of files.slice(maxFiles)) {
        try {
          fs.unlinkSync(stale.full);
        } catch {}
      }
    } catch {}
  }

  #ensureDaemon() {
    if (this.#closed) {
      throw new Error('VoiceEngine is closed');
    }
    if (this.#proc && this.#proc.exitCode === null && !this.#proc.killed) {
      return this.#proc;
    }

    const proc = spawn(this.pythonExe, [this.scriptPath, '--mode', 'daemon'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.#proc = proc;
    this.#stdoutBuf = '';
    this.#stderrTail = '';
    this.#daemonStartCount += 1;

    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', chunk => {
      if (this.#stdoutBuf.length + chunk.length > 1024 * 1024) {
        const pending = this.#pending;
        this.#pending = null;
        if (pending) {
          clearTimeout(pending.timer);
          pending.reject(new Error('Voice daemon stdout buffer exceeded 1MB limit'));
        }
        this.#killDaemonImmediate(proc);
        return;
      }
      this.#stdoutBuf += chunk;
      let nlIdx;
      while ((nlIdx = this.#stdoutBuf.indexOf('\n')) !== -1) {
        const line = this.#stdoutBuf.slice(0, nlIdx).trim();
        this.#stdoutBuf = this.#stdoutBuf.slice(nlIdx + 1);
        if (!line) continue;
        let parsed;
        try {
          parsed = JSON.parse(line);
        } catch {
          continue;
        }
        const pending = this.#pending;
        if (pending && (parsed.id === pending.id || parsed.id === null)) {
          clearTimeout(pending.timer);
          this.#pending = null;
          pending.resolve(parsed);
        }
      }
    });

    proc.stderr.setEncoding('utf8');
    proc.stderr.on('data', chunk => {
      this.#stderrTail = (this.#stderrTail + chunk).slice(-1200);
    });

    const handleProcStop = reason => {
      if (this.#proc === proc) {
        this.#proc = null;
      }
      const pending = this.#pending;
      if (pending && pending.proc === proc) {
        clearTimeout(pending.timer);
        this.#pending = null;
        pending.reject(new Error(`${reason}${this.#stderrTail ? `: ${this.#stderrTail.trim()}` : ''}`));
      }
    };

    proc.on('error', err => {
      handleProcStop(`Voice daemon process error: ${err.message}`);
    });
    proc.on('exit', (code, signal) => {
      handleProcStop(`Voice daemon exited (${code ?? signal ?? 'unknown'})`);
    });

    return proc;
  }

  #enqueue(fn) {
    const run = this.#queue.then(() => fn(), () => fn());
    this.#queue = run.catch(() => {});
    return run;
  }

  #sendDaemonRequest(payload, timeoutMs = this.requestTimeoutMs) {
    return new Promise((resolve, reject) => {
      let proc;
      try {
        proc = this.#ensureDaemon();
      } catch (err) {
        reject(err);
        return;
      }

      const id = this.#nextId++;
      const timer = setTimeout(() => {
        if (this.#pending && this.#pending.id === id) {
          this.#pending = null;
          this.#killDaemonImmediate(proc);
          reject(new Error(`Voice daemon request timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);
      timer.unref?.();

      this.#pending = { id, proc, resolve, reject, timer };
      try {
        proc.stdin.write(`${JSON.stringify({ id, ...payload })}\n`, 'utf8');
      } catch (err) {
        clearTimeout(timer);
        if (this.#pending?.id === id) {
          this.#pending = null;
        }
        this.#killDaemonImmediate(proc);
        reject(err);
      }
    });
  }

  async warmup({ preloadStt = false, model = 'tiny' } = {}) {
    return this.#enqueue(() => this.#sendDaemonRequest({ op: 'warmup', preloadStt, model }));
  }

  async getStatus() {
    const voices = [
      { id: 'en-GB-RyanNeural', label: 'Mimir Neural (Edge-TTS British)', engine: 'neural', offline: false },
      { id: 'en-US-AndrewNeural', label: 'Mimir Warm Sage (Edge-TTS Andrew)', engine: 'neural', offline: false },
      { id: 'david-sapi', label: 'Mimir Offline (Windows SAPI5 David)', engine: 'sapi', offline: true },
      { id: 'zira-sapi', label: 'Freya Offline (Windows SAPI5 Zira)', engine: 'sapi', offline: true },
    ];
    try {
      let parsed;
      if (this.#proc && this.#proc.exitCode === null && !this.#closed) {
        parsed = await this.#enqueue(() => this.#sendDaemonRequest({ op: 'status' }));
      } else {
        const { stdout } = await execFileAsync(this.pythonExe, [this.scriptPath, '--mode', 'status'], {
          windowsHide: true,
          timeout: this.requestTimeoutMs,
        });
        parsed = JSON.parse(String(stdout || '{}').trim().split(/\r?\n/).pop() || '{}');
      }
      return {
        ...parsed,
        daemonWarm: Boolean(this.#proc && this.#proc.exitCode === null),
        daemonPid: this.#proc?.exitCode === null ? this.#proc.pid : null,
        backchannelFilter: true,
        echoSuppression: 'browser-aec+vad-gate',
        latencyTargets: { firstAudioTargetMs: 700, endToEndTargetMs: 1800, bargeInTargetMs: 250 },
        voices,
      };
    } catch (err) {
      return {
        ok: false,
        error: err.message,
        sapiOffline: false,
        fasterWhisper: false,
        daemonWarm: false,
        voices: [],
      };
    }
  }

  async synthesize({
    text,
    voice = 'en-GB-RyanNeural',
    engine = 'auto',
    rate = 0,
    localOnly = false,
  } = {}) {
    const clean = String(text || '').trim().slice(0, 1200);
    if (!clean) throw new Error('Text is required for TTS synthesis');

    const forceLocal = Boolean(localOnly);
    const reqEngine = String(engine || 'auto').toLowerCase();
    const rawVoice = String(voice || 'en-GB-RyanNeural').trim() || 'en-GB-RyanNeural';
    const effectiveEngine =
      forceLocal || reqEngine === 'sapi' || rawVoice.toLowerCase().endsWith('-sapi')
        ? 'sapi'
        : reqEngine === 'neural'
          ? 'neural'
          : 'auto';
    const effectiveVoice =
      effectiveEngine === 'sapi' && !rawVoice.toLowerCase().endsWith('-sapi')
        ? (/zira|aria|sonia|jenny|libby/i.test(rawVoice) ? 'zira-sapi' : 'david-sapi')
        : rawVoice;

    const cacheKey = `${effectiveEngine}:${effectiveVoice}:${rate}:${forceLocal ? 1 : 0}:${clean}`;
    const memHit = this.#bufferCache.get(cacheKey);
    if (memHit) {
      this.#setCache(cacheKey, memHit);
      if (!fs.existsSync(memHit.outPath)) {
        fs.writeFileSync(memHit.outPath, memHit.buffer);
      }
      return {
        ...memHit,
        cached: true,
      };
    }

    const hash = crypto.createHash('sha256').update(cacheKey).digest('hex').slice(0, 16);
    const prefExt = effectiveEngine === 'sapi' ? 'wav' : 'mp3';
    const targetOutPath = path.join(this.voiceDir, `tts-${hash}.${prefExt}`);

    if (fs.existsSync(targetOutPath) && fs.statSync(targetOutPath).size > 44) {
      const buffer = fs.readFileSync(targetOutPath);
      const entry = {
        ok: true,
        buffer,
        mime: prefExt === 'mp3' ? 'audio/mpeg' : 'audio/wav',
        engine: prefExt === 'mp3' ? 'edge-tts-neural' : 'windows-sapi5-offline',
        voice: effectiveVoice,
        fallbackUsed: false,
        outPath: targetOutPath,
        bytes: buffer.length,
      };
      if (buffer.length <= 2 * 1024 * 1024) {
        this.#setCache(cacheKey, entry);
      }
      return { ...entry, cached: true };
    }

    const res = await this.#enqueue(() =>
      this.#sendDaemonRequest({
        op: 'tts',
        text: clean,
        outPath: targetOutPath,
        engine: effectiveEngine,
        voice: effectiveVoice,
        rate,
        localOnly: forceLocal,
      })
    );
    if (!res?.ok || !res.outPath || !fs.existsSync(res.outPath)) {
      throw new Error(res?.error || 'Voice synthesis failed');
    }

    const buffer = fs.readFileSync(res.outPath);
    const entry = {
      ok: true,
      buffer,
      mime: res.mime || (res.outPath.endsWith('.mp3') ? 'audio/mpeg' : 'audio/wav'),
      engine: res.engine || (res.outPath.endsWith('.mp3') ? 'edge-tts-neural' : 'windows-sapi5-offline'),
      voice: res.voice || effectiveVoice,
      fallbackUsed: Boolean(res.fallbackUsed),
      outPath: res.outPath,
      bytes: buffer.length,
      pid: res.pid || null,
    };
    if (buffer.length <= 2 * 1024 * 1024) {
      this.#setCache(cacheKey, entry);
    }
    return { ...entry, cached: false };
  }

  async synthesizeTurn({ text, ...opts } = {}) {
    const speakable = stripMarkdownForSpeech(text);
    const chunks = splitSpeechChunks(speakable);
    if (chunks.length === 0) {
      throw new Error('Text is required for TTS synthesis');
    }
    if (chunks.length === 1) {
      const single = await this.synthesize({ ...opts, text: chunks[0] });
      return {
        ...single,
        chunkCount: 1,
      };
    }

    const results = [];
    for (const chunk of chunks) {
      results.push(await this.synthesize({ ...opts, text: chunk }));
    }

    const mimes = new Set(results.map(r => r.mime));
    let normalized = results;
    let fallbackUsed = results.some(r => r.fallbackUsed);

    // If a mid-turn fallback caused mixed MP3 + WAV formats, re-synthesize non-WAV chunks as SAPI WAV cleanly.
    if (mimes.size > 1) {
      fallbackUsed = true;
      normalized = [];
      for (let i = 0; i < chunks.length; i += 1) {
        if (results[i].mime === 'audio/wav') {
          normalized.push(results[i]);
        } else {
          normalized.push(await this.synthesize({ ...opts, text: chunks[i], engine: 'sapi', localOnly: true }));
        }
      }
    }

    const mime = normalized[0].mime;
    const engine = normalized[normalized.length - 1].engine;
    const voice = normalized[normalized.length - 1].voice;
    const mergedBuffer =
      mime === 'audio/wav'
        ? concatWavBuffers(normalized.map(r => r.buffer))
        : concatMp3Buffers(normalized.map(r => r.buffer));

    const ext = mime === 'audio/wav' ? 'wav' : 'mp3';
    const turnHash = crypto
      .createHash('sha256')
      .update(`${engine}:${voice}:${opts.rate || 0}:${speakable}`)
      .digest('hex')
      .slice(0, 16);
    const turnOutPath = path.join(this.voiceDir, `turn-${turnHash}.${ext}`);
    fs.writeFileSync(turnOutPath, mergedBuffer);
    this.#pruneVoiceCacheDir();

    return {
      ok: true,
      buffer: mergedBuffer,
      mime,
      engine,
      voice,
      fallbackUsed,
      cached: normalized.every(r => r.cached),
      chunkCount: chunks.length,
      outPath: turnOutPath,
      bytes: mergedBuffer.length,
    };
  }

  async transcribeBase64({ audioBase64, ext = 'wav', model = 'tiny' } = {}) {
    const cleanB64 = String(audioBase64 || '').trim();
    if (!cleanB64) {
      return { ok: false, error: 'Empty audio payload' };
    }
    const decoded = Buffer.from(cleanB64, 'base64');
    if (decoded.length > 12 * 1024 * 1024) {
      return { ok: false, error: 'Audio payload exceeds 12MB limit' };
    }
    const safeExt = String(ext || 'wav').replace(/[^a-z0-9]/gi, '').slice(0, 6) || 'wav';
    const tmpPath = path.join(this.voiceDir, `stt-${crypto.randomBytes(6).toString('hex')}.${safeExt}`);
    fs.writeFileSync(tmpPath, decoded);
    try {
      return await this.#enqueue(() =>
        this.#sendDaemonRequest({
          op: 'stt',
          audioPath: tmpPath,
          model,
        })
      );
    } finally {
      try {
        fs.unlinkSync(tmpPath);
      } catch {}
    }
  }

  async close() {
    this.#closed = true;
    const proc = this.#proc;
    if (!proc) return;

    const pending = this.#pending;
    if (pending) {
      clearTimeout(pending.timer);
      this.#pending = null;
      pending.reject(new Error('VoiceEngine closed'));
    }

    if (proc.exitCode === null && !proc.killed) {
      await new Promise(resolve => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(killTimer);
          resolve();
        };
        const killTimer = setTimeout(() => {
          this.#killDaemonImmediate(proc);
          finish();
        }, 1200);
        killTimer.unref?.();

        proc.once('exit', finish);
        if (proc.exitCode !== null) {
          finish();
          return;
        }
        try {
          if (proc.stdin && !proc.stdin.destroyed && proc.stdin.writable) {
            proc.stdin.write(`${JSON.stringify({ id: this.#nextId++, op: 'shutdown' })}\n`, 'utf8');
            proc.stdin.end();
          } else {
            this.#killDaemonImmediate(proc);
            finish();
          }
        } catch {
          this.#killDaemonImmediate(proc);
          finish();
        }
      });
    }

    this.#killDaemonImmediate(proc);
  }
}
