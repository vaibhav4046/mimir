import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { ModelLibraryPanel } from './ModelLibraryPanel.jsx';

const STEPS = ['Choose', 'Connect', 'Test', 'Ready'];

function StepRail({ step }) {
  return (
    <ol className="wizard-rail" aria-label="Setup steps">
      {STEPS.map((label, i) => (
        <li key={label} className={i === step ? 'is-current' : i < step ? 'is-done' : ''} aria-current={i === step ? 'step' : undefined}>
          <span className="wizard-rail-num">{i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

/**
 * Four-step model setup: Local or Cloud → connect → live capability test → set default.
 * Results shown in step 3 come from real calls to the chosen model.
 */
export function ModelSetupWizard({ settings, onApplied }) {
  const [step, setStep] = useState(0);
  const [mode, setMode] = useState(settings?.localOnly ? 'local' : null);
  const [servers, setServers] = useState(null);
  const [providers, setProviders] = useState([]);
  const [target, setTarget] = useState(null); // { kind, baseUrl, providerId?, model, label }
  const [apiKey, setApiKey] = useState('');
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [localOnly, setLocalOnly] = useState(Boolean(settings?.localOnly));
  const [autoRouting, setAutoRouting] = useState(Boolean(settings?.autoTierRouting));

  useEffect(() => {
    apiFetch('/v1/models/providers').then(r => setProviders(r.providers || [])).catch(() => {});
  }, []);

  const run = async fn => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const chooseMode = m =>
    run(async () => {
      setMode(m);
      setTarget(null);
      setReport(null);
      if (m === 'local') {
        setLocalOnly(true);
        const r = await apiFetch('/v1/models/discover');
        setServers(r.servers || []);
      } else {
        setLocalOnly(false);
      }
      setStep(1);
    });

  // Browser sign-in: open OpenRouter, then wait for the coordinator's callback to store the key.
  const signInOpenRouter = () =>
    run(async () => {
      const { authorizeUrl } = await apiFetch('/v1/models/openrouter/login', { method: 'POST', body: '{}' });
      const opened = window.desktop?.openExternal ? await window.desktop.openExternal(authorizeUrl) : window.open(authorizeUrl, '_blank', 'noopener,noreferrer');
      if (!opened) throw new Error(`Open this link to sign in: ${authorizeUrl}`);
      for (let i = 0; i < 150; i++) {
        await new Promise(r => setTimeout(r, 2000));
        const s = await apiFetch('/v1/settings');
        if (s.openRouterSignedIn && s.hasOpenaiApiKey) {
          setTarget({ kind: 'openai-compat', baseUrl: s.openaiBaseUrl, model: s.openaiModel, label: 'OpenRouter' });
          setLocalOnly(false);
          onApplied?.(s);
          setStep(3);
          return;
        }
      }
      throw new Error('Sign-in was not completed. Try again.');
    });

  const testTarget = () =>
    run(async () => {
      setReport(null);
      const r = await apiFetch('/v1/models/test', {
        method: 'POST',
        body: JSON.stringify({ ...target, apiKey: apiKey || undefined, useSavedKey: !apiKey }),
      });
      setReport(r);
      setStep(2);
    });

  const apply = () =>
    run(async () => {
      const updated = await apiFetch('/v1/models/apply', {
        method: 'POST',
        body: JSON.stringify({ ...target, apiKey: apiKey || undefined, localOnly, autoTierRouting: autoRouting }),
      });
      setApiKey('');
      onApplied?.(updated);
      setStep(3);
    });

  const found = (servers || []).filter(s => s.ok);

  return (
    <section className="card wizard" data-testid="model-wizard" aria-labelledby="model-wizard-title">
      <h3 className="card-title" id="model-wizard-title">Model setup</h3>
      <StepRail step={step} />
      {error && (
        <div role="alert" className="wizard-error">
          {error}
        </div>
      )}

      {step === 0 && (
        <div className="wizard-choices">
          <button type="button" className="wizard-choice" data-testid="wizard-local" disabled={busy} onClick={() => chooseMode('local')}>
            <strong>On this computer</strong>
            <span>Finds Ollama, LM Studio, llama.cpp, vLLM or Jan already running here. Nothing leaves your machine.</span>
          </button>
          <button type="button" className="wizard-choice" data-testid="wizard-cloud" disabled={busy} onClick={() => chooseMode('cloud')}>
            <strong>Cloud provider</strong>
            <span>OpenAI, Anthropic, Gemini, Groq or OpenRouter with your own API key. A chat subscription is not an API key.</span>
          </button>
        </div>
      )}

      {step === 1 && mode === 'local' && (
        <div className="wizard-body">
          <ModelLibraryPanel
            selectedModel={target?.kind === 'ollama' ? target.model : null}
            onPick={model => setTarget({ kind: 'ollama', baseUrl: settings?.ollamaUrl || 'http://127.0.0.1:11434', model, label: 'Ollama' })}
          />
          {found.filter(s => s.kind !== 'ollama').map(s => (
            <fieldset key={s.id} className="wizard-server">
              <legend>
                {s.label} · <code className="inline-code">{s.baseUrl}</code>
              </legend>
              {s.models.length === 0 && <span>Running, but no models installed.</span>}
              <div className="chip-list">
                {s.models.map(m => (
                  <button
                    key={m}
                    type="button"
                    className={`chip wizard-model ${target?.model === m && target?.baseUrl === s.baseUrl ? 'is-selected' : ''}`}
                    aria-pressed={target?.model === m && target?.baseUrl === s.baseUrl}
                    onClick={() => setTarget({ kind: s.kind, baseUrl: s.baseUrl, model: m, label: s.label })}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          {servers && (
            <details className="wizard-missing">
              <summary>Not running ({servers.filter(s => !s.ok).length})</summary>
              {servers
                .filter(s => !s.ok)
                .map(s => (
                  <div key={s.id}>
                    {s.label} · {s.baseUrl} · {s.error}
                  </div>
                ))}
            </details>
          )}
        </div>
      )}

      {step === 1 && mode === 'cloud' && (
        <div className="wizard-server" data-testid="openrouter-signin">
          <strong>Easiest: sign in with OpenRouter</strong>
          <p className="muted">
            One sign-in in your browser, no key to copy. It includes free models; paid models (Claude, GPT, Gemini and others) bill your own OpenRouter
            account. Mimir starts you on a free one.
          </p>
          <button type="button" className="btn btn-primary" data-testid="openrouter-signin-btn" disabled={busy} onClick={signInOpenRouter}>
            {busy ? 'Waiting for sign-in…' : 'Sign in with OpenRouter'}
          </button>
        </div>
      )}

      {step === 1 && mode === 'cloud' && (
        <div className="wizard-body grid-2">
          <p className="muted" style={{ gridColumn: '1 / -1' }}>Or connect a provider directly with an API key from its developer console:</p>
          <label className="field-label">
            Provider
            <select
              className="select"
              value={target?.providerId || ''}
              onChange={e => {
                const p = providers.find(x => x.id === e.target.value);
                setTarget(p ? { kind: 'openai-compat', providerId: p.id, baseUrl: p.baseUrl, model: target?.model || '', label: p.label } : null);
              }}
            >
              <option value="">Choose…</option>
              {providers.map(p => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field-label">
            API key {settings?.hasOpenaiApiKey && <span className="muted">(a key is already saved; leave empty to keep it)</span>}
            <input type="password" className="input" autoComplete="off" value={apiKey} onChange={e => setApiKey(e.target.value)} />
            {target?.providerId && (
              <a href={providers.find(p => p.id === target.providerId)?.keyUrl} target="_blank" rel="noopener noreferrer">
                Get a key
              </a>
            )}
          </label>
          <label className="field-label">
            Model name
            <input
              className="input"
              placeholder="e.g. gpt-4o-mini, llama-3.3-70b-versatile"
              value={target?.model || ''}
              onChange={e => setTarget(t => ({ ...(t || { kind: 'openai-compat' }), model: e.target.value.trim() }))}
            />
          </label>
          <p className="muted">The key is stored in Mimir's encrypted vault on this computer and is never shown again.</p>
        </div>
      )}

      {step === 1 && (
        <div className="wizard-actions">
          <button type="button" className="btn btn-sm" onClick={() => setStep(0)}>
            Back
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="wizard-test"
            disabled={busy || !target?.model || !target?.baseUrl}
            onClick={testTarget}
          >
            {busy ? 'Testing…' : 'Test this model'}
          </button>
        </div>
      )}

      {step === 2 && report && (
        <div className="wizard-body">
          <p>
            <strong>{report.model}</strong> {report.ok ? 'passed every check.' : 'did not pass every check. You can still use it; tool-heavy tasks may fail.'}
          </p>
          <table className="wizard-checks">
            <tbody>
              {report.checks.map(c => (
                <tr key={c.id} data-ok={c.ok}>
                  <td>{c.ok ? 'Pass' : 'Fail'}</td>
                  <td>{c.label}</td>
                  <td className="muted">{c.detail}</td>
                </tr>
              ))}
              <tr>
                <td>Info</td>
                <td>Context window</td>
                <td className="muted">{report.contextLength ? `${report.contextLength.toLocaleString()} tokens` : 'not reported by server'}</td>
              </tr>
              <tr>
                <td>Info</td>
                <td>Images</td>
                <td className="muted">{report.vision === null ? 'not reported by server' : report.vision ? 'supported' : 'not supported'}</td>
              </tr>
            </tbody>
          </table>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={localOnly} disabled={mode === 'cloud'} onChange={e => setLocalOnly(e.target.checked)} data-testid="wizard-local-only" />
            Local-only: never send anything to a model outside this computer
          </label>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input type="checkbox" checked={autoRouting} onChange={e => setAutoRouting(e.target.checked)} />
            Route short, simple messages to the small fast local model
          </label>
          <div className="wizard-actions">
            <button type="button" className="btn btn-sm" onClick={() => setStep(1)}>
              Back
            </button>
            <button type="button" className="btn btn-primary" data-testid="wizard-apply" disabled={busy} onClick={apply}>
              Use {report.model}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="wizard-body" data-testid="wizard-ready">
          <p>
            Ready. New chats use <strong>{target?.model}</strong> via {target?.label}
            {localOnly ? ', and local-only mode is on.' : '.'}
          </p>
          <button type="button" className="btn btn-sm" onClick={() => setStep(0)}>
            Set up another model
          </button>
        </div>
      )}
    </section>
  );
}
