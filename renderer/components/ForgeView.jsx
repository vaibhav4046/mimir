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
  { id: 'shell', label: 'Run local shell commands (shell_exec)' },
  { id: 'fs', label: 'Read & write workspace files (fs_read / fs_write)' },
  { id: 'browser', label: 'Drive embedded Chromium browser (browser_open / action)' },
  { id: 'memory', label: 'Remember facts across runs (memory_save / read)' },
  { id: 'vault', label: 'Use encrypted Vault credentials (vault_use)' },
];

const Q4_SCHEDULE_OPTIONS = [
  'Run starter automation immediately in Chat',
  'Schedule Hourly Routine',
  'Schedule Daily Routine',
  'Notify Slack webhook when finished',
  'Notify Microsoft Teams webhook when finished',
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
  const [botName, setBotName] = useState('Atreus Automator');
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
            <span>Memory Forge &amp; Work Automator</span>
          </h2>
          <p style={{ margin: 0, color: 'var(--ink-muted)' }}>
            Import work memories from Claude, Antigravity, or ChatGPT to analyze your workflow and forge a custom automation agent — or answer 4 interactive questions when starting with no memory.
          </p>
        </div>

        <div
          className="card"
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
            padding: '10px 14px',
            background: 'var(--bg-rail)',
            borderColor: 'var(--rule-strong)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <MimirAsset category="characters" name="forge-bot-brok" size={38} />
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--frost-hi)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Brok — Builder &amp; Infra</span>
                <MimirAsset category="artifacts" name="dwarven-tongs" size={15} />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>Forges CLI, tools &amp; local sandbox pipelines</div>
            </div>
          </div>
          <MimirAsset category="artifacts" name="forge-anvil" size={30} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <MimirAsset category="characters" name="forge-bot-sindri" size={38} />
            <div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--brass-hi)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>Sindri — Artificer &amp; Polish</span>
                <MimirAsset category="artifacts" name="dwarven-forge-hammer" size={15} />
              </div>
              <div style={{ fontSize: 11.5, color: 'var(--ink-muted)' }}>Refines prompt guardrails &amp; QA specs</div>
            </div>
          </div>
        </div>

        {error && (
          <div className="tool-card" style={{ borderColor: 'var(--sand-red)', color: '#ff9c78' }}>
            {error}
          </div>
        )}

        {!wizardActive && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
              <h3 className="card-title">1. Import Memory From AI Apps</h3>
              <button type="button" className="btn btn-sm" onClick={scanLocal}>
                Rescan Machine
              </button>
            </div>

            {scannedFiles.length > 0 && (
              <div>
                <div style={{ fontSize: 12, color: 'var(--sand-text-muted)', marginBottom: 6 }}>
                  Discovered Local AI Files (Antigravity / Claude / ChatGPT):
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
                Source App Format
                <select className="select" value={sourceApp} onChange={e => setSourceApp(e.target.value)}>
                  <option value="claude">Claude (conversations.json / CLAUDE.md)</option>
                  <option value="antigravity">Antigravity (GEMINI.md / artifacts / brain notes)</option>
                  <option value="chatgpt">ChatGPT (conversations.json / Custom Instructions)</option>
                  <option value="custom">Other AI / Personal Notes</option>
                </select>
              </label>
              <div className="field-label">
                <span>Import Export File (.json, .md, .txt)</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 8px', background: 'var(--bg-surface)', border: '1px solid var(--rule)', borderRadius: 2 }}>
                  <input id="forge-export-upload" type="file" accept=".json,.md,.txt,.csv" style={{ display: 'none' }} onChange={handleUploadExport} />
                  <label htmlFor="forge-export-upload" className="btn btn-sm">
                    Choose File
                  </label>
                  <span style={{ fontSize: 12, color: 'var(--ink-subtle)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {importedChunks[0]?.filename || 'No file imported yet'}
                  </span>
                </div>
              </div>
            </div>

            <label className="field-label">
              Or Paste Memory / Instructions / Chat Excerpt
              <textarea
                className="textarea"
                rows={4}
                placeholder="Paste your Claude memory, Antigravity rules, or ChatGPT instructions here..."
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
                  Stage Snippet
                </button>
              )}
              <button
                type="button"
                className="btn btn-primary"
                data-testid="analyze-memory-btn"
                disabled={analyzing}
                onClick={handleAnalyze}
              >
                {analyzing ? 'Analyzing Work...' : 'Analyze Work & Propose Automator'}
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
                No Memory? Answer 4 Questions
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
                label="Create recurring scheduled Routine"
                checked={createRoutine}
                onToggle={() => setCreateRoutine(v => !v)}
              />
              <TickCard
                label="Run first automation task immediately in Chat"
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
                {forging ? 'Forging Bot...' : 'Forge Bot & Automate'}
              </button>
              <button type="button" className="btn" onClick={() => setProposal(null)}>
                Reset
              </button>
            </div>
          </div>
        )}

        {wizardActive && (
          <div className="card" data-testid="forge-wizard-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 className="card-title">Follow-Up Automation Interview — Question {wizardStep} of 4</h3>
              <span className="status-pill">No-Memory Forge Mode</span>
            </div>

            {wizardStep === 1 && (
              <>
                <div style={{ fontWeight: 700 }}>
                  Question 1/4: Tick the work realms you want this custom bot to automate:
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
                  Question 2/4 (Follow-Up): Tick specific recurring tasks based on your selected realms:
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
                  Extra Custom Task Note (optional)
                  <input
                    className="input"
                    placeholder="e.g. Watch daily build output or summarize sprint notes..."
                    value={customNote}
                    onChange={e => setCustomNote(e.target.value)}
                  />
                </label>
              </>
            )}

            {wizardStep === 3 && (
              <>
                <div style={{ fontWeight: 700 }}>
                  Question 3/4 (Follow-Up): Tick local tools & realms this bot is allowed to wield:
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
                  Question 4/4 (Follow-Up): Name your forged bot & tick schedule + immediate run options:
                </div>
                <label className="field-label">
                  Forged Bot Name
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
                    Previous Question
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
                  Next Question ({wizardStep}/4)
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-gold"
                  data-testid="wizard-finish-btn"
                  disabled={forging}
                  onClick={finishWizard}
                >
                  {forging ? 'Forging & Running...' : 'Forge Bot & Execute Now'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
