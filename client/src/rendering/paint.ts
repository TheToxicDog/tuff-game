// Small toolkit for painting seamless procedural textures on canvases. All drawing wraps around
// the tile edges so textures tile without seams.

import { Noise2D, Rng } from '@tuff/shared';

export type RGB = [number, number, number];

export function hexToRgb(hex: string): RGB {
  const v = parseInt(hex.replace('#', ''), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

export function rgbToHex([r, g, b]: RGB): number {
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

export function shade([r, g, b]: RGB, f: number): RGB {
  return [Math.min(255, r * f), Math.min(255, g * f), Math.min(255, b * f)];
}

export function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function css([r, g, b]: RGB, a = 1): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}

export function createCanvas(w: number, h = w): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  return { canvas, ctx };
}

export class TilePainter {
  readonly ctx: CanvasRenderingContext2D;
  readonly rng: Rng;
  readonly noise: Noise2D;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly size: number,
    seed: number,
    readonly ox = 0,
    readonly oy = 0,
  ) {
    this.ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    this.rng = new Rng(seed);
    this.noise = new Noise2D(seed);
  }

  /** Fills with a base colour modulated by periodic fBm noise. */
  noiseFill(base: RGB, variation: number, periods: number, octaves = 4, tint?: RGB, tintAmount = 0): void {
    const s = this.size;
    const img = this.ctx.createImageData(s, s);
    const d = img.data;
    const p = periods;
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const n = this.noise.fbm((x / s) * p, (y / s) * p, octaves, p, p);
        const f = 1 + n * variation;
        let r = base[0] * f;
        let g = base[1] * f;
        let b = base[2] * f;
        if (tint && tintAmount > 0) {
          const t2 = this.noise.fbm((x / s) * 2 + 17.3, (y / s) * 2 + 4.1, 2, 2, 2);
          const k = Math.max(0, t2) * tintAmount;
          r += (tint[0] - r) * k;
          g += (tint[1] - g) * k;
          b += (tint[2] - b) * k;
        }
        const i = (y * s + x) * 4;
        d[i] = r;
        d[i + 1] = g;
        d[i + 2] = b;
        d[i + 3] = 255;
      }
    }
    this.ctx.putImageData(img, this.ox, this.oy);
  }

  /** Runs a draw callback at the position and its wrapped copies. */
  wrap(x: number, y: number, extent: number, draw: (x: number, y: number) => void): void {
    const s = this.size;
    const ctx = this.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(this.ox, this.oy, s, s);
    ctx.clip();
    for (const dx of [-s, 0, s]) {
      for (const dy of [-s, 0, s]) {
        const px = x + dx;
        const py = y + dy;
        if (px + extent < 0 || py + extent < 0 || px - extent > s || py - extent > s) continue;
        draw(this.ox + px, this.oy + py);
      }
    }
    ctx.restore();
  }

  speckle(count: number, colors: RGB[], minR: number, maxR: number, alpha = 1): void {
    const ctx = this.ctx;
    for (let i = 0; i < count; i++) {
      const x = this.rng.next() * this.size;
      const y = this.rng.next() * this.size;
      const r = this.rng.range(minR, maxR);
      ctx.fillStyle = css(this.rng.pick(colors), alpha * this.rng.range(0.5, 1));
      this.wrap(x, y, r, (px, py) => {
        ctx.beginPath();
        ctx.ellipse(px, py, r, r * this.rng.range(0.6, 1), this.rng.next() * 3, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  strokes(count: number, colors: RGB[], minLen: number, maxLen: number, width: number, angle: number, spread: number, alpha = 1): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const x = this.rng.next() * this.size;
      const y = this.rng.next() * this.size;
      const len = this.rng.range(minLen, maxLen);
      const a = angle + this.rng.range(-spread, spread);
      const ex = Math.cos(a) * len;
      const ey = Math.sin(a) * len;
      ctx.strokeStyle = css(this.rng.pick(colors), alpha * this.rng.range(0.4, 1));
      ctx.lineWidth = width * this.rng.range(0.6, 1.3);
      this.wrap(x, y, len, (px, py) => {
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.quadraticCurveTo(px + ex * 0.5 + this.rng.range(-1, 1), py + ey * 0.5, px + ex, py + ey);
        ctx.stroke();
      });
    }
  }

  /** Random-walk cracks. */
  cracks(count: number, color: RGB, steps: number, stepLen: number, width: number, alpha = 0.7): void {
    const ctx = this.ctx;
    ctx.strokeStyle = css(color, alpha);
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < count; i++) {
      let x = this.rng.next() * this.size;
      let y = this.rng.next() * this.size;
      let a = this.rng.next() * Math.PI * 2;
      const pts: [number, number][] = [[x, y]];
      for (let s = 0; s < steps; s++) {
        a += this.rng.range(-0.7, 0.7);
        x += Math.cos(a) * stepLen;
        y += Math.sin(a) * stepLen;
        pts.push([x, y]);
      }
      const x0 = pts[0][0];
      const y0 = pts[0][1];
      this.wrap(x0, y0, steps * stepLen, (px, py) => {
        ctx.beginPath();
        ctx.moveTo(px, py);
        for (const [qx, qy] of pts) ctx.lineTo(px + qx - x0, py + qy - y0);
        ctx.stroke();
      });
    }
  }

  /** Grid lines (paving joints, tiles, planks). */
  grid(stepX: number, stepY: number, color: RGB, width: number, alpha: number, offsetRows = 0): void {
    const ctx = this.ctx;
    ctx.fillStyle = css(color, alpha);
    const s = this.size;
    for (let y = 0; y < s; y += stepY) {
      ctx.fillRect(this.ox, this.oy + y, s, width);
      const row = Math.round(y / stepY);
      const shift = offsetRows ? (row % 2) * offsetRows : 0;
      for (let x = shift % stepX; x < s + stepX; x += stepX) {
        if (x < s) ctx.fillRect(this.ox + x, this.oy + y, width, stepY);
      }
    }
  }
}
