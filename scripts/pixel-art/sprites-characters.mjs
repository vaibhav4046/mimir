import { PALETTE, PixelCanvas } from './pixel-engine.mjs';

const SAGE_RAMP = [PALETTE.SAGE_DK, PALETTE.SAGE_MD, PALETTE.SAGE, PALETTE.SAGE_HI];
const SKIN_RAMP = [PALETTE.SKIN_DK, PALETTE.SKIN_MD, PALETTE.SKIN, PALETTE.SKIN_HI];
const BROK_RAMP = [PALETTE.BROK_DK, PALETTE.BROK_MD, PALETTE.BROK, PALETTE.BROK_HI];
const GOLD_RAMP = [PALETTE.GOLD_DK, PALETTE.GOLD_MD, PALETTE.GOLD, PALETTE.GOLD_HI];
const SLATE_RAMP = [PALETTE.PANEL_DK, PALETTE.SLATE, PALETTE.SLATE_HI, PALETTE.STEEL];
const ASH_RAMP = [PALETTE.ASH_DK, PALETTE.ASH_MD, PALETTE.MUTED, PALETTE.ASH_HI, PALETTE.WHITE];
const WOOD_RAMP = [PALETTE.WOOD_DK, PALETTE.WOOD_MD, PALETTE.WOOD, PALETTE.WOOD_HI];
const LEAF_RAMP = [PALETTE.LEAF_DK, PALETTE.LEAF_MD, PALETTE.LEAF, PALETTE.LEAF_HI];
const CRIM_RAMP = [PALETTE.CRIM_DK, PALETTE.CRIM_MD, PALETTE.CRIM, PALETTE.CRIM_HI];
const EMBER_RAMP = [PALETTE.EMBER_DK, PALETTE.EMBER_MD, PALETTE.EMBER, PALETTE.EMBER_HI];
const HEL_RAMP = [PALETTE.HEL_DK, PALETTE.HEL_MD, PALETTE.HEL, PALETTE.HEL_HI];

/**
 * Draw curved segmented ram horn cleanly (Mimir signature, NO helmet)
 */
function drawCurvedHorn(c, cx, cy, side = -1) {
  // Parametric curve rising out & curling inward like antique Norse ram/goat horn
  const steps = 22;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = cx + side * (Math.sin(t * Math.PI * 0.78) * 11.5 - t * 2.5);
    const y = cy - t * 15.5 - Math.sin(t * Math.PI) * 3;
    const r = Math.max(1.2, 3.1 - t * 1.9);
    const col = i % 3 === 0 ? PALETTE.GOLD_DK : t > 0.65 ? PALETTE.WHITE : t > 0.3 ? PALETTE.GOLD_HI : PALETTE.GOLD;
    c.circle(x, y, r, col, 'gold');
    if (i % 3 === 1 && r > 1.6) {
      c.set(x - side * 0.8, y - 0.8, PALETTE.GOLD_DK, 'gold');
    }
  }
}

/**
 * Shared braided beard renderer (tapered organic strands + dither + gold clasps)
 */
function drawBeard(c, cx, topY, width, height, ramp, hasGoldClasps = true, forked = false) {
  for (let dy = 0; dy < height; dy++) {
    const ty = dy / Math.max(1, height - 1);
    const halfW = Math.max(2, Math.round((width / 2) * (1 - ty * 0.68)));
    for (let dx = -halfW; dx <= halfW; dx++) {
      if (forked && ty > 0.55 && Math.abs(dx) < Math.max(1, halfW * 0.35)) continue;
      // Vertical strand rib pattern + subtle wave
      const wave = Math.sin((dy + Math.abs(dx)) * 0.55);
      const rib = (Math.abs(dx) + (dy % 3 === 0 ? 1 : 0)) % 3;
      const shadeIdx = Math.max(
        0,
        Math.min(
          ramp.length - 1,
          Math.floor((0.68 - ty * 0.42 + (rib === 0 ? -0.18 : 0.14) + wave * 0.08) * ramp.length)
        )
      );
      c.set(cx + dx, topY + dy, ramp[shadeIdx], 'base');
    }
  }
  if (hasGoldClasps) {
    const claspY = topY + Math.floor(height * 0.52);
    c.rect(cx - 5, claspY, 3, 2, PALETTE.GOLD, 'gold');
    c.set(cx - 4, claspY, PALETTE.GOLD_HI, 'gold');
    c.rect(cx + 2, claspY, 3, 2, PALETTE.GOLD, 'gold');
    c.set(cx + 3, claspY, PALETTE.GOLD_HI, 'gold');
    // Bottom tip clasp
    if (!forked) {
      c.rect(cx - 2, topY + height - 3, 4, 2, PALETTE.GOLD, 'gold');
      c.set(cx - 1, topY + height - 3, PALETTE.GOLD_HI, 'gold');
    }
  }
}

/**
 * 1. MIMIR HEAD (64x64)
 * STRICT RULE: Bald head (exposed weathered cranium, rune markings), sweeping horns,
 * glowing icy-blue eyes, long braided beard. NO hat, NO helmet, NO "M" emblem.
 */
export function buildMimirHead64() {
  const c = new PixelCanvas(64, 64);
  const cx = 32;

  // Sweeping curved horns behind/above temples
  drawCurvedHorn(c, 22, 24, -1);
  drawCurvedHorn(c, 42, 24, 1);

  // Ears
  c.shadedEllipse(19, 30, 2.5, 4, SAGE_RAMP, 'base');
  c.shadedEllipse(45, 30, 2.5, 4, SAGE_RAMP, 'base');

  // Completely BALD cranium & face oval (no brim, no hat, no helmet)
  c.shadedEllipse(cx, 23, 12.5, 11.5, SAGE_RAMP, 'base', PALETTE.ASH_HI);
  c.shadedEllipse(cx, 29, 10.5, 9.5, SAGE_RAMP, 'base');

  // Bald scalp specular shine + subtle Norse forehead tattoos / carved runes
  c.rect(28, 14, 5, 1, PALETTE.ICE_HI, 'base');
  c.set(27, 15, PALETTE.SAGE_HI, 'base');
  // Subtle forehead age furrows & ancient rune tattoo lines (slate ink, NOT an "M"!)
  c.line(29, 19, 35, 19, PALETTE.SAGE_DK, 'runes');
  c.line(32, 16, 32, 22, PALETTE.SLATE, 'runes');
  c.line(30, 17, 32, 19, PALETTE.ICE_DK, 'runes');
  c.line(34, 17, 32, 19, PALETTE.ICE_DK, 'runes');

  // Heavy grizzled eyebrows & deep orbital sockets
  c.rect(23, 25, 6, 2, PALETTE.PANEL_DK, 'shadow');
  c.rect(35, 25, 6, 2, PALETTE.PANEL_DK, 'shadow');
  c.line(23, 24, 28, 24, PALETTE.ASH_HI, 'base');
  c.line(36, 24, 41, 24, PALETTE.ASH_HI, 'base');

  // Glowing icy-cyan eyes
  c.rect(24, 26, 4, 3, PALETTE.ICE_MD, 'eyes');
  c.rect(25, 27, 2, 2, PALETTE.CYAN, 'eyes');
  c.set(25, 27, PALETTE.ICE_HI, 'eyes');
  c.rect(36, 26, 4, 3, PALETTE.ICE_MD, 'eyes');
  c.rect(37, 27, 2, 2, PALETTE.CYAN, 'eyes');
  c.set(37, 27, PALETTE.ICE_HI, 'eyes');

  // Sculpted ancient nose bridge + weathered cheeks
  c.rect(31, 25, 2, 7, PALETTE.SAGE, 'base');
  c.set(32, 25, PALETTE.SAGE_HI, 'base');
  c.rect(30, 31, 4, 2, PALETTE.SAGE_MD, 'base');
  c.set(31, 31, PALETTE.SAGE_HI, 'base');

  // Long flowing braided beard + moustache
  drawBeard(c, cx, 35, 22, 24, ASH_RAMP, true, false);
  // Flowing moustache framing mouth
  c.poly(
    [
      [23, 35],
      [32, 33],
      [41, 35],
      [39, 38],
      [32, 36],
      [25, 38],
    ],
    (x, y) => ((x + y) % 2 === 0 ? PALETTE.WHITE : PALETTE.ASH_HI),
    'base'
  );
  c.rect(29, 36, 6, 1, PALETTE.PANEL_DK, 'shadow');

  // Two subtle floating runic spark motes near beard tips
  c.set(16, 48, PALETTE.CYAN, 'runes');
  c.set(48, 45, PALETTE.CYAN, 'runes');

  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

/**
 * Compact 32x32 hand-tuned bald horned Mimir avatar (no muddiness at 24px/32px)
 */
export function buildMimirHead32() {
  const c = new PixelCanvas(32, 32);
  const rows = [
    '................................',
    '....YY................YY........',
    '...YGGY..............YGGY.......',
    '...YGWY..OOOOOOOOOO..YGWY.......',
    '....YGY.OSSSSSSSSSSO.YGY........',
    '....YGWOSSHSSSSSHSSWOYGY........',
    '.....YWSSSSSSSSSSSSSWWY.........',
    '......OSSSSRSSSSSSSO............',
    '......OSSWSSSSSSSSSO............',
    '.....OOSSSSSSSSSSSSOO...........',
    '.....OSSDDSSSSSSDDSSO...........',
    '.....OSSCISOSSSSCISSO...........',
    '.....OSSDDSSSSSSDDSSO...........',
    '......OSSSHSSSSSHSSO............',
    '......OSSWWSSSSWWSSO............',
    '.....OOWWWWWWWWWWWWOO...........',
    '.....OOWWWAWWWWWAWWOO...........',
    '......OAAAWWWWWWWWAAO...........',
    '......OAAAWAAWAAWAAAO...........',
    '.......OAWWAAWAAWWAO............',
    '.......OYYWAAWAAWYYO............',
    '........OAWWWAAWWWAO............',
    '........OAAWWAAWWAAO............',
    '.........OAAWAAWAAO.............',
    '.........OAAWAAWAAO.............',
    '..........OAAWWAAO..............',
    '..........OYYWWYYO..............',
    '...........OAWWAO...............',
    '............OYYO................',
    '.............OO.................',
    '................................',
    '................................',
  ];
  const legend = {
    O: { color: PALETTE.OUTLINE, layer: 'outline' },
    Y: { color: PALETTE.GOLD, layer: 'gold' },
    G: { color: PALETTE.GOLD_DK, layer: 'gold' },
    W: { color: PALETTE.WHITE, layer: 'base' },
    S: { color: PALETTE.SAGE, layer: 'base' },
    H: { color: PALETTE.SAGE_HI, layer: 'base' },
    R: { color: PALETTE.ICE_MD, layer: 'runes' },
    D: { color: PALETTE.PANEL_DK, layer: 'shadow' },
    C: { color: PALETTE.CYAN, layer: 'eyes' },
    I: { color: PALETTE.ICE_HI, layer: 'eyes' },
    A: { color: PALETTE.MUTED, layer: 'base' },
  };
  c.paintGrid(0, 0, rows, legend);
  return c;
}

/**
 * 16x16 simplified bald Mimir icon for Sidebar/Favicon/tiny UI
 */
export function buildMimirHead16() {
  const c = new PixelCanvas(16, 16);
  const rows = [
    '..Y..........Y..',
    '.YGY........YGY.',
    '.YGY.OOOOOO.YGY.',
    '..Y.OSSSSSSO.Y..',
    '...OSSHSHSSSO...',
    '...OSSSDSSDSO...',
    '...OSICSSICSO...',
    '...OSSSSSSSSO...',
    '...OWWWWWWWWO...',
    '....OAAWWAAO....',
    '....OYAWWAYO....',
    '.....OAWWAO.....',
    '.....OAWWAO.....',
    '......OYYO......',
    '.......OO.......',
    '................',
  ];
  const legend = {
    O: { color: PALETTE.OUTLINE, layer: 'outline' },
    Y: { color: PALETTE.GOLD, layer: 'gold' },
    G: { color: PALETTE.GOLD_DK, layer: 'gold' },
    S: { color: PALETTE.SAGE, layer: 'base' },
    H: { color: PALETTE.SAGE_HI, layer: 'base' },
    D: { color: PALETTE.PANEL_DK, layer: 'shadow' },
    C: { color: PALETTE.CYAN, layer: 'eyes' },
    I: { color: PALETTE.ICE_HI, layer: 'eyes' },
    W: { color: PALETTE.WHITE, layer: 'base' },
    A: { color: PALETTE.MUTED, layer: 'base' },
  };
  c.paintGrid(0, 0, rows, legend);
  return c;
}

/**
 * Circular clipped badge frame around any character bust
 */
export function makeCircularBadge(srcCanvas, rimHex = PALETTE.GOLD) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const c = new PixelCanvas(w, h);
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  const r = Math.floor(w * 0.44);

  // Dark medallion backdrop
  c.circle(cx, cy, r - 1, PALETTE.PANEL_DK, 'shadow');
  // Subtle frost ring inside
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dist = Math.hypot(x - cx, y - cy);
      if (dist <= r - 2) {
        const sc = srcCanvas.get(x, y);
        if (sc) c.set(x, y, sc, srcCanvas.layers[y * w + x]);
      } else if (dist <= r) {
        c.set(x, y, rimHex, 'gold');
      } else if (dist <= r + 1.4) {
        c.set(x, y, PALETTE.OUTLINE, 'outline');
      }
    }
  }
  return c;
}

/**
 * 2. ALL-FATHER WARRIOR (Guardian / Execution archetype - NOT exact Kratos copy)
 */
export function buildAllFatherWarrior64() {
  const c = new PixelCanvas(64, 64);
  const cx = 32;

  // Frost battleaxe diagonal gleam behind shoulder
  c.line(43, 12, 26, 48, PALETTE.WOOD_MD, 'accent', 2);
  c.poly(
    [
      [42, 8],
      [53, 12],
      [51, 23],
      [42, 20],
    ],
    (x, y) => (x > 49 ? PALETTE.CYAN : PALETTE.STEEL),
    'ice'
  );

  // Heavy wolf-pelt & iron shoulders
  c.shadedEllipse(cx, 51, 22, 11, SLATE_RAMP, 'base');
  c.shadedEllipse(18, 43, 8, 5, ASH_RAMP, 'base');
  c.shadedEllipse(46, 43, 8, 5, ASH_RAMP, 'base');
  // Gold breastplate harness strap
  c.line(18, 39, 44, 57, PALETTE.GOLD, 'gold', 3);
  c.line(18, 39, 44, 57, PALETTE.GOLD_HI, 'gold', 1);

  // Rugged bald/short-cropped guardian head with crimson war stripe
  c.shadedEllipse(cx, 23, 10, 11, SKIN_RAMP, 'base');
  c.rect(24, 15, 3, 12, PALETTE.CRIM_MD, 'accent');
  c.rect(25, 16, 1, 9, PALETTE.CRIM, 'accent');

  // Stern brow + frost-steel eyes
  c.rect(24, 22, 6, 2, PALETTE.PANEL_DK, 'shadow');
  c.rect(34, 22, 6, 2, PALETTE.PANEL_DK, 'shadow');
  c.rect(26, 24, 3, 2, PALETTE.WHITE, 'eyes');
  c.set(27, 24, PALETTE.CYAN, 'eyes');
  c.rect(35, 24, 3, 2, PALETTE.WHITE, 'eyes');
  c.set(36, 24, PALETTE.CYAN, 'eyes');

  // Heavy dark iron-grey beard
  drawBeard(c, cx, 30, 18, 17, SLATE_RAMP, false, false);
  c.rect(29, 31, 6, 2, PALETTE.PANEL_DK, 'shadow');

  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

/**
 * 3. YOUNG ARCHER SCOUT (Research / Browsing archetype - NOT exact Atreus copy)
 */
export function buildYoungArcher64() {
  const c = new PixelCanvas(64, 64);
  const cx = 31;

  // Quiver + arrow fletching & cyan runic bow silhouette over right shoulder
  c.line(46, 10, 40, 48, PALETTE.WOOD, 'accent', 2);
  c.arc(46, 29, 8, 20, -1.4, 1.4, PALETTE.WOOD_HI, 'accent');
  c.line(47, 11, 47, 47, PALETTE.CYAN, 'ice', 1);

  // Ochre fur mantle shoulders & green-slate tunic
  c.shadedEllipse(cx, 50, 17, 10, LEAF_RAMP, 'base');
  c.shadedEllipse(cx, 41, 13, 5, GOLD_RAMP, 'gold');

  // Youthful ranger hood framing face
  c.shadedEllipse(cx, 25, 11, 12, SLATE_RAMP, 'base');
  c.shadedEllipse(cx, 26, 8, 9, SKIN_RAMP, 'base');
  // Hair tuft under hood
  c.poly(
    [
      [25, 17],
      [37, 17],
      [35, 22],
      [26, 21],
    ],
    PALETTE.WOOD_MD,
    'accent'
  );

  // Crisp bright scout eyes + determined brow
  c.rect(25, 24, 4, 2, PALETTE.PANEL_DK, 'shadow');
  c.rect(33, 24, 4, 2, PALETTE.PANEL_DK, 'shadow');
  c.rect(26, 26, 3, 2, PALETTE.CYAN, 'eyes');
  c.set(27, 26, PALETTE.ICE_HI, 'eyes');
  c.rect(34, 26, 3, 2, PALETTE.CYAN, 'eyes');
  c.set(35, 26, PALETTE.ICE_HI, 'eyes');

  // Scarf cowl
  c.poly(
    [
      [22, 34],
      [40, 34],
      [37, 42],
      [25, 42],
    ],
    PALETTE.SLATE_HI,
    'base'
  );

  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

/**
 * 4. FORGE BOT BROK (Rugged cobalt-steel dwarven builder bot)
 */
export function buildForgeBotBrok64() {
  const c = new PixelCanvas(64, 64);
  const cx = 31;

  // Heavy square forge mallet over shoulder
  c.line(48, 22, 48, 52, PALETTE.WOOD_MD, 'accent', 3);
  c.rect(41, 11, 14, 10, PALETTE.STEEL, 'base');
  c.rect(42, 12, 12, 3, PALETTE.STEEL_HI, 'base');
  c.rect(44, 15, 8, 3, PALETTE.CYAN, 'runes');

  // Broad sturdy steel torso + heavy leather apron strap
  c.rect(14, 38, 34, 21, PALETTE.SLATE, 'base');
  c.ditherRect(16, 40, 30, 17, PALETTE.PANEL_DK, PALETTE.SLATE_HI, 0.5, 'base');
  c.rect(21, 39, 5, 20, PALETTE.WOOD_MD, 'accent');
  c.rect(36, 39, 5, 20, PALETTE.WOOD_MD, 'accent');
  // Brass rivets
  c.set(23, 42, PALETTE.GOLD, 'gold');
  c.set(38, 42, PALETTE.GOLD, 'gold');
  c.set(23, 52, PALETTE.GOLD, 'gold');
  c.set(38, 52, PALETTE.GOLD, 'gold');

  // Blocky cobalt dwarf-bot cranium
  c.shadedEllipse(cx, 23, 12, 10, BROK_RAMP, 'base');
  c.rect(21, 17, 20, 4, PALETTE.BROK_HI, 'base');
  // Asymmetric gruff visor brow
  c.rect(20, 21, 22, 4, PALETTE.SLATE, 'shadow');
  c.rect(23, 24, 5, 3, PALETTE.EMBER, 'eyes');
  c.set(24, 25, PALETTE.EMBER_HI, 'eyes');
  c.rect(34, 24, 5, 3, PALETTE.EMBER, 'eyes');
  c.set(35, 25, PALETTE.EMBER_HI, 'eyes');

  // Rough forked soot-steel beard
  drawBeard(c, cx, 31, 22, 17, ASH_RAMP, false, true);

  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

/**
 * 5. FORGE BOT SINDRI (Refined gilded dwarf artificer bot — clearly distinct from Brok!)
 */
export function buildForgeBotSindri64() {
  const c = new PixelCanvas(64, 64);
  const cx = 32;

  // Precision brass calipers held gracefully on right side
  c.line(48, 18, 44, 46, PALETTE.GOLD, 'gold', 2);
  c.line(48, 18, 54, 30, PALETTE.GOLD_HI, 'gold', 1);
  c.line(48, 18, 42, 30, PALETTE.GOLD_HI, 'gold', 1);

  // Tall sleek ivory-slate artificer mantle with gold trim
  c.poly(
    [
      [20, 39],
      [44, 39],
      [47, 58],
      [17, 58],
    ],
    (x, y) => ((x + y) % 5 === 0 ? PALETTE.SLATE : PALETTE.PANEL_DK),
    'base'
  );
  // Crisp gold collar filigree V
  c.line(23, 39, 32, 49, PALETTE.GOLD, 'gold', 2);
  c.line(41, 39, 32, 49, PALETTE.GOLD, 'gold', 2);
  c.rect(30, 48, 4, 4, PALETTE.CYAN, 'runes');

  // Slender sculpted artisan head + twin brass optical goggles
  c.shadedEllipse(cx, 23, 9.5, 11, ASH_RAMP, 'base');
  c.rect(22, 20, 20, 6, PALETTE.GOLD_MD, 'gold');
  c.circle(26, 23, 3.5, PALETTE.GOLD, 'gold');
  c.circle(26, 23, 2, PALETTE.CYAN, 'eyes');
  c.set(25, 22, PALETTE.ICE_HI, 'eyes');
  c.circle(38, 23, 3.5, PALETTE.GOLD, 'gold');
  c.circle(38, 23, 2, PALETTE.CYAN, 'eyes');
  c.set(37, 22, PALETTE.ICE_HI, 'eyes');

  // Immaculate pointed brass-trimmed beard
  drawBeard(c, cx, 32, 12, 13, WOOD_RAMP, true, false);

  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

/**
 * 6-12: Extended Pantheon & Nidavellir Roster
 */
export function buildFreyaValkyrie64() {
  const c = new PixelCanvas(64, 64);
  const cx = 32;
  // Feathered falcon shoulder cloak + Valkyrie emerald-gold bodice
  c.shadedEllipse(cx, 50, 19, 10, LEAF_RAMP, 'base');
  for (let i = 0; i < 4; i++) {
    c.line(13 + i * 2, 36 + i * 3, 25, 55, i % 2 === 0 ? PALETTE.ASH_HI : PALETTE.STEEL, 'base', 3);
    c.line(51 - i * 2, 36 + i * 3, 39, 55, i % 2 === 0 ? PALETTE.ASH_HI : PALETTE.STEEL, 'base', 3);
  }
  c.poly([[23, 39], [32, 53], [41, 39], [36, 37], [28, 37]], PALETTE.GOLD, 'gold');
  c.poly([[26, 40], [32, 49], [38, 40]], PALETTE.LEAF_MD, 'base');
  // Hair + Vanir golden circlet
  c.shadedEllipse(cx, 25, 12, 13, WOOD_RAMP, 'accent');
  c.shadedEllipse(cx, 26, 9, 10, SKIN_RAMP, 'base');
  c.rect(23, 18, 18, 2, PALETTE.GOLD, 'gold');
  c.rect(31, 17, 2, 3, PALETTE.LEAF_HI, 'runes');
  c.rect(26, 25, 3, 2, PALETTE.LEAF_HI, 'eyes');
  c.rect(35, 25, 3, 2, PALETTE.LEAF_HI, 'eyes');
  // Emerald Vanir magic spark floating
  c.circle(49, 25, 4, PALETTE.LEAF, 'runes');
  c.set(48, 24, PALETTE.LEAF_HI, 'runes');
  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

export function buildOdinArchivist64() {
  const c = new PixelCanvas(64, 64);
  const cx = 32;
  // Raven perch shoulder silhouette
  c.poly(
    [
      [11, 28],
      [17, 24],
      [20, 35],
      [13, 38],
    ],
    PALETTE.SLATE,
    'accent'
  );
  c.set(14, 26, PALETTE.CYAN, 'eyes');
  // Cloaked dark archivist mantle & wide traveler hat brim
  c.shadedEllipse(cx, 50, 20, 10, SLATE_RAMP, 'base');
  c.poly(
    [
      [14, 18],
      [32, 9],
      [50, 18],
      [53, 22],
      [11, 22],
    ],
    (x, y) => (y > 18 ? PALETTE.PANEL_DK : PALETTE.SLATE_HI),
    'shadow'
  );
  c.shadedEllipse(cx, 28, 9, 8, SKIN_RAMP, 'base');
  // Single glowing Odin eye + eyepatch
  c.rect(24, 25, 5, 3, PALETTE.GOLD_DK, 'gold');
  c.rect(35, 25, 4, 3, PALETTE.CYAN, 'eyes');
  c.set(36, 26, PALETTE.ICE_HI, 'eyes');
  drawBeard(c, cx, 33, 18, 22, ASH_RAMP, false, false);
  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

export function buildThorThunderer64() {
  const c = new PixelCanvas(64, 64);
  const cx = 32;
  // Storm lightning halo arcs
  c.line(12, 16, 17, 22, PALETTE.CYAN, 'ice', 1);
  c.line(17, 22, 13, 27, PALETTE.ICE_HI, 'ice', 1);
  c.line(52, 16, 47, 22, PALETTE.CYAN, 'ice', 1);
  c.line(47, 22, 51, 27, PALETTE.ICE_HI, 'ice', 1);

  // Massive barrel iron & fur shoulders
  c.shadedEllipse(cx, 50, 22, 11, SLATE_RAMP, 'base');
  c.rect(22, 42, 20, 4, PALETTE.GOLD, 'gold');
  c.shadedEllipse(cx, 24, 11, 10, SKIN_RAMP, 'base');
  c.rect(25, 23, 3, 2, PALETTE.CYAN, 'eyes');
  c.rect(36, 23, 3, 2, PALETTE.CYAN, 'eyes');
  // Thick russet ginger storm beard
  drawBeard(c, cx, 30, 22, 20, EMBER_RAMP, true, false);
  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

export function buildTyrDiplomat64() {
  const c = new PixelCanvas(64, 64);
  const cx = 32;
  // Spear behind left shoulder
  c.line(15, 7, 22, 56, PALETTE.GOLD, 'gold', 2);
  c.poly(
    [
      [13, 6],
      [18, 5],
      [17, 14],
    ],
    PALETTE.STEEL_HI,
    'accent'
  );
  c.shadedEllipse(cx, 50, 17, 10, HEL_RAMP, 'base');
  c.rect(28, 41, 8, 16, PALETTE.GOLD, 'gold');
  c.shadedEllipse(cx, 24, 9.5, 11, SKIN_RAMP, 'base');
  c.rect(26, 23, 3, 2, PALETTE.GOLD_HI, 'eyes');
  c.rect(35, 23, 3, 2, PALETTE.GOLD_HI, 'eyes');
  drawBeard(c, cx, 32, 14, 14, WOOD_RAMP, true, false);
  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

export function buildAngrbodaMystic64() {
  const c = new PixelCanvas(64, 64);
  const cx = 32;
  c.shadedEllipse(cx, 50, 16, 9, EMBER_RAMP, 'accent');
  // Woven dreadlocks silhouette + gold hair cuffs
  for (let i = -3; i <= 3; i++) {
    c.rect(cx + i * 3 - 1, 14, 2, 22, PALETTE.PANEL_DK, 'shadow');
    if (i % 2 === 0) c.set(cx + i * 3 - 1, 29, PALETTE.GOLD, 'gold');
  }
  c.shadedEllipse(cx, 26, 9, 10, WOOD_RAMP, 'base');
  c.rect(26, 25, 3, 2, PALETTE.CYAN, 'eyes');
  c.rect(35, 25, 3, 2, PALETTE.CYAN, 'eyes');
  // Glowing Jötunn paint symbol on palm
  c.circle(48, 36, 4, PALETTE.GOLD, 'runes');
  c.set(48, 36, PALETTE.CYAN, 'runes');
  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

export function buildHeimdallSentinel64() {
  const c = new PixelCanvas(64, 64);
  const cx = 32;
  // Tall gilded Aesir sentinel breastplate & sculpted pauldrons (replaces flat block)
  c.shadedEllipse(cx, 50, 19, 10, SLATE_RAMP, 'base');
  c.shadedEllipse(16, 44, 6, 5, GOLD_RAMP, 'gold');
  c.shadedEllipse(48, 44, 6, 5, GOLD_RAMP, 'gold');
  c.poly([[21, 37], [43, 37], [40, 56], [24, 56]], PALETTE.GOLD_MD, 'gold');
  c.poly([[24, 37], [40, 37], [37, 52], [27, 52]], PALETTE.GOLD_HI, 'gold');
  c.rect(29, 39, 6, 9, PALETTE.ICE_HI, 'runes');
  // Vigilance collar + sharp gaunt face + glowing foresight eyes
  c.rect(23, 33, 18, 5, PALETTE.GOLD, 'gold');
  c.shadedEllipse(cx, 23, 9, 10, SKIN_RAMP, 'base');
  c.rect(25, 22, 4, 2, PALETTE.ICE_HI, 'eyes');
  c.rect(35, 22, 4, 2, PALETTE.ICE_HI, 'eyes');
  // Swept golden sentinel hair crown
  c.poly([[23, 13], [41, 13], [38, 19], [26, 19]], PALETTE.GOLD, 'gold');
  c.rect(27, 13, 10, 2, PALETTE.GOLD_HI, 'gold');
  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

export function buildDurlinCrafter64() {
  const c = new PixelCanvas(64, 64);
  const cx = 31;
  // Rebel bowler cap + brass hatband + monocle + octopus familiar
  c.shadedEllipse(cx, 49, 17, 10, SLATE_RAMP, 'base');
  c.rect(26, 40, 10, 12, PALETTE.GOLD_MD, 'gold');
  c.shadedEllipse(cx, 27, 9.5, 9, BROK_RAMP, 'base');
  c.rect(22, 11, 18, 7, PALETTE.SLATE_HI, 'base');
  c.rect(22, 16, 18, 2, PALETTE.GOLD, 'gold');
  c.rect(19, 18, 24, 3, PALETTE.PANEL_DK, 'shadow');
  // Brass monocle below brim
  c.circle(36, 26, 3.5, PALETTE.GOLD, 'gold');
  c.circle(36, 26, 2, PALETTE.ICE_HI, 'eyes');
  c.rect(25, 26, 3, 2, PALETTE.WHITE, 'eyes');
  drawBeard(c, cx, 32, 14, 11, ASH_RAMP, false, false);
  // Small cyan octopus pet peeking on shoulder
  c.circle(47, 39, 4, PALETTE.HEL, 'runes');
  c.set(46, 38, PALETTE.WHITE, 'eyes');
  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

export function buildLundaSmith64() {
  const c = new PixelCanvas(64, 64);
  const cx = 32;
  // Ginger braids + heavy blacksmith tongs + steel plate
  c.shadedEllipse(cx, 49, 18, 10, WOOD_RAMP, 'base');
  c.line(18, 39, 46, 56, PALETTE.GOLD, 'gold', 2);
  // Twin braids down sides
  c.rect(19, 25, 4, 20, PALETTE.EMBER_MD, 'accent');
  c.rect(41, 25, 4, 20, PALETTE.EMBER_MD, 'accent');
  c.shadedEllipse(cx, 25, 9.5, 9.5, SKIN_RAMP, 'base');
  c.rect(22, 16, 20, 4, PALETTE.EMBER, 'accent');
  c.rect(26, 24, 3, 2, PALETTE.LEAF_HI, 'eyes');
  c.rect(35, 24, 3, 2, PALETTE.LEAF_HI, 'eyes');
  // Glowing forge tongs on left
  c.line(13, 18, 13, 45, PALETTE.STEEL, 'accent', 2);
  c.rect(11, 14, 4, 4, PALETTE.EMBER_HI, 'runes');
  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

export const CHARACTER_DEFS = [
  {
    id: 'mimir-head',
    name: 'Mimir',
    category: 'characters',
    agentRole: 'Central Assistant, Knowledge & Orchestration',
    build64: buildMimirHead64,
    build32: buildMimirHead32,
    build16: buildMimirHead16,
    withStates: true,
    hasCircular: true,
  },
  {
    id: 'all-father-warrior',
    name: 'Guardian Father Warrior',
    category: 'characters',
    agentRole: 'Guardian, Reliability & System Execution',
    build64: buildAllFatherWarrior64,
    withStates: true,
    hasCircular: true,
  },
  {
    id: 'young-archer',
    name: 'Young Archer Scout',
    category: 'characters',
    agentRole: 'Scout, Browser Research & Retrieval',
    build64: buildYoungArcher64,
    withStates: true,
    hasCircular: true,
  },
  {
    id: 'forge-bot-brok',
    name: 'Forge Bot Brok',
    category: 'characters',
    agentRole: 'Builder, Tool Execution & Infrastructure',
    build64: buildForgeBotBrok64,
    withStates: true,
    hasCircular: true,
  },
  {
    id: 'forge-bot-sindri',
    name: 'Forge Bot Sindri',
    category: 'characters',
    agentRole: 'Artificer, Polish, Refinement & QA',
    build64: buildForgeBotSindri64,
    withStates: true,
    hasCircular: true,
  },
  {
    id: 'freya-valkyrie',
    name: 'Freya Valkyrie Healer',
    category: 'characters',
    agentRole: 'Healer, Diagnostics & Recovery',
    build64: buildFreyaValkyrie64,
    withStates: false,
    hasCircular: true,
  },
  {
    id: 'odin-archivist',
    name: 'Odin Wanderer Archivist',
    category: 'characters',
    agentRole: 'Archivist, Memory & Knowledge Indexing',
    build64: buildOdinArchivist64,
    withStates: false,
    hasCircular: true,
  },
  {
    id: 'thor-thunderer',
    name: 'Thor Thunder Enforcer',
    category: 'characters',
    agentRole: 'Heavy Parallel Compute & Burst Ops',
    build64: buildThorThunderer64,
    withStates: false,
    hasCircular: true,
  },
  {
    id: 'tyr-diplomat',
    name: 'Tyr Strategist Diplomat',
    category: 'characters',
    agentRole: 'Diplomat, Coordination & Comms',
    build64: buildTyrDiplomat64,
    withStates: false,
    hasCircular: true,
  },
  {
    id: 'angrboda-mystic',
    name: 'Angrboda Jotun Mystic',
    category: 'characters',
    agentRole: 'Prophetic Pattern & Creative Synthesis',
    build64: buildAngrbodaMystic64,
    withStates: false,
    hasCircular: true,
  },
  {
    id: 'heimdall-sentinel',
    name: 'Heimdall Foresight Sentinel',
    category: 'characters',
    agentRole: 'Sentinel, Monitoring & Guardrails',
    build64: buildHeimdallSentinel64,
    withStates: false,
    hasCircular: true,
  },
  {
    id: 'durlin-crafter',
    name: 'Durlin Rebel Scribe',
    category: 'characters',
    agentRole: 'Schema Governance & Audit Trails',
    build64: buildDurlinCrafter64,
    withStates: false,
    hasCircular: true,
  },
  {
    id: 'lunda-smith',
    name: 'Lunda Master Armorer',
    category: 'characters',
    agentRole: 'Gear Upgrade & Runtime Tuning',
    build64: buildLundaSmith64,
    withStates: false,
    hasCircular: true,
  },
];

/**
 * 14 Modular Accessories (48x48 transparent socket overlays for custom bot builder)
 */
export const ACCESSORY_DEFS = [
  {
    id: 'helmets-valkyrie-crest',
    slot: 'helmets',
    label: 'Valkyrie Brass Winged Crest',
    draw: c => {
      c.poly([[12, 16], [19, 12], [18, 22]], PALETTE.GOLD, 'gold');
      c.poly([[36, 16], [29, 12], [30, 22]], PALETTE.GOLD, 'gold');
      c.rect(17, 14, 14, 3, PALETTE.GOLD_HI, 'gold');
    },
  },
  {
    id: 'headwear-scout-hood',
    slot: 'headwear',
    label: 'Norse Ranger Hood',
    draw: c => {
      c.poly([[24, 5], [36, 14], [33, 21], [15, 21], [12, 14]], PALETTE.LEAF_DK, 'base');
      c.line(15, 16, 24, 9, PALETTE.GOLD, 'gold');
      c.line(33, 16, 24, 9, PALETTE.GOLD, 'gold');
    },
  },
  {
    id: 'hair-braided-crown',
    slot: 'hair',
    label: 'Braided Silver Crown',
    draw: c => {
      c.rect(14, 15, 3, 14, PALETTE.ASH_HI, 'base');
      c.rect(31, 15, 3, 14, PALETTE.ASH_HI, 'base');
      c.set(15, 26, PALETTE.GOLD, 'gold');
      c.set(32, 26, PALETTE.GOLD, 'gold');
    },
  },
  {
    id: 'beards-braided-sage',
    slot: 'beards',
    label: 'Twin-Clasp Sage Beard',
    draw: c => {
      drawBeard(c, 24, 29, 14, 14, ASH_RAMP, true, false);
    },
  },
  {
    id: 'masks-artificer-visor',
    slot: 'masks',
    label: 'Sindri Gold Optical Visor',
    draw: c => {
      c.rect(16, 19, 16, 4, PALETTE.GOLD, 'gold');
      c.rect(18, 20, 4, 2, PALETTE.CYAN, 'eyes');
      c.rect(26, 20, 4, 2, PALETTE.CYAN, 'eyes');
    },
  },
  {
    id: 'armor-wolf-pauldron',
    slot: 'armor',
    label: 'Wolf-Pelt & Steel Mantle',
    draw: c => {
      c.shadedEllipse(24, 41, 16, 6, SLATE_RAMP, 'base');
      c.rect(13, 35, 22, 3, PALETTE.ASH_HI, 'base');
      c.rect(22, 39, 4, 4, PALETTE.GOLD, 'gold');
    },
  },
  {
    id: 'eye-effects-bifrost-flare',
    slot: 'eye-effects',
    label: 'Bifrost Cyan Eye Flare',
    draw: c => {
      c.line(16, 21, 21, 21, PALETTE.ICE_HI, 'eyes');
      c.line(27, 21, 32, 21, PALETTE.ICE_HI, 'eyes');
      c.set(15, 20, PALETTE.CYAN, 'eyes');
      c.set(33, 20, PALETTE.CYAN, 'eyes');
    },
  },
  {
    id: 'crystals-shoulder-shard',
    slot: 'crystals',
    label: 'Bifrost Crystal Cluster',
    draw: c => {
      c.poly([[36, 36], [40, 25], [43, 36]], PALETTE.CYAN, 'ice');
      c.poly([[40, 36], [43, 29], [45, 37]], PALETTE.ICE_HI, 'ice');
    },
  },
  {
    id: 'runes-brow-raido',
    slot: 'runes',
    label: 'Glowing Elder Futhark Halo',
    draw: c => {
      c.line(22, 7, 22, 13, PALETTE.CYAN, 'runes');
      c.line(22, 7, 26, 9, PALETTE.ICE_HI, 'runes');
      c.line(22, 10, 26, 13, PALETTE.CYAN, 'runes');
    },
  },
  {
    id: 'weapons-frost-axe',
    slot: 'weapons',
    label: 'Shoulder Frost Battleaxe',
    draw: c => {
      c.line(37, 10, 32, 42, PALETTE.WOOD, 'accent', 2);
      c.poly([[36, 9], [44, 12], [42, 20], [36, 17]], PALETTE.CYAN, 'ice');
    },
  },
  {
    id: 'books-lore-codex',
    slot: 'books',
    label: 'Chained Edda Codex',
    draw: c => {
      c.rect(5, 29, 10, 12, PALETTE.PANEL_DK, 'base');
      c.rect(6, 30, 8, 10, PALETTE.GOLD_DK, 'gold');
      c.rect(9, 33, 3, 4, PALETTE.CYAN, 'runes');
    },
  },
  {
    id: 'scrolls-prophecy',
    slot: 'scrolls',
    label: 'Rolled Prophecy Scroll',
    draw: c => {
      c.rect(34, 30, 10, 6, PALETTE.ASH_HI, 'base');
      c.rect(33, 30, 2, 6, PALETTE.GOLD, 'gold');
      c.rect(43, 30, 2, 6, PALETTE.GOLD, 'gold');
    },
  },
  {
    id: 'tools-smith-hammer',
    slot: 'tools',
    label: 'Dwarven Forging Mallet',
    draw: c => {
      c.line(9, 18, 9, 43, PALETTE.WOOD_MD, 'accent', 2);
      c.rect(5, 13, 9, 6, PALETTE.STEEL, 'base');
      c.rect(7, 15, 5, 2, PALETTE.GOLD, 'gold');
    },
  },
  {
    id: 'shields-guardian-round',
    slot: 'shields',
    label: 'Brass Guardian Round Shield',
    draw: c => {
      c.circle(39, 37, 7, PALETTE.GOLD, 'gold');
      c.circle(39, 37, 5, PALETTE.STEEL, 'base');
      c.circle(39, 37, 2, PALETTE.GOLD_HI, 'gold');
    },
  },
];

export function buildAccessoryCanvas(def) {
  const c = new PixelCanvas(48, 48);
  def.draw(c);
  c.autoOutline(PALETTE.OUTLINE);
  return c;
}
