import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { VoiceEngine, splitSpeechChunks } from '../daemon/voice.mjs';
import { resolvePythonExe } from '../daemon/foundry.mjs';

const execFileAsync = promisify(execFile);

function makeTempDir(prefix = 'mimir-voice-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('splitSpeechChunks splits prose cleanly without breaking decimals or abbreviations', () => {
  assert.deepEqual(splitSpeechChunks(''), []);
  assert.deepEqual(splitSpeechChunks('   \n  '), []);

  const multi = splitSpeechChunks('Hail brother. The well runs deep! Are you ready?');
  assert.deepEqual(multi, ['Hail brother.', 'The well runs deep!', 'Are you ready?']);

  const technical = splitSpeechChunks('Node v24.22.3 listens on 127.0.0.1. Dr. Mimir spoke clearly.');
  assert.deepEqual(technical, ['Node v24.22.3 listens on 127.0.0.1.', 'Dr. Mimir spoke clearly.']);

  const longText =
    'This is a deliberately long sentence without end punctuation until the very end, designed to split cleanly along comma clauses, semicolons; and spaces so each spoken chunk stays responsive during live duplex conversation.';
  const longChunks = splitSpeechChunks(longText, { maxChunkLength: 90 });
  assert.ok(longChunks.length >= 2);
  for (const c of longChunks) {
    assert.ok(c.length <= 90, `Chunk exceeded maxChunkLength: ${c.length}`);
  }
});

test('VoiceEngine reuses warm Python daemon across multiple calls, caches short buffers, respawns on crash, and closes cleanly', async t => {
  const dir = makeTempDir();
  const engine = new VoiceEngine({ dataDir: dir });
  t.after(async () => {
    await engine.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  // 1. Warmup starts one persistent Python daemon
  const warm = await engine.warmup();
  assert.equal(warm.ok, true);
  assert.equal(warm.sapiOffline, true);
  const stats1 = engine.getDaemonStats();
  assert.equal(stats1.running, true);
  assert.equal(stats1.startCount, 1);
  const firstPid = stats1.pid;
  assert.ok(firstPid > 0);

  // 2. First TTS call reuses the warm daemon
  const r1 = await engine.synthesize({
    text: 'First warm utterance.',
    voice: 'david-sapi',
    engine: 'sapi',
  });
  assert.equal(r1.ok, true);
  assert.equal(r1.cached, false);
  assert.equal(r1.engine, 'windows-sapi5-offline');
  assert.equal(r1.mime, 'audio/wav');
  assert.equal(r1.pid, firstPid);
  assert.ok(Buffer.isBuffer(r1.buffer));
  assert.equal(r1.buffer.subarray(0, 4).toString('ascii'), 'RIFF');

  // 3. Second distinct TTS call reuses the exact same Python PID
  const r2 = await engine.synthesize({
    text: 'Second distinct warm utterance.',
    voice: 'en-GB-RyanNeural',
    engine: 'auto',
    localOnly: true, // localOnly must force SAPI5 immediately
  });
  assert.equal(r2.ok, true);
  assert.equal(r2.cached, false);
  assert.equal(r2.engine, 'windows-sapi5-offline');
  assert.equal(r2.fallbackUsed, false);
  assert.equal(r2.mime, 'audio/wav');
  assert.equal(r2.pid, firstPid);
  assert.equal(engine.getDaemonStats().startCount, 1);

  // 4. Repeat call hits bounded in-memory LRU cache
  const r1Cached = await engine.synthesize({
    text: 'First warm utterance.',
    voice: 'david-sapi',
    engine: 'sapi',
  });
  assert.equal(r1Cached.ok, true);
  assert.equal(r1Cached.cached, true);
  assert.equal(r1Cached.mime, 'audio/wav');
  assert.ok(Buffer.isBuffer(r1Cached.buffer));
  assert.equal(r1Cached.buffer.length, r1.buffer.length);

  // 5. Multi-sentence synthesizeTurn produces a single valid RIFF WAV buffer
  const turn = await engine.synthesizeTurn({
    text: 'Sentence one is ready. Sentence two follows cleanly!',
    engine: 'sapi',
    voice: 'david-sapi',
  });
  assert.equal(turn.ok, true);
  assert.equal(turn.chunkCount, 2);
  assert.equal(turn.mime, 'audio/wav');
  assert.equal(turn.buffer.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(turn.buffer.readUInt32LE(4) + 8, turn.buffer.length);

  // 6. Unexpected daemon crash triggers automatic respawn on next call
  process.kill(firstPid);
  await new Promise(r => setTimeout(r, 120));
  const r3 = await engine.synthesize({
    text: 'Recovered after respawn.',
    engine: 'sapi',
    voice: 'david-sapi',
  });
  assert.equal(r3.ok, true);
  assert.notEqual(r3.pid, firstPid);
  assert.equal(engine.getDaemonStats().startCount, 2);

  // 7. Clean close shuts down daemon without leaving hanging handles
  await engine.close();
  assert.equal(engine.getDaemonStats().running, false);
  assert.equal(engine.getDaemonStats().pid, null);
});

test('scripts/voice_engine.py falls back to SAPI5 when edge_tts fails offline and preserves one-shot CLI mode', async t => {
  const dir = makeTempDir('mimir-voice-py-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

  const pythonExe = resolvePythonExe();
  const scriptPath = path.resolve('scripts', 'voice_engine.py');

  // 1. Backward-compatible one-shot --mode status & --mode tts
  const statusRes = await execFileAsync(pythonExe, [scriptPath, '--mode', 'status'], { windowsHide: true });
  const statusJson = JSON.parse(statusRes.stdout.trim().split(/\r?\n/).pop());
  assert.equal(statusJson.ok, true);
  assert.equal(statusJson.sapiOffline, true);

  const oneShotWav = path.join(dir, 'oneshot.wav');
  const ttsRes = await execFileAsync(
    pythonExe,
    [scriptPath, '--mode', 'tts', '--engine', 'sapi', '--voice', 'david-sapi', '--text', 'One shot works.', '--out', oneShotWav],
    { windowsHide: true }
  );
  const ttsJson = JSON.parse(ttsRes.stdout.trim().split(/\r?\n/).pop());
  assert.equal(ttsJson.ok, true);
  assert.equal(ttsJson.engine, 'windows-sapi5-offline');
  assert.ok(fs.existsSync(oneShotWav));

  // 2. Simulated offline failure in edge_tts -> --mode daemon engine='auto' cleanly falls back to SAPI5
  const fakeSiteDir = path.join(dir, 'fake-site');
  fs.mkdirSync(fakeSiteDir, { recursive: true });
  fs.writeFileSync(
    path.join(fakeSiteDir, 'edge_tts.py'),
    'class Communicate:\n    def __init__(self, *args, **kwargs):\n        pass\n    async def save(self, out_path):\n        raise OSError("Simulated offline network unreachable")\n',
    'utf8'
  );

  const proc = spawn(pythonExe, [scriptPath, '--mode', 'daemon'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, PYTHONPATH: fakeSiteDir },
  });

  const responses = [];
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', chunk => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) responses.push(JSON.parse(line));
    }
  });

  const waitForCount = n =>
    new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Timed out waiting for ${n} daemon responses`)), 20000);
      const check = () => {
        if (responses.length >= n) {
          clearTimeout(deadline);
          resolve(responses[n - 1]);
        } else {
          setTimeout(check, 25);
        }
      };
      check();
    });

  const autoOut = path.join(dir, 'auto-fallback.mp3');
  proc.stdin.write(
    `${JSON.stringify({ id: 1, op: 'tts', engine: 'auto', voice: 'en-GB-RyanNeural', text: 'Offline fallback test.', outPath: autoOut })}\n`
  );
  const rAuto = await waitForCount(1);
  assert.equal(rAuto.id, 1);
  assert.equal(rAuto.ok, true);
  assert.equal(rAuto.engine, 'windows-sapi5-offline');
  assert.equal(rAuto.mime, 'audio/wav');
  assert.equal(rAuto.fallbackUsed, true);
  assert.ok(fs.existsSync(rAuto.outPath));
  assert.equal(fs.readFileSync(rAuto.outPath).subarray(0, 4).toString('ascii'), 'RIFF');

  const exitPromise = proc.exitCode !== null ? Promise.resolve() : new Promise(resolve => proc.once('exit', resolve));
  proc.stdin.write(`${JSON.stringify({ id: 2, op: 'shutdown' })}\n`);
  const rShut = await waitForCount(2);
  assert.equal(rShut.ok, true);
  assert.equal(rShut.shuttingDown, true);

  await exitPromise;
});

test('VoiceEngine enforces bounded LRU buffer cache, serialized queue, and per-request timeout respawn', async t => {
  const dir = makeTempDir('mimir-voice-lru-');
  const stubScript = path.join(dir, 'stub_voice.py');
  fs.writeFileSync(
    stubScript,
    `import json, os, sys, time
for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    req = json.loads(line)
    op = req.get("op")
    if op == "shutdown":
        sys.stdout.write(json.dumps({"id": req["id"], "ok": True, "shuttingDown": True}) + "\\n")
        sys.stdout.flush()
        sys.exit(0)
    if op == "tts":
        text = req.get("text", "")
        if text == "hang":
            time.sleep(2.0)
        out_path = req["outPath"]
        os.makedirs(os.path.dirname(out_path), exist_ok=True)
        payload = b"RIFF" + (40).to_bytes(4, "little") + b"WAVEfmt " + (16).to_bytes(4, "little") + b"\\x01\\x00\\x01\\x00\\x80\\x3e\\x00\\x00\\x00\\x7d\\x00\\x00\\x02\\x00\\x10\\x00data" + (4).to_bytes(4, "little") + text[:4].ljust(4).encode("ascii")
        with open(out_path, "wb") as f:
            f.write(payload)
        sys.stdout.write(json.dumps({"id": req["id"], "ok": True, "engine": "windows-sapi5-offline", "mime": "audio/wav", "outPath": out_path, "pid": os.getpid()}) + "\\n")
        sys.stdout.flush()
`,
    'utf8'
  );

  const engine = new VoiceEngine({
    dataDir: dir,
    scriptPath: stubScript,
    requestTimeoutMs: 250,
    maxCacheEntries: 2,
  });
  t.after(async () => {
    await engine.close();
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });

  // Bounded LRU cache eviction (max 2)
  await engine.synthesize({ text: 'one', engine: 'sapi', voice: 'david-sapi' });
  await engine.synthesize({ text: 'two', engine: 'sapi', voice: 'david-sapi' });
  assert.equal(engine.getDaemonStats().cacheSize, 2);
  // Refresh 'one' so 'two' becomes LRU
  const hitOne = await engine.synthesize({ text: 'one', engine: 'sapi', voice: 'david-sapi' });
  assert.equal(hitOne.cached, true);
  // Adding 'three' evicts 'two', leaving cacheSize at 2
  await engine.synthesize({ text: 'three', engine: 'sapi', voice: 'david-sapi' });
  assert.equal(engine.getDaemonStats().cacheSize, 2);
  const stillOne = await engine.synthesize({ text: 'one', engine: 'sapi', voice: 'david-sapi' });
  assert.equal(stillOne.cached, true);

  // Per-request timeout rejects hung call, respawns daemon, and unblocks queued next call
  const pHang = engine.synthesize({ text: 'hang', engine: 'sapi', voice: 'david-sapi' });
  const pFast = engine.synthesize({ text: 'fast', engine: 'sapi', voice: 'david-sapi' });
  await assert.rejects(pHang, /timed out/i);
  const fastRes = await pFast;
  assert.equal(fastRes.ok, true);
  assert.equal(engine.getDaemonStats().startCount, 2);
});

test('scripts/voice_engine.py daemon lazy-loads and caches faster_whisper WhisperModel once across STT turns', async t => {
  const dir = makeTempDir('mimir-voice-stt-cache-');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));

  const fakeSiteDir = path.join(dir, 'fake-site');
  fs.mkdirSync(fakeSiteDir, { recursive: true });
  const initCountFile = path.join(dir, 'init-count.txt');
  fs.writeFileSync(
    path.join(fakeSiteDir, 'faster_whisper.py'),
    `import pathlib
class _Seg:
    def __init__(self, text): self.text = text
class _Info:
    language = "en"
class WhisperModel:
    def __init__(self, size, device="cpu", compute_type="int8"):
        p = pathlib.Path(${JSON.stringify(initCountFile)})
        prev = int(p.read_text()) if p.exists() else 0
        p.write_text(str(prev + 1))
    def transcribe(self, audio_path, beam_size=1):
        return ([_Seg("warm cached transcript")], _Info())
`,
    'utf8'
  );

  const dummyAudio = path.join(dir, 'sample.wav');
  fs.writeFileSync(dummyAudio, Buffer.from('RIFF0000WAVEfmt ', 'ascii'));

  const pythonExe = resolvePythonExe();
  const scriptPath = path.resolve('scripts', 'voice_engine.py');
  const proc = spawn(pythonExe, [scriptPath, '--mode', 'daemon'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env: { ...process.env, PYTHONPATH: fakeSiteDir },
  });

  const responses = [];
  let buf = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', chunk => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line) responses.push(JSON.parse(line));
    }
  });

  const waitForCount = n =>
    new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error(`Timed out waiting for response ${n}`)), 15000);
      const check = () => {
        if (responses.length >= n) {
          clearTimeout(deadline);
          resolve(responses[n - 1]);
        } else {
          setTimeout(check, 20);
        }
      };
      check();
    });

  proc.stdin.write(`${JSON.stringify({ id: 1, op: 'stt', audioPath: dummyAudio, model: 'tiny' })}\n`);
  const stt1 = await waitForCount(1);
  assert.equal(stt1.ok, true);
  assert.equal(stt1.text, 'warm cached transcript');
  assert.equal(stt1.modelCached, false);

  proc.stdin.write(`${JSON.stringify({ id: 2, op: 'stt', audioPath: dummyAudio, model: 'tiny' })}\n`);
  const stt2 = await waitForCount(2);
  assert.equal(stt2.ok, true);
  assert.equal(stt2.text, 'warm cached transcript');
  assert.equal(stt2.modelCached, true);
  assert.equal(stt2.pid, stt1.pid);
  assert.equal(fs.readFileSync(initCountFile, 'utf8').trim(), '1');

  const exitPromise = proc.exitCode !== null ? Promise.resolve() : new Promise(resolve => proc.once('exit', resolve));
  proc.stdin.write(`${JSON.stringify({ id: 3, op: 'shutdown' })}\n`);
  const shut = await waitForCount(3);
  assert.equal(shut.ok, true);
  await exitPromise;
});
