import fs from 'node:fs';
import path from 'node:path';
import { runDesktopAction } from './desktop-control.mjs';

export const CONNECTOR_CATALOG = [
  {
    id: 'gmail',
    name: 'Gmail',
    description: 'Read threads, triage inbox, and draft replies with Send approval gate',
    category: 'public',
    brandColor: '#ea4335',
    authType: 'oauth-bearer',
    scopes: { read: true, send: true, defaultRequiresSendApproval: true },
    secretKey: 'CONNECTOR_GMAIL_TOKEN',
  },
  {
    id: 'google-drive',
    name: 'Google Drive',
    description: 'Drive, Docs, Sheets or Slides indexing and workspace export',
    category: 'public',
    brandColor: '#34a853',
    authType: 'oauth-bearer',
    scopes: { read: true, send: true, defaultRequiresSendApproval: true },
    secretKey: 'CONNECTOR_GDRIVE_TOKEN',
  },
  {
    id: 'google-calendar',
    name: 'Google Calendar',
    description: 'Agenda lookup, conflict detection, and event scheduling',
    category: 'public',
    brandColor: '#4285f4',
    authType: 'oauth-bearer',
    scopes: { read: true, send: true, defaultRequiresSendApproval: true },
    secretKey: 'CONNECTOR_GCAL_TOKEN',
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Triage PRs, issues, CI runs, and repository releases',
    category: 'public',
    brandColor: '#e6ab42',
    authType: 'pat-token',
    scopes: { read: true, send: true, defaultRequiresSendApproval: true },
    secretKey: 'CONNECTOR_GITHUB_TOKEN',
  },
  {
    id: 'slack',
    name: 'Slack',
    description: 'Channel digest, thread replies, and routine notifications',
    category: 'public',
    brandColor: '#e01e5a',
    authType: 'bot-token',
    scopes: { read: true, send: true, defaultRequiresSendApproval: true },
    secretKey: 'CONNECTOR_SLACK_TOKEN',
  },
  {
    id: 'notion',
    name: 'Notion',
    description: 'Search engineering wikis, specs, and database items',
    category: 'public',
    brandColor: '#e5edf4',
    authType: 'api-token',
    scopes: { read: true, send: true, defaultRequiresSendApproval: true },
    secretKey: 'CONNECTOR_NOTION_TOKEN',
  },
  {
    id: 'linear',
    name: 'Linear',
    description: 'Track issues, sprint cycles, and release blockers',
    category: 'public',
    brandColor: '#5e6ad2',
    authType: 'api-token',
    scopes: { read: true, send: true, defaultRequiresSendApproval: true },
    secretKey: 'CONNECTOR_LINEAR_TOKEN',
  },
  {
    id: 'remote-desktop',
    name: 'Remote Desktop Commander',
    description: 'Use your own computer windows cleanly behind Runic approval',
    category: 'personal',
    brandColor: '#3ac9ff',
    authType: 'local-host',
    scopes: { read: true, send: true, defaultRequiresSendApproval: true },
    secretKey: null,
  },
  {
    id: 'sqlite',
    name: 'SQLite / Mimir Ledger',
    description: 'Inspect local WAL tables and query verified task ledgers',
    category: 'personal',
    brandColor: '#0f80cc',
    authType: 'local-host',
    scopes: { read: true, send: false, defaultRequiresSendApproval: true },
    secretKey: null,
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    description: 'Read-first SQL schema inspection and parameterized query runner',
    category: 'public',
    brandColor: '#336791',
    authType: 'connection-uri',
    scopes: { read: true, send: true, defaultRequiresSendApproval: true },
    secretKey: 'CONNECTOR_POSTGRES_URI',
  },
  {
    id: 'playwright',
    name: 'Playwright & Own Chrome',
    description: 'Headless or live CDP browser automation with domain allowlist',
    category: 'personal',
    brandColor: '#2ead33',
    authType: 'local-host',
    scopes: { read: true, send: true, defaultRequiresSendApproval: true },
    secretKey: null,
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare',
    description: 'Inspect Workers, DNS records, and tunnel deployments',
    category: 'public',
    brandColor: '#f38020',
    authType: 'api-token',
    scopes: { read: true, send: true, defaultRequiresSendApproval: true },
    secretKey: 'CONNECTOR_CLOUDFLARE_TOKEN',
  },
];

export class ConnectorHub {
  constructor({ dataDir, store, vault }) {
    this.dataDir = dataDir;
    this.store = store;
    this.vault = vault;
    this.statePath = path.join(dataDir, 'connectors-state.json');
  }

  #readState() {
    try {
      if (fs.existsSync(this.statePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.statePath, 'utf8'));
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {}
    return {
      installed: ['remote-desktop', 'sqlite', 'playwright', 'github'],
      accounts: {},
    };
  }

  #writeState(state) {
    const tmp = `${this.statePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, this.statePath);
  }

  #getSecret(label) {
    return this.vault.resolveSecret(label)?.fields?.value || '';
  }

  #dropSecret(label) {
    const existing = this.vault.resolveSecret(label);
    if (existing) this.vault.deleteEntry(existing.id);
  }

  listConnectors({ filter = 'all', query = '' } = {}) {
    const state = this.#readState();
    const vaultMap = new Map(this.vault.listMasked().map(e => [e.label, e]));
    const q = String(query || '').trim().toLowerCase();

    return CONNECTOR_CATALOG.filter(c => {
      if (filter === 'installed' && !state.installed.includes(c.id)) return false;
      if (filter === 'public' && c.category !== 'public') return false;
      if (filter === 'personal' && c.category !== 'personal') return false;
      if (q && !`${c.name} ${c.description} ${c.id}`.toLowerCase().includes(q)) return false;
      return true;
    }).map(c => {
      const acct = state.accounts[c.id] || {};
      const hasSecret = c.secretKey ? vaultMap.has(c.secretKey) : true;
      return {
        ...c,
        installed: state.installed.includes(c.id),
        hasSecret,
        connected: state.installed.includes(c.id) && Boolean(state.accounts[c.id]) && hasSecret,
        accountLabel: acct.accountLabel || '',
        sendApproved: acct.sendApproved ?? false,
        lastCheckedAt: acct.lastCheckedAt || null,
        status: acct.status || (c.authType === 'local-host' ? 'ready-local' : hasSecret ? 'configured' : 'needs-auth'),
        statusDetail: acct.statusDetail || '',
      };
    });
  }

  connectAccount(id, { token = '', accountLabel = '', installed = true, sendApproved = false } = {}) {
    const spec = CONNECTOR_CATALOG.find(c => c.id === id);
    if (!spec) throw new Error(`Unknown connector: ${id}`);

    const state = this.#readState();
    if (installed && !state.installed.includes(id)) {
      state.installed.push(id);
    }
    if (spec.secretKey && token) {
      this.#dropSecret(spec.secretKey);
      this.vault.addEntry({ kind: 'secret', label: spec.secretKey, fields: { value: token } });
    }
    state.accounts[id] = {
      ...(state.accounts[id] || {}),
      accountLabel: accountLabel || state.accounts[id]?.accountLabel || spec.name,
      sendApproved: Boolean(sendApproved),
      updatedAt: new Date().toISOString(),
      status: spec.secretKey ? (token || this.#getSecret(spec.secretKey) ? 'configured' : 'needs-auth') : 'ready-local',
    };
    this.#writeState(state);
    return this.listConnectors().find(c => c.id === id);
  }

  uninstallConnector(id) {
    const state = this.#readState();
    state.installed = state.installed.filter(x => x !== id);
    delete state.accounts[id];
    this.#writeState(state);
    // Disconnect removes the stored credential too, not just the UI entry.
    const spec = CONNECTOR_CATALOG.find(c => c.id === id);
    if (spec?.secretKey) this.#dropSecret(spec.secretKey);
    return { ok: true, id, connected: false };
  }

  async testConnection(id) {
    const spec = CONNECTOR_CATALOG.find(c => c.id === id);
    if (!spec) throw new Error(`Unknown connector: ${id}`);

    const state = this.#readState();
    const secret = spec.secretKey ? this.#getSecret(spec.secretKey) : 'local';
    let ok = false;
    let detail = '';

    const isLocalOnly = Boolean(this.store?.getSettings?.().localOnly);
    if (spec.secretKey && !secret) {
      detail = `Missing credential (${spec.secretKey}) in Vault — link your token/account first.`;
    } else if (isLocalOnly && ['github', 'slack', 'gmail', 'google-drive', 'google-calendar'].includes(id)) {
      detail = 'Blocked by local-only mode: cloud connector checks are disabled.';
    } else if (id === 'github') {
      const r = await fetch('https://api.github.com/user', {
        headers: { Authorization: `Bearer ${secret}`, 'User-Agent': 'Mimir-Agent/1.0' },
        signal: AbortSignal.timeout(6000),
      }).catch(e => ({ ok: false, statusText: e.message }));
      if (r.ok) {
        const u = await r.json().catch(() => ({}));
        ok = true;
        detail = `Verified GitHub @${u.login || 'authenticated'}`;
      } else {
        detail = `GitHub verification failed (${r.status || r.statusText || 'network'})`;
      }
    } else if (id === 'slack') {
      const r = await fetch('https://slack.com/api/auth.test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${secret}` },
        signal: AbortSignal.timeout(6000),
      }).catch(e => ({ ok: false, statusText: e.message }));
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        ok = Boolean(d.ok);
        detail = d.ok ? `Verified Slack workspace: ${d.team}` : `Slack error: ${d.error}`;
      } else {
        detail = `Slack check failed (${r.status || r.statusText})`;
      }
    } else if (id === 'gmail' || id === 'google-drive' || id === 'google-calendar') {
      const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(secret)}`, {
        signal: AbortSignal.timeout(6000),
      }).catch(e => ({ ok: false, statusText: e.message }));
      if (r.ok) {
        const d = await r.json().catch(() => ({}));
        ok = true;
        detail = `Verified Google OAuth (${d.email || d.scope || 'active'})`;
      } else {
        detail = `Google OAuth token invalid or expired (${r.status || r.statusText})`;
      }
    } else if (id === 'remote-desktop') {
      const probe = await runDesktopAction({ action: 'list_windows' }).catch(e => ({ ok: false, error: e.message }));
      ok = Boolean(probe.ok);
      detail = probe.ok ? `Visible desktop windows: ${(probe.windows || []).length}` : (probe.error || 'Headless session');
    } else if (id === 'sqlite' || id === 'playwright') {
      ok = true;
      detail = `${spec.name} local engine online`;
    } else {
      ok = Boolean(secret);
      detail = ok ? 'Token present in encrypted Vault (live ping requires provider endpoint)' : 'No token';
    }

    state.accounts[id] = {
      ...(state.accounts[id] || {}),
      status: ok ? 'connected' : 'error',
      statusDetail: detail,
      lastCheckedAt: new Date().toISOString(),
    };
    this.#writeState(state);
    return { ok, id, detail, connector: this.listConnectors().find(c => c.id === id) };
  }
}
