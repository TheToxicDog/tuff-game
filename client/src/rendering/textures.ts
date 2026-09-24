// Procedurally painted textures. The design calls for illustrated grim realism — muted, dirty,
// gloomy — so everything is painted with desaturated palettes, noise and hand-drawn-ish detail.
// When real art arrives it can replace these by key without touching the renderers.

import { Texture } from 'pixi.js';
import { TERRAIN_MATERIALS, type FloorMaterial } from '@tuff/shared';
import { createCanvas, css, hexToRgb, mix, shade, TilePainter, type RGB } from './paint';

export const ATLAS_COLS = 5;
export const ATLAS_ROWS = 4;
export const TILE_PX = 256;
/** World meters covered by one terrain tile. */
export const TILE_METERS = 4;

type MaterialPainter = (p: TilePainter) => void;

const GRASS: RGB = [74, 88, 50];
const DIRT: RGB = [92, 74, 53];

const MATERIAL_PAINTERS: Record<(typeof TERRAIN_MATERIALS)[number], MaterialPainter> = {
  grass: (p) => {
    p.noiseFill(GRASS, 0.22, 4, 4, [96, 90, 58], 0.35);
    p.strokes(900, [shade(GRASS, 0.7), shade(GRASS, 1.25), [88, 98, 58]], 3, 8, 1.1, -1.4, 0.6, 0.55);
    p.speckle(
      60,
      [
        [70, 60, 44],
        [58, 66, 40],
      ],
      1,
      3,
      0.4,
    );
  },
  grass_long: (p) => {
    const base: RGB = [80, 94, 54];
    p.noiseFill(base, 0.25, 4, 4, [104, 100, 62], 0.3);
    p.strokes(1300, [shade(base, 0.62), shade(base, 1.3), [104, 110, 64], [60, 70, 40]], 6, 16, 1.4, -1.3, 0.9, 0.6);
  },
  grass_dead: (p) => {
    const base: RGB = [108, 100, 68];
    p.noiseFill(base, 0.2, 4, 4, [92, 78, 56], 0.4);
    p.strokes(800, [shade(base, 0.75), shade(base, 1.2), [120, 108, 72]], 3, 9, 1.1, -1.2, 1.2, 0.55);
    p.speckle(80, [DIRT, shade(DIRT, 0.8)], 1, 4, 0.5);
  },
  forest_floor: (p) => {
    const base: RGB = [52, 55, 37];
    p.noiseFill(base, 0.3, 4, 4, [70, 56, 38], 0.5);
    p.speckle(
      420,
      [
        [82, 62, 40],
        [96, 70, 42],
        [64, 50, 34],
        [70, 76, 44],
      ],
      1.5,
      4.5,
      0.75,
    );
    p.strokes(
      260,
      [
        [40, 34, 24],
        [84, 70, 46],
      ],
      4,
      10,
      1.2,
      0,
      Math.PI,
      0.6,
    );
  },
  dirt: (p) => {
    p.noiseFill(DIRT, 0.24, 4, 5, [78, 64, 46], 0.4);
    p.speckle(260, [shade(DIRT, 0.7), shade(DIRT, 1.3), [110, 104, 96]], 0.8, 2.6, 0.7);
  },
  dirt_dry: (p) => {
    const base: RGB = [116, 98, 74];
    p.noiseFill(base, 0.18, 4, 5);
    p.cracks(22, shade(base, 0.62), 10, 7, 1.2, 0.55);
    p.speckle(200, [shade(base, 0.8), shade(base, 1.2)], 0.8, 2, 0.6);
  },
  mud: (p) => {
    const base: RGB = [60, 49, 37];
    p.noiseFill(base, 0.3, 4, 4, [44, 38, 30], 0.5);
    p.speckle(40, [[86, 80, 72]], 3, 9, 0.12);
    p.strokes(120, [shade(base, 0.6)], 8, 20, 2, 0, Math.PI, 0.4);
  },
  gravel: (p) => {
    const base: RGB = [100, 96, 88];
    p.noiseFill(base, 0.12, 8, 3);
    p.speckle(
      2600,
      [
        [124, 120, 112],
        [78, 74, 68],
        [110, 100, 88],
        [140, 136, 126],
        [66, 62, 58],
      ],
      0.8,
      2.4,
      0.9,
    );
  },
  asphalt: (p) => {
    const base: RGB = [52, 54, 57];
    p.noiseFill(base, 0.1, 8, 4, [60, 60, 58], 0.3);
    p.speckle(
      2400,
      [
        [70, 72, 74],
        [40, 41, 43],
        [84, 84, 82],
      ],
      0.4,
      1.1,
      0.7,
    );
  },
  asphalt_cracked: (p) => {
    const base: RGB = [56, 57, 59];
    p.noiseFill(base, 0.14, 8, 4, [70, 68, 62], 0.35);
    p.speckle(
      2000,
      [
        [74, 74, 74],
        [40, 41, 43],
      ],
      0.4,
      1.1,
      0.7,
    );
    p.cracks(14, [26, 27, 28], 14, 8, 1.4, 0.8);
    p.strokes(40, [[70, 84, 48]], 3, 7, 1, -1.4, 0.8, 0.5);
  },
  concrete: (p) => {
    const base: RGB = [118, 116, 110];
    p.noiseFill(base, 0.08, 4, 5, [96, 92, 84], 0.3);
    p.speckle(500, [shade(base, 0.85), shade(base, 1.1)], 0.5, 1.4, 0.5);
    p.grid(128, 128, [70, 68, 64], 2, 0.55);
    p.cracks(4, [72, 70, 66], 8, 6, 1, 0.5);
  },
  sidewalk: (p) => {
    const base: RGB = [128, 126, 118];
    p.noiseFill(base, 0.07, 4, 5, [104, 100, 90], 0.25);
    p.speckle(400, [shade(base, 0.86), shade(base, 1.1)], 0.5, 1.3, 0.5);
    p.grid(64, 64, [84, 82, 76], 2, 0.6);
  },
  farm_soil: (p) => {
    const base: RGB = [76, 58, 41];
    p.noiseFill(base, 0.22, 4, 5, [62, 48, 34], 0.4);
    p.speckle(300, [shade(base, 0.7), shade(base, 1.25)], 0.8, 2.2, 0.6);
  },
  tilled_soil: (p) => {
    const base: RGB = [64, 48, 33];
    p.noiseFill(base, 0.25, 4, 5);
    const ctx = p.ctx;
    for (let y = 0; y < p.size; y += 32) {
      ctx.fillStyle = css(shade(base, 0.62), 0.8);
      ctx.fillRect(p.ox, p.oy + y, p.size, 9);
      ctx.fillStyle = css(shade(base, 1.25), 0.35);
      ctx.fillRect(p.ox, p.oy + y + 12, p.size, 4);
    }
    p.speckle(160, [[70, 82, 44]], 1, 2.5, 0.5);
  },
  sand: (p) => {
    const base: RGB = [156, 142, 108];
    p.noiseFill(base, 0.1, 4, 5, [132, 118, 90], 0.3);
    p.speckle(700, [shade(base, 0.9), shade(base, 1.08)], 0.4, 1, 0.6);
  },
  water_shallow: (p) => {
    const base: RGB = [58, 82, 86];
    p.noiseFill(base, 0.18, 4, 4, [74, 96, 90], 0.4);
    p.strokes(160, [[90, 116, 118]], 10, 28, 1.2, 0, 0.2, 0.25);
  },
  water_deep: (p) => {
    const base: RGB = [34, 54, 62];
    p.noiseFill(base, 0.16, 4, 4);
    p.strokes(120, [[62, 86, 94]], 12, 30, 1.2, 0, 0.2, 0.2);
  },
  rail_gravel: (p) => {
    const base: RGB = [76, 72, 66];
    p.noiseFill(base, 0.12, 8, 3);
    p.speckle(
      2400,
      [
        [96, 92, 86],
        [56, 52, 48],
        [86, 76, 66],
      ],
      0.8,
      2.2,
      0.9,
    );
  },
  concrete_industrial: (p) => {
    const base: RGB = [106, 104, 98];
    p.noiseFill(base, 0.1, 4, 5, [80, 76, 68], 0.4);
    p.speckle(24, [[40, 38, 34]], 6, 20, 0.18);
    p.grid(256, 128, [64, 62, 58], 2, 0.5);
  },
  asphalt_parking: (p) => {
    const base: RGB = [48, 50, 53];
    p.noiseFill(base, 0.1, 8, 4, [58, 58, 56], 0.3);
    p.speckle(
      2200,
      [
        [66, 68, 70],
        [38, 39, 41],
      ],
      0.4,
      1.1,
      0.7,
    );
    p.speckle(6, [[26, 26, 26]], 8, 18, 0.25);
  },
};

/** The terrain material atlas used by the terrain shader (one 256 px tile per material). */
export function buildTerrainAtlas(): HTMLCanvasElement {
  const { canvas } = createCanvas(ATLAS_COLS * TILE_PX, ATLAS_ROWS * TILE_PX);
  TERRAIN_MATERIALS.forEach((m, i) => {
    const col = i % ATLAS_COLS;
    const row = Math.floor(i / ATLAS_COLS);
    const painter = new TilePainter(canvas, TILE_PX, 1000 + i * 17, col * TILE_PX, row * TILE_PX);
    MATERIAL_PAINTERS[m](painter);
  });
  return canvas;
}

/** A single terrain material as a standalone repeating texture (for roads and paths). */
export function materialTexture(material: (typeof TERRAIN_MATERIALS)[number]): Texture {
  const key = `material:${material}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const { canvas } = createCanvas(TILE_PX);
  MATERIAL_PAINTERS[material](new TilePainter(canvas, TILE_PX, 1000 + TERRAIN_MATERIALS.indexOf(material) * 17));
  return repeatTexture(key, canvas);
}

/** RGBA value noise used by shaders to break up material boundaries. */
export function buildNoiseTexture(): HTMLCanvasElement {
  const size = 256;
  const { canvas } = createCanvas(size);
  const painters = [0, 1, 2].map((i) => new TilePainter(canvas, size, 77 + i * 101));
  const img = canvas.getContext('2d')!.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      img.data[i] = 128 + 127 * painters[0].noise.fbm((x / size) * 8, (y / size) * 8, 3, 8, 8);
      img.data[i + 1] = 128 + 127 * painters[1].noise.fbm((x / size) * 8, (y / size) * 8, 3, 8, 8);
      img.data[i + 2] = 128 + 127 * painters[2].noise.fbm((x / size) * 4, (y / size) * 4, 4, 4, 4);
      img.data[i + 3] = 255;
    }
  }
  canvas.getContext('2d')!.putImageData(img, 0, 0);
  return canvas;
}

const FLOOR_PAINTERS: Record<FloorMaterial, (p: TilePainter) => void> = {
  wood: (p) => {
    const base: RGB = [118, 86, 58];
    p.noiseFill(base, 0.12, 2, 3);
    const ctx = p.ctx;
    for (let y = 0; y < p.size; y += 16) {
      const tone = 0.82 + p.rng.next() * 0.3;
      ctx.fillStyle = css(shade(base, tone), 0.55);
      ctx.fillRect(0, y, p.size, 16);
      ctx.fillStyle = 'rgba(30,20,12,0.55)';
      ctx.fillRect(0, y, p.size, 1.5);
      const off = p.rng.int(0, 4) * 64 + (y / 16) * 37;
      for (let x = off % 128; x < p.size; x += 128) ctx.fillRect(x, y, 1.5, 16);
    }
    p.strokes(260, [shade(base, 0.7), shade(base, 1.15)], 10, 40, 0.8, 0, 0.03, 0.35);
  },
  darkwood: (p) => {
    const base: RGB = [74, 54, 38];
    p.noiseFill(base, 0.14, 2, 3);
    const ctx = p.ctx;
    for (let y = 0; y < p.size; y += 20) {
      ctx.fillStyle = css(shade(base, 0.85 + p.rng.next() * 0.3), 0.5);
      ctx.fillRect(0, y, p.size, 20);
      ctx.fillStyle = 'rgba(16,10,6,0.6)';
      ctx.fillRect(0, y, p.size, 2);
    }
    p.strokes(200, [shade(base, 0.6), shade(base, 1.2)], 10, 50, 0.8, 0, 0.03, 0.35);
  },
  tile: (p) => {
    const base: RGB = [176, 176, 168];
    p.noiseFill(base, 0.06, 4, 3, [140, 136, 120], 0.35);
    p.grid(32, 32, [96, 96, 90], 2, 0.7);
    p.speckle(30, [[120, 110, 90]], 2, 6, 0.2);
  },
  carpet: (p) => {
    const base: RGB = [92, 80, 88];
    p.noiseFill(base, 0.16, 8, 4, [70, 64, 60], 0.35);
    p.speckle(1800, [shade(base, 0.8), shade(base, 1.15)], 0.5, 1.2, 0.5);
    p.speckle(8, [[70, 50, 40]], 6, 16, 0.2);
  },
  concrete: (p) => {
    const base: RGB = [112, 110, 104];
    p.noiseFill(base, 0.1, 4, 5, [88, 84, 76], 0.35);
    p.speckle(20, [[54, 50, 46]], 6, 18, 0.15);
    p.grid(256, 256, [70, 68, 64], 2, 0.5);
  },
  linoleum: (p) => {
    const base: RGB = [164, 158, 140];
    p.noiseFill(base, 0.07, 4, 3, [130, 124, 104], 0.4);
    p.grid(64, 64, [120, 116, 104], 1, 0.5);
    p.speckle(300, [shade(base, 0.9)], 0.6, 1.5, 0.4);
  },
  checker: (p) => {
    const ctx = p.ctx;
    const a: RGB = [186, 184, 176];
    const b: RGB = [62, 62, 60];
    const cell = 32;
    for (let y = 0; y < p.size; y += cell) {
      for (let x = 0; x < p.size; x += cell) {
        ctx.fillStyle = css(((x + y) / cell) % 2 === 0 ? a : b);
        ctx.fillRect(x, y, cell, cell);
      }
    }
    p.speckle(60, [[110, 100, 80]], 2, 7, 0.18);
  },
};

const textureCache = new Map<string, Texture>();

function repeatTexture(key: string, canvas: HTMLCanvasElement): Texture {
  const tex = Texture.from(canvas);
  tex.source.addressMode = 'repeat';
  tex.source.scaleMode = 'linear';
  textureCache.set(key, tex);
  return tex;
}

export function floorTexture(kind: FloorMaterial): Texture {
  const key = `floor:${kind}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const { canvas } = createCanvas(256);
  FLOOR_PAINTERS[kind](new TilePainter(canvas, 256, 300 + kind.length * 13));
  return repeatTexture(key, canvas);
}

/** Roof shingles tinted to a building's roof colour. */
export function roofTexture(style: 'shingle' | 'flat', color: string): Texture {
  const key = `roof:${style}:${color}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const { canvas } = createCanvas(256);
  const p = new TilePainter(canvas, 256, 900 + color.length);
  const base = hexToRgb(color);
  if (style === 'shingle') {
    p.noiseFill(base, 0.14, 4, 3, shade(base, 0.8), 0.3);
    const ctx = p.ctx;
    for (let y = 0; y < 256; y += 16) {
      const shift = (y / 16) % 2 ? 12 : 0;
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, y, 256, 2);
      for (let x = shift; x < 256; x += 24) {
        ctx.fillStyle = css(shade(base, 0.75 + p.rng.next() * 0.45), 0.35);
        ctx.fillRect(x + 1, y + 2, 22, 14);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(x, y, 1.5, 16);
      }
    }
    p.speckle(
      40,
      [
        [60, 70, 44],
        [50, 56, 40],
      ],
      2,
      7,
      0.22,
    );
  } else {
    p.noiseFill(base, 0.1, 4, 4, shade(base, 0.8), 0.4);
    p.speckle(1600, [shade(base, 0.8), shade(base, 1.2)], 0.5, 1.4, 0.6);
    p.speckle(10, [[40, 40, 38]], 8, 24, 0.12);
    p.grid(128, 128, shade(base, 0.7), 2, 0.4);
  }
  return repeatTexture(key, canvas);
}

/** Wall surface texture for exterior walls seen from above (the wall top). */
export function simpleTexture(key: string, base: string, variation = 0.15, periods = 4): Texture {
  const cached = textureCache.get(key);
  if (cached) return cached;
  const { canvas } = createCanvas(128);
  new TilePainter(canvas, 128, key.length * 31).noiseFill(hexToRgb(base), variation, periods, 3);
  return repeatTexture(key, canvas);
}

/** Radial gradient used for lights and soft shadows. */
export function radialTexture(key: string, inner: string, outer: string, size = 256, falloff = 1): Texture {
  const cached = textureCache.get(key);
  if (cached) return cached;
  const { canvas, ctx } = createCanvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner);
  g.addColorStop(
    Math.min(0.95, 0.35 * falloff),
    inner.replace(/[\d.]+\)$/, (m) => `${parseFloat(m) * 0.55})`),
  );
  g.addColorStop(1, outer);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = Texture.from(canvas);
  textureCache.set(key, tex);
  return tex;
}

/** A light cone pointing along +x from the left edge, used for flashlights. */
export function coneTexture(halfAngleDeg: number): Texture {
  const key = `cone:${halfAngleDeg}`;
  const cached = textureCache.get(key);
  if (cached) return cached;
  const w = 512;
  const h = 512;
  const { canvas, ctx } = createCanvas(w, h);
  const half = (halfAngleDeg * Math.PI) / 180;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x / w;
      const dy = (y - h / 2) / w;
      const d = Math.hypot(dx, dy);
      const a = Math.abs(Math.atan2(dy, dx));
      if (d > 1 || a > half * 1.25) continue;
      const edge = Math.max(0, 1 - Math.max(0, a - half * 0.55) / (half * 0.7));
      const fall = Math.pow(1 - d, 1.4) * Math.min(1, d * 12);
      const v = Math.max(0, Math.min(1, edge * fall));
      const i = (y * w + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 244;
      img.data[i + 2] = 220;
      img.data[i + 3] = v * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = Texture.from(canvas);
  textureCache.set(key, tex);
  return tex;
}

/** Irregular blood splat decals. */
export function bloodTextures(count = 6): Texture[] {
  const out: Texture[] = [];
  for (let n = 0; n < count; n++) {
    const key = `blood:${n}`;
    const cached = textureCache.get(key);
    if (cached) {
      out.push(cached);
      continue;
    }
    const size = 128;
    const { canvas, ctx } = createCanvas(size);
    const p = new TilePainter(canvas, size, 4200 + n * 7);
    const dark: RGB = [70, 8, 6];
    const mid: RGB = [110, 14, 10];
    ctx.fillStyle = css(mix(dark, mid, 0.4), 0.9);
    const blobs = 6 + p.rng.int(0, 6);
    for (let i = 0; i < blobs; i++) {
      const r = p.rng.range(6, 22);
      const x = size / 2 + p.rng.gaussian() * 14;
      const y = size / 2 + p.rng.gaussian() * 14;
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * p.rng.range(0.6, 1), p.rng.next() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 26; i++) {
      const a = p.rng.next() * Math.PI * 2;
      const d = p.rng.range(20, 58);
      const r = p.rng.range(1, 4.5);
      ctx.fillStyle = css(p.rng.chance(0.5) ? dark : mid, 0.85);
      ctx.beginPath();
      ctx.arc(size / 2 + Math.cos(a) * d, size / 2 + Math.sin(a) * d, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = Texture.from(canvas);
    textureCache.set(key, tex);
    out.push(tex);
  }
  return out;
}

/** Soft dark ellipse used under characters and props. */
export function shadowTexture(): Texture {
  return radialTexture('shadow', 'rgba(0,0,0,0.55)', 'rgba(0,0,0,0)', 64, 1.6);
}
