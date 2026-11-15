import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const BUILDER_SCRIPT = path.join(ROOT_DIR, 'scripts', 'foundry_builder.py');

export function resolvePythonExe() {
  const candidates = [
    process.env.MIMIR_PYTHON,
    // Standard per-user python.org install location, for when python is not on PATH.
    path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python', 'Python313', 'python.exe'),
    'python',
    'python3',
  ].filter(Boolean);
  for (const c of candidates) {
    if (!c.includes('\\') && !c.includes('/')) return c;
    if (fs.existsSync(c)) return c;
  }
  return 'python';
}

export const PYTHON_INSTALL_HINT = 'Install it with: winget install Python.Python.3.13 — then restart Mimir. Settings > "This computer" lists any add-ons still missing.';

/** A missing Python shows up as "spawn python ENOENT". Say what that means and how to fix it. */
export function explainPythonError(err, what) {
  if (err?.code !== 'ENOENT') return err;
  return Object.assign(new Error(`${what} needs Python, which is not installed on this computer. ${PYTHON_INSTALL_HINT}`), { code: 'PYTHON_MISSING', status: 424 });
}

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Formats that are plain text can be written without Python. Returns the file content, or null. */
export function buildTextArtifact(fmt, { title, subtitle, sections, reportMarkdown, rows }) {
  const md = reportMarkdown?.trim() || [`# ${title}`, subtitle, ...sections.map(s => `## ${s.heading}\n\n${s.body}`)].filter(Boolean).join('\n\n');
  if (fmt === 'md') return `${md}\n`;
  if (fmt === 'txt') return `${[title, subtitle, ...sections.map(s => `${s.heading}\n${s.body}`)].filter(Boolean).join('\n\n')}\n`;
  if (fmt === 'json') return `${JSON.stringify({ title, subtitle, sections, rows }, null, 2)}\n`;
  if (fmt === 'html') {
    const body = sections.map(s => `<h2>${escapeHtml(s.heading)}</h2>\n<p>${escapeHtml(s.body).replace(/\n/g, '<br>')}</p>`).join('\n');
    return `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${escapeHtml(title)}</title>\n<style>body{font:16px/1.6 system-ui,sans-serif;max-width:720px;margin:40px auto;padding:0 16px}</style>\n</head>\n<body>\n<h1>${escapeHtml(title)}</h1>\n${subtitle ? `<p>${escapeHtml(subtitle)}</p>\n` : ''}${body}\n</body>\n</html>\n`;
  }
  return null;
}

const FORMAT_META = {
  pdf: { kind: 'document', ext: 'pdf', defaultFolder: 'Reports' },
  docx: { kind: 'document', ext: 'docx', defaultFolder: 'Documents' },
  md: { kind: 'document', ext: 'md', defaultFolder: 'Reports' },
  html: { kind: 'document', ext: 'html', defaultFolder: 'Reports' },
  json: { kind: 'document', ext: 'json', defaultFolder: 'Reports' },
  txt: { kind: 'document', ext: 'txt', defaultFolder: 'Reports' },
  pptx: { kind: 'presentation', ext: 'pptx', defaultFolder: 'Decks' },
  xlsx: { kind: 'spreadsheet', ext: 'xlsx', defaultFolder: 'Spreadsheets' },
  png: { kind: 'image', ext: 'png', defaultFolder: 'Images' },
  svg: { kind: 'image', ext: 'svg', defaultFolder: 'Images' },
  zip: { kind: 'code', ext: 'zip', defaultFolder: 'Code Apps' },
  csv: { kind: 'spreadsheet', ext: 'csv', defaultFolder: 'Spreadsheets' },
  glb: { kind: '3d', ext: 'glb', defaultFolder: '3D Models' },
  obj: { kind: '3d', ext: 'obj', defaultFolder: '3D Models' },
  stl: { kind: '3d', ext: 'stl', defaultFolder: '3D Models' },
  webm: { kind: 'video', ext: 'webm', defaultFolder: 'Motion Videos' },
  mp4: { kind: 'video', ext: 'mp4', defaultFolder: 'Motion Videos' },
  gif: { kind: 'video', ext: 'gif', defaultFolder: 'Motion Videos' },
  wav: { kind: 'audio', ext: 'wav', defaultFolder: 'Music & Audio' },
  music: { kind: 'audio', ext: 'wav', defaultFolder: 'Music & Audio' },
  webapp: { kind: 'webapp', ext: 'zip', defaultFolder: 'Web Apps' },
  game: { kind: 'game', ext: 'zip', defaultFolder: 'Games' },
};

function sanitizeCreativeText(val, maxLen = 200) {
  return String(val || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<\/?script[^>]*>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/\son[a-z]+\s*=/gi, ' ')
    .trim()
    .slice(0, maxLen);
}

/**
 * Multi-format Artifact Foundry backed by Python generators (Docs, 3D GLB/OBJ/STL, HD PNG/SVG,
 * Motion WebM/MP4/GIF, Full-Stack WebApps, Playable Canvas Games) + Rust SQLite WAL ledger.
 */
export class ArtifactFoundry {
  constructor({ dataDir, rustBridge, store = null, runChatFn = null }) {
    this.dataDir = dataDir;
    this.foundryDir = path.join(dataDir, 'foundry');
    fs.mkdirSync(this.foundryDir, { recursive: true });
    this.rustBridge = rustBridge;
    this.store = store;
    this.runChatFn = runChatFn;
    this.pythonExe = resolvePythonExe();
    this.fallbackIndexPath = path.join(this.foundryDir, 'artifacts-fallback.json');
  }

  #readFallback() {
    try {
      if (fs.existsSync(this.fallbackIndexPath)) {
        const list = JSON.parse(fs.readFileSync(this.fallbackIndexPath, 'utf8'));
        if (Array.isArray(list)) return list;
      }
    } catch {}
    return [];
  }

  #writeFallback(list) {
    const tmp = `${this.fallbackIndexPath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmp, this.fallbackIndexPath);
  }

  #enrichArtifact(rec) {
    if (!rec || !rec.file_path) return rec;
    try {
      const dir = path.resolve(path.dirname(rec.file_path));
      const root = path.resolve(this.foundryDir);
      if (!dir.startsWith(root)) return rec;
      const previewPath = path.join(dir, 'preview.json');
      if (fs.existsSync(previewPath)) {
        const meta = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
        return {
          ...rec,
          previewKind: meta.kind || rec.kind,
          subtitle: rec.subtitle || meta.subtitle || meta.tagline || '',
          archetype: meta.archetype || meta.genre || undefined,
          hasWebmPreview: Boolean(meta.hasWebmPreview || fs.existsSync(path.join(dir, 'preview.webm'))),
        };
      }
    } catch {
      // Malformed preview sidecar must never break artifact listing.
    }
    return rec;
  }

  async synthesizeHarnessSpec({ prompt = '', format = 'glb', title = '', botId = 'bot-grok-default' }) {
    const cleanPrompt = sanitizeCreativeText(prompt, 500);
    const fmt = String(format || 'glb').toLowerCase();
    const baseTitle = sanitizeCreativeText(title, 80) || cleanPrompt.slice(0, 48) || `Mimir ${fmt.toUpperCase()} Creation`;
    const fallback = {
      title: baseTitle,
      subtitle: cleanPrompt || `Forged locally by Mimir Harness (${fmt.toUpperCase()})`,
      sections: [{ heading: baseTitle, body: cleanPrompt || `Generated ${fmt.toUpperCase()} asset via Mimir Creative Studio.` }],
      creative: { description: cleanPrompt },
    };
    if (!cleanPrompt || !this.runChatFn || !this.store) return fallback;

    try {
      const settings = this.store.getSettings();
      const bot = this.store.getBot(botId);
      const model = bot?.modelOverride || (settings.provider === 'openai-compat' ? settings.openaiModel : settings.ollamaModel);
      if (!model) return fallback;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 7500);
      try {
        const res = await this.runChatFn({
          settings,
          model,
          signal: controller.signal,
          messages: [
            {
              role: 'system',
              content:
                'You are Mimir Creative Studio Spec Synthesizer. Output ONLY compact JSON (no markdown) with keys: title, subtitle, sections (array of {heading, body}), creative ({archetype: "starfighter"|"golem"|"citadel"|"mjolnir"|"cosmic-crystal", theme: "norse"|"cyber"|"emerald"|"crimson"|"arctic", gameGenre: "space-shooter"|"dungeon-crawler"|"brick-breaker", description}).',
            },
            {
              role: 'user',
              content: `Format: ${fmt}\nTitle hint: ${baseTitle}\nPrompt: ${cleanPrompt}`,
            },
          ],
          tools: [],
        });
        const raw = String(res?.content || '').trim();
        const match = raw.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]);
          return {
            title: sanitizeCreativeText(parsed.title || baseTitle, 80) || baseTitle,
            subtitle: sanitizeCreativeText(parsed.subtitle || fallback.subtitle, 140) || fallback.subtitle,
            sections: Array.isArray(parsed.sections) && parsed.sections.length
              ? parsed.sections.slice(0, 4).map(s => ({
                  heading: sanitizeCreativeText(s?.heading || 'Spec', 60),
                  body: sanitizeCreativeText(s?.body || '', 220),
                }))
              : fallback.sections,
            creative: {
              ...(typeof parsed.creative === 'object' && parsed.creative ? parsed.creative : {}),
              description: cleanPrompt,
            },
          };
        }
      } finally {
        clearTimeout(timer);
      }
    } catch {
      // Model offline / busy / invalid JSON -> deterministic prompt-aware creative spec.
    }
    return fallback;
  }

  async listArtifacts() {
    let items = [];
    if (this.rustBridge?.isRunning()) {
      const res = await this.rustBridge.listArtifacts();
      items = res?.artifacts || [];
    } else {
      items = this.#readFallback();
    }
    return items.map(item => this.#enrichArtifact(item));
  }

  async createArtifact({
    title = '',
    subtitle = '',
    prompt = '',
    format = 'pdf',
    folder,
    sections = [],
    rows = [],
    reportMarkdown = '',
    creative = null,
    botId = 'bot-grok-default',
    favorite = false,
  }) {
    const fmt = String(format || 'pdf').toLowerCase();
    const specMeta = FORMAT_META[fmt];
    if (!specMeta) {
      throw new Error(`Unsupported artifact format: ${fmt}`);
    }

    let effTitle = sanitizeCreativeText(title, 90);
    let effSubtitle = sanitizeCreativeText(subtitle, 160);
    let effSections = Array.isArray(sections) ? sections : [];
    let effCreative = creative && typeof creative === 'object' ? { ...creative } : {};

    if (prompt && (!effSections.length || !Object.keys(effCreative).length || !effTitle)) {
      const synth = await this.synthesizeHarnessSpec({ prompt, format: fmt, title: effTitle, botId });
      effTitle = effTitle || synth.title;
      effSubtitle = effSubtitle || synth.subtitle;
      if (!effSections.length) effSections = synth.sections;
      effCreative = { ...synth.creative, ...effCreative };
    }
    effTitle = effTitle || 'MIMIR Deliverable';

    const id = `art-${crypto.randomBytes(5).toString('hex')}`;
    const slug = String(effTitle || 'artifact')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'artifact';

    const outDir = path.join(this.foundryDir, id);
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `${slug}.${specMeta.ext}`);
    const specPath = path.join(outDir, 'spec.json');

    const normalizedSections = Array.isArray(effSections) && effSections.length
      ? effSections.map(s => ({
          heading: sanitizeCreativeText(s?.heading || 'Overview', 120),
          body: sanitizeCreativeText(s?.body || '', 4000),
        }))
      : [{ heading: 'Overview', body: effSubtitle || `Created cleanly for ${effTitle}` }];

    fs.writeFileSync(
      specPath,
      JSON.stringify({
        format: fmt,
        title: effTitle,
        subtitle: effSubtitle,
        sections: normalizedSections,
        rows,
        reportMarkdown: String(reportMarkdown || '').slice(0, 120000),
        creative: effCreative,
        outPath,
      }, null, 2),
      'utf8'
    );

    let pyResult;
    try {
      // Looked up at use time so a Python installed after Mimir started is found.
      const { stdout } = await execFileAsync(resolvePythonExe(), [BUILDER_SCRIPT, '--spec', specPath], {
        cwd: outDir,
        windowsHide: true,
        timeout: 45000,
      });
      pyResult = JSON.parse(String(stdout || '{}').trim().split(/\r?\n/).pop() || '{}');
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err;
      // No Python on this computer: plain-text formats are still written here.
      const text = buildTextArtifact(fmt, { title: effTitle, subtitle: effSubtitle, sections: normalizedSections, reportMarkdown, rows });
      if (text === null) {
        fs.rmSync(outDir, { recursive: true, force: true });
        throw explainPythonError(err, `Making a ${fmt.toUpperCase()} file`);
      }
      fs.writeFileSync(outPath, text, 'utf8');
      pyResult = { ok: true, meta: { builder: 'built-in', note: 'Written without Python' } };
    }
    if (!pyResult.ok || !fs.existsSync(outPath)) {
      throw new Error(`Foundry builder failed for ${fmt}`);
    }

    const resolvedFolder = String(folder || specMeta.defaultFolder).trim() || specMeta.defaultFolder;

    if (this.rustBridge?.isRunning()) {
      const rec = await this.rustBridge.registerArtifact({
        id,
        title: effTitle,
        folder: resolvedFolder,
        kind: specMeta.kind,
        format: fmt,
        file_path: outPath,
        favorite: Boolean(favorite),
        bot_id: botId,
      });
      return this.#enrichArtifact({ ...rec, subtitle: effSubtitle, buildMeta: pyResult.meta });
    }

    const bytes = fs.readFileSync(outPath);
    const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
    const fallbackRec = {
      id,
      title: effTitle,
      subtitle: effSubtitle,
      folder: resolvedFolder,
      kind: specMeta.kind,
      format: fmt,
      file_path: outPath,
      sha256,
      size_bytes: bytes.length,
      favorite: Boolean(favorite),
      verified: true,
      bot_id: botId,
      created_at: Date.now(),
    };
    const list = this.#readFallback();
    list.unshift(fallbackRec);
    this.#writeFallback(list);
    return this.#enrichArtifact({ ...fallbackRec, buildMeta: pyResult.meta });
  }

  async getArtifact(id) {
    const list = await this.listArtifacts();
    return list.find(a => a.id === id) || null;
  }

  async getArtifactPreview(id) {
    const art = await this.getArtifact(id);
    if (!art || !art.file_path) return null;
    const dir = path.resolve(path.dirname(art.file_path));
    if (!dir.startsWith(path.resolve(this.foundryDir))) return null;
    const previewPath = path.join(dir, 'preview.json');
    let preview = null;
    if (fs.existsSync(previewPath)) {
      try {
        preview = JSON.parse(fs.readFileSync(previewPath, 'utf8'));
      } catch {
        preview = null;
      }
    }
    const webmPreviewPath = path.join(dir, 'preview.webm');
    const posterPath = path.join(dir, 'poster.png');
    return {
      artifact: art,
      preview,
      hasWebmPreview: fs.existsSync(webmPreviewPath),
      webmPreviewPath: fs.existsSync(webmPreviewPath) ? webmPreviewPath : null,
      posterPath: fs.existsSync(posterPath) ? posterPath : null,
    };
  }

  async updateMeta(id, patch) {
    if (this.rustBridge?.isRunning()) {
      return this.rustBridge.patchArtifact(id, patch);
    }
    const list = this.#readFallback();
    const item = list.find(a => a.id === id);
    if (!item) throw new Error(`Artifact not found: ${id}`);
    if (typeof patch.favorite === 'boolean') item.favorite = patch.favorite;
    if (typeof patch.folder === 'string') item.folder = patch.folder;
    this.#writeFallback(list);
    return item;
  }

  async deleteArtifact(id) {
    let existing = null;
    if (this.rustBridge?.isRunning()) {
      const res = await this.rustBridge.deleteArtifact(id);
      existing = res?.artifact || null;
    } else {
      const list = this.#readFallback();
      existing = list.find(a => a.id === id) || null;
      this.#writeFallback(list.filter(a => a.id !== id));
    }
    if (existing?.file_path && fs.existsSync(existing.file_path)) {
      const dir = path.dirname(existing.file_path);
      if (dir.startsWith(this.foundryDir)) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }
    return Boolean(existing);
  }
}
