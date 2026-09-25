// Drawing helpers shared by the world renderers. World drawings use TS pixels per tile; the style
// is flat colour with chunky dark outlines.

import { GraphicsContext, type Graphics } from 'pixi.js';

/** World pixels per tile at zoom 1. */
export const TS = 64;
export const OUTLINE = 0x2a241c;
export const OUTLINE_W = 3;

export function shade(color: number, f: number): number {
  const r = Math.max(0, Math.min(255, Math.round(((color >> 16) & 255) * f)));
  const g = Math.max(0, Math.min(255, Math.round(((color >> 8) & 255) * f)));
  const b = Math.max(0, Math.min(255, Math.round((color & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

export function mix(a: number, b: number, t: number): number {
  const r = Math.round(((a >> 16) & 255) * (1 - t) + ((b >> 16) & 255) * t);
  const g = Math.round(((a >> 8) & 255) * (1 - t) + ((b >> 8) & 255) * t);
  const bl = Math.round((a & 255) * (1 - t) + (b & 255) * t);
  return (r << 16) | (g << 8) | bl;
}

/** Deterministic pseudo-random in [0, 1) from integers. */
export function rand(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x27d4eb2d) ^ Math.imul(b | 0, 0x165667b1) ^ Math.imul(c | 0, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

type Drawable = Graphics | GraphicsContext;

export function blob(g: Drawable, cx: number, cy: number, r: number, seed: number, points = 9, wobble = 0.18): Drawable {
  const pts: number[] = [];
  for (let i = 0; i < points; i++) {
    const a = (i / points) * Math.PI * 2 + seed;
    const rr = r * (1 - wobble + wobble * 2 * rand(seed * 100 + i, 7));
    pts.push(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
  }
  return g.poly(pts, true);
}

/** An open arc that starts a fresh sub-path (a bare arc() would join the previous point). */
export function arcPath<T extends Drawable>(g: T, cx: number, cy: number, r: number, a0: number, a1: number): T {
  g.moveTo(cx + Math.cos(a0) * r, cy + Math.sin(a0) * r);
  g.arc(cx, cy, r, a0, a1);
  return g;
}

export function gearPoints(r: number, teeth: number, depth = 0.2): number[] {
  const pts: number[] = [];
  const n = teeth * 4;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const phase = i % 4;
    const rr = phase === 0 || phase === 1 ? r : r * (1 - depth);
    pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  return pts;
}

const gearCache = new Map<string, GraphicsContext>();

/** A gear (centred at 0,0) as a shared context. */
export function gearContext(r: number, teeth: number, color: number, spokes = 4): GraphicsContext {
  const key = `${r}:${teeth}:${color}:${spokes}`;
  let ctx = gearCache.get(key);
  if (ctx) return ctx;
  ctx = new GraphicsContext();
  ctx.poly(gearPoints(r, teeth), true).fill(color).stroke({ width: 2.5, color: OUTLINE });
  ctx.circle(0, 0, r * 0.62).fill(shade(color, 0.82));
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2;
    ctx
      .moveTo(Math.cos(a) * r * 0.2, Math.sin(a) * r * 0.2)
      .lineTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6)
      .stroke({ width: r * 0.16, color: shade(color, 1.1) });
  }
  ctx
    .circle(0, 0, r * 0.22)
    .fill(shade(color, 0.6))
    .stroke({ width: 2, color: OUTLINE });
  gearCache.set(key, ctx);
  return ctx;
}

/** A straight arrow pointing +x, centred at 0,0. */
export function arrow(g: Drawable, len: number, width: number, color: number, alpha = 1): Drawable {
  const h = width * 1.8;
  return g
    .poly(
      [
        -len / 2,
        -width / 2,
        len / 2 - h,
        -width / 2,
        len / 2 - h,
        -h / 1.2,
        len / 2,
        0,
        len / 2 - h,
        h / 1.2,
        len / 2 - h,
        width / 2,
        -len / 2,
        width / 2,
      ],
      true,
    )
    .fill({ color, alpha });
}

export const SKIN = [0xf1c27d, 0xe0ac69, 0xc68642, 0x8d5524, 0xffdbac, 0xd7a57a, 0xb57c52, 0xf5d0a9];
export const SHIRTS = [0x4f7a9a, 0xa0453c, 0x5c7a3a, 0x8a5a9a, 0xc98a3e, 0x3f6f6f, 0x6a5a4a, 0x9a3f5a];
