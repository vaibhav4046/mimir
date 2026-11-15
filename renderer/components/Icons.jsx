import React from 'react';
import { MimirAsset, MimirSagePortrait } from './MimirAsset.jsx';

/**
 * Retro-Pixel Norse UI Icons & Emblems backed by verified SVG sprite library
 * Mimir head is strictly bald, horned, glowing cyan eyes, long braided beard (never helmeted).
 */

export function MimirCrestSvg({ size = 48, animated = false }) {
  return <MimirSagePortrait size={size} animated={animated} />;
}

export function YggdrasilCrestSvg({ size = 48 }) {
  return <MimirAsset category="realms" name="yggdrasil-map" size={size} />;
}

export function PlusPixelSvg({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <path
        fill="#081019"
        d="M7 3h2v1h-2zM6 4h1v1h-1zM9 4h1v1h-1zM6 5h1v1h-1zM9 5h1v1h-1zM3 6h4v1h-4zM9 6h4v1h-4zM2 7h1v1h-1zM13 7h1v1h-1zM2 8h1v1h-1zM13 8h1v1h-1zM3 9h4v1h-4zM9 9h4v1h-4zM6 10h1v1h-1zM9 10h1v1h-1zM6 11h1v1h-1zM9 11h1v1h-1zM7 12h2v1h-2z"
      />
      <path
        fill="#3ac9ff"
        d="M7 4h2v1h-2zM7 5h2v1h-2zM7 6h2v1h-2zM3 7h10v1h-10zM3 8h10v1h-10zM7 9h2v1h-2zM7 10h2v1h-2zM7 11h2v1h-2z"
      />
    </svg>
  );
}

export function SendRunicSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="send" size={size} />;
}

export function ChatRuneSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="chat" size={size} />;
}

export function AgentsSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="allies" size={size} />;
}

export function ForgeAnvilSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="forge" size={size} />;
}

export function RsiScaleSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="rsi-scale" size={size} />;
}

export function RoutineHornSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="routines" size={size} />;
}

export function McpRuneBoxSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="mcp-box" size={size} />;
}

export function VaultChestSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="vault" size={size} />;
}

export function SettingsRuneSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="settings" size={size} />;
}

export function EditQuillSvg({ size = 14 }) {
  return <MimirAsset category="artifacts" name="quill-inkwell" size={size} />;
}

export function CloseCrossSvg({ size = 14 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
      <line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
    </svg>
  );
}

export function SpotlightRuneSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="search" size={size} />;
}

export function PopoutArrowSvg({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <polyline points="14,4 20,4 20,10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square" />
      <line x1="20" y1="4" x2="11" y2="13" stroke="currentColor" strokeWidth="1.75" />
      <polyline points="18,14 18,20 4,20 4,6 10,6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="square" />
    </svg>
  );
}

export function MenuBarsSvg({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <line x1="4" y1="6" x2="20" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      <line x1="4" y1="18" x2="20" y2="18" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
    </svg>
  );
}

export function ArrowDirectionSvg({ size = 14, dir = 'up' }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      {dir === 'up' ? (
        <polyline points="6,14 12,8 18,14" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      ) : (
        <polyline points="6,10 12,16 18,10" stroke="currentColor" strokeWidth="2" strokeLinecap="square" />
      )}
    </svg>
  );
}

export function TeachCrystalSvg({ size = 14, active = false }) {
  return <MimirAsset category="artifacts" name={active ? 'ember-flame' : 'rune-crystal'} size={size} />;
}

export function AttachmentFileSvg({ size = 16 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      shapeRendering="crispEdges"
      aria-hidden="true"
      style={{ display: 'inline-block', verticalAlign: 'middle' }}
    >
      <path
        fill="#081019"
        d="M5 2h6v1h-6zM4 3h1v1h-1zM11 3h1v1h-1zM3 4h1v1h-1zM6 4h4v1h-4zM12 4h1v1h-1zM3 5h1v1h-1zM6 5h1v1h-1zM9 5h1v1h-1zM12 5h1v1h-1zM3 6h1v1h-1zM6 6h1v1h-1zM9 6h1v1h-1zM12 6h1v1h-1zM3 7h1v1h-1zM6 7h1v1h-1zM9 7h1v1h-1zM12 7h1v1h-1zM3 8h1v1h-1zM6 8h1v1h-1zM9 8h1v1h-1zM12 8h1v1h-1zM3 9h1v1h-1zM6 9h1v1h-1zM9 9h1v1h-1zM12 9h1v1h-1zM3 10h1v1h-1zM6 10h1v1h-1zM12 10h1v1h-1zM3 11h1v1h-1zM6 11h1v1h-1zM11 11h1v1h-1zM4 12h1v1h-1zM7 12h4v1h-4zM5 13h2v1h-2z"
      />
      <path
        fill="#e6ab42"
        d="M5 3h6v1h-6zM4 4h2v1h-2zM10 4h2v1h-2zM4 5h2v1h-2zM10 5h2v1h-2zM4 6h2v1h-2zM10 6h2v1h-2zM4 7h2v1h-2zM10 7h2v1h-2zM4 8h2v1h-2zM10 8h2v1h-2zM4 9h2v1h-2zM10 9h2v1h-2zM4 10h2v1h-2zM9 10h3v1h-3zM4 11h2v1h-2zM7 11h4v1h-4zM5 12h2v1h-2z"
      />
      <path
        fill="#3ac9ff"
        d="M7 5h2v1h-2zM7 6h2v1h-2zM7 7h2v1h-2zM7 8h2v1h-2zM7 9h2v1h-2zM7 10h2v1h-2z"
      />
    </svg>
  );
}

export function CouncilRuneSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="boardroom" size={size} />;
}

export function VoiceOrbSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="voice-orb" size={size} />;
}

export function CodeModeSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="code-mode" size={size} />;
}

export function SubagentSwarmSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="subagent-swarm" size={size} />;
}

export function CouncilCrownSvg({ size = 15 }) {
  return <MimirAsset category="ui" name="council-crown" size={size} />;
}

export function ChiefCrownPixelSvg({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#081019" d="M2 5h2v1h2v1h1V4h2v3h1V6h2V5h2v7H2V5z" />
      <path fill="#e6ab42" d="M3 6h1v1h2v1h1V5h2v3h1V7h2V6h1v5H3V6z" />
      <path fill="#3ac9ff" d="M7 5h2v2H7zM4 8h2v2H4zM10 8h2v2h-2z" />
      <path fill="#e54868" d="M3 11h10v1H3z" />
    </svg>
  );
}

export function TeamTopologySvg({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#081019" d="M6 2h4v3H6zM1 10h4v4H1zM6 10h4v4H6zM11 10h4v4h-4z" />
      <path fill="#e54868" d="M7 3h2v1H7z" />
      <path fill="#e6ab42" d="M7 5h2v3H7zM3 7h10v1H3zM2 8h1v2H2zM7 8h2v2H7zM12 8h1v2h-1z" />
      <path fill="#3ac9ff" d="M2 11h2v2H2z" />
      <path fill="#38d996" d="M7 11h2v2H7z" />
      <path fill="#e6ab42" d="M12 11h2v2h-2z" />
    </svg>
  );
}

export function ReversibleShieldSvg({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#081019" d="M3 2h10v7h-1v2h-2v2H9v1H7v-1H6v-2H4V9H3V2z" />
      <path fill="#13312a" d="M4 3h8v6h-1v2H9v2H7v-2H5V9H4V3z" />
      <path fill="#38d996" d="M4 3h8v1H4zM6 8h1v1h2V6h2v2h-1v1H9v1H7V9H6V8z" />
    </svg>
  );
}

export function IrreversibleGateSvg({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#081019" d="M5 2h6v3h2v9H3V5h2V2z" />
      <path fill="#e6ab42" d="M6 3h4v2H9V4H7v1H6V3z" />
      <path fill="#e54868" d="M4 6h8v7H4V6z" />
      <path fill="#fef3c7" d="M7 8h2v2H7zM7 11h2v1H7z" />
    </svg>
  );
}

export function SessionHandoffSvg({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#081019" d="M1 3h6v10H1V3zM9 2h6v12H9V2z" />
      <path fill="#e6ab42" d="M2 4h4v8H2V4zM10 3h4v9h-4V3z" />
      <path fill="#0a0f1c" d="M3 6h2v4H3zM11 5h2v5h-2z" />
      <path fill="#38d996" d="M6 7h4v2H6zM11 11h2v1h-2z" />
      <path fill="#3ac9ff" d="M11 6h2v3h-2z" />
    </svg>
  );
}

export function WorkspaceVaultCrateSvg({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#081019" d="M2 2h12v12H2V2z" />
      <path fill="#e54868" d="M3 3h10v2H3z" />
      <path fill="#e6ab42" d="M3 6h10v2H3z" />
      <path fill="#3ac9ff" d="M3 9h10v2H3z" />
      <path fill="#38d996" d="M3 12h10v1H3z" />
      <path fill="#081019" d="M6 3h4v1H6zM6 6h4v1H6zM6 9h4v1H6z" />
    </svg>
  );
}

export function SkillMarkdownSvg({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#081019" d="M3 1h8l3 3v11H3V1z" />
      <path fill="#111a2c" d="M4 2h6v3h3v9H4V2z" />
      <path fill="#e6ab42" d="M10 2h1v3h2v1h-3V2z" />
      <path fill="#38d996" d="M6 7h5v1H6zM6 9h4v1H6zM6 11h5v1H6z" />
      <path fill="#3ac9ff" d="M5 4h3v1H5z" />
    </svg>
  );
}

export function HybridStackSvg({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" shapeRendering="crispEdges" aria-hidden="true">
      <path fill="#081019" d="M2 2h12v4H2zM2 10h12v4H2zM6 6h4v4H6z" />
      <path fill="#e54868" d="M3 3h10v2H3z" />
      <path fill="#3ac9ff" d="M7 6h2v4H7z" />
      <path fill="#e6ab42" d="M3 11h10v2H3z" />
      <path fill="#fef3c7" d="M4 4h2v1H4zM4 12h2v1H4z" />
    </svg>
  );
}
