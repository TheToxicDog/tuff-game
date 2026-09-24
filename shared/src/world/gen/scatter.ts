// Poisson-disc scattering (design plan §47): natural-looking prop placement with a minimum spacing.

import type { Rng } from '../../math/rng';

export interface ScatterOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Minimum distance between samples. */
  spacing: number;
  /** Optional acceptance test (terrain, clearance, density masks). */
  accept?: (x: number, y: number) => boolean;
  /** Attempts per active sample (Bridson's k). */
  attempts?: number;
  maxPoints?: number;
}

/** Bridson's algorithm over a rectangle. */
export function poissonDisc(rng: Rng, opts: ScatterOptions): { x: number; y: number }[] {
  const { x, y, w, h, spacing } = opts;
  const k = opts.attempts ?? 20;
  const cell = spacing / Math.SQRT2;
  const cols = Math.max(1, Math.ceil(w / cell));
  const rows = Math.max(1, Math.ceil(h / cell));
  const grid = new Int32Array(cols * rows).fill(-1);
  const points: { x: number; y: number }[] = [];
  const active: number[] = [];
  const max = opts.maxPoints ?? Infinity;

  const fits = (px: number, py: number): boolean => {
    if (px < x || py < y || px >= x + w || py >= y + h) return false;
    const cx = Math.floor((px - x) / cell);
    const cy = Math.floor((py - y) / cell);
    for (let j = Math.max(0, cy - 2); j <= Math.min(rows - 1, cy + 2); j++) {
      for (let i = Math.max(0, cx - 2); i <= Math.min(cols - 1, cx + 2); i++) {
        const idx = grid[j * cols + i];
        if (idx < 0) continue;
        const dx = points[idx].x - px;
        const dy = points[idx].y - py;
        if (dx * dx + dy * dy < spacing * spacing) return false;
      }
    }
    return true;
  };
  const add = (px: number, py: number) => {
    const idx = points.length;
    points.push({ x: px, y: py });
    active.push(idx);
    grid[Math.floor((py - y) / cell) * cols + Math.floor((px - x) / cell)] = idx;
  };

  // Acceptable areas may be disconnected (forest patches), so whenever growth stalls we try to
  // seed a new region with random probes.
  const probes = Math.ceil((w * h) / (spacing * spacing)) + 40;
  let probe = 0;
  while (points.length < max) {
    if (active.length === 0) {
      let seeded = false;
      while (probe < probes && !seeded) {
        probe++;
        const px = x + rng.next() * w;
        const py = y + rng.next() * h;
        if (fits(px, py) && (!opts.accept || opts.accept(px, py))) {
          add(px, py);
          seeded = true;
        }
      }
      if (!seeded) break;
    }
    const ai = Math.floor(rng.next() * active.length);
    const p = points[active[ai]];
    let placed = false;
    for (let t = 0; t < k; t++) {
      const angle = rng.next() * Math.PI * 2;
      const dist = spacing * (1 + rng.next());
      const px = p.x + Math.cos(angle) * dist;
      const py = p.y + Math.sin(angle) * dist;
      if (!fits(px, py)) continue;
      if (opts.accept && !opts.accept(px, py)) continue;
      add(px, py);
      placed = true;
      break;
    }
    if (!placed) active.splice(ai, 1);
  }
  return points;
}
