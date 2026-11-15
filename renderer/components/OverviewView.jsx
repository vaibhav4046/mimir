import React, { useState } from 'react';
import { MimirAsset } from './MimirAsset.jsx';
import {
  ChiefCrownPixelSvg,
  CouncilRuneSvg,
  HybridStackSvg,
  IrreversibleGateSvg,
  ReversibleShieldSvg,
  SessionHandoffSvg,
  TeamTopologySvg,
  VoiceOrbSvg,
  WorkspaceVaultCrateSvg,
} from './Icons.jsx';

const WORKFLOW_CASES = [
  {
    id: 'triage',
    title: 'Inbox & PR Triage',
    tag: 'Draft then approve',
    desc: 'Summarize GitHub and Gmail activity, then pause for your approval before sending any reply.',
    prompt: 'Check connected GitHub and Gmail status, summarize open items, and ask before any outbound write.',
  },
  {
    id: 'briefing',
    title: 'Multi-Format Reports',
    tag: 'PDF, Word, Slides, Excel',
    desc: 'Generate polished deliverables saved directly into your Library.',
    prompt: '/forge Create an executive PDF and XLSX summary of the current workspace status.',
  },
  {
    id: 'web-rsi',
    title: 'Web & File Research',
    tag: 'Grounded citations',
    desc: 'Search live sources alongside local workspace files and cite grounded snippets.',
    prompt: '/research 2026 local model quantization updates and runtime benchmarks',
  },
  {
    id: 'own-pc',
    title: 'Browser & Desktop Control',
    tag: 'Live screen',
    desc: 'Browse pages in a dedicated window, attach to an existing browser, or pause for manual login.',
    prompt: 'Inspect active desktop windows or open the configured Realm Preview URL.',
  },
];

export function OverviewView({
  activeBot,
  bots = [],
  modelStatus,
  onNavigate,
  onRunPrompt,
  onOpenLiveVoice,
  onDeployChiefTeam,
  onActivateGrokBot,
}) {
  const liveModels = modelStatus?.ollama?.models?.length || 0;
  const [deployingTeam, setDeployingTeam] = useState(false);
  const [activatingBundle, setActivatingBundle] = useState(false);
  const [bundleNotice, setBundleNotice] = useState('');
  const teamDeployed = bots.some(b => b.id === 'bot-chief-klaus');

  const handleDeploy = async () => {
    if (!onDeployChiefTeam || deployingTeam) return;
    setDeployingTeam(true);
    try {
      await onDeployChiefTeam();
    } finally {
      setDeployingTeam(false);
    }
  };

  const handleActivateReplacement = async () => {
    if (!onActivateGrokBot || activatingBundle) return;
    setActivatingBundle(true);
    setBundleNotice('');
    try {
      const out = await onActivateGrokBot();
      setBundleNotice(
        `Activated 6-bot Chief Fleet, ${(out?.playbook?.channels || []).length || 4} channels, ${(out?.skills || []).length || 3} v1.0 skills, and /workspace snapshot.`,
      );
    } finally {
      setActivatingBundle(false);
    }
  };

  return (
    <div className="view-scroll" data-testid="overview-view">
      <div className="view-container overview-shell">
        <section className="overview-hero">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, minWidth: 240, flex: '1 1 320px' }}>
            <MimirAsset category="characters" name="mimir-head" size={72} alt="Mimir Norse sage emblem" />
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: 'var(--brass)' }}>
                Overview
              </div>
              <h2 style={{ margin: '4px 0 6px', fontSize: 21 }}>
                Delegate tasks to a local AI team, with you in control
              </h2>
              <p style={{ margin: 0, color: 'var(--ink-muted)', maxWidth: '60ch', fontSize: 13 }}>
                Active assistant: <strong>{activeBot?.name || 'Mimir'}</strong> ({activeBot?.modelOverride || 'local runtime'}) · {liveModels} Ollama model(s) live · Approval checks before external actions.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => onNavigate('chat')}>
              Open Chat
            </button>
            <button
              type="button"
              className="btn"
              data-testid="overview-deploy-team-btn"
              disabled={deployingTeam}
              onClick={handleDeploy}
            >
              <ChiefCrownPixelSvg size={14} />
              <span>{teamDeployed ? 'Open #Growth Team' : deployingTeam ? 'Deploying...' : 'Deploy Chief Team'}</span>
            </button>
          </div>
        </section>

        <section className="card grokbot-replacement-card" data-testid="grokbot-replacement-card" aria-label="Ready-made team setup">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '1 1 320px' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--frost)' }}>
                  Ready-made team
                </strong>
              </div>
              <span style={{ fontSize: 12, color: 'var(--ink-muted)' }}>
                Adds a team lead and 5 helpers, 4 group chats (Growth, Product launch, Updates, Team meeting prep) and starter skills, in one click.
              </span>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              data-testid="replace-grokbot-btn"
              disabled={activatingBundle || deployingTeam}
              onClick={handleActivateReplacement}
            >
              <ChiefCrownPixelSvg size={14} />
              <span>{activatingBundle ? 'Setting up...' : 'Set up ready-made team'}</span>
            </button>
          </div>
          {bundleNotice && (
            <div style={{ fontSize: 11.5, color: 'var(--ok)', fontFamily: 'var(--sand-mono)' }} data-testid="grokbot-bundle-notice">
              {bundleNotice}
            </div>
          )}
        </section>

        <section className="card" data-testid="golden-path-strip" aria-label="Getting started" style={{ padding: '12px 14px', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--brass)' }}>
              Getting started
            </strong>
            <span className="pill is-emerald" style={{ fontSize: 10 }}>
              {liveModels > 0 ? `${liveModels} Local Model${liveModels === 1 ? '' : 's'} Ready` : 'Local Fallback Ready'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => onNavigate('settings')} style={{ justifyContent: 'flex-start' }}>
              1. Check Runtime
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onNavigate('settings')} style={{ justifyContent: 'flex-start' }}>
              2. Pick Model ({activeBot?.modelOverride || 'auto'})
            </button>
            <button type="button" className="btn btn-sm" onClick={handleDeploy} disabled={deployingTeam} style={{ justifyContent: 'flex-start' }}>
              3. {teamDeployed ? 'Team Ready' : 'Deploy Team'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onNavigate('vault')} style={{ justifyContent: 'flex-start' }}>
              4. Review Approvals
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate('chat')} style={{ justifyContent: 'flex-start' }}>
              5. Start Chatting
            </button>
          </div>
        </section>

        <section className="overview-triplet" aria-label="Quick launch capabilities">
          <article className="overview-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--ink)', fontWeight: 700 }}>
              <TeamTopologySvg size={16} />
              <span>Team Delegation (6 Assistants)</span>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-muted)', flex: 1 }}>
              Work with Klaus as lead plus 5 specialists (research, copy, design, ops, finance) passing tasks cleanly in shared channels.
            </p>
            <div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={deployingTeam}
                onClick={handleDeploy}
              >
                {teamDeployed ? 'Open #Growth Team' : deployingTeam ? 'Deploying...' : 'Deploy 6-Bot Team'}
              </button>
            </div>
          </article>

          <article className="overview-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--brass)', fontWeight: 700 }}>
              <CouncilRuneSvg size={16} />
              <span>Multi-Model Boardroom</span>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-muted)', flex: 1 }}>
              Compare answers from several local models side by side, score them anonymously, and get one clear synthesis.
            </p>
            <div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                data-testid="overview-boardroom-btn"
                onClick={() => onNavigate('council')}
              >
                Open Boardroom
              </button>
            </div>
          </article>

          <article className="overview-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--frost)', fontWeight: 700 }}>
              <VoiceOrbSvg size={16} />
              <span>Live Voice</span>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-muted)', flex: 1 }}>
              Hands-free voice chat with automatic pause detection, local speech recognition, and spoken replies.
            </p>
            <div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                data-testid="overview-live-voice-btn"
                onClick={() => onOpenLiveVoice?.()}
              >
                Start Live Voice
              </button>
            </div>
          </article>
        </section>

        <section className="grid-2" aria-label="Safety and storage">
          <article className="card" data-testid="reversibility-matrix-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 13.5, color: 'var(--brass)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Action Safety Rules
              </strong>
              <span className="pill" style={{ fontSize: 10.5 }}>Safety Rule</span>
            </div>
            <div className="matrix-split" style={{ gap: 16 }}>
              <div className="matrix-col is-reversible" style={{ border: 'none', background: 'transparent', padding: '4px 0' }}>
                <div className="matrix-col-head">
                  <ReversibleShieldSvg size={15} />
                  <span>Safe local work (Automatic)</span>
                </div>
                <ul className="matrix-list">
                  <li>Web research and reading sources</li>
                  <li>Drafting copy and reports locally</li>
                  <li>Creating diagrams, charts, and mockups</li>
                  <li>Organizing workspace scripts and notes</li>
                </ul>
              </div>
              <div className="matrix-col is-irreversible" style={{ border: 'none', borderTop: '1px solid var(--rule)', background: 'transparent', padding: '10px 0 4px' }}>
                <div className="matrix-col-head">
                  <IrreversibleGateSvg size={15} />
                  <span>External actions (Approval needed)</span>
                </div>
                <ul className="matrix-list">
                  <li>Sending emails, messages, or posts</li>
                  <li>Purchases, billing, or payouts</li>
                  <li>Database writes or system commands</li>
                  <li>Security changes and saved credentials</li>
                </ul>
              </div>
            </div>
          </article>

          <article className="card" data-testid="hybrid-stack-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 13.5, color: 'var(--frost)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <HybridStackSvg size={15} />
                <span>Local Runtime &amp; Persistence</span>
              </strong>
              <span className="pill" style={{ fontSize: 10.5 }}>Workspace Ready</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <div className="hybrid-box" style={{ border: 'none', background: 'var(--bg-inset, var(--bg-surface))', padding: '10px 12px', borderRadius: 6 }}>
                <div className="hybrid-tag">Background Runner</div>
                <strong>Local Task Daemon</strong>
                <span>Scheduled routines, live browser sessions, team delegation, and reusable workspace skills.</span>
              </div>
              <div className="hybrid-box" style={{ border: 'none', background: 'var(--bg-inset, var(--bg-surface))', padding: '10px 12px', borderRadius: 6 }}>
                <div className="hybrid-tag">Models &amp; Tools</div>
                <strong>Ollama + Local CLI</strong>
                <span>Repository editing, local command runs, and local or BYOK endpoints sharing one workspace.</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 4, fontSize: 11.5, color: 'var(--ink-muted)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <WorkspaceVaultCrateSvg size={14} /> Shared workspace folder
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <SessionHandoffSvg size={14} /> Pause for manual sign-in anytime
              </span>
            </div>
          </article>
        </section>

        <section>
          <h3 style={{ margin: '0 0 10px', fontSize: 13.5, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--brass)' }}>
            1-Click Workflows
          </h3>
          <div className="overview-grid">
            {WORKFLOW_CASES.map(wf => (
              <article key={wf.id} className="overview-card">
                <div style={{ fontSize: 10.5, fontFamily: 'var(--sand-mono)', color: 'var(--frost)', textTransform: 'uppercase' }}>
                  {wf.tag}
                </div>
                <strong style={{ fontSize: 15 }}>{wf.title}</strong>
                <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-muted)', flex: 1 }}>{wf.desc}</p>
                <div>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={() => onRunPrompt(wf.prompt)}
                  >
                    Run in Chat
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
