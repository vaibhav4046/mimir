import React, { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api.js';

const POLL_MS = 3000;
const MODES = [
  { id: 'fast', label: 'Fast', hint: 'Smallest installed model, no thinking. Quickest replies.' },
  { id: 'standard', label: 'Standard', hint: 'Answers directly with a model sized to each question.' },
  { id: 'reasoning', label: 'Reasoning', hint: 'Your main model thinks step by step before answering. Slower, better on hard questions. Applies to local models that support thinking.' },
];

const fmtTokens = n => {
  if (n >= 1024 && n % 1024 === 0) return `${n / 1024}k`; // window sizes: 8192 -> 8k
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
};
const pct = (used, total) => (total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0);

function Meter({ label, value, percent, title, testId }) {
  const level = percent >= 90 ? 'high' : percent >= 70 ? 'mid' : 'low';
  return (
    <div className="usage-meter" title={title} data-testid={testId}>
      <span className="usage-label">{label}</span>
      <span className="usage-track" aria-hidden="true"><span className={`usage-fill usage-${level}`} style={{ width: `${percent}%` }} /></span>
      <span className="usage-value">{value}</span>
    </div>
  );
}

/** Live resource use and the response mode, shown above the chat box. */
export function UsageBar({ threadId, isRunning }) {
  const [usage, setUsage] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    try {
      setUsage(await apiFetch(`/v1/system/usage${threadId ? `?threadId=${encodeURIComponent(threadId)}` : ''}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [threadId]);

  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [load, isRunning]);

  const setMode = async mode => {
    setSaving(true);
    try {
      await apiFetch('/v1/settings', { method: 'PATCH', body: JSON.stringify({ responseMode: mode }) });
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (!usage) return error ? <div className="usage-bar usage-error" role="status">{error}</div> : null;
  const { ram, gpu, cpu, mimir, context } = usage;
  const ctxPct = pct(context.usedTokens, context.windowTokens);
  const last = context.lastReply;
  const loadedTitle = mimir.loaded.length
    ? mimir.loaded.map(m => `${m.name}: ${m.memoryGb} GB (${m.gpuGb} GB on GPU)${m.contextLength ? `, ${m.contextLength} token window` : ''}`).join('\n')
    : 'No model loaded right now';

  return (
    <div className="usage-bar" data-testid="usage-bar">
      <div className="usage-modes" role="radiogroup" aria-label="Response mode">
        {MODES.map(m => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={usage.mode === m.id}
            className={usage.mode === m.id ? 'usage-mode is-on' : 'usage-mode'}
            title={m.id === 'fast' && usage.fastModel ? `${m.hint} Uses ${usage.fastModel}.` : m.hint}
            disabled={saving}
            data-testid={`mode-${m.id}`}
            onClick={() => setMode(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>

      <Meter
        testId="usage-context"
        label="Context"
        percent={ctxPct}
        value={`${fmtTokens(context.usedTokens)} / ${fmtTokens(context.windowTokens)} tokens`}
        title={
          last
            ? `Last reply: ${last.promptTokens} tokens in, ${last.outputTokens} out${last.tokPerSec ? `, ${last.tokPerSec} tokens/s` : ''}${last.model ? ` (${last.model})` : ''}.\nWhen the chat outgrows the window, Mimir keeps the newest messages and searches the older ones.`
            : 'No reply in this chat yet.'
        }
      />
      <Meter testId="usage-ram" label="RAM" percent={pct(ram.usedGb, ram.totalGb)} value={`${ram.usedGb.toFixed(1)} / ${ram.totalGb.toFixed(1)} GB`} title="Memory used by everything on this computer" />
      {gpu && <Meter testId="usage-gpu" label="GPU" percent={pct(gpu.usedGb, gpu.totalGb)} value={`${gpu.usedGb.toFixed(1)} / ${gpu.totalGb.toFixed(1)} GB`} title={`${gpu.name}: graphics memory in use, ${gpu.percent}% busy`} />}
      <div className="usage-stat" title={`Mimir service: ${mimir.serviceGb} GB\n${loadedTitle}`} data-testid="usage-mimir">
        <span className="usage-label">Mimir</span>
        <span className="usage-value">{(mimir.serviceGb + mimir.modelsGb).toFixed(1)} GB</span>
      </div>
      {cpu.percent !== null && (
        <div className="usage-stat" title={`${cpu.threads} processor threads`}>
          <span className="usage-label">CPU</span>
          <span className="usage-value">{cpu.percent}%</span>
        </div>
      )}
      {last?.tokPerSec && (
        <div className="usage-stat" title="Speed of the last reply">
          <span className="usage-value">{last.tokPerSec} tok/s</span>
        </div>
      )}
    </div>
  );
}
