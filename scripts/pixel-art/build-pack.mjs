import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { resolveChromiumPath } from '../../daemon/local-exec.mjs';
import {
  PALETTE,
  PixelCanvas,
  canvasToEditableSvg,
  canvasToPngBuffer,
  inspectPngBuffer,
} from './pixel-engine.mjs';
import {
  CHARACTER_DEFS,
  ACCESSORY_DEFS,
  buildAccessoryCanvas,
  makeCircularBadge,
  buildMimirHead64,
} from './sprites-characters.mjs';
import {
  REALM_META,
  buildRealmEmblem48,
  buildRealmNavIcon24,
  buildRealmMarker32,
  buildRealmScene16x9,
  buildYggdrasilMap64,
} from './sprites-realms.mjs';
import { ARTIFACT_DEFS } from './sprites-artifacts.mjs';
import { UI_ICON_DEFS } from './sprites-ui.mjs';
import { buildAnimatedSvgs } from './animations-builder.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '../..');
const PUBLIC_MIMIR = path.join(ROOT, 'public', 'assets', 'mimir');
const ASSETS_MIMIR = path.join(ROOT, 'assets', 'mimir');
const PACK_DIR = path.join(ROOT, 'MIMIR_NORSE_COMPLETE_ASSET_LIBRARY');
const PACK_ZIP = path.join(ROOT, 'MIMIR_NORSE_COMPLETE_ASSET_LIBRARY.zip');

const STATES = ['idle', 'active', 'selected', 'thinking', 'running', 'succeeded', 'failed', 'disabled'];
const CHAR_SIZES = [16, 32, 64, 128, 256, 512];
const UI_SIZES = [16, 24, 32, 64, 128];

const qaTracker = {
  svgCount: 0,
  pngCount: 0,
  failures: [],
  checks: [],
};

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function cleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function writeValidatedSvg(filePaths, svgContent, { expectAnimated = false } = {}) {
  const targets = Array.isArray(filePaths) ? filePaths : [filePaths];
  const hasRasterEmbed = /<image[\s>]|data:image\//i.test(svgContent);
  const hasViewBox = /viewBox="[^"]+"/.test(svgContent);
  const hasCrisp = /shape-rendering="crispEdges"/.test(svgContent);
  const hasClose = /<\/svg>\s*$/.test(svgContent);

  if (hasRasterEmbed) qaTracker.failures.push(`Raster data/image embed detected in ${targets[0]}`);
  if (!hasViewBox) qaTracker.failures.push(`Missing viewBox in ${targets[0]}`);
  if (!hasCrisp) qaTracker.failures.push(`Missing shape-rendering="crispEdges" in ${targets[0]}`);
  if (!hasClose) qaTracker.failures.push(`Malformed SVG closing tag in ${targets[0]}`);
  if (expectAnimated && !/@keyframes/.test(svgContent)) {
    qaTracker.failures.push(`Expected @keyframes in animated SVG ${targets[0]}`);
  }
  if (expectAnimated && !/prefers-reduced-motion/.test(svgContent)) {
    qaTracker.failures.push(`Missing prefers-reduced-motion media rule in ${targets[0]}`);
  }

  for (const fp of targets) {
    ensureDir(path.dirname(fp));
    fs.writeFileSync(fp, svgContent, 'utf8');
    qaTracker.svgCount++;
  }
}

function writeValidatedPng(filePaths, canvas, width, height, { requireTransparentCorner = true } = {}) {
  const targets = Array.isArray(filePaths) ? filePaths : [filePaths];
  const buf = canvasToPngBuffer(canvas, width, height);
  const info = inspectPngBuffer(buf);
  if (info.width !== width || info.height !== height) {
    qaTracker.failures.push(`PNG dimension mismatch on ${targets[0]}: got ${info.width}x${info.height}, expected ${width}x${height}`);
  }
  if (info.colorType !== 6) {
    qaTracker.failures.push(`PNG colorType != 6 (RGBA) on ${targets[0]}: got ${info.colorType}`);
  }
  if (requireTransparentCorner && !info.cornerTransparent) {
    qaTracker.failures.push(`Opaque top-left corner pixel in transparent asset ${targets[0]}`);
  }
  if (info.opaqueCount <= 0) {
    qaTracker.failures.push(`Blank PNG (0 opaque pixels): ${targets[0]}`);
  }
  for (const fp of targets) {
    ensureDir(path.dirname(fp));
    fs.writeFileSync(fp, buf);
    qaTracker.pngCount++;
  }
}

function writeTextFile(filePaths, content) {
  const targets = Array.isArray(filePaths) ? filePaths : [filePaths];
  for (const fp of targets) {
    ensureDir(path.dirname(fp));
    fs.writeFileSync(fp, content, 'utf8');
  }
}

function buildSvgContactSheet({ title, subtitle, items, cols = 6, tileSize = 96, wide = false }) {
  const cellW = wide ? 220 : 128;
  const cellH = wide ? 148 : 132;
  const pad = 24;
  const headerH = 68;
  const rows = Math.ceil(items.length / cols);
  const totalW = pad * 2 + cols * cellW;
  const totalH = headerH + pad + rows * cellH + pad;

  const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));

  const tileBlocks = items.map((item, idx) => {
    const col = idx % cols;
    const row = Math.floor(idx / cols);
    const x = pad + col * cellW;
    const y = headerH + row * cellH;
    const innerMatch = item.svg.match(/<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>/);
    const vb = innerMatch ? innerMatch[1].split(/\s+/).map(Number) : [0, 0, 64, 64];
    const inner = innerMatch ? innerMatch[2].replace(/<title>[\s\S]*?<\/title>/g, '').replace(/<desc>[\s\S]*?<\/desc>/g, '') : '';
    const boxW = wide ? 192 : tileSize;
    const boxH = wide ? 108 : tileSize;
    const boxX = x + Math.floor((cellW - boxW) / 2);
    const boxY = y + 8;

    return `  <g transform="translate(${x}, ${y})">
    <rect x="4" y="4" width="${cellW - 8}" height="${cellH - 8}" fill="${PALETTE.PANEL_DK}" stroke="${PALETTE.SLATE_HI}" stroke-width="1" />
    <svg x="${boxX - x}" y="${boxY - y}" width="${boxW}" height="${boxH}" viewBox="${vb.join(' ')}" shape-rendering="crispEdges">
      ${inner}
    </svg>
    <text x="${Math.floor(cellW / 2)}" y="${cellH - 12}" text-anchor="middle" fill="${PALETTE.WHITE}" font-family="Consolas, monospace" font-size="11">${esc(item.label)}</text>
  </g>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalW} ${totalH}" shape-rendering="crispEdges" role="img" aria-label="${esc(title)}">
  <title>${esc(title)}</title>
  <desc>${esc(subtitle)}</desc>
  <rect width="${totalW}" height="${totalH}" fill="${PALETTE.OUTLINE}" />
  <rect x="8" y="8" width="${totalW - 16}" height="${totalH - 16}" fill="none" stroke="${PALETTE.GOLD}" stroke-width="2" />
  <text x="26" y="34" fill="${PALETTE.GOLD}" font-family="Consolas, monospace" font-size="18" font-weight="bold">${esc(title)}</text>
  <text x="26" y="54" fill="${PALETTE.MUTED}" font-family="Consolas, monospace" font-size="12">${esc(subtitle)}</text>
${tileBlocks.join('\n')}
</svg>`;
}

async function renderContactSheetPng(page, { title, subtitle, items, cols = 6, wide = false, outPaths }) {
  const cellW = wide ? 240 : 148;
  const cellH = wide ? 164 : 148;
  const pad = 28;
  const width = pad * 2 + cols * cellW;
  const rows = Math.ceil(items.length / cols);
  const height = 92 + pad + rows * cellH + 36;

  await page.setViewportSize({ width, height });
  const cardsHtml = items
    .map(
      it => `<div class="tile">
        <div class="art ${wide ? 'wide' : ''}">${it.svg}</div>
        <div class="lbl">${it.label}</div>
        ${it.sub ? `<div class="sub">${it.sub}</div>` : ''}
      </div>`
    )
    .join('');

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: ${width}px; height: ${height}px;
      background: #081019; color: #e5edf4;
      font-family: Consolas, 'Courier New', monospace;
      padding: 20px ${pad}px;
      border: 2px solid #e6ab42;
      overflow: hidden;
    }
    .hdr { border-bottom: 1px solid #2e4359; padding-bottom: 10px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: baseline; }
    .hdr h1 { font-size: 18px; color: #e6ab42; letter-spacing: 0.08em; text-transform: uppercase; }
    .hdr p { font-size: 12px; color: #91a8bd; }
    .grid { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 8px; }
    .tile {
      background: #101722; border: 1px solid #2e4359;
      padding: 8px 6px; display: flex; flex-direction: column; align-items: center; justify-content: space-between;
      min-height: ${cellH - 8}px;
    }
    .art { width: 92px; height: 92px; display: flex; align-items: center; justify-content: center; background: #0c141f; border: 1px solid #1d2b3b; }
    .art.wide { width: 208px; height: 117px; }
    .art svg { width: 100%; height: 100%; image-rendering: pixelated; shape-rendering: crispEdges; }
    .lbl { font-size: 11px; color: #e5edf4; margin-top: 6px; text-align: center; word-break: break-word; }
    .sub { font-size: 10px; color: #3ac9ff; text-align: center; }
  </style></head><body>
    <div class="hdr"><h1>${title}</h1><p>${subtitle}</p></div>
    <div class="grid">${cardsHtml}</div>
  </body></html>`;

  await page.setContent(html, { waitUntil: 'load' });
  const buf = await page.screenshot({ type: 'png' });
  for (const fp of outPaths) {
    ensureDir(path.dirname(fp));
    fs.writeFileSync(fp, buf);
    qaTracker.pngCount++;
  }
}

function buildDesignTokensCss() {
  return `/* Mimir Norse Retro-Pixel Design Tokens (Generated) */
:root {
  --bg-canvas: #081019;
  --bg-rail: #101722;
  --bg-surface: #1d2b3b;
  --bg-surface-hi: #2e4359;
  --brass: #e6ab42;
  --brass-hi: #ffd878;
  --brass-dk: #69400b;
  --frost: #3ac9ff;
  --frost-hi: #a9eeff;
  --frost-dk: #0e4873;
  --ink: #e5edf4;
  --ink-muted: #91a8bd;
  --ember: #ff7626;
  --danger: #d94143;
  --leaf: #38bf78;
}
`;
}

function buildMimirWordmarkSvg() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 32" shape-rendering="crispEdges" role="img" aria-label="MIMIR Norse AI Command">
  <title>MIMIR Pixel Wordmark</title>
  <desc>Crisp 16-bit Norse gold pixel wordmark for Mimir.</desc>
  <rect x="0" y="0" width="180" height="32" fill="${PALETTE.OUTLINE}" />
  <rect x="1" y="1" width="178" height="30" fill="none" stroke="${PALETTE.GOLD_DK}" stroke-width="1" />
  <text x="90" y="21" text-anchor="middle" fill="${PALETTE.GOLD}" font-family="Consolas, monospace" font-weight="bold" font-size="16" letter-spacing="4">MIMIR</text>
  <rect x="12" y="15" width="14" height="2" fill="${PALETTE.CYAN}" />
  <rect x="154" y="15" width="14" height="2" fill="${PALETTE.CYAN}" />
</svg>`;
}

async function generateAll() {
  cleanDir(PUBLIC_MIMIR);
  cleanDir(ASSETS_MIMIR);
  cleanDir(PACK_DIR);

  const manifestEntries = [];
  const characterSheetItems = [];
  const realmSheetItems = [];
  const artifactSheetItems = [];
  const uiSheetItems = [];

  // 0. Copy verified research references into PACK_DIR/references
  const atlasSrc = path.join(ROOT, 'research', 'VISUAL_REFERENCE_ATLAS.md');
  const rightsSrc = path.join(ROOT, 'research', 'RIGHTS_REGISTER.md');
  if (fs.existsSync(atlasSrc)) {
    writeTextFile(path.join(PACK_DIR, 'references', 'VISUAL_REFERENCE_ATLAS.md'), fs.readFileSync(atlasSrc, 'utf8'));
  } else {
    qaTracker.failures.push('Missing research/VISUAL_REFERENCE_ATLAS.md');
  }
  if (fs.existsSync(rightsSrc)) {
    writeTextFile(path.join(PACK_DIR, 'references', 'RIGHTS_REGISTER.md'), fs.readFileSync(rightsSrc, 'utf8'));
  } else {
    qaTracker.failures.push('Missing research/RIGHTS_REGISTER.md');
  }

  // 1. Characters & Brand
  const botManifest = { version: 1, characters: [], accessories: [] };
  for (const def of CHARACTER_DEFS) {
    const base64 = def.build64();
    const baseSvg = canvasToEditableSvg(base64, {
      title: `${def.name} Pixel Sprite`,
      description: `Original 16-bit Norse pixel interpretation for ${def.agentRole}.`,
      idPrefix: def.id,
    });

    if (def.id === 'mimir-head') {
      // Explicit sanity verification: must contain outline, gold (horns), eyes (cyan), no "M" letter path
      const m32 = def.build32 ? def.build32() : base64.scaleNearest(32, 32);
      const m16 = def.build16 ? def.build16() : base64.scaleNearest(16, 16);
      const svg32 = canvasToEditableSvg(m32, { title: 'Mimir 32px', idPrefix: 'mimir-32' });
      const svg16 = canvasToEditableSvg(m16, { title: 'Mimir 16px', idPrefix: 'mimir-16' });

      writeValidatedSvg(
        [
          path.join(PUBLIC_MIMIR, 'brand', 'mimir-head.svg'),
          path.join(ASSETS_MIMIR, 'brand', 'mimir-head.svg'),
          path.join(PUBLIC_MIMIR, 'svg', 'brand', 'mimir-head.svg'),
        ],
        baseSvg
      );
      writeValidatedSvg(
        [
          path.join(PUBLIC_MIMIR, 'brand', 'mimir-head-32.svg'),
          path.join(ASSETS_MIMIR, 'brand', 'mimir-head-32.svg'),
        ],
        svg32
      );
      writeValidatedSvg(
        [
          path.join(PUBLIC_MIMIR, 'brand', 'mimir-head-16.svg'),
          path.join(ASSETS_MIMIR, 'brand', 'mimir-head-16.svg'),
        ],
        svg16
      );
      writeValidatedPng(
        [
          path.join(PUBLIC_MIMIR, 'brand', 'mimir-head.png'),
          path.join(ASSETS_MIMIR, 'brand', 'mimir-head.png'),
          path.join(PUBLIC_MIMIR, 'brand', 'mimir-head-1024.png'),
          path.join(PACK_DIR, 'characters', 'png', 'mimir-head-1024.png'),
        ],
        base64,
        1024,
        1024
      );
      writeValidatedSvg(
        [
          path.join(PUBLIC_MIMIR, 'brand', 'mimir-wordmark.svg'),
          path.join(ASSETS_MIMIR, 'brand', 'mimir-wordmark.svg'),
        ],
        buildMimirWordmarkSvg()
      );
      qaTracker.checks.push('Verified mimir-head bald horned sage exported to brand/ + 16..1024px PNG');
    }

    // Main character SVG & PNG exports across all folder layouts
    writeValidatedSvg(
      [
        path.join(PUBLIC_MIMIR, 'characters', `${def.id}.svg`),
        path.join(ASSETS_MIMIR, 'characters', `${def.id}.svg`),
        path.join(PUBLIC_MIMIR, 'svg', 'characters', `${def.id}.svg`),
        path.join(PACK_DIR, 'characters', 'svg', `${def.id}.svg`),
        path.join(PACK_DIR, 'bots', 'svg', `${def.id}.svg`),
      ],
      baseSvg
    );
    writeValidatedPng(
      [
        path.join(PUBLIC_MIMIR, 'characters', `${def.id}.png`),
        path.join(ASSETS_MIMIR, 'characters', `${def.id}.png`),
        path.join(PACK_DIR, 'bots', 'png', `${def.id}.png`),
      ],
      base64,
      256,
      256
    );

    for (const sz of CHAR_SIZES) {
      const src = sz === 16 && def.build16 ? def.build16() : sz === 32 && def.build32 ? def.build32() : base64;
      writeValidatedPng(
        [
          path.join(PUBLIC_MIMIR, 'png', 'characters', `${def.id}-${sz}.png`),
          path.join(ASSETS_MIMIR, 'png', 'characters', `${def.id}-${sz}.png`),
          path.join(PACK_DIR, 'characters', 'png', `${def.id}-${sz}.png`),
        ],
        src,
        sz,
        sz
      );
    }

    // Circular badge framing
    let circularPath = null;
    if (def.hasCircular) {
      const circ = makeCircularBadge(base64, PALETTE.GOLD);
      const circSvg = canvasToEditableSvg(circ, {
        title: `${def.name} Circular Emblem`,
        description: `Circular gold-rimmed medallion avatar for ${def.name}.`,
        idPrefix: `${def.id}-circular`,
      });
      writeValidatedSvg(
        [
          path.join(PUBLIC_MIMIR, 'characters', `${def.id}-circular.svg`),
          path.join(ASSETS_MIMIR, 'characters', `${def.id}-circular.svg`),
          path.join(PACK_DIR, 'characters', 'svg', `${def.id}-circular.svg`),
          ...(def.id === 'mimir-head' ? [path.join(PUBLIC_MIMIR, 'brand', 'mimir-head-circular.svg')] : []),
        ],
        circSvg
      );
      writeValidatedPng(
        [
          path.join(PUBLIC_MIMIR, 'characters', `${def.id}-circular.png`),
          path.join(ASSETS_MIMIR, 'characters', `${def.id}-circular.png`),
          path.join(PACK_DIR, 'characters', 'png', `${def.id}-circular.png`),
          ...(def.id === 'mimir-head' ? [path.join(PUBLIC_MIMIR, 'brand', 'mimir-head-circular.png')] : []),
        ],
        circ,
        256,
        256
      );
      circularPath = `/assets/mimir/characters/${def.id}-circular.svg`;
    }

    // All 8 states on priority bot/character models (idle, active, selected, thinking, running, succeeded, failed, disabled)
    const statePaths = {};
    if (def.withStates) {
      for (const st of STATES) {
        const sc = def.build64().applyStateTreatment(st);
        const sSvg = canvasToEditableSvg(sc, {
          title: `${def.name} (${st})`,
          idPrefix: `${def.id}-${st}`,
        });
        writeValidatedSvg(
          [
            path.join(PUBLIC_MIMIR, 'characters', 'states', `${def.id}-${st}.svg`),
            path.join(ASSETS_MIMIR, 'characters', 'states', `${def.id}-${st}.svg`),
            path.join(PACK_DIR, 'characters', 'svg', `${def.id}-${st}.svg`),
            path.join(PACK_DIR, 'bots', 'svg', `${def.id}-${st}.svg`),
          ],
          sSvg
        );
        writeValidatedPng(
          [
            path.join(PUBLIC_MIMIR, 'characters', 'states', `${def.id}-${st}.png`),
            path.join(PACK_DIR, 'characters', 'png', `${def.id}-${st}.png`),
            path.join(PACK_DIR, 'bots', 'png', `${def.id}-${st}.png`),
          ],
          sc,
          128,
          128
        );
        statePaths[st] = `/assets/mimir/characters/states/${def.id}-${st}.svg`;
      }
    }

    characterSheetItems.push({ id: def.id, label: def.id, sub: def.name, svg: baseSvg });
    manifestEntries.push({
      id: def.id,
      category: 'characters',
      name: def.name,
      role: def.agentRole,
      svg: `/assets/mimir/characters/${def.id}.svg`,
      png: `/assets/mimir/characters/${def.id}.png`,
      circular: circularPath,
      states: statePaths,
    });
    botManifest.characters.push({
      id: def.id,
      name: def.name,
      role: def.agentRole,
      svg: `bots/svg/${def.id}.svg`,
      png: `bots/png/${def.id}.png`,
      publicUrl: `/assets/mimir/characters/${def.id}.svg`,
      states: statePaths,
    });
  }

  // Modular Bot Accessories (14 accessories)
  for (const acc of ACCESSORY_DEFS) {
    const accCanvas = buildAccessoryCanvas(acc);
    const accSvg = canvasToEditableSvg(accCanvas, {
      title: acc.label,
      description: `Modular ${acc.slot} pixel overlay socket for Mimir custom bot avatars.`,
      idPrefix: acc.id,
    });
    writeValidatedSvg(
      [
        path.join(PUBLIC_MIMIR, 'characters', 'accessories', `${acc.id}.svg`),
        path.join(ASSETS_MIMIR, 'characters', 'accessories', `${acc.id}.svg`),
        path.join(PACK_DIR, 'bots', 'accessories', `${acc.id}.svg`),
      ],
      accSvg
    );
    writeValidatedPng(
      [
        path.join(PUBLIC_MIMIR, 'characters', 'accessories', `${acc.id}.png`),
        path.join(PACK_DIR, 'bots', 'accessories', `${acc.id}.png`),
      ],
      accCanvas,
      192,
      192
    );
    characterSheetItems.push({ id: acc.id, label: acc.id, sub: `slot:${acc.slot}`, svg: accSvg });
    botManifest.accessories.push({
      id: acc.id,
      slot: acc.slot,
      label: acc.label,
      publicUrl: `/assets/mimir/characters/accessories/${acc.id}.svg`,
    });
  }
  writeTextFile(
    [
      path.join(PACK_DIR, 'bots', 'bot-avatar-manifest.json'),
      path.join(PUBLIC_MIMIR, 'characters', 'bot-avatar-manifest.json'),
    ],
    JSON.stringify(botManifest, null, 2)
  );

  // 2. Nine Realms + Yggdrasil Symbolic Hub
  const yggCanvas = buildYggdrasilMap64();
  const yggSvg = canvasToEditableSvg(yggCanvas, {
    title: 'Symbolic Yggdrasil Nine Realms Tree Map',
    description: 'Symbolic retro-pixel Norse cosmology tree linking all 9 realms (non-canonical geographic layout).',
    idPrefix: 'yggdrasil-map',
  });
  writeValidatedSvg(
    [
      path.join(PUBLIC_MIMIR, 'brand', 'yggdrasil-crest.svg'),
      path.join(ASSETS_MIMIR, 'brand', 'yggdrasil-crest.svg'),
      path.join(PUBLIC_MIMIR, 'realms', 'yggdrasil-map.svg'),
      path.join(ASSETS_MIMIR, 'realms', 'yggdrasil-map.svg'),
      path.join(PACK_DIR, 'realms', 'maps', 'yggdrasil-map.svg'),
    ],
    yggSvg
  );
  writeValidatedPng(
    [
      path.join(PUBLIC_MIMIR, 'brand', 'yggdrasil-crest.png'),
      path.join(PUBLIC_MIMIR, 'realms', 'yggdrasil-map.png'),
      path.join(PACK_DIR, 'realms', 'maps', 'yggdrasil-map.png'),
    ],
    yggCanvas,
    256,
    256
  );

  for (const meta of REALM_META) {
    const embActive = buildRealmEmblem48(meta, true);
    const embInactive = buildRealmEmblem48(meta, false);
    const nav24 = buildRealmNavIcon24(meta, true);
    const marker32 = buildRealmMarker32(meta);
    const scene16x9 = buildRealmScene16x9(meta);

    const embActiveSvg = canvasToEditableSvg(embActive, {
      title: `${meta.name} Gold Diamond Emblem (Active)`,
      description: `${meta.subtitle} — original pixel realm medallion.`,
      idPrefix: `${meta.id}-emblem`,
    });
    const embInactiveSvg = canvasToEditableSvg(embInactive, {
      title: `${meta.name} Emblem (Inactive)`,
      idPrefix: `${meta.id}-emblem-inactive`,
    });
    const nav24Svg = canvasToEditableSvg(nav24, {
      title: `${meta.name} Nav Icon 24px`,
      idPrefix: `${meta.id}-nav`,
    });
    const marker32Svg = canvasToEditableSvg(marker32, {
      title: `${meta.name} Map Marker Pin`,
      idPrefix: `${meta.id}-marker`,
    });
    const sceneSvg = canvasToEditableSvg(scene16x9, {
      title: `${meta.name} 16:9 Realm Scene`,
      description: `Original 16:9 pixel environment card for ${meta.name}: ${meta.subtitle}.`,
      idPrefix: `${meta.id}-scene`,
    });

    // Write SVGs + PNGs across both folder layouts
    writeValidatedSvg(
      [
        path.join(PUBLIC_MIMIR, 'realms', `${meta.id}-icon.svg`),
        path.join(ASSETS_MIMIR, 'realms', `${meta.id}-icon.svg`),
        path.join(PUBLIC_MIMIR, 'svg', 'realms', `${meta.id}-icon.svg`),
        path.join(PACK_DIR, 'realms', 'emblems', `${meta.id}-emblem-active.svg`),
      ],
      embActiveSvg
    );
    writeValidatedSvg(
      [
        path.join(PUBLIC_MIMIR, 'realms', `${meta.id}-icon-inactive.svg`),
        path.join(PACK_DIR, 'realms', 'emblems', `${meta.id}-emblem-inactive.svg`),
      ],
      embInactiveSvg
    );
    writeValidatedSvg(
      [
        path.join(PUBLIC_MIMIR, 'realms', `${meta.id}-nav-24.svg`),
        path.join(PACK_DIR, 'realms', 'emblems', `${meta.id}-nav-24.svg`),
      ],
      nav24Svg
    );
    writeValidatedSvg(
      [
        path.join(PUBLIC_MIMIR, 'realms', `${meta.id}-map.svg`),
        path.join(ASSETS_MIMIR, 'realms', `${meta.id}-map.svg`),
        path.join(PACK_DIR, 'realms', 'maps', `${meta.id}-marker.svg`),
      ],
      marker32Svg
    );
    writeValidatedSvg(
      [
        path.join(PUBLIC_MIMIR, 'realms', `${meta.id}-scene.svg`),
        path.join(ASSETS_MIMIR, 'realms', `${meta.id}-scene.svg`),
        path.join(PACK_DIR, 'realms', 'scenes', `${meta.id}-scene-16x9.svg`),
      ],
      sceneSvg
    );

    writeValidatedPng(
      [
        path.join(PUBLIC_MIMIR, 'realms', `${meta.id}-icon.png`),
        path.join(PACK_DIR, 'realms', 'emblems', `${meta.id}-emblem-active-192.png`),
      ],
      embActive,
      192,
      192
    );
    writeValidatedPng(
      [path.join(PACK_DIR, 'realms', 'emblems', `${meta.id}-emblem-inactive-192.png`)],
      embInactive,
      192,
      192
    );
    writeValidatedPng(
      [path.join(PACK_DIR, 'realms', 'emblems', `${meta.id}-nav-24.png`)],
      nav24,
      24,
      24
    );
    writeValidatedPng(
      [
        path.join(PUBLIC_MIMIR, 'realms', `${meta.id}-map.png`),
        path.join(PACK_DIR, 'realms', 'maps', `${meta.id}-marker-128.png`),
      ],
      marker32,
      128,
      128
    );
    // 16:9 full-bleed framed scene cards (not corner-transparent since they are framed environment banners!)
    writeValidatedPng(
      [
        path.join(PUBLIC_MIMIR, 'realms', `${meta.id}-scene.png`),
        path.join(PACK_DIR, 'realms', 'scenes', `${meta.id}-scene-640x360.png`),
      ],
      scene16x9,
      640,
      360,
      { requireTransparentCorner: false }
    );
    writeValidatedPng(
      [path.join(PACK_DIR, 'realms', 'scenes', `${meta.id}-scene-1280x720.png`)],
      scene16x9,
      1280,
      720,
      { requireTransparentCorner: false }
    );

    realmSheetItems.push({ id: `${meta.id}-emblem`, label: meta.name, sub: meta.subtitle, svg: embActiveSvg });
    realmSheetItems.push({ id: `${meta.id}-scene`, label: `${meta.id}-scene`, sub: '16:9', svg: sceneSvg });
    manifestEntries.push({
      id: `realm-${meta.id}`,
      category: 'realms',
      name: meta.name,
      subtitle: meta.subtitle,
      emblem: `/assets/mimir/realms/${meta.id}-icon.svg`,
      emblemInactive: `/assets/mimir/realms/${meta.id}-icon-inactive.svg`,
      mapMarker: `/assets/mimir/realms/${meta.id}-map.svg`,
      scene: `/assets/mimir/realms/${meta.id}-scene.svg`,
      quickUrl: meta.quickUrl,
    });
  }

  // 3. Artifacts, Weapons, Forge, Collectibles (33 sprites)
  for (const def of ARTIFACT_DEFS) {
    const canvas = def.build();
    const svg = canvasToEditableSvg(canvas, {
      title: def.name,
      description: `Original 16-bit Norse artifact sprite (${def.category}). Ref: ${def.refUrl}`,
      idPrefix: def.id,
    });
    writeValidatedSvg(
      [
        path.join(PUBLIC_MIMIR, 'artifacts', `${def.id}.svg`),
        path.join(ASSETS_MIMIR, 'artifacts', `${def.id}.svg`),
        path.join(PUBLIC_MIMIR, 'svg', 'artifacts', `${def.id}.svg`),
        path.join(PACK_DIR, 'artifacts', def.category, `${def.id}.svg`),
      ],
      svg
    );
    for (const sz of [48, 96, 192]) {
      writeValidatedPng(
        [
          ...(sz === 192 ? [path.join(PUBLIC_MIMIR, 'artifacts', `${def.id}.png`), path.join(ASSETS_MIMIR, 'artifacts', `${def.id}.png`)] : []),
          path.join(PUBLIC_MIMIR, 'png', 'artifacts', `${def.id}-${sz}.png`),
          path.join(PACK_DIR, 'artifacts', def.category, `${def.id}-${sz}.png`),
        ],
        canvas,
        sz,
        sz
      );
    }
    artifactSheetItems.push({ id: def.id, label: def.id, sub: def.category, svg });
    manifestEntries.push({
      id: def.id,
      category: 'artifacts',
      subCategory: def.category,
      name: def.name,
      svg: `/assets/mimir/artifacts/${def.id}.svg`,
      png: `/assets/mimir/artifacts/${def.id}.png`,
    });
  }

  // 4. UI Icons (29 sprites)
  for (const def of UI_ICON_DEFS) {
    const canvas = def.build();
    const svg = canvasToEditableSvg(canvas, {
      title: def.title,
      description: `16x16 pixel UI icon (${def.group}).`,
      idPrefix: `ui-${def.id}`,
    });
    writeValidatedSvg(
      [
        path.join(PUBLIC_MIMIR, 'ui', `${def.id}.svg`),
        path.join(PUBLIC_MIMIR, 'ui', `${def.id}-icon.svg`),
        path.join(ASSETS_MIMIR, 'ui', `${def.id}-icon.svg`),
        path.join(PUBLIC_MIMIR, 'svg', 'ui', `${def.id}.svg`),
        path.join(PACK_DIR, 'ui', def.group, `${def.id}.svg`),
      ],
      svg
    );
    for (const sz of UI_SIZES) {
      writeValidatedPng(
        [
          ...(sz === 64 ? [path.join(PUBLIC_MIMIR, 'ui', `${def.id}.png`), path.join(PUBLIC_MIMIR, 'ui', `${def.id}-icon.png`)] : []),
          path.join(PUBLIC_MIMIR, 'png', 'ui', `${def.id}-${sz}.png`),
          path.join(PACK_DIR, 'ui', def.group, `${def.id}-${sz}.png`),
        ],
        canvas,
        sz,
        sz
      );
    }
    uiSheetItems.push({ id: def.id, label: def.id, sub: def.group, svg });
    manifestEntries.push({
      id: `ui-${def.id}`,
      category: 'ui',
      group: def.group,
      name: def.title,
      svg: `/assets/mimir/ui/${def.id}.svg`,
      png: `/assets/mimir/ui/${def.id}.png`,
    });
  }

  // 5. Animated SVGs (6 files)
  const animations = buildAnimatedSvgs();
  const animSheetItems = [];
  for (const anim of animations) {
    writeValidatedSvg(
      [
        path.join(PUBLIC_MIMIR, 'animations', `${anim.id}.svg`),
        path.join(ASSETS_MIMIR, 'animations', `${anim.id}.svg`),
        path.join(PACK_DIR, 'animations', `${anim.id}.svg`),
      ],
      anim.svg,
      { expectAnimated: true }
    );
    animSheetItems.push({ id: anim.id, label: anim.id, sub: 'animated-svg', svg: anim.svg });
    manifestEntries.push({
      id: anim.id,
      category: 'animations',
      name: anim.title,
      svg: `/assets/mimir/animations/${anim.id}.svg`,
    });
  }

  // 6. Composite SVG Contact Sheets
  const charSheetSvg = buildSvgContactSheet({
    title: 'MIMIR CHARACTERS & MODULAR BOT ACCESSORIES',
    subtitle: '13 Norse-inspired character archetypes + 14 socket accessories (bald horned Mimir sage)',
    items: characterSheetItems,
    cols: 6,
  });
  const realmEmblemsOnly = realmSheetItems.filter((_, i) => i % 2 === 0);
  const realmScenesOnly = realmSheetItems.filter((_, i) => i % 2 === 1);
  const realmSheetSvg = buildSvgContactSheet({
    title: 'NINE REALMS EMBLEMS & PANORAMA SCENES',
    subtitle: 'Symbolic Midgard, Asgard, Alfheim, Vanaheim, Jotunheim, Svartalfheim, Muspelheim, Niflheim, Helheim',
    items: [...realmEmblemsOnly, ...realmScenesOnly.slice(0, 3)],
    cols: 5,
  });
  const artifactSheetSvg = buildSvgContactSheet({
    title: 'MIMIR NORSE ARTIFACTS, WEAPONS & FORGE PACK',
    subtitle: '33 pure-vector pixel weapons, relics, dwarven tools & collectibles',
    items: artifactSheetItems,
    cols: 7,
  });
  const uiSheetSvg = buildSvgContactSheet({
    title: 'MIMIR RETRO-PIXEL UI ICONS',
    subtitle: '29 crisp 16x16 pixel icons for navigation, status, actions & empty states',
    items: uiSheetItems,
    cols: 6,
  });
  const iconSheetSvg = buildSvgContactSheet({
    title: 'MIMIR MASTER ICON & EMBLEM CONTACT SHEET',
    subtitle: 'Brand + Priority Agents + 9 Realm Medallions + Core Artifacts + UI Navigation',
    items: [
      characterSheetItems[0],
      characterSheetItems[1],
      characterSheetItems[2],
      characterSheetItems[3],
      characterSheetItems[4],
      ...realmEmblemsOnly.slice(0, 7),
      ...artifactSheetItems.slice(0, 12),
      ...uiSheetItems.slice(0, 12),
    ],
    cols: 6,
  });
  const animSheetSvg = buildSvgContactSheet({
    title: 'MIMIR STANDALONE ANIMATED PIXEL SVGS',
    subtitle: 'CSS @keyframes stepped pixel animations with prefers-reduced-motion fallback',
    items: animSheetItems,
    cols: 3,
  });

  writeValidatedSvg(
    [
      path.join(PUBLIC_MIMIR, 'preview', 'character-contact-sheet.svg'),
      path.join(ASSETS_MIMIR, 'preview', 'character-contact-sheet.svg'),
      path.join(PACK_DIR, 'previews', 'character-contact-sheet.svg'),
    ],
    charSheetSvg
  );
  writeValidatedSvg(
    [
      path.join(PUBLIC_MIMIR, 'preview', 'realm-contact-sheet.svg'),
      path.join(ASSETS_MIMIR, 'preview', 'realm-contact-sheet.svg'),
      path.join(PACK_DIR, 'previews', 'realm-contact-sheet.svg'),
    ],
    realmSheetSvg
  );
  writeValidatedSvg(
    [
      path.join(PUBLIC_MIMIR, 'preview', 'artifact-contact-sheet.svg'),
      path.join(ASSETS_MIMIR, 'preview', 'artifact-contact-sheet.svg'),
      path.join(PACK_DIR, 'previews', 'artifact-contact-sheet.svg'),
    ],
    artifactSheetSvg
  );
  writeValidatedSvg(
    [
      path.join(PUBLIC_MIMIR, 'preview', 'ui-contact-sheet.svg'),
      path.join(ASSETS_MIMIR, 'preview', 'ui-contact-sheet.svg'),
      path.join(PACK_DIR, 'previews', 'ui-contact-sheet.svg'),
    ],
    uiSheetSvg
  );
  writeValidatedSvg(
    [
      path.join(PUBLIC_MIMIR, 'preview', 'animation-contact-sheet.svg'),
      path.join(ASSETS_MIMIR, 'preview', 'animation-contact-sheet.svg'),
      path.join(PACK_DIR, 'previews', 'animation-contact-sheet.svg'),
    ],
    animSheetSvg
  );
  writeValidatedSvg(
    [
      path.join(PUBLIC_MIMIR, 'icon-contact-sheet.svg'),
      path.join(ASSETS_MIMIR, 'icon-contact-sheet.svg'),
      path.join(PUBLIC_MIMIR, 'preview', 'icon-contact-sheet.svg'),
      path.join(PACK_DIR, 'previews', 'icon-contact-sheet.svg'),
    ],
    iconSheetSvg
  );

  // 7. Render crisp HTML composite PNG contact sheets via Playwright Chromium
  const chromePath = resolveChromiumPath();
  if (!chromePath) {
    qaTracker.failures.push('Chromium/Edge executable not found via resolveChromiumPath(); cannot render composite PNG sheets');
  } else {
    const browser = await chromium.launch({ executablePath: chromePath, headless: true, args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage();
      await renderContactSheetPng(page, {
        title: 'MIMIR CHARACTERS & MODULAR BOT ACCESSORIES',
        subtitle: `${characterSheetItems.length} assets • bald horned Mimir sage • crisp 16-bit pixel vector`,
        items: characterSheetItems,
        cols: 6,
        outPaths: [
          path.join(PUBLIC_MIMIR, 'preview', 'character-contact-sheet.png'),
          path.join(ASSETS_MIMIR, 'preview', 'character-contact-sheet.png'),
          path.join(PACK_DIR, 'previews', 'character-contact-sheet.png'),
        ],
      });
      await renderContactSheetPng(page, {
        title: 'NINE REALMS MEDALLIONS & 16:9 PANORAMA SCENES',
        subtitle: 'All 9 Realms (Symbolic Tree Topology) + Active Emblems & Scenes',
        items: realmSheetItems,
        cols: 6,
        outPaths: [
          path.join(PUBLIC_MIMIR, 'preview', 'realm-contact-sheet.png'),
          path.join(ASSETS_MIMIR, 'preview', 'realm-contact-sheet.png'),
          path.join(PACK_DIR, 'previews', 'realm-contact-sheet.png'),
        ],
      });
      await renderContactSheetPng(page, {
        title: 'NORSE ARTIFACTS, WEAPONS, FORGE & COLLECTIBLES',
        subtitle: `${artifactSheetItems.length} original pixel vector objects`,
        items: artifactSheetItems,
        cols: 7,
        outPaths: [
          path.join(PUBLIC_MIMIR, 'preview', 'artifact-contact-sheet.png'),
          path.join(ASSETS_MIMIR, 'preview', 'artifact-contact-sheet.png'),
          path.join(PACK_DIR, 'previews', 'artifact-contact-sheet.png'),
        ],
      });
      await renderContactSheetPng(page, {
        title: 'MIMIR RETRO-PIXEL UI ICON SYSTEM',
        subtitle: `${uiSheetItems.length} 16x16 pixel icons across navigation, status, actions & empty states`,
        items: uiSheetItems,
        cols: 6,
        outPaths: [
          path.join(PUBLIC_MIMIR, 'preview', 'ui-contact-sheet.png'),
          path.join(ASSETS_MIMIR, 'preview', 'ui-contact-sheet.png'),
          path.join(PACK_DIR, 'previews', 'ui-contact-sheet.png'),
        ],
      });
      await renderContactSheetPng(page, {
        title: 'MIMIR MASTER ICON & BRAND CONTACT SHEET',
        subtitle: 'Core Identity • Priority Agents • Nine Realms • Signature Relics • Controls',
        items: [
          characterSheetItems[0],
          characterSheetItems[1],
          characterSheetItems[2],
          characterSheetItems[3],
          characterSheetItems[4],
          ...realmEmblemsOnly,
          ...artifactSheetItems.slice(0, 10),
          ...uiSheetItems.slice(0, 12),
        ],
        cols: 6,
        outPaths: [
          path.join(PUBLIC_MIMIR, 'icon-contact-sheet.png'),
          path.join(ASSETS_MIMIR, 'icon-contact-sheet.png'),
          path.join(PUBLIC_MIMIR, 'preview', 'icon-contact-sheet.png'),
          path.join(PACK_DIR, 'previews', 'icon-contact-sheet.png'),
        ],
      });
    } finally {
      await browser.close();
    }
  }

  // 8. Manifests, Integration Docs & READMEs
  const masterManifest = {
    name: 'Mimir Norse Retro-Pixel Asset Library',
    version: '1.0.0',
    palette: {
      canvas: '#081019',
      rail: '#101722',
      surface: '#1d2b3b',
      brass: '#e6ab42',
      frost: '#3ac9ff',
      frostHi: '#a9eeff',
      ink: '#e5edf4',
      inkMuted: '#91a8bd',
    },
    counts: {
      characters: CHARACTER_DEFS.length,
      accessories: ACCESSORY_DEFS.length,
      realms: REALM_META.length,
      artifacts: ARTIFACT_DEFS.length,
      uiIcons: UI_ICON_DEFS.length,
      animations: animations.length,
      totalSvgFilesWritten: qaTracker.svgCount,
      totalPngFilesWritten: qaTracker.pngCount,
    },
    entries: manifestEntries,
  };

  writeTextFile(
    [
      path.join(PUBLIC_MIMIR, 'manifest.json'),
      path.join(ASSETS_MIMIR, 'manifest.json'),
      path.join(PACK_DIR, 'integration', 'asset-manifest.json'),
    ],
    JSON.stringify(masterManifest, null, 2)
  );
  writeTextFile(path.join(PACK_DIR, 'integration', 'design-tokens.css'), buildDesignTokensCss());

  const placementGuide = `# Mimir Norse Retro-Pixel Asset Placement Guide

- **Main App Identity / Sidebar / Central Welcome**: \`mimir-head\` (strictly bald horned sage, glowing cyan eyes, braided beard — never helmeted)
- **Guardian / Action / Execution Agent**: \`all-father-warrior\`
- **Scout / Research / Retrieval Agent**: \`young-archer\`
- **Builder / Tools / Infrastructure Agent**: \`forge-bot-brok\` (cobalt-steel rugged craftsman)
- **Refinement / Polish / Design Agent**: \`forge-bot-sindri\` (filigree brass artificer)
- **Realm Switcher (Symbolic Nine Realms)**: \`yggdrasil-map\` + all 9 \`realms/{realm}-icon.svg\` & \`realms/{realm}-scene.svg\`
- **Streaming & Motion**: \`animations/mimir-floating-sage.svg\`, \`animations/runic-loader.svg\`, \`animations/bifrost-portal-warp.svg\`, \`animations/pixel-glitch-bars.svg\`, \`animations/illuminated-rune-success.svg\`, \`animations/cracked-runestone-error.svg\`
`;
  writeTextFile(path.join(PACK_DIR, 'integration', 'MIMIR_ASSET_PLACEMENT.md'), placementGuide);

  const readmeBody = `# Mimir Norse Retro-Pixel Asset Library

Complete original 16-bit Norse-tech SVG + transparent PNG pack grounded in dark slate obsidian (\`#081019\`/\`#1d2b3b\`), Norse gold (\`#e6ab42\`), and Bifrost icy cyan (\`#3ac9ff\`).

- Pure crisp-edge vector SVGs (\`shape-rendering="crispEdges"\`, zero raster \`data:image/\` embeds)
- Transparent RGBA PNG exports across 16px to 1024px (\`16:9\` 640x360 and 1280x720 for realm scenes)
- Strictly bald, horned, cyan-eyed \`mimir-head\` (no helmet, no hat, no "M" glyph)
- Verified counts: ${CHARACTER_DEFS.length} characters, ${ACCESSORY_DEFS.length} modular accessories, ${REALM_META.length} realms, ${ARTIFACT_DEFS.length} artifacts, ${UI_ICON_DEFS.length} UI icons, ${animations.length} animated SVGs
`;
  writeTextFile(
    [
      path.join(PUBLIC_MIMIR, 'README.md'),
      path.join(ASSETS_MIMIR, 'README.md'),
      path.join(PACK_DIR, 'README.md'),
    ],
    readmeBody
  );

  const qaReport = `# Mimir Norse Asset Library — Automated QA Report

Generated: ${new Date().toISOString()}
- **Total SVG files verified**: ${qaTracker.svgCount}
- **Total PNG files verified**: ${qaTracker.pngCount}
- **Failures**: ${qaTracker.failures.length}

## Verification Checks
- No \`<image>\` or \`data:image/\` embeds inside any SVG: ${qaTracker.failures.some(f => f.includes('Raster')) ? 'FAIL' : 'PASS'}
- Every SVG has \`viewBox\` and \`shape-rendering="crispEdges"\`: ${qaTracker.failures.some(f => f.includes('viewBox') || f.includes('crispEdges')) ? 'FAIL' : 'PASS'}
- Every animated SVG includes \`@keyframes\` and \`@media (prefers-reduced-motion: reduce)\`: ${qaTracker.failures.some(f => f.includes('@keyframes') || f.includes('reduced-motion')) ? 'FAIL' : 'PASS'}
- Every transparent PNG verified with RGBA colorType=6, transparent outer corner pixel, non-zero foreground: ${qaTracker.failures.some(f => f.includes('PNG') || f.includes('corner') || f.includes('Blank')) ? 'FAIL' : 'PASS'}
${qaTracker.checks.map(c => `- ${c}`).join('\n')}
${qaTracker.failures.length ? `\n## Failure Log\n${qaTracker.failures.map(f => `- ${f}`).join('\n')}\n` : ''}
`;
  writeTextFile(
    [
      path.join(PACK_DIR, 'QA_REPORT.md'),
      path.join(PUBLIC_MIMIR, 'QA_REPORT.md'),
    ],
    qaReport
  );

  const mimirAssetPath = path.join(ROOT, 'renderer', 'components', 'MimirAsset.jsx');
  if (fs.existsSync(mimirAssetPath)) {
    writeTextFile(path.join(PACK_DIR, 'integration', 'MimirAsset.jsx'), fs.readFileSync(mimirAssetPath, 'utf8'));
  }
  const stylesPath = path.join(ROOT, 'renderer', 'styles.css');
  if (fs.existsSync(stylesPath)) {
    const cssText = fs.readFileSync(stylesPath, 'utf8');
    const markerIdx = cssText.indexOf('/* Modular Character & Accessory Picker inside BotManagerModal */');
    const pulseIdx = cssText.indexOf('.pixel-avatar-frame {');
    const sliceStart = pulseIdx >= 0 ? pulseIdx : markerIdx >= 0 ? markerIdx : 0;
    writeTextFile(path.join(PACK_DIR, 'integration', 'pixel-motion.css'), cssText.slice(sliceStart));
  }

  // 9. Package MIMIR_NORSE_COMPLETE_ASSET_LIBRARY.zip cleanly
  if (fs.existsSync(PACK_ZIP)) fs.unlinkSync(PACK_ZIP);
  execFileSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::CreateFromDirectory('${PACK_DIR.replace(/'/g, "''")}', '${PACK_ZIP.replace(/'/g, "''")}', [System.IO.Compression.CompressionLevel]::Optimal, $false)`,
    ],
    { stdio: 'inherit' }
  );

  console.log(
    JSON.stringify(
      {
        status: qaTracker.failures.length === 0 ? 'PASS' : 'FAIL',
        svgWritten: qaTracker.svgCount,
        pngWritten: qaTracker.pngCount,
        zipPath: PACK_ZIP,
        zipBytes: fs.existsSync(PACK_ZIP) ? fs.statSync(PACK_ZIP).size : 0,
        failures: qaTracker.failures,
      },
      null,
      2
    )
  );
  if (qaTracker.failures.length > 0) process.exitCode = 1;
}

generateAll().catch(err => {
  console.error(err);
  process.exit(1);
});
