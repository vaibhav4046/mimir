import React from 'react';

export const CHARACTER_ARCHETYPES = [
  { id: 'mimir-head', label: 'Mimir', role: 'Central Sage & Orchestrator', withStates: true },
  { id: 'all-father-warrior', label: 'All-Father Warrior', role: 'Execution, Action & Ops', withStates: true },
  { id: 'young-archer', label: 'Young Archer', role: 'Scout, Browse & Research', withStates: true },
  { id: 'forge-bot-brok', label: 'Forge Bot Brok', role: 'Builder, Infra & Tools', withStates: true },
  { id: 'forge-bot-sindri', label: 'Forge Bot Sindri', role: 'Artificer, Polish & QA', withStates: true },
  { id: 'freya-valkyrie', label: 'Freya Valkyrie', role: 'Diagnostics & Recovery', withStates: false },
  { id: 'odin-archivist', label: 'Odin Archivist', role: 'Memory & Lore Index', withStates: false },
  { id: 'thor-thunderer', label: 'Thor Enforcer', role: 'Heavy Parallel Compute', withStates: false },
  { id: 'tyr-diplomat', label: 'Tyr Strategist', role: 'Coordination & Comms', withStates: false },
  { id: 'angrboda-mystic', label: 'Angrboda Mystic', role: 'Creative Synthesis', withStates: false },
  { id: 'heimdall-sentinel', label: 'Heimdall Sentinel', role: 'Guardrails & Watch', withStates: false },
  { id: 'durlin-crafter', label: 'Durlin Scribe', role: 'Schema & Audit Trail', withStates: false },
  { id: 'lunda-smith', label: 'Lunda Armorer', role: 'Gear & Runtime Tuning', withStates: false },
];

export const LEGACY_SHAPE_TO_CHARACTER = {
  mimir: 'mimir-head',
  'mimir-head': 'mimir-head',
  leviathan: 'all-father-warrior',
  mjolnir: 'thor-thunderer',
  yggdrasil: 'odin-archivist',
  valkyrie: 'freya-valkyrie',
  crystal: 'young-archer',
  shield: 'forge-bot-brok',
  sparkle: 'forge-bot-sindri',
  gem: 'heimdall-sentinel',
  star: 'tyr-diplomat',
  flower: 'angrboda-mystic',
  hex: 'durlin-crafter',
  cylinder: 'lunda-smith',
};

export const ACCESSORY_OPTIONS = [
  { id: 'helmets-valkyrie-crest', slot: 'helmets', label: 'Valkyrie Brass Wing Crest' },
  { id: 'headwear-scout-hood', slot: 'headwear', label: 'Norse Ranger Hood' },
  { id: 'hair-braided-crown', slot: 'hair', label: 'Braided Silver Crown' },
  { id: 'beards-braided-sage', slot: 'beards', label: 'Twin-Clasp Sage Beard' },
  { id: 'masks-artificer-visor', slot: 'masks', label: 'Sindri Gold Visor' },
  { id: 'armor-wolf-pauldron', slot: 'armor', label: 'Wolf-Pelt Mantle' },
  { id: 'eye-effects-bifrost-flare', slot: 'eye-effects', label: 'Bifrost Eye Flare' },
  { id: 'crystals-shoulder-shard', slot: 'crystals', label: 'Bifrost Crystal Shard' },
  { id: 'runes-brow-raido', slot: 'runes', label: 'Elder Futhark Halo' },
  { id: 'weapons-frost-axe', slot: 'weapons', label: 'Shoulder Frost Axe' },
  { id: 'books-lore-codex', slot: 'books', label: 'Chained Edda Codex' },
  { id: 'scrolls-prophecy', slot: 'scrolls', label: 'Prophecy Scroll' },
  { id: 'tools-smith-hammer', slot: 'tools', label: 'Dwarven Forging Mallet' },
  { id: 'shields-guardian-round', slot: 'shields', label: 'Brass Guardian Shield' },
];

export const REALMS_DATA = [
  {
    id: 'midgard',
    name: 'Midgard',
    subtitle: 'Frozen Heartland & Pines',
    quickUrl: 'https://en.wikipedia.org/wiki/Midgard',
  },
  {
    id: 'asgard',
    name: 'Asgard',
    subtitle: 'Golden Aesir Spires',
    quickUrl: 'https://www.playstation.com/en-gb/games/god-of-war-ragnarok/',
  },
  {
    id: 'alfheim',
    name: 'Alfheim',
    subtitle: 'Light-Spire Sanctuary',
    quickUrl: 'https://en.wikipedia.org/wiki/Alfheim',
  },
  {
    id: 'vanaheim',
    name: 'Vanaheim',
    subtitle: 'Vanir Twin-River Canopy',
    quickUrl: 'https://en.wikipedia.org/wiki/Vanaheim',
  },
  {
    id: 'jotunheim',
    name: 'Jötunheim',
    subtitle: 'Titan Peaks & Amber Mist',
    quickUrl: 'https://en.wikipedia.org/wiki/J%C3%B6tunheimr',
  },
  {
    id: 'svartalfheim',
    name: 'Svartalfheim',
    subtitle: 'Nidavellir Forge Citadel',
    quickUrl: 'https://blog.playstation.com/tag/god-of-war-ragnarok/',
  },
  {
    id: 'muspelheim',
    name: 'Muspelheim',
    subtitle: 'Volcanic Basalt & Magma',
    quickUrl: 'https://en.wikipedia.org/wiki/Muspelheim',
  },
  {
    id: 'niflheim',
    name: 'Niflheim',
    subtitle: 'Mist-Veiled Permafrost',
    quickUrl: 'https://en.wikipedia.org/wiki/Niflheim',
  },
  {
    id: 'helheim',
    name: 'Helheim',
    subtitle: 'Spectral Underworld Bridge',
    quickUrl: 'https://en.wikipedia.org/wiki/Hel_(location)',
  },
];

export function assetUrl(category, name, ext = 'svg') {
  return `./assets/mimir/${category}/${name}.${ext}`;
}

export function resolveCharacterId(bot) {
  const rawShape = bot?.shape || 'mimir';
  if (CHARACTER_ARCHETYPES.some(c => c.id === rawShape)) return rawShape;
  if (LEGACY_SHAPE_TO_CHARACTER[rawShape]) return LEGACY_SHAPE_TO_CHARACTER[rawShape];
  if (bot?.id === 'bot-grok-default') return 'mimir-head';
  if (bot?.id === 'bot-team-research') return 'young-archer';
  if (bot?.id === 'bot-team-ops') return 'forge-bot-brok';
  return 'mimir-head';
}

export function MimirAsset({
  category = 'ui',
  name,
  ext = 'svg',
  size = 18,
  alt = '',
  className = '',
  style = {},
  decorative = true,
}) {
  return (
    <img
      src={assetUrl(category, name, ext)}
      width={size}
      height={size}
      alt={decorative ? '' : alt || name}
      aria-hidden={decorative ? 'true' : undefined}
      draggable={false}
      className={`pixel-sprite ${className}`.trim()}
      style={{
        width: size,
        height: size,
        imageRendering: 'pixelated',
        objectFit: 'contain',
        display: 'inline-block',
        verticalAlign: 'middle',
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

/**
 * Bald, horned, glowing cyan-eyed Mimir floating sage portrait
 * Reacts cleanly to streaming/thinking/error states without text-blocking opacity keyframes
 */
export function MimirSagePortrait({
  size = 64,
  state = 'idle',
  glitch = false,
  animated = true,
  className = '',
}) {
  const src =
    animated && state === 'idle' && size >= 40
      ? './assets/mimir/animations/mimir-floating-sage.svg'
      : state !== 'idle' && ['active', 'selected', 'thinking', 'running', 'succeeded', 'failed'].includes(state)
        ? `./assets/mimir/characters/states/mimir-head-${state}.svg`
        : size <= 18
          ? './assets/mimir/brand/mimir-head-16.svg'
          : size <= 36
            ? './assets/mimir/brand/mimir-head-32.svg'
            : './assets/mimir/brand/mimir-head.svg';

  const classes = [
    'mimir-sage-portrait',
    animated ? 'mimir-sage-animated' : '',
    glitch || state === 'failed' ? 'pixel-glitch-burst' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <span
      className={classes}
      style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}
    >
      <img
        src={src}
        width={size}
        height={size}
        alt="Mimir the Norse Sage"
        draggable={false}
        className="pixel-sprite"
        style={{ width: size, height: size, imageRendering: 'pixelated', objectFit: 'contain' }}
      />
    </span>
  );
}

/**
 * Modular pixel avatar with character archetype + layered accessories + state frame
 */
export function ModularBotAvatar({ bot, size = 28, state = 'idle', className = '' }) {
  const charId = resolveCharacterId(bot);
  const arch = CHARACTER_ARCHETYPES.find(c => c.id === charId);
  const useStateSprite =
    arch?.withStates && state !== 'idle' && ['active', 'selected', 'thinking', 'running', 'succeeded', 'failed', 'disabled'].includes(state);
  const baseSrc = useStateSprite
    ? `./assets/mimir/characters/states/${charId}-${state}.svg`
    : charId === 'mimir-head' && size <= 18
      ? './assets/mimir/brand/mimir-head-16.svg'
      : charId === 'mimir-head' && size <= 36
        ? './assets/mimir/brand/mimir-head-32.svg'
        : `./assets/mimir/characters/${charId}.svg`;

  const accessories = Array.isArray(bot?.accessories) ? bot.accessories : [];
  const trimColor = bot?.color || (charId === 'mimir-head' ? '#e6ab42' : '#3ac9ff');

  return (
    <span
      className={`bot-avatar pixel-avatar-frame ${state === 'running' || state === 'thinking' ? 'is-working' : ''} ${className}`.trim()}
      title={bot?.name || arch?.label || 'Mimir Ally'}
      style={{
        width: size,
        height: size,
        borderColor: trimColor,
        backgroundColor: '#101722',
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
      }}
    >
      <img
        src={baseSrc}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pixel-sprite"
        style={{ width: '100%', height: '100%', imageRendering: 'pixelated', objectFit: 'contain', display: 'block' }}
      />
      {accessories.map(accId => (
        <img
          key={accId}
          src={`./assets/mimir/characters/accessories/${accId}.svg`}
          width={size}
          height={size}
          alt=""
          aria-hidden="true"
          draggable={false}
          className="pixel-sprite pixel-acc-layer"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            imageRendering: 'pixelated',
            objectFit: 'contain',
            pointerEvents: 'none',
          }}
        />
      ))}
    </span>
  );
}

/**
 * Stepped Elder Futhark Yggdrasil Loading Indicator
 */
export function RunicLoader({ label = 'Consulting Mimir & tools...', size = 24 }) {
  return (
    <div className="runic-loader-pill" role="status" aria-live="polite">
      <img
        src="./assets/mimir/animations/runic-loader.svg"
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="pixel-sprite"
        style={{ width: size, height: size, imageRendering: 'pixelated' }}
      />
      <div className="runic-loader-copy">
        <span>{label}</span>
        <span className="runic-scan-track" aria-hidden="true">
          <span className="runic-scan-fill" />
        </span>
      </div>
    </div>
  );
}

/**
 * Pixel-glitch & Bifrost scan-line container for streamed responses & status cards
 * Keeps DOM text readable immediately (`opacity: 1`) so tests and screen readers never block
 */
export function PixelGlitchResponse({ children, streaming = false, isNew = false, isError = false }) {
  return (
    <div
      className={[
        'pixel-response-wrap',
        streaming ? 'is-streaming' : '',
        isNew ? 'is-entering' : '',
        isError ? 'is-glitch-error' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {isError && (
        <img
          src="./assets/mimir/animations/pixel-glitch-bars.svg"
          alt=""
          aria-hidden="true"
          className="pixel-glitch-overlay"
          draggable={false}
        />
      )}
      <div className="pixel-response-body">
        {children}
        {streaming && <span className="pixel-rune-cursor" aria-hidden="true" />}
      </div>
    </div>
  );
}

/**
 * Symbolic Yggdrasil Nine Realms Navigator for Realm Preview & Bifrost warping
 * Explicitly marks layout as symbolic UI navigation (not game map geography)
 */
export function RealmNavigator({ activeRealm = 'midgard', onSelectRealm, warping = false }) {
  const current = REALMS_DATA.find(r => r.id === activeRealm) || REALMS_DATA[0];

  return (
    <div className="realm-nav-box" data-testid="realm-navigator">
      <div className="realm-nav-header">
        <div className="realm-nav-title-group">
          <MimirAsset category="realms" name="yggdrasil-map" size={26} />
          <div>
            <div className="realm-nav-title">Yggdrasil • {current.name}</div>
            <div className="realm-nav-sub">{current.subtitle} (Symbolic Hub)</div>
          </div>
        </div>
        <div className={`realm-warp-badge ${warping ? 'is-warping' : ''}`}>
          <MimirAsset
            category={warping ? 'animations' : 'artifacts'}
            name={warping ? 'bifrost-portal-warp' : 'bifrost-portal'}
            size={20}
          />
          <span>{warping ? 'Warping...' : 'Bifrost Ready'}</span>
        </div>
      </div>

      <div className="realm-scene-strip">
        <img
          src={`./assets/mimir/realms/${current.id}-scene.svg`}
          alt={`${current.name} pixel scene: ${current.subtitle}`}
          draggable={false}
          className={`realm-scene-img ${warping ? 'bifrost-warp-flash' : ''}`}
        />
        {onSelectRealm && (
          <button
            type="button"
            className="btn-ghost realm-open-btn"
            onClick={() => onSelectRealm(current, true)}
            title={`Navigate Realm Preview to ${current.name}`}
          >
            <MimirAsset category="ui" name="go" size={14} /> Traverse
          </button>
        )}
      </div>

      <div className="realm-medallion-grid" role="group" aria-label="Nine Realms Symbolic Selector">
        {REALMS_DATA.map(r => {
          const isSelected = r.id === current.id;
          return (
            <button
              key={r.id}
              type="button"
              className={`realm-medallion-btn ${isSelected ? 'active' : ''}`}
              aria-pressed={isSelected}
              title={`${r.name} — ${r.subtitle}`}
              onClick={() => onSelectRealm?.(r, false)}
            >
              <MimirAsset
                category="realms"
                name={isSelected ? `${r.id}-icon` : `${r.id}-icon-inactive`}
                size={24}
              />
              <span>{r.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
