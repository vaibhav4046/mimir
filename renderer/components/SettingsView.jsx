import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { MimirAsset } from './MimirAsset.jsx';
import { ModelSetupWizard } from './ModelSetupWizard.jsx';

/** Shows which optional runtimes this machine has, with the exact command to add a missing one. */
function PreflightCard() {
  const [report, setReport] = useState(null);
  const [error, setError] = useState('');
  const check = async () => {
    setReport(null);
    setError('');
    try {
      setReport(await apiFetch('/v1/preflight'));
    } catch (err) {
      setError(err.message);
    }
  };
  useEffect(() => {
    check();
  }, []);

  return (
    <div className="card" data-testid="preflight-card">
      <h3 className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>This computer</span>
        <button type="button" className="btn btn-sm" onClick={check}>Check again</button>
      </h3>
      {error && <div role="alert">Could not check: {error}</div>}
      {!report && !error && <div style={{ color: 'var(--ink-muted)' }}>Checking what is installed on this computer…</div>}
      {report?.checks.map(c => (
        <div key={c.id} data-testid={`preflight-${c.id}`} data-ok={c.ok} style={{ fontSize: 12.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span>
            <strong style={{ color: c.ok ? 'var(--frost-hi, #a9eeff)' : 'var(--gold, #e6ab42)' }}>{c.ok ? 'Ready' : 'Needs setup'}</strong> · {c.detail}
          </span>
          {c.fix && <code className="code-block" style={{ fontSize: 11.5 }}>{c.fix}</code>}
        </div>
      ))}
    </div>
  );
}


/** Optional HydraDB-backed tool memory: the agent is offered only the tools a graph pulls for the request. */
function ContextGraphCard({ settings, onSaved }) {
  const cg = settings?.contextGraph || { enabled: false, url: 'http://127.0.0.1:18443' };
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => {
    try {
      setStatus(await apiFetch('/v1/context-graph/status'));
    } catch {
      setStatus(null);
    }
  };
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, []);
  const toggle = async () => {
    setBusy(true);
    setError('');
    try {
      const saved = await apiFetch('/v1/settings', { method: 'PATCH', body: JSON.stringify({ contextGraph: { ...cg, enabled: !cg.enabled } }) });
      onSaved?.(saved);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };
  const pull = status?.lastPull;
  return (
    <div className="card" data-testid="context-graph-card">
      <h3 className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>Tool memory (HydraDB)</span>
        <button type="button" className="btn btn-sm" data-testid="context-graph-toggle" disabled={busy} onClick={toggle}>{cg.enabled ? 'Turn off' : 'Turn on'}</button>
      </h3>
      <div style={{ fontSize: 12.5, color: 'var(--ink-muted)' }}>
        Instead of showing the model every tool on every request, Mimir keeps a graph of what each tool does in a HydraDB node on this PC, offers only the few a request needs, and learns from the tools that really worked. If HydraDB is unreachable or unsure, Mimir offers every tool as usual.
      </div>
      {error && <div role="alert">Could not change it: {error}</div>}
      <div data-testid="context-graph-status" style={{ fontSize: 12.5, marginTop: 6 }}>
        <strong>{cg.enabled ? (status?.connected ? 'On, connected to HydraDB' : status?.failures ? 'On, waiting for HydraDB (using every tool meanwhile)' : 'On, connects on the next request') : 'Off'}</strong>
        {pull && !pull.error && pull.pulled != null && (
          <span> · last request: offered {pull.pulled} of {pull.of} tools in {Math.round(pull.ms)} ms{pull.tools?.length ? ' (' + pull.tools.join(', ') + ')' : ''}{pull.learnedFrom?.length ? ' · learned from ' + pull.learnedFrom.join(', ') : ''}</span>
        )}
        {pull?.error && <span> · last error: {pull.error}</span>}
      </div>
    </div>
  );
}

export function SettingsView({ settings, modelStatus, onSaved, onProbeModels }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);
  const [savedBanner, setSavedBanner] = useState('');
  const [voiceStatus, setVoiceStatus] = useState(null);
  const [voiceTestState, setVoiceTestState] = useState('');
  const [canInstallPwa, setCanInstallPwa] = useState(() =>
    Boolean(typeof navigator.install === 'function' || window.__mimirDeferredInstallPrompt)
  );
  const [installMsg, setInstallMsg] = useState('');

  const loadVoiceStatus = async () => {
    try {
      setVoiceStatus(await apiFetch('/v1/voice/status'));
    } catch {
      setVoiceStatus({ ok: false, voices: [] });
    }
  };

  useEffect(() => {
    setForm(settings);
  }, [settings]);

  useEffect(() => {
    loadVoiceStatus();
  }, []);

  const handleTestVoice = async () => {
    setVoiceTestState('Playing...');
    try {
      const effectiveEngine = form.localOnly ? 'sapi' : (form.voiceEngine || 'auto');
      const out = await apiFetch('/v1/voice/tts?format=json', {
        method: 'POST',
        body: JSON.stringify({
          text: 'Mimir voice is ready.',
          engine: effectiveEngine,
          voice: form.voiceName || form.voiceId || (effectiveEngine === 'sapi' ? 'david-sapi' : 'en-GB-RyanNeural'),
        }),
      });
      const audio = new Audio(`data:${out.mime};base64,${out.audioBase64}`);
      audio.onended = () => setVoiceTestState(`OK (${out.engine || effectiveEngine})`);
      await audio.play();
    } catch (err) {
      setVoiceTestState(`Error: ${err.message}`);
    }
  };

  useEffect(() => {
    const syncInstall = () => {
      setCanInstallPwa(Boolean(typeof navigator.install === 'function' || window.__mimirDeferredInstallPrompt));
    };
    window.addEventListener('beforeinstallprompt', syncInstall);
    return () => window.removeEventListener('beforeinstallprompt', syncInstall);
  }, []);

  const handleInstallPwa = async () => {
    setInstallMsg('');
    try {
      if (typeof navigator.install === 'function') {
        await navigator.install();
        setInstallMsg('Install requested.');
        return;
      }
      const promptEvt = window.__mimirDeferredInstallPrompt;
      if (promptEvt?.prompt) {
        promptEvt.prompt();
        const choice = await promptEvt.userChoice;
        window.__mimirDeferredInstallPrompt = null;
        setCanInstallPwa(typeof navigator.install === 'function');
        setInstallMsg(choice?.outcome === 'accepted' ? 'Mimir installed as an app.' : 'Install cancelled.');
      }
    } catch (err) {
      setInstallMsg(err.message || 'Install unavailable.');
    }
  };

  const handleSave = async e => {
    e.preventDefault();
    setSaving(true);
    setSavedBanner('');
    try {
      const updated = await apiFetch('/v1/settings', {
        method: 'PATCH',
        // The tool-memory card owns contextGraph; a stale copy here would undo its toggle.
        body: JSON.stringify((({ contextGraph, ...rest }) => rest)(form)),
      });
      onSaved(updated);
      await onProbeModels();
      setSavedBanner('Saved. AI models checked.');
    } catch (err) {
      setSavedBanner(`Could not save: ${err?.message || 'Unknown error'}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="view-scroll" data-testid="settings-view">
      <div className="view-container">
        <div>
          <h2 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirAsset category="artifacts" name="dwarven-gear" size={22} />
            <span>Settings</span>
          </h2>
          <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
            Choose your AI model, voice, when Mimir asks for your OK, web browsing, and how the app looks.
          </p>
        </div>

        <ModelSetupWizard settings={settings} onApplied={async updated => { onSaved(updated); await onProbeModels(); }} />

        <PreflightCard />
        <ContextGraphCard settings={settings} onSaved={onSaved} />

        <form className="card" onSubmit={handleSave}>
          <h3 className="card-title">AI model</h3>

          <div className="grid-2">
            <label className="field-label">
              Main AI model
              <select className="select" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}>
                <option value="ollama">Ollama, the free app that runs AI on this computer (default)</option>
                <option value="openai-compat">Online AI service (your own access key)</option>
              </select>
            </label>
            <label className="field-label">
              When to ask for your OK
              <select className="select" value={form.approvalPolicy} onChange={e => setForm(f => ({ ...f, approvalPolicy: e.target.value }))}>
                <option value="ask-writes">Before changing files or running programs (recommended)</option>
                <option value="reversibility">Only before things that cannot be undone</option>
                <option value="always-ask">Before every action</option>
                <option value="auto-approve">Never ask for actions on this computer</option>
              </select>
            </label>
          </div>

          <div className="grid-2">
            <label className="field-label">
              Ollama address
              <input className="input" value={form.ollamaUrl || ''} onChange={e => setForm(f => ({ ...f, ollamaUrl: e.target.value }))} />
            </label>
            <label className="field-label">
              Ollama model
              <input
                className="input"
                list="ollama-models-list"
                value={form.ollamaModel || ''}
                onChange={e => setForm(f => ({ ...f, ollamaModel: e.target.value }))}
              />
              <datalist id="ollama-models-list">
                {(modelStatus?.ollama?.models || []).map(m => (
                  <option key={m} value={m} />
                ))}
              </datalist>
            </label>
          </div>

          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={Boolean(form.ollamaThink)} onChange={e => setForm(f => ({ ...f, ollamaThink: e.target.checked }))} />
              Show the model's thinking steps
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.enableFallback !== false} onChange={e => setForm(f => ({ ...f, enableFallback: e.target.checked }))} />
              Use the backup cloud model if Ollama fails
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" data-testid="local-only-checkbox" checked={Boolean(form.localOnly)} onChange={e => setForm(f => ({ ...f, localOnly: e.target.checked }))} />
              Keep everything on this computer (no cloud)
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                data-testid="static-avatar-checkbox"
                checked={Boolean(form.staticAvatar)}
                onChange={async e => {
                  const next = e.target.checked;
                  const optimistic = { ...form, staticAvatar: next };
                  try { window.localStorage?.setItem('mimir-static-avatar', next ? 'true' : 'false'); } catch {}
                  setForm(optimistic);
                  onSaved?.(optimistic);
                  try {
                    const updated = await apiFetch('/v1/settings', {
                      method: 'PATCH',
                      body: JSON.stringify({ staticAvatar: next }),
                    });
                    onSaved?.(updated);
                  } catch {
                    // keep optimistic state on transient error
                  }
                }}
              />
              Still Mimir picture (no animation)
            </label>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--sand-border)', width: '100%' }} />

          <h3 className="card-title">Backup cloud model</h3>
          <div className="grid-2">
            <label className="field-label">
              Service address
              <input className="input" value={form.openaiBaseUrl || ''} onChange={e => setForm(f => ({ ...f, openaiBaseUrl: e.target.value }))} />
            </label>
            <label className="field-label">
              Model name
              <input className="input" value={form.openaiModel || ''} onChange={e => setForm(f => ({ ...f, openaiModel: e.target.value }))} />
            </label>
          </div>
          <label className="field-label">
            Access key (kept locked on this computer)
            <input
              type="password"
              className="input"
              autoComplete="off"
              placeholder={form.hasOpenaiApiKey ? 'Key saved. Type a new one to replace it.' : ''}
              value={form.openaiApiKey || ''}
              onChange={e => setForm(f => ({ ...f, openaiApiKey: e.target.value }))}
            />
          </label>

          <hr style={{ border: 'none', borderTop: '1px solid var(--sand-border)', width: '100%' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 className="card-title" style={{ margin: 0 }}>Voice</h3>
            <div className="chip-list">
              <span className="status-pill" data-testid="voice-status-sapi">
                Offline voice: {voiceStatus ? (voiceStatus.sapiOffline ? 'Ready' : 'Not available') : '...'}
              </span>
              <span className="status-pill" data-testid="voice-status-stt">
                Listening: {voiceStatus ? (voiceStatus.fasterWhisper ? 'Ready' : 'Not available') : '...'}
              </span>
              <span className="status-pill">
                Natural voice: {voiceStatus ? (voiceStatus.edgeTts ? 'Ready' : 'Not confirmed') : '...'}
              </span>
            </div>
          </div>

          <div className="grid-2">
            <label className="field-label">
              Voice type
              <select
                className="select"
                data-testid="settings-voice-engine"
                value={form.voiceEngine || 'auto'}
                onChange={e => setForm(f => ({ ...f, voiceEngine: e.target.value }))}
              >
                <option value="auto">Automatic (natural voice, offline voice if needed)</option>
                <option value="sapi">Offline only (built into Windows)</option>
                <option value="neural">Natural voice (needs internet)</option>
              </select>
            </label>
            <label className="field-label">
              Speaker
              <select
                className="select"
                data-testid="settings-voice-id"
                value={form.voiceName || form.voiceId || 'en-GB-RyanNeural'}
                onChange={e => setForm(f => ({ ...f, voiceName: e.target.value, voiceId: e.target.value }))}
              >
                {(voiceStatus?.voices?.length
                  ? voiceStatus.voices
                  : [
                      { id: 'en-GB-RyanNeural', label: 'Mimir (natural voice)' },
                      { id: 'david-sapi', label: 'Mimir (offline voice)' },
                      { id: 'zira-sapi', label: 'Freya (offline voice)' },
                    ]
                ).map(v => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-sm" onClick={handleTestVoice}>
              Play test
            </button>
            <button type="button" className="btn btn-sm" onClick={loadVoiceStatus}>
              Check voice again
            </button>
            {voiceTestState && <span style={{ fontSize: 12, color: 'var(--frost)' }}>{voiceTestState}</span>}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--sand-border)', width: '100%' }} />

          <h3 className="card-title">Notifications &amp; appearance</h3>
          <div className="grid-2">
            <label className="field-label">
              Slack message link
              <input className="input" placeholder="https://hooks.slack.com/services/..." value={form.slackWebhookUrl || ''} onChange={e => setForm(f => ({ ...f, slackWebhookUrl: e.target.value }))} />
            </label>
            <label className="field-label">
              Microsoft Teams message link
              <input className="input" placeholder="https://outlook.office.com/webhook/..." value={form.teamsWebhookUrl || ''} onChange={e => setForm(f => ({ ...f, teamsWebhookUrl: e.target.value }))} />
            </label>
          </div>

          <div className="grid-2">
            <label className="field-label">
              Colors
              <select className="select" value={form.themePreference || 'dark'} onChange={e => setForm(f => ({ ...f, themePreference: e.target.value }))}>
                <option value="dark">Dark</option>
                <option value="light">Light</option>
              </select>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 18 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={form.soundEffects !== false} onChange={e => setForm(f => ({ ...f, soundEffects: e.target.checked }))} />
                Play a soft chime when a task finishes or needs your OK
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  data-testid="reduced-motion-checkbox"
                  checked={Boolean(form.reducedMotion)}
                  onChange={e => setForm(f => ({ ...f, reducedMotion: e.target.checked }))}
                />
                Reduce motion and flashing effects
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  data-testid="developer-tools-checkbox"
                  checked={Boolean(form.showDeveloperTools)}
                  onChange={async e => {
                    const next = e.target.checked;
                    const optimistic = { ...form, showDeveloperTools: next };
                    setForm(optimistic);
                    onSaved?.(optimistic);
                    try {
                      const updated = await apiFetch('/v1/settings', {
                        method: 'PATCH',
                        body: JSON.stringify({ showDeveloperTools: next }),
                      });
                      onSaved?.(updated);
                    } catch {
                      // keep optimistic state on transient error
                    }
                  }}
                />
                Show developer tools (feature tour, model lab, system checks)
              </label>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--rule)', width: '100%' }} />

          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirAsset category="artifacts" name="bifrost-portal" size={18} />
            <span>Web browsing &amp; speed</span>
          </h3>
          <div className="grid-3">
            <label className="field-label">
              Where Mimir browses the web
              <select className="select" value={form.browserMode || 'embedded'} onChange={e => setForm(f => ({ ...f, browserMode: e.target.value }))}>
                <option value="embedded">Hidden built-in browser (default)</option>
                <option value="user-computer">Your own Chrome or Edge window</option>
                <option value="free-cloud">Free online browser</option>
              </select>
            </label>
            <label className="field-label">
              Your browser's control address (advanced, for Chrome or Edge)
              <input className="input" placeholder="http://127.0.0.1:9222" value={form.userCdpUrl || ''} onChange={e => setForm(f => ({ ...f, userCdpUrl: e.target.value }))} />
            </label>
            <label className="field-label">
              Online browser address (advanced)
              <input className="input" placeholder="ws://..." value={form.cloudBrowserWsUrl || ''} onChange={e => setForm(f => ({ ...f, cloudBrowserWsUrl: e.target.value }))} />
            </label>
          </div>

          <div className="grid-2">
            <label className="field-label">
              Tasks at the same time
              <input
                type="number"
                min={1}
                max={8}
                className="input"
                value={form.maxConcurrentTasks ?? 3}
                onChange={e => setForm(f => ({ ...f, maxConcurrentTasks: Number(e.target.value) || 3 }))}
              />
            </label>
            <label className="field-label">
              Most AI requests per minute
              <input
                type="number"
                min={4}
                max={300}
                className="input"
                value={form.rateLimitPerMinute ?? 40}
                onChange={e => setForm(f => ({ ...f, rateLimitPerMinute: Number(e.target.value) || 40 }))}
              />
            </label>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
            <button type="button" className="btn" onClick={onProbeModels}>
              Check models
            </button>
            {canInstallPwa && (
              <button type="button" className="btn" data-testid="install-pwa-btn" onClick={handleInstallPwa}>
                Install as app
              </button>
            )}
            {installMsg && <span style={{ color: 'var(--frost)', fontSize: 12.5 }}>{installMsg}</span>}
            {savedBanner && <span style={{ color: 'var(--sand-green)', fontSize: 12.5 }}>{savedBanner}</span>}
          </div>

          <div className="code-block" style={{ fontSize: 12 }}>
            Ollama: {modelStatus?.ollama?.ok ? `Connected (${modelStatus.ollama.models.join(', ') || 'no models'})` : `Not running (${modelStatus?.ollama?.error || 'not checked yet'})`}
            {'\n'}
            Backup cloud model: {modelStatus?.openai?.ok ? `Connected (${modelStatus.openai.models.slice(0, 6).join(', ')})` : `Not available (${modelStatus?.openai?.error || 'not set up'})`}
          </div>
        </form>
      </div>
    </div>
  );
}
