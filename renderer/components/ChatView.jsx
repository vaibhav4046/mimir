import { ContextGraphChip } from './ContextGraphChip.jsx';
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { apiFetch, encodeFilesForStaging, fetchArtifactBlob, isFileDragEvent } from '../api.js';
import { BotAvatar } from './BotAvatar.jsx';
import { HairlineCanvas } from './HairlineCanvas.jsx';
import { IntelligentUiRenderer } from './IntelligentUiRenderer.jsx';
import { UsageBar } from './UsageBar.jsx';

const CreativeStudioPlayer = React.lazy(() =>
  import('./CreativeStudioPlayer.jsx').then(m => ({ default: m.CreativeStudioPlayer }))
);
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
  { id: 'agent', label: 'Do tasks', hint: 'Can use the web, files and apps for you' },
  { id: 'code', label: 'Write code', hint: 'Writes and runs code', Icon: CodeModeSvg },
  { id: 'chat', label: 'Just talk', hint: 'Answers only, changes nothing' },
];

const SMART_ACTION_CARDS = [
  {
    title: 'Research report',
    subtitle: 'Looks things up and writes a report you can download',
    prompt: 'Gather multi-domain research on AI agents and 3D pipelines',
  },
  {
    title: 'Expense tracker app',
    subtitle: 'A small app with login, charts and export',
    prompt: 'Build an expense-tracking web app with authentication, charts and export',
  },
  {
    title: 'Make music',
    subtitle: 'Creates a short music track you can play',
    prompt: 'Create an ambient synthwave music track at 110 BPM',
  },
  {
    title: '3D model',
    subtitle: 'Makes a 3D object and checks it twice',
    prompt: 'Create a 3D model of a Valkyrie Starfighter',
  },
  {
    title: 'How Mimir works',
    subtitle: 'A plain tour of what happens when you ask something',
    prompt: 'Reverse-engineer how this app works with REA',
  },
  {
    title: 'Make a game',
    subtitle: 'Builds a small game you can play right here',
    prompt: 'Create a playable arcade space shooter game with cyber lasers',
  },
];

function detectDraftIntent(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;
  if (text.startsWith('/')) {
    return { kind: 'command', label: `Shortcut ${text.split(/\s+/)[0]}` };
  }
  if (/(?:^|\s)@[a-zA-Z0-9_-]+/.test(text) || /\b(?:ask\s+the\s+team|have\s+the\s+team|grok\s*bot\s+team|team\s+launch\s+brief)\b/i.test(text)) {
    return { kind: 'team', label: 'Will ask your team' };
  }
  if (/\b(?:wav|music|song|soundtrack|audio\s+track|lofi|synthwave|beat|melody|\d+\s*bpm)\b/i.test(text) && /\b(create|make|build|generate|forge|design|compose|produce)\b/i.test(text)) {
    return { kind: 'music', label: 'Will make music' };
  }
  if (/\b(?:3d\s*model|3d\s*mesh|glb|obj|stl)\b/i.test(text) && /\b(create|make|build|generate|forge|design|render)\b/i.test(text)) {
    return { kind: 'dream3d', label: 'Will make a 3D model' };
  }
  if (/\b(?:video|animation|motion\s+clip|webm|mp4|gif)\b/i.test(text) && /\b(create|make|build|generate|forge|render|animate)\b/i.test(text)) {
    return { kind: 'dreamvideo', label: 'Will make a video' };
  }
  if (/\b(?:playable\s+game|video\s*game|arcade\s+game|browser\s+game|space\s+shooter|dungeon\s+crawler|brick\s+breaker)\b/i.test(text)) {
    return { kind: 'dreamgame', label: 'Will make a game' };
  }
  if (/\b(?:web\s*app|webapp|expense[- ]tracker|full[- ]?stack\s+(?:web\s*)?app|interactive\s+web)\b/i.test(text) && /\b(create|make|build|generate|forge|design)\b/i.test(text)) {
    return { kind: 'dreamwebapp', label: 'Will build an app' };
  }
  if (/\b(?:hd\s+image|artwork|concept\s+art|poster|illustration|svg\s+diagram)\b/i.test(text) && /\b(create|make|build|generate|forge|design|render)\b/i.test(text)) {
    return { kind: 'dreamart', label: 'Will make a picture' };
  }
  if (/\b(?:run|execute|start)\s+(?:a\s+|the\s+)?brutal\b|\bbrutal\s*(?:8\/8|stress|self[- ]?test|test\s*suite|audit)\b/i.test(text)) {
    return { kind: 'brutal', label: 'Will run the self-test' };
  }
  if (/\breverse[- ]engineer\b|\brea\s+(?:x[- ]?ray|inspect|architecture|scan)\b|\bhow\s+(?:this|the)\s+(?:app|site|system|codebase|mimir)\s+works\b/i.test(text)) {
    return { kind: 'rea', label: 'Will explain how it works' };
  }
  if (/\b(?:automate|schedule|set\s*up)\b.*\b(?:research|harvester|harvest|monitoring|briefings?)\b|\brun\s+research\s+every\b/i.test(text)) {
    return { kind: 'automate', label: 'Will schedule research' };
  }
  if (/\b(?:gather|collect|run|harvest)\b.*\b(?:multi[- ]domain\s+)?(?:research|data)\b|\bresearch\s+harvester\b|\bmulti[- ]domain\s+research\b/i.test(text)) {
    return { kind: 'harvest', label: 'Will gather research' };
  }
  if (/^(?:please\s+|can\s+you\s+)?(?:deep[- ]?research|research(?:\s+(?:about|on|into|for))?|investigate|write\s+(?:a|an)\s+(?:deep\s+)?research\s+report\s+(?:on|about)|analyze\s+and\s+report\s+on|find\s+out\s+about)\s+.{3,}/i.test(text) || /\b(?:research\s+report|deep\s+research|comprehensive\s+report)\s+(?:on|about|into|for)\s+.{3,}/i.test(text)) {
    return { kind: 'deep', label: 'Will write a research report' };
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

function ResearchStepper({ progress, live = false }) {
  if (!progress) return null;
  const phase = progress.phase || (live ? 'planning' : 'synthesizing');
  const subQueries = Array.isArray(progress.subQueries) ? progress.subQueries : [];
  const fetchedSources = Array.isArray(progress.fetchedSources) ? progress.fetchedSources : [];
  const isOffline = progress.offlineFallback || progress.mode === 'offline';
  const modeLabel = isOffline
    ? 'Mode: Offline Corpus'
    : progress.mode === 'live'
      ? 'Mode: Live Web'
      : 'Mode: Auto';

  return (
    <details className="research-stepper" data-testid="research-stepper" open={live}>
      <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span>Research progress: {phase}</span>
        <span className={`pill ${isOffline ? 'is-gold' : 'is-cyan'}`} style={{ fontSize: 10 }}>
          {modeLabel}
        </span>
      </summary>
      <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {subQueries.length > 0 && (
          <div className="research-step-row">
            <span className="muted" style={{ fontSize: 11 }}>Queries:</span>
            <span>{subQueries.join(' · ')}</span>
          </div>
        )}
        {fetchedSources.map((src, idx) => (
          <div key={src.url || src.title || idx} className="research-step-row">
            <span className={`pill ${src.status === 'verified' || src.status === 'ok' ? 'is-emerald' : 'is-gold'}`} style={{ fontSize: 10 }}>
              {src.status || 'checked'}
            </span>
            <span style={{ fontWeight: 600 }}>{src.title || src.url || 'Source'}</span>
            {src.snippet && <span className="muted" style={{ fontSize: 11 }}>{src.snippet}</span>}
          </div>
        ))}
        {typeof progress.verifiedClaims === 'number' && (
          <div className="muted" style={{ fontSize: 11 }}>
            Verified claims: {progress.verifiedClaims}
          </div>
        )}
      </div>
    </details>
  );
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
      setExportStatus('All 9 files ready to download.');
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
              <strong>{m.reaCard.title || 'How this app works'}</strong>
              <div className="muted num">
                {m.reaCard.metrics?.filesScanned || 0} files scanned · {(m.reaCard.metrics?.totalLines || 0).toLocaleString()} lines · {m.reaCard.metrics?.routesCount || 0} routes
              </div>
            </div>
            <span className="pill is-cyan">Code check</span>
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

      {m.researchCard && (() => {
        const rc = m.researchCard;
        const isOffline = Boolean(rc.offlineFallback || rc.mode === 'offline');
        const verifiedCount = Array.isArray(rc.verifiedUrls)
          ? rc.verifiedUrls.length
          : Number(rc.verifiedUrls || 0);
        const corpusCount = Array.isArray(rc.corpusHits)
          ? rc.corpusHits.length
          : Number(rc.corpusHits || 0);
        const hasCounts = rc.verifiedUrls !== undefined || rc.corpusHits !== undefined;
        const modeText = isOffline ? 'Offline Corpus' : rc.mode === 'live' ? 'Live Web' : 'Auto';
        return (
          <div className="chat-insight-card chat-research-card" data-testid="chat-research-card">
            <div className="insight-card-head">
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <strong>{rc.title || `Research Report · ${rc.packId || 'all'}`}</strong>
                  <span className={`pill ${isOffline ? 'is-gold' : 'is-cyan'}`} style={{ fontSize: 10 }}>
                    {modeText}
                  </span>
                </div>
                <div className="muted num">
                  {rc.topicsCount || 1} topics ·{' '}
                  {hasCounts
                    ? `${verifiedCount} verified web URLs · ${corpusCount} corpus notes`
                    : `${rc.totalSources || 0} ${isOffline ? 'corpus entries' : 'web sources'}`}{' '}
                  · {rc.knowledgeIngestion?.chunksAdded || 0} saved notes
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-sm"
                  data-testid="research-copy-md-btn"
                  onClick={handleCopyMarkdown}
                >
                  {copiedMd ? 'Copied' : 'Copy text'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  data-testid="research-reader-toggle"
                  onClick={() => setReaderOpen(v => !v)}
                >
                  {readerOpen ? 'Hide reader' : 'Read here'}
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  data-testid="research-automate-btn"
                  disabled={autoState === 'saving' || autoState === 'done'}
                  onClick={() => triggerHourlyAutomate(rc.packId)}
                >
                  {autoState === 'done'
                    ? 'Runs every hour'
                    : autoState === 'saving'
                      ? 'Saving...'
                      : autoState === 'error'
                        ? 'Try again'
                        : 'Run every hour'}
                </button>
              </div>
            </div>

            {(rc.fetchedSources?.length > 0 || rc.subQueries?.length > 0) && (
              <ResearchStepper progress={rc} />
            )}

            <div className="research-doc-shelf" data-testid="research-doc-downloads">
              <div className="research-doc-shelf-head">
                <span className="muted" style={{ fontSize: 11.5, fontWeight: 600 }}>
                  Download report files ({Object.keys(docsByFmt).length}/9 ready)
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  data-testid="research-export-all-btn"
                  disabled={Boolean(busyFmt)}
                  onClick={handleExportAll}
                >
                  {busyFmt === 'all' ? 'Creating all...' : 'Create all 9 files'}
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
                      title={`${title}${readyDoc?.size_bytes ? ` (${Math.max(1, Math.round(readyDoc.size_bytes / 1024))} KB)` : ': click to generate & download'}`}
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
                {renderFormattedText(rc.reportMarkdown || m.content || '')}
              </div>
            )}

            {rc.csvPath && (
              <div className="muted" style={{ fontSize: 11.5 }}>
                Workspace CSV: <code>{rc.csvPath}</code>
              </div>
            )}
          </div>
        );
      })()}

      {m.brutalReport && (
        <div className="chat-insight-card chat-brutal-card" data-testid="chat-brutal-card">
          <div className="insight-card-head">
            <strong>System self-test</strong>
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
            <strong>Scheduled check · {m.automationCard.packId}</strong>
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
  'The well runs deep today. What shall we look into?',
  'Ask plainly and I will answer plainly, and tell you what I have not checked.',
  'One place for all your work. Where do we start?',
  'A good memory makes work easy. Put mine to work.',
  'Tell me what you need and I will walk you through it.',
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
      audio.onerror = () => setState('error');
      await audio.play();
      setState('playing');
    } catch {
      setState('error');
    }
  };

  useEffect(() => {
    if (autoPlay) play();
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        audioRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- play once on mount only
  }, []);

  const label = { idle: 'Read aloud', loading: 'Loading…', playing: 'Stop', error: 'Voice not available' }[state];
  return (
    <button type="button" className="speak-btn" data-state={state} onClick={play} disabled={state === 'loading'} aria-label={`${label} this reply`}>
      {label}
    </button>
  );
}

function renderSafeLinks(text, keyPrefix) {
  return String(text || '')
    .split(/(\[[^\]]+\]\(https?:\/\/[^\s)]+\))/g)
    .map((part, idx) => {
      const m = part.match(/^\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)$/);
      if (m) {
        return (
          <a key={`${keyPrefix}-lnk-${idx}`} href={m[2]} target="_blank" rel="noopener noreferrer" className="md-link">
            {m[1]}
          </a>
        );
      }
      return String(part)
        .split(/(\[S\d+\])/g)
        .map((cPart, cIdx) => {
          if (/^\[S\d+\]$/.test(cPart)) {
            return (
              <span key={`${keyPrefix}-c${idx}-${cIdx}`} className="cite-badge">
                {cPart}
              </span>
            );
          }
          return String(cPart)
            .split(/(@[A-Za-z][A-Za-z0-9_-]*)/g)
            .map((seg, sIdx) =>
              sIdx % 2 === 1 ? (
                <span key={`${keyPrefix}-m${idx}-${cIdx}-${sIdx}`} className="mention-pill">
                  {seg}
                </span>
              ) : (
                seg
              )
            );
        });
    });
}

function renderItalic(text, keyPrefix) {
  return String(text || '')
    .split(/\*([^*\n]+)\*/g)
    .map((part, idx) =>
      idx % 2 === 1 ? (
        <em key={`${keyPrefix}-em${idx}`}>{renderSafeLinks(part, `${keyPrefix}-emi${idx}`)}</em>
      ) : (
        renderSafeLinks(part, `${keyPrefix}-rl${idx}`)
      )
    );
}

function renderBold(text, keyPrefix) {
  return String(text || '')
    .split(/\*\*([^*]+)\*\*/g)
    .map((part, idx) =>
      idx % 2 === 1 ? (
        <strong key={`${keyPrefix}-b${idx}`}>{renderItalic(part, `${keyPrefix}-bi${idx}`)}</strong>
      ) : (
        renderItalic(part, `${keyPrefix}-m${idx}`)
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

function CodeBlock({ lang, code, onOpenInCanvas }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  };
  return (
    <div className="code-block-wrap" style={{ margin: '8px 0' }}>
      <div className="code-block-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 11, color: 'var(--ink-subtle)', padding: '4px 10px', borderBottom: '1px solid var(--border-soft, var(--rule))' }}>
        <span>{lang || 'code'}</span>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {onOpenInCanvas && (
            <button
              type="button"
              className="btn btn-sm"
              data-testid="open-in-canvas-btn"
              onClick={() => onOpenInCanvas({
                path: '',
                content: code,
                language: lang || 'text',
                title: lang ? `${lang} snippet` : 'Code snippet',
              })}
            >
              Open in Canvas
            </button>
          )}
          <button type="button" className="btn btn-sm" onClick={copy} data-testid="copy-code-btn">
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
      <pre className="code-block" style={{ margin: 0, borderTop: 'none', borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
        <code>{code}</code>
      </pre>
    </div>
  );
}

function renderFormattedText(text, onOpenInCanvas = null) {
  const str = String(text || '');
  const parts = str.split(/```([\s\S]*?)```/g);
  return parts.map((chunk, i) => {
    if (i % 2 === 1) {
      const firstNewline = chunk.indexOf('\n');
      const lang = firstNewline > -1 ? chunk.slice(0, firstNewline).trim() : '';
      const code = (firstNewline > -1 ? chunk.slice(firstNewline + 1) : chunk).trimEnd();
      return <CodeBlock key={i} lang={lang} code={code} onOpenInCanvas={onOpenInCanvas} />;
    }
    return <div key={i} className="md-block">{parseMarkdownBlock(chunk, `md-${i}`)}</div>;
  });
}

function resolveActiveBranchMessages(thread) {
  const msgs = Array.isArray(thread?.messages) ? thread.messages : [];
  if (msgs.length === 0) return [];
  if (!thread.activeLeafId && !msgs.some(m => m?.parentId !== undefined)) {
    return msgs;
  }
  const byId = new Map();
  const indexById = new Map();
  msgs.forEach((m, idx) => {
    if (m?.id) {
      byId.set(m.id, m);
      indexById.set(m.id, idx);
    }
  });
  const targetLeafId =
    (thread.activeLeafId && byId.has(thread.activeLeafId) ? thread.activeLeafId : null) ||
    msgs[msgs.length - 1]?.id ||
    null;
  if (!targetLeafId) return msgs;

  const chain = [];
  const visited = new Set();
  let curId = targetLeafId;
  while (curId && byId.has(curId) && !visited.has(curId)) {
    visited.add(curId);
    const node = byId.get(curId);
    chain.push(node);
    if (node.parentId !== undefined) {
      curId = node.parentId;
    } else {
      const idx = indexById.get(curId);
      curId = idx > 0 ? msgs[idx - 1]?.id || null : null;
    }
  }
  return chain.length > 0 ? chain.reverse() : msgs;
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
  onSwitchThreadBot,
  onForkThread,
  onBranchEditMessage,
  onExportThread,
  onOpenInCanvas,
  researchMode = 'auto',
  onChangeResearchMode,
  researchProgress = null,
  pendingDraftCommand = '',
  onConsumeDraftCommand,
  onOpenLiveVoice,
  teachMode,
  recordedSteps,
  onToggleTeachMode,
  onSaveRecording,
  onNavigateTab,
  mimirAvatarState = 'IDLE',
  staticAvatar = false,
  onUiAction,
}) {
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [recName, setRecName] = useState('');
  const [commands, setCommands] = useState([]);
  const [micState, setMicState] = useState('idle'); // idle | recording | transcribing | error
  const [micError, setMicError] = useState('');
  const [sendError, setSendError] = useState('');
  const [sending, setSending] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);
  const [personaBusy, setPersonaBusy] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [dropBusy, setDropBusy] = useState(false);
  const [showScrollLatest, setShowScrollLatest] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [mentionDismissedQuery, setMentionDismissedQuery] = useState(null);
  const [editingMessage, setEditingMessage] = useState(null);
  const [copiedMsgId, setCopiedMsgId] = useState('');
  const [isNarrowViewport, setIsNarrowViewport] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= 768
  );
  const [mobileQuickbarsOpen, setMobileQuickbarsOpen] = useState(false);
  const [quickMakeOpen, setQuickMakeOpen] = useState(false);
  const [localResearchMode, setLocalResearchMode] = useState(researchMode || 'auto');
  const [greeting] = useState(() => MIMIR_GREETINGS[Math.floor(Math.random() * MIMIR_GREETINGS.length)]);
  const endRef = useRef(null);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const fileInputRef = useRef(null);
  const recorderRef = useRef(null);
  const micStreamRef = useRef(null);
  const dragDepthRef = useRef(0);
  const specialistMentions = teamBots.filter(
    b => b.id !== bot?.id && (b.parentBotId === bot?.id || b.specialistTag || b.isTeamBot)
  );
  const effectiveResearchMode = onChangeResearchMode ? researchMode : localResearchMode;
  const setEffectiveResearchMode = nextMode => {
    setLocalResearchMode(nextMode);
    onChangeResearchMode?.(nextMode);
  };

  useEffect(() => {
    const onResize = () => setIsNarrowViewport(window.innerWidth <= 768);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (!pendingDraftCommand) return;
    setDraft(pendingDraftCommand);
    onConsumeDraftCommand?.();
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [pendingDraftCommand, onConsumeDraftCommand]);

  useEffect(() => {
    setEditingMessage(null);
  }, [thread?.id]);

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
  const activeSlashIdx = commandMatches.length ? Math.min(slashIndex, commandMatches.length - 1) : 0;

  const mentionMatch = commandMatches.length === 0 ? draft.match(/(?:^|\s)@([^\s@]*)$/) : null;
  const mentionQuery = mentionMatch ? mentionMatch[1].toLowerCase() : null;
  const mentionMatches =
    mentionQuery !== null && mentionDismissedQuery !== mentionQuery
      ? teamBots.filter(
          b =>
            b.name.toLowerCase().includes(mentionQuery) ||
            String(b.role || '').toLowerCase().includes(mentionQuery) ||
            String(b.specialistTag || '').toLowerCase().includes(mentionQuery)
        )
      : [];
  const activeMentionIdx = mentionMatches.length ? Math.min(mentionIndex, mentionMatches.length - 1) : 0;

  const applyMention = chosenBot => {
    if (!chosenBot) return;
    setDraft(prev => prev.replace(/@[^\s@]*$/, `@${chosenBot.name} `));
    setMentionDismissedQuery(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  useEffect(() => {
    setSlashIndex(0);
    setMentionIndex(0);
    if (mentionQuery === null) setMentionDismissedQuery(null);
  }, [draft, mentionQuery]);

  useEffect(() => {
    if (stickToBottomRef.current) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [thread?.messages?.length, thread?.activeLeafId, streaming?.content, pendingApprovals?.length]);

  const handleChatScroll = evt => {
    const el = evt.currentTarget;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    stickToBottomRef.current = nearBottom;
    setShowScrollLatest(!nearBottom && (messages.length > 0 || isRunning));
  };

  const sendDraftPayload = async (text, staged) => {
    setSending(true);
    setSendError('');
    stickToBottomRef.current = true;
    try {
      if (editingMessage && onBranchEditMessage) {
        await onBranchEditMessage(editingMessage.id, text, { researchMode: effectiveResearchMode });
        setEditingMessage(null);
      } else {
        await onSendMessage(text || 'Inspect attached files.', staged, { researchMode: effectiveResearchMode });
      }
      setDraft('');
      setAttachments([]);
      return true;
    } catch (err) {
      setSendError(err?.message || 'Failed to send message. Your draft was kept.');
      return false;
    } finally {
      setSending(false);
    }
  };

  const handleSubmit = async e => {
    e?.preventDefault();
    if (sending) return;
    const text = draft.trim();
    if (!text && attachments.length === 0) return;
    await sendDraftPayload(text, [...attachments]);
  };

  const stageAndMaybeAutoRun = async (fileList, { autoSend = false } = {}) => {
    const rawFiles = Array.from(fileList || []).filter(Boolean);
    if (!rawFiles.length) return;
    setDropBusy(true);
    setMicError('');
    setSendError('');
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
        const names = staged.map(f => f.name).join(', ');
        const ok = await sendDraftPayload(
          customPrompt || `Inspect and work on dropped file(s): ${names}`,
          merged
        );
        if (!ok) setAttachments(merged);
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
      try {
        const files = await window.desktop.pickAttachmentFiles();
        if (files?.length) {
          const res = await onStageFiles(files);
          setAttachments(prev => [...prev, ...res]);
        }
      } catch (err) {
        setSendError(err?.message || 'Failed attaching selected file(s).');
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

  const messages = resolveActiveBranchMessages(thread);
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
          <ContextGraphChip />
          {teamBots.length > 1 && onSwitchThreadBot && (
            <select
              className="select"
              data-testid="persona-switcher"
              aria-label="Switch teammate for this chat"
              title="Switch persona without clearing chat history"
              disabled={personaBusy || isRunning}
              value={bot?.id || ''}
              style={{ width: 'auto', minHeight: 28, padding: '2px 8px', fontSize: 11.5 }}
              onChange={async e => {
                const nextId = e.target.value;
                if (!nextId || nextId === bot?.id) return;
                setPersonaBusy(true);
                try {
                  await onSwitchThreadBot(nextId);
                } finally {
                  setPersonaBusy(false);
                }
              }}
            >
              {teamBots.map(b => (
                <option key={b.id} value={b.id}>
                  Persona: {b.name}
                </option>
              ))}
            </select>
          )}
          <select
            className="select"
            data-testid="research-mode-select"
            aria-label="Research mode"
            title="Choose whether research uses live web or offline corpus"
            value={effectiveResearchMode}
            style={{ width: 'auto', minHeight: 28, padding: '2px 8px', fontSize: 11.5 }}
            onChange={e => setEffectiveResearchMode(e.target.value)}
          >
            <option value="auto">Research: Auto</option>
            <option value="live">Research: Live Web</option>
            <option value="offline">Research: Offline Corpus</option>
          </select>
          {thread?.id && messages.length > 0 && onForkThread && (
            <button
              type="button"
              className="btn btn-sm"
              data-testid="fork-thread-btn"
              title="Fork conversation into a new branch thread"
              disabled={isRunning}
              onClick={() => onForkThread(messages[messages.length - 1]?.id)}
            >
              Fork
            </button>
          )}
          {thread?.id && messages.length > 0 && onExportThread && (
            <button
              type="button"
              className="btn btn-sm"
              data-testid="export-thread-md-btn"
              title="Export conversation as Markdown (.md)"
              onClick={() => onExportThread('md')}
            >
              Export .md
            </button>
          )}
          {bot?.specialistTag && (
            <span className="status-pill badge-specialist">
              {bot.specialistTag === 'chief-of-staff'
                ? 'Team lead'
                : bot.specialistTag.replace(/-/g, ' ')}
            </span>
          )}
        </div>
      </div>

      <div className="chat-scroll" ref={scrollRef} onScroll={handleChatScroll} data-testid="chat-messages">
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
              Ask in plain words, talk, or drop in files. Mimir can research, write, build small apps, and make music, pictures, videos and 3D models.
            </p>
            <div className="smart-prompt-grid" data-testid="smart-prompt-grid">
              {SMART_ACTION_CARDS.map(card => (
                <button
                  key={card.title}
                  type="button"
                  className="smart-prompt-card"
                  onClick={() => onSendMessage(card.prompt, [], { researchMode: effectiveResearchMode })}
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
            const badgeText = isDenied ? 'You said no' : isFailed ? 'Did not work' : 'Done';
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
                      <span>Used: {String(m.toolName).replace(/_/g, ' ')}</span>
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
                      {isDenied ? 'Reason blocked' : isFailed ? 'Error details' : 'Details'}
                    </summary>
                    {m.toolArgs && Object.keys(m.toolArgs).length > 0 && (
                      <>
                        <div className="tool-section-label">What was asked</div>
                        <pre className="tool-output-pre">{JSON.stringify(m.toolArgs, null, 2)}</pre>
                      </>
                    )}
                    <div className="tool-section-label">
                      {isDenied ? 'Reason' : isFailed ? 'Error' : 'Result'}
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
                <details className="timeline-steps timeline-accordion" data-testid="timeline-steps">
                  <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)' }}>
                    Steps ({m.timelineSteps.length})
                  </summary>
                  <div style={{ marginTop: 6 }}>
                    {m.timelineSteps.map((step, sIdx) => (
                      <div key={step.id || sIdx} className="timeline-row" data-status={step.status || 'done'}>
                        <TimelineStepIcon icon={step.icon} />
                        <span>{step.label}</span>
                      </div>
                    ))}
                  </div>
                </details>
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
                    <summary style={{ cursor: 'pointer', fontWeight: 700 }}>How it thought</summary>
                    <div style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{m.thinking}</div>
                  </details>
                )}
                {hasText &&
                  (m.role === 'assistant' ? (
                    <PixelGlitchResponse
                      isNew={msgIdx === messages.length - 1}
                      isError={Boolean(m.isError)}
                    >
                      {renderFormattedText(m.content, onOpenInCanvas)}
                    </PixelGlitchResponse>
                  ) : (
                    <div>{renderFormattedText(m.content, onOpenInCanvas)}</div>
                  ))}
                {pendingToolCalls.length > 0 && (
                  <div className="chip-list" style={{ marginTop: hasText ? 8 : 0 }}>
                    {pendingToolCalls.map((tc, idx) => (
                      <span key={tc.id || idx} className="chip">
                        About to use: {String(tc.name).replace(/_/g, ' ')}
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
                  <Suspense fallback={null}>
                    {m.artifacts.map(art => (
                      <CreativeStudioPlayer key={art.id} artifact={art} compact />
                    ))}
                  </Suspense>
                </div>
              )}
              {/* Receipts stay internal; only a reply that claims work it did not do is flagged. */}
              {m.role === 'assistant' && m.receipt?.unbackedClaims?.length > 0 && (
                <div className="unbacked-warning" role="alert" data-testid="unbacked-claim-warning">
                  This reply mentions actions that did not run: {m.receipt.unbackedClaims.map(c => c.label || c.text).join('; ')}
                </div>
              )}
              {(m.branchGroupId || m.branchCount > 1) && (
                <div className="msg-branch-bar">
                  <span>Branch {m.branchIndex || 1}{m.branchCount ? ` of ${m.branchCount}` : ''}</span>
                </div>
              )}
              <div className="msg-meta">
                <span>{m.role === 'user' ? 'You' : m.speakerName || bot?.name || 'Mimir'}</span>
                {m.model && !m.speakerName && <span>• {m.provider}:{m.model}</span>}
                {m.fallbackFrom && <span>• Backup used after {m.fallbackFrom}</span>}
                {hasText && (
                  <button
                    type="button"
                    className="speak-btn"
                    data-testid="copy-msg-btn"
                    onClick={async () => {
                      try {
                        await navigator.clipboard?.writeText(String(m.content || ''));
                        setCopiedMsgId(m.id);
                        setTimeout(() => setCopiedMsgId(prev => (prev === m.id ? '' : prev)), 1500);
                      } catch {}
                    }}
                  >
                    {copiedMsgId === m.id ? 'Copied' : 'Copy'}
                  </button>
                )}
                {m.role === 'user' && hasText && !isRunning && (
                  <button
                    type="button"
                    className="speak-btn"
                    data-testid="edit-msg-btn"
                    onClick={() => {
                      setEditingMessage({ id: m.id, content: String(m.content || '') });
                      setDraft(String(m.content || ''));
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                  >
                    Edit
                  </button>
                )}
                {m.role === 'assistant' && !isRunning && (() => {
                  const prevUser = [...messages.slice(0, msgIdx)].reverse().find(x => x.role === 'user' && String(x.content || '').trim());
                  if (!prevUser) return null;
                  return (
                    <button
                      type="button"
                      className="speak-btn"
                      data-testid="retry-msg-btn"
                      onClick={() => sendDraftPayload(String(prevUser.content || '').trim(), prevUser.attachments || [])}
                    >
                      Retry
                    </button>
                  );
                })()}
                {!isRunning && onForkThread && (
                  <button
                    type="button"
                    className="speak-btn"
                    data-testid="fork-msg-btn"
                    onClick={() => onForkThread(m.id)}
                  >
                    Fork
                  </button>
                )}
                {m.role === 'assistant' && hasText && (
                  <SpeakButton text={m.content} autoPlay={Boolean(m.voice) && msgIdx === messages.length - 1} />
                )}
              </div>
            </div>
          );
        })}

        {isRunning && researchProgress && (
          <div className="msg-row assistant">
            <ResearchStepper progress={researchProgress} live />
          </div>
        )}

        {isRunning && swarmSteps.length > 0 && (
          <div className="msg-row assistant">
            <details className="timeline-steps timeline-accordion" data-testid="timeline-steps" open>
              <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600, color: 'var(--ink-muted)' }}>
                Live steps ({swarmSteps.length})
              </summary>
              <div style={{ marginTop: 6 }}>
                {swarmSteps.map((step, sIdx) => (
                  <div key={step.id || sIdx} className="timeline-row" data-status={step.status || 'running'}>
                    <TimelineStepIcon icon={step.icon || 'subagent'} />
                    <span>
                      {step.label}
                      {step.detail ? `: ${step.detail}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            </details>
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
                {renderFormattedText(streaming.content || '...', onOpenInCanvas)}
              </PixelGlitchResponse>
            </div>
          </div>
        ) : isRunning && pendingApprovals.length === 0 ? (
          <div className="msg-row assistant" role="status" aria-live="polite">
            <div className="msg-bubble" data-testid="loading-indicator" style={{ color: 'var(--ink-muted)' }}>
              <RunicLoader label={`Working with ${bot?.name || 'Mimir'}...`} size={24} />
            </div>
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      {showScrollLatest && (
        <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
          <button
            type="button"
            className="btn btn-sm"
            data-testid="scroll-latest-btn"
            onClick={() => {
              stickToBottomRef.current = true;
              setShowScrollLatest(false);
              endRef.current?.scrollIntoView({ behavior: 'smooth' });
            }}
          >
            Latest
          </button>
        </div>
      )}

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
              {card?.title || <>Needs your OK: <code>{apr.toolName}</code></>}
            </div>
            <div className="dialogue-card-sub">{card?.subtitle || apr.reason}</div>
            <details>
              <summary style={{ fontSize: 11.5, color: 'var(--ink-muted)', cursor: 'pointer' }}>See what it wants to do</summary>
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
            Recording your steps ({recordedSteps.length} so far). Do the task once; Mimir learns to repeat it.
          </span>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              className="input"
              style={{ width: 170, padding: '4px 8px' }}
              placeholder="Name this task"
              value={recName}
              onChange={e => setRecName(e.target.value)}
            />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={recordedSteps.length === 0}
              onClick={() => {
                onSaveRecording(recName || 'Recorded task');
                setRecName('');
              }}
            >
              Save task
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

          {editingMessage && (
            <div className="branch-edit-banner" data-testid="branch-edit-banner" role="status">
              <span>Editing message to create a new branch</span>
              <button
                type="button"
                className="btn btn-sm"
                data-testid="cancel-branch-edit-btn"
                onClick={() => {
                  setEditingMessage(null);
                  setDraft('');
                }}
              >
                Cancel
              </button>
            </div>
          )}

          {commandMatches.length > 0 && (
            <ul className="command-suggest" role="listbox" aria-label="Mimir commands" data-testid="command-suggest">
              {commandMatches.map((c, sIdx) => (
                <li key={c.cmd}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={sIdx === activeSlashIdx}
                    className={`command-suggest-item ${sIdx === activeSlashIdx ? 'is-active' : ''}`}
                    onClick={() => {
                      setDraft(`${c.cmd} `);
                      requestAnimationFrame(() => inputRef.current?.focus());
                    }}
                  >
                    <code>{c.syntax}</code>
                    <span>{c.desc}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {mentionMatches.length > 0 && (
            <ul className="mention-suggest" role="listbox" aria-label="Mention teammate" data-testid="mention-suggest">
              {mentionMatches.map((mBot, mIdx) => (
                <li key={mBot.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={mIdx === activeMentionIdx}
                    className={`mention-suggest-item ${mIdx === activeMentionIdx ? 'is-active' : ''}`}
                    onClick={() => applyMention(mBot)}
                  >
                    <span className="work-color-sq" style={{ background: mBot.color || 'var(--frost)' }} />
                    <strong>@{mBot.name}</strong>
                    <span className="muted" style={{ fontSize: 11 }}>{mBot.role}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          {isNarrowViewport ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 4 }}>
              <button
                type="button"
                className="btn btn-sm composer-quickbars-toggle"
                data-testid="composer-quickbars-toggle"
                aria-expanded={mobileQuickbarsOpen}
                onClick={() => setMobileQuickbarsOpen(v => !v)}
              >
                {mobileQuickbarsOpen ? 'Hide quick tools' : 'Teammates & Quick make'}
              </button>
            </div>
          ) : null}

          {(!isNarrowViewport || mobileQuickbarsOpen) && specialistMentions.length > 0 && (
            <div className="mention-quickbar" data-testid="mention-quickbar">
              <span style={{ fontSize: 11, color: 'var(--ink-subtle)', fontWeight: 600 }}>
                Ask a teammate:
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

          {(!isNarrowViewport && !quickMakeOpen) ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <button
                type="button"
                className="mention-quick-btn composer-quickbars-toggle"
                data-testid="composer-quickbars-toggle"
                aria-expanded={false}
                onClick={() => setQuickMakeOpen(true)}
              >
                Quick make +
              </button>
            </div>
          ) : (!isNarrowViewport || mobileQuickbarsOpen) ? (
            <div className="mention-quickbar" data-testid="studio-chat-quickbar">
              <span style={{ fontSize: 11, color: 'var(--ink-subtle)', fontWeight: 600 }}>
                Quick make:
              </span>
              {[
                { label: 'Music', cmd: 'Create an ambient synthwave music track at 110 BPM' },
                { label: 'App', cmd: 'Build an expense-tracking web app with authentication, charts and export' },
                { label: '3D model', cmd: 'Create a 3D model of a Valkyrie Starfighter' },
                { label: 'Picture', cmd: 'Generate HD artwork of the Cosmic Odin Observatory' },
                { label: 'Video', cmd: 'Create a motion clip animation mp4 of a hyperdrive pulse loop' },
                { label: 'Game', cmd: 'Create a playable arcade space shooter game' },
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
              {!isNarrowViewport && (
                <button
                  type="button"
                  className="mention-quick-btn"
                  aria-label="Hide quick make bar"
                  onClick={() => setQuickMakeOpen(false)}
                >
                  Hide
                </button>
              )}
            </div>
          ) : null}

          {(() => {
            const draftIntent = detectDraftIntent(draft);
            if (!draftIntent) return null;
            return (
              <div className="adaptive-workspace-bar" data-testid="adaptive-workspace-bar">
                <div className="smart-intent-badge" data-testid="smart-intent-badge">
                  <span className="smart-intent-dot" />
                  <span>{draftIntent.label}</span>
                </div>
              </div>
            );
          })()}

          {sendError && (
            <div className="error-banner" role="alert" data-testid="composer-error" style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>{sendError}</span>
              <button type="button" className="btn btn-sm" onClick={() => setSendError('')}>Dismiss</button>
            </div>
          )}

          <UsageBar threadId={thread?.id} isRunning={isRunning} />

          <div className="composer-box">
            <input
              ref={fileInputRef}
              type="file"
              multiple
              tabIndex={-1}
              className="sr-only"
              onChange={handleHtmlFiles}
            />
            <button
              type="button"
              className="btn btn-icon"
              data-testid="attach-file-btn"
              aria-label="Attach file"
              title="Attach file"
              onClick={handlePickFiles}
            >
              <PlusPixelSvg size={16} />
            </button>
            <textarea
              ref={inputRef}
              className="composer-textarea"
              data-testid="chat-input"
              aria-label={`Message ${bot?.name || 'Mimir'}`}
              title="Enter to send, Shift+Enter for newline, or drop files anywhere"
              rows={2}
              placeholder={editingMessage ? 'Edit message and press Enter to branch...' : `Message ${bot?.name || 'Mimir'} or drop files anywhere...`}
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
                if (commandMatches.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlashIndex(prev => (prev + 1) % commandMatches.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashIndex(prev => (prev - 1 + commandMatches.length) % commandMatches.length);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setDraft('');
                    return;
                  }
                  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && !/\s/.test(draft))) {
                    const chosen = commandMatches[activeSlashIdx];
                    if (chosen && draft.toLowerCase() !== chosen.cmd) {
                      e.preventDefault();
                      setDraft(`${chosen.cmd} `);
                      return;
                    }
                  }
                }
                if (mentionMatches.length > 0) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setMentionIndex(prev => (prev + 1) % mentionMatches.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setMentionIndex(prev => (prev - 1 + mentionMatches.length) % mentionMatches.length);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setMentionDismissedQuery(mentionQuery);
                    return;
                  }
                  if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
                    const chosen = mentionMatches[activeMentionIdx];
                    if (chosen) {
                      e.preventDefault();
                      applyMention(chosen);
                      return;
                    }
                  }
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
              aria-label={micState === 'recording' ? 'Stop and turn speech into text' : 'Talk instead of typing'}
              title={micError || (micState === 'recording' ? 'Stop and turn your speech into text (works offline)' : 'Talk instead of typing (works offline)')}
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
              aria-label="Start a voice call with Mimir"
              title="Talk back and forth out loud"
              onClick={() => onOpenLiveVoice?.()}
            >
              <VoiceOrbSvg size={14} />
              <span>Voice call</span>
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
                disabled={sending || (!draft.trim() && attachments.length === 0)}
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
              <span>{teachMode ? 'Stop recording' : 'Record a task'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
