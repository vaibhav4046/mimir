import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

/** Approve or deny Mimir's questions from a phone, through your own Telegram bot (long polling, nothing public). */
export function TelegramCard() {
  const [status, setStatus] = useState(null);
  const [token, setToken] = useState('');
  const [pairing, setPairing] = useState(null); // { code, expiresAt } is shown once, never fetched again
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const refresh = async () => {
    try {
      setStatus(await apiFetch('/v1/telegram/status'));
    } catch {
      setStatus(null);
    }
  };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);

  const act = async (path, body, after) => {
    setBusy(true);
    setError('');
    try {
      const out = await apiFetch(path, { method: 'POST', body: JSON.stringify(body || {}) });
      after?.(out);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const showCode = out => setPairing(out.code ? { code: out.code, expiresAt: out.expiresAt } : null);
  const connect = e => {
    e.preventDefault();
    act('/v1/telegram/connect', { token: token.trim() }, out => { setToken(''); showCode(out); });
  };

  const paired = Boolean(status?.paired);
  const codeLive = pairing && !paired && status?.pairingOpen;
  const state = !status ? 'Checking…' : status.localOnly ? 'Off (Local-only mode is on)' : !status.configured ? 'Not set up' : !status.connected ? 'Trouble reaching Telegram' : paired ? 'On, phone paired' : 'On, waiting for you to pair a phone';

  return (
    <div className="card" data-testid="telegram-card">
      <h3 className="card-title">Approve from your phone (Telegram)</h3>
      <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
        When Mimir needs your OK, it can message you in Telegram with Approve and Deny buttons. It uses a bot that you create, and your PC asks Telegram for new messages, so nothing is exposed to the internet. Anything marked irreversible needs a second tap.
      </div>

      <div data-testid="telegram-status" style={{ fontSize: 12.5, marginTop: 6 }}>
        <strong>{state}</strong>
        {status?.botUsername && <span> · bot @{status.botUsername}</span>}
        {status?.lastError && <span data-testid="telegram-last-error"> · {status.lastError}</span>}
      </div>
      {error && <div role="alert" data-testid="telegram-error">Could not do that: {error}</div>}

      {status?.localOnly && (
        <div style={{ fontSize: 12.5, marginTop: 6 }}>Telegram needs the internet. Turn off Local-only mode below to use it.</div>
      )}

      {status && !status.configured && !status.localOnly && (
        <form onSubmit={connect} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <ol style={{ fontSize: 12.5, margin: '0 0 0 18px', padding: 0 }}>
            <li>In Telegram, open a chat with <strong>@BotFather</strong>.</li>
            <li>Send <code>/newbot</code>, then pick a name and a username that ends in <code>bot</code>.</li>
            <li>BotFather replies with a token that looks like <code>123456789:ABC…</code>. Paste it here.</li>
          </ol>
          <input
            className="input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            data-testid="telegram-token-input"
            placeholder="Bot token from BotFather"
            value={token}
            onChange={e => setToken(e.target.value)}
          />
          <div>
            <button type="submit" className="btn btn-sm" data-testid="telegram-connect" disabled={busy || !token.trim()}>Connect</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)' }}>The token is stored in Mimir's encrypted vault and is never shown again.</div>
        </form>
      )}

      {status?.configured && !paired && !status.localOnly && (
        <div style={{ marginTop: 8, fontSize: 12.5 }} data-testid="telegram-pairing">
          {codeLive ? (
            <>
              <div>Open your bot{status.botUsername ? ` (@${status.botUsername})` : ''} in Telegram and send this message within 5 minutes:</div>
              <code className="code-block" data-testid="telegram-pair-code" style={{ fontSize: 15 }}>/pair {pairing.code}</code>
            </>
          ) : (
            <div>To link your phone, make a one-time code and send it to your bot.</div>
          )}
          <button type="button" className="btn btn-sm" data-testid="telegram-new-code" disabled={busy || !status.connected} style={{ marginTop: 6 }} onClick={() => act('/v1/telegram/pair-code', {}, showCode)}>
            {codeLive ? 'New code' : 'Make a pairing code'}
          </button>
        </div>
      )}

      {status?.configured && (
        <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {paired && (
            <button type="button" className="btn btn-sm" data-testid="telegram-unpair" disabled={busy} onClick={() => act('/v1/telegram/unpair', {}, () => setPairing(null))}>Unpair this phone</button>
          )}
          <button type="button" className="btn btn-sm" data-testid="telegram-disconnect" disabled={busy} onClick={() => act('/v1/telegram/disconnect', {}, () => setPairing(null))}>Disconnect and forget the bot</button>
        </div>
      )}
    </div>
  );
}
