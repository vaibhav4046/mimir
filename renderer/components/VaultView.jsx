import React, { useState } from 'react';
import { apiFetch } from '../api.js';
import { MimirAsset } from './MimirAsset.jsx';

export function VaultView({ entries, onRefresh }) {
  const [kind, setKind] = useState('secret');
  const [label, setLabel] = useState('');
  const [username, setUsername] = useState('');
  const [secretVal, setSecretVal] = useState('');
  const [site, setSite] = useState('');

  const handleAdd = async e => {
    e.preventDefault();
    if (!label.trim() || !secretVal) return;
    const fields =
      kind === 'login'
        ? { url: site, username, password: secretVal }
        : kind === 'card'
          ? { brand: site || 'Card', number: secretVal, exp: username }
          : { value: secretVal };
    await apiFetch('/v1/vault', {
      method: 'POST',
      body: JSON.stringify({ kind, label: label.trim(), fields }),
    });
    setLabel('');
    setUsername('');
    setSecretVal('');
    setSite('');
    await onRefresh();
  };

  const handleDelete = async id => {
    await apiFetch(`/v1/vault/${encodeURIComponent(id)}`, { method: 'DELETE' });
    await onRefresh();
  };

  return (
    <div className="view-scroll" data-testid="vault-view">
      <div className="view-container">
        <div>
          <h2 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirAsset category="artifacts" name="nornir-chest" size={22} />
            <span>Encrypted Vault</span>
          </h2>
          <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
            Stored locally with AES-256-GCM encryption (`vault.enc.json`). Secret strings are masked in listings and automatically scrubbed from LLM transcripts and logs.
          </p>
        </div>

        <form className="card" onSubmit={handleAdd}>
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirAsset category="artifacts" name="guardian-shield" size={18} />
            <span>Add Vault Entry</span>
          </h3>
          <div className="grid-2">
            <label className="field-label">
              Kind
              <select className="select" value={kind} onChange={e => setKind(e.target.value)}>
                <option value="secret">API Secret / Token</option>
                <option value="login">Website Login</option>
                <option value="card">Payment Card</option>
              </select>
            </label>
            <label className="field-label">
              Label
              <input className="input" required placeholder="github-pat / staging-login" value={label} onChange={e => setLabel(e.target.value)} />
            </label>
          </div>

          <div className="grid-2">
            {kind !== 'secret' && (
              <label className="field-label">
                {kind === 'login' ? 'Site URL' : 'Card Brand'}
                <input className="input" value={site} onChange={e => setSite(e.target.value)} />
              </label>
            )}
            {kind !== 'secret' && (
              <label className="field-label">
                {kind === 'login' ? 'Username / Email' : 'Expiry (MM/YY)'}
                <input className="input" value={username} onChange={e => setUsername(e.target.value)} />
              </label>
            )}
          </div>

          <label className="field-label">
            {kind === 'login' ? 'Password' : kind === 'card' ? 'Card Number' : 'Secret Value'}
            <input type="password" className="input" required value={secretVal} onChange={e => setSecretVal(e.target.value)} />
          </label>

          <div>
            <button type="submit" className="btn btn-primary" data-testid="vault-add-btn">
              Encrypt & Store
            </button>
          </div>
        </form>

        <div className="card">
          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirAsset category="ui" name="vault" size={18} />
            <span>Stored Entries ({entries.length})</span>
          </h3>
          {entries.length === 0 ? (
            <div style={{ color: 'var(--sand-text-subtle)' }}>No entries stored yet.</div>
          ) : (
            entries.map(ent => (
              <div
                key={ent.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  background: 'var(--sand-bg)',
                  borderRadius: 8,
                  border: '1px solid var(--sand-border)',
                }}
              >
                <div>
                  <div>
                    <strong>{ent.label}</strong> <span className="status-pill">{ent.kind}</span>
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--sand-text-muted)', fontFamily: 'var(--sand-mono)' }}>
                    {ent.preview}
                  </div>
                </div>
                <button type="button" className="btn btn-danger btn-sm" onClick={() => handleDelete(ent.id)}>
                  Delete
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
