import React, { useEffect, useState } from 'react';
import { apiFetch } from '../api.js';
import { ForgeAnvilSvg } from './Icons.jsx';
import { BotAvatar } from './BotAvatar.jsx';
import { MimirAsset } from './MimirAsset.jsx';

const Q1_DOMAIN_OPTIONS = [
  'Software Engineering & Code',
  'Research, Docs & Briefs',
  'Browser Ops & Web Scraping',
  'Local System Ops & Logs',
  'Content, Email & Team Updates',
];

const Q2_TASK_MAP = {
  'Software Engineering & Code': [
    'Run test suites & diagnose failures',
    'Inspect repo files & summarize architecture',
    'Scaffold scripts & automate builds',
  ],
  'Research, Docs & Briefs': [
    'Synthesize local markdown notes & specs',
    'Compare sources & save structured briefs',
    'Maintain persistent key-value memory base',
  ],
  'Browser Ops & Web Scraping': [
    'Open target URLs & capture live screenshots',
    'Extract structured text from web dashboards',
    'Automate form clicks & page navigation',
  ],
  'Local System Ops & Logs': [
    'Inspect workspace folders & parse logs',
    'Run periodic CLI health checks',
    'Organize & clean up workspace artifacts',
  ],
  'Content, Email & Team Updates': [
    'Draft concise status digests for Slack/Teams',
    'Generate changelogs & release notes',
    'Triage pasted notes into action checklists',
  ],
};

const Q3_TOOL_OPTIONS = [
  { id: 'shell', label: 'Run programs and terminal commands on this computer' },
  { id: 'fs', label: 'Read and save files in its work folder' },
  { id: 'browser', label: 'Open websites and use the web browser' },
  { id: 'memory', label: 'Remember facts across chats (memory)' },
  { id: 'vault', label: 'Use saved passwords from your locked list (vault)' },
];

const Q4_SCHEDULE_OPTIONS = [
  'Start the first task right now in Chat',
  'Run hourly (every hour)',
  'Run daily (once a day)',
  'Send updates to Slack',
  'Send updates to Microsoft Teams',
];

function TickCard({ label, checked, onToggle }) {
  return (
    <label className={`tick-card ${checked ? 'checked' : ''}`}>
      <input type="checkbox" className="pixel-checkbox" checked={checked} onChange={onToggle} />
      <span style={{ fontSize: 12.5, fontWeight: checked ? 700 : 500 }}>{label}</span>
    </label>
  );
}

export function ForgeView({ onBotForged }) {
  const [scannedFiles, setScannedFiles] = useState([]);
  const [selectedLocalPaths, setSelectedLocalPaths] = useState([]);
  const [sourceApp, setSourceApp] = useState('claude');
  const [pasteText, setPasteText] = useState('');
  const [importedChunks, setImportedChunks] = useState([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [proposal, setProposal] = useState(null);
  const [createRoutine, setCreateRoutine] = useState(true);
  const [runNow, setRunNow] = useState(true);
  const [error, setError] = useState('');

  // 4-Question Interactive Follow-Up Tick-Box Wizard (triggered when no memory)
  const [wizardActive, setWizardActive] = useState(false);
  const [wizardStep, setWizardStep] = useState(1);
  const [q1Domains, setQ1Domains] = useState([]);
  const [q2Tasks, setQ2Tasks] = useState([]);
  const [q3Tools, setQ3Tools] = useState([Q3_TOOL_OPTIONS[1].label, Q3_TOOL_OPTIONS[3].label]);
  const [q4Schedule, setQ4Schedule] = useState([Q4_SCHEDULE_OPTIONS[0]]);
  const [botName, setBotName] = useState('My Helper');
  const [customNote, setCustomNote] = useState('');
  const [forging, setForging] = useState(false);

  const scanLocal = async () => {
    try {
      const res = await apiFetch('/v1/memory-import/scan');
      setScannedFiles(res.files || []);
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    scanLocal();
  }, []);

  const toggleArr = (setter, value) => {
    setter(prev => (prev.includes(value) ? prev.filter(x => x !== value) : [...prev, value]));
  };

  const handleUploadExport = async evt => {
    const file = evt.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const parsed = await apiFetch('/v1/memory-import/parse', {
      method: 'POST',
      body: JSON.stringify({ source: sourceApp, filename: file.name, text }),
    });
    if (parsed.items?.length) {
      setImportedChunks(prev => [...prev, parsed]);
    }
    evt.target.value = '';
  };

  const handleAddPasted = async () => {
    if (!pasteText.trim()) return;
    const parsed = await apiFetch('/v1/memory-import/parse', {
      method: 'POST',
      body: JSON.stringify({ source: sourceApp, filename: `${sourceApp}-notes.txt`, text: pasteText }),
    });
    if (parsed.items?.length) {
      setImportedChunks(prev => [...prev, parsed]);
      setPasteText('');
    }
  };

  const handleAnalyze = async () => {
    setError('');
    setAnalyzing(true);
    try {
      const localItems = [];
      for (const p of selectedLocalPaths) {
        const res = await apiFetch('/v1/memory-import/read-local', {
          method: 'POST',
          body: JSON.stringify({ path: p }),
        });
        if (res.items?.length) localItems.push(res);
      }

      let allImported = [...importedChunks, ...localItems];
      if (pasteText.trim()) {
        const inline = await apiFetch('/v1/memory-import/parse', {
          method: 'POST',
          body: JSON.stringify({ source: sourceApp, filename: `${sourceApp}-pasted.txt`, text: pasteText }),
        });
        if (inline.items?.length) allImported.push(inline);
      }

      if (allImported.length === 0) {
        // No memory provided -> open 4-question follow-up tick wizard
        setProposal(null);
        setWizardActive(true);
        setWizardStep(1);
        return;
      }

      const analysis = await apiFetch('/v1/memory-import/analyze', {
        method: 'POST',
        body: JSON.stringify({ importedItems: allImported }),
      });

      if (analysis.needsQuestions || !analysis.hasMemory) {
        setProposal(null);
        setWizardActive(true);
        setWizardStep(1);
      } else {
        setWizardActive(false);
        setProposal(analysis);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  const forgeFromProposal = async () => {
    if (!proposal?.proposedBot) return;
    setForging(true);
    setError('');
    try {
      const res = await apiFetch('/v1/forge/create', {
        method: 'POST',
        body: JSON.stringify({
          botConfig: {
            name: proposal.proposedBot.name,
            role: proposal.proposedBot.role,
            shape: proposal.proposedBot.shape || 'leviathan',
            color: proposal.proposedBot.color || '#5cc8ff',
            tools: proposal.proposedBot.tools,
            systemPrompt: proposal.proposedBot.systemPrompt,
          },
          memories: proposal.extractedMemories || [],
          routineConfig: createRoutine
            ? {
                name: proposal.proposedBot.routineName || `${proposal.proposedBot.name} Routine`,
                prompt: proposal.proposedBot.routinePrompt,
                intervalMinutes: proposal.proposedBot.intervalMinutes || 60,
                enabled: true,
              }
            : null,
          runStarterPrompt: runNow ? proposal.proposedBot.routinePrompt : null,
        }),
      });
      await onBotForged(res.bot.id, res.startedThreadId);
    } catch (err) {
      setError(err.message);
    } finally {
      setForging(false);
    }
  };

  const finishWizard = async () => {
    setForging(true);
    setError('');
    try {
      const res = await apiFetch('/v1/forge/from-answers', {
        method: 'POST',
        body: JSON.stringify({
          runImmediately: true,
          answers: {
            q1Domains: q1Domains.length ? q1Domains : ['Software Engineering & Code'],
            q2Tasks: q2Tasks.length ? q2Tasks : ['Inspect workspace & summarize status'],
            q3Tools,
            q4Schedule,
            botName,
            customNote,
          },
        }),
      });
      setWizardActive(false);
      await onBotForged(res.bot.id, res.startedThreadId);
    } catch (err) {
      setError(err.message);
    } finally {
      setForging(false);
    }
  };

  const dynamicQ2Options = (q1Domains.length ? q1Domains : Q1_DOMAIN_OPTIONS.slice(0, 2))
    .flatMap(d => Q2_TASK_MAP[d] || []);

  return (
    <div className="view-scroll" data-testid="forge-view">
      <div className="view-container">
        <div>
          <h2 style={{ margin: '0 0 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <ForgeAnvilSvg size={18} />
            <span>Import memory &amp; set up a helper</span>
          </h2>
          <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
            Bring in notes or instructions from Claude, Antigravity, or ChatGPT so Mimir can set up a helper for you — or just answer 4 quick questions.
          </p>
        </div>

        {error && (
          <div className="tool-card" style={{ borderColor: 'var(--sand-red)', color: '#ff9c78' }}>
            {error}
          </div>
        )}

        {!wizardActive && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <h3 className="card-title">1. Import notes from another AI app</h3>
              <button type="button" className="btn btn-sm" onClick={scanLocal}>
                Scan this computer again
              </button>
            </div>

            {scannedFiles.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--sand-text-muted)', marginBottom: 6 }}>
                  Found AI notes on this computer:
                </div>
                <div className="tick-grid">
                  {scannedFiles.map(f => (
                    <TickCard
                      key={f.path}
                      label={`[${f.source.toUpperCase()}] ${f.name}`}
                      checked={selectedLocalPaths.includes(f.path)}
                      onToggle={() => toggleArr(setSelectedLocalPaths, f.path)}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="grid-2">
              <label className="field-label">
                Which app is this from?
                <select className="select" value={sourceApp} onChange={e => setSourceApp(e.target.value)}>
                  <option value="claude">Claude</option>
                  <option value="antigravity">Antigravity</option>
                  <option value="chatgpt">ChatGPT</option>
                  <option value="custom">Other AI or personal notes</option>
                </select>
              </label>
              <div className="field-label">
                <span>Upload a file (.json, .md, .txt)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 8px', background: 'var(--bg-surface)', border: '1px solid var(--rule)', borderRadius: 2 }}>
                  <input id="forge-export-upload" type="file" accept=".json,.md,.txt,.csv" style={{ display: 'none' }} onChange={handleUploadExport} />
                  <label htmlFor="forge-export-upload" className="btn btn-sm">
                    Choose file
                  </label>
                  <span style={{ fontSize: 12, color: 'var(--ink-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {importedChunks[0]?.filename || 'No file chosen yet'}
                  </span>
                </div>
              </div>
            </div>

            <label className="field-label">
              Or paste notes or instructions here
              <textarea
                className="textarea"
                rows={4}
                placeholder="Paste your Claude notes, Antigravity rules, or ChatGPT instructions here..."
                value={pasteText}
                onChange={e => setPasteText(e.target.value)}
              />
            </label>

            {importedChunks.length > 0 && (
              <div className="chip-list">
                {importedChunks.map((ch, idx) => (
                  <span key={idx} className="chip">
                    {ch.source.toUpperCase()}: {ch.filename} ({ch.items.length} snippets)
                  </span>
                ))}
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {pasteText.trim() && (
                <button type="button" className="btn" onClick={handleAddPasted}>
                  Add pasted text
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                data-testid="analyze-memory-btn"
                disabled={analyzing}
                onClick={handleAnalyze}
              >
                {analyzing ? 'Reading notes...' : 'Read notes & suggest a helper'}
              </button>
              <button
                type="button"
                className="btn btn-gold"
                data-testid="start-4q-wizard-btn"
                onClick={() => {
                  setProposal(null);
                  setWizardActive(true);
                  setWizardStep(1);
                }}
              >
                No notes? Answer 4 questions
              </button>
            </div>
          </div>
        )}

        {proposal?.hasMemory && !wizardActive && (
          <div className="card" data-testid="forge-proposal-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <BotAvatar bot={proposal.proposedBot} shape={proposal.proposedBot.shape} color={proposal.proposedBot.color} size={40} />
                <div>
                  <h3 className="card-title">{proposal.proposedBot.name}</h3>
                  <div style={{ fontSize: 12, color: 'var(--sand-text-muted)' }}>
                    {proposal.proposedBot.role} • Analyzed via {proposal.analyzedBy}
                  </div>
                </div>
              </div>
            </div>

            <div className="code-block">{proposal.summary}</div>

            <div className="chip-list">
              {(proposal.detectedDomains || []).map((d, i) => (
                <span key={i} className="chip" style={{ borderColor: 'var(--sand-gold)', color: 'var(--sand-gold)' }}>
                  {d}
                </span>
              ))}
            </div>

            <div className="grid-2">
              <TickCard
                label="Run this on a schedule"
                checked={createRoutine}
                onToggle={() => setCreateRoutine(v => !v)}
              />
              <TickCard
                label="Run the first task right away in Chat"
                checked={runNow}
                onToggle={() => setRunNow(v => !v)}
              />
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="confirm-forge-btn"
                disabled={forging}
                onClick={forgeFromProposal}
              >
                {forging ? 'Creating helper...' : 'Create helper'}
              </button>
              <button type="button" className="btn" onClick={() => setProposal(null)}>
                Start over
              </button>
            </div>
          </div>
        )}

        {wizardActive && (
          <div className="card" data-testid="forge-wizard-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="card-title">Quick setup — Question {wizardStep} of 4</h3>
              <span className="status-pill">4-step setup</span>
            </div>

            {wizardStep === 1 && (
              <>
                <div style={{ fontWeight: 700 }}>
                  Question 1/4: Pick the kinds of work you want help with:
                </div>
                <div className="tick-grid">
                  {Q1_DOMAIN_OPTIONS.map(opt => (
                    <TickCard
                      key={opt}
                      label={opt}
                      checked={q1Domains.includes(opt)}
                      onToggle={() => toggleArr(setQ1Domains, opt)}
                    />
                  ))}
                </div>
              </>
            )}

            {wizardStep === 2 && (
              <>
                <div style={{ fontWeight: 700 }}>
                  Question 2/4: Pick the tasks you want it to do:
                </div>
                <div className="tick-grid">
                  {dynamicQ2Options.map(opt => (
                    <TickCard
                      key={opt}
                      label={opt}
                      checked={q2Tasks.includes(opt)}
                      onToggle={() => toggleArr(setQ2Tasks, opt)}
                    />
                  ))}
                </div>
                <label className="field-label">
                  Anything else? (optional)
                  <input
                    className="input"
                    placeholder="e.g. Check my inbox every morning or summarize notes..."
                    value={customNote}
                    onChange={e => setCustomNote(e.target.value)}
                  />
                </label>
              </>
            )}

            {wizardStep === 3 && (
              <>
                <div style={{ fontWeight: 700 }}>
                  Question 3/4: Pick what this helper is allowed to use:
                </div>
                <div className="tick-grid">
                  {Q3_TOOL_OPTIONS.map(opt => (
                    <TickCard
                      key={opt.id}
                      label={opt.label}
                      checked={q3Tools.includes(opt.label)}
                      onToggle={() => toggleArr(setQ3Tools, opt.label)}
                    />
                  ))}
                </div>
              </>
            )}

            {wizardStep === 4 && (
              <>
                <div style={{ fontWeight: 700 }}>
                  Question 4/4: Name your helper and choose when it runs:
                </div>
                <label className="field-label">
                  Helper name
                  <input className="input" value={botName} onChange={e => setBotName(e.target.value)} />
                </label>
                <div className="tick-grid">
                  {Q4_SCHEDULE_OPTIONS.map(opt => (
                    <TickCard
                      key={opt}
                      label={opt}
                      checked={q4Schedule.includes(opt)}
                      onToggle={() => toggleArr(setQ4Schedule, opt)}
                    />
                  ))}
                </div>
              </>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 8 }}>
                {wizardStep > 1 ? (
                  <button type="button" className="btn" onClick={() => setWizardStep(s => s - 1)}>
                    Back
                  </button>
                ) : (
                  <button type="button" className="btn" onClick={() => setWizardActive(false)}>
                    Cancel
                  </button>
                )}
              </div>

              {wizardStep < 4 ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  data-testid="wizard-next-btn"
                  onClick={() => setWizardStep(s => s + 1)}
                >
                  Next ({wizardStep}/4)
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-gold"
                  data-testid="wizard-finish-btn"
                  disabled={forging}
                  onClick={finishWizard}
                >
                  {forging ? 'Creating & starting...' : 'Create helper & start'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
