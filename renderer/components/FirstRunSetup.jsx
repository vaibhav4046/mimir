import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { MimirAsset } from './MimirAsset.jsx';
import { ModelLibraryPanel } from './ModelLibraryPanel.jsx';

const STEPS = ['Your computer', 'Your model', 'Ready'];
const RATING_LABEL = { fast: 'Runs fast here', ok: 'Runs well here', slow: 'Runs slowly here', 'too-big': 'Too large for this computer' };

function hardwareSummary(hw) {
  if (!hw) return null;
  const gpu = hw.gpu ? `${hw.gpu.name} · ${hw.gpu.vramGb} GB ${hw.gpu.unified ? 'shared memory' : 'graphics memory'}` : 'No supported graphics card · models will use the processor';
  return { gpu, rest: `${hw.ramGb} GB memory · ${hw.cores} processor threads` };
}

/**
 * First launch: read the device, make sure the local engine (Ollama) is there, install the model
 * that fits, and set it as the default. Everything shown comes from the coordinator's live checks.
 */
export function FirstRunSetup({ settings, onDone, onUseCloud }) {
  const [step, setStep] = useState(0);
  const [lib, setLib] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [showAll, setShowAll] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await apiFetch('/v1/models/library');
      setLib(next);
      setError('');
      return next;
    } catch (err) {
      setError(err.message);
      return null;
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Poll while waiting for the engine to start or a download to finish.
  const waiting = lib && (!lib.ollama.running || lib.catalog.some(m => m.pull && !m.pull.done));
  useEffect(() => {
    if (!waiting) return undefined;
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [waiting, load]);

  const recommended = lib?.catalog.find(m => m.recommended) || null;
  const installedUsable = (lib?.catalog || []).filter(m => m.installed && m.rating !== 'too-big' && m.tools !== false);
  const pick = chosen || (recommended?.installed ? recommended.name : installedUsable[0]?.name) || null;
  const pickRow = lib?.catalog.find(m => m.name === pick) || lib?.otherInstalled?.find(m => m.name === pick) || null;
  const recPull = recommended?.pull;
  const hw = hardwareSummary(lib?.hardware);

  const install = async name => {
    setError('');
    try {
      await apiFetch('/v1/models/pull', { method: 'POST', body: JSON.stringify({ name }) });
      setChosen(name);
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  const finish = async () => {
    setBusy(true);
    setError('');
    try {
      const updated = await apiFetch('/v1/models/apply', {
        method: 'POST',
        body: JSON.stringify({ kind: 'ollama', baseUrl: settings?.ollamaUrl || 'http://127.0.0.1:11434', model: pick, localOnly: true, autoTierRouting: true }),
      });
      onDone(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const skip = async () => {
    try {
      onDone(await apiFetch('/v1/settings', { method: 'PATCH', body: JSON.stringify({ firstRunDismissed: true }) }));
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="first-run" data-testid="first-run">
      <div className="first-run-progress" aria-hidden="true">
        <div style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>
      <section className="first-run-card" aria-labelledby="first-run-title">
        <header className="first-run-top">
          <button type="button" className="link-btn" disabled={step === 0} onClick={() => setStep(s => Math.max(0, s - 1))}>← Back</button>
          <span className="muted">Step {step + 1} of {STEPS.length} · {STEPS[step]}</span>
          <button type="button" className="link-btn" data-testid="first-run-skip" onClick={skip}>Skip setup</button>
        </header>

        {error && <div role="alert" className="wizard-error">{error}</div>}

        {step === 0 && (
          <div className="first-run-body">
            <div className="first-run-hero">
              <MimirAsset category="characters" name="mimir-head" size={56} />
              <div>
                <h1 id="first-run-title">Welcome to Mimir</h1>
                <p className="muted">Describe your workflow once and Mimir runs it, with an AI model that lives on this computer. Free, private, no account.</p>
              </div>
            </div>

            <div className="first-run-box" data-testid="first-run-machine">
              <strong>Your computer</strong>
              {hw ? (
                <>
                  <span>{hw.gpu}</span>
                  <span className="muted">{hw.rest}</span>
                </>
              ) : (
                <span className="muted">Checking…</span>
              )}
            </div>

            <div className="first-run-box" data-testid="first-run-engine">
              <strong>AI engine (Ollama)</strong>
              {!lib && <span className="muted">Checking…</span>}
              {lib?.ollama.running && <span className="first-run-ok">Running and ready</span>}
              {lib && !lib.ollama.running && (
                <>
                  <span>Not found. Mimir uses the free Ollama app to run models on this computer.</span>
                  <span>
                    1. <a href={lib.ollama.installUrl} target="_blank" rel="noopener noreferrer">Download Ollama</a> and install it, or run{' '}
                    <code className="inline-code">{lib.ollama.installCommand}</code>
                  </span>
                  <span>2. Open it once. This screen notices automatically.</span>
                  <span className="muted first-run-wait">Waiting for Ollama…</span>
                </>
              )}
            </div>

            <div className="wizard-actions">
              <button type="button" className="btn btn-sm" onClick={onUseCloud}>Use a cloud model instead</button>
              <button type="button" className="btn btn-primary" data-testid="first-run-next" disabled={!lib?.ollama.running} onClick={() => setStep(1)}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 1 && lib && (
          <div className="first-run-body">
            <h1 id="first-run-title">Install your model</h1>
            {recommended ? (
              <div className="first-run-box first-run-rec" data-testid="first-run-recommended">
                <span className="status-pill model-badge-rec">Best fit for this computer</span>
                <strong className="first-run-model">{recommended.name}</strong>
                <span>{recommended.note}</span>
                <span className="muted">{RATING_LABEL[recommended.rating]} · {recommended.sizeGb} GB download · {recommended.reason}</span>
                {recPull && !recPull.done && (
                  <div className="model-progress" role="progressbar" aria-valuenow={recPull.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Downloading ${recommended.name}`}>
                    <div style={{ width: `${recPull.percent}%` }} />
                    <span>{recPull.percent}% · {recPull.status}</span>
                  </div>
                )}
                {recPull?.error && <span className="wizard-error">Download failed: {recPull.error}</span>}
                <div>
                  {recommended.installed ? (
                    <span className="first-run-ok">Installed</span>
                  ) : (
                    <button type="button" className="btn btn-primary" data-testid="first-run-install" disabled={Boolean(recPull && !recPull.done)} onClick={() => install(recommended.name)}>
                      {recPull && !recPull.done ? 'Downloading…' : `Install ${recommended.name}`}
                    </button>
                  )}
                </div>
              </div>
            ) : (
              <p>No model in the catalog runs well on this computer. Choose one below (it will be slow) or use a cloud model.</p>
            )}

            {installedUsable.length > 0 && !recommended?.installed && (
              <p className="muted">Already installed: {installedUsable.map(m => m.name).join(', ')}. You can continue with {pick}.</p>
            )}

            <button type="button" className="link-btn" onClick={() => setShowAll(v => !v)}>{showAll ? 'Hide other models' : 'See other models'}</button>
            {showAll && <ModelLibraryPanel selectedModel={pick} onPick={setChosen} />}

            <div className="wizard-actions">
              <button type="button" className="btn btn-sm" onClick={onUseCloud}>Use a cloud model instead</button>
              <button type="button" className="btn btn-primary" data-testid="first-run-next" disabled={!pick} onClick={() => setStep(2)}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="first-run-body">
            <h1 id="first-run-title">You're ready</h1>
            <div className="first-run-box">
              <strong>Model: {pick}</strong>
              {pickRow?.rating && <span className="muted">{RATING_LABEL[pickRow.rating]}</span>}
              <span>Everything stays on this computer. You can add cloud models later in Settings.</span>
            </div>
            <div className="first-run-box">
              <strong>Try this first</strong>
              <span>Open Routines → Workflows and type a job, for example:</span>
              <span className="muted">"Every morning, summarize the top news in my field, then list three things worth acting on."</span>
            </div>
            <div className="wizard-actions">
              <button type="button" className="btn btn-primary" data-testid="first-run-finish" disabled={busy || !pick} onClick={finish}>
                {busy ? 'Saving…' : 'Start using Mimir'}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
