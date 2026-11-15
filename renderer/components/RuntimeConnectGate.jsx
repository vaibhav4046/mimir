import React, { useState } from 'react';
import {
  clearCoordinatorSession,
  exchangePairingCode,
  probeCoordinatorHealth,
  requestPairingCode,
  setCoordinatorConnection,
} from '../api.js';

export function RuntimeConnectGate({
  status,
  url,
  message,
  health,
  onConnected,
  onStatusChange,
}) {
  const [runtimeUrl, setRuntimeUrl] = useState(url || 'http://127.0.0.1:4567');
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState(message || '');
  const [pairingReq, setPairingReq] = useState(null);
  const [pairingCode, setPairingCode] = useState('');

  const isAuthState =
    status === 'pairing_required' ||
    status === 'session_expired' ||
    status === 'unauthorized' ||
    Boolean(health?.reachable && health?.authRequired);

  const handleProbe = async () => {
    setBusy(true);
    setErrorMsg('');
    try {
      const nextHealth = await probeCoordinatorHealth(runtimeUrl);
      if (!nextHealth.reachable) {
        onStatusChange({
          status: 'disconnected',
          url: runtimeUrl,
          health: nextHealth,
          message: nextHealth.error || 'No local Mimir coordinator answered on this loopback port.',
        });
        setErrorMsg(nextHealth.error || 'Coordinator unreachable.');
        return;
      }
      if (!nextHealth.authRequired) {
        setCoordinatorConnection({ url: runtimeUrl, token: '', mode: 'local-explicit' });
        await onConnected();
        return;
      }
      onStatusChange({
        status: 'pairing_required',
        url: runtimeUrl,
        health: nextHealth,
        message: 'Local coordinator found. Request a one-time pairing code to link this browser.',
      });
    } catch (err) {
      setErrorMsg(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRequestCode = async () => {
    setBusy(true);
    setErrorMsg('');
    try {
      const req = await requestPairingCode(runtimeUrl, 'Mimir Web Workspace');
      setPairingReq(req);
    } catch (err) {
      setErrorMsg(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleExchangeCode = async evt => {
    evt.preventDefault();
    if (!pairingCode.trim()) return;
    setBusy(true);
    setErrorMsg('');
    try {
      clearCoordinatorSession();
      await exchangePairingCode(runtimeUrl, {
        code: pairingCode.trim(),
        requestId: pairingReq?.requestId,
        clientName: 'Mimir Web Workspace',
      });
      await onConnected();
    } catch (err) {
      setErrorMsg(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  };

  const heading =
    status === 'checking'
      ? 'Looking for Mimir on your computer...'
      : status === 'session_expired'
        ? 'Connection expired'
        : isAuthState
          ? 'Connect to Mimir on this computer'
          : 'Mimir is not running yet';

  const subtitle =
    status === 'checking'
      ? 'Checking http://127.0.0.1:4567 on your computer...'
      : status === 'session_expired'
        ? 'Your sign-in code expired. Get a new 6-character code from the Mimir desktop app.'
        : isAuthState
          ? 'Mimir is running on this computer and needs a quick one-time code to connect this page.'
          : 'Mimir runs AI, browsing, and files privately on your computer. Open the Mimir desktop app, then click Check connection.';

  return (
    <div className="runtime-gate-backdrop" data-testid="runtime-connect-gate" role="main" aria-labelledby="runtime-gate-title">
      <div className="runtime-gate-card">
        <div className="runtime-gate-head">
          <img
            src="./assets/mimir/characters/mimir-head.svg"
            width={40}
            height={40}
            alt="Mimir emblem"
            style={{ imageRendering: 'pixelated', flexShrink: 0 }}
          />
          <div>
            <div className={`runtime-gate-pill is-${isAuthState ? 'warn' : 'offline'}`} data-testid="runtime-status-pill">
              {status === 'checking'
                ? 'Checking'
                : status === 'session_expired'
                  ? 'Connection expired'
                  : isAuthState
                    ? 'Code needed'
                    : 'Not running'}
            </div>
            <h1 id="runtime-gate-title" className="runtime-gate-title">{heading}</h1>
          </div>
        </div>

        <p className="runtime-gate-copy">{subtitle}</p>

        {(errorMsg || message) && (
          <div className="runtime-gate-alert" role="alert" data-testid="runtime-gate-error">
            {errorMsg || message}
          </div>
        )}

        <div className="runtime-gate-section">
          <label htmlFor="runtime-url-field" className="runtime-gate-label">
            Mimir address on this computer
          </label>
          <div className="runtime-gate-row">
            <input
              id="runtime-url-field"
              data-testid="runtime-url-input"
              className="input"
              type="url"
              value={runtimeUrl}
              onChange={e => setRuntimeUrl(e.target.value)}
              placeholder="http://127.0.0.1:4567"
            />
            <button
              type="button"
              className="btn btn-primary"
              data-testid="runtime-retry-btn"
              disabled={busy}
              onClick={handleProbe}
            >
              {busy ? 'Checking...' : 'Check connection'}
            </button>
          </div>
        </div>

        {isAuthState && (
          <form className="runtime-gate-section" onSubmit={handleExchangeCode} data-testid="pairing-form">
            <div className="runtime-gate-label">Connect with a 6-character code</div>
            <div className="runtime-gate-row" style={{ marginBottom: 10 }}>
              <button
                type="button"
                className="btn"
                data-testid="pairing-request-btn"
                disabled={busy}
                onClick={handleRequestCode}
              >
                1. Get a code from Mimir
              </button>
              {health?.reachable && !health?.authRequired && (
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="pairing-confirm-open-btn"
                  disabled={busy}
                  onClick={handleProbe}
                >
                  Connect now
                </button>
              )}
            </div>

            {pairingReq && (
              <div className="runtime-gate-hint" data-testid="pairing-request-info">
                Code created for <strong>{pairingReq.clientName}</strong> (valid for {pairingReq.ttlSeconds}s). Copy the 6-character code shown in your Mimir desktop app.
              </div>
            )}

            <div className="runtime-gate-row">
              <input
                data-testid="pairing-code-input"
                className="input"
                type="text"
                autoComplete="one-time-code"
                value={pairingCode}
                onChange={e => setPairingCode(e.target.value.toUpperCase())}
                placeholder="2. Type the 6-character code (e.g. K7M9P2)"
                maxLength={12}
              />
              <button
                type="submit"
                className="btn btn-primary"
                data-testid="pairing-exchange-btn"
                disabled={busy || !pairingCode.trim()}
              >
                Connect
              </button>
            </div>
          </form>
        )}

        {!isAuthState && (
          <div className="runtime-gate-steps" data-testid="runtime-install-guide">
            <div className="runtime-gate-step">
              <strong>1. Open the Mimir app on this computer</strong>
              <p>Start the <code>Mimir</code> desktop app (or run from a terminal):</p>
              <code>ollama serve &amp;&amp; npm run dev:daemon</code>
            </div>
            <div className="runtime-gate-step">
              <strong>2. Check again</strong>
              <p>Once Mimir is open, click <strong>Check connection</strong> above.</p>
            </div>
          </div>
        )}

        <div className="runtime-gate-footer">
          <a href="/landing/index.html#download" className="btn btn-sm">Download Mimir</a>
          <a href="/landing/index.html" className="btn btn-sm">About Mimir</a>
        </div>
      </div>
    </div>
  );
}
