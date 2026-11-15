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
      {error && <div role="alert">Check failed: {error}</div>}
      {!report && !error && <div style={{ color: 'var(--ink-muted)' }}>Checking Ollama, Python, browser and Rust core…</div>}
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
          text: 'Well of Wisdom voice ready.',
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
        setInstallMsg(choice?.outcome === 'accepted' ? 'Mimir installed as web app.' : 'Install dismissed.');
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
        body: JSON.stringify(form),
      });
      onSaved(updated);
      await onProbeModels();
      setSavedBanner('Saved & refreshed model probe.');
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
            Providers, voice engine, approval gates, browser mode, and theme.
          </p>
        </div>

        <ModelSetupWizard settings={settings} onApplied={async updated => { onSaved(updated); await onProbeModels(); }} />

        <PreflightCard />

        <form className="card" onSubmit={handleSave}>
          <h3 className="card-title">LLM Provider & Model Routing</h3>

          <div className="grid-2">
            <label className="field-label">
              Primary Provider
              <select className="select" value={form.provider} onChange={e => setForm(f => ({ ...f, provider: e.target.value }))}>
                <option value="ollama">Local Ollama (Default)</option>
                <option value="openai-compat">OpenAI-Compatible Endpoint</option>
              </select>
            </label>
            <label className="field-label">
              Usage Review Approval Policy
              <select className="select" value={form.approvalPolicy} onChange={e => setForm(f => ({ ...f, approvalPolicy: e.target.value }))}>
                <option value="ask-writes">Ask on mutating writes / shell (Recommended)</option>
                <option value="reversibility">Reversibility: drafts and research run alone, irreversible actions ask</option>
                <option value="always-ask">Always ask before every tool</option>
                <option value="auto-approve">Auto-approve all local tools</option>
              </select>
            </label>
          </div>

          <div className="grid-2">
            <label className="field-label">
              Ollama Base URL
              <input className="input" value={form.ollamaUrl || ''} onChange={e => setForm(f => ({ ...f, ollamaUrl: e.target.value }))} />
            </label>
            <label className="field-label">
              Ollama Model
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
              Enable Ollama reasoning traces
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={form.enableFallback !== false} onChange={e => setForm(f => ({ ...f, enableFallback: e.target.checked }))} />
              Fallback to OpenAI-compatible
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" data-testid="local-only-checkbox" checked={Boolean(form.localOnly)} onChange={e => setForm(f => ({ ...f, localOnly: e.target.checked }))} />
              Local-only mode
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
              Static Mimir Avatar (Reduced Motion)
            </label>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--sand-border)', width: '100%' }} />

          <h3 className="card-title">OpenAI-Compatible Fallback</h3>
          <div className="grid-2">
            <label className="field-label">
              Base URL
              <input className="input" value={form.openaiBaseUrl || ''} onChange={e => setForm(f => ({ ...f, openaiBaseUrl: e.target.value }))} />
            </label>
            <label className="field-label">
              Model ID
              <input className="input" value={form.openaiModel || ''} onChange={e => setForm(f => ({ ...f, openaiModel: e.target.value }))} />
            </label>
          </div>
          <label className="field-label">
            API Key (stored in local vault)
            <input
              type="password"
              className="input"
              autoComplete="off"
              placeholder={form.hasOpenaiApiKey ? 'Key saved. Enter new key to replace.' : ''}
              value={form.openaiApiKey || ''}
              onChange={e => setForm(f => ({ ...f, openaiApiKey: e.target.value }))}
            />
          </label>

          <hr style={{ border: 'none', borderTop: '1px solid var(--sand-border)', width: '100%' }} />

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <h3 className="card-title" style={{ margin: 0 }}>Voice Engine &amp; Live Duplex Audio</h3>
            <div className="chip-list">
              <span className="status-pill" data-testid="voice-status-sapi">
                SAPI5: {voiceStatus ? (voiceStatus.sapiOffline ? 'Ready' : 'Unavailable') : '...'}
              </span>
              <span className="status-pill" data-testid="voice-status-stt">
                Whisper STT: {voiceStatus ? (voiceStatus.fasterWhisper ? 'Ready' : 'Unavailable') : '...'}
              </span>
              <span className="status-pill">
                Neural: {voiceStatus ? (voiceStatus.edgeTts ? 'Available' : 'Auto/Fallback') : '...'}
              </span>
            </div>
          </div>

          <div className="grid-2">
            <label className="field-label">
              Voice Engine
              <select
                className="select"
                data-testid="settings-voice-engine"
                value={form.voiceEngine || 'auto'}
                onChange={e => setForm(f => ({ ...f, voiceEngine: e.target.value }))}
              >
                <option value="auto">Auto (Neural Edge-TTS -&gt; Offline SAPI5)</option>
                <option value="sapi">Offline Only (Windows SAPI5)</option>
                <option value="neural">Neural (Edge-TTS)</option>
              </select>
            </label>
            <label className="field-label">
              Voice Speaker
              <select
                className="select"
                data-testid="settings-voice-id"
                value={form.voiceName || form.voiceId || 'en-GB-RyanNeural'}
                onChange={e => setForm(f => ({ ...f, voiceName: e.target.value, voiceId: e.target.value }))}
              >
                {(voiceStatus?.voices?.length
                  ? voiceStatus.voices
                  : [
                      { id: 'en-GB-RyanNeural', label: 'Mimir Neural (en-GB-RyanNeural)' },
                      { id: 'david-sapi', label: 'Mimir Offline (SAPI5 David)' },
                      { id: 'zira-sapi', label: 'Freya Offline (SAPI5 Zira)' },
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
              Test Voice
            </button>
            <button type="button" className="btn btn-sm" onClick={loadVoiceStatus}>
              Refresh Voice Status
            </button>
            {voiceTestState && <span style={{ fontSize: 12, color: 'var(--frost)' }}>{voiceTestState}</span>}
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--sand-border)', width: '100%' }} />

          <h3 className="card-title">Slack / Teams Outbound Webhooks & Theme</h3>
          <div className="grid-2">
            <label className="field-label">
              Slack Incoming Webhook URL
              <input className="input" placeholder="https://hooks.slack.com/services/..." value={form.slackWebhookUrl || ''} onChange={e => setForm(f => ({ ...f, slackWebhookUrl: e.target.value }))} />
            </label>
            <label className="field-label">
              Microsoft Teams Webhook URL
              <input className="input" placeholder="https://outlook.office.com/webhook/..." value={form.teamsWebhookUrl || ''} onChange={e => setForm(f => ({ ...f, teamsWebhookUrl: e.target.value }))} />
            </label>
          </div>

          <div className="grid-2">
            <label className="field-label">
              Theme
              <select className="select" value={form.themePreference || 'dark'} onChange={e => setForm(f => ({ ...f, themePreference: e.target.value }))}>
                <option value="dark">Charcoal Basalt Dark</option>
                <option value="light">Warm Parchment Light</option>
              </select>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, paddingTop: 18 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={form.soundEffects !== false} onChange={e => setForm(f => ({ ...f, soundEffects: e.target.checked }))} />
                Play subtle audio chime on task completion / approval needed
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  type="checkbox"
                  data-testid="reduced-motion-checkbox"
                  checked={Boolean(form.reducedMotion)}
                  onChange={e => setForm(f => ({ ...f, reducedMotion: e.target.checked }))}
                />
                Reduce motion &amp; pixel glitch animations (accessibility)
              </label>
            </div>
          </div>

          <hr style={{ border: 'none', borderTop: '1px solid var(--rule)', width: '100%' }} />

          <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <MimirAsset category="artifacts" name="bifrost-portal" size={18} />
            <span>Browser Engine & Vertical/Horizontal Scaling</span>
          </h3>
          <div className="grid-3">
            <label className="field-label">
              Agentic Browser Mode
              <select className="select" value={form.browserMode || 'embedded'} onChange={e => setForm(f => ({ ...f, browserMode: e.target.value }))}>
                <option value="embedded">Embedded Headless Chromium</option>
                <option value="user-computer">Own Computer (Chrome/Edge Window or CDP)</option>
                <option value="free-cloud">Free Zero-Payment Cloud / WS Relay</option>
              </select>
            </label>
            <label className="field-label">
              Own Computer CDP Port URL
              <input className="input" placeholder="http://127.0.0.1:9222" value={form.userCdpUrl || ''} onChange={e => setForm(f => ({ ...f, userCdpUrl: e.target.value }))} />
            </label>
            <label className="field-label">
              Free Cloud / WS Endpoint URL
              <input className="input" placeholder="ws://..." value={form.cloudBrowserWsUrl || ''} onChange={e => setForm(f => ({ ...f, cloudBrowserWsUrl: e.target.value }))} />
            </label>
          </div>

          <div className="grid-2">
            <label className="field-label">
              Max Concurrent Worker Tasks (Vertical Scale)
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
              Rate Limit Per Minute (Token Bucket)
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
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
            <button type="button" className="btn" onClick={onProbeModels}>
              Probe Models
            </button>
            {canInstallPwa && (
              <button type="button" className="btn" data-testid="install-pwa-btn" onClick={handleInstallPwa}>
                Install Web App
              </button>
            )}
            {installMsg && <span style={{ color: 'var(--frost)', fontSize: 12.5 }}>{installMsg}</span>}
            {savedBanner && <span style={{ color: 'var(--sand-green)', fontSize: 12.5 }}>{savedBanner}</span>}
          </div>

          <div className="code-block" style={{ fontSize: 12 }}>
            Ollama: {modelStatus?.ollama?.ok ? `Connected (${modelStatus.ollama.models.join(', ') || 'no models'})` : `Offline (${modelStatus?.ollama?.error || 'not probed'})`}
            {'\n'}
            OpenAI-Compat: {modelStatus?.openai?.ok ? `Connected (${modelStatus.openai.models.slice(0, 6).join(', ')})` : `Unavailable (${modelStatus?.openai?.error || 'not configured'})`}
          </div>
        </form>
      </div>
    </div>
  );
}
