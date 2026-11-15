import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ArtifactFoundry, buildTextArtifact, explainPythonError } from '../daemon/foundry.mjs';
import { runChatTurn } from '../daemon/llm-provider.mjs';

test('a missing Python is explained in plain words; other errors pass through', () => {
  const missing = explainPythonError(Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' }), 'Voice');
  assert.match(missing.message, /^Voice needs Python, which is not installed/);
  assert.match(missing.message, /winget install Python/);
  assert.equal(missing.code, 'PYTHON_MISSING');
  const other = new Error('timed out');
  assert.equal(explainPythonError(other, 'Voice'), other);
});

test('text formats are built without Python and escape HTML', () => {
  const spec = { title: 'Plan <1>', subtitle: 'Sub', sections: [{ heading: 'A & B', body: 'line1\nline2' }], reportMarkdown: '', rows: [] };
  assert.equal(buildTextArtifact('md', spec), '# Plan <1>\n\nSub\n\n## A & B\n\nline1\nline2\n');
  assert.match(buildTextArtifact('txt', spec), /^Plan <1>\n\nSub\n\nA & B\nline1/);
  const html = buildTextArtifact('html', spec);
  assert.ok(html.includes('<h1>Plan &lt;1&gt;</h1>') && html.includes('<h2>A &amp; B</h2>') && html.includes('line1<br>line2'));
  assert.equal(JSON.parse(buildTextArtifact('json', spec)).title, 'Plan <1>');
  assert.equal(buildTextArtifact('md', { ...spec, reportMarkdown: '# Given' }), '# Given\n');
  assert.equal(buildTextArtifact('pdf', spec), null);
});

test('on a computer with no Python: Markdown is still created, PDF says how to fix it', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-nopy-'));
  const saved = { PATH: process.env.PATH, Path: process.env.Path, LOCALAPPDATA: process.env.LOCALAPPDATA, MIMIR_PYTHON: process.env.MIMIR_PYTHON };
  t.after(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  // Hide every place Python could be found.
  delete process.env.Path;
  delete process.env.MIMIR_PYTHON;
  process.env.PATH = dir;
  process.env.LOCALAPPDATA = dir;

  const foundry = new ArtifactFoundry({ dataDir: dir, rustBridge: null });
  const md = await foundry.createArtifact({ format: 'md', title: 'Opening week', sections: [{ heading: 'Day 1', body: 'Bake bread.' }] });
  assert.equal(md.format, 'md');
  assert.match(fs.readFileSync(md.file_path, 'utf8'), /# Opening week[\s\S]*## Day 1[\s\S]*Bake bread\./);

  await assert.rejects(
    foundry.createArtifact({ format: 'pdf', title: 'Opening week', sections: [{ heading: 'Day 1', body: 'Bake bread.' }] }),
    err => err.code === 'PYTHON_MISSING' && err.status === 424 && /Making a PDF file needs Python/.test(err.message),
  );
  const left = fs.readdirSync(path.join(dir, 'foundry')).filter(n => n.startsWith('art-'));
  assert.equal(left.length, 1, 'the failed PDF leaves no empty folder behind');
});

test('chatting with no Ollama running says so in plain words', async () => {
  await assert.rejects(
    runChatTurn({ settings: { provider: 'ollama', ollamaUrl: 'http://127.0.0.1:9', ollamaModel: 'x', enableFallback: false }, messages: [{ role: 'user', content: 'hi' }] }),
    err => err.code === 'MODEL_UNREACHABLE' && /^Can't reach Ollama, the free app that runs AI models on this computer\. Open Ollama, or install it from https:\/\/ollama\.com\/download$/.test(err.message),
  );
});

test('when the backup model is missing too, the error is about the chosen model', async () => {
  await assert.rejects(
    runChatTurn({ settings: { provider: 'ollama', ollamaUrl: 'http://127.0.0.1:9', ollamaModel: 'x', enableFallback: true, openaiBaseUrl: 'http://127.0.0.1:10/v1' }, messages: [{ role: 'user', content: 'hi' }] }),
    err => /^Can't reach Ollama/.test(err.message) && /Can't reach the AI model server/.test(err.fallbackError),
  );
});
