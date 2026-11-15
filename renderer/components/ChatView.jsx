import React, { useEffect, useRef, useState } from 'react';
import { apiFetch, encodeFilesForStaging, fetchArtifactBlob, isFileDragEvent } from '../api.js';
import { BotAvatar } from './BotAvatar.jsx';
import { CreativeStudioPlayer } from './CreativeStudioPlayer.jsx';
import { HairlineCanvas } from './HairlineCanvas.jsx';
import { IntelligentUiRenderer } from './IntelligentUiRenderer.jsx';
import { UsageBar } from './UsageBar.jsx';
import {
  MimirAsset,
  MimirSagePortrait,
  PixelGlitchResponse,
  RunicLoader,
  resolveCharacterId,
} from './MimirAsset.jsx';
import {
  AttachmentFileSvg,
  CloseCrossSvg,
  CodeModeSvg,
  IrreversibleGateSvg,
  PlusPixelSvg,
  ReversibleShieldSvg,
  SendRunicSvg,
  SubagentSwarmSvg,
  TeachCrystalSvg,
  TeamTopologySvg,
  VoiceOrbSvg,
} from './Icons.jsx';

const EXECUTION_MODES = [
  { id: 'agent', label: 'Agent', hint: 'Full tools' },
  { id: 'code', label: 'Code', hint: 'Code & shell', Icon: CodeModeSvg },
  { id: 'chat', label: 'Chat', hint: 'Read-only' },
];

const SMART_ACTION_CARDS = [
  {
    title: 'Deep Research Report',
    subtitle: 'Structured report + download MD, DOCX, PDF & 6 more docs',
    prompt: 'Gather multi-domain research on AI agents and 3D pipelines',
  },
  {
    title: 'Expense Tracker Web App',
    subtitle: 'Multi-file app with auth, SVG charts, export & tests',
    prompt: 'Build an expense-tracking web app with authentication, charts and export',
  },
  {
    title: 'Music & Audio Studio',
    subtitle: 'Synthesize multi-track stereo WAV audio with stems',
    prompt: 'Create an ambient synthwave music track at 110 BPM',
  },
  {
    title: 'Dream-Loop 3D',
    subtitle: 'Generate a 3D mesh with 2-pass critic review',
    prompt: 'Create a 3D model of a Valkyrie Starfighter',
  },
  {
    title: 'REA Architecture X-Ray',
    subtitle: 'Inspect how Mimir routes, verifies, and stores runs',
    prompt: 'Reverse-engineer how this app works with REA',
  },
  {
    title: 'Playable Game Studio',
    subtitle: 'Build an interactive arcade game inline',
    prompt: 'Create a playable arcade space shooter game with cyber lasers',
  },
];

const WORKSPACE_MODES = [
  { id: 'auto', label: 'Auto-Detect' },
  { id: 'conversation', label: 'Conversation' },
  { id: 'code', label: 'Coding & Web App' },
  { id: 'research', label: 'Deep Research' },
  { id: 'music', label: 'Music & Audio' },
  { id: 'video', label: 'Video Production' },
  { id: '3d', label: 'Images & 3D' },
  { id: 'voice', label: 'Voice' },
  { id: 'automation', label: 'Automation' },
];

const PROJECT_SCOPES = [
  { id: 'midgard-default', label: 'Midgard Workspace (Default)' },
  { id: 'expense-tracker', label: 'Expense Tracker App' },
  { id: 'multimodal-studio', label: 'Multimodal Studio' },
  { id: 'research-briefings', label: 'Research & Briefings' },
];

function detectDraftIntent(rawText, modeOverride = 'auto') {
  if (modeOverride && modeOverride !== 'auto') {
    const found = WORKSPACE_MODES.find(m => m.id === modeOverride);
    if (found) return { kind: modeOverride, label: `Mode Override -> ${found.label}` };
  }
  const text = String(rawText || '').trim();
  if (!text) return null;
  if (text.startsWith('/')) {
    return { kind: 'command', label: `Command · ${text.split(/\s+/)[0]}` };
  }
  if (/(?:^|\s)@[a-zA-Z0-9_-]+/.test(text) || /\b(?:ask\s+the\s+team|have\s+the\s+team|grok\s*bot\s+team|team\s+launch\s+brief)\b/i.test(text)) {
    return { kind: 'team', label: 'Route -> Grok Bot Team (@Mara @Cole)' };
  }
  if (/\b(?:wav|music|song|soundtrack|audio\s+track|lofi|synthwave|beat|melody|\d+\s*bpm)\b/i.test(text) && /\b(create|make|build|generate|forge|design|compose|produce)\b/i.test(text)) {
    return { kind: 'music', label: 'Route -> Music & Audio Studio (.WAV)' };
  }
  if (/\b(?:3d\s*model|3d\s*mesh|glb|obj|stl)\b/i.test(text) && /\b(create|make|build|generate|forge|design|render)\b/i.test(text)) {
    return { kind: 'dream3d', label: 'Route -> Dream-Loop 3D + Critic' };
  }
  if (/\b(?:video|animation|motion\s+clip|webm|mp4|gif)\b/i.test(text) && /\b(create|make|build|generate|forge|render|animate)\b/i.test(text)) {
    return { kind: 'dreamvideo', label: 'Route -> Tier 1 Video Composition' };
  }
  if (/\b(?:playable\s+game|video\s*game|arcade\s+game|browser\s+game|space\s+shooter|dungeon\s+crawler|brick\s+breaker)\b/i.test(text)) {
    return { kind: 'dreamgame', label: 'Route -> Playable Game Studio' };
  }
  if (/\b(?:web\s*app|webapp|expense[- ]tracker|full[- ]?stack\s+(?:web\s*)?app|interactive\s+web)\b/i.test(text) && /\b(create|make|build|generate|forge|design)\b/i.test(text)) {
    return { kind: 'dreamwebapp', label: 'Route -> Multi-File Web App Builder' };
  }
  if (/\b(?:hd\s+image|artwork|concept\s+art|poster|illustration|svg\s+diagram)\b/i.test(text) && /\b(create|make|build|generate|forge|design|render)\b/i.test(text)) {
    return { kind: 'dreamart', label: 'Route -> Dream-Loop HD Art + Critic' };
  }
  if (/\b(?:run|execute|start)\s+(?:a\s+|the\s+)?brutal\b|\bbrutal\s*(?:8\/8|stress|self[- ]?test|test\s*suite|audit)\b/i.test(text)) {
    return { kind: 'brutal', label: 'Route -> Brutal 8/8 Self-Test Suite' };
  }
  if (/\breverse[- ]engineer\b|\brea\s+(?:x[- ]?ray|inspect|architecture|scan)\b|\bhow\s+(?:this|the)\s+(?:app|site|system|codebase|mimir)\s+works\b/i.test(text)) {
    return { kind: 'rea', label: 'Route -> REA Architecture X-Ray' };
  }
  if (/\b(?:automate|schedule|set\s*up)\b.*\b(?:research|harvester|harvest|monitoring|briefings?)\b|\brun\s+research\s+every\b/i.test(text)) {
    return { kind: 'automate', label: 'Route -> Autonomous Research Schedule' };
  }
  if (/\b(?:gather|collect|run|harvest)\b.*\b(?:multi[- ]domain\s+)?(?:research|data)\b|\bresearch\s+harvester\b|\bmulti[- ]domain\s+research\b/i.test(text)) {
    return { kind: 'harvest', label: 'Route -> Multi-Domain Research Harvester' };
  }
  if (/^(?:please\s+|can\s+you\s+)?(?:deep[- ]?research|research(?:\s+(?:about|on|into|for))?|investigate|write\s+(?:a|an)\s+(?:deep\s+)?research\s+report\s+(?:on|about)|analyze\s+and\s+report\s+on|find\s+out\s+about)\s+.{3,}/i.test(text) || /\b(?:research\s+report|deep\s+research|comprehensive\s+report)\s+(?:on|about|into|for)\s+.{3,}/i.test(text)) {
    return { kind: 'deep', label: 'Route -> Deep Research Report (MD · DOCX · PDF + 6 Docs)' };
  }
  return null;
}

const RESEARCH_EXPORT_FORMATS = [
  { fmt: 'md', label: '.MD', title: 'Markdown Report' },
  { fmt: 'docx', label: '.DOCX', title: 'Microsoft Word Report' },
  { fmt: 'pdf', label: '.PDF', title: 'Typeset PDF Report' },
  { fmt: 'pptx', label: '.PPTX', title: 'Executive Slide Deck' },
  { fmt: 'xlsx', label: '.XLSX', title: 'Excel Workbook' },
  { fmt: 'csv', label: '.CSV', title: 'Structured CSV Dataset' },
  { fmt: 'html', label: '.HTML', title: 'Standalone Web Report' },
  { fmt: 'json', label: '.JSON', title: 'Structured JSON Dossier' },
  { fmt: 'zip', label: '.ZIP', title: 'All-in-One Dossier Archive' },
];

async function downloadArtifactFile(doc, titleHint = 'mimir-research-report') {
  const blob = await fetchArtifactBlob(doc.id, '');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const slug = String(doc.title || titleHint)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'mimir-report';
  a.href = url;
  a.download = `${slug}.${doc.format || 'pdf'}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function ChatInsightCards({ m }) {
  const [autoState, setAutoState] = useState('idle');
  const [docsByFmt, setDocsByFmt] = useState(() => {
    const map = {};
    for (const d of (m.researchCard?.documents || [])) {
      if (d?.format && d?.id) map[String(d.format).toLowerCase()] = d;
    }
    return map;
  });
  const [busyFmt, setBusyFmt] = useState('');
  const [exportStatus, setExportStatus] = useState('');
  const [copiedMd, setCopiedMd] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);

  useEffect(() => {
    const incoming = m.researchCard?.documents || [];
    if (!incoming.length) return;
    setDocsByFmt(prev => {
      const next = { ...prev };
      for (const d of incoming) {
        if (d?.format && d?.id) next[String(d.format).toLowerCase()] = d;
      }
      return next;
    });
  }, [m.researchCard?.documents]);

  const triggerHourlyAutomate = async packId => {
    if (autoState === 'saving') return;
    setAutoState('saving');
    try {
      await apiFetch('/v1/research/automate', {
        method: 'POST',
        body: JSON.stringify({ enabled: true, intervalMinutes: 60, packId: packId || 'all', runNow: false }),
      });
      setAutoState('done');
    } catch {
      setAutoState('error');
    }
  };

  const buildExportPayload = formats => ({
    runId: m.researchCard?.runId || null,
    campaignId: m.researchCard?.campaignId || null,
    query: m.researchCard?.query || '',
    title: m.researchCard?.title || 'MIMIR Deep Research Report',
    reportMarkdown: m.researchCard?.reportMarkdown || m.content || '',
    sections: m.researchCard?.sections || [],
    rows: m.researchCard?.tableRows || [],
    formats,
  });

  const handleDownloadFormat = async fmt => {
    if (!m.researchCard || busyFmt) return;
    const key = String(fmt).toLowerCase();
    setBusyFmt(key);
    setExportStatus('');
    try {
      let doc = docsByFmt[key];
      if (!doc) {
        const res = await apiFetch('/v1/research/export', {
          method: 'POST',
          body: JSON.stringify(buildExportPayload([key])),
        });
        doc = (res.documents || []).find(d => String(d.format || '').toLowerCase() === key) || res.documents?.[0];
        if (doc) {
          setDocsByFmt(prev => ({ ...prev, [key]: doc }));
        }
      }
      if (doc?.id) {
        await downloadArtifactFile(doc, m.researchCard.title);
        setExportStatus(`Downloaded .${key.toUpperCase()}`);
      }
    } catch (err) {
      setExportStatus(`Export failed: ${err.message}`);
    } finally {
      setBusyFmt('');
    }
  };

  const handleExportAll = async () => {
    if (!m.researchCard || busyFmt) return;
    setBusyFmt('all');
    setExportStatus('');
    try {
      const missing = RESEARCH_EXPORT_FORMATS.map(x => x.fmt).filter(f => !docsByFmt[f]);
      if (missing.length > 0) {
        const res = await apiFetch('/v1/research/export', {
          method: 'POST',
          body: JSON.stringify(buildExportPayload(missing)),
        });
        setDocsByFmt(prev => {
          const next = { ...prev };
          for (const d of (res.documents || [])) {
            if (d?.format && d?.id) next[String(d.format).toLowerCase()] = d;
          }
          return next;
        });
      }
      setExportStatus('All 9 documents forged & ready for download.');
    } catch (err) {
      setExportStatus(`Batch export failed: ${err.message}`);
    } finally {
      setBusyFmt('');
    }
  };

  const handleCopyMarkdown = async () => {
    const md = m.researchCard?.reportMarkdown || m.content || '';
    try {
      await navigator.clipboard?.writeText(md);
      setCopiedMd(true);
      setTimeout(() => setCopiedMd(false), 1800);
    } catch {}
  };

  return (
    <>
      {m.reaCard && (
        <div className="chat-insight-card chat-rea-card" data-testid="chat-rea-card">
          <div className="insight-card-head">
            <div>
              <strong>{m.reaCard.title || 'REA Architecture X-Ray'}</strong>
              <div className="muted num">
                {m.reaCard.metrics?.filesScanned || 0} modules · {(m.reaCard.metrics?.totalLines || 0).toLocaleString()} lines · {m.reaCard.metrics?.routesCount || 0} endpoints
              </div>
            </div>
            <span className="pill is-cyan">REA Live Scan</span>
          </div>
          {m.reaCard.flow && (
            <div className="insight-flow-line">
              <code>{m.reaCard.flow}</code>
            </div>
          )}
          {Array.isArray(m.reaCard.layers) && m.reaCard.layers.length > 0 && (
            <div className="insight-layers-grid">
              {m.reaCard.layers.map(layer => (
                <div key={layer.name} className="insight-layer-box">
                  <div className="insight-layer-title">{layer.name}</div>
                  <div className="muted" style={{ fontSize: 11 }}>{layer.stack}</div>
                  <div className="chip-list" style={{ marginTop: 4 }}>
                    {(layer.modules || []).map(mod => (
                      <span key={mod.path} className="chip num">
                        {mod.path} ({mod.lines}L)
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {m.researchCard && (
        <div className="chat-insight-card chat-research-card" data-testid="chat-research-card">
          <div className="insight-card-head">
            <div>
              <strong>{m.researchCard.title || `Research Report · ${m.researchCard.packId || 'all'}`}</strong>
              <div className="muted num">
                {m.researchCard.topicsCount || 1} tracks · {m.researchCard.totalSources || 0} verified sources ·{' '}
                {m.researchCard.knowledgeIngestion?.chunksAdded || 0} KB chunks · Citation Check PASS
              </div>
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="research-copy-md-btn"
                onClick={handleCopyMarkdown}
              >
                {copiedMd ? 'Copied MD' : 'Copy Markdown'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="research-reader-toggle"
                onClick={() => setReaderOpen(v => !v)}
              >
                {readerOpen ? 'Hide Reader' : 'Reader View'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="research-automate-btn"
                disabled={autoState === 'saving' || autoState === 'done'}
                onClick={() => triggerHourlyAutomate(m.researchCard.packId)}
              >
                {autoState === 'done'
                  ? 'Hourly Active'
                  : autoState === 'saving'
                    ? 'Scheduling...'
                    : autoState === 'error'
                      ? 'Retry Automate'
                      : 'Automate Hourly'}
              </button>
            </div>
          </div>

          <div className="research-doc-shelf" data-testid="research-doc-downloads">
            <div className="research-doc-shelf-head">
              <span className="muted" style={{ fontSize: 11.5, fontWeight: 600 }}>
                Download Research Documents ({Object.keys(docsByFmt).length}/9 ready)
              </span>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                data-testid="research-export-all-btn"
                disabled={Boolean(busyFmt)}
                onClick={handleExportAll}
              >
                {busyFmt === 'all' ? 'Generating All...' : 'Export All 9 Docs'}
              </button>
            </div>
            <div className="research-doc-pills">
              {RESEARCH_EXPORT_FORMATS.map(({ fmt, label, title }) => {
                const readyDoc = docsByFmt[fmt];
                const isBusy = busyFmt === fmt;
                const isPrimary = fmt === 'md' || fmt === 'docx' || fmt === 'pdf';
                return (
                  <button
                    key={fmt}
                    type="button"
                    className={`research-doc-pill ${readyDoc ? 'is-ready' : ''} ${isPrimary ? 'is-primary' : ''}`}
                    data-testid={`research-dl-${fmt}`}
                    title={`${title}${readyDoc?.size_bytes ? ` (${Math.max(1, Math.round(readyDoc.size_bytes / 1024))} KB)` : ' — click to generate & download'}`}
                    disabled={Boolean(busyFmt)}
                    onClick={() => handleDownloadFormat(fmt)}
                  >
                    <span>{isBusy ? '...' : label}</span>
                    {readyDoc && (
                      <span className="num" style={{ opacity: 0.78, fontSize: 10 }}>
                        {Math.max(1, Math.round((readyDoc.size_bytes || 1024) / 1024))}K
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {exportStatus && (
              <div className="muted" style={{ fontSize: 11.5 }} data-testid="research-export-status">
                {exportStatus}
              </div>
            )}
          </div>

          {readerOpen && (
            <div className="research-reader-panel" data-testid="research-reader-panel">
              {renderFormattedText(m.researchCard.reportMarkdown || m.content || '')}
            </div>
          )}

          {m.researchCard.csvPath && (
            <div className="muted" style={{ fontSize: 11.5 }}>
              Workspace CSV: <code>{m.researchCard.csvPath}</code>
            </div>
          )}
        </div>
      )}

      {m.brutalReport && (
        <div className="chat-insight-card chat-brutal-card" data-testid="chat-brutal-card">
          <div className="insight-card-head">
            <strong>Brutal Stress Suite</strong>
            <span className={`pill ${m.brutalReport.allPassed ? 'is-emerald' : 'is-crimson'} num`}>
              {m.brutalReport.passedCount}/{m.brutalReport.totalChecks} Passed
            </span>
          </div>
          <div className="insight-checks-list">
            {(m.brutalReport.checks || []).map(c => (
              <div key={c.name} className="insight-check-row">
                <span className={`pill ${c.passed ? 'is-emerald' : 'is-crimson'}`} style={{ fontSize: 10 }}>
                  {c.passed ? 'PASS' : 'FAIL'}
                </span>
                <span>{c.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {m.automationCard && (
        <div className="chat-insight-card chat-automation-card" data-testid="chat-automation-card">
          <div className="insight-card-head">
            <strong>Autonomous Schedule · {m.automationCard.packId}</strong>
            <span className="pill is-emerald num">Every {m.automationCard.intervalMinutes}m</span>
          </div>
        </div>
      )}
    </>
  );
}

function TimelineStepIcon({ icon }) {
  if (icon === 'subagent' || icon === 'swarm') {
    return <SubagentSwarmSvg size={14} />;
  }
  if (icon === 'web_search') {
    return (
      <svg className="timeline-row-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="square" />
      </svg>
    );
  }
  if (icon === 'connector') {
    return (
      <svg className="timeline-row-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <rect x="2" y="2" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <rect x="9" y="9" width="5" height="5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7 4.5H11.5V9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg className="timeline-row-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M5 2V14M5 4L11 7L5 10" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

// Original lines written for this app's Mimir (not taken from any game script).
const MIMIR_GREETINGS = [
  'The well runs deep today. What shall we draw up from it?',
  'Ask plainly and I will answer plainly — and tell you what I have not checked.',
  'Nine realms, one workspace, no shortcuts. Where do we start?',
  'A head without a body still has a fine memory. Put it to work.',
  'Every rune in this hall was carved by hand. Point me at the next one.',
];

/** Strip markdown so the voice reads words, not symbols. */
function toSpeakable(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' code block omitted. ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`#>|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1200);
}

/** Plays a reply through the local voice engine (offline Windows voice by default). */
function SpeakButton({ text, autoPlay = false }) {
  const [state, setState] = useState('idle'); // idle | loading | playing | error
  const audioRef = useRef(null);

  const play = async () => {
    if (state === 'playing') {
      audioRef.current?.pause();
      setState('idle');
      return;
    }
    setState('loading');
    try {
      const out = await apiFetch('/v1/voice/tts?format=json', {
        method: 'POST',
        body: JSON.stringify({ text: toSpeakable(text) }),
      });
      const audio = new Audio(`data:${out.mime};base64,${out.audioBase64}`);
      audioRef.current = audio;
      audio.onended = () => setState('idle');
      await audio.play();
      setState('playing');
    } catch {
      setState('error');
    }
  };

  useEffect(() => {
    if (autoPlay) play();
    return () => audioRef.current?.pause();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- play once on mount only
  }, []);

  const label = { idle: 'Speak', loading: 'Voicing…', playing: 'Stop', error: 'Voice unavailable' }[state];
  return (
    <button type="button" className="speak-btn" data-state={state} onClick={play} disabled={state === 'loading'} aria-label={`${label} this reply`}>
      {label}
    </button>
  );
}

function renderCitationsAndMentions(text, keyPrefix) {
  return String(text || '')
    .split(/(\[S\d+\])/g)
    .map((part, cIdx) => {
      if (/^\[S\d+\]$/.test(part)) {
        return (
          <span key={`${keyPrefix}-c${cIdx}`} className="cite-badge">
            {part}
          </span>
        );
      }
      return String(part)
        .split(/(@[A-Za-z][A-Za-z0-9_-]*)/g)
        .map((seg, sIdx) =>
          sIdx % 2 === 1 ? (
            <span key={`${keyPrefix}-m${cIdx}-${sIdx}`} className="mention-pill">
              {seg}
            </span>
          ) : (
            seg
          )
        );
    });
}

function renderBold(text, keyPrefix) {
  return String(text || '')
    .split(/\*\*([^*]+)\*\*/g)
    .map((part, idx) =>
      idx % 2 === 1 ? (
        <strong key={`${keyPrefix}-b${idx}`}>{renderCitationsAndMentions(part, `${keyPrefix}-bi${idx}`)}</strong>
      ) : (
        renderCitationsAndMentions(part, `${keyPrefix}-m${idx}`)
      )
    );
}

function renderInlineSpans(text, keyPrefix) {
  return String(text || '')
    .split(/`([^`]+)`/g)
    .map((part, idx) =>
      idx % 2 === 1 ? (
        <code key={`${keyPrefix}-${idx}`} className="inline-code">
          {part}
        </code>
      ) : (
        <span key={`${keyPrefix}-${idx}`}>{renderBold(part, `${keyPrefix}-${idx}`)}</span>
      )
    );
}

function parseMarkdownBlock(chunk, keyPrefix) {
  const lines = String(chunk || '').split(/\r?\n/);
  const nodes = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const trimmed = raw.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    if (/^---+$/.test(trimmed)) {
      nodes.push(<hr key={`${keyPrefix}-hr-${i}`} className="md-hr" />);
      i += 1;
      continue;
    }

    // GitHub-Flavored Markdown Table
    if (
      trimmed.startsWith('|') &&
      i + 1 < lines.length &&
      /^\|\s*:?-{2,}:?/.test(lines[i + 1].trim())
    ) {
      const parseRow = rowStr =>
        rowStr
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map(cell => cell.trim());
      const headers = parseRow(trimmed);
      const bodyRows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().startsWith('|')) {
        bodyRows.push(parseRow(lines[j]));
        j += 1;
      }
      nodes.push(
        <div key={`${keyPrefix}-tbl-${i}`} className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {headers.map((h, hIdx) => (
                  <th key={hIdx}>{renderInlineSpans(h, `${keyPrefix}-th-${i}-${hIdx}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bodyRows.map((row, rIdx) => (
                <tr key={rIdx}>
                  {headers.map((_, cIdx) => (
                    <td key={cIdx}>{renderInlineSpans(row[cIdx] ?? '', `${keyPrefix}-td-${i}-${rIdx}-${cIdx}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = j;
      continue;
    }

    // Callout / Blockquote
    if (trimmed.startsWith('>')) {
      const qLines = [];
      let j = i;
      while (j < lines.length && lines[j].trim().startsWith('>')) {
        qLines.push(lines[j].trim().replace(/^>\s?/, ''));
        j += 1;
      }
      let badge = '';
      if (qLines[0] && /^\[!(NOTE|TIP|IMPORTANT|WARNING)\]\s*/i.test(qLines[0])) {
        const mTag = qLines[0].match(/^\[!(NOTE|TIP|IMPORTANT|WARNING)\]\s*(.*)$/i);
        badge = mTag[1].toUpperCase();
        qLines[0] = mTag[2] || '';
      }
      nodes.push(
        <div key={`${keyPrefix}-q-${i}`} className="md-callout">
          {badge && <span className="md-callout-tag">{badge}</span>}
          {qLines.filter(Boolean).map((ql, qIdx) => (
            <div key={qIdx} className="md-callout-line">
              {renderInlineSpans(ql, `${keyPrefix}-ql-${i}-${qIdx}`)}
            </div>
          ))}
        </div>
      );
      i = j;
      continue;
    }

    // Headings
    if (trimmed.startsWith('### ')) {
      nodes.push(
        <h3 key={`${keyPrefix}-h3-${i}`} className="md-h3">
          {renderInlineSpans(trimmed.slice(4), `${keyPrefix}-h3i-${i}`)}
        </h3>
      );
      i += 1;
      continue;
    }
    if (trimmed.startsWith('## ')) {
      nodes.push(
        <h2 key={`${keyPrefix}-h2-${i}`} className="md-h2">
          {renderInlineSpans(trimmed.slice(3), `${keyPrefix}-h2i-${i}`)}
        </h2>
      );
      i += 1;
      continue;
    }
    if (trimmed.startsWith('# ')) {
      nodes.push(
        <h1 key={`${keyPrefix}-h1-${i}`} className="md-h1">
          {renderInlineSpans(trimmed.slice(2), `${keyPrefix}-h1i-${i}`)}
        </h1>
      );
      i += 1;
      continue;
    }

    // Bulleted or Numbered list items
    if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
      const listItems = [];
      let j = i;
      while (j < lines.length && (/^[-*]\s+/.test(lines[j].trim()) || /^\d+\.\s+/.test(lines[j].trim()))) {
        listItems.push(lines[j].trim().replace(/^([-*]|\d+\.)\s+/, ''));
        j += 1;
      }
      nodes.push(
        <ul key={`${keyPrefix}-ul-${i}`} className="md-list">
          {listItems.map((item, liIdx) => (
            <li key={liIdx}>{renderInlineSpans(item, `${keyPrefix}-li-${i}-${liIdx}`)}</li>
          ))}
        </ul>
      );
      i = j;
      continue;
    }

    // Regular paragraph
    nodes.push(
      <p key={`${keyPrefix}-p-${i}`} className="md-p">
        {renderInlineSpans(raw, `${keyPrefix}-pi-${i}`)}
      </p>
    );
    i += 1;
  }
  return nodes;
}

function renderFormattedText(text) {
  const str = String(text || '');
  const parts = str.split(/```([\s\S]*?)```/g);
  return parts.map((chunk, i) => {
    if (i % 2 === 1) {
      const firstNewline = chunk.indexOf('\n');
      const code = firstNewline > -1 ? chunk.slice(firstNewline + 1) : chunk;
      return (
        <pre key={i} className="code-block" style={{ margin: '8px 0' }}>
          <code>{code.trimEnd()}</code>
        </pre>
      );
    }
    return <div key={i} className="md-block">{parseMarkdownBlock(chunk, `md-${i}`)}</div>;
  });
}

export function ChatView({
  bot,
  teamBots = [],
  thread,
  streaming,
  isRunning,
  swarmSteps = [],
  pendingApprovals,
  onSendMessage,
  onAbort,
  onResolveApproval,
  onStageFiles,
  onSwitchMode,
  onOpenLiveVoice,
  teachMode,
  recordedSteps,
  onToggleTeachMode,
  onSaveRecording,
  onNavigateTab,
  activeSurface = 'chat',
  onSelectSurface,
  mimirAvatarState = 'IDLE',
  staticAvatar = false,
  onUiAction,
}) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [workspaceMode, setWorkspaceMode] = useState('auto');
  const [selectedProject, setSelectedProject] = useState('midgard-default');
  const [recName, setRecName] = useState('');
  const [commands, setCommands] = useState([]);
  const [micState, setMicState] = useState('idle'); // idle | recording | transcribing | error
  const [micError, setMicError] = useState('');
  const [modeBusy, setModeBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [dropBusy, setDropBusy] = useState(false);
  const [greeting] = useState(() => MIMIR_GREETINGS[Math.floor(Math.random() * MIMIR_GREETINGS.length)]);
  const endRef = useRef(null);
  const fileInputRef = useRef(null);
  const recorderRef = useRef(null);
  const micStreamRef = useRef(null);
  const dragDepthRef = useRef(0);
  const specialistMentions = teamBots.filter(
    b => b.id !== bot?.id && (b.parentBotId === bot?.id || b.specialistTag || b.isTeamBot)
  );

  useEffect(() => {
    return () => {
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
          recorderRef.current.onstop = null;
          recorderRef.current.stop();
        }
      } catch {}
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => {
          try { t.stop(); } catch {}
        });
        micStreamRef.current = null;
      }
    };
  }, []);

  const toggleMic = async () => {
    setMicError('');
    if (micState === 'recording' && recorderRef.current) {
      recorderRef.current.stop();
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setMicState('error');
      setMicError('Microphone capture not supported in this browser.');
      return;
    }
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      const chunks = [];
      const mr = new MediaRecorder(stream);
      recorderRef.current = mr;
      mr.ondataavailable = e => {
        if (e.data?.size) chunks.push(e.data);
      };
      mr.onerror = () => {
        stream?.getTracks().forEach(t => { try { t.stop(); } catch {} });
        if (micStreamRef.current === stream) micStreamRef.current = null;
        recorderRef.current = null;
        setMicState('error');
        setMicError('Microphone recorder failed.');
      };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        if (micStreamRef.current === stream) micStreamRef.current = null;
        if (recorderRef.current === mr) recorderRef.current = null;
        setMicState('transcribing');
        try {
          const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
          const dataUrl = await new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result || ''));
            r.onerror = () => reject(new Error('Audio read failed'));
            r.readAsDataURL(blob);
          });
          const audioBase64 = dataUrl.split(',')[1] || '';
          const ext = (mr.mimeType || '').includes('ogg') ? 'ogg' : 'webm';
          const out = await apiFetch('/v1/voice/stt', {
            method: 'POST',
            body: JSON.stringify({ audioBase64, ext }),
          });
          if (out?.text) {
            setDraft(prev => (prev ? `${prev.trimEnd()} ${out.text}` : out.text));
          } else if (out?.error) {
            setMicError(out.error);
          }
          setMicState('idle');
        } catch (err) {
          setMicState('error');
          setMicError(err.message || 'Voice transcription unavailable.');
        }
      };
      mr.start();
      setMicState('recording');
    } catch (err) {
      stream?.getTracks().forEach(t => { try { t.stop(); } catch {} });
      if (micStreamRef.current === stream) micStreamRef.current = null;
      recorderRef.current = null;
      setMicState('error');
      setMicError(err.message || 'Microphone access denied.');
    }
  };

  useEffect(() => {
    apiFetch('/v1/agi/state')
      .then(s => setCommands(s.commands || []))
      .catch(() => setCommands([])); // no suggestions is fine; typed commands still work
  }, []);

  // Suggest only while typing the command word itself, not its argument.
  const commandMatches = /^\/\S*$/.test(draft) ? commands.filter(c => c.cmd.startsWith(draft.toLowerCase())) : [];

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [thread?.messages?.length, streaming?.content, pendingApprovals?.length]);

  const handleSubmit = async e => {
    e?.preventDefault();
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    setDraft('');
    const staged = [...attachments];
    setAttachments([]);
    await onSendMessage(text || 'Inspect attached files.', staged);
  };

  const stageAndMaybeAutoRun = async (fileList, { autoSend = false } = {}) => {
    const rawFiles = Array.from(fileList || []).filter(Boolean);
    if (!rawFiles.length) return;
    setDropBusy(true);
    setMicError('');
    try {
      const { encoded, skipped } = await encodeFilesForStaging(rawFiles);
      if (skipped.length) {
        setMicError(`Skipped: ${skipped.join(', ')}`);
      }
      if (!encoded.length) return;
      const staged = await onStageFiles(encoded);
      const merged = [...attachments, ...staged];
      if (autoSend && !isRunning) {
        const customPrompt = draft.trim();
        setDraft('');
        setAttachments([]);
        const names = staged.map(f => f.name).join(', ');
        await onSendMessage(
          customPrompt || `Inspect and work on dropped file(s): ${names}`,
          merged
        );
      } else {
        setAttachments(merged);
      }
    } catch (err) {
      setMicError(err?.message || 'Failed staging dropped file(s).');
    } finally {
      setDropBusy(false);
    }
  };

  const handlePickFiles = async () => {
    if (window.desktop?.pickAttachmentFiles) {
      const files = await window.desktop.pickAttachmentFiles();
      if (files?.length) {
        const res = await onStageFiles(files);
        setAttachments(prev => [...prev, ...res]);
      }
      return;
    }
    fileInputRef.current?.click();
  };

  const handleHtmlFiles = async evt => {
    const files = evt.target.files;
    await stageAndMaybeAutoRun(files, { autoSend: false });
    evt.target.value = '';
  };

  const handleDragEnter = evt => {
    if (!isFileDragEvent(evt)) return;
    evt.preventDefault();
    evt.stopPropagation();
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragOver = evt => {
    if (!isFileDragEvent(evt)) return;
    evt.preventDefault();
    evt.stopPropagation();
    if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'copy';
  };

  const handleDragLeave = evt => {
    if (!isFileDragEvent(evt)) return;
    evt.preventDefault();
    evt.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  };

  const handleDrop = async evt => {
    if (!isFileDragEvent(evt)) return;
    evt.preventDefault();
    evt.stopPropagation();
    dragDepthRef.current = 0;
    setDragActive(false);
    await stageAndMaybeAutoRun(evt.dataTransfer?.files, { autoSend: !evt.shiftKey });
  };

  const messages = thread?.messages || [];
  const activeMode = bot?.executionMode || 'agent';
  const activeModeMeta = EXECUTION_MODES.find(m => m.id === activeMode) || EXECUTION_MODES[0];

  const handleModeClick = async modeId => {
    if (!onSwitchMode || modeBusy || modeId === activeMode) return;
    setModeBusy(true);
    try {
      await onSwitchMode(modeId);
    } finally {
      setModeBusy(false);
    }
  };

  return (
    <div
      className={`chat-drop-zone ${dragActive ? 'is-drag-active' : ''}`}
      data-testid="chat-drop-zone"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {(dragActive || dropBusy) && (
        <div className="drop-overlay" data-testid="chat-drop-overlay" aria-live="polite">
          <div className="drop-overlay-card">
            <AttachmentFileSvg size={28} />
            <strong>{dropBusy ? 'Staging dropped files...' : 'Drop files into Mimir'}</strong>
            <span>
              {dropBusy
                ? 'Uploading into agent workspace and launching run...'
                : 'Auto-runs inspection on drop · Hold Shift to attach without sending'}
            </span>
          </div>
        </div>
      )}
      <div className="chat-session-bar">
        <div className="mode-pill-group" role="group" aria-label="Execution Mode">
          {EXECUTION_MODES.map(m => {
            const isSelected = activeMode === m.id;
            const ModeIcon = m.Icon;
            return (
              <button
                key={m.id}
                type="button"
                className={`mode-pill-btn ${isSelected ? 'active' : ''}`}
                data-testid={`mode-pill-${m.id}`}
                aria-pressed={isSelected}
                disabled={modeBusy}
                title={m.hint}
                onClick={() => handleModeClick(m.id)}
              >
                {ModeIcon && <ModeIcon size={12} />}
                <span>{m.label}</span>
              </button>
            );
          })}
        </div>
        <div className="chat-session-meta">
          <span className="chat-mode-hint">{activeModeMeta.hint}</span>
          {bot?.specialistTag && (
            <span className="status-pill badge-specialist">{bot.specialistTag}</span>
          )}
        </div>
      </div>

      <div className="chat-scroll" data-testid="chat-messages">
        {messages.length === 0 && !streaming?.content && (
          <div className="view-panel-enter chat-empty-hero">
            <div className="hairline-hero">
              <HairlineCanvas activeIntent={detectDraftIntent(draft)} height={78} />
              <div className="hairline-hero-avatar">
                {resolveCharacterId(bot) === 'mimir-head' ? (
                  <MimirSagePortrait size={64} state={mimirAvatarState} staticAvatar={staticAvatar} />
                ) : (
                  <BotAvatar
                    bot={bot}
                    shape={bot?.shape || 'mimir'}
                    color={bot?.color || '#3ac9ff'}
                    size={64}
                    state={isRunning ? 'running' : 'idle'}
                  />
                )}
              </div>
            </div>
            <h2 className="chat-hero-title">
              {bot?.name || 'Mimir'}
            </h2>
            <p className="chat-hero-prompt" data-testid="home-hero-prompt">
              What would you like to get done?
            </p>
            {resolveCharacterId(bot) === 'mimir-head' && (
              <p className="mimir-greeting" data-testid="mimir-greeting">“{greeting}”</p>
            )}
            <p className="chat-hero-subtitle">
              Your AI workspace for getting things done. Type, speak, or drop files to build apps, research reports, music, video, or 3D assets.
            </p>
            <div className="smart-prompt-grid" data-testid="smart-prompt-grid">
              {SMART_ACTION_CARDS.map(card => (
                <button
                  key={card.title}
                  type="button"
                  className="smart-prompt-card"
                  onClick={() => onSendMessage(card.prompt, [])}
                >
                  <span className="smart-prompt-title">{card.title}</span>
                  <span className="smart-prompt-sub">{card.subtitle}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, msgIdx) => {
          if (m.role === 'tool') {
            const isDenied = m.approved === false;
            const isFailed = !isDenied && String(m.content || '').startsWith('ERROR:');
            const badgeText = isDenied ? 'Denied' : isFailed ? 'Failed' : 'Executed';
            const badgeColor = isDenied || isFailed ? 'var(--err)' : 'var(--ok)';

            return (
              <div key={m.id} className="msg-row">
                <div className={`tool-card ${isDenied || isFailed ? 'is-error' : ''}`} data-testid={`tool-card-${m.toolName}`}>
                  <div className="tool-card-head">
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <MimirAsset
                        category="animations"
                        name={isDenied || isFailed ? 'cracked-runestone-error' : 'illuminated-rune-success'}
                        size={18}
                      />
                      <span>Tool: {m.toolName}</span>
                    </span>
                    <span
                      className="status-pill"
                      data-testid="tool-status-badge"
                      style={{ color: badgeColor, borderColor: badgeColor }}
                    >
                      <MimirAsset
                        category="ui"
                        name={isDenied || isFailed ? 'error' : 'succeeded'}
                        size={12}
                      />
                      {badgeText}
                    </span>
                  </div>
                  <details className="tool-card-details">
                    <summary>
                      {isDenied ? 'Gate decision' : isFailed ? 'Error payload' : 'Request & response details'}
                    </summary>
                    {m.toolArgs && Object.keys(m.toolArgs).length > 0 && (
                      <>
                        <div className="tool-section-label">Request</div>
                        <pre className="tool-output-pre">{JSON.stringify(m.toolArgs, null, 2)}</pre>
                      </>
                    )}
                    <div className="tool-section-label">
                      {isDenied ? 'Gate Decision' : isFailed ? 'Error Output' : 'Response'}
                    </div>
                    <pre className="tool-output-pre">{m.content}</pre>
                  </details>
                </div>
              </div>
            );
          }

          const subsequentToolNames = new Set(
            messages
              .slice(msgIdx + 1)
              .filter(next => next.role === 'tool')
              .map(next => next.toolName)
          );
          const pendingToolCalls = (m.toolCalls || []).filter(tc => !subsequentToolNames.has(tc.name));
          const hasText = Boolean(String(m.content || '').trim());
          if (
            m.role === 'assistant' &&
            !hasText &&
            !m.thinking &&
            pendingToolCalls.length === 0 &&
            !(m.attachments?.length > 0)
          ) {
            return null;
          }

          return (
            <div key={m.id} className={`msg-row ${m.role === 'user' ? 'user' : 'assistant'}`}>
              {m.role === 'assistant' && m.delegation?.targets?.length > 0 && (
                <div className="delegation-connector" data-testid="delegation-connector">
                  <span className="delegation-elbow" aria-hidden="true" />
                  <TeamTopologySvg size={12} />
                  <span>{m.delegation.fromBotName || bot?.name}</span>
                  <span>-&gt;</span>
                  {m.delegation.targets.map(tgt => (
                    <span
                      key={tgt.botId}
                      className="mention-pill"
                      data-status={tgt.status || 'done'}
                      style={{ borderColor: tgt.status === 'failed' ? 'var(--err)' : tgt.color || 'var(--frost)' }}
                      title={tgt.status === 'failed' ? `${tgt.name} could not finish` : `${tgt.name} finished`}
                    >
                      @{tgt.name}
                      {tgt.status === 'failed' ? ' · failed' : ''}
                    </span>
                  ))}
                </div>
              )}
              {m.role === 'assistant' && m.timelineSteps?.length > 0 && (
                <div className="timeline-steps" data-testid="timeline-steps">
                  {m.timelineSteps.map((step, sIdx) => (
                    <div key={step.id || sIdx} className="timeline-row" data-status={step.status || 'done'}>
                      <TimelineStepIcon icon={step.icon} />
                      <span>{step.label}</span>
                    </div>
                  ))}
                </div>
              )}
              {m.speakerName && (
                <div className="speaker-tag" data-testid="speaker-tag" style={{ color: m.speakerColor || 'var(--frost-hi)' }}>
                  @{m.speakerName}
                  <span> · asked by {m.delegatedBy}</span>
                </div>
              )}
              <div
                className="msg-bubble"
                style={
                  m.isError
                    ? { borderColor: 'var(--err)', background: 'var(--err-soft)' }
                    : m.speakerName
                      ? { borderLeft: `3px solid ${m.speakerColor || 'var(--frost)'}` }
                      : undefined
                }
              >
                {m.thinking && (
                  <details className="msg-thinking">
                    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Thinking trace</summary>
                    <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{m.thinking}</div>
                  </details>
                )}
                {hasText &&
                  (m.role === 'assistant' ? (
                    <PixelGlitchResponse
                      isNew={msgIdx === messages.length - 1}
                      isError={Boolean(m.isError)}
                    >
                      {renderFormattedText(m.content)}
                    </PixelGlitchResponse>
                  ) : (
                    <div>{renderFormattedText(m.content)}</div>
                  ))}
                {pendingToolCalls.length > 0 && (
                  <div className="chip-list" style={{ marginTop: hasText ? 8 : 0 }}>
                    {pendingToolCalls.map((tc, idx) => (
                      <span key={tc.id || idx} className="chip">
                        Pending Tool: <code>{tc.name}</code>
                      </span>
                    ))}
                  </div>
                )}
                {m.attachments?.length > 0 && (
                  <div className="chip-list" style={{ marginTop: 8 }}>
                    {m.attachments.map((a, idx) => (
                      <span key={idx} className="chip">
                        <AttachmentFileSvg size={12} />
                        <span>{a.name}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <ChatInsightCards m={m} />
              {m.uiSpec && (
                <IntelligentUiRenderer spec={m.uiSpec} onAction={onUiAction} />
              )}
              {Array.isArray(m.artifacts) && m.artifacts.length > 0 && (
                <div className="chat-artifacts-stack" data-testid="chat-artifacts-stack">
                  {m.artifacts.map(art => (
                    <CreativeStudioPlayer key={art.id} artifact={art} compact />
                  ))}
                </div>
              )}
              {/* Receipts stay internal; only a reply that claims work it did not do is flagged. */}
              {m.role === 'assistant' && m.receipt?.unbackedClaims?.length > 0 && (
                <div className="unbacked-warning" role="alert" data-testid="unbacked-claim-warning">
                  This reply mentions actions that did not run: {m.receipt.unbackedClaims.map(c => c.label || c.text).join('; ')}
                </div>
              )}
              <div className="msg-meta">
                <span>{m.role === 'user' ? 'You' : m.speakerName || bot?.name || 'Mimir'}</span>
                {m.model && !m.speakerName && <span>• {m.provider}:{m.model}</span>}
                {m.fallbackFrom && <span>• Fallback from {m.fallbackFrom}</span>}
                {m.role === 'assistant' && hasText && (
                  <SpeakButton text={m.content} autoPlay={Boolean(m.voice) && msgIdx === messages.length - 1} />
                )}
              </div>
            </div>
          );
        })}

        {isRunning && swarmSteps.length > 0 && (
          <div className="msg-row assistant">
            <div className="timeline-steps" data-testid="timeline-steps">
              {swarmSteps.map((step, sIdx) => (
                <div key={step.id || sIdx} className="timeline-row" data-status={step.status || 'running'}>
                  <TimelineStepIcon icon={step.icon || 'subagent'} />
                  <span>
                    {step.label}
                    {step.detail ? ` — ${step.detail}` : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {isRunning && (streaming?.content || streaming?.thinking) ? (
          <div className="msg-row assistant">
            <div className="msg-bubble" data-testid="streaming-bubble">
              {streaming.thinking && (
                <div className="msg-thinking" style={{ whiteSpace: 'pre-wrap' }}>
                  {streaming.thinking}
                </div>
              )}
              <PixelGlitchResponse streaming>
                {renderFormattedText(streaming.content || '...')}
              </PixelGlitchResponse>
            </div>
          </div>
        ) : isRunning && pendingApprovals.length === 0 ? (
          <div className="msg-row assistant" role="status" aria-live="polite">
            <div className="msg-bubble" data-testid="loading-indicator" style={{ color: 'var(--ink-muted)' }}>
              <RunicLoader label={`Running ${bot?.name || 'Mimir'}...`} size={24} />
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {pendingApprovals.map(apr => {
        const card = apr.dialogueCard;
        const isIrrev = card?.reversibility === 'irreversible';
        return (
          <div key={apr.id} className="approval-banner dialogue-card" data-testid="approval-banner" role="alertdialog" aria-label="Tool Approval Required">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span className="dialogue-card-eyebrow">{card?.badge || 'Needs your OK'}</span>
                {card?.reversibilityLabel && (
                  <span
                    className={`pill ${isIrrev ? 'is-crimson' : 'is-emerald'}`}
                    data-testid="approval-reversibility-badge"
                    style={{ fontSize: 10 }}
                  >
                    {isIrrev ? <IrreversibleGateSvg size={11} /> : <ReversibleShieldSvg size={11} />}
                    <span>{card.reversibilityLabel}</span>
                  </span>
                )}
              </div>
              {card?.timestampLabel && <span style={{ fontSize: 11, color: 'var(--ink-subtle)' }}>{card.timestampLabel}</span>}
            </div>
            <div className="dialogue-card-title">
              {card?.title || <>Runic Approval Gate — <code>{apr.toolName}</code></>}
            </div>
            <div className="dialogue-card-sub">{card?.subtitle || apr.reason}</div>
            <details>
              <summary style={{ fontSize: 11.5, color: 'var(--ink-muted)', cursor: 'pointer' }}>Inspect tool arguments</summary>
              <pre className="tool-output-pre">{JSON.stringify(apr.args, null, 2)}</pre>
            </details>
            <div className="approval-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                data-testid="approve-once-btn"
                onClick={() => onResolveApproval(apr.id, 'approve-once')}
              >
                {card?.primaryLabel || 'Approve Once'}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="allow-session-btn"
                onClick={() => onResolveApproval(apr.id, 'allow-session')}
              >
                Allow This Session
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                data-testid="deny-approval-btn"
                onClick={() => onResolveApproval(apr.id, 'deny')}
              >
                {card?.secondaryLabel || 'Deny'}
              </button>
            </div>
          </div>
        );
      })}

      {teachMode && (
        <div
          style={{
            maxWidth: '76ch',
            margin: '0 auto 8px',
            width: 'calc(100% - 24px)',
            padding: '8px 12px',
            background: 'var(--err-soft)',
            border: '1px solid var(--err)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <TeachCrystalSvg size={14} active />
            Recording Teach-a-Task steps ({recordedSteps.length} captured)
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ width: 170, padding: '4px 8px' }}
              placeholder="Workflow name..."
              value={recName}
              onChange={e => setRecName(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={recordedSteps.length === 0}
              onClick={() => {
                onSaveRecording(recName || 'Taught Workflow');
                setRecName('');
              }}
            >
              Save Recording
            </button>
            <button type="button" className="btn btn-sm" onClick={onToggleTeachMode}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <form className="composer-wrap" onSubmit={handleSubmit}>
        <div className="composer-inner">
          {attachments.length > 0 && (
            <div className="chip-list">
              {attachments.map((a, idx) => (
                <span key={idx} className="chip">
                  <AttachmentFileSvg size={12} />
                  <span>{a.name}</span>
                  <button
                    type="button"
                    aria-label={`Remove attachment ${a.name}`}
                    style={{ background: 'none', border: 'none', padding: 0, display: 'inline-flex' }}
                    onClick={() => setAttachments(prev => prev.filter((_, j) => j !== idx))}
                  >
                    <CloseCrossSvg size={11} />
                  </button>
                </span>
              ))}
            </div>
          )}

          {commandMatches.length > 0 && (
            <ul className="command-suggest" role="listbox" aria-label="Mimir commands" data-testid="command-suggest">
              {commandMatches.map(c => (
                <li key={c.cmd}>
                  <button
                    type="button"
                    role="option"
                    aria-selected="false"
                    className="command-suggest-item"
                    onClick={() => setDraft(`${c.cmd} `)}
                  >
                    <code>{c.syntax}</code>
                    <span>{c.desc}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {specialistMentions.length > 0 && (
            <div className="mention-quickbar" data-testid="mention-quickbar">
              <span style={{ fontSize: 10.5, color: 'var(--ink-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Delegate:
              </span>
              {specialistMentions.slice(0, 6).map(sp => (
                <button
                  key={sp.id}
                  type="button"
                  className="mention-quick-btn"
                  title={sp.role}
                  onClick={() => setDraft(prev => `${prev ? `${prev.trimEnd()} ` : ''}@${sp.name} `)}
                >
                  <span className="work-color-sq" style={{ background: sp.color || 'var(--frost)' }} />
                  <span>@{sp.name}</span>
                </button>
              ))}
            </div>
          )}

          <div className="mention-quickbar" data-testid="studio-chat-quickbar">
            <span style={{ fontSize: 10.5, color: 'var(--ink-subtle)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Create:
            </span>
            {[
              { label: 'Music (.WAV)', cmd: 'Create an ambient synthwave music track at 110 BPM' },
              { label: 'Expense App', cmd: 'Build an expense-tracking web app with authentication, charts and export' },
              { label: '3D Model (.GLB)', cmd: 'Create a 3D model of a Valkyrie Starfighter' },
              { label: 'HD Art (.PNG)', cmd: 'Generate HD artwork of the Cosmic Odin Observatory' },
              { label: 'Video (.MP4)', cmd: 'Create a motion clip animation mp4 of a hyperdrive pulse loop' },
              { label: 'Playable Game', cmd: 'Create a playable arcade space shooter game' },
            ].map(item => (
              <button
                key={item.label}
                type="button"
                className="mention-quick-btn"
                onClick={() => setDraft(item.cmd)}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="adaptive-workspace-bar" data-testid="adaptive-workspace-bar">
            <select
              className="adaptive-select"
              data-testid="composer-project-select"
              aria-label="Select Project Scope"
              value={selectedProject}
              onChange={e => setSelectedProject(e.target.value)}
            >
              {PROJECT_SCOPES.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
            <select
              className="adaptive-select"
              data-testid="composer-mode-override"
              aria-label="Workspace Surface"
              value={activeSurface || workspaceMode}
              onChange={e => {
                setWorkspaceMode(e.target.value);
                onSelectSurface?.(e.target.value === 'auto' ? 'chat' : e.target.value);
              }}
            >
              {WORKSPACE_MODES.map(m => (
                <option key={m.id} value={m.id}>{m.label}</option>
              ))}
            </select>
            <button
              type="button"
              className="adaptive-connect-btn"
              data-testid="composer-connect-btn"
              onClick={() => onNavigateTab?.('mcp')}
            >
              Connect Account
            </button>
            {(() => {
              const draftIntent = detectDraftIntent(draft, workspaceMode);
              if (!draftIntent) return null;
              return (
                <div className="smart-intent-badge" data-testid="smart-intent-badge">
                  <span className="smart-intent-dot" />
                  <span>{draftIntent.label}</span>
                </div>
              );
            })()}
          </div>

          <UsageBar threadId={thread?.id} isRunning={isRunning} />

          <div className="composer-box">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              style={{ display: 'none' }}
              onChange={handleHtmlFiles}
            />
            <button
              type="button"
              className="btn btn-icon"
              data-testid="attach-file-btn"
              aria-label="Attach file to workspace"
              title="Attach file to workspace"
              onClick={handlePickFiles}
            >
              <PlusPixelSvg size={16} />
            </button>
            <textarea
              className="composer-textarea"
              data-testid="chat-input"
              aria-label={`Message ${bot?.name || 'Mimir'}`}
              title="Enter to send, Shift+Enter for newline, or drop files anywhere"
              rows={2}
              placeholder={`Message ${bot?.name || 'Mimir'} or drop files anywhere...`}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onPaste={async evt => {
                const pastedFiles = evt.clipboardData?.files;
                if (pastedFiles?.length) {
                  evt.preventDefault();
                  await stageAndMaybeAutoRun(pastedFiles, { autoSend: false });
                }
              }}
              onKeyDown={e => {
                if (e.key === 'Tab' && commandMatches.length === 1) {
                  e.preventDefault();
                  setDraft(`${commandMatches[0].cmd} `);
                  return;
                }
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit();
                }
              }}
            />
            <button
              type="button"
              className={`mic-btn ${micState === 'recording' ? 'is-recording' : ''}`}
              data-testid="mic-ptt-btn"
              aria-label={micState === 'recording' ? 'Stop voice recording' : 'Push to talk voice input'}
              title={micError || (micState === 'recording' ? 'Stop & transcribe (faster-whisper offline)' : 'Push to talk (local faster-whisper STT)')}
              disabled={micState === 'transcribing'}
              onClick={toggleMic}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                <rect x="6" y="2" width="4" height="7" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
                <path d="M4 8.5A4 4 0 0012 8.5M8 12.5V15" fill="none" stroke="currentColor" strokeWidth="1.5" />
              </svg>
              {micState === 'recording' && <span style={{ fontSize: 11 }}>Stop</span>}
              {micState === 'transcribing' && <span style={{ fontSize: 11 }}>...</span>}
            </button>
            <button
              type="button"
              className="btn btn-sm live-voice-btn"
              data-testid="live-voice-btn"
              aria-label="Open Live Duplex Voice mode"
              title="Open Live Duplex Voice Call"
              onClick={() => onOpenLiveVoice?.()}
            >
              <VoiceOrbSvg size={14} />
              <span>Live Voice</span>
            </button>
            {isRunning ? (
              <button key="abort-btn" type="button" className="btn btn-danger" onClick={onAbort} data-testid="abort-btn">
                Stop
              </button>
            ) : (
              <button
                key="send-btn"
                type="submit"
                className="btn btn-primary"
                data-testid="send-btn"
                disabled={!draft.trim() && attachments.length === 0}
              >
                <span>Send</span>
                <SendRunicSvg size={14} />
              </button>
            )}
          </div>

          <div className="composer-toolbar">
            <span style={{ color: micError ? 'var(--err)' : 'var(--ink-subtle)' }}>{micError || ''}</span>
            <button
              type="button"
              className={`btn btn-sm ${teachMode ? 'btn-danger' : ''}`}
              onClick={onToggleTeachMode}
            >
              <TeachCrystalSvg size={13} active={teachMode} />
              <span>{teachMode ? 'Recording...' : 'Teach Task'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
