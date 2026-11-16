import crypto from 'node:crypto';

/**
 * HydraDB-backed, least-privilege tool discovery for Mimir.
 *
 * The graph, rather than an in-memory lookup table, is the source of the
 * capability -> tool traversal. Existing Mimir permissions always form a hard
 * upper bound; HydraDB can remove a tool from context, never grant one.
 *
 * Requires the OPEN-SOURCE self-hosted engine at github.com/hydra-db/hydradb.
 * No HydraDB Cloud SDK or hosted API is used.
 */

const RULES = Object.freeze({
  research: /\\b(research|search|find|browse|look up|investigat(?:e|ion|ing)|source|cite|web|news|researcher)\\b/i,
  files: /\\b(file|folder|directory|document|read|write|edit|workspace|pdf|csv|local)\\b/i,
  code: /\\b(code|program|debug|build|test|terminal|shell|script|implement|refactor|git|deploy)\\b/i,
  memory: /\\b(remember|memory|recall|context|knowledge|previous|earlier|history|facts?)\\b/i,
  browser: /\\b(browser|navigate|website|webpage|page|click|form|url|screenshot)\\b/i,
  collaborate: /\\b(team|delegate|subagent|council|swarm|coordinate)\\b/i,
  communicate: /\\b(email|send|post|message|slack|telegram|notify|reply)\\b/i,
  automate: /\\b(automate|schedule|routine|workflow|every day|monitor|cron)\\b/i,
  creative: /\\b(image|generate|art|video|audio|music|design|render|forge)\\b/i,
});

export function capabilityForTask(task) {
  const s = String(task || '');
  const keys = Object.entries(RULES)
    .filter(([, pattern]) => pattern.test(s))
    .map(([key]) => key);
  return keys.length ? keys : ['general'];
}

export function capabilitiesForTool(schema) {
  const name = String(schema?.function?.name || schema?.name || '').toLowerCase();
  const desc = String(schema?.function?.description || schema?.description || '').toLowerCase();
  const combined = name + ' ' + desc;
  const result = new Set();
  for (const [key, re] of Object.entries(RULES)) if (re.test(combined)) result.add(key);
  if (/^(fs_|workspace_|file_)/.test(name)) result.add('files');
  if (/^(shell_|code_|git_|python_)/.test(name)) result.add('code');
  if (/^(memory_|knowledge_)/.test(name)) result.add('memory');
  if (/^(browser_|web_)/.test(name)) result.add('browser');
  if (/^(browser_search|knowledge_search)/.test(name)) result.add('research');
  if (/^(subagent_|council_|bot_)/.test(name)) result.add('collaborate');
  if (/(email|slack|telegram|send|notify|message)/.test(name)) result.add('communicate');
  if (/(routine|schedule|workflow)/.test(name)) result.add('automate');
  if (/(foundry|image|audio|video|art_)/.test(name)) result.add('creative');
  if (!result.size) result.add('general');
  return [...result];
}

function stableId(scope, kind, value) {
  // 47-bit positive IDs, safe in JS and valid as HydraDB i64 graph identities.
  const hash = crypto.createHash('sha256').update([scope, kind, value].join('\\x1f')).digest('hex');
  return Number.parseInt(hash.slice(0, 11), 16) + 100_000_000_000;
}

function uniqueSchemas(schemas) {
  return [...new Map((schemas || [])
    .map(tool => [String(tool?.function?.name || tool?.name || ''), tool])
    .filter(([name]) => name)).values()];
}

export class HydraContextRouter {
  constructor({
    url = process.env.MIMIR_HYDRADB_URL || 'http://127.0.0.1:8443',
    token = process.env.MIMIR_HYDRADB_TOKEN || '',
    graphId = process.env.MIMIR_HYDRADB_GRAPH_ID || 'default',
    cellId = process.env.MIMIR_HYDRADB_CELL_ID || 'cell-0',
    namespace = process.env.MIMIR_HYDRADB_NAMESPACE || 'default',
    fetchImpl = globalThis.fetch,
  } = {}) {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))) {
      throw new Error('HydraDB remote endpoints require HTTPS; local development may use HTTP.');
    }
    if (!token) throw new Error('MIMIR_HYDRADB_TOKEN is required for graph routing');
    if (!/^[a-z0-9_-]{1,64}$/i.test(graphId)) throw new Error('Invalid HydraDB graph id');
    this.url = new URL('/v1/graphs/' + graphId + '/query', parsed).toString();
    this.token = token;
    this.cellId = cellId;
    this.namespace = namespace;
    this.fetchImpl = fetchImpl;
    this.seeded = new Set();
  }

  async query(query, parameters = {}) {
    const response = await this.fetchImpl(this.url, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + this.token,
        'X-Graph-Namespace': this.namespace,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cell_id: this.cellId, query, parameters }),
      signal: AbortSignal.timeout(8_000),
    });
    const payload = await response.json();
    if (!response.ok || payload.error || !Array.isArray(payload.rows)) {
      throw new Error('HydraDB query failure: ' + (payload.error?.message || response.status));
    }
    return payload.rows.map(row => Object.fromEntries(
      (payload.columns || []).map((column, i) => [column, row?.[i]?.value ?? null])
    ));
  }

  async seed(tools, scope = 'default') {
    const schemas = uniqueSchemas(tools);
    const signature = crypto.createHash('sha256')
      .update(scope + JSON.stringify(schemas.map(s => [s.function?.name || s.name, capabilitiesForTool(s)])))
      .digest('hex');
    if (this.seeded.has(signature)) return;
    const nodes = schemas.map(s => {
      const name = String(s.function?.name || s.name);
      return { id: stableId(scope, 'tool', name), name };
    });
    const capabilityNames = [...new Set(schemas.flatMap(capabilitiesForTool))];
    const categories = capabilityNames.map(name => ({ id: stableId(scope, 'capability', name), name }));
    const edges = schemas.flatMap(s => {
      const name = String(s.function?.name || s.name);
      return capabilitiesForTool(s).map(cap => ({
        src: stableId(scope, 'capability', cap), dst: stableId(scope, 'tool', name),
      }));
    });
    const upsert = async (label, rows) => {
      for (let i = 0; i < rows.length; i += 512) {
        await this.query(
          'UNWIND $rows AS row MERGE (n {id: row.id}) SET n:' + label + ', n.name = row.name',
          { rows: rows.slice(i, i + 512) },
        );
      }
    };
    await upsert('Capability', categories);
    await upsert('Tool', nodes);
    for (let i = 0; i < edges.length; i += 512) {
      await this.query(
        'UNWIND $rows AS row CREATE (a {id: row.src})-[:ROUTES_TO]->(b {id: row.dst})',
        { rows: edges.slice(i, i + 512) },
      );
    }
    this.seeded.add(signature);
  }

  async route(task, availableTools, { scope = 'default' } = {}) {
    const start = performance.now();
    const schemas = uniqueSchemas(availableTools);
    const intents = capabilityForTask(task);
    if (!schemas.length || intents.includes('general')) {
      return { tools: schemas, trace: { status: 'no-specialisation', intents, before: schemas.length, after: schemas.length } };
    }

    await this.seed(schemas, scope);
    const returned = new Set();
    for (const intent of intents) {
      const rows = await this.query(
        'MATCH (c {id: $id})-[:ROUTES_TO]->(t) RETURN t.name AS name LIMIT 512',
        { id: stableId(scope, 'capability', intent) },
      );
      for (const row of rows) if (row.name) returned.add(row.name);
    }

    // Security invariant: an untrusted graph answer cannot add new privileges.
    const selected = schemas.filter(s => returned.has(String(s.function?.name || s.name)));
    // Do not silently pass an empty tool list for unknown/underspecified prompts.
    const usable = selected.length ? selected : schemas;
    return {
      tools: usable,
      trace: {
        status: selected.length ? 'hydradb-traversal' : 'no-matching-edges',
        intents,
        before: schemas.length,
        after: usable.length,
        graphReturned: returned.size,
        elapsedMs: Math.round(performance.now() - start),
      },
    };
  }
}

let singleton;
export function getHydraContextRouter() {
  return singleton ||= new HydraContextRouter();
}
