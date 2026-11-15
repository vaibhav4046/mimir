import React, { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../api.js';
import { MimirAsset } from './MimirAsset.jsx';

function ConnectorLogoSvg({ id, color = '#3ac9ff', size = 24 }) {
  const s = { width: size, height: size, flex: 'none' };
  switch (id) {
    case 'gmail':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
          <rect x="2" y="4" width="20" height="16" rx="2" fill="#101722" stroke={color} strokeWidth="1.6" />
          <path d="M3 6l9 7 9-7" fill="none" stroke="#ea4335" strokeWidth="2.2" />
        </svg>
      );
    case 'google-drive':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
          <polygon points="8,4 16,4 21,13 17,20 7,20 3,13" fill="#101722" stroke="#34a853" strokeWidth="1.6" />
          <path d="M9 5l6 10H5l4-10z" fill="none" stroke="#fbbc05" strokeWidth="1.5" />
        </svg>
      );
    case 'google-calendar':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
          <rect x="3" y="4" width="18" height="17" rx="2" fill="#101722" stroke="#4285f4" strokeWidth="1.7" />
          <path d="M3 9h18M8 2v4M16 2v4" stroke="#4285f4" strokeWidth="1.7" />
          <text x="12" y="17" textAnchor="middle" fill="#a9eeff" fontSize="8" fontFamily="monospace">31</text>
        </svg>
      );
    case 'github':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="#101722" stroke="#e6ab42" strokeWidth="1.6" />
          <path d="M9 17c-3 1-3-1.5-4-2m8 4v-3a2.5 2.5 0 00-.7-2c2.3-.2 4.7-1.1 4.7-5a3.8 3.8 0 00-1-2.6 3.5 3.5 0 00-.1-2.6s-.8-.3-2.7 1a9 9 0 00-5 0c-1.9-1.3-2.7-1-2.7-1a3.5 3.5 0 00-.1 2.6 3.8 3.8 0 00-1 2.6c0 3.9 2.4 4.8 4.7 5a2.5 2.5 0 00-.7 2v3" fill="none" stroke="#e5edf4" strokeWidth="1.4" />
        </svg>
      );
    case 'slack':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
          <rect x="3" y="3" width="18" height="18" rx="3" fill="#101722" stroke="#e01e5a" strokeWidth="1.5" />
          <path d="M7 9h10M7 15h10M9 7v10M15 7v10" stroke="#3ac9ff" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      );
    case 'notion':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
          <rect x="4" y="4" width="16" height="16" fill="#101722" stroke="#e5edf4" strokeWidth="1.7" />
          <path d="M8 17V7l8 10V7" fill="none" stroke="#e5edf4" strokeWidth="1.9" />
        </svg>
      );
    case 'linear':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
          <circle cx="12" cy="12" r="9" fill="#101722" stroke="#5e6ad2" strokeWidth="1.7" />
          <path d="M6 12l6 6M5 9l10 10M8 6l10 10" stroke="#a9eeff" strokeWidth="1.6" />
        </svg>
      );
    case 'remote-desktop':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
          <rect x="2" y="4" width="20" height="13" fill="#101722" stroke="#3ac9ff" strokeWidth="1.7" />
          <path d="M8 20h8M12 17v3M7 10l4 2-4 2M13 13h4" fill="none" stroke="#e6ab42" strokeWidth="1.6" />
        </svg>
      );
    case 'sqlite':
    case 'postgres':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
          <ellipse cx="12" cy="6" rx="7.5" ry="3" fill="#101722" stroke={color} strokeWidth="1.6" />
          <path d="M4.5 6v12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" fill="none" stroke={color} strokeWidth="1.6" />
        </svg>
      );
    case 'playwright':
      return (
        <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
          <rect x="3" y="4" width="18" height="16" fill="#101722" stroke="#2ead33" strokeWidth="1.6" />
          <polygon points="9,8 17,12 9,16" fill="#2ead33" />
        </svg>
      );
    case 'cloudflare':
    default:
      return (
        <svg viewBox="0 0 24 24" style={s} aria-hidden="true">
          <path d="M7 18h11a4 4 0 00.5-7.9A5.5 5.5 0 008 9.2 4 4 0 007 18z" fill="#101722" stroke={color} strokeWidth="1.7" />
        </svg>
      );
  }
}

function PluginsHubSection() {
  const [connectors, setConnectors] = useState([]);
  const [filter, setFilter] = useState('all'); // all | public | personal
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const [tokenDraft, setTokenDraft] = useState('');
  const [accountDraft, setAccountDraft] = useState('');
  const [sendApproved, setSendApproved] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef(null);

  const loadConnectors = async () => {
    const res = await apiFetch('/v1/connectors');
    setConnectors(res?.connectors || []);
  };

  useEffect(() => {
    loadConnectors().catch(() => {});
  }, []);

  const installedList = connectors.filter(c => c.installed);
  const visible = connectors.filter(c => {
    if (filter !== 'all' && c.category !== filter) return false;
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      if (!`${c.name} ${c.description} ${c.id}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const openModal = conn => {
    setEditing(conn);
    setAccountDraft(conn.accountLabel || conn.name);
    setTokenDraft('');
    setSendApproved(Boolean(conn.sendApproved));
    setTestResult(null);
    dialogRef.current?.showModal();
  };

  const handleSaveConnector = async e => {
    e.preventDefault();
    if (!editing) return;
    setBusy(true);
    try {
      const updated = await apiFetch(`/v1/connectors/${encodeURIComponent(editing.id)}/connect`, {
        method: 'POST',
        body: JSON.stringify({
          accountLabel: accountDraft.trim() || editing.name,
          token: tokenDraft.trim(),
          installed: true,
          sendApproved,
        }),
      });
      setEditing(updated);
      setTokenDraft('');
      await loadConnectors();
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async id => {
    setBusy(true);
    try {
      const res = await apiFetch(`/v1/connectors/${encodeURIComponent(id)}/test`, {
        method: 'POST',
        body: '{}',
      });
      setTestResult(res);
      await loadConnectors();
    } finally {
      setBusy(false);
    }
  };

  const handleUninstall = async id => {
    setBusy(true);
    try {
      await apiFetch(`/v1/connectors/${encodeURIComponent(id)}`, { method: 'DELETE' });
      dialogRef.current?.close();
      setEditing(null);
      await loadConnectors();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="plugins-hub card" data-testid="plugins-hub">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
        <div>
          <h3 className="card-title" style={{ margin: 0 }}>Plugins &amp; Account Connectors</h3>
          <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
            Read actions run automatically once connected; Send / write actions pause behind Runic OK gates unless explicitly unlocked.
          </div>
        </div>
        <input
          type="search"
          className="input"
          data-testid="connector-search-input"
          placeholder="Search plugins..."
          aria-label="Search plugins and connectors"
          style={{ width: 220 }}
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
      </div>

      {/* Installed quick strip */}
      <div>
        <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--brass)', marginBottom: 6 }}>
          Installed ({installedList.length})
        </div>
        <div className="installed-strip" data-testid="installed-strip">
          {installedList.map(c => (
            <button
              key={c.id}
              type="button"
              className={`installed-chip ${c.connected ? 'is-connected' : ''}`}
              onClick={() => openModal(c)}
            >
              <ConnectorLogoSvg id={c.id} color={c.brandColor} size={18} />
              <span style={{ fontSize: 12, fontWeight: 700 }}>{c.name}</span>
              <span className="pill" style={{ fontSize: 10 }}>{c.status}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Public / Personal filter */}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {[
          { id: 'all', label: 'All' },
          { id: 'public', label: 'Public' },
          { id: 'personal', label: 'Personal' },
        ].map(f => (
          <button
            key={f.id}
            type="button"
            data-testid={`connector-filter-${f.id}`}
            className={`btn btn-sm ${filter === f.id ? 'btn-primary' : ''}`}
            onClick={() => setFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Connector cards grid */}
      <div className="connector-grid">
        {visible.map(c => (
          <article key={c.id} className="connector-card" data-testid={`connector-card-${c.id}`}>
            <div className="connector-card-head">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ConnectorLogoSvg id={c.id} color={c.brandColor} size={28} />
                <div>
                  <strong style={{ fontSize: 14 }}>{c.name}</strong>
                  <div style={{ fontSize: 11, color: 'var(--ink-subtle)', fontFamily: 'var(--sand-mono)' }}>
                    {c.category} · {c.authType}
                  </div>
                </div>
              </div>
              <span className="pill" style={{ fontSize: 10 }}>{c.status}</span>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-muted)', flex: 1 }}>{c.description}</p>
            <div style={{ fontSize: 11.5, color: 'var(--ink-subtle)' }}>
              Scopes: Read (auto) · {c.scopes?.send ? (c.sendApproved ? 'Send (unlocked)' : 'Send (asks OK)') : 'Read-only'}
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'space-between', alignItems: 'center' }}>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                data-testid={`connector-configure-${c.id}`}
                onClick={() => openModal(c)}
              >
                {c.installed ? 'Configure' : 'Connect'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={async () => {
                  const res = await apiFetch(`/v1/connectors/${encodeURIComponent(c.id)}/test`, { method: 'POST', body: '{}' });
                  setEditing(c);
                  setTestResult(res);
                  dialogRef.current?.showModal();
                  await loadConnectors();
                }}
              >
                Test
              </button>
            </div>
          </article>
        ))}
      </div>

      <dialog ref={dialogRef} className="mimir-dialog" aria-labelledby="connector-dialog-title">
        <div className="mimir-dialog-head">
          <strong id="connector-dialog-title" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {editing && <ConnectorLogoSvg id={editing.id} color={editing.brandColor} size={20} />}
            <span>{editing?.name || 'Configure Connector'}</span>
          </strong>
          <button type="button" className="btn btn-sm" onClick={() => dialogRef.current?.close()}>
            Close
          </button>
        </div>
        {editing && (
          <form className="mimir-dialog-body" onSubmit={handleSaveConnector}>
            <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>{editing.description}</div>
            <label className="field-label">
              Account / Connection Label
              <input
                className="input"
                value={accountDraft}
                onChange={e => setAccountDraft(e.target.value)}
                placeholder={editing.name}
              />
            </label>
            {editing.secretKey && (
              <label className="field-label">
                {editing.authType === 'connection-uri' ? 'Connection URI' : 'Encrypted Token / API Key'} (stored in vault as <code>{editing.secretKey}</code>)
                <input
                  type="password"
                  className="input"
                  value={tokenDraft}
                  onChange={e => setTokenDraft(e.target.value)}
                  placeholder={editing.hasSecret ? 'Saved in encrypted vault (enter new value to replace)' : 'Paste token or key...'}
                />
              </label>
            )}
            {editing.scopes?.send && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={sendApproved}
                  onChange={e => setSendApproved(e.target.checked)}
                />
                Unlock outbound Send / write actions (unchecked = always require Needs your OK approval)
              </label>
            )}
            {testResult && (
              <div
                className={`tool-card ${testResult.ok ? '' : 'is-error'}`}
                data-testid="connector-test-result"
                style={{ fontSize: 12 }}
              >
                <strong>{testResult.ok ? 'Probe OK' : 'Probe Failed'}:</strong> {testResult.detail || testResult.error || JSON.stringify(testResult)}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div>
                {editing.installed && (
                  <button
                    type="button"
                    className="btn btn-danger btn-sm"
                    disabled={busy}
                    onClick={() => handleUninstall(editing.id)}
                  >
                    Uninstall &amp; Wipe Key
                  </button>
                )}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => handleTest(editing.id)}
                >
                  Test Connection
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={busy}>
                  Save &amp; Connect
                </button>
              </div>
            </div>
          </form>
        )}
      </dialog>
    </section>
  );
}

const NEEDS_SIGN_IN = new Set(['awaiting_auth', 'needs_reauth', 'revoked']);
const STATUS_HELP = {
  awaiting_auth: 'This server needs you to sign in before Mimir can use its tools.',
  needs_reauth: 'The saved sign-in no longer works. Sign in again to reconnect.',
  revoked: 'Access was revoked. Bots cannot use this server until you sign in again.',
};

export function McpView({ mcps, onRefresh }) {
  const [form, setForm] = useState({
    name: '',
    transport: 'stdio',
    command: '',
    args: '',
    url: '',
    customInstructions: '',
  });
  const [busyId, setBusyId] = useState(null);
  const [err, setErr] = useState('');

  const handleSave = async e => {
    e.preventDefault();
    setErr('');
    try {
      await apiFetch('/v1/mcps', {
        method: 'POST',
        body: JSON.stringify(form),
      });
      setForm({ name: '', transport: 'stdio', command: '', args: '', url: '', customInstructions: '' });
      await onRefresh();
    } catch (e2) {
      setErr(e2.message);
    }
  };

  const discover = async id => {
    setBusyId(id);
    setErr('');
    try {
      await apiFetch(`/v1/mcps/${encodeURIComponent(id)}/discover`, { method: 'POST', body: '{}' });
      await onRefresh();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusyId(null);
    }
  };

  const toggleTool = async (srvId, toolName, disabled) => {
    await apiFetch(`/v1/mcps/${encodeURIComponent(srvId)}/tools/${encodeURIComponent(toolName)}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ disabled }),
    });
    await onRefresh();
  };

  const toggleServer = async srv => {
    await apiFetch('/v1/mcps', {
      method: 'POST',
      body: JSON.stringify({ ...srv, enabled: srv.enabled === false }),
    });
    await onRefresh();
  };

  // Opens the provider's sign-in page in the user's browser, then watches for the callback.
  const signIn = async srv => {
    setBusyId(srv.id);
    setErr('');
    try {
      const { authorizeUrl } = await apiFetch(`/v1/mcps/${encodeURIComponent(srv.id)}/oauth/start`, { method: 'POST', body: '{}' });
      const opened = window.desktop?.openExternal ? await window.desktop.openExternal(authorizeUrl) : window.open(authorizeUrl, '_blank', 'noopener,noreferrer');
      if (!opened) setErr(`Open this link to sign in: ${authorizeUrl}`);
      for (let i = 0; i < 60; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const list = await apiFetch('/v1/mcps');
        if (list.find(s => s.id === srv.id)?.status === 'connected') break;
      }
      await onRefresh();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async srv => {
    setErr('');
    try {
      await apiFetch(`/v1/mcps/${encodeURIComponent(srv.id)}/oauth/revoke`, { method: 'POST', body: '{}' });
      await onRefresh();
    } catch (e2) {
      setErr(e2.message);
    }
  };

  const removeServer = async id => {
    await apiFetch(`/v1/mcps/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await onRefresh();
  };

  return (
    <div className="view-scroll" data-testid="mcp-view">
      <div className="view-container">
        <div>
          <h2 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirAsset category="ui" name="mcp-box" size={22} />
            <span>MCP Box</span>
          </h2>
          <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
            Connect local stdio servers or remote MCP servers over HTTP. Remote servers that need an account open a sign-in page in your browser; tokens stay in Mimir's encrypted vault.
          </p>
        </div>

        {err && <div className="tool-card" style={{ borderColor: 'var(--err)', color: 'var(--err)' }}>{err}</div>}

        <PluginsHubSection />

        <form className="card" onSubmit={handleSave}>
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirAsset category="artifacts" name="dwarven-tongs" size={18} />
            <span>Add MCP Server</span>
          </h3>
          <div className="grid-2">
            <label className="field-label">
              Server Name
              <input className="input" required placeholder="Filesystem / Memory / Custom" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="field-label">
              Transport
              <select className="select" value={form.transport} onChange={e => setForm(f => ({ ...f, transport: e.target.value }))}>
                <option value="stdio">stdio (local process)</option>
                <option value="http">Remote (Streamable HTTP, sign-in supported)</option>
              </select>
            </label>
          </div>

          {form.transport === 'stdio' ? (
            <div className="grid-2">
              <label className="field-label">
                Command
                <input className="input" required placeholder="npx or D:\node.exe" value={form.command} onChange={e => setForm(f => ({ ...f, command: e.target.value }))} />
              </label>
              <label className="field-label">
                Arguments (space-separated)
                <input className="input" placeholder="-y @modelcontextprotocol/server-filesystem C:\work" value={form.args} onChange={e => setForm(f => ({ ...f, args: e.target.value }))} />
              </label>
            </div>
          ) : (
            <label className="field-label">
              Endpoint URL
              <input className="input" required placeholder="http://127.0.0.1:8787/mcp" value={form.url} onChange={e => setForm(f => ({ ...f, url: e.target.value }))} />
            </label>
          )}

          <label className="field-label">
            Custom Server Instructions (injected into system prompt)
            <textarea className="textarea" rows={2} value={form.customInstructions} onChange={e => setForm(f => ({ ...f, customInstructions: e.target.value }))} />
          </label>

          <div>
            <button type="submit" className="btn btn-primary">
              Add Server
            </button>
          </div>
        </form>

        {mcps.map(srv => (
          <div key={srv.id} className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <MimirAsset category="artifacts" name={srv.status === 'connected' ? 'dwarven-forge-hammer' : 'dwarven-gear'} size={18} />
                <strong>{srv.name}</strong>{' '}
                <span className="status-pill">
                  {srv.transport} • {srv.status}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {NEEDS_SIGN_IN.has(srv.status) ? (
                  <button type="button" className="btn btn-primary btn-sm" data-testid={`mcp-signin-${srv.id}`} onClick={() => signIn(srv)} disabled={busyId === srv.id}>
                    {busyId === srv.id ? 'Waiting for sign-in…' : srv.status === 'awaiting_auth' ? 'Sign in' : 'Sign in again'}
                  </button>
                ) : (
                  <button type="button" className="btn btn-sm" onClick={() => discover(srv.id)} disabled={busyId === srv.id}>
                    {busyId === srv.id ? 'Connecting...' : 'Discover Tools'}
                  </button>
                )}
                {srv.auth && (
                  <button type="button" className="btn btn-sm" data-testid={`mcp-revoke-${srv.id}`} onClick={() => revoke(srv)}>
                    Revoke access
                  </button>
                )}
                <button type="button" className="btn btn-sm" onClick={() => toggleServer(srv)}>
                  {srv.enabled === false ? 'Enable' : 'Disable'}
                </button>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => removeServer(srv.id)}>
                  Delete
                </button>
              </div>
            </div>

            <div style={{ fontFamily: 'var(--sand-mono)', fontSize: 12, color: 'var(--sand-text-muted)' }}>
              {srv.transport === 'stdio' ? `${srv.command} ${(srv.args || []).join(' ')}` : srv.url}
            </div>

            {srv.error && <div style={{ color: 'var(--sand-red)', fontSize: 12.5 }}>{srv.error}</div>}
            {STATUS_HELP[srv.status] && <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>{STATUS_HELP[srv.status]}</div>}
            {srv.auth && (
              <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
                Signed in with {new URL(srv.auth.issuer || 'http://unknown').host}
                {srv.auth.scopes?.length ? ` · access granted: ${srv.auth.scopes.join(', ')}` : ''}
              </div>
            )}

            {srv.tools?.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ fontSize: 12, color: 'var(--sand-text-muted)' }}>Discovered Tools ({srv.tools.length}):</div>
                {srv.tools.map(t => {
                  const isDisabled = (srv.disabledTools || []).includes(t.name);
                  return (
                    <label
                      key={t.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        padding: '6px 10px',
                        background: 'var(--sand-bg)',
                        borderRadius: 6,
                        border: '1px solid var(--sand-border)',
                      }}
                    >
                      <span>
                        <code>{t.name}</code>
                        {t.description ? ` — ${t.description}` : ''}
                      </span>
                      <input
                        type="checkbox"
                        checked={!isDisabled}
                        onChange={e => toggleTool(srv.id, t.name, !e.target.checked)}
                      />
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
