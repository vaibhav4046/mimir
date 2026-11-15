import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

const RATING_LABEL = { fast: 'Runs fast', ok: 'Runs well', slow: 'Runs slowly', 'too-big': 'Too large' };
const KIND_LABEL = { general: 'General', code: 'Coding', reasoning: 'Reasoning', vision: 'Sees images' };

function hardwareLine(hw) {
  const gpu = hw.gpu ? `${hw.gpu.name} · ${hw.gpu.vramGb} GB ${hw.gpu.unified ? 'shared memory' : 'graphics memory'}` : 'No supported graphics card (models use the processor)';
  return `${gpu} · ${hw.ramGb} GB memory · ${hw.cores} processor threads`;
}

/**
 * Local model library: rates every catalog model against this computer, installs with one
 * click (progress comes from the real download), and lets the user pick an installed model.
 */
export function ModelLibraryPanel({ selectedModel, onPick }) {
  const [lib, setLib] = useState(null);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      setLib(await apiFetch('/v1/models/library'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  const downloading = Boolean(lib?.catalog.some(m => m.pull && !m.pull.done));
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    if (!downloading) return undefined;
    const id = setInterval(load, 1200);
    return () => clearInterval(id);
  }, [downloading, load]);

  const install = async name => {
    try {
      await apiFetch('/v1/models/pull', { method: 'POST', body: JSON.stringify({ name }) });
      await load();
    } catch (err) {
      setError(err.message);
    }
  };

  if (!lib) return <p>{error ? `Could not read this computer: ${error}` : 'Checking this computer…'}</p>;

  const visible = lib.catalog.filter(m => showAll || m.rating !== 'too-big' || m.installed);
  const hiddenCount = lib.catalog.length - visible.length;

  return (
    <div className="model-library" data-testid="model-library">
      <p className="muted" data-testid="hardware-line">This computer: {hardwareLine(lib.hardware)}</p>
      {error && <div role="alert" className="wizard-error">{error}</div>}

      {!lib.ollama.running && (
        <div className="wizard-server" data-testid="ollama-missing">
          <strong>Ollama is not running.</strong> It is the free program that runs models on your computer.
          <div>
            <a href={lib.ollama.installUrl} target="_blank" rel="noopener noreferrer">Download Ollama</a> or run{' '}
            <code className="inline-code">{lib.ollama.installCommand}</code>, start it, then{' '}
            <button type="button" className="btn btn-sm" onClick={load}>check again</button>.
          </div>
        </div>
      )}

      <ul className="model-list">
        {[...visible, ...lib.otherInstalled].map(m => {
          const busy = m.pull && !m.pull.done;
          const isSelected = selectedModel === m.name;
          return (
            <li key={m.name} className={`model-row ${isSelected ? 'is-selected' : ''}`} data-rating={m.rating} data-testid={`model-row-${m.name}`}>
              <div className="model-row-main">
                <strong>{m.name}</strong>
                {m.recommended && <span className="status-pill model-badge-rec">Recommended for this computer</span>}
                <span className="model-rating" data-rating={m.rating}>{RATING_LABEL[m.rating]}</span>
                <span className="muted">
                  {KIND_LABEL[m.kind] || m.kind} · {m.sizeGb} GB download{m.tools === false ? ' · chat only, no tools' : ''}
                </span>
                <span className="muted">{m.note ? `${m.note} ` : ''}{m.reason}.</span>
                {busy && (
                  <div className="model-progress" role="progressbar" aria-valuenow={m.pull.percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Downloading ${m.name}`}>
                    <div style={{ width: `${m.pull.percent}%` }} />
                    <span>{m.pull.percent}% · {m.pull.status}</span>
                  </div>
                )}
                {m.pull?.error && <span className="wizard-error">Download failed: {m.pull.error}</span>}
              </div>
              <div className="model-row-action">
                {m.installed ? (
                  <button type="button" className={isSelected ? 'btn btn-primary btn-sm' : 'btn btn-sm'} aria-pressed={isSelected} onClick={() => onPick(m.name)}>
                    {isSelected ? 'Selected' : 'Use'}
                  </button>
                ) : (
                  <button type="button" className="btn btn-sm" disabled={busy || !lib.ollama.running || m.rating === 'too-big'} onClick={() => install(m.name)}>
                    {busy ? 'Downloading…' : 'Install'}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {(hiddenCount > 0 || showAll) && (
        <button type="button" className="btn btn-sm" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Hide models too large for this computer' : `Show ${hiddenCount} model(s) too large for this computer`}
        </button>
      )}
    </div>
  );
}
