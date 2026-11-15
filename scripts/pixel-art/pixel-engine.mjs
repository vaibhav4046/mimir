import zlib from 'node:zlib';

/**
 * Mimir 16-Bit Retro Norse Pixel Art Vector + PNG Engine
 * Palette grounded in #081019, #101722, #1d2b3b, #e6ab42, #3ac9ff, #a9eeff, #e5edf4, #91a8bd
 */

export const PALETTE = {
  // Core structural & Mimir theme
  OUTLINE: '#081019',
  PANEL_DK: '#101722',
  SLATE: '#1d2b3b',
  SLATE_HI: '#2e4359',
  STEEL: '#4c6782',
  STEEL_HI: '#7795b3',

  // Norse Gold / Brass ramp
  GOLD_DK: '#69400b',
  GOLD_MD: '#a86e1c',
  GOLD: '#e6ab42',
  GOLD_HI: '#ffd878',

  // Icy Cyan / Frost ramp
  ICE_DK: '#0e4873',
  ICE_MD: '#1a85c9',
  CYAN: '#3ac9ff',
  ICE_HI: '#a9eeff',

  // White / Silver Beard / Cloud ramp
  ASH_DK: '#435366',
  ASH_MD: '#6d8299',
  MUTED: '#91a8bd',
  ASH_HI: '#c2d2e3',
  WHITE: '#e5edf4',

  // Weathered Sage Flesh / Dwarf tones
  SAGE_DK: '#4b5663',
  SAGE_MD: '#6d7c8c',
  SAGE: '#91a1b0',
  SAGE_HI: '#b8c7d6',

  // Warm Human / Aesir Skin
  SKIN_DK: '#593b2f',
  SKIN_MD: '#8c614c',
  SKIN: '#b8866c',
  SKIN_HI: '#dba98d',

  // Cobalt Dwarf Skin / Steel (Brok inspired)
  BROK_DK: '#15395e',
  BROK_MD: '#27649e',
  BROK: '#4893d4',
  BROK_HI: '#8ac7f7',

  // Ember / Fire (Muspelheim & Blades)
  EMBER_DK: '#5c1506',
  EMBER_MD: '#bf3413',
  EMBER: '#ff7626',
  EMBER_HI: '#ffd466',

  // Crimson / Guardian War Paint
  CRIM_DK: '#520f15',
  CRIM_MD: '#9c2329',
  CRIM: '#d94143',
  CRIM_HI: '#ff8a7a',

  // Vanir Emerald / Nature
  LEAF_DK: '#103b28',
  LEAF_MD: '#1d6e46',
  LEAF: '#38bf78',
  LEAF_HI: '#9df0be',

  // Spectral Helheim Teal
  HEL_DK: '#0b2f33',
  HEL_MD: '#155c61',
  HEL: '#29ccb1',
  HEL_HI: '#9effeb',

  // Light Violet / Jotunheim Crystal
  VIO_DK: '#2e164d',
  VIO_MD: '#5e2e99',
  VIO: '#985eff',
  VIO_HI: '#d5baff',

  // Leather / Timber
  WOOD_DK: '#382012',
  WOOD_MD: '#63391f',
  WOOD: '#8f552e',
  WOOD_HI: '#bd7c4b',
};

const BAYER_4X4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
];

export function hexToRgba(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  if (h.length === 6) {
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
  }
  return [(n >> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export class PixelCanvas {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    // Store hex color strings (or null for transparent) and layer ids
    this.pixels = new Array(width * height).fill(null);
    this.layers = new Array(width * height).fill('base');
  }

  clone() {
    const c = new PixelCanvas(this.width, this.height);
    c.pixels = [...this.pixels];
    c.layers = [...this.layers];
    return c;
  }

  inBounds(x, y) {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  set(x, y, hex, layer = 'base') {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (!this.inBounds(ix, iy)) return;
    const idx = iy * this.width + ix;
    if (hex === null) {
      this.pixels[idx] = null;
      this.layers[idx] = 'base';
    } else {
      this.pixels[idx] = hex.toLowerCase();
      this.layers[idx] = layer;
    }
  }

  get(x, y) {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (!this.inBounds(ix, iy)) return null;
    return this.pixels[iy * this.width + ix];
  }

  rect(x, y, w, h, hex, layer = 'base') {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        this.set(xx, yy, hex, layer);
      }
    }
  }

  ditherRect(x, y, w, h, hexA, hexB, threshold = 0.5, layer = 'base') {
    for (let yy = y; yy < y + h; yy++) {
      for (let xx = x; xx < x + w; xx++) {
        const b = BAYER_4X4[((yy % 4) + 4) % 4][((xx % 4) + 4) % 4] / 16;
        this.set(xx, yy, b < threshold ? hexA : hexB, layer);
      }
    }
  }

  line(x0, y0, x1, y1, hex, layer = 'base', thickness = 1) {
    let ix0 = Math.round(x0);
    let iy0 = Math.round(y0);
    const ix1 = Math.round(x1);
    const iy1 = Math.round(y1);
    const dx = Math.abs(ix1 - ix0);
    const dy = -Math.abs(iy1 - iy0);
    const sx = ix0 < ix1 ? 1 : -1;
    const sy = iy0 < iy1 ? 1 : -1;
    let err = dx + dy;
    const r = Math.floor(thickness / 2);
    while (true) {
      if (thickness <= 1) {
        this.set(ix0, iy0, hex, layer);
      } else {
        this.rect(ix0 - r, iy0 - r, thickness, thickness, hex, layer);
      }
      if (ix0 === ix1 && iy0 === iy1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ix0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        iy0 += sy;
      }
    }
  }

  circle(cx, cy, r, hexOrFn, layer = 'base') {
    this.ellipse(cx, cy, r, r, hexOrFn, layer);
  }

  arc(cx, cy, rx, ry, startAngle, endAngle, hex, layer = 'base', thickness = 2) {
    const steps = Math.max(16, Math.ceil(Math.max(rx, ry) * Math.abs(endAngle - startAngle) * 2));
    let prevX = null;
    let prevY = null;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const ang = startAngle + (endAngle - startAngle) * t;
      const x = Math.round(cx + Math.cos(ang) * rx);
      const y = Math.round(cy + Math.sin(ang) * ry);
      if (prevX !== null) {
        this.line(prevX, prevY, x, y, hex, layer, thickness);
      } else {
        this.rect(x - Math.floor(thickness / 2), y - Math.floor(thickness / 2), thickness, thickness, hex, layer);
      }
      prevX = x;
      prevY = y;
    }
  }

  ellipse(cx, cy, rx, ry, hexOrFn, layer = 'base') {
    if (rx <= 0 || ry <= 0) return;
    const minX = Math.floor(cx - rx - 1);
    const maxX = Math.ceil(cx + rx + 1);
    const minY = Math.floor(cy - ry - 1);
    const maxY = Math.ceil(cy + ry + 1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const nx = (x - cx) / rx;
        const ny = (y - cy) / ry;
        const d2 = nx * nx + ny * ny;
        if (d2 <= 1.0) {
          if (typeof hexOrFn === 'function') {
            const out = hexOrFn(x, y, nx, ny, d2);
            if (out) {
              if (Array.isArray(out)) this.set(x, y, out[0], out[1] || layer);
              else this.set(x, y, out, layer);
            }
          } else {
            this.set(x, y, hexOrFn, layer);
          }
        }
      }
    }
  }

  /**
   * 2.5D top-left lit dithered ramp fill inside an ellipse
   * ramp = [dark, mid, light, highlight]
   */
  shadedEllipse(cx, cy, rx, ry, ramp, layer = 'base', rimColor = null) {
    this.ellipse(
      cx,
      cy,
      rx,
      ry,
      (x, y, nx, ny, d2) => {
        if (rimColor && d2 > 0.78 && nx + ny < 0.1) return rimColor;
        // Directional top-left light vector
        const light = 0.52 - nx * 0.48 - ny * 0.52 - d2 * 0.14;
        const bayer = BAYER_4X4[((y % 4) + 4) % 4][((x % 4) + 4) % 4] / 16 - 0.5;
        const t = Math.max(0, Math.min(0.999, light + bayer * 0.16));
        const idx = Math.min(ramp.length - 1, Math.floor(t * ramp.length));
        return ramp[idx];
      },
      layer
    );
  }

  /**
   * Polygon scanline fill
   */
  poly(points, hexOrFn, layer = 'base') {
    if (!points.length) return;
    let minY = Infinity;
    let maxY = -Infinity;
    let minX = Infinity;
    let maxX = -Infinity;
    for (const [px, py] of points) {
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
    }
    const y0 = Math.floor(minY);
    const y1 = Math.ceil(maxY);
    for (let y = y0; y <= y1; y++) {
      const sy = y + 0.5;
      const intersections = [];
      for (let i = 0; i < points.length; i++) {
        const [ax, ay] = points[i];
        const [bx, by] = points[(i + 1) % points.length];
        if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) {
          const ix = ax + ((sy - ay) * (bx - ax)) / (by - ay);
          intersections.push(ix);
        }
      }
      intersections.sort((a, b) => a - b);
      for (let k = 0; k < intersections.length; k += 2) {
        if (k + 1 >= intersections.length) break;
        const xStart = Math.round(intersections[k]);
        const xEnd = Math.round(intersections[k + 1] - 0.5);
        for (let x = xStart; x <= xEnd; x++) {
          if (typeof hexOrFn === 'function') {
            const nx = maxX === minX ? 0 : ((x - minX) / (maxX - minX)) * 2 - 1;
            const ny = maxY === minY ? 0 : ((y - minY) / (maxY - minY)) * 2 - 1;
            const res = hexOrFn(x, y, nx, ny);
            if (res) this.set(x, y, res, layer);
          } else {
            this.set(x, y, hexOrFn, layer);
          }
        }
      }
    }
  }

  /**
   * Stamp aligned ASCII pixel art map at (ox, oy)
   */
  paintGrid(ox, oy, rows, legend, layer = 'base') {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.' || ch === ' ') continue;
        const entry = legend[ch];
        if (!entry) continue;
        if (typeof entry === 'string') {
          this.set(ox + c, oy + r, entry, layer);
        } else {
          this.set(ox + c, oy + r, entry.color, entry.layer || layer);
        }
      }
    }
  }

  /**
   * Stamp another PixelCanvas cleanly over this canvas
   */
  composite(srcCanvas, dx = 0, dy = 0, layerOverride = null) {
    for (let y = 0; y < srcCanvas.height; y++) {
      for (let x = 0; x < srcCanvas.width; x++) {
        const col = srcCanvas.get(x, y);
        if (!col) continue;
        const lyr = layerOverride || srcCanvas.layers[y * srcCanvas.width + x];
        this.set(x + dx, y + dy, col, lyr);
      }
    }
  }

  /**
   * Crisp 1px pixel-art outline pass around opaque pixels
   */
  autoOutline(outlineHex = PALETTE.OUTLINE, includeDiagonals = false) {
    const snap = [...this.pixels];
    const dirs = includeDiagonals
      ? [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]]
      : [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        if (snap[y * this.width + x]) continue;
        let touch = false;
        for (const [dx, dy] of dirs) {
          const nx = x + dx;
          const ny = y + dy;
          if (this.inBounds(nx, ny) && snap[ny * this.width + nx]) {
            touch = true;
            break;
          }
        }
        if (touch) {
          this.set(x, y, outlineHex, 'outline');
        }
      }
    }
  }

  /**
   * Resize via nearest-neighbor to preserve crisp pixels
   */
  scaleNearest(targetW, targetH = targetW) {
    const out = new PixelCanvas(targetW, targetH);
    for (let y = 0; y < targetH; y++) {
      const sy = Math.floor((y * this.height) / targetH);
      for (let x = 0; x < targetW; x++) {
        const sx = Math.floor((x * this.width) / targetW);
        const col = this.pixels[sy * this.width + sx];
        if (col) {
          out.set(x, y, col, this.layers[sy * this.width + sx]);
        }
      }
    }
    return out;
  }

  /**
   * Apply subtle state overlay treatments (selected/thinking/running/succeeded/failed)
   */
  applyStateTreatment(state) {
    if (!state || state === 'idle') return this;
    const w = this.width;
    const h = this.height;
    if (state === 'selected' || state === 'active') {
      const c = state === 'selected' ? PALETTE.GOLD : PALETTE.CYAN;
      // Crisp 4-corner bracket reticles
      for (const [cx, cy, sx, sy] of [
        [1, 1, 1, 1],
        [w - 2, 1, -1, 1],
        [1, h - 2, 1, -1],
        [w - 2, h - 2, -1, -1],
      ]) {
        for (let k = 0; k < Math.max(4, Math.floor(w / 8)); k++) {
          this.set(cx + k * sx, cy, c, 'state');
          this.set(cx, cy + k * sy, c, 'state');
        }
      }
    } else if (state === 'thinking' || state === 'running') {
      // Top-right 3 pixel frost indicator bar
      const col = state === 'thinking' ? PALETTE.ICE_HI : PALETTE.CYAN;
      const bw = Math.max(2, Math.floor(w / 16));
      for (let i = 0; i < 3; i++) {
        this.rect(w - 3 - i * (bw + 2), 2, bw, bw, i === 0 ? col : PALETTE.ICE_MD, 'state');
      }
    } else if (state === 'succeeded') {
      // Bottom-right emerald check crest
      const bx = w - 9;
      const by = h - 9;
      this.rect(bx, by, 8, 8, PALETTE.OUTLINE, 'state');
      this.rect(bx + 1, by + 1, 6, 6, PALETTE.LEAF_DK, 'state');
      this.line(bx + 2, by + 4, bx + 3, by + 5, PALETTE.LEAF_HI, 'state');
      this.line(bx + 3, by + 5, bx + 6, by + 2, PALETTE.LEAF_HI, 'state');
    } else if (state === 'failed') {
      // Diagonal pixel glitch slice & crimson emblem
      const sliceY = Math.floor(h * 0.45);
      for (let yy = sliceY; yy < sliceY + 3 && yy < h; yy++) {
        for (let xx = 2; xx < w - 2; xx++) {
          if (this.get(xx, yy)) {
            this.set(xx - 1, yy, this.get(xx, yy), 'glitch');
          }
        }
      }
      const bx = w - 9;
      const by = h - 9;
      this.rect(bx, by, 8, 8, PALETTE.OUTLINE, 'state');
      this.rect(bx + 1, by + 1, 6, 6, PALETTE.CRIM_DK, 'state');
      this.line(bx + 2, by + 2, bx + 5, by + 5, PALETTE.CRIM_HI, 'state');
      this.line(bx + 5, by + 2, bx + 2, by + 5, PALETTE.CRIM_HI, 'state');
    } else if (state === 'disabled') {
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (this.get(x, y) && (x + y) % 2 === 0) {
            this.set(x, y, PALETTE.ASH_DK, 'state');
          }
        }
      }
    }
    return this;
  }

  opaquePixelCount() {
    let count = 0;
    for (const p of this.pixels) if (p) count++;
    return count;
  }
}

/**
 * Compile PixelCanvas into standalone editable multi-layer vector SVG
 * Uses horizontal run-length merging inside semantic `<g id="...">` groups
 * combined into `<path d="M...h...v1h-...z"/>` per color so files stay compact,
 * crisp (`shape-rendering="crispEdges"`), and 100% vector-editable without PNG embeds.
 */
export function canvasToEditableSvg(canvas, { title, description, idPrefix = 'mimir' } = {}) {
  const { width, height, pixels, layers } = canvas;
  const layerOrder = ['outline', 'shadow', 'base', 'gold', 'ice', 'accent', 'eyes', 'runes', 'state', 'glitch'];
  const grouped = new Map();

  for (let y = 0; y < height; y++) {
    let x = 0;
    while (x < width) {
      const idx = y * width + x;
      const col = pixels[idx];
      if (!col) {
        x++;
        continue;
      }
      const lyr = layers[idx] || 'base';
      let run = 1;
      while (x + run < width && pixels[y * width + (x + run)] === col && (layers[y * width + (x + run)] || 'base') === lyr) {
        run++;
      }
      if (!grouped.has(lyr)) grouped.set(lyr, new Map());
      const colorMap = grouped.get(lyr);
      if (!colorMap.has(col)) colorMap.set(col, []);
      colorMap.get(col).push([x, y, run]);
      x += run;
    }
  }

  const orderedLayers = [
    ...layerOrder.filter(l => grouped.has(l)),
    ...[...grouped.keys()].filter(l => !layerOrder.includes(l)),
  ];

  const layerBlocks = orderedLayers.map(lyr => {
    const colorMap = grouped.get(lyr);
    const paths = [];
    for (const [color, runs] of colorMap.entries()) {
      const d = runs.map(([rx, ry, rw]) => `M${rx} ${ry}h${rw}v1h-${rw}z`).join('');
      paths.push(`    <path fill="${color}" d="${d}" />`);
    }
    return `  <g id="${idPrefix}-${lyr}">\n${paths.join('\n')}\n  </g>`;
  });

  const safeTitle = String(title || 'Mimir Norse Pixel Asset').replace(/[<>&]/g, '');
  const safeDesc = String(description || 'Original 16-bit retro Norse pixel vector asset.').replace(/[<>&]/g, '');

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges" role="img" aria-label="${safeTitle}">`,
    `  <title>${safeTitle}</title>`,
    `  <desc>${safeDesc}</desc>`,
    ...layerBlocks,
    `</svg>`,
  ].join('\n');
}

// CRC32 table for pure Node PNG writing
const CRC_TABLE = (() => {
  const tbl = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    tbl[n] = c >>> 0;
  }
  return tbl;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcInput = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([lenBuf, crcInput, crcBuf]);
}

/**
 * Pure Node zlib RGBA transparent PNG encoder
 */
export function canvasToPngBuffer(canvas, targetW = canvas.width, targetH = canvas.height) {
  const scaled =
    targetW === canvas.width && targetH === canvas.height ? canvas : canvas.scaleNearest(targetW, targetH);
  const { width, height, pixels } = scaled;
  const rgbaCache = new Map();
  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y++) {
    const rowOff = y * stride;
    raw[rowOff] = 0; // filter None
    for (let x = 0; x < width; x++) {
      const hex = pixels[y * width + x];
      if (!hex) continue; // transparent (0,0,0,0)
      let rgba = rgbaCache.get(hex);
      if (!rgba) {
        rgba = hexToRgba(hex);
        rgbaCache.set(hex, rgba);
      }
      const pOff = rowOff + 1 + x * 4;
      raw[pOff] = rgba[0];
      raw[pOff + 1] = rgba[1];
      raw[pOff + 2] = rgba[2];
      raw[pOff + 3] = rgba[3];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const idat = zlib.deflateSync(raw, { level: 9 });
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  return Buffer.concat([
    signature,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Verify exported PNG header dimensions + corner transparency + opaque foreground bounds
 */
export function inspectPngBuffer(buf) {
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf[25];
  // Decode IDAT chunks to inspect corner pixel alpha & non-zero opaque pixels
  const idatChunks = [];
  let off = 8;
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.subarray(off + 4, off + 8).toString('ascii');
    if (type === 'IDAT') idatChunks.push(buf.subarray(off + 8, off + 8 + len));
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  const stride = width * 4 + 1;
  const cornerAlpha = raw[1 + 3]; // top-left (0,0) alpha
  let opaqueCount = 0;
  for (let y = 0; y < height; y++) {
    const rOff = y * stride + 1;
    for (let x = 0; x < width; x++) {
      if (raw[rOff + x * 4 + 3] > 0) opaqueCount++;
    }
  }
  return { width, height, colorType, cornerTransparent: cornerAlpha === 0, opaqueCount };
}
