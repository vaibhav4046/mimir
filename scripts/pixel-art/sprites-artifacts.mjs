import { PALETTE, PixelCanvas } from './pixel-engine.mjs';

const GOLD_RAMP = [PALETTE.GOLD_DK, PALETTE.GOLD_MD, PALETTE.GOLD, PALETTE.GOLD_HI];
const SLATE_RAMP = [PALETTE.PANEL_DK, PALETTE.SLATE, PALETTE.SLATE_HI, PALETTE.STEEL];
const ICE_RAMP = [PALETTE.ICE_DK, PALETTE.ICE_MD, PALETTE.CYAN, PALETTE.ICE_HI];
const EMBER_RAMP = [PALETTE.EMBER_DK, PALETTE.EMBER_MD, PALETTE.EMBER, PALETTE.EMBER_HI];
const WOOD_RAMP = [PALETTE.WOOD_DK, PALETTE.WOOD_MD, PALETTE.WOOD, PALETTE.WOOD_HI];
const ASH_RAMP = [PALETTE.ASH_DK, PALETTE.ASH_MD, PALETTE.MUTED, PALETTE.ASH_HI];

function makeCanvas(fn) {
  const c = new PixelCanvas(48, 48);
  fn(c);
  c.autoOutline(PALETTE.OUTLINE);
  return c;
}

export const ARTIFACT_DEFS = [
  // === WEAPONS ===
  {
    id: 'frost-axe',
    name: 'Leviathan Frost Axe',
    category: 'weapons',
    refUrl: 'https://www.playstation.com/en-gb/games/god-of-war-ragnarok/',
    build: () =>
      makeCanvas(c => {
        // Curved ash handle + brass pommel
        c.line(13, 39, 32, 11, PALETTE.WOOD_MD, 'accent', 3);
        c.line(14, 38, 32, 11, PALETTE.WOOD_HI, 'accent', 1);
        c.circle(12, 40, 3, PALETTE.GOLD, 'gold');
        // Axe beard crescent blade
        c.poly([[23, 8], [39, 9], [37, 25], [26, 20]], PALETTE.STEEL, 'base');
        c.poly([[34, 9], [40, 10], [38, 26], [35, 22]], PALETTE.ICE_HI, 'ice');
        // Glowing Cyan Runes etched in blade center
        c.line(30, 13, 30, 20, PALETTE.CYAN, 'runes');
        c.line(28, 15, 32, 17, PALETTE.ICE_HI, 'runes');
        c.rect(25, 11, 5, 4, PALETTE.GOLD, 'gold');
      }),
  },
  {
    id: 'ember-twin-blades',
    name: 'Chaos Ember Twin Blades',
    category: 'weapons',
    refUrl: 'https://www.playstation.com/en-gb/games/god-of-war-ragnarok/',
    build: () =>
      makeCanvas(c => {
        // Crossed curved scimitar silhouette with glowing ember edges + chain pommel
        for (const dir of [-1, 1]) {
          const x = s => (dir === 1 ? s : 47 - s);
          c.line(x(14), 36, x(29), 21, PALETTE.GOLD, 'gold', 2);
          c.poly(
            [[x(24), 24], [x(35), 9], [x(38), 18], [x(28), 28]],
            PALETTE.SLATE_HI,
            'base'
          );
          c.line(x(35), 9, x(38), 18, PALETTE.EMBER_HI, 'accent', 2);
          c.line(x(29), 20, x(35), 14, PALETTE.EMBER, 'runes');
          // Chain links below hilt
          c.circle(x(11), 39, 2, PALETTE.STEEL, 'base');
        }
      }),
  },
  {
    id: 'draupnir-spear',
    name: 'Draupnir Wind Spear',
    category: 'weapons',
    refUrl: 'https://www.playstation.com/en-gb/games/god-of-war-ragnarok/',
    build: () =>
      makeCanvas(c => {
        c.line(9, 39, 36, 12, PALETTE.GOLD_MD, 'gold', 2);
        c.circle(16, 32, 2.5, PALETTE.GOLD_HI, 'gold');
        // Golden leaf spearhead + wind cyan aura
        c.circle(36, 12, 6, PALETTE.ICE_DK, 'ice');
        c.poly([[29, 15], [41, 7], [33, 19]], PALETTE.GOLD_HI, 'gold');
        c.line(31, 17, 39, 9, PALETTE.WHITE, 'ice');
      }),
  },
  {
    id: 'mjolnir-hammer',
    name: 'Mjolnir Thunder Hammer',
    category: 'weapons',
    refUrl: 'https://www.playstation.com/en-gb/games/god-of-war-ragnarok/',
    build: () =>
      makeCanvas(c => {
        // Warm wrapped leather shaft with bright gold pommel loop
        c.rect(22, 22, 4, 18, PALETTE.WOOD, 'accent');
        c.rect(23, 22, 2, 18, PALETTE.WOOD_HI, 'accent');
        for (const ly of [25, 29, 33]) c.rect(22, ly, 4, 1, PALETTE.GOLD_MD, 'gold');
        c.rect(20, 39, 8, 3, PALETTE.GOLD, 'gold');
        c.rect(22, 41, 4, 2, PALETTE.GOLD_HI, 'gold');
        // Heavy trapezoidal bevel hammerhead
        c.poly([[10, 9], [38, 9], [35, 22], [13, 22]], PALETTE.SLATE_HI, 'base');
        c.rect(12, 10, 24, 3, PALETTE.STEEL_HI, 'base');
        // Norse gold & lightning filigree trim
        c.line(15, 15, 20, 19, PALETTE.GOLD, 'gold');
        c.line(20, 19, 24, 14, PALETTE.CYAN, 'ice');
        c.line(24, 14, 29, 19, PALETTE.GOLD, 'gold');
        c.line(29, 19, 33, 15, PALETTE.GOLD_HI, 'gold');
      }),
  },
  {
    id: 'guardian-shield',
    name: 'Guardian Round Shield',
    category: 'weapons',
    refUrl: 'https://blog.playstation.com/2023/04/11/god-of-war-ragnarok-new-game-plus-build-guide/',
    build: () =>
      makeCanvas(c => {
        c.circle(24, 24, 17, PALETTE.GOLD, 'gold');
        c.circle(24, 24, 14, PALETTE.ICE_DK, 'base');
        // Radial shield plank ribs
        for (const a of [0, 1, 2, 3]) {
          const ang = (a * Math.PI) / 4;
          c.line(
            24 - Math.cos(ang) * 13,
            24 - Math.sin(ang) * 13,
            24 + Math.cos(ang) * 13,
            24 + Math.sin(ang) * 13,
            PALETTE.STEEL,
            'base'
          );
        }
        // Brass boss center + concentric glow
        c.circle(24, 24, 5, PALETTE.GOLD_HI, 'gold');
        c.circle(24, 24, 2, PALETTE.GOLD_DK, 'shadow');
      }),
  },

  // === RELICS & LORE ===
  {
    id: 'yggdrasil',
    name: 'Yggdrasil World Tree',
    category: 'relics',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        // Spreading golden canopy
        c.shadedEllipse(24, 16, 16, 9, GOLD_RAMP, 'gold');
        c.circle(13, 19, 5, PALETTE.GOLD_MD, 'gold');
        c.circle(35, 19, 5, PALETTE.GOLD_MD, 'gold');
        c.circle(24, 12, 7, PALETTE.GOLD_HI, 'gold');
        // Gnarled roots & trunk + glowing core rune
        c.rect(20, 21, 8, 16, PALETTE.WOOD_MD, 'accent');
        c.line(22, 22, 22, 36, PALETTE.WOOD_HI, 'accent');
        c.line(21, 35, 11, 41, PALETTE.WOOD, 'accent', 2);
        c.line(27, 35, 37, 41, PALETTE.WOOD, 'accent', 2);
        c.line(24, 36, 20, 42, PALETTE.GOLD_MD, 'gold', 1);
        c.line(24, 36, 29, 42, PALETTE.GOLD_MD, 'gold', 1);
        c.poly([[24, 24], [27, 27], [24, 30], [21, 27]], PALETTE.CYAN, 'ice');
      }),
  },
  {
    id: 'well-of-wisdom',
    name: 'Mimir Well of Wisdom',
    category: 'relics',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        // Mossy carved stone cylindrical well + luminous cyan surface + floating motes
        c.shadedEllipse(24, 33, 15, 9, SLATE_RAMP, 'base');
        c.rect(10, 22, 28, 12, PALETTE.STEEL, 'base');
        c.shadedEllipse(24, 22, 15, 6, ASH_RAMP, 'base');
        // Recessed glowing Bifrost spring pool
        c.ellipse(24, 22, 11, 4, PALETTE.ICE_MD, 'ice');
        c.ellipse(24, 22, 8, 2.5, PALETTE.CYAN, 'ice');
        c.rect(20, 21, 8, 2, PALETTE.ICE_HI, 'ice');
        // Delicate gold trim band + moss accent + rising wisdom mist pixels
        c.rect(11, 28, 26, 2, PALETTE.GOLD_MD, 'gold');
        c.set(14, 33, PALETTE.LEAF, 'accent');
        c.set(34, 32, PALETTE.LEAF, 'accent');
        c.rect(23, 13, 2, 4, PALETTE.CYAN, 'runes');
        c.set(19, 15, PALETTE.ICE_HI, 'runes');
        c.set(29, 14, PALETTE.ICE_HI, 'runes');
      }),
  },
  {
    id: 'odin-eye',
    name: 'Odin Eye All-Seeing Emblem',
    category: 'relics',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        // Radiant sunburst rays + golden diamond eye + icy cyan iris
        for (const [rx, ry] of [[24, 5], [24, 43], [11, 11], [37, 11], [11, 37], [37, 37]]) {
          c.line(24, 24, rx, ry, PALETTE.GOLD, 'gold', 1);
        }
        c.poly([[6, 24], [24, 14], [42, 24], [24, 34]], PALETTE.GOLD_HI, 'gold');
        c.poly([[10, 24], [24, 17], [38, 24], [24, 31]], PALETTE.PANEL_DK, 'shadow');
        c.circle(24, 24, 5.5, PALETTE.CYAN, 'ice');
        c.circle(24, 24, 3, PALETTE.ICE_HI, 'ice');
        c.set(24, 24, PALETTE.OUTLINE, 'outline');
      }),
  },
  {
    id: 'odin-ravens',
    name: 'Huginn & Muninn Ravens',
    category: 'relics',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        // Gnarled branch perch
        c.line(7, 38, 41, 34, PALETTE.WOOD_MD, 'accent', 3);
        c.line(8, 37, 40, 33, PALETTE.WOOD_HI, 'accent', 1);
        // Primary Raven (Huginn) proud silhouette facing right
        c.shadedEllipse(18, 26, 6, 9, SLATE_RAMP, 'base');
        c.poly([[11, 33], [16, 31], [10, 41]], PALETTE.SLATE, 'base'); // tail feathers
        c.circle(20, 16, 4.2, PALETTE.SLATE_HI, 'base');
        c.poly([[23, 14], [30, 16], [23, 18]], PALETTE.GOLD_HI, 'gold'); // crisp beak
        c.set(21, 15, PALETTE.CYAN, 'eyes');
        c.line(16, 22, 19, 32, PALETTE.CYAN, 'ice'); // wing glint
        // Secondary Raven (Muninn) perched right looking left
        c.shadedEllipse(34, 28, 4.5, 6.5, SLATE_RAMP, 'base');
        c.poly([[36, 33], [40, 32], [41, 39]], PALETTE.SLATE, 'base');
        c.circle(32, 20, 3.2, PALETTE.STEEL, 'base');
        c.poly([[29, 19], [25, 20], [29, 21]], PALETTE.GOLD, 'gold');
        c.set(31, 19, PALETTE.ICE_HI, 'eyes');
      }),
  },
  {
    id: 'fenrir-wolf',
    name: 'Fenrir Frost Wolf',
    category: 'relics',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        // Fierce howling wolf head profile facing right
        c.poly([[12, 38], [13, 19], [19, 9], [23, 17], [37, 20], [31, 26], [36, 30], [27, 34], [21, 40]], PALETTE.ASH_MD, 'base');
        c.poly([[16, 20], [22, 19], [34, 21], [29, 25]], PALETTE.ASH_HI, 'base');
        // Glowing icy fangs & eye
        c.set(25, 21, PALETTE.CYAN, 'eyes');
        c.set(31, 25, PALETTE.WHITE, 'accent');
        c.set(34, 26, PALETTE.WHITE, 'accent');
      }),
  },
  {
    id: 'jormungandr-serpent',
    name: 'Jormungandr World Serpent',
    category: 'relics',
    refUrl: 'https://www.playstation.com/en-gb/games/god-of-war-ragnarok/',
    build: () =>
      makeCanvas(c => {
        // Sweeping S-curved sea serpent body connected cleanly from tail coil up to horned dragon head
        const spine = [
          [11, 35], [13, 29], [18, 27], [26, 29], [31, 34], [35, 32],
          [34, 23], [28, 17], [21, 15],
        ];
        for (let i = 0; i < spine.length - 1; i++) {
          const [x0, y0] = spine[i];
          const [x1, y1] = spine[i + 1];
          c.line(x0, y0, x1, y1, PALETTE.HEL_MD, 'base', 6);
          c.line(x0, y0 - 1, x1, y1 - 1, PALETTE.HEL, 'base', 3);
        }
        // Dorsal brass fins
        c.poly([[29, 14], [33, 10], [32, 17]], PALETTE.GOLD, 'gold');
        c.poly([[16, 24], [19, 20], [21, 25]], PALETTE.GOLD, 'gold');
        // Horned serpent skull + fangs facing left
        c.poly([[12, 14], [23, 11], [24, 20], [12, 18]], PALETTE.HEL_HI, 'base');
        c.poly([[12, 19], [22, 19], [20, 23]], PALETTE.HEL_DK, 'shadow');
        c.set(17, 14, PALETTE.GOLD_HI, 'eyes');
        c.set(13, 18, PALETTE.WHITE, 'accent');
        // Icy ocean wave crests
        c.rect(7, 36, 34, 4, PALETTE.ICE_MD, 'ice');
        c.rect(10, 35, 28, 2, PALETTE.ICE_HI, 'ice');
      }),
  },
  {
    id: 'ouroboros',
    name: 'Ouroboros Eternity Loop',
    category: 'relics',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        for (let a = 0; a < 48; a++) {
          const ang = (a / 48) * Math.PI * 2;
          const px = 24 + Math.cos(ang) * 14;
          const py = 24 + Math.sin(ang) * 14;
          c.circle(px, py, 3, a % 4 === 0 ? PALETTE.GOLD : PALETTE.HEL, 'base');
        }
        c.circle(24, 10, 4, PALETTE.GOLD_HI, 'gold');
        c.set(25, 9, PALETTE.CYAN, 'eyes');
      }),
  },
  {
    id: 'runestone',
    name: 'Elder Futhark Runestone',
    category: 'relics',
    refUrl: 'https://www.playstation.com/en-gb/games/god-of-war-ragnarok/',
    build: () =>
      makeCanvas(c => {
        c.poly([[14, 41], [12, 21], [19, 9], [29, 9], [36, 21], [34, 41]], PALETTE.SLATE_HI, 'base');
        c.poly([[17, 39], [16, 22], [21, 12], [28, 12], [32, 22], [31, 39]], PALETTE.STEEL, 'base');
        // Glowing Cyan Raido (R) Rune
        c.line(20, 17, 20, 34, PALETTE.ICE_HI, 'runes', 2);
        c.line(21, 17, 27, 21, PALETTE.CYAN, 'runes', 2);
        c.line(27, 21, 21, 25, PALETTE.CYAN, 'runes', 2);
        c.line(22, 25, 28, 33, PALETTE.CYAN, 'runes', 2);
      }),
  },
  {
    id: 'cracked-runestone',
    name: 'Cracked Runestone (Error)',
    category: 'relics',
    refUrl: 'https://www.playstation.com/en-gb/games/god-of-war-ragnarok/',
    build: () =>
      makeCanvas(c => {
        c.poly([[13, 41], [12, 21], [19, 9], [28, 9], [35, 22], [34, 41]], PALETTE.SLATE, 'base');
        // Fracture lightning fissure + ember glow
        c.line(27, 9, 22, 21, PALETTE.OUTLINE, 'shadow', 2);
        c.line(22, 21, 28, 28, PALETTE.CRIM, 'accent', 2);
        c.line(28, 28, 21, 40, PALETTE.EMBER, 'runes', 2);
        c.line(18, 19, 21, 31, PALETTE.EMBER_HI, 'runes', 1);
      }),
  },
  {
    id: 'illuminated-rune',
    name: 'Illuminated Rune (Success)',
    category: 'relics',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        c.poly([[15, 40], [13, 21], [20, 9], [28, 9], [35, 21], [33, 40]], PALETTE.SLATE_HI, 'base');
        c.circle(24, 24, 11, PALETTE.GOLD_DK, 'gold');
        // Glowing Fehu / Success rune rays
        c.line(21, 14, 21, 35, PALETTE.ICE_HI, 'runes', 2);
        c.line(21, 18, 29, 13, PALETTE.CYAN, 'runes', 2);
        c.line(21, 24, 28, 19, PALETTE.GOLD_HI, 'gold', 2);
      }),
  },
  {
    id: 'shield-knot',
    name: 'Triquetra Shield Knot',
    category: 'relics',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        c.poly([[24, 9], [38, 36], [10, 36]], PALETTE.GOLD_DK, 'gold');
        c.circle(24, 26, 9, PALETTE.GOLD_MD, 'gold');
        c.line(24, 10, 12, 35, PALETTE.GOLD_HI, 'gold', 3);
        c.line(24, 10, 36, 35, PALETTE.GOLD, 'gold', 3);
        c.line(12, 35, 36, 35, PALETTE.GOLD, 'gold', 3);
        c.circle(24, 26, 4, PALETTE.PANEL_DK, 'shadow');
        c.set(24, 26, PALETTE.CYAN, 'runes');
      }),
  },
  {
    id: 'bifrost-portal',
    name: 'Bifrost Realm Portal',
    category: 'relics',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        // Stone carved gateway arch around swirling cyan Bifrost vortex
        c.arc(24, 26, 15, 16, Math.PI, Math.PI * 2, PALETTE.STEEL, 'base');
        c.rect(9, 26, 6, 16, PALETTE.SLATE_HI, 'base');
        c.rect(33, 26, 6, 16, PALETTE.SLATE_HI, 'base');
        c.circle(24, 27, 10, PALETTE.ICE_MD, 'ice');
        c.circle(24, 27, 7, PALETTE.CYAN, 'ice');
        c.circle(24, 27, 4, PALETTE.ICE_HI, 'ice');
        c.rect(22, 8, 4, 4, PALETTE.GOLD_HI, 'gold');
      }),
  },
  {
    id: 'mystic-gateway',
    name: 'Yggdrasil Mystic Gateway',
    category: 'relics',
    refUrl: 'https://blog.playstation.com/tag/god-of-war-ragnarok/',
    build: () =>
      makeCanvas(c => {
        c.poly([[11, 41], [15, 11], [24, 6], [33, 11], [37, 41]], PALETTE.SLATE_HI, 'base');
        c.poly([[17, 39], [19, 15], [24, 12], [29, 15], [31, 39]], PALETTE.HEL_MD, 'ice');
        c.rect(21, 16, 6, 22, PALETTE.HEL_HI, 'ice');
        c.set(24, 9, PALETTE.GOLD, 'gold');
      }),
  },
  {
    id: 'yggdrasil-seed',
    name: 'Yggdrasil Seed Keystone',
    category: 'relics',
    refUrl: 'https://www.playstation.com/en-gb/games/god-of-war-ragnarok/',
    build: () =>
      makeCanvas(c => {
        c.shadedEllipse(24, 24, 10, 14, GOLD_RAMP, 'gold');
        c.poly([[24, 13], [29, 24], [24, 35], [19, 24]], PALETTE.CYAN, 'ice');
        c.poly([[24, 16], [26, 24], [24, 32], [22, 24]], PALETTE.ICE_HI, 'ice');
      }),
  },

  // === FORGE & CRAFTING ===
  {
    id: 'forge-anvil',
    name: 'Huldra Molten Anvil',
    category: 'forge',
    refUrl: 'https://www.playstation.com/en-gb/games/god-of-war-ragnarok/',
    build: () =>
      makeCanvas(c => {
        // Tapered anvil horn + flat face + pedestal foot + molten lava fissure!
        c.poly([[7, 17], [39, 15], [37, 23], [14, 23]], PALETTE.STEEL, 'base');
        c.rect(14, 15, 22, 3, PALETTE.STEEL_HI, 'base');
        c.rect(19, 23, 12, 10, PALETTE.SLATE_HI, 'base');
        c.rect(13, 33, 24, 6, PALETTE.SLATE, 'base');
        // Glowing ember crack through center
        c.line(24, 15, 26, 22, PALETTE.EMBER_HI, 'runes', 2);
        c.line(26, 22, 23, 33, PALETTE.EMBER, 'runes', 2);
      }),
  },
  {
    id: 'dwarven-forge-hammer',
    name: 'Dwarven Forging Hammer',
    category: 'forge',
    refUrl: 'https://en.wikipedia.org/wiki/God_of_War_Ragnar%C3%B6k',
    build: () =>
      makeCanvas(c => {
        c.line(13, 39, 33, 19, PALETTE.WOOD_MD, 'accent', 3);
        c.rect(24, 9, 15, 11, PALETTE.BROK, 'base');
        c.rect(25, 10, 13, 3, PALETTE.BROK_HI, 'base');
        c.rect(29, 14, 4, 3, PALETTE.GOLD, 'gold');
      }),
  },
  {
    id: 'dwarven-tongs',
    name: 'Dwarven Forge Tongs',
    category: 'forge',
    refUrl: 'https://en.wikipedia.org/wiki/God_of_War_Ragnar%C3%B6k',
    build: () =>
      makeCanvas(c => {
        c.line(14, 39, 30, 14, PALETTE.STEEL, 'base', 2);
        c.line(34, 39, 18, 14, PALETTE.STEEL_HI, 'base', 2);
        c.circle(24, 23, 3, PALETTE.GOLD, 'gold');
        c.rect(21, 9, 6, 4, PALETTE.EMBER_HI, 'accent');
      }),
  },
  {
    id: 'dwarven-gear',
    name: 'Nidavellir Dwarven Gear',
    category: 'forge',
    refUrl: 'https://en.wikipedia.org/wiki/God_of_War_Ragnar%C3%B6k',
    build: () =>
      makeCanvas(c => {
        for (let i = 0; i < 8; i++) {
          const a = (i * Math.PI) / 4;
          c.rect(24 + Math.cos(a) * 14 - 2, 24 + Math.sin(a) * 14 - 2, 5, 5, PALETTE.GOLD, 'gold');
        }
        c.circle(24, 24, 12, PALETTE.GOLD_MD, 'gold');
        c.circle(24, 24, 9, PALETTE.STEEL, 'base');
        c.circle(24, 24, 4, PALETTE.PANEL_DK, 'shadow');
        c.set(24, 24, PALETTE.CYAN, 'runes');
      }),
  },

  // === COLLECTIBLES & PROVISION ===
  {
    id: 'gjallarhorn',
    name: 'Gjallarhorn War Horn',
    category: 'collectibles',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        // Sweeping brass-rimmed war horn
        for (let i = 0; i <= 26; i++) {
          const t = i / 26;
          const x = 11 + t * 26;
          const y = 17 + Math.sin(t * Math.PI) * 16;
          const r = 1.5 + t * 4.2;
          c.circle(x, y, r, i % 6 === 0 ? PALETTE.GOLD : PALETTE.STEEL_HI, i % 6 === 0 ? 'gold' : 'base');
        }
        c.circle(36, 17, 5.5, PALETTE.GOLD_HI, 'gold');
        c.circle(36, 17, 3, PALETTE.PANEL_DK, 'shadow');
      }),
  },
  {
    id: 'mead-horn',
    name: 'Horn of Blood Mead',
    category: 'collectibles',
    refUrl: 'https://en.wikipedia.org/wiki/God_of_War_Ragnar%C3%B6k',
    build: () =>
      makeCanvas(c => {
        for (let i = 0; i <= 20; i++) {
          const t = i / 20;
          const x = 13 + t * 22;
          const y = 35 - Math.sin(t * 1.4) * 16;
          const r = 1.5 + t * 3.5;
          c.circle(x, y, r, t > 0.7 ? PALETTE.GOLD : PALETTE.WOOD_HI, t > 0.7 ? 'gold' : 'accent');
        }
        c.circle(34, 18, 4.5, PALETTE.GOLD_HI, 'gold');
        c.circle(34, 18, 2.5, PALETTE.CRIM, 'accent');
      }),
  },
  {
    id: 'draupnir-ring',
    name: 'Draupnir Gold Ring',
    category: 'collectibles',
    refUrl: 'https://www.playstation.com/en-gb/games/god-of-war-ragnarok/',
    build: () =>
      makeCanvas(c => {
        c.shadedEllipse(24, 24, 15, 10, GOLD_RAMP, 'gold');
        c.ellipse(24, 23, 9, 5, PALETTE.PANEL_DK, 'shadow');
        // Clear hollow center back out
        c.ellipse(24, 23, 7, 3.5, null, 'base');
      }),
  },
  {
    id: 'nornir-chest',
    name: 'Nornir Rune Treasure Chest',
    category: 'collectibles',
    refUrl: 'https://en.wikipedia.org/wiki/God_of_War_Ragnar%C3%B6k',
    build: () =>
      makeCanvas(c => {
        c.rect(10, 18, 28, 20, PALETTE.WOOD_MD, 'accent');
        c.rect(10, 14, 28, 7, PALETTE.WOOD_HI, 'accent');
        // Brass bands + glowing front lock
        c.rect(12, 14, 3, 24, PALETTE.GOLD, 'gold');
        c.rect(33, 14, 3, 24, PALETTE.GOLD, 'gold');
        c.rect(10, 21, 28, 2, PALETTE.GOLD, 'gold');
        c.rect(21, 21, 6, 7, PALETTE.GOLD_HI, 'gold');
        c.rect(23, 23, 2, 3, PALETTE.CYAN, 'runes');
      }),
  },
  {
    id: 'golden-apple',
    name: 'Idunn Golden Apple',
    category: 'collectibles',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        c.shadedEllipse(24, 27, 11, 11, GOLD_RAMP, 'gold');
        c.line(24, 16, 25, 11, PALETTE.WOOD_MD, 'accent', 2);
        c.poly([[25, 13], [32, 9], [30, 15]], PALETTE.LEAF_HI, 'accent');
        c.set(19, 22, PALETTE.WHITE, 'gold');
      }),
  },
  {
    id: 'rune-crystal',
    name: 'Bifrost Rune Crystal Cluster',
    category: 'collectibles',
    refUrl: 'https://en.wikipedia.org/wiki/God_of_War_Ragnar%C3%B6k',
    build: () =>
      makeCanvas(c => {
        c.poly([[21, 38], [24, 10], [29, 38]], PALETTE.ICE_MD, 'ice');
        c.poly([[24, 10], [27, 25], [24, 38]], PALETTE.ICE_HI, 'ice');
        c.poly([[14, 38], [16, 20], [21, 38]], PALETTE.CYAN, 'ice');
        c.poly([[29, 38], [32, 19], [35, 38]], PALETTE.CYAN, 'ice');
      }),
  },
  {
    id: 'scroll',
    name: 'Norse Knowledge Scroll',
    category: 'collectibles',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        // Rolled parchment cylinder top & bottom caps + tapered sheet
        c.rect(13, 13, 22, 22, PALETTE.ASH_HI, 'base');
        c.rect(14, 15, 20, 18, PALETTE.WHITE, 'base');
        c.rect(8, 9, 32, 5, PALETTE.WOOD_MD, 'accent');
        c.rect(10, 10, 28, 3, PALETTE.GOLD, 'gold');
        c.circle(9, 11, 2.2, PALETTE.GOLD_HI, 'gold');
        c.circle(39, 11, 2.2, PALETTE.GOLD_HI, 'gold');
        c.rect(8, 34, 32, 5, PALETTE.WOOD_MD, 'accent');
        c.rect(10, 35, 28, 3, PALETTE.GOLD, 'gold');
        c.circle(9, 36, 2.2, PALETTE.GOLD_HI, 'gold');
        c.circle(39, 36, 2.2, PALETTE.GOLD_HI, 'gold');
        // Etched Elder Futhark knot emblem & wax seal
        c.line(21, 18, 21, 29, PALETTE.CYAN, 'runes', 2);
        c.line(21, 20, 27, 23, PALETTE.ICE_MD, 'runes', 1);
        c.line(27, 23, 21, 26, PALETTE.ICE_MD, 'runes', 1);
        c.circle(29, 29, 2.5, PALETTE.CRIM, 'accent');
      }),
  },
  {
    id: 'codex',
    name: 'Mimir Lore Codex',
    category: 'collectibles',
    refUrl: 'https://en.wikipedia.org/wiki/God_of_War_Ragnar%C3%B6k',
    build: () =>
      makeCanvas(c => {
        c.poly([[12, 14], [30, 10], [36, 33], [18, 38]], PALETTE.PANEL_DK, 'base');
        c.poly([[14, 15], [29, 12], [34, 31], [19, 35]], PALETTE.SLATE_HI, 'base');
        c.line(13, 35, 35, 32, PALETTE.ASH_HI, 'accent', 2);
        c.poly([[22, 19], [27, 22], [24, 27], [19, 24]], PALETTE.GOLD_HI, 'gold');
      }),
  },
  {
    id: 'quill-inkwell',
    name: 'Scribe Quill & Inkwell',
    category: 'collectibles',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        c.rect(15, 29, 10, 9, PALETTE.SLATE_HI, 'base');
        c.rect(17, 26, 6, 3, PALETTE.GOLD, 'gold');
        // Sweeping feather plume right
        c.line(21, 28, 36, 10, PALETTE.GOLD_HI, 'gold', 2);
        c.poly([[24, 23], [36, 10], [34, 19]], PALETTE.ASH_HI, 'base');
      }),
  },
  {
    id: 'lantern',
    name: 'Mimir Watch Lantern',
    category: 'collectibles',
    refUrl: 'https://en.wikipedia.org/wiki/God_of_War_Ragnar%C3%B6k',
    build: () =>
      makeCanvas(c => {
        c.arc(24, 12, 4, 4, Math.PI, Math.PI * 2, PALETTE.GOLD, 'gold');
        c.poly([[17, 15], [31, 15], [33, 19], [15, 19]], PALETTE.GOLD_MD, 'gold');
        c.rect(16, 19, 16, 16, PALETTE.EMBER_MD, 'accent');
        c.rect(19, 21, 10, 12, PALETTE.EMBER_HI, 'accent');
        c.rect(22, 23, 4, 8, PALETTE.WHITE, 'gold');
        c.rect(15, 35, 18, 4, PALETTE.STEEL, 'base');
      }),
  },
  {
    id: 'campfire',
    name: 'Realm Campfire Hearth',
    category: 'collectibles',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        // Logs & ring stones
        c.line(12, 34, 36, 37, PALETTE.WOOD_MD, 'accent', 3);
        c.line(12, 37, 36, 34, PALETTE.WOOD, 'accent', 3);
        for (const sx of [12, 18, 24, 30, 36]) c.circle(sx, 39, 2.5, PALETTE.STEEL, 'base');
        // Layered 3-tone flame tongue
        c.poly([[16, 33], [24, 12], [32, 33]], PALETTE.EMBER_MD, 'accent');
        c.poly([[19, 33], [24, 17], [29, 33]], PALETTE.EMBER, 'accent');
        c.poly([[21, 33], [24, 22], [27, 33]], PALETTE.EMBER_HI, 'gold');
      }),
  },
  {
    id: 'coin-pouch',
    name: 'Hacksilver Coin Pouch',
    category: 'collectibles',
    refUrl: 'https://blog.playstation.com/2023/04/11/god-of-war-ragnarok-new-game-plus-build-guide/',
    build: () =>
      makeCanvas(c => {
        // Fanning drawstring top + cinched gold cord + bulbous satchel + gleaming coins
        c.poly([[16, 10], [28, 10], [25, 19], [19, 19]], PALETTE.WOOD_HI, 'accent');
        c.shadedEllipse(22, 30, 12, 10, WOOD_RAMP, 'accent');
        c.rect(17, 17, 10, 3, PALETTE.GOLD, 'gold');
        c.poly([[22, 24], [25, 30], [19, 30]], PALETTE.GOLD_DK, 'gold');
        c.rect(21, 27, 2, 2, PALETTE.GOLD_HI, 'gold');
        // Spilled coins
        c.circle(32, 36, 3.5, PALETTE.GOLD, 'gold');
        c.circle(32, 36, 1.5, PALETTE.GOLD_HI, 'gold');
        c.circle(37, 38, 3.5, PALETTE.ASH_HI, 'base');
        c.set(37, 38, PALETTE.WHITE, 'base');
      }),
  },
  {
    id: 'ember-flame',
    name: 'Muspelheim Spark Flame',
    category: 'collectibles',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        c.shadedEllipse(24, 28, 10, 12, EMBER_RAMP, 'accent');
        c.poly([[19, 25], [24, 9], [29, 25]], PALETTE.EMBER, 'accent');
        c.poly([[21, 28], [24, 16], [27, 28]], PALETTE.EMBER_HI, 'gold');
      }),
  },
  {
    id: 'lightning-bolt',
    name: 'Thor Storm Bolt',
    category: 'collectibles',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        c.poly([[27, 8], [15, 25], [23, 25], [19, 40], [34, 21], [26, 21]], PALETTE.CYAN, 'ice');
        c.line(26, 11, 20, 22, PALETTE.ICE_HI, 'ice');
      }),
  },
  {
    id: 'frost-peak',
    name: 'Midgard Mountain Peak',
    category: 'collectibles',
    refUrl: 'https://en.wikipedia.org/wiki/Norse_cosmology',
    build: () =>
      makeCanvas(c => {
        c.poly([[7, 38], [23, 12], [39, 38]], PALETTE.STEEL, 'base');
        c.poly([[17, 22], [23, 12], [29, 22]], PALETTE.WHITE, 'accent');
        c.poly([[24, 38], [34, 20], [42, 38]], PALETTE.SLATE_HI, 'base');
      }),
  },
];
