// Settlements: roofs of houses, market stalls with their traders, the well in the square, and
// the camps and ruins out in the wild.

import { Container, Graphics, Text } from 'pixi.js';
import { PROFESSION_BY_ID, type HouseInfo, type NpcInfo } from '@ironwild/shared';
import type { ClientWorld } from '../game/world';
import { makeCharacter, NAME_STYLE, type CharacterParts } from './characters';
import { OUTLINE, TS, rand, shade } from './draw';
import type { Renderer } from './renderer';

interface NpcView {
  npc: NpcInfo;
  parts: CharacterParts;
  stall: Container;
  angle: number;
}

export class TownRenderer {
  private readonly npcs: NpcView[] = [];

  constructor(
    private readonly r: Renderer,
    private readonly world: ClientWorld,
  ) {}

  init(): void {
    const houses = new Container();
    for (const h of this.world.houses) houses.addChild(house(h));
    this.r.layers.canopy.addChild(houses);
    const ground = new Container();
    for (const s of this.world.settlements) {
      ground.addChild(well(s.x, s.y));
      for (const n of s.npcs) {
        const prof = PROFESSION_BY_ID.get(n.profession);
        const color = prof?.color ?? 0x888888;
        const stallView = n.profession === 'board' ? board(n) : stall(n, color);
        ground.addChild(stallView);
        const parts = makeCharacter({ look: Math.floor(rand(n.x * 10, n.y * 10) * 8), shirt: color, hat: shade(color, 0.7) });
        parts.root.position.set(n.x * TS, n.y * TS);
        const label = new Text({ text: n.name, style: NAME_STYLE, resolution: 2 });
        label.anchor.set(0.5, 1);
        label.position.set(0, -44);
        const title = new Text({ text: n.title, style: { ...NAME_STYLE, fontSize: 13, fill: 0xf2c53d }, resolution: 2 });
        title.anchor.set(0.5, 1);
        title.position.set(0, -28);
        parts.root.addChild(label, title);
        this.r.layers.entities.addChild(parts.root);
        this.npcs.push({ npc: n, parts, stall: stallView, angle: n.angle });
      }
    }
    for (const lm of this.world.landmarks) {
      if (lm.kind === 'bandit_camp') ground.addChild(campfire(lm.x, lm.y));
      if (lm.kind === 'mine') ground.addChild(mineEntrance(lm.x, lm.y));
    }
    this.r.layers.floors.addChild(ground);
    this.setProsperity(new Map());
  }

  /** Traders turn to face a nearby player. */
  animate(dt: number, px: number, py: number): void {
    for (const v of this.npcs) {
      const d = Math.hypot(px - v.npc.x, py - v.npc.y);
      const target = d < 7 ? Math.atan2(py - v.npc.y, px - v.npc.x) : v.npc.angle;
      let diff = target - v.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      v.angle += diff * Math.min(1, dt * 5);
      v.parts.body.rotation = v.angle;
    }
  }

  /** Shows the stalls whose settlement has become prosperous enough (§54). */
  setProsperity(prosperity: Map<string, number>): void {
    for (const v of this.npcs) {
      const open = (v.npc.unlock ?? 0) <= (prosperity.get(this.settlementOf(v.npc)) ?? 0);
      v.parts.root.visible = open;
      v.stall.visible = open;
    }
  }

  private settlementOf(n: NpcInfo): string {
    return n.id.split(':')[0];
  }

  npcAt(x: number, y: number, range: number): NpcInfo | null {
    let best: NpcInfo | null = null;
    let bestD = range;
    for (const v of this.npcs) {
      const d = Math.hypot(v.npc.x - x, v.npc.y - y);
      if (d < bestD) {
        bestD = d;
        best = v.npc;
      }
    }
    return best;
  }
}

function house(h: HouseInfo): Container {
  const c = new Container();
  const g = new Graphics();
  const x = h.x * TS;
  const y = h.y * TS;
  const w = h.w * TS;
  const hh = h.h * TS;
  if (h.style === 'tent') {
    g.poly([x + 6, y + hh - 4, x + w / 2, y + 4, x + w - 6, y + hh - 4], true)
      .fill(0x8a6a45)
      .stroke({ width: 4, color: OUTLINE });
    g.poly([x + w / 2, y + 4, x + w - 6, y + hh - 4, x + w / 2, y + hh - 4], true).fill(0x6b5234);
    g.poly([x + w / 2 - 8, y + hh - 4, x + w / 2, y + hh - 26, x + w / 2 + 8, y + hh - 4], true).fill(0x2a1a14);
  } else if (h.style === 'ship') {
    // Drawn along its long axis: pointed bow, deck planks, a stern cabin, two masts with furled sails.
    const long = Math.max(w, hh);
    const beam = Math.min(w, hh);
    const ship = new Graphics();
    const L = long / 2;
    const B = beam / 2 - 6;
    ship
      .poly([-L + 10, -B, L - 40, -B, L - 2, 0, L - 40, B, -L + 10, B, -L + 2, 0], true)
      .fill(0x6b4a2a)
      .stroke({ width: 5, color: OUTLINE });
    ship.poly([-L + 18, -B + 8, L - 44, -B + 8, L - 16, 0, L - 44, B - 8, -L + 18, B - 8], true).fill(0xa47a45);
    for (let i = -L + 30; i < L - 40; i += 18)
      ship
        .moveTo(i, -B + 9)
        .lineTo(i, B - 9)
        .stroke({ width: 1.5, color: 0x7a5230 });
    ship
      .roundRect(-L + 20, -B + 12, 60, B * 2 - 24, 5)
      .fill(0x8a5a33)
      .stroke({ width: 3, color: OUTLINE });
    for (const mx of [-L * 0.2, L * 0.3]) {
      ship
        .roundRect(mx - 5, -B - 10, 10, B * 2 + 20, 4)
        .fill(0xe8e0c8)
        .stroke({ width: 3, color: OUTLINE });
      ship.circle(mx, 0, 9).fill(0x5e3b22).stroke({ width: 3, color: OUTLINE });
    }
    ship
      .moveTo(L - 2, 0)
      .lineTo(L + 30, 0)
      .stroke({ width: 4, color: 0x5e3b22 });
    ship.position.set(x + w / 2, y + hh / 2);
    if (hh > w) ship.rotation = Math.PI / 2;
    c.addChild(ship);
    return c;
  } else if (h.style === 'ruin') {
    const seed = h.x * 31 + h.y;
    for (let i = 0; i < 7; i++) {
      const bx = x + rand(seed, i, 1) * (w - 20);
      const by = y + rand(seed, i, 2) * (hh - 20);
      g.roundRect(bx, by, 16 + rand(seed, i, 3) * 20, 14 + rand(seed, i, 4) * 10, 3)
        .fill(shade(0x8f949a, 0.8 + rand(seed, i, 5) * 0.3))
        .stroke({ width: 3, color: OUTLINE });
    }
    g.rect(x, y, w, 10).fill(0x7d8189).stroke({ width: 3, color: OUTLINE });
    g.rect(x, y, 10, hh * 0.6)
      .fill(0x7d8189)
      .stroke({ width: 3, color: OUTLINE });
  } else {
    // Pitched roof with a ridge along the long side.
    g.roundRect(x - 4, y - 4, w + 8, hh + 8, 4).fill({ color: 0x000000, alpha: 0.18 });
    g.rect(x, y, w, hh).fill(h.color).stroke({ width: 5, color: OUTLINE });
    const horizontal = w >= hh;
    if (horizontal) {
      g.rect(x, y + hh / 2, w, hh / 2).fill(shade(h.color, 0.82));
      g.moveTo(x, y + hh / 2)
        .lineTo(x + w, y + hh / 2)
        .stroke({ width: 4, color: shade(h.color, 0.6) });
      for (let i = 1; i < 4; i++)
        g.moveTo(x, y + (hh / 8) * i)
          .lineTo(x + w, y + (hh / 8) * i)
          .stroke({ width: 1.5, color: shade(h.color, 0.9), alpha: 0.6 });
    } else {
      g.rect(x + w / 2, y, w / 2, hh).fill(shade(h.color, 0.82));
      g.moveTo(x + w / 2, y)
        .lineTo(x + w / 2, y + hh)
        .stroke({ width: 4, color: shade(h.color, 0.6) });
    }
    g.rect(x, y, w, hh).stroke({ width: 5, color: OUTLINE });
    g.rect(x + w * 0.7, y + hh * 0.15, 14, 14)
      .fill(0x8f949a)
      .stroke({ width: 3, color: OUTLINE });
  }
  c.addChild(g);
  return c;
}

function well(x: number, y: number): Graphics {
  const g = new Graphics();
  const cx = x * TS;
  const cy = y * TS;
  g.circle(cx, cy, 44).fill(0x9aa0a6).stroke({ width: 5, color: OUTLINE });
  g.circle(cx, cy, 32).fill(0x5b93c7);
  g.circle(cx - 8, cy - 8, 8).fill({ color: 0xffffff, alpha: 0.35 });
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.moveTo(cx + Math.cos(a) * 32, cy + Math.sin(a) * 32)
      .lineTo(cx + Math.cos(a) * 44, cy + Math.sin(a) * 44)
      .stroke({ width: 2, color: 0x70757b });
  }
  return g;
}

function stall(n: NpcInfo, color: number): Container {
  const c = new Container();
  const g = new Graphics();
  // The counter sits between the trader and the square's centre.
  const cx = n.x * TS + Math.cos(n.angle) * 44;
  const cy = n.y * TS + Math.sin(n.angle) * 44;
  c.position.set(cx, cy);
  c.rotation = n.angle + Math.PI / 2;
  g.roundRect(-44, -12, 88, 24, 5).fill(0x9a6b3f).stroke({ width: 4, color: OUTLINE });
  for (let i = 0; i < 4; i++)
    g.circle(-30 + i * 20, 0, 5)
      .fill(shade(color, 1.2))
      .stroke({ width: 2, color: OUTLINE });
  // Awning behind the trader.
  const aw = new Graphics();
  for (let i = 0; i < 6; i++) aw.rect(-48 + i * 16, 46, 16, 26).fill(i % 2 ? 0xf3ecd9 : color);
  aw.rect(-48, 46, 96, 26).stroke({ width: 4, color: OUTLINE });
  c.addChild(aw, g);
  return c;
}

function board(n: NpcInfo): Container {
  const c = new Container();
  const g = new Graphics();
  c.position.set(n.x * TS + Math.cos(n.angle) * 40, n.y * TS + Math.sin(n.angle) * 40);
  c.rotation = n.angle + Math.PI / 2;
  g.roundRect(-40, -14, 80, 28, 4).fill(0x7a5230).stroke({ width: 4, color: OUTLINE });
  for (let i = 0; i < 4; i++)
    g.rect(-34 + i * 18, -9, 12, 16)
      .fill(0xf3ecd9)
      .stroke({ width: 1.5, color: OUTLINE });
  c.addChild(g);
  return c;
}

function campfire(x: number, y: number): Graphics {
  const g = new Graphics();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    g.circle(x * TS + Math.cos(a) * 24, y * TS + Math.sin(a) * 24, 7)
      .fill(0x8f949a)
      .stroke({ width: 2, color: OUTLINE });
  }
  g.circle(x * TS, y * TS, 12)
    .fill(0xf07a2a)
    .circle(x * TS, y * TS, 6)
    .fill(0xffd35a);
  return g;
}

function mineEntrance(x: number, y: number): Graphics {
  const g = new Graphics();
  const cx = x * TS;
  const cy = y * TS;
  g.roundRect(cx - 50, cy - 40, 100, 70, 30)
    .fill(0x3a3430)
    .stroke({ width: 5, color: OUTLINE });
  g.rect(cx - 56, cy - 44, 12, 80)
    .fill(0x7a5230)
    .stroke({ width: 3, color: OUTLINE });
  g.rect(cx + 44, cy - 44, 12, 80)
    .fill(0x7a5230)
    .stroke({ width: 3, color: OUTLINE });
  g.rect(cx - 60, cy - 50, 120, 12)
    .fill(0x7a5230)
    .stroke({ width: 3, color: OUTLINE });
  for (let i = 0; i < 5; i++) g.rect(cx - 30, cy + 40 + i * 14, 60, 5).fill(0x6b4a2a);
  return g;
}
