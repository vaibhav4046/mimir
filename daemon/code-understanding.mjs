import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const DEFAULT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_EXTS = new Set(['.mjs', '.js', '.jsx', '.cjs', '.ts', '.tsx', '.py', '.rs', '.go', '.java', '.json', '.md']);
const IGNORED = new Set(['.git', '.ua', '.understand-anything', 'node_modules', 'dist', 'build', 'release', 'coverage', '.next', '.venv', 'venv', '.cache', '.turbo', 'target', '.vercel', 'MIMIR_NORSE_COMPLETE_ASSET_LIBRARY']);
const MAX_FILES = 10000;
const MAX_SOURCE_BYTES = 512 * 1024;
const MAX_GRAPH_BYTES = 32 * 1024 * 1024;

function contentHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function scanFiles(root) {
  const files = [];
  const walk = dir => {
    if (files.length >= MAX_FILES) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink() || IGNORED.has(entry.name) || entry.name.startsWith('.env')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && SOURCE_EXTS.has(path.extname(entry.name).toLowerCase())) {
        const st = fs.statSync(full);
        if (st.size <= MAX_SOURCE_BYTES) files.push(path.relative(root, full).split(path.sep).join('/'));
      }
      if (files.length >= MAX_FILES) return;
    }
  };
  walk(root);
  return files;
}

function layerFor(file) {
  if (/^(renderer|src\/components|ui)\//.test(file)) return 'UI';
  if (/^(electron|desktop)\//.test(file)) return 'Desktop';
  if (/^(daemon|backend|server)\//.test(file)) return 'Service';
  if (/^(scripts|tools)\//.test(file)) return 'Tooling';
  if (/^(tests|__tests__)\//.test(file)) return 'Test';
  if (/\.md$/.test(file)) return 'Documentation';
  return 'Core';
}

function definitions(text, file) {
  const ext = path.extname(file);
  if (ext === '.json' || ext === '.md') return [];
  const result = [];
  const patterns = ext === '.py'
    ? [/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/, /^\s*class\s+([A-Za-z_]\w*)/]
    : ext === '.rs'
      ? [/^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)/, /^\s*(?:pub\s+)?(?:struct|enum|trait)\s+([A-Za-z_]\w*)/]
      : [/^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/,
        /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/,
        /^\s*(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    for (const re of patterns) {
      const match = re.exec(lines[index]);
      if (match) {
        const kind = /class|struct|enum|trait/.test(re.source) ? 'Class' : 'Function';
        result.push({ name: match[1], kind, line: index + 1 });
        break;
      }
    }
  }
  return result;
}

function importsFor(text, file) {
  const ext = path.extname(file);
  if (ext === '.md' || ext === '.json') return [];
  const imports = new Set();
  const patterns = ext === '.py'
    ? [/^\s*from\s+([\w.]+)\s+import\s+/gm, /^\s*import\s+([\w.]+)/gm]
    : ext === '.rs'
      ? [/^\s*use\s+([\w:]+)/gm]
      : [/(?:import|export)\s+(?:[\s\S]{0,150}?\s+from\s+)?['"]([^'"]+)['"]/g,
        /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
        /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g];
  for (const re of patterns) {
    for (const match of text.matchAll(re)) imports.add(match[1]);
  }
  return [...imports].sort();
}

function resolveLocalImport(file, specifier, fileSet) {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(file), specifier));
  if (base.startsWith('../') || path.posix.isAbsolute(base)) return null;
  for (const candidate of [base, ...[...SOURCE_EXTS].map(ext => base + ext), ...[...SOURCE_EXTS].map(ext => base + '/index' + ext)]) {
    if (fileSet.has(candidate)) return candidate;
  }
  return null;
}

function buildStaticGraph(root) {
  const files = scanFiles(root);
  const fileSet = new Set(files);
  const nodes = [];
  const edges = [];
  const nodeIds = new Set();
  const edgeIds = new Set();
  const addNode = node => {
    if (!nodeIds.has(node.id)) { nodeIds.add(node.id); nodes.push(node); }
  };
  const addEdge = (from, to, relation) => {
    if (!nodeIds.has(from) || !nodeIds.has(to)) return;
    const key = JSON.stringify([from, to, relation]);
    if (!edgeIds.has(key)) { edgeIds.add(key); edges.push({ from, to, relation }); }
  };
  addNode({ id: 'project:root', type: 'Project', label: path.basename(root), layer: 'Core', path: '.' });
  const folders = new Set();
  for (const file of files) {
    const chunks = file.split('/');
    for (let i = 1; i < chunks.length; i++) folders.add(chunks.slice(0, i).join('/'));
  }
  for (const folder of [...folders].sort()) {
    const id = 'folder:' + folder;
    addNode({ id, type: 'Folder', label: path.posix.basename(folder), path: folder, layer: layerFor(folder + '/') });
    const parent = path.posix.dirname(folder);
    addEdge(parent === '.' ? 'project:root' : 'folder:' + parent, id, 'contains');
  }
  const contents = new Map();
  for (const file of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, file), 'utf8'); } catch { continue; }
    contents.set(file, text);
    const id = 'file:' + file;
    addNode({
      id, type: 'File', label: path.posix.basename(file), path: file, layer: layerFor(file),
      hash: contentHash(text), lines: text.split(/\r?\n/).length,
      summary: 'Source file in ' + layerFor(file) + ' layer'
    });
    const parent = path.posix.dirname(file);
    addEdge(parent === '.' ? 'project:root' : 'folder:' + parent, id, 'contains');
    for (const def of definitions(text, file)) {
      const defId = 'symbol:' + file + ':' + def.line + ':' + def.name;
      addNode({
        id: defId, type: def.kind, label: def.name, path: file, line: def.line,
        layer: layerFor(file), summary: def.kind + ' defined at ' + file + ':' + def.line
      });
      addEdge(id, defId, 'defines');
    }
  }
  for (const [file, text] of contents) {
    for (const specifier of importsFor(text, file)) {
      const resolved = resolveLocalImport(file, specifier, fileSet);
      if (resolved && contents.has(resolved)) {
        addEdge('file:' + file, 'file:' + resolved, 'imports');
      } else if (!specifier.startsWith('.')) {
        const pkg = specifier.replace(/^(node:)/, '');
        const pkgName = pkg.startsWith('@') ? pkg.split('/').slice(0, 2).join('/') : pkg.split('/')[0];
        const id = 'package:' + pkgName;
        addNode({ id, type: 'Dependency', label: pkgName, path: null, layer: 'External' });
        addEdge('file:' + file, id, 'imports');
      }
    }
  }
  const result = {
    schemaVersion: 'mimir.knowledge-graph.v1',
    source: 'mimir-static-scanner',
    provenance: { root, mode: 'local-deterministic', limitations: 'Static imports and top-level declarations; dynamic call graphs and semantic claims require analysis.' },
    nodes, edges, stats: {
      files: contents.size, folders: folders.size, definitions: nodes.filter(n => n.type === 'Function' || n.type === 'Class').length,
      dependencies: nodes.filter(n => n.type === 'Dependency').length, nodes: nodes.length, edges: edges.length
    }
  };
  return result;
}

function normalizeOfficialGraph(raw, root) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const sourceNodes = Array.isArray(data.nodes) ? data.nodes : Object.values(data.nodes || {});
  const sourceEdges = Array.isArray(data.edges) ? data.edges : [];
  const nodes = sourceNodes.filter(n => n && typeof n === 'object').map((n, i) => ({
    id: String(n.id ?? n.key ?? 'official:' + i),
    type: String(n.type ?? n.kind ?? 'Concept'),
    label: String(n.name ?? n.label ?? n.title ?? n.id ?? 'Untitled'),
    path: String(n.filePath ?? n.file ?? n.path ?? ''),
    line: Number(n.startLine ?? n.line ?? 0) || undefined,
    layer: String(n.layer ?? n.architectureLayer ?? 'Analyzed'),
    summary: String(n.summary ?? n.description ?? '')
  }));
  const idSet = new Set(nodes.map(n => n.id));
  const edges = sourceEdges.map(e => ({
    from: String(e.from ?? e.source ?? e.sourceId ?? ''),
    to: String(e.to ?? e.target ?? e.targetId ?? ''),
    relation: String(e.relation ?? e.type ?? e.label ?? 'related')
  })).filter(e => idSet.has(e.from) && idSet.has(e.to));
  if (!nodes.length) return null;
  return {
    schemaVersion: 'mimir.knowledge-graph.v1', source: 'understand-anything',
    provenance: { root, mode: 'official-plugin', limitations: 'Summaries reflect the external analyzer output; verify against source before acting.' },
    nodes, edges, stats: { files: nodes.filter(n => /file/i.test(n.type)).length, nodes: nodes.length, edges: edges.length }
  };
}

export function buildRepositoryKnowledgeGraph({ root = DEFAULT_ROOT, preferOfficial = true } = {}) {
  const resolved = fs.realpathSync(root);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('Knowledge graph root must be a directory');
  if (preferOfficial) {
    for (const dirname of ['.ua', '.understand-anything']) {
      const p = path.join(resolved, dirname, 'knowledge-graph.json');
      try {
        const st = fs.statSync(p);
        if (st.size > MAX_GRAPH_BYTES || !st.isFile()) continue;
        const normalized = normalizeOfficialGraph(JSON.parse(fs.readFileSync(p, 'utf8')), resolved);
        if (normalized) return normalized;
      } catch { /* fallback to deterministic source scan */ }
    }
  }
  return buildStaticGraph(resolved);
}

export function findGraphNeighborhood(graph, query, depth = 1, limit = 150) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return graph.nodes.slice(0, limit);
  const nodeMap = new Map(graph.nodes.map(n => [n.id, n]));
  let found = graph.nodes.filter(n => [n.label, n.path, n.summary, n.type].some(v => String(v || '').toLowerCase().includes(q))).map(n => n.id);
  const seen = new Set(found);
  for (let hop = 0; hop < Math.min(3, Math.max(0, depth)); hop++) {
    const frontier = new Set(seen);
    for (const edge of graph.edges) {
      if (frontier.has(edge.from)) seen.add(edge.to);
      if (frontier.has(edge.to)) seen.add(edge.from);
      if (seen.size > 1000) break;
    }
  }
  return [...seen].slice(0, limit).map(id => nodeMap.get(id)).filter(Boolean);
}
