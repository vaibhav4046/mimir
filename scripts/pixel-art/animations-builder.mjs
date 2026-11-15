import { PALETTE, canvasToEditableSvg } from './pixel-engine.mjs';
import { buildMimirHead64 } from './sprites-characters.mjs';
import { ARTIFACT_DEFS } from './sprites-artifacts.mjs';

function injectIntoSvg(svgStr, { viewBox, styleCss, beforeClose = '', wrapAllId = null }) {
  let out = svgStr;
  if (viewBox) {
    out = out.replace(/viewBox="[^"]+"/, `viewBox="${viewBox}"`);
  }
  const styleBlock = `  <style>\n${styleCss}\n    @media (prefers-reduced-motion: reduce) {\n      * { animation: none !important; transition: none !important; }\n    }\n  </style>\n`;
  out = out.replace(/(<desc>[\s\S]*?<\/desc>\n?)/, `$1${styleBlock}`);
  if (wrapAllId) {
    out = out.replace(/(<\/style>\n)([\s\S]*)(<\/svg>)/, `$1  <g id="${wrapAllId}">\n$2  </g>\n$3`);
  }
  if (beforeClose) {
    out = out.replace(/<\/svg>\s*$/, `${beforeClose}\n</svg>`);
  }
  return out;
}

function getArtifact(id) {
  const def = ARTIFACT_DEFS.find(a => a.id === id);
  if (!def) throw new Error(`Missing artifact definition for animation: ${id}`);
  return def.build();
}

/**
 * Build standalone pure-vector animated SVG sprites (`shape-rendering="crispEdges"`, zero raster embeds)
 */
export function buildAnimatedSvgs() {
  const results = [];

  // 1. mimir-floating-sage.svg (bald horned sage head hover + blinking cyan eyes + floating sparks)
  {
    const canvas = buildMimirHead64();
    const baseSvg = canvasToEditableSvg(canvas, {
      title: 'Mimir Floating Sage Animation',
      description: 'Original 16-bit bald horned Mimir sage head with stepped levitation and glowing cyan eyes.',
      idPrefix: 'mimir-sage',
    });
    const styleCss = `
      #mimir-sage-body { animation: sage-hover 2.4s steps(4, end) infinite; transform-origin: 32px 32px; }
      #mimir-sage-eyes { animation: sage-eye-pulse 3.2s steps(2, end) infinite; transform-origin: 32px 27px; }
      #mimir-sage-runes { animation: sage-rune-flicker 1.8s steps(3, end) infinite; }
      #mimir-sage-motes { animation: sage-motes-rise 2.4s steps(4, end) infinite; }
      @keyframes sage-hover {
        0%, 100% { transform: translateY(0px); }
        50% { transform: translateY(-2px); }
      }
      @keyframes sage-eye-pulse {
        0%, 88%, 100% { opacity: 1; transform: scaleY(1); }
        92% { opacity: 0.25; transform: scaleY(0.35); }
        96% { opacity: 1; transform: scaleY(1); }
      }
      @keyframes sage-rune-flicker {
        0%, 100% { opacity: 0.78; }
        50% { opacity: 1; }
      }
      @keyframes sage-motes-rise {
        0%, 100% { transform: translateY(1px); opacity: 0.65; }
        50% { transform: translateY(-2px); opacity: 1; }
      }`;
    const motes = `  <g id="mimir-sage-motes">
    <path fill="${PALETTE.CYAN}" d="M12 18h1v1h-1zM51 20h1v1h-1zM14 44h1v2h-1zM50 41h1v2h-1z" />
    <path fill="${PALETTE.GOLD_HI}" d="M10 31h1v1h-1zM53 33h1v1h-1z" />
  </g>`;
    let svg = injectIntoSvg(baseSvg, {
      viewBox: '-2 -4 68 72',
      styleCss,
      wrapAllId: 'mimir-sage-body',
      beforeClose: motes,
    });
    results.push({ id: 'mimir-floating-sage', title: 'Mimir Floating Sage', svg });
  }

  // 2. runic-loader.svg (48x48 stepped Elder Futhark Yggdrasil ring + pulsing center gem)
  {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" shape-rendering="crispEdges" role="img" aria-label="Runic Bifrost Loader">
  <title>Runic Bifrost Loader</title>
  <desc>Stepped pixel-art Elder Futhark compass spinner with pulsing Bifrost crystal core.</desc>
  <style>
    #loader-ring { animation: rune-spin 1.6s steps(8, end) infinite; transform-origin: 24px 24px; }
    #loader-core { animation: rune-core 0.9s steps(2, end) infinite; transform-origin: 24px 24px; }
    @keyframes rune-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    @keyframes rune-core { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  </style>
  <g id="loader-frame">
    <path fill="${PALETTE.OUTLINE}" d="M18 4h12v2h4v2h4v4h2v4h2v12h-2v4h-2v4h-4v2h-4v2H18v-2h-4v-2h-4v-4H8v-4H6V16h2v-4h2V8h4V6h4z" />
    <path fill="${PALETTE.PANEL_DK}" d="M18 7h12v2h4v4h2v14h-2v4h-4v2H18v-2h-4v-4h-2V13h2V9h4z" />
  </g>
  <g id="loader-ring">
    <path fill="${PALETTE.GOLD}" d="M22 4h4v4h-4zM34 9h3v3h-3zM40 22h4v4h-4zM34 36h3v3h-3zM22 40h4v4h-4zM11 36h3v3h-3zM4 22h4v4H4zM11 9h3v3h-3z" />
    <path fill="${PALETTE.CYAN}" d="M23 5h2v2h-2zM41 23h2v2h-2zM23 41h2v2h-2zM5 23h2v2H5z" />
    <path fill="${PALETTE.ICE_HI}" d="M23 6h2v1h-2z" />
  </g>
  <g id="loader-core">
    <path fill="${PALETTE.ICE_MD}" d="M22 15h4v2h2v2h2v10h-2v2h-2v2h-4v-2h-2v-2h-2V19h2v-2h2z" />
    <path fill="${PALETTE.CYAN}" d="M23 17h2v2h2v10h-2v2h-2v-2h-2V19h2z" />
    <path fill="${PALETTE.ICE_HI}" d="M23 20h2v8h-2z" />
  </g>
</svg>`;
    results.push({ id: 'runic-loader', title: 'Runic Bifrost Loader', svg });
  }

  // 3. bifrost-portal-warp.svg (Stepped portal arch with animated cyan/gold scan shimmer)
  {
    const canvas = getArtifact('bifrost-portal');
    const baseSvg = canvasToEditableSvg(canvas, {
      title: 'Bifrost Portal Warp Animation',
      description: 'Carved pixel portal archway with animated Bifrost energy scan ripple.',
      idPrefix: 'bifrost-portal',
    });
    const styleCss = `
      #bifrost-portal-ice { animation: portal-shimmer 1.1s steps(3, end) infinite; }
      #bifrost-portal-scan { animation: portal-sweep 1.2s steps(6, end) infinite; }
      @keyframes portal-shimmer {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.72; }
      }
      @keyframes portal-sweep {
        0% { transform: translateY(0px); opacity: 0.85; }
        50% { transform: translateY(10px); opacity: 1; }
        100% { transform: translateY(20px); opacity: 0.35; }
      }`;
    const scanBar = `  <g id="bifrost-portal-scan">
    <path fill="${PALETTE.ICE_HI}" d="M18 16h12v1H18z" />
    <path fill="${PALETTE.GOLD_HI}" d="M20 18h8v1h-8z" />
  </g>`;
    const svg = injectIntoSvg(baseSvg, { styleCss, beforeClose: scanBar });
    results.push({ id: 'bifrost-portal-warp', title: 'Bifrost Portal Warp', svg });
  }

  // 4. pixel-glitch-bars.svg (Horizontal pixel-slice interference overlay for errors/decodes)
  {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 24" shape-rendering="crispEdges" role="img" aria-label="Pixel Glitch Interference Bars">
  <title>Pixel Glitch Interference Bars</title>
  <desc>Crisp 8-bit horizontal pixel-slice tremor bars for response decode and error alerts.</desc>
  <style>
    #glitch-a { animation: g-shift-a 0.6s steps(3, end) infinite; }
    #glitch-b { animation: g-shift-b 0.48s steps(2, end) infinite; }
    @keyframes g-shift-a {
      0%, 100% { transform: translateX(0px); }
      33% { transform: translateX(-3px); }
      66% { transform: translateX(2px); }
    }
    @keyframes g-shift-b {
      0%, 100% { transform: translateX(0px); }
      50% { transform: translateX(3px); }
    }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  </style>
  <g id="glitch-a">
    <path fill="${PALETTE.CYAN}" d="M2 3h22v2H2zM38 11h18v1H38zM10 18h28v2H10z" />
    <path fill="${PALETTE.GOLD_HI}" d="M26 3h8v2h-8zM44 18h12v2H44z" />
  </g>
  <g id="glitch-b">
    <path fill="${PALETTE.CRIM}" d="M12 7h30v2H12zM4 14h20v1H4z" />
    <path fill="${PALETTE.ICE_HI}" d="M46 7h12v2H46zM28 14h10v1H28z" />
  </g>
</svg>`;
    results.push({ id: 'pixel-glitch-bars', title: 'Pixel Glitch Bars', svg });
  }

  // 5. illuminated-rune-success.svg (Glowing Dagaz rune stone with pulse glint)
  {
    const canvas = getArtifact('illuminated-rune');
    const baseSvg = canvasToEditableSvg(canvas, {
      title: 'Illuminated Rune Success Animation',
      description: 'Carved Norse monolith whose Elder Futhark rune flashes gold and cyan upon verification.',
      idPrefix: 'illum-rune',
    });
    const styleCss = `
      #illum-rune-ice, #illum-rune-runes { animation: rune-lit 1.6s steps(2, end) infinite; }
      #illum-rune-glint { animation: glint-rise 1.6s steps(4, end) infinite; }
      @keyframes rune-lit { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
      @keyframes glint-rise { 0%, 100% { transform: translateY(0px); opacity: 0.9; } 50% { transform: translateY(-2px); opacity: 0.4; } }`;
    const glint = `  <g id="illum-rune-glint">
    <path fill="${PALETTE.GOLD_HI}" d="M23 5h2v2h-2zM14 10h1v2h-1zM33 10h1v2h-1z" />
  </g>`;
    const svg = injectIntoSvg(baseSvg, { styleCss, beforeClose: glint });
    results.push({ id: 'illuminated-rune-success', title: 'Illuminated Rune Success', svg });
  }

  // 6. cracked-runestone-error.svg (Fractured runestone with discrete tremor slices)
  {
    const canvas = getArtifact('cracked-runestone');
    const baseSvg = canvasToEditableSvg(canvas, {
      title: 'Cracked Runestone Error Animation',
      description: 'Fractured crimson runestone with stepped pixel-glitch tremor on failed or denied state.',
      idPrefix: 'cracked-rune',
    });
    const styleCss = `
      #cracked-rune-accent { animation: err-flicker 0.8s steps(2, end) infinite; }
      #cracked-rune-wrap { animation: err-tremor 1.4s steps(3, end) infinite; }
      @keyframes err-flicker { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
      @keyframes err-tremor {
        0%, 82%, 100% { transform: translateX(0px); }
        86% { transform: translateX(-1.5px); }
        92% { transform: translateX(1.5px); }
      }`;
    const svg = injectIntoSvg(baseSvg, {
      styleCss,
      wrapAllId: 'cracked-rune-wrap',
    });
    results.push({ id: 'cracked-runestone-error', title: 'Cracked Runestone Error', svg });
  }

  return results;
}
