import React from 'react';

export const MIMIR_AVATAR_STATES = Object.freeze([
  'IDLE',
  'LISTENING',
  'THINKING',
  'WORKING',
  'SPEAKING',
  'WAITING_APPROVAL',
  'BLOCKED',
  'FAILED',
  'COMPLETED',
  'OFFLINE',
]);

export function deriveMimirAvatarState({
  online = true,
  blocked = false,
  failed = false,
  waitingApproval = false,
  speaking = false,
  listening = false,
  thinking = false,
  working = false,
  completed = false,
} = {}) {
  if (!online) return 'OFFLINE';
  if (blocked) return 'BLOCKED';
  if (failed) return 'FAILED';
  if (waitingApproval) return 'WAITING_APPROVAL';
  if (speaking) return 'SPEAKING';
  if (listening) return 'LISTENING';
  if (working) return 'WORKING';
  if (thinking) return 'THINKING';
  if (completed) return 'COMPLETED';
  return 'IDLE';
}

const STATE_PALETTES = {
  IDLE: { eye: '#3ac9ff', eyeCore: '#b6f3ff', runeOpacity: 0.25, ring: 'none', browTilt: 0 },
  LISTENING: { eye: '#5be3ff', eyeCore: '#e2fbff', runeOpacity: 0.45, ring: '#38bdf8', browTilt: -2 },
  THINKING: { eye: '#70dcff', eyeCore: '#dff9ff', runeOpacity: 0.85, ring: '#60a5fa', browTilt: 1.5 },
  WORKING: { eye: '#44c8f5', eyeCore: '#ffffff', runeOpacity: 1, ring: '#d6a34a', browTilt: 2 },
  SPEAKING: { eye: '#57d6ff', eyeCore: '#e6fcff', runeOpacity: 0.7, ring: '#3ac9ff', browTilt: -1 },
  WAITING_APPROVAL: { eye: '#f2b84b', eyeCore: '#fff3d1', runeOpacity: 0.9, ring: '#f2b84b', browTilt: 1 },
  BLOCKED: { eye: '#f59e0b', eyeCore: '#fef3c7', runeOpacity: 0.6, ring: '#f59e0b', browTilt: 3 },
  FAILED: { eye: '#ef5b5b', eyeCore: '#ffd4d4', runeOpacity: 0.4, ring: '#ef4444', browTilt: 3.5 },
  COMPLETED: { eye: '#52d6a0', eyeCore: '#d9ffef', runeOpacity: 0.8, ring: '#34d399', browTilt: -1.5 },
  OFFLINE: { eye: '#3f4b5b', eyeCore: '#607085', runeOpacity: 0.08, ring: '#4b5563', browTilt: 0 },
};

export function MimirAvatarSvg({
  size = 64,
  state = 'IDLE',
  audioLevel = 0,
  staticAvatar = false,
  reducedMotion = false,
  className = '',
  showStateBadge = false,
}) {
  const cleanState = MIMIR_AVATAR_STATES.includes(state) ? state : 'IDLE';
  const palette = STATE_PALETTES[cleanState] || STATE_PALETTES.IDLE;
  const allowMotion = !staticAvatar && !reducedMotion && cleanState !== 'OFFLINE' && cleanState !== 'IDLE';
  const clampedAudio = cleanState === 'SPEAKING' ? Math.max(0, Math.min(1, Number(audioLevel) || 0)) : 0;
  const mouthOpen = cleanState === 'SPEAKING' ? 1.5 + clampedAudio * 5.2 : cleanState === 'LISTENING' ? 1.2 : 0.6;
  const beardShiftY = cleanState === 'SPEAKING' && allowMotion ? clampedAudio * 1.4 : 0;

  return (
    <span
      className={`mimir-avatar-svg-wrap ${allowMotion ? 'is-animated' : 'is-static'} state-${cleanState.toLowerCase()} ${className}`}
      data-testid="mimir-living-avatar"
      data-avatar-state={cleanState}
      data-reduced-motion={reducedMotion || staticAvatar ? 'true' : 'false'}
      style={{ width: size, height: size, display: 'inline-flex', position: 'relative', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
      role="img"
      aria-label={`Mimir avatar state: ${cleanState}`}
    >
      <svg
        viewBox="0 0 120 120"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        style={{ overflow: 'visible' }}
      >
        <defs>
          <radialGradient id="mimirSkinGrad" cx="50%" cy="38%" r="58%">
            <stop offset="0%" stopColor="#9aa8b8" />
            <stop offset="65%" stopColor="#657384" />
            <stop offset="100%" stopColor="#3b4554" />
          </radialGradient>
          <linearGradient id="mimirHornGrad" x1="0%" y1="100%" x2="80%" y2="0%">
            <stop offset="0%" stopColor="#5e4728" />
            <stop offset="50%" stopColor="#c49a52" />
            <stop offset="100%" stopColor="#ebd39e" />
          </linearGradient>
          <linearGradient id="mimirBeardGrad" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stopColor="#dbe3ec" />
            <stop offset="60%" stopColor="#9fb0c2" />
            <stop offset="100%" stopColor="#5a6b7d" />
          </linearGradient>
        </defs>

        {palette.ring !== 'none' && (
          <circle
            cx="60"
            cy="60"
            r="56"
            fill="none"
            stroke={palette.ring}
            strokeWidth="2"
            strokeOpacity={cleanState === 'OFFLINE' ? 0.35 : 0.72}
            strokeDasharray={cleanState === 'THINKING' || cleanState === 'WORKING' ? '10 6' : cleanState === 'BLOCKED' ? '4 4' : undefined}
          />
        )}

        {/* Curved Natural Horns (No crown, no helmet) */}
        <path
          d="M34 40 C20 35, 13 21, 19 10 C22 18, 28 24, 37 28 Z"
          fill="url(#mimirHornGrad)"
          stroke="#141a23"
          strokeWidth="1.5"
        />
        <path
          d="M86 40 C100 35, 107 21, 101 10 C98 18, 92 24, 83 28 Z"
          fill="url(#mimirHornGrad)"
          stroke="#141a23"
          strokeWidth="1.5"
        />

        {/* Bald Weathered Head Silhouette */}
        <path
          d="M36 44 C36 22, 84 22, 84 44 L83 63 C83 74, 72 82, 60 82 C48 82, 37 74, 37 63 Z"
          fill="url(#mimirSkinGrad)"
          stroke="#10161f"
          strokeWidth="1.8"
        />

        {/* Temple Subtle Norse Runes (Not letter M) */}
        <g stroke={palette.eye} strokeWidth="1.3" strokeLinecap="round" fill="none" opacity={palette.runeOpacity}>
          <path d="M43 37 L43 45 M43 40 L47 38" />
          <path d="M77 37 L77 45 M77 40 L73 38" />
          <path d="M60 27 L60 35 M57 30 L60 27 L63 30" />
        </g>

        {/* Weathered Cheek & Forehead Furrows */}
        <path d="M48 39 Q60 36 72 39" fill="none" stroke="#2c3543" strokeWidth="1.2" opacity="0.7" />
        <path d="M43 58 L46 65 M77 58 L74 65" fill="none" stroke="#2c3543" strokeWidth="1.1" opacity="0.55" />

        {/* Expressive Brow Ridge */}
        <path
          d={`M41 ${49 + palette.browTilt} Q49 46 56 49.5`}
          fill="none"
          stroke="#1f2733"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d={`M79 ${49 + palette.browTilt} Q71 46 64 49.5`}
          fill="none"
          stroke="#1f2733"
          strokeWidth="2.4"
          strokeLinecap="round"
        />

        {/* Icy Glowing Eyes (Reflect exact state) */}
        <g>
          <ellipse cx="49.5" cy="53" rx="4.4" ry={cleanState === 'THINKING' ? 2.4 : 3.1} fill="#0b1119" />
          <ellipse cx="70.5" cy="53" rx="4.4" ry={cleanState === 'THINKING' ? 2.4 : 3.1} fill="#0b1119" />
          <circle cx="49.5" cy="53" r={cleanState === 'OFFLINE' ? 1.5 : 2.3} fill={palette.eye} />
          <circle cx="70.5" cy="53" r={cleanState === 'OFFLINE' ? 1.5 : 2.3} fill={palette.eye} />
          {cleanState !== 'OFFLINE' && (
            <>
              <circle cx="48.9" cy="52.4" r="0.9" fill={palette.eyeCore} />
              <circle cx="69.9" cy="52.4" r="0.9" fill={palette.eyeCore} />
            </>
          )}
        </g>

        {/* Nose */}
        <path d="M60 51 L57.5 62 L62.5 62" fill="none" stroke="#2a3442" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />

        {/* Flowing Grey-White Beard + Jawline (Audio-energy driven when SPEAKING) */}
        <g transform={`translate(0, ${beardShiftY.toFixed(2)})`}>
          <path
            d="M37 61 C36 74, 42 98, 56 109 L60 113 L64 109 C78 98, 84 74, 83 61 C76 68, 69 70, 60 70 C51 70, 44 68, 37 61 Z"
            fill="url(#mimirBeardGrad)"
            stroke="#10161f"
            strokeWidth="1.6"
          />
          <path d="M51 76 L53 99 M60 77 L60 106 M69 76 L67 99" fill="none" stroke="#6d8094" strokeWidth="1.2" opacity="0.65" />
          {/* Beard Gold Clasp Ring */}
          <rect x="56" y="96" width="8" height="4.5" rx="1.5" fill="#d6a34a" stroke="#181f2a" strokeWidth="1" />
        </g>

        {/* Mouth (Moves only proportionally to audioLevel in SPEAKING state) */}
        <ellipse
          cx="60"
          cy="68.5"
          rx={cleanState === 'SPEAKING' ? 4.8 : 3.6}
          ry={mouthOpen / 2}
          fill="#121821"
          stroke="#4b5869"
          strokeWidth="0.9"
        />

        {/* Status Glyph Overlay for WAITING_APPROVAL / BLOCKED / FAILED / COMPLETED */}
        {cleanState === 'BLOCKED' && (
          <g transform="translate(86, 82)">
            <circle cx="10" cy="10" r="9" fill="#18202c" stroke="#f59e0b" strokeWidth="1.6" />
            <path d="M6 10 H14 M10 6 V14" stroke="#f59e0b" strokeWidth="1.8" transform="rotate(45 10 10)" />
          </g>
        )}
        {cleanState === 'WAITING_APPROVAL' && (
          <g transform="translate(86, 82)">
            <circle cx="10" cy="10" r="9" fill="#18202c" stroke="#f2b84b" strokeWidth="1.6" />
            <path d="M10 5.5 V10.5 M10 13.5 V14.2" stroke="#f2b84b" strokeWidth="2" strokeLinecap="round" />
          </g>
        )}
        {cleanState === 'FAILED' && (
          <g transform="translate(86, 82)">
            <circle cx="10" cy="10" r="9" fill="#1f1417" stroke="#ef4444" strokeWidth="1.6" />
            <path d="M6.5 6.5 L13.5 13.5 M13.5 6.5 L6.5 13.5" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" />
          </g>
        )}
        {cleanState === 'COMPLETED' && (
          <g transform="translate(86, 82)">
            <circle cx="10" cy="10" r="9" fill="#10231b" stroke="#34d399" strokeWidth="1.6" />
            <path d="M6 10 L9 13 L14.5 7" fill="none" stroke="#34d399" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </g>
        )}
      </svg>
      {showStateBadge && (
        <span
          className="mimir-avatar-state-pill"
          style={{
            position: 'absolute',
            bottom: -4,
            fontSize: 9,
            fontWeight: 700,
            letterSpacing: '0.04em',
            padding: '1px 5px',
            borderRadius: 999,
            background: '#0c1016',
            border: `1px solid ${palette.ring !== 'none' ? palette.ring : '#334155'}`,
            color: palette.eyeCore,
          }}
        >
          {cleanState}
        </span>
      )}
    </span>
  );
}
