import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { startCoordinator } from '../daemon/coordinator.mjs';
import { parseWwwAuthenticate, canonicalResource } from '../daemon/mcp-http.mjs';

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * Loopback fixture acting as both a Streamable HTTP MCP server and its OAuth authorization
 * server. It enforces the client-side rules the spec requires, so a lax client fails here.
 */
async function startFixture(t) {
  const state = { clients: new Map(), codes: new Map(), tokens: new Map(), refresh: new Map(), sessions: new Set(), calls: [], violations: [] };
  let origin = '';
  const mcpUrl = () => `${origin}/mcp`;
  const issueTokens = (clientId, resource, scope) => {
    const access = b64url(crypto.randomBytes(18));
    const refresh = b64url(crypto.randomBytes(18));
    state.tokens.set(access, { clientId, resource, scope, expires: Date.now() + 3600_000 });
    state.refresh.set(refresh, { clientId, resource, scope });
    return { access_token: access, refresh_token: refresh, token_type: 'Bearer', expires_in: 3600, scope };
  };

  const srv = http.createServer(async (req, res) => {
    const url = new URL(req.url, origin);
    let body = '';
    for await (const c of req) body += c;
    const json = (status, obj, headers = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(obj));
    };

    if (url.pathname === '/.well-known/oauth-protected-resource/mcp') {
      return json(200, { resource: mcpUrl(), authorization_servers: [origin], scopes_supported: ['notes.read'] });
    }
    if (url.pathname === '/.well-known/oauth-authorization-server') {
      return json(200, {
        issuer: origin,
        authorization_endpoint: `${origin}/authorize`,
        token_endpoint: `${origin}/token`,
        registration_endpoint: `${origin}/register`,
        revocation_endpoint: `${origin}/revoke`,
        code_challenge_methods_supported: ['S256'],
      });
    }
    if (url.pathname === '/register' && req.method === 'POST') {
      const reg = JSON.parse(body);
      const clientId = `client-${state.clients.size + 1}`;
      state.clients.set(clientId, { redirectUris: reg.redirect_uris });
      return json(201, { client_id: clientId, redirect_uris: reg.redirect_uris });
    }
    if (url.pathname === '/authorize') {
      const q = url.searchParams;
      const client = state.clients.get(q.get('client_id'));
      if (!client || !client.redirectUris.includes(q.get('redirect_uri'))) return json(400, { error: 'invalid_client' });
      if (q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge')) state.violations.push('missing PKCE S256');
      if (q.get('resource') !== canonicalResource(mcpUrl())) state.violations.push(`bad resource ${q.get('resource')}`);
      // The "user" approves immediately.
      const code = b64url(crypto.randomBytes(12));
      state.codes.set(code, { clientId: q.get('client_id'), challenge: q.get('code_challenge'), redirectUri: q.get('redirect_uri'), resource: q.get('resource'), scope: q.get('scope') });
      const back = new URL(q.get('redirect_uri'));
      back.searchParams.set('code', code);
      back.searchParams.set('state', q.get('state'));
      res.writeHead(302, { Location: back.toString() });
      return res.end();
    }
    if (url.pathname === '/token' && req.method === 'POST') {
      const p = new URLSearchParams(body);
      if (p.get('grant_type') === 'authorization_code') {
        const c = state.codes.get(p.get('code'));
        state.codes.delete(p.get('code'));
        if (!c) return json(400, { error: 'invalid_grant' });
        const challenge = b64url(crypto.createHash('sha256').update(p.get('code_verifier') || '').digest());
        if (challenge !== c.challenge) return json(400, { error: 'invalid_grant', error_description: 'PKCE mismatch' });
        if (p.get('resource') !== c.resource) state.violations.push('resource missing from token request');
        return json(200, issueTokens(c.clientId, c.resource, c.scope));
      }
      if (p.get('grant_type') === 'refresh_token') {
        const r = state.refresh.get(p.get('refresh_token'));
        if (!r) return json(400, { error: 'invalid_grant' });
        state.refresh.delete(p.get('refresh_token')); // rotation: old refresh token dies
        return json(200, issueTokens(r.clientId, r.resource, r.scope));
      }
      return json(400, { error: 'unsupported_grant_type' });
    }
    if (url.pathname === '/revoke' && req.method === 'POST') {
      const tok = new URLSearchParams(body).get('token');
      state.tokens.delete(tok);
      state.refresh.delete(tok);
      return json(200, {});
    }
    if (url.pathname === '/mcp') {
      const auth = (req.headers.authorization || '').replace(/^Bearer /, '');
      const tok = state.tokens.get(auth);
      if (!tok || tok.expires < Date.now() || tok.resource !== canonicalResource(mcpUrl())) {
        res.writeHead(401, { 'WWW-Authenticate': `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="notes.read"` });
        return res.end();
      }
      if (req.method === 'DELETE') {
        state.sessions.delete(req.headers['mcp-session-id']);
        res.writeHead(204);
        return res.end();
      }
      const msg = JSON.parse(body);
      if (msg.method !== 'initialize') {
        if (!state.sessions.has(req.headers['mcp-session-id'])) return json(msg.id ? 404 : 404, { error: 'unknown session' });
        if (req.headers['mcp-protocol-version'] !== '2025-06-18') state.violations.push(`protocol header ${req.headers['mcp-protocol-version']}`);
      }
      if (msg.method === 'initialize') {
        const sid = b64url(crypto.randomBytes(8));
        state.sessions.add(sid);
        return json(200, { jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fixture', version: '1' } } }, { 'Mcp-Session-Id': sid });
      }
      if (msg.id === undefined) {
        res.writeHead(202);
        return res.end();
      }
      if (msg.method === 'tools/list') {
        // SSE with a notification before the response: the client must match by id.
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'listing' } })}\n\n`);
        res.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'read_note', description: 'Read a note', inputSchema: { type: 'object', properties: { id: { type: 'string' } } } }] } })}\n\n`);
        return res.end();
      }
      if (msg.method === 'tools/call') {
        state.calls.push(msg.params);
        return json(200, { jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: `note ${msg.params.arguments.id}: hello` }] } });
      }
      return json(200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not found' } });
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  origin = `http://127.0.0.1:${srv.address().port}`;
  t.after(() => new Promise(r => { srv.closeAllConnections?.(); srv.close(r); }));
  return { state, mcpUrl: mcpUrl() };
}

test('WWW-Authenticate parsing and canonical resource', () => {
  assert.deepEqual(parseWwwAuthenticate('Bearer resource_metadata="https://x/.well-known/a", scope="r w"'), { resource_metadata: 'https://x/.well-known/a', scope: 'r w' });
  assert.equal(canonicalResource('https://MCP.example.com/mcp/#frag'), 'https://mcp.example.com/mcp');
});

test('remote MCP: sign in with OAuth, use a tool, refresh, revoke, reconnect', async t => {
  const fx = await startFixture(t);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mimir-mcp-oauth-'));
  const coord = await startCoordinator({ dataDir: dir, enableScheduler: false, enableRust: false });
  t.after(async () => {
    await coord.close().catch(() => {});
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  });
  const call = async (p, body, method = body ? 'POST' : 'GET') => {
    const r = await fetch(coord.url + p, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, data: await r.json() };
  };
  const status = async () => (await call('/v1/mcps')).data.find(s => s.id === 'notes');

  await call('/v1/mcps', { id: 'notes', name: 'Notes', transport: 'http', url: fx.mcpUrl });
  assert.equal((await call('/v1/mcps', { name: 'Bad', transport: 'http', url: 'file:///etc' })).status, 400);

  // 1. Unauthenticated connect → awaiting sign-in, not an error.
  const first = await call('/v1/mcps/notes/discover', {});
  assert.equal(first.status, 200);
  assert.equal(first.data.status, 'awaiting_auth');

  // 2. Start sign-in; follow the browser hop by hand.
  const started = await call('/v1/mcps/notes/oauth/start', {});
  assert.equal(started.status, 200, JSON.stringify(started.data));
  assert.deepEqual(started.data.scopes, ['notes.read']);
  const auth = new URL(started.data.authorizeUrl);
  assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(auth.searchParams.get('resource'), fx.mcpUrl);
  assert.ok(auth.searchParams.get('redirect_uri').startsWith(`${coord.url}/v1/mcp/oauth/callback`));

  const authRes = await fetch(auth, { redirect: 'manual' });
  assert.equal(authRes.status, 302);
  const callbackUrl = authRes.headers.get('location');

  // A forged callback with a wrong state is rejected and does not consume the real one.
  const forged = new URL(callbackUrl);
  forged.searchParams.set('state', 'forged');
  assert.equal((await fetch(forged)).status, 400);

  const cb = await fetch(callbackUrl);
  assert.equal(cb.status, 200);
  assert.match(await cb.text(), /Connected to Mimir/);
  assert.equal((await fetch(callbackUrl)).status, 400, 'state is single-use');

  // 3. Connected: tools discovered over SSE, a tool call works, no protocol violations.
  const s1 = await status();
  assert.equal(s1.status, 'connected');
  assert.deepEqual(s1.tools.map(x => x.name), ['read_note']);
  assert.deepEqual(s1.auth.scopes, ['notes.read']);
  const out = await coord.mcpManager.callTool('notes', 'read_note', { id: '7' });
  assert.equal(out.content[0].text, 'note 7: hello');
  assert.deepEqual(fx.state.violations, []);

  // Tokens stay in the encrypted vault: not in store.json, not in API responses.
  const tokenRec = JSON.parse(coord.vault.resolveSecret('MCP_OAUTH:notes').fields.value);
  assert.ok(!fs.readFileSync(path.join(dir, 'store.json'), 'utf8').includes(tokenRec.accessToken));
  assert.ok(!JSON.stringify((await call('/v1/mcps')).data).includes(tokenRec.accessToken));
  assert.ok(!JSON.stringify((await call('/v1/vault')).data).includes(tokenRec.accessToken));

  // 4. Server-side expiry → client refreshes once (with rotation) and the call still succeeds.
  fx.state.tokens.get(tokenRec.accessToken).expires = 0;
  const out2 = await coord.mcpManager.callTool('notes', 'read_note', { id: '8' });
  assert.equal(out2.content[0].text, 'note 8: hello');
  const rotated = JSON.parse(coord.vault.resolveSecret('MCP_OAUTH:notes').fields.value);
  assert.notEqual(rotated.accessToken, tokenRec.accessToken);
  assert.notEqual(rotated.refreshToken, tokenRec.refreshToken);

  // 5. Session ended by the server (404) → client starts a new session transparently.
  fx.state.sessions.clear();
  assert.equal((await coord.mcpManager.callTool('notes', 'read_note', { id: '9' })).content[0].text, 'note 9: hello');

  // 6. Revoke: tokens gone locally and at the provider; further access is denied.
  const callsBefore = fx.state.calls.length;
  const rev = await call('/v1/mcps/notes/oauth/revoke', {});
  assert.equal(rev.data.status, 'revoked');
  assert.equal(rev.data.remote, 'revoked at provider');
  assert.equal(coord.vault.resolveSecret('MCP_OAUTH:notes'), null);
  assert.equal(fx.state.tokens.has(rotated.accessToken), false);
  await assert.rejects(coord.mcpManager.callTool('notes', 'read_note', { id: '10' }), err => err.code === 'MCP_AUTH_REQUIRED');
  assert.equal(fx.state.calls.length, callsBefore, 'no request reached the tool after revoke');
  assert.equal((await status()).status, 'revoked');
  const bot = coord.store.listBots()[0];
  const { schemas } = await coord.mcpManager.getToolSchemasForBot(bot);
  assert.ok(!schemas.some(s => s.function.name.includes('read_note')), 'revoked tools are not offered to bots');

  // 7. Signing in again reconnects.
  const again = await call('/v1/mcps/notes/oauth/start', {});
  const hop = await fetch(again.data.authorizeUrl, { redirect: 'manual' });
  await fetch(hop.headers.get('location'));
  assert.equal((await status()).status, 'connected');
  assert.deepEqual(fx.state.violations, []);
});
