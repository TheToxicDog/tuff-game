// Planks nailed across a doorway or window (design plan §54, §82 "boarded" variants). Drawn in the
// opening's local frame: x runs along the opening, centred on it.

import type { Graphics } from 'pixi.js';

const PLANK = 0x8a6a46;

export function drawBoards(g: Graphics, width: number, boards: number, seed: number): void {
  g.clear();
  if (boards <= 0) return;
  const len = width + 0.3;
  for (let i = 0; i < boards; i++) {
    // Alternate slight angles so the planks cross like a hurried barricade.
    const tilt = (i % 2 === 0 ? 1 : -1) * (0.12 + ((seed >> i) & 3) * 0.03);
    const offset = (i - (boards - 1) / 2) * 0.06;
    const c = Math.cos(tilt);
    const s = Math.sin(tilt);
    const hx = len / 2;
    const hy = 0.07;
    const corners = [
      [-hx, -hy],
      [hx, -hy],
      [hx, hy],
      [-hx, hy],
    ].map(([x, y]) => [x * c - y * s, x * s + y * c + offset]);
    g.poly(corners.map(([x, y]) => [x + 0.04, y + 0.05]).flat()).fill({ color: 0x000000, alpha: 0.3 });
    g.poly(corners.flat()).fill(i % 2 === 0 ? PLANK : 0x7a5c3c);
    g.poly(corners.flat()).stroke({ color: 0x3a2a1a, width: 0.02 });
    for (const t of [-0.42, 0.42]) g.circle(t * len * c - 0 * s, t * len * s + offset, 0.018).fill(0x2a2a2a);
  }
}
