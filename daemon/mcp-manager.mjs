import { spawn } from 'node:child_process';
import readline from 'node:readline';
import { McpAuthRequiredError, StreamableHttpSession } from './mcp-http.mjs';

/**
 * MCP client for local stdio servers and remote Streamable HTTP servers (with OAuth sign-in).
 * MCP Box: configured servers, per-server disabled tools, and custom instructions.
 *
 * Connection states: idle → connecting → connected, or awaiting_auth / needs_reauth / revoked / error.
 */
export class McpManager {
  constructor(store) {
    this.store = store;
    this.oauth = null; // McpOAuthManager, attached by the coordinator
    this.clients = new Map(); // serverId -> { tools, status, error, proc?, rpc?, session?, authHint? }
  }

  #server(id) {
    return (this.store.getSettings().mcpBoxServers || []).find(s => s.id === id) || null;
  }

  #patchServer(id, patch) {
    const servers = (this.store.getSettings().mcpBoxServers || []).map(s => (s.id === id ? { ...s, ...patch } : s));
    this.store.updateSettings({ mcpBoxServers: servers });
  }

  listConfigured() {
    const s = this.store.getSettings();
    const disabledMap = s.mcpDisabledToolsByServerId || {};
    const instrMap = s.mcpCustomInstructionsByServerId || {};
    return (s.mcpBoxServers || []).map(srv => {
      const live = this.clients.get(srv.id);
      return {
        ...srv,
        disabledTools: disabledMap[srv.id] || [],
        customInstructions: instrMap[srv.id] || '',
        status: live?.status || (srv.enabled === false ? 'disabled' : srv.authState === 'revoked' ? 'revoked' : 'idle'),
        error: live?.error || null,
        tools: live?.tools || [],
        // Granted scopes and issuer only; tokens never leave the vault.
        auth: srv.transport === 'http' ? this.oauth?.describe(srv.id) || null : null,
      };
    });
  }

  saveServer(input) {
    const s = this.store.getSettings();
    const servers = [...(s.mcpBoxServers || [])];
    const id = input.id || `mcp-${Date.now().toString(36)}`;
    const record = {
      id,
      name: String(input.name || 'Custom MCP').trim(),
      transport: input.transport === 'http' ? 'http' : 'stdio',
      command: String(input.command || '').trim(),
      args: Array.isArray(input.args)
        ? input.args
        : String(input.args || '').split(/\s+/).filter(Boolean),
      env: input.env && typeof input.env === 'object' ? input.env : {},
      url: String(input.url || '').trim(),
      headers: input.headers && typeof input.headers === 'object' ? input.headers : {},
      enabled: input.enabled !== false,
      authState: servers.find(x => x.id === id)?.authState || null,
    };
    if (record.transport === 'http' && !/^https?:\/\//i.test(record.url)) throw Object.assign(new Error('MCP URL must start with http:// or https://'), { status: 400 });
    const idx = servers.findIndex(x => x.id === id);
    if (idx >= 0) servers[idx] = record;
    else servers.push(record);

    const instrMap = { ...(s.mcpCustomInstructionsByServerId || {}) };
    if (typeof input.customInstructions === 'string') {
      instrMap[id] = input.customInstructions;
    }
    this.store.updateSettings({ mcpBoxServers: servers, mcpCustomInstructionsByServerId: instrMap });
    return record;
  }

  deleteServer(id) {
    this.disconnect(id);
    const s = this.store.getSettings();
    const servers = (s.mcpBoxServers || []).filter(x => x.id !== id);
    this.store.updateSettings({ mcpBoxServers: servers });
    return true;
  }

  setToolDisabled(serverId, toolName, disabled) {
    const s = this.store.getSettings();
    const map = { ...(s.mcpDisabledToolsByServerId || {}) };
    const list = new Set(map[serverId] || []);
    if (disabled) list.add(toolName);
    else list.delete(toolName);
    map[serverId] = [...list];
    this.store.updateSettings({ mcpDisabledToolsByServerId: map });
    return map[serverId];
  }

  disconnect(serverId) {
    const c = this.clients.get(serverId);
    if (c?.proc && !c.proc.killed) {
      try { c.proc.kill(); } catch {}
    }
    c?.session?.close().catch(() => {});
    this.clients.delete(serverId);
  }

  /** Begin browser sign-in for an HTTP server. Returns { authorizeUrl, scopes }. */
  async startOAuth(serverId, { clientId = null } = {}) {
    const srv = this.#server(serverId);
    if (!srv || srv.transport !== 'http') throw Object.assign(new Error('Sign-in applies to HTTP MCP servers only'), { status: 400 });
    if (!this.oauth) throw new Error('OAuth is not available in this process');
    const hint = this.clients.get(serverId)?.authHint || {};
    return this.oauth.begin({ serverId, serverUrl: srv.url, resourceMetadata: hint.resourceMetadata, scope: hint.scope, clientId });
  }

  /** Browser returned to the callback: store tokens, clear any revoked mark, reconnect. */
  async completeOAuth(params) {
    const { serverId } = await this.oauth.complete(params);
    this.#patchServer(serverId, { authState: null });
    const result = await this.connectAndDiscover(serverId);
    return { serverId, ...result };
  }

  async revokeOAuth(serverId) {
    const out = this.oauth ? await this.oauth.revoke(serverId) : { ok: true, remote: 'no tokens' };
    this.disconnect(serverId);
    this.#patchServer(serverId, { authState: 'revoked' });
    this.clients.set(serverId, { status: 'revoked', error: null, tools: [] });
    return { ...out, status: 'revoked' };
  }

  disconnectAll() {
    for (const id of [...this.clients.keys()]) this.disconnect(id);
  }

  async connectAndDiscover(serverId) {
    const srv = (this.store.getSettings().mcpBoxServers || []).find(s => s.id === serverId);
    if (!srv) throw new Error(`MCP server not found: ${serverId}`);
    if (srv.enabled === false) {
      this.disconnect(serverId);
      return { status: 'disabled', tools: [] };
    }
    if (srv.transport === 'http' && srv.authState === 'revoked') {
      this.clients.set(serverId, { status: 'revoked', error: 'Access was revoked. Sign in again to reconnect.', tools: [] });
      return { status: 'revoked', tools: [] };
    }
    try {
      const tools = srv.transport === 'http'
        ? await this.#discoverHttp(srv)
        : await this.#connectStdio(srv);
      const state = this.clients.get(serverId) || {};
      this.clients.set(serverId, { ...state, status: 'connected', error: null, tools });
      return { status: 'connected', tools };
    } catch (err) {
      if (err instanceof McpAuthRequiredError) {
        // Not a failure: the server wants a sign-in. Keep the hints for startOAuth.
        const status = this.oauth?.describe(serverId) ? 'needs_reauth' : 'awaiting_auth';
        this.clients.set(serverId, { status, error: null, tools: [], authHint: { resourceMetadata: err.resourceMetadata, scope: err.scope } });
        return { status, tools: [] };
      }
      this.clients.set(serverId, { status: 'error', error: err.message, tools: [] });
      throw err;
    }
  }

  async #connectStdio(srv) {
    this.disconnect(srv.id);
    if (!srv.command) throw new Error('Stdio command missing');
    const proc = spawn(srv.command, srv.args || [], {
      env: { ...process.env, ...(srv.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    const pending = new Map();
    let nextId = 1;
    let stderrBuf = '';

    const rl = readline.createInterface({ input: proc.stdout });
    rl.on('line', line => {
      const trimmed = line.trim();
      if (!trimmed) return;
      try {
        const msg = JSON.parse(trimmed);
        if (msg.id != null && pending.has(msg.id)) {
          const { resolve, reject, timer } = pending.get(msg.id);
          clearTimeout(timer);
          pending.delete(msg.id);
          if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch {}
    });
    proc.stderr.on('data', d => { stderrBuf = (stderrBuf + d.toString()).slice(-1500); });
    proc.on('exit', code => {
      for (const [, p] of pending) {
        clearTimeout(p.timer);
        p.reject(new Error(`MCP exited (${code}): ${stderrBuf}`));
      }
      pending.clear();
    });

    const rpc = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`MCP timeout on ${method}`));
        }, 10000);
        pending.set(id, { resolve, reject, timer });
        proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });

    this.clients.set(srv.id, { proc, rpc, status: 'connecting', tools: [], error: null });
    await rpc('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'mimir', version: '1.0.3' },
    });
    proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const listRes = await rpc('tools/list', {});
    return listRes?.tools || [];
  }

  async #discoverHttp(srv) {
    if (!srv.url) throw new Error('HTTP URL missing');
    this.disconnect(srv.id);
    const session = new StreamableHttpSession({
      url: srv.url,
      headers: srv.headers || {},
      getToken: async () => (this.oauth ? this.oauth.getAccessToken(srv.id) : null),
      onAuthRefresh: async () => (this.oauth ? this.oauth.getAccessToken(srv.id, { forceRefresh: true }).catch(() => null) : null),
    });
    this.clients.set(srv.id, { session, status: 'connecting', tools: [], error: null });
    await session.initialize();
    const listRes = await session.request('tools/list', {});
    return listRes?.tools || [];
  }

  async callTool(serverId, toolName, args = {}) {
    const srv = this.#server(serverId);
    if (!srv) throw new Error(`MCP server not found: ${serverId}`);
    if (srv.transport === 'http') {
      if (srv.authState === 'revoked') throw new McpAuthRequiredError('Access to this MCP server was revoked');
      let client = this.clients.get(serverId);
      if (!client?.session || client.status !== 'connected') {
        await this.connectAndDiscover(serverId);
        client = this.clients.get(serverId);
      }
      if (client?.status !== 'connected') throw new McpAuthRequiredError(`MCP server ${srv.name} needs sign-in (${client?.status})`);
      return client.session.request('tools/call', { name: toolName, arguments: args });
    }
    let client = this.clients.get(serverId);
    if (!client?.rpc || client.proc?.killed) {
      await this.connectAndDiscover(serverId);
      client = this.clients.get(serverId);
    }
    return client.rpc('tools/call', { name: toolName, arguments: args });
  }

  /** Returns active OpenAI/Ollama-compatible tool schemas permitted for a bot. */
  async getToolSchemasForBot(bot) {
    const s = this.store.getSettings();
    const disabledMap = s.mcpDisabledToolsByServerId || {};
    const mIds = Array.isArray(bot.allowedMcpIds) ? bot.allowedMcpIds : [];
    const blockAllMcp = mIds.includes('__none__') || (Boolean(bot.parentBotId) && mIds.length === 0);
    const allowSet = blockAllMcp ? new Set() : (mIds.length ? new Set(mIds) : null);
    const schemas = [];
    const dispatchMap = new Map();

    for (const srv of s.mcpBoxServers || []) {
      if (srv.enabled === false) continue;
      if (allowSet && !allowSet.has(srv.id)) continue;
      let live = this.clients.get(srv.id);
      if (!live || live.status === 'idle') {
        try { await this.connectAndDiscover(srv.id); live = this.clients.get(srv.id); } catch {}
      }
      const disabled = new Set(disabledMap[srv.id] || []);
      for (const t of live?.tools || []) {
        if (disabled.has(t.name)) continue;
        const safeName = `mcp__${srv.id.replace(/[^a-zA-Z0-9]/g, '_')}__${t.name}`;
        schemas.push({
          type: 'function',
          function: {
            name: safeName,
            description: `[MCP:${srv.name}] ${t.description || t.name}`,
            parameters: t.inputSchema || { type: 'object', properties: {} },
          },
        });
        dispatchMap.set(safeName, { serverId: srv.id, toolName: t.name });
      }
    }
    return { schemas, dispatchMap };
  }
}
