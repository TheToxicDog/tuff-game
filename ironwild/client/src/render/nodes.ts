// Resource nodes, drawn MooMoo-style: big round tree canopies above the characters, chunky rocks,
// ore veins speckled with their metal, bushes and grasses. Nodes wiggle when hit.

import { Container, Graphics, GraphicsContext } from 'pixi.js';
import type { ClientNode } from '../game/world';
import { OUTLINE, TS, arcPath, blob, rand, shade } from './draw';
import type { Renderer } from './renderer';

interface NodeView {
  node: ClientNode;
  base: Container;
  canopy: Container | null;
  wiggleX: number;
  wiggleY: number;
  depleted: boolean;
}

const cache = new Map<string, GraphicsContext>();

function ctxFor(key: string, build: (g: GraphicsContext) => void): GraphicsContext {
  let c = cache.get(key);
  if (!c) {
    c = new GraphicsContext();
    build(c);
    cache.set(key, c);
  }
  return c;
}

const ORE_ACCENT: Record<string, number[]> = {
  iron_vein: [0xc26a3a, 0xd98a52, 0xa0522d],
  rich_iron: [0xc26a3a, 0xd98a52, 0xe8a060, 0xa0522d],
  copper_vein: [0x3fb3a0, 0x55d1b8, 0xd27a45],
  silver_vein: [0xe4e8f0, 0xffffff, 0xb8c0cc],
  gold_vein: [0xf2c53d, 0xffe27a, 0xd9a520],
  coal_vein: [0x1c1c1e, 0x2a2a2e, 0x111113],
};

function rock(g: GraphicsContext, r: number, color: number, seed: number): void {
  blob(g, 0, 0, r, seed, 9, 0.14).fill(color).stroke({ width: 4, color: OUTLINE, alpha: 0.85 });
  blob(g, -r * 0.18, -r * 0.2, r * 0.62, seed + 1, 8, 0.12).fill({ color: shade(color, 1.12) });
  g.ellipse(-r * 0.35, -r * 0.4, r * 0.22, r * 0.14).fill({ color: 0xffffff, alpha: 0.22 });
}

function flecks(g: GraphicsContext, r: number, colors: number[], count: number, seed: number): void {
  for (let i = 0; i < count; i++) {
    const a = rand(seed, i, 1) * Math.PI * 2;
    const d = r * (0.2 + rand(seed, i, 2) * 0.55);
    const s = r * (0.12 + rand(seed, i, 3) * 0.1);
    const x = Math.cos(a) * d;
    const y = Math.sin(a) * d;
    g.poly([x - s, y, x, y - s * 1.2, x + s, y, x, y + s * 1.2], true)
      .fill(colors[i % colors.length])
      .stroke({ width: 2, color: OUTLINE, alpha: 0.7 });
  }
}

function buildBase(type: string, depleted: boolean): GraphicsContext {
  return ctxFor(`${type}:${depleted}`, (g) => {
    const T = TS;
    switch (type) {
      case 'tree':
      case 'pine':
      case 'hardwood_tree':
      case 'swamp_tree':
      case 'cactus': {
        if (type === 'cactus') {
          const green = 0x5b9a4a;
          if (depleted) {
            g.circle(0, 0, T * 0.2)
              .fill(shade(green, 0.8))
              .stroke({ width: 3, color: OUTLINE });
            return;
          }
          g.roundRect(-T * 0.16, -T * 0.42, T * 0.32, T * 0.84, T * 0.16)
            .fill(green)
            .stroke({ width: 3, color: OUTLINE });
          g.roundRect(-T * 0.42, -T * 0.18, T * 0.26, T * 0.14, T * 0.07)
            .fill(green)
            .stroke({ width: 3, color: OUTLINE });
          g.roundRect(T * 0.16, -T * 0.05, T * 0.26, T * 0.14, T * 0.07)
            .fill(green)
            .stroke({ width: 3, color: OUTLINE });
          for (let i = 0; i < 8; i++) g.circle(-T * 0.08 + (i % 2) * T * 0.16, -T * 0.34 + i * T * 0.09, 1.6).fill(0xf5f0d0);
          return;
        }
        const trunk = type === 'hardwood_tree' ? 0x5e3b22 : 0x7a5230;
        const r = type === 'hardwood_tree' ? 0.42 : 0.34;
        g.circle(0, 0, T * r)
          .fill(trunk)
          .stroke({ width: 4, color: OUTLINE });
        if (depleted) {
          g.circle(0, 0, T * r * 0.65).stroke({ width: 2, color: shade(trunk, 1.35) });
          g.circle(0, 0, T * r * 0.3).stroke({ width: 2, color: shade(trunk, 1.35) });
        }
        return;
      }
      case 'rock':
      case 'boulder':
      case 'coal_vein':
      case 'iron_vein':
      case 'copper_vein':
      case 'rich_iron':
      case 'silver_vein':
      case 'gold_vein':
      case 'gem_rock':
      case 'salt_deposit':
      case 'clay_deposit': {
        const r = (type === 'boulder' || type === 'rich_iron' ? 1.2 : 0.92) * T;
        if (depleted) {
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.4;
            blob(g, Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.35, r * 0.18, i, 6, 0.2)
              .fill(type === 'clay_deposit' ? 0x9a6040 : 0x80858b)
              .stroke({ width: 2.5, color: OUTLINE, alpha: 0.8 });
          }
          return;
        }
        if (type === 'clay_deposit') {
          blob(g, 0, 0, r * 0.95, 3, 10, 0.1)
            .fill(0xb8764f)
            .stroke({ width: 4, color: OUTLINE, alpha: 0.85 });
          blob(g, -r * 0.1, -r * 0.15, r * 0.6, 4, 9, 0.1).fill(0xcf8d63);
          g.ellipse(-r * 0.3, -r * 0.35, r * 0.2, r * 0.1).fill({ color: 0xffffff, alpha: 0.18 });
          return;
        }
        if (type === 'salt_deposit') {
          blob(g, 0, 0, r * 0.9, 5, 10, 0.1)
            .fill(0xd8d4c8)
            .stroke({ width: 4, color: OUTLINE, alpha: 0.8 });
          for (let i = 0; i < 6; i++) {
            const a = rand(9, i) * Math.PI * 2;
            const d = r * 0.45 * rand(10, i);
            const x = Math.cos(a) * d;
            const y = Math.sin(a) * d;
            g.poly([x, y - r * 0.28, x + r * 0.12, y, x, y + r * 0.1, x - r * 0.12, y], true)
              .fill(0xf6f5f0)
              .stroke({ width: 2, color: 0x9a968a });
          }
          return;
        }
        const color = type === 'coal_vein' ? 0x5c5c62 : type === 'rich_iron' ? 0x8a7f7a : 0x8f949a;
        rock(g, r, color, type.length);
        if (ORE_ACCENT[type]) flecks(g, r, ORE_ACCENT[type], type === 'rich_iron' ? 9 : 6, type.length * 7);
        if (type === 'boulder') {
          g.moveTo(-r * 0.2, -r * 0.5)
            .lineTo(0, -r * 0.1)
            .lineTo(-r * 0.1, r * 0.3)
            .stroke({ width: 3, color: shade(color, 0.7) });
        }
        if (type === 'gem_rock') {
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + 0.3;
            const x = Math.cos(a) * r * 0.35;
            const y = Math.sin(a) * r * 0.35;
            g.poly([x, y - r * 0.35, x + r * 0.13, y, x, y + r * 0.08, x - r * 0.13, y], true)
              .fill(i % 2 ? 0xe0405e : 0xff7aa0)
              .stroke({ width: 2, color: OUTLINE });
          }
        }
        return;
      }
      case 'sand_dune': {
        const r = 0.9 * T;
        if (depleted) return;
        g.ellipse(0, 0, r, r * 0.75)
          .fill({ color: 0xe8d59a, alpha: 0.95 })
          .stroke({ width: 3, color: shade(0xe8d59a, 0.75) });
        for (let i = 0; i < 3; i++)
          arcPath(g, 0, r * 0.4 - i * r * 0.3, r * 0.5, Math.PI * 1.15, Math.PI * 1.85).stroke({ width: 2.5, color: 0xc9b070 });
        return;
      }
      case 'berry_bush': {
        const r = 0.7 * T;
        if (depleted) {
          for (let i = 0; i < 6; i++) {
            const a = (i / 6) * Math.PI * 2;
            g.moveTo(0, 0)
              .lineTo(Math.cos(a) * r * 0.6, Math.sin(a) * r * 0.6)
              .stroke({ width: 3, color: 0x6b4a2a });
          }
          return;
        }
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          g.circle(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.5)
            .fill(0x4f8f3a)
            .stroke({ width: 3, color: OUTLINE, alpha: 0.7 });
        }
        g.circle(0, 0, r * 0.55).fill(0x5fa244);
        for (let i = 0; i < 9; i++) {
          const a = rand(3, i) * Math.PI * 2;
          const d = r * 0.7 * rand(4, i);
          g.circle(Math.cos(a) * d, Math.sin(a) * d, 5)
            .fill(0xd0304a)
            .stroke({ width: 1.5, color: 0x5a1020 });
        }
        return;
      }
      case 'fiber_grass':
      case 'reeds':
      case 'wild_wheat': {
        if (depleted) return;
        const color = type === 'reeds' ? 0x6f8f45 : type === 'wild_wheat' ? 0xc9a046 : 0x7fae4a;
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const len = T * (0.35 + rand(i, 5) * 0.25);
          const bx = Math.cos(a) * 6;
          const by = Math.sin(a) * 6;
          g.moveTo(bx, by)
            .quadraticCurveTo(
              bx + Math.cos(a) * len * 0.5,
              by + Math.sin(a) * len * 0.5 - 6,
              bx + Math.cos(a) * len,
              by + Math.sin(a) * len,
            )
            .stroke({ width: 4, color: shade(color, 0.7), cap: 'round' });
          g.moveTo(bx, by)
            .quadraticCurveTo(
              bx + Math.cos(a) * len * 0.5,
              by + Math.sin(a) * len * 0.5 - 6,
              bx + Math.cos(a) * len,
              by + Math.sin(a) * len,
            )
            .stroke({ width: 2, color, cap: 'round' });
          if (type === 'reeds') g.ellipse(bx + Math.cos(a) * len, by + Math.sin(a) * len, 4, 7).fill(0x7a4e2d);
          if (type === 'wild_wheat')
            g.ellipse(bx + Math.cos(a) * len, by + Math.sin(a) * len, 4, 6)
              .fill(0xe8c45a)
              .stroke({ width: 1.5, color: 0x8a6a2a });
        }
        return;
      }
      case 'mushroom_patch': {
        if (depleted) return;
        for (const [x, y, s] of [
          [-10, 4, 1],
          [9, -6, 0.8],
          [6, 10, 0.7],
        ]) {
          g.roundRect(x - 3 * s, y - 2, 6 * s, 10 * s, 2)
            .fill(0xf0e6d2)
            .stroke({ width: 2, color: OUTLINE });
          g.circle(x, y - 2, 11 * s)
            .fill(0xc9573c)
            .stroke({ width: 2.5, color: OUTLINE });
          g.circle(x - 4 * s, y - 5 * s, 2).fill(0xffffff);
          g.circle(x + 3 * s, y - 2 * s, 1.6).fill(0xffffff);
        }
        return;
      }
      case 'herb_patch': {
        if (depleted) return;
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          g.ellipse(Math.cos(a) * 11, Math.sin(a) * 11, 9, 5)
            .fill(0x5aa25a)
            .stroke({ width: 2, color: OUTLINE, alpha: 0.6 });
        }
        for (let i = 0; i < 4; i++) g.circle(Math.cos(i * 1.6) * 7, Math.sin(i * 1.6) * 7, 3).fill(0xeef5d0);
        return;
      }
      case 'salvage': {
        const r = 0.8 * T;
        if (depleted) {
          g.rect(-r * 0.4, -4, r * 0.8, 8).fill(0x7a5a3a);
          return;
        }
        g.rect(-r * 0.7, -r * 0.2, r * 1.2, r * 0.22)
          .fill(0x9a7a50)
          .stroke({ width: 3, color: OUTLINE });
        g.poly([-r * 0.5, r * 0.3, r * 0.6, -r * 0.5, r * 0.75, -r * 0.3, -r * 0.35, r * 0.5], true)
          .fill(0x8a6a45)
          .stroke({ width: 3, color: OUTLINE });
        g.poly([-r * 0.2, -r * 0.6, r * 0.3, -r * 0.55, r * 0.25, -r * 0.15, -r * 0.3, -r * 0.2], true)
          .fill(0x7d8189)
          .stroke({ width: 3, color: OUTLINE });
        g.circle(r * 0.35, r * 0.35, r * 0.2)
          .fill(0x9aa0a6)
          .stroke({ width: 3, color: OUTLINE });
        g.circle(r * 0.35, r * 0.35, r * 0.07).fill(0x5a5e64);
        return;
      }
      default:
        g.circle(0, 0, T * 0.4)
          .fill(0x888888)
          .stroke({ width: 3, color: OUTLINE });
    }
  });
}

function buildCanopy(type: string): GraphicsContext | null {
  if (!['tree', 'pine', 'hardwood_tree', 'swamp_tree'].includes(type)) return null;
  return ctxFor(`${type}:canopy`, (g) => {
    const T = TS;
    if (type === 'tree') {
      const r = 1.35 * T;
      g.circle(0, 0, r).fill(0x5b9a3c).stroke({ width: 5, color: 0x355f24 });
      g.circle(-r * 0.08, -r * 0.1, r * 0.72).fill(0x68ab46);
      g.circle(-r * 0.3, -r * 0.32, r * 0.28).fill({ color: 0x7fc255, alpha: 0.9 });
      g.circle(r * 0.3, r * 0.15, r * 0.22).fill({ color: 0x5b9a3c, alpha: 0.9 });
    } else if (type === 'pine') {
      const r = 1.2 * T;
      const star = (rr: number, rot: number) => {
        const pts: number[] = [];
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2 + rot;
          const d = i % 2 === 0 ? rr : rr * 0.72;
          pts.push(Math.cos(a) * d, Math.sin(a) * d);
        }
        return pts;
      };
      g.poly(star(r, 0), true).fill(0x2f6b3a).stroke({ width: 5, color: 0x1f4a28 });
      g.poly(star(r * 0.72, 0.2), true).fill(0x3d8048);
      g.poly(star(r * 0.42, 0.1), true).fill(0x4f955a);
    } else if (type === 'hardwood_tree') {
      const r = 1.6 * T;
      for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2;
        g.circle(Math.cos(a) * r * 0.45, Math.sin(a) * r * 0.45, r * 0.55)
          .fill(0x4a6a2c)
          .stroke({ width: 5, color: 0x2c4219 });
      }
      g.circle(0, 0, r * 0.62).fill(0x55793a);
      g.circle(-r * 0.25, -r * 0.25, r * 0.25).fill({ color: 0x6b8f48, alpha: 0.9 });
    } else {
      const r = 1.3 * T;
      g.circle(0, 0, r).fill(0x7a9a55).stroke({ width: 5, color: 0x4f6a35 });
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        g.moveTo(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5)
          .lineTo(Math.cos(a) * r * 1.02, Math.sin(a) * r * 1.02)
          .stroke({ width: 4, color: 0x8fb065, cap: 'round' });
      }
      g.circle(0, 0, r * 0.45).fill(0x8aac62);
    }
  });
}

export class NodeRenderer {
  private readonly views = new Map<number, NodeView>();

  constructor(private readonly r: Renderer) {}

  add(n: ClientNode): void {
    const depleted = n.state === 0;
    const base = new Container();
    base.addChild(new Graphics(buildBase(n.type, depleted)));
    base.position.set(n.x * TS, n.y * TS);
    const rot = rand(n.id, 3) * Math.PI * 2;
    base.rotation = n.def.canopy ? 0 : rot;
    const s = 0.9 + rand(n.id, 4) * 0.2;
    base.scale.set(s);
    this.r.chunk(n.chunk, 'nodes').addChild(base);
    let canopy: Container | null = null;
    const ctx = buildCanopy(n.type);
    if (ctx && !depleted) {
      canopy = new Container();
      canopy.addChild(new Graphics(ctx));
      canopy.position.set(n.x * TS, n.y * TS);
      canopy.rotation = rot;
      canopy.scale.set(s);
      this.r.chunk(n.chunk, 'canopy').addChild(canopy);
    }
    this.views.set(n.id, { node: n, base, canopy, wiggleX: 0, wiggleY: 0, depleted });
  }

  changed(n: ClientNode): void {
    const v = this.views.get(n.id);
    const depleted = n.state === 0;
    if (!v || v.depleted !== depleted) {
      this.remove(n);
      this.add(n);
    }
  }

  remove(n: ClientNode): void {
    const v = this.views.get(n.id);
    if (!v) return;
    v.base.destroy({ children: true });
    v.canopy?.destroy({ children: true });
    this.views.delete(n.id);
  }

  wiggle(id: number, dx: number, dy: number): void {
    const v = this.views.get(id);
    if (!v) return;
    v.wiggleX = dx * 9;
    v.wiggleY = dy * 9;
  }

  /** Per frame: wiggles decay; canopies fade when the player is underneath. */
  animate(dt: number, px: number, py: number): void {
    const k = Math.pow(0.001, dt);
    for (const v of this.views.values()) {
      if (v.wiggleX !== 0 || v.wiggleY !== 0) {
        v.wiggleX *= k;
        v.wiggleY *= k;
        if (Math.abs(v.wiggleX) + Math.abs(v.wiggleY) < 0.2) v.wiggleX = v.wiggleY = 0;
        const x = v.node.x * TS + v.wiggleX;
        const y = v.node.y * TS + v.wiggleY;
        v.base.position.set(x, y);
        v.canopy?.position.set(x, y);
      }
      if (v.canopy) {
        const d = Math.hypot(v.node.x - px, v.node.y - py);
        const target = d < v.node.def.visual * 0.95 ? 0.42 : 1;
        v.canopy.alpha += (target - v.canopy.alpha) * Math.min(1, dt * 8);
      }
    }
  }
}
