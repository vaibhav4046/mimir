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
    tag: 'Read -> Gate -> Act',
    desc: 'Summarize GitHub and Gmail activity, then pause for approval before any outbound reply.',
    prompt: 'Check connected GitHub and Gmail status, summarize open items, and ask before any outbound write.',
  },
  {
    id: 'briefing',
    title: 'Foundry Multi-Format Pack',
    tag: 'PDF + DOCX + PPTX + XLSX',
    desc: 'Generate verified deliverables saved directly into Library.',
    prompt: '/forge Create an executive PDF and XLSX summary of the current workspace status.',
  },
  {
    id: 'web-rsi',
    title: '2026 Web + Knowledge Research',
    tag: 'CRAG + Self-RAG',
    desc: 'Search live 2026 sources with prompt-injection fencing and cite grounded snippets.',
    prompt: '/research 2026 local model quantization updates and runtime benchmarks',
  },
  {
    id: 'own-pc',
    title: 'Dedicated Browser & Desktop',
    tag: 'Takeover + CDP',
    desc: 'Drive embedded Chromium, attach to Chrome/Edge CDP, or pause safely for manual login.',
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
                Mimir Autonomous Workforce · Overview
              </div>
              <h2 style={{ margin: '4px 0 6px', fontSize: 21 }}>
                Delegate to a 24/7 Local Agent Team, Not a Single Prompt Box
              </h2>
              <p style={{ margin: 0, color: 'var(--ink-muted)', maxWidth: '60ch', fontSize: 13 }}>
                Active bot: <strong>{activeBot?.name || 'Mimir'}</strong> ({activeBot?.modelOverride || 'local runtime'}) · {liveModels} Ollama model(s) live · Chief-of-Staff delegation + Reversibility Approval Gates.
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
            <button type="button" className="btn" onClick={() => onNavigate('council')}>
              Boardroom
            </button>
            <button type="button" className="btn" onClick={() => onOpenLiveVoice?.()}>
              Live Voice
            </button>
            <button type="button" className="btn" data-testid="open-mimri-stack-btn" onClick={() => onNavigate('mimri')}>
              Mimri 14x Stack
            </button>
            <a href="./landing/index.html" target="_blank" rel="noopener noreferrer" className="btn">
              Showcase
            </a>
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
                Adds a team lead and 5 helpers, 4 group chats (Growth, Product launch, Updates, Team meeting prep) and a few starter skills, in one click.
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
              <span>{activatingBundle ? 'Setting up…' : 'Set up ready-made team'}</span>
            </button>
          </div>
          {bundleNotice && (
            <div style={{ fontSize: 11.5, color: '#5cf2b4', fontFamily: 'var(--sand-mono)' }} data-testid="grokbot-bundle-notice">
              {bundleNotice}
            </div>
          )}
        </section>

        <section className="card" data-testid="golden-path-strip" aria-label="First-Run Golden Path" style={{ padding: '12px 14px', gap: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontSize: 12.5, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--brass)' }}>
              First-Run Golden Path
            </strong>
            <span className="pill is-emerald" style={{ fontSize: 10 }}>
              {liveModels > 0 ? `${liveModels} Local Model${liveModels === 1 ? '' : 's'} Ready` : 'Local Fallback Ready'}
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
            <button type="button" className="btn btn-sm" onClick={() => onNavigate('settings')} style={{ justifyContent: 'flex-start' }}>
              1. Preflight &amp; Runtime
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onNavigate('settings')} style={{ justifyContent: 'flex-start' }}>
              2. Model Fit ({activeBot?.modelOverride || 'auto'})
            </button>
            <button type="button" className="btn btn-sm" onClick={handleDeploy} disabled={deployingTeam} style={{ justifyContent: 'flex-start' }}>
              3. {teamDeployed ? 'Chief Ready' : 'Deploy Chief'}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => onNavigate('vault')} style={{ justifyContent: 'flex-start' }}>
              4. Gate &amp; Vault
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => onNavigate('chat')} style={{ justifyContent: 'flex-start' }}>
              5. Run &amp; Receipt
            </button>
          </div>
        </section>

        <section className="overview-triplet" aria-label="Quick launch capabilities">
          <article className="overview-card">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#e54868', fontWeight: 700 }}>
              <TeamTopologySvg size={16} />
              <span>Chief of Staff Topology (6 Bots)</span>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-muted)', flex: 1 }}>
              Deploy Klaus (Chief of Staff) + 5 specialists (@Mara Scout, @Cole Copy, @Rina Design, @Vince Ops, @Jonathan CFO) with async @mention delegation.
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
              <span>Model Council Boardroom</span>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-muted)', flex: 1 }}>
              Pit local models and bots against each other in Stage 1 parallel opinions, blind Stage 2 Borda ranking, and Stage 3 Chairman synthesis.
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
              <span>Live Duplex Voice</span>
            </div>
            <p style={{ margin: 0, fontSize: 12.5, color: 'var(--ink-muted)', flex: 1 }}>
              Hands-free turn-taking with RMS silence detection, faster-whisper STT, and neural or offline SAPI5 speech playback.
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

        <section className="grid-2" aria-label="Architecture pillars">
          <article className="card" data-testid="reversibility-matrix-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 13.5, color: 'var(--brass)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Reversibility Approval Matrix
              </strong>
              <span className="pill" style={{ fontSize: 10.5 }}>Safety Rule</span>
            </div>
            <div className="matrix-split">
              <div className="matrix-col is-reversible">
                <div className="matrix-col-head">
                  <ReversibleShieldSvg size={15} />
                  <span>Reversible · Autonomous</span>
                </div>
                <ul className="matrix-list">
                  <li>Web research &amp; competitor sweeps</li>
                  <li>Drafting outreach copy &amp; reports locally</li>
                  <li>Generating pixel SVGs &amp; UI mockups</li>
                  <li>Organizing <code>/workspace/&#123;bin,config,skills,state&#125;</code></li>
                </ul>
              </div>
              <div className="matrix-col is-irreversible">
                <div className="matrix-col-head">
                  <IrreversibleGateSvg size={15} />
                  <span>Irreversible · Mandatory Human OK</span>
                </div>
                <ul className="matrix-list">
                  <li>Sending external emails, DMs, or posts</li>
                  <li>Financial spend, billing, or payouts</li>
                  <li>Production DB writes or host shell commands</li>
                  <li>Security/auth changes &amp; Vault secret access</li>
                </ul>
              </div>
            </div>
          </article>

          <article className="card" data-testid="hybrid-stack-card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <strong style={{ fontSize: 13.5, color: 'var(--frost)', textTransform: 'uppercase', letterSpacing: '0.06em', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <HybridStackSvg size={15} />
                <span>Hybrid AI Stack &amp; Persistence</span>
              </strong>
              <span className="pill" style={{ fontSize: 10.5 }}>6 Systems Ready</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
              <div className="hybrid-box">
                <div className="hybrid-tag">24/7 Local / Fleet</div>
                <strong>Mimir Autonomous Daemon</strong>
                <span>Continuous WAL routines, CDP browser, multi-bot delegation &amp; compiled <code>/workspace/skills/*.md</code>.</span>
              </div>
              <div className="hybrid-box">
                <div className="hybrid-tag">Dev Session / IDE</div>
                <strong>Local Ollama + CLI</strong>
                <span>Deep repository refactoring, code execution &amp; local BYOK endpoints synced via shared workspace state.</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', paddingTop: 4, fontSize: 11.5, color: 'var(--ink-muted)' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <WorkspaceVaultCrateSvg size={14} /> <code>/workspace</code> persistent crates
              </span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <SessionHandoffSvg size={14} /> Zero-password 2FA handoff
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
