import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { MimirAsset } from './MimirAsset.jsx';
import { ModelLibraryPanel } from './ModelLibraryPanel.jsx';

const RATING_LABEL = { fast: 'Runs fast here', ok: 'Runs well here', slow: 'Runs slowly here', 'too-big': 'Too large for this computer' };

function hardwareSummary(hw) {
  if (!hw) return null;
  const gpu = hw.gpu ? `${hw.gpu.name} · ${hw.gpu.vramGb} GB` : 'No supported graphics card (uses the processor)';
  return `${gpu} · ${hw.ramGb} GB memory · ${hw.cores} threads`;
}

/**
 * First launch, one screen: read the device, check the local engine (Ollama), pick the model that
 * fits, and one button installs it and saves the best settings. Everything comes from live checks.
 */
export function FirstRunSetup({ settings, onDone, onUseCloud }) {
  const [lib, setLib] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');
  const [settingUp, setSettingUp] = useState(false);
  const [offline, setOffline] = useState(false);
  const fail = err => {
    setError(err.message);
    setOffline(err.code === 'OFFLINE');
  };

  const load = useCallback(async () => {
    try {
      const next = await apiFetch('/v1/models/library');
      setLib(next);
      setError('');
      setOffline(false);
      return next;
    } catch (err) {
      fail(err);
      return null;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const recommended = lib?.catalog.find(m => m.recommended) || null;
  const installedUsable = (lib?.catalog || []).filter(m => m.installed && m.rating !== 'too-big' && m.tools !== false);
  const target = chosen || recommended?.name || installedUsable[0]?.name || null;
  const row = lib?.catalog.find(m => m.name === target) || lib?.otherInstalled?.find(m => m.name === target) || null;
  const installed = Boolean(row?.installed || lib?.otherInstalled?.some(m => m.name === target));
  const pull = row?.pull;
  const engineOk = Boolean(lib?.ollama.running);

  // Poll while the service is unreachable, the engine is not up, or a download is running.
  const waiting = !lib || offline || !engineOk || lib.catalog.some(m => m.pull && !m.pull.done);
  useEffect(() => {
    if (!waiting) return undefined;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [waiting, load]);

  const apply = useCallback(async () => {
    try {
      const updated = await apiFetch('/v1/models/apply', {
        method: 'POST',
        body: JSON.stringify({ kind: 'ollama', baseUrl: settings?.ollamaUrl || 'http://127.0.0.1:11434', model: target, localOnly: true, autoTierRouting: true }),
      });
      onDone(updated);
    } catch (err) {
      fail(err);
      setSettingUp(false);
    }
  }, [settings?.ollamaUrl, target, onDone]);

  // Once the download lands, finish on its own.
  useEffect(() => {
    if (settingUp && installed) apply();
  }, [settingUp, installed, apply]);

  useEffect(() => {
    if (settingUp && pull?.error) setSettingUp(false);
  }, [settingUp, pull?.error]);

  const setUp = async () => {
    setError('');
    setSettingUp(true);
    if (installed) return; // effect above applies
    try {
      await apiFetch('/v1/models/pull', { method: 'POST', body: JSON.stringify({ name: target }) });
      await load();
    } catch (err) {
      fail(err);
      setSettingUp(false);
    }
  };

  const skip = async () => {
    try {
      onDone(await apiFetch('/v1/settings', { method: 'PATCH', body: JSON.stringify({ firstRunDismissed: true }) }));
    } catch (err) {
      fail(err);
    }
  };

  let buttonLabel = 'Set up Mimir';
  if (settingUp) buttonLabel = pull && !pull.done ? `Downloading… ${pull.percent}%` : 'Saving…';
  else if (row && !installed) buttonLabel = `Set up Mimir (${row.sizeGb} GB download)`;

  return (
    <div className="first-run" data-testid="first-run">
      <section className="first-run-card" aria-labelledby="first-run-title">
        <header className="first-run-top">
          <span />
          <button type="button" className="link-btn" data-testid="first-run-skip" onClick={skip}>Skip</button>
        </header>

        <div className="first-run-hero">
          <MimirAsset category="characters" name="mimir-head" size={56} />
          <div>
            <h1 id="first-run-title">Set up Mimir</h1>
            <p className="muted">Mimir checked this computer and picked the best settings. One click and you're in. Free, private, runs on this computer.</p>
          </div>
        </div>

        {error && <div role="alert" className="wizard-error">{error}</div>}

        <ul className="first-run-checks">
          <li data-testid="first-run-machine">
            <span className={lib ? 'first-run-ok' : 'muted'}>{lib ? '✓' : '…'}</span>
            <div>
              <strong>Computer</strong>
              <span className="muted">{hardwareSummary(lib?.hardware) || 'Checking…'}</span>
            </div>
          </li>

          <li data-testid="first-run-engine">
            <span className={engineOk ? 'first-run-ok' : 'first-run-wait'}>{engineOk ? '✓' : '…'}</span>
            <div>
              <strong>AI engine (Ollama)</strong>
              {!lib && <span className="muted">Checking…</span>}
              {engineOk && <span className="muted">Running</span>}
              {lib && !engineOk && (
                <span>
                  Not installed. <a href={lib.ollama.installUrl} target="_blank" rel="noopener noreferrer">Download Ollama</a> (free), or run{' '}
                  <code className="inline-code">{lib.ollama.installCommand}</code>, then open it. This screen updates by itself.
                </span>
              )}
            </div>
          </li>

          <li data-testid="first-run-recommended">
            <span className={installed ? 'first-run-ok' : 'muted'}>{installed ? '✓' : '•'}</span>
            <div>
              <strong>Model: {target || 'none fits'}</strong>
              {row && (
                <span className="muted">
                  {target === recommended?.name ? 'Best fit for this computer · ' : ''}
                  {RATING_LABEL[row.rating] || ''}
                  {installed ? ' · Installed' : ` · ${row.sizeGb} GB download`}
                </span>
              )}
              {!target && lib && <span className="muted">No local model runs well here. Use a cloud model instead.</span>}
              {pull && !pull.done && (
                <div className="model-progress" role="progressbar" aria-valuenow={pull.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Downloading ${target}`}>
                  <div style={{ width: `${pull.percent}%` }} />
                  <span>{pull.percent}% · {pull.status}</span>
                </div>
              )}
              {pull?.error && <span className="wizard-error">Download failed: {pull.error}</span>}
              <button type="button" className="link-btn" onClick={() => setShowAll(v => !v)}>{showAll ? 'Hide other models' : 'Choose a different model'}</button>
            </div>
          </li>
        </ul>

        {showAll && <ModelLibraryPanel selectedModel={target} onPick={name => { setChosen(name); setShowAll(false); }} />}

        <button type="button" className="btn btn-primary first-run-go" data-testid="first-run-finish" disabled={!engineOk || !target || settingUp} onClick={setUp}>
          {buttonLabel}
        </button>
        <button type="button" className="link-btn" onClick={onUseCloud}>Use a cloud model instead</button>
      </section>
    </div>
  );
}
