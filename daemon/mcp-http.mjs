import { VERSION } from './version.mjs';
import crypto from 'node:crypto';
import { isPrivateIp } from './llm-provider.mjs';

/**
 * MCP Streamable HTTP client (spec 2025-06-18) plus the spec's OAuth 2.1 authorization flow:
 * 401 + WWW-Authenticate → protected resource metadata (RFC 9728) → authorization server
 * metadata (RFC 8414) → dynamic client registration (RFC 7591) → authorization code + PKCE (S256)
 * with the `resource` indicator (RFC 8707) → token exchange, refresh and revocation.
 */

export const MCP_PROTOCOL_VERSION = '2025-06-18';
const REQUEST_TIMEOUT_MS = 15_000;
const PENDING_AUTH_TTL_MS = 10 * 60_000;

export class McpAuthRequiredError extends Error {
  constructor(message, { resourceMetadata = null, scope = null } = {}) {
    super(message);
    this.code = 'MCP_AUTH_REQUIRED';
    this.status = 401;
    this.resourceMetadata = resourceMetadata;
    this.scope = scope;
  }
}

/** Parse `Bearer realm="x", resource_metadata="https://…", scope="a b"` into a map. */
export function parseWwwAuthenticate(header) {
  const out = {};
  for (const m of String(header || '').matchAll(/([a-zA-Z_]+)="([^"]*)"/g)) out[m[1]] = m[2];
  return out;
}

/** Canonical MCP server URI for the `resource` parameter: no fragment, no trailing slash. */
export function canonicalResource(url) {
  const u = new URL(url);
  u.hash = '';
  return u.toString().replace(/\/$/, '');
}

const isLoopbackHost = host => host === 'localhost' || host === '::1' || host === '[::1]' || /^127\./.test(host);

/** OAuth endpoints must be HTTPS; plain HTTP is only accepted on this computer (test servers). */
function assertSecureEndpoint(url, what) {
  const u = new URL(url);
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'metadata.google.internal' || host === 'metadata' || host.endsWith('.internal') || isPrivateIp(host, { allowLoopback: true })) {
    throw new Error(`${what} targets a private or metadata host (${url})`);
  }
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && isLoopbackHost(u.hostname))) {
    throw new Error(`${what} must use HTTPS (${url})`);
  }
}

const b64url = buf => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function getJson(url) {
  assertSecureEndpoint(url, 'metadata URL');
  const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`GET ${url} → HTTP ${res.status}`);
  return res.json();
}

async function firstJson(urls) {
  let lastErr = null;
  for (const url of urls) {
    try {
      return { url, data: await getJson(url) };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('No metadata URL answered');
}

/** RFC 9728 path-aware well-known URL, then the root form. */
function protectedResourceUrls(serverUrl, hinted) {
  if (hinted) return [hinted];
  const u = new URL(serverUrl);
  const pathPart = u.pathname.replace(/\/$/, '');
  return [...new Set([`${u.origin}/.well-known/oauth-protected-resource${pathPart}`, `${u.origin}/.well-known/oauth-protected-resource`])];
}

/** RFC 8414 well-known URL for an issuer (path inserted after the well-known segment), then OIDC. */
function authServerMetadataUrls(issuer) {
  const u = new URL(issuer);
  const pathPart = u.pathname.replace(/\/$/, '');
  return [
    `${u.origin}/.well-known/oauth-authorization-server${pathPart}`,
    `${u.origin}/.well-known/openid-configuration${pathPart}`,
    `${u.origin}${pathPart}/.well-known/openid-configuration`,
  ];
}

export async function discoverAuthorization(serverUrl, { resourceMetadata = null } = {}) {
  const prm = await firstJson(protectedResourceUrls(serverUrl, resourceMetadata));
  const issuer = prm.data.authorization_servers?.[0];
  if (!issuer) throw new Error('MCP server metadata lists no authorization server');
  const as = await firstJson(authServerMetadataUrls(issuer));
  for (const key of ['authorization_endpoint', 'token_endpoint']) {
    if (!as.data[key]) throw new Error(`Authorization server metadata is missing ${key}`);
    assertSecureEndpoint(as.data[key], key);
  }
  if (as.data.code_challenge_methods_supported && !as.data.code_challenge_methods_supported.includes('S256')) {
    throw new Error('Authorization server does not support PKCE S256');
  }
  return { resourceMetadata: prm.data, authServer: as.data };
}

/**
 * Holds in-flight sign-ins and talks to the token endpoint. Tokens are persisted through the
 * provided vault adapter (`load(serverId)`, `save(serverId, record)`, `remove(serverId)`).
 */
export class McpOAuthManager {
  constructor({ tokenStore, redirectUri }) {
    this.tokenStore = tokenStore;
    this.redirectUri = redirectUri; // function returning the current loopback callback URL
    this.pending = new Map(); // state -> { serverId, verifier, ... }
  }

  async #register(authServer, redirectUri, existing) {
    if (existing?.clientId && existing.redirectUri === redirectUri && existing.issuer === authServer.issuer) return existing.clientId;
    if (!authServer.registration_endpoint) {
      const err = new Error('This server does not allow automatic app registration. Register Mimir with the provider and enter its client ID.');
      err.code = 'CLIENT_ID_REQUIRED';
      throw err;
    }
    assertSecureEndpoint(authServer.registration_endpoint, 'registration_endpoint');
    const res = await fetch(authServer.registration_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_name: 'Mimir',
        redirect_uris: [redirectUri],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Client registration failed: HTTP ${res.status}`);
    const data = await res.json();
    if (!data.client_id) throw new Error('Client registration returned no client_id');
    return data.client_id;
  }

  /** Step 1: build the browser URL. Returns { authorizeUrl, scopes }. */
  async begin({ serverId, serverUrl, resourceMetadata = null, scope = null, clientId = null }) {
    const { resourceMetadata: prm, authServer } = await discoverAuthorization(serverUrl, { resourceMetadata });
    const redirectUri = this.redirectUri();
    const existing = this.tokenStore.load(serverId);
    const resolvedClientId = clientId || (await this.#register(authServer, redirectUri, existing));
    const verifier = b64url(crypto.randomBytes(32));
    const state = b64url(crypto.randomBytes(24));
    const scopes = scope || (prm.scopes_supported || []).join(' ');
    const resource = canonicalResource(serverUrl);

    const url = new URL(authServer.authorization_endpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', resolvedClientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('code_challenge', b64url(crypto.createHash('sha256').update(verifier).digest()));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('state', state);
    url.searchParams.set('resource', resource);
    if (scopes) url.searchParams.set('scope', scopes);

    for (const [key, p] of this.pending) if (p.expiresAt < Date.now()) this.pending.delete(key);
    this.pending.set(state, {
      serverId,
      verifier,
      clientId: resolvedClientId,
      redirectUri,
      resource,
      issuer: authServer.issuer,
      tokenEndpoint: authServer.token_endpoint,
      revocationEndpoint: authServer.revocation_endpoint || null,
      scopes,
      expiresAt: Date.now() + PENDING_AUTH_TTL_MS,
    });
    return { authorizeUrl: url.toString(), scopes: scopes ? scopes.split(' ') : [] };
  }

  async #tokenRequest(tokenEndpoint, params) {
    const res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(`Token request failed: ${data.error || `HTTP ${res.status}`}`);
    return data;
  }

  /** Step 2: the browser came back to the loopback callback. Returns { serverId }. */
  async complete({ state, code, error }) {
    const p = this.pending.get(String(state || ''));
    if (!p || p.expiresAt < Date.now()) throw Object.assign(new Error('Unknown or expired sign-in. Start again from Mimir.'), { status: 400 });
    this.pending.delete(state);
    if (error) throw Object.assign(new Error(`Sign-in was not completed: ${error}`), { status: 400, serverId: p.serverId });
    if (!code) throw Object.assign(new Error('No authorization code returned'), { status: 400 });
    const tok = await this.#tokenRequest(p.tokenEndpoint, {
      grant_type: 'authorization_code',
      code,
      redirect_uri: p.redirectUri,
      client_id: p.clientId,
      code_verifier: p.verifier,
      resource: p.resource,
    });
    this.tokenStore.save(p.serverId, {
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token || null,
      expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null,
      scopes: tok.scope || p.scopes,
      clientId: p.clientId,
      redirectUri: p.redirectUri,
      issuer: p.issuer,
      tokenEndpoint: p.tokenEndpoint,
      revocationEndpoint: p.revocationEndpoint,
      resource: p.resource,
      connectedAt: new Date().toISOString(),
    });
    return { serverId: p.serverId };
  }

  /** Current access token, refreshed (with refresh-token rotation) when it is about to expire. */
  async getAccessToken(serverId, { forceRefresh = false } = {}) {
    const rec = this.tokenStore.load(serverId);
    if (!rec?.accessToken) return null;
    const expiring = rec.expiresAt && rec.expiresAt - Date.now() < 30_000;
    if (!forceRefresh && !expiring) return rec.accessToken;
    if (!rec.refreshToken) return forceRefresh ? null : rec.accessToken;
    const tok = await this.#tokenRequest(rec.tokenEndpoint, {
      grant_type: 'refresh_token',
      refresh_token: rec.refreshToken,
      client_id: rec.clientId,
      resource: rec.resource,
    });
    this.tokenStore.save(serverId, {
      ...rec,
      accessToken: tok.access_token,
      refreshToken: tok.refresh_token || rec.refreshToken,
      expiresAt: tok.expires_in ? Date.now() + Number(tok.expires_in) * 1000 : null,
    });
    return tok.access_token;
  }

  describe(serverId) {
    const rec = this.tokenStore.load(serverId);
    if (!rec) return null;
    return { scopes: String(rec.scopes || '').split(' ').filter(Boolean), issuer: rec.issuer, connectedAt: rec.connectedAt, expiresAt: rec.expiresAt };
  }

  /** Revoke at the provider when it supports RFC 7009, and always forget the tokens locally. */
  async revoke(serverId) {
    const rec = this.tokenStore.load(serverId);
    let remote = 'not supported by provider';
    if (rec?.revocationEndpoint) {
      try {
        assertSecureEndpoint(rec.revocationEndpoint, 'revocation_endpoint');
        for (const [token, hint] of [[rec.refreshToken, 'refresh_token'], [rec.accessToken, 'access_token']]) {
          if (!token) continue;
          await fetch(rec.revocationEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ token, token_type_hint: hint, client_id: rec.clientId }).toString(),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          });
        }
        remote = 'revoked at provider';
      } catch (err) {
        remote = `provider revocation failed: ${err.message}`;
      }
    }
    this.tokenStore.remove(serverId);
    return { ok: true, remote };
  }
}

/** Extract the JSON-RPC message with the given id from an SSE body (other events are skipped). */
function pickFromSse(text, id) {
  let fallback = null;
  for (const block of text.split(/\r?\n\r?\n/)) {
    const data = block
      .split(/\r?\n/)
      .filter(l => l.startsWith('data:'))
      .map(l => l.slice(5).trimStart())
      .join('\n');
    if (!data) continue;
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      continue;
    }
    if (msg.id === id) return msg;
    if (msg.result !== undefined || msg.error !== undefined) fallback = msg;
  }
  return fallback;
}

/** One logical MCP session over Streamable HTTP. */
export class StreamableHttpSession {
  constructor({ url, headers = {}, getToken = async () => null, onAuthRefresh = null }) {
    this.url = url;
    this.extraHeaders = headers;
    this.getToken = getToken;
    this.onAuthRefresh = onAuthRefresh; // async () => fresh token or null
    this.sessionId = null;
    this.protocolVersion = null;
    this.nextId = 1;
  }

  async #headers() {
    const h = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...this.extraHeaders };
    if (this.protocolVersion) h['MCP-Protocol-Version'] = this.protocolVersion;
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId;
    const token = await this.getToken();
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  async #post(message, { retriedAuth = false, retriedSession = false } = {}) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: await this.#headers(),
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (res.status === 401) {
      // One silent refresh attempt, then hand the sign-in back to the user.
      if (!retriedAuth && this.onAuthRefresh && (await this.onAuthRefresh())) return this.#post(message, { retriedAuth: true, retriedSession });
      const auth = parseWwwAuthenticate(res.headers.get('www-authenticate'));
      throw new McpAuthRequiredError('Sign-in required for this MCP server', { resourceMetadata: auth.resource_metadata || null, scope: auth.scope || null });
    }
    if (res.status === 403) throw Object.assign(new Error('The MCP server refused this request (insufficient permissions or scopes)'), { status: 403 });
    if (res.status === 404 && this.sessionId && !retriedSession && message.method !== 'initialize') {
      this.sessionId = null; // server ended the session: start a new one, then retry once
      await this.initialize();
      return this.#post(message, { retriedAuth, retriedSession: true });
    }
    return res;
  }

  async request(method, params = {}) {
    const id = this.nextId++;
    const res = await this.#post({ jsonrpc: '2.0', id, method, params });
    if (!res.ok) throw new Error(`MCP ${method} failed: HTTP ${res.status}`);
    if (method === 'initialize') this.sessionId = res.headers.get('mcp-session-id') || null;
    const text = await res.text();
    const ct = res.headers.get('content-type') || '';
    const msg = ct.includes('text/event-stream') ? pickFromSse(text, id) : JSON.parse(text);
    if (!msg) throw new Error(`MCP ${method}: no response in stream`);
    if (msg.error) throw new Error(msg.error.message || `MCP error on ${method}`);
    return msg.result;
  }

  async notify(method, params = {}) {
    const res = await this.#post({ jsonrpc: '2.0', method, params });
    if (!res.ok && res.status !== 202) throw new Error(`MCP notification ${method} failed: HTTP ${res.status}`);
  }

  async initialize() {
    this.protocolVersion = null;
    const result = await this.request('initialize', {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mimir', version: VERSION },
    });
    this.protocolVersion = result?.protocolVersion || MCP_PROTOCOL_VERSION;
    await this.notify('notifications/initialized');
    return result;
  }

  async close() {
    if (!this.sessionId) return;
    try {
      await fetch(this.url, { method: 'DELETE', headers: await this.#headers(), signal: AbortSignal.timeout(5000) });
    } catch {}
    this.sessionId = null;
  }
}
