import { PALETTE, PixelCanvas } from './pixel-engine.mjs';

export const REALM_META = [
  {
    id: 'midgard',
    name: 'Midgard',
    subtitle: 'Frozen Heartland & Pines',
    sky: [PALETTE.PANEL_DK, PALETTE.ICE_DK, PALETTE.SLATE],
    accent: PALETTE.CYAN,
    trim: PALETTE.GOLD,
    motifs: 'midgard',
    quickUrl: 'https://en.wikipedia.org/wiki/Midgard',
  },
  {
    id: 'asgard',
    name: 'Asgard',
    subtitle: 'Golden Aesir Spires',
    sky: [PALETTE.SLATE, PALETTE.GOLD_DK, PALETTE.SLATE_HI],
    accent: PALETTE.GOLD_HI,
    trim: PALETTE.GOLD,
    motifs: 'asgard',
    quickUrl: 'https://www.playstation.com/en-gb/games/god-of-war-ragnarok/',
  },
  {
    id: 'alfheim',
    name: 'Alfheim',
    subtitle: 'Light-Spire Sanctuary',
    sky: [PALETTE.ICE_DK, PALETTE.VIO_DK, PALETTE.ICE_MD],
    accent: PALETTE.ICE_HI,
    trim: PALETTE.CYAN,
    motifs: 'alfheim',
    quickUrl: 'https://en.wikipedia.org/wiki/Alfheim',
  },
  {
    id: 'vanaheim',
    name: 'Vanaheim',
    subtitle: 'Vanir Twin-River Canopy',
    sky: [PALETTE.LEAF_DK, PALETTE.SLATE, PALETTE.LEAF_MD],
    accent: PALETTE.LEAF_HI,
    trim: PALETTE.GOLD,
    motifs: 'vanaheim',
    quickUrl: 'https://en.wikipedia.org/wiki/Vanaheim',
  },
  {
    id: 'jotunheim',
    name: 'Jötunheim',
    subtitle: 'Titan Peaks & Amber Mist',
    sky: [PALETTE.PANEL_DK, PALETTE.SLATE_HI, PALETTE.GOLD_DK],
    accent: PALETTE.GOLD,
    trim: PALETTE.MUTED,
    motifs: 'jotunheim',
    quickUrl: 'https://en.wikipedia.org/wiki/J%C3%B6tunheimr',
  },
  {
    id: 'svartalfheim',
    name: 'Svartalfheim',
    subtitle: 'Nidavellir Forge Citadel',
    sky: [PALETTE.PANEL_DK, PALETTE.BROK_DK, PALETTE.SLATE],
    accent: PALETTE.EMBER,
    trim: PALETTE.BROK,
    motifs: 'svartalfheim',
    quickUrl: 'https://blog.playstation.com/tag/god-of-war-ragnarok/',
  },
  {
    id: 'muspelheim',
    name: 'Muspelheim',
    subtitle: 'Volcanic Basalt & Magma',
    sky: [PALETTE.OUTLINE, PALETTE.EMBER_DK, PALETTE.CRIM_DK],
    accent: PALETTE.EMBER_HI,
    trim: PALETTE.EMBER,
    motifs: 'muspelheim',
    quickUrl: 'https://en.wikipedia.org/wiki/Muspelheim',
  },
  {
    id: 'niflheim',
    name: 'Niflheim',
    subtitle: 'Mist-Veiled Permafrost',
    sky: [PALETTE.PANEL_DK, PALETTE.SLATE, PALETTE.ASH_DK],
    accent: PALETTE.WHITE,
    trim: PALETTE.MUTED,
    motifs: 'niflheim',
    quickUrl: 'https://en.wikipedia.org/wiki/Niflheim',
  },
  {
    id: 'helheim',
    name: 'Helheim',
    subtitle: 'Spectral Underworld Bridge',
    sky: [PALETTE.OUTLINE, PALETTE.HEL_DK, PALETTE.HEL_MD],
    accent: PALETTE.HEL_HI,
    trim: PALETTE.HEL,
    motifs: 'helheim',
    quickUrl: 'https://en.wikipedia.org/wiki/Hel_(location)',
  },
];

function drawRealmSceneArt(c, x0, y0, w, h, realmId, meta) {
  // Gradient night/twilight sky backdrop
  for (let y = 0; y < h; y++) {
    const ty = y / Math.max(1, h - 1);
    const skyCol = ty < 0.36 ? meta.sky[0] : ty < 0.72 ? meta.sky[1] : meta.sky[2];
    for (let x = 0; x < w; x++) {
      // Subtle pixel sky dither
      if (y > 2 && ((x + y * 3) % 19 === 0)) {
        c.set(x0 + x, y0 + y, PALETTE.SLATE_HI, 'shadow');
      } else {
        c.set(x0 + x, y0 + y, skyCol, 'shadow');
      }
    }
  }

  const midX = x0 + Math.floor(w / 2);
  const botY = y0 + h;

  if (realmId === 'midgard') {
    // Jagged snow peaks + pine forest + freezing cyan waterfall
    c.poly([[x0, botY - 8], [midX - 6, y0 + 10], [midX + 6, botY - 8]], PALETTE.SLATE_HI, 'base');
    c.poly([[midX - 2, botY - 8], [midX + 10, y0 + 12], [x0 + w, botY - 8]], PALETTE.STEEL, 'base');
    c.poly([[midX - 6, y0 + 10], [midX - 2, y0 + 17], [midX - 10, y0 + 17]], PALETTE.WHITE, 'accent');
    c.poly([[midX + 10, y0 + 12], [midX + 13, y0 + 18], [midX + 6, y0 + 18]], PALETTE.WHITE, 'accent');
    // Pine treeline
    for (let px = x0 + 2; px < x0 + w - 2; px += 4) {
      c.poly([[px, botY - 8], [px + 2, botY - 15], [px + 4, botY - 8]], PALETTE.LEAF_DK, 'base');
    }
    // Frozen lake + icy waterfall drop
    c.rect(x0, botY - 9, w, 9, PALETTE.ICE_DK, 'ice');
    c.rect(midX - 3, y0 + Math.floor(h * 0.45), 6, h - Math.floor(h * 0.45), PALETTE.CYAN, 'ice');
    c.rect(midX - 1, y0 + Math.floor(h * 0.5), 2, h - Math.floor(h * 0.5), PALETTE.ICE_HI, 'ice');
  } else if (realmId === 'asgard') {
    // Golden Aesir cloud shelf + lofty spires
    c.rect(x0, botY - 10, w, 10, PALETTE.ASH_HI, 'base');
    c.ellipse(midX - 10, botY - 10, 9, 4, PALETTE.WHITE, 'accent');
    c.ellipse(midX + 10, botY - 10, 9, 4, PALETTE.WHITE, 'accent');
    // Central spire + twin flanking towers
    for (const [tx, tw, th] of [[midX - 11, 5, 16], [midX + 6, 5, 16], [midX - 4, 8, 25]]) {
      c.rect(tx, botY - 9 - th, tw, th, PALETTE.GOLD_MD, 'gold');
      c.rect(tx + 1, botY - 9 - th, Math.max(1, Math.floor(tw / 2)), th, PALETTE.GOLD, 'gold');
      c.poly([[tx - 1, botY - 9 - th], [tx + tw / 2, botY - 15 - th], [tx + tw + 1, botY - 9 - th]], PALETTE.GOLD_HI, 'gold');
    }
    c.rect(midX - 1, y0 + 8, 2, 16, PALETTE.ICE_HI, 'ice');
  } else if (realmId === 'alfheim') {
    // Glowing Light of Alfheim tree/crystal pillar + pink/violet twilight cliffs
    c.poly([[x0, botY], [x0, y0 + 18], [x0 + 12, botY - 5]], PALETTE.VIO_DK, 'base');
    c.poly([[x0 + w, botY], [x0 + w, y0 + 18], [x0 + w - 12, botY - 5]], PALETTE.VIO_DK, 'base');
    // Radiant crystal pillar & canopy glow
    c.rect(midX - 2, y0 + 10, 4, h - 10, PALETTE.CYAN, 'ice');
    c.rect(midX - 1, y0 + 8, 2, h - 8, PALETTE.ICE_HI, 'ice');
    c.circle(midX, y0 + Math.floor(h * 0.42), Math.floor(w * 0.25), PALETTE.ICE_MD, 'ice');
    c.circle(midX, y0 + Math.floor(h * 0.42), Math.floor(w * 0.16), PALETTE.CYAN, 'ice');
    c.circle(midX, y0 + Math.floor(h * 0.42), Math.floor(w * 0.08), PALETTE.ICE_HI, 'ice');
  } else if (realmId === 'vanaheim') {
    // Lush blossom twin trees + glowing blue waterfall
    c.rect(x0, botY - 8, w, 8, PALETTE.LEAF_DK, 'base');
    c.circle(midX - 9, y0 + Math.floor(h * 0.48), 9, PALETTE.LEAF_MD, 'accent');
    c.circle(midX - 9, y0 + Math.floor(h * 0.44), 6, PALETTE.LEAF_HI, 'accent');
    c.circle(midX + 9, y0 + Math.floor(h * 0.48), 9, PALETTE.CRIM_MD, 'accent');
    c.circle(midX + 9, y0 + Math.floor(h * 0.44), 6, PALETTE.CRIM_HI, 'accent');
    c.rect(midX - 11, y0 + Math.floor(h * 0.54), 3, 12, PALETTE.WOOD_MD, 'gold');
    c.rect(midX + 8, y0 + Math.floor(h * 0.54), 3, 12, PALETTE.WOOD_MD, 'gold');
    c.rect(midX - 2, botY - 14, 4, 14, PALETTE.CYAN, 'ice');
  } else if (realmId === 'jotunheim') {
    // Colossal jagged titan rock fingers + golden sun haze
    c.circle(midX, y0 + Math.floor(h * 0.45), 9, PALETTE.GOLD_DK, 'gold');
    c.circle(midX, y0 + Math.floor(h * 0.45), 5, PALETTE.GOLD, 'gold');
    c.poly([[x0 + 2, botY], [x0 + 11, y0 + 10], [midX - 2, botY]], PALETTE.SLATE_HI, 'base');
    c.poly([[x0 + w - 2, botY], [x0 + w - 11, y0 + 8], [midX + 2, botY]], PALETTE.STEEL, 'base');
    c.line(x0 + 11, y0 + 10, x0 + 9, botY, PALETTE.GOLD, 'gold');
    c.line(x0 + w - 11, y0 + 8, x0 + w - 9, botY, PALETTE.GOLD, 'gold');
  } else if (realmId === 'svartalfheim') {
    // Nidavellir tiered dwarven forge citadel + spillway + warm lanterns
    c.rect(x0 + 4, botY - 18, w - 8, 18, PALETTE.SLATE, 'base');
    c.rect(midX - 9, botY - 26, 18, 26, PALETTE.SLATE_HI, 'base');
    c.rect(midX - 5, botY - 31, 10, 8, PALETTE.STEEL, 'base');
    c.rect(midX - 2, botY - 14, 4, 14, PALETTE.BROK, 'ice');
    // Foundry forge lamps
    for (const lx of [midX - 7, midX + 6, x0 + 8, x0 + w - 9]) {
      c.rect(lx, botY - 12, 2, 2, PALETTE.EMBER_HI, 'gold');
    }
  } else if (realmId === 'muspelheim') {
    // Dark obsidian volcanic cleft + vertical blazing lava cascade
    c.poly([[x0, botY], [midX - 6, y0 + 12], [midX - 2, botY]], PALETTE.PANEL_DK, 'base');
    c.poly([[x0 + w, botY], [midX + 6, y0 + 12], [midX + 2, botY]], PALETTE.SLATE, 'base');
    c.rect(midX - 3, y0 + 15, 6, h - 15, PALETTE.EMBER_MD, 'accent');
    c.rect(midX - 1, y0 + 16, 2, h - 16, PALETTE.EMBER_HI, 'gold');
    c.rect(x0, botY - 5, w, 5, PALETTE.EMBER, 'accent');
    c.set(midX - 8, y0 + 10, PALETTE.EMBER_HI, 'gold');
    c.set(midX + 7, y0 + 9, PALETTE.EMBER_HI, 'gold');
  } else if (realmId === 'niflheim') {
    // Jagged ice floes + drifting permafrost fog bands
    c.poly([[x0 + 2, botY - 4], [midX - 4, y0 + 11], [midX + 4, botY - 4]], PALETTE.MUTED, 'base');
    c.poly([[midX - 4, y0 + 11], [midX, y0 + 16], [midX - 8, y0 + 16]], PALETTE.WHITE, 'accent');
    // Fog ribbons
    c.rect(x0, y0 + Math.floor(h * 0.56), w, 3, PALETTE.ASH_HI, 'accent');
    c.rect(x0 + 4, botY - 7, w - 8, 7, PALETTE.ICE_MD, 'ice');
    c.rect(midX - 5, botY - 7, 10, 7, PALETTE.CYAN, 'ice');
  } else if (realmId === 'helheim') {
    // Spectral phosphor teal jagged gate + underworld rift
    c.poly([[x0 + 6, botY], [midX - 5, y0 + 12], [midX - 2, botY]], PALETTE.HEL_DK, 'base');
    c.poly([[x0 + w - 6, botY], [midX + 5, y0 + 12], [midX + 2, botY]], PALETTE.HEL_DK, 'base');
    c.rect(midX - 2, y0 + 9, 4, h - 9, PALETTE.HEL, 'ice');
    c.rect(midX - 1, y0 + 9, 2, h - 9, PALETTE.HEL_HI, 'ice');
    c.rect(x0, botY - 6, w, 6, PALETTE.HEL_MD, 'ice');
  }
}

/**
 * 1. Ornate pointed diamond gold-trimmed Realm Crest Medallion (48x48)
 */
export function buildRealmEmblem48(meta, active = true) {
  const c = new PixelCanvas(48, 48);
  const cx = 24;
  const cy = 24;

  // Mask into pointed kite/diamond medallion just like uploaded sheet row 2
  const inner = new PixelCanvas(48, 48);
  drawRealmSceneArt(inner, 6, 6, 36, 36, meta.id, meta);

  for (let y = 3; y <= 44; y++) {
    const dy = Math.abs(y - cy) / 20;
    const halfSpan = Math.round(19 * Math.max(0, 1 - dy * dy * 0.88));
    for (let x = cx - halfSpan; x <= cx + halfSpan; x++) {
      const dx = Math.abs(x - cx) / Math.max(1, halfSpan);
      const isBorder = Math.abs(x - (cx - halfSpan)) <= 1 || Math.abs(x - (cx + halfSpan)) <= 1 || dy > 0.9;
      if (isBorder) {
        const trimCol = !active
          ? PALETTE.SLATE_HI
          : (x + y) % 5 === 0
            ? PALETTE.GOLD_HI
            : meta.trim;
        c.set(x, y, trimCol, 'gold');
      } else {
        const sc = inner.get(x, y);
        if (sc) {
          c.set(x, y, active ? sc : PALETTE.SLATE, inner.layers[y * 48 + x]);
        }
      }
    }
  }
  // Ornate top crown tip & bottom crystal point
  c.poly([[cx, 2], [cx + 3, 6], [cx, 8], [cx - 3, 6]], active ? PALETTE.GOLD_HI : PALETTE.MUTED, 'gold');
  c.poly([[cx, 46], [cx + 3, 41], [cx - 3, 41]], active ? meta.accent : PALETTE.SLATE_HI, 'ice');

  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

/**
 * 2. Compact Realm Nav Icon (24x24)
 */
export function buildRealmNavIcon24(meta, active = true) {
  return buildRealmEmblem48(meta, active).scaleNearest(24, 24);
}

/**
 * 3. Map Marker Pin (32x32)
 */
export function buildRealmMarker32(meta) {
  const c = new PixelCanvas(32, 32);
  const badge = buildRealmEmblem48(meta, true).scaleNearest(22, 22);
  c.composite(badge, 5, 2);
  // Crisp gold compass tail below emblem
  c.poly([[12, 23], [20, 23], [16, 30]], PALETTE.GOLD, 'gold');
  c.set(16, 26, meta.accent, 'ice');
  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

/**
 * 4. 16:9 Environment Panorama (96x54 logical grid -> crisp high-res exports)
 */
export function buildRealmScene16x9(meta) {
  const c = new PixelCanvas(96, 54);
  drawRealmSceneArt(c, 0, 0, 96, 54, meta.id, meta);
  // Add carved Norse framing pillars & subtle corner runes
  c.rect(0, 0, 96, 2, PALETTE.OUTLINE, 'outline');
  c.rect(0, 52, 96, 2, PALETTE.OUTLINE, 'outline');
  c.rect(2, 2, 4, 4, PALETTE.GOLD, 'gold');
  c.rect(90, 2, 4, 4, PALETTE.GOLD, 'gold');
  c.rect(2, 48, 4, 4, PALETTE.GOLD, 'gold');
  c.rect(90, 48, 4, 4, PALETTE.GOLD, 'gold');
  return c;
}

/**
 * 5. Symbolic Yggdrasil Nine Realms Tree Map (64x64)
 */
export function buildYggdrasilMap64() {
  const c = new PixelCanvas(64, 64);
  // Dark cosmic slate shield
  c.circle(32, 32, 29, PALETTE.PANEL_DK, 'shadow');
  // Branching golden Yggdrasil roots & crown
  c.line(32, 10, 32, 54, PALETTE.GOLD_MD, 'gold', 3);
  const nodes = [
    [32, 10, PALETTE.GOLD_HI], // Asgard top
    [16, 17, PALETTE.ICE_HI],  // Alfheim
    [48, 17, PALETTE.LEAF],    // Vanaheim
    [13, 30, PALETTE.STEEL_HI],// Jotunheim
    [32, 30, PALETTE.CYAN],    // Midgard center
    [51, 30, PALETTE.BROK],    // Svartalfheim
    [18, 45, PALETTE.EMBER],   // Muspelheim
    [46, 45, PALETTE.WHITE],   // Niflheim
    [32, 55, PALETTE.HEL],     // Helheim roots
  ];
  for (const [nx, ny, col] of nodes) {
    c.line(32, 30, nx, ny, PALETTE.GOLD_DK, 'gold', 1);
    c.circle(nx, ny, 4, PALETTE.OUTLINE, 'outline');
    c.circle(nx, ny, 3, col, 'ice');
    c.set(nx - 1, ny - 1, PALETTE.WHITE, 'accent');
  }
  c.autoOutline(PALETTE.OUTLINE);
  return c;
}
