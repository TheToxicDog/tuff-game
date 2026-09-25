// Structures, drawn so that factories read physically (§ design note): shafts spin, gears mesh
// and turn at their real speeds, water wheels paddle, windmill sails sweep, belts crawl, presses
// stamp, furnaces glow. Each view is a static drawing plus a list of per-frame animations.

import { Container, Graphics, Sprite, Texture, TilingSprite } from 'pixi.js';
import { CROP_BY_ID, DX, DY, ITEM_BY_ID, opposite, type StructureDef } from '@ironwild/shared';
import type { ClientStruct, ClientWorld } from '../game/world';
import { iconCanvas } from '../ui/icons';
import { OUTLINE, TS, arcPath, arrow, gearContext, shade } from './draw';
import type { Renderer } from './renderer';

type Anim = (dt: number, time: number) => void;

interface View {
  s: ClientStruct;
  root: Container;
  top: Container | null;
  anims: Anim[];
}

/** What a drawing function gets. `inner` is centred on the footprint and turned to face `rot`. */
interface DrawCtx {
  s: ClientStruct;
  def: StructureDef;
  inner: Container;
  g: Graphics;
  top: Container | null;
  anims: Anim[];
  world: ClientWorld | null;
  /** Rotation angle (radians) accumulated per gear group. */
  angle: (group: number) => number;
  w: number;
  h: number;
  preview: boolean;
}

const RPM_TO_RAD = (Math.PI * 2) / 60;
const VISUAL_SPEED = 1.4;

let beltTexture: Texture | null = null;
let shaftTexture: Texture | null = null;
const iconTextures = new Map<string, Texture>();

export function itemTexture(id: string): Texture {
  let t = iconTextures.get(id);
  if (!t) {
    t = Texture.from(iconCanvas(id));
    iconTextures.set(id, t);
  }
  return t;
}

function beltTex(): Texture {
  if (beltTexture) return beltTexture;
  const c = document.createElement('canvas');
  c.width = 32;
  c.height = 32;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3a3c42';
  ctx.fillRect(0, 0, 32, 32);
  ctx.strokeStyle = '#55585f';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(4, 24);
  ctx.lineTo(16, 12);
  ctx.lineTo(28, 24);
  ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.fillRect(0, 30, 32, 2);
  beltTexture = Texture.from(c);
  return beltTexture;
}

function shaftTex(): Texture {
  if (shaftTexture) return shaftTexture;
  const c = document.createElement('canvas');
  c.width = 24;
  c.height = 24;
  const ctx = c.getContext('2d')!;
  const grad = ctx.createLinearGradient(0, 0, 0, 24);
  grad.addColorStop(0, '#6f757d');
  grad.addColorStop(0.45, '#d5dade');
  grad.addColorStop(1, '#5a5f66');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 24, 24);
  ctx.strokeStyle = 'rgba(40,40,45,0.55)';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(-6, 24);
  ctx.lineTo(18, 0);
  ctx.moveTo(6, 24);
  ctx.lineTo(30, 0);
  ctx.stroke();
  shaftTexture = Texture.from(c);
  return shaftTexture;
}

export class StructureRenderer {
  private readonly views = new Map<number, View>();
  /** Rotation per structure and gear group, kept across rebuilds. */
  private readonly angles = new Map<number, number[]>();
  time = 0;

  constructor(
    private readonly r: Renderer,
    private readonly world: ClientWorld,
  ) {}

  add(s: ClientStruct): void {
    const layer = s.def.layer === 'floor' ? 'floors' : s.def.low || s.def.logistics === 'conveyor' ? 'ground' : 'objects';
    const view = this.build(s, false);
    view.root.position.set(s.x * TS, s.y * TS);
    this.r.chunk(s.chunk, layer).addChild(view.root);
    if (view.top) {
      view.top.position.set(s.x * TS, s.y * TS);
      this.r.chunk(s.chunk, 'canopy').addChild(view.top);
    }
    this.views.set(s.id, view);
  }

  remove(s: ClientStruct): void {
    const v = this.views.get(s.id);
    if (!v) return;
    v.root.destroy({ children: true });
    v.top?.destroy({ children: true });
    this.views.delete(s.id);
    if (!this.world.structs.has(s.id)) this.angles.delete(s.id);
  }

  changed(s: ClientStruct): void {
    this.remove(s);
    if (this.world.structs.has(s.id)) this.add(s);
  }

  /** A standalone drawing for the build ghost and icons. */
  preview(type: string, rot: number, def: StructureDef): Container {
    const fake: ClientStruct = { id: -1, type, def, x: 0, y: 0, rot, w: 0, h: 0, st: {}, spin: [], chunk: 0 };
    const [w, h] = rot & 1 ? [def.size[1], def.size[0]] : def.size;
    fake.w = w;
    fake.h = h;
    const v = this.build(fake, true);
    if (v.top) v.root.addChild(v.top);
    return v.root;
  }

  animate(dt: number): void {
    this.time += dt;
    for (const v of this.views.values()) {
      const spin = v.s.spin;
      if (spin.length > 0 && v.s.def.kinetic) {
        let a = this.angles.get(v.s.id);
        if (!a) this.angles.set(v.s.id, (a = spin.map(() => 0)));
        for (let i = 0; i < spin.length; i++) a[i] = ((a[i] ?? 0) + spin[i] * RPM_TO_RAD * VISUAL_SPEED * dt) % (Math.PI * 200);
      }
      for (const anim of v.anims) anim(dt, this.time);
    }
  }

  private build(s: ClientStruct, preview: boolean): View {
    const root = new Container();
    const inner = new Container();
    const w = s.w * TS;
    const h = s.h * TS;
    inner.position.set(w / 2, h / 2);
    inner.rotation = (s.rot * Math.PI) / 2;
    root.addChild(inner);
    const g = new Graphics();
    inner.addChild(g);
    const top = s.type === 'windmill' ? new Container() : null;
    const anims: Anim[] = [];
    const ctx: DrawCtx = {
      s,
      def: s.def,
      inner,
      g,
      top,
      anims,
      world: preview ? null : this.world,
      angle: (group) => this.angles.get(s.id)?.[group] ?? 0,
      w: s.rot & 1 ? h : w,
      h: s.rot & 1 ? w : h,
      preview,
    };
    const fn = DRAW[s.type] ?? drawGeneric;
    fn(ctx);
    return { s, root, top, anims };
  }
}

// ——— Helpers ———

/** Local half sizes in the rotated frame (the drawing always faces north). */
const half = (c: DrawCtx) => ({ hw: c.w / 2, hh: c.h / 2 });

function casing(g: Graphics, hw: number, hh: number, color: number, inset = 3): void {
  g.roundRect(-hw + inset, -hh + inset, (hw - inset) * 2, (hh - inset) * 2, 7)
    .fill(color)
    .stroke({ width: 4, color: OUTLINE });
  g.roundRect(-hw + inset + 5, -hh + inset + 5, (hw - inset - 5) * 2, (hh - inset - 5) * 2, 5).stroke({
    width: 2,
    color: shade(color, 1.25),
    alpha: 0.6,
  });
}

function bolts(g: Graphics, hw: number, hh: number): void {
  for (const [x, y] of [
    [-hw + 10, -hh + 10],
    [hw - 10, -hh + 10],
    [-hw + 10, hh - 10],
    [hw - 10, hh - 10],
  ])
    g.circle(x, y, 3).fill(0x3a3c40);
}

/** Output marker on the front (north) face. */
function outputMark(g: Graphics, hh: number): void {
  g.poly([-7, -hh + 1, 7, -hh + 1, 0, -hh - 7], true)
    .fill({ color: 0xf2c53d, alpha: 0.9 })
    .stroke({ width: 1.5, color: OUTLINE });
}

function spinner(c: DrawCtx, child: Container, group: number, sign = 1): void {
  c.inner.addChild(child);
  c.anims.push(() => {
    child.rotation = c.angle(group) * sign;
  });
}

/** Rotation sign alternates by tile parity so neighbouring gears look meshed. */
const parity = (s: ClientStruct) => ((s.x + s.y) % 2 === 0 ? 1 : -1);

function itemBadge(c: DrawCtx, x: number, y: number, size: number): void {
  const item = c.s.st.item;
  if (!item) return;
  const sp = new Sprite(itemTexture(item));
  sp.anchor.set(0.5);
  sp.width = sp.height = size;
  sp.position.set(x, y);
  c.inner.addChild(sp);
}

function neighbour(c: DrawCtx, dir: number): ClientStruct | undefined {
  if (!c.world) return undefined;
  const s = c.s;
  return c.world.structAt(s.x + DX[dir], s.y + DY[dir]);
}

// ——— Drawings ———

const DRAW: Record<string, (c: DrawCtx) => void> = {
  wood_wall(c) {
    const { hw, hh } = half(c);
    c.g
      .rect(-hw, -hh, hw * 2, hh * 2)
      .fill(0xa36f3c)
      .stroke({ width: 4, color: OUTLINE });
    for (let i = 1; i < 4; i++)
      c.g
        .moveTo(-hw + 3, -hh + i * 16)
        .lineTo(hw - 3, -hh + i * 16)
        .stroke({ width: 2, color: 0x7a5230 });
    c.g.circle(-hw + 9, -hh + 8, 2).fill(0x5a3a20);
    c.g.circle(hw - 9, hh - 8, 2).fill(0x5a3a20);
  },
  stone_wall(c) {
    const { hw, hh } = half(c);
    c.g
      .rect(-hw, -hh, hw * 2, hh * 2)
      .fill(0x9aa0a6)
      .stroke({ width: 4, color: OUTLINE });
    for (let row = 0; row < 3; row++) {
      const y = -hh + row * 21;
      c.g.moveTo(-hw, y).lineTo(hw, y).stroke({ width: 2, color: 0x70757b });
      for (let k = 0; k < 2; k++) {
        const x = -hw + (row % 2 ? 16 : 32) + k * 32;
        c.g
          .moveTo(x, y)
          .lineTo(x, y + 21)
          .stroke({ width: 2, color: 0x70757b });
      }
    }
  },
  wood_door(c) {
    const { hw, hh } = half(c);
    if (c.s.st.open) {
      c.g
        .rect(-hw, -hh, 8, hh * 2)
        .fill(0x7a5230)
        .stroke({ width: 3, color: OUTLINE });
      c.g
        .rect(hw - 8, -hh, 8, hh * 2)
        .fill(0x7a5230)
        .stroke({ width: 3, color: OUTLINE });
      c.g
        .rect(-hw + 8, -hh, 12, hh * 2 - 4)
        .fill(0xc08850)
        .stroke({ width: 3, color: OUTLINE });
      return;
    }
    c.g
      .rect(-hw, -hh, hw * 2, hh * 2)
      .fill(0xc08850)
      .stroke({ width: 4, color: OUTLINE });
    for (let i = 1; i < 4; i++)
      c.g
        .moveTo(-hw + i * 16, -hh + 4)
        .lineTo(-hw + i * 16, hh - 4)
        .stroke({ width: 2, color: 0x8a5a33 });
    c.g
      .circle(hw - 12, 0, 4)
      .fill(0xd9b23d)
      .stroke({ width: 2, color: OUTLINE });
  },
  wood_floor(c) {
    const { hw, hh } = half(c);
    c.g.rect(-hw, -hh, hw * 2, hh * 2).fill(0xc99a5b);
    for (let i = 0; i < 4; i++)
      c.g
        .moveTo(-hw, -hh + i * 16)
        .lineTo(hw, -hh + i * 16)
        .stroke({ width: 2, color: 0xa47a45, alpha: 0.8 });
  },
  stone_floor(c) {
    const { hw, hh } = half(c);
    c.g.rect(-hw, -hh, hw * 2, hh * 2).fill(0xa5a8ad);
    c.g.moveTo(0, -hh).lineTo(0, hh).moveTo(-hw, 0).lineTo(hw, 0).stroke({ width: 2, color: 0x85888d });
  },
  fence(c) {
    fenceLike(c, false);
  },
  pen_gate(c) {
    fenceLike(c, true);
  },
  torch(c) {
    c.g.roundRect(-4, -4, 8, 26, 3).fill(0x7a5230).stroke({ width: 2, color: OUTLINE });
    const flame = new Graphics();
    flame.circle(0, -6, 9).fill({ color: 0xf2a33d, alpha: 0.9 }).circle(0, -8, 5).fill(0xffe27a);
    c.inner.addChild(flame);
    c.anims.push((_dt, t) => {
      const f = 0.85 + Math.sin(t * 13 + c.s.id) * 0.1 + Math.sin(t * 7.3) * 0.07;
      flame.scale.set(f, f * 1.08);
    });
  },
  land_claim(c) {
    c.g.circle(0, 0, 10).fill(0x6a6f78).stroke({ width: 3, color: OUTLINE });
    c.g.roundRect(-3, -40, 6, 42, 2).fill(0x9a6b3f).stroke({ width: 2, color: OUTLINE });
    const flag = new Graphics();
    flag.poly([3, -40, 34, -34, 3, -24], true).fill(0xd9b23d).stroke({ width: 2, color: OUTLINE });
    c.inner.addChild(flag);
    c.inner.rotation = 0;
    c.anims.push((_dt, t) => {
      flag.skew.y = Math.sin(t * 3 + c.s.id) * 0.12;
    });
  },
  bed(c) {
    const { hw, hh } = half(c);
    c.g
      .roundRect(-hw + 8, -hh + 3, (hw - 8) * 2, (hh - 3) * 2, 6)
      .fill(0x7a5230)
      .stroke({ width: 3, color: OUTLINE });
    c.g
      .roundRect(-hw + 12, -hh + 8, (hw - 12) * 2, 14, 5)
      .fill(0xf0ebe0)
      .stroke({ width: 2, color: OUTLINE });
    c.g
      .roundRect(-hw + 11, -hh + 25, (hw - 11) * 2, hh * 2 - 31, 5)
      .fill(0xb85c5c)
      .stroke({ width: 2, color: OUTLINE });
  },
  chest(c) {
    const { hw, hh } = half(c);
    c.g
      .roundRect(-hw + 8, -hh + 12, (hw - 8) * 2, (hh - 12) * 2, 6)
      .fill(0xa36f3c)
      .stroke({ width: 4, color: OUTLINE });
    c.g
      .moveTo(-hw + 8, -hh + 26)
      .lineTo(hw - 8, -hh + 26)
      .stroke({ width: 3, color: 0x6b4a2a });
    c.g
      .rect(-5, -hh + 22, 10, 11)
      .fill(0xd9b23d)
      .stroke({ width: 2, color: OUTLINE });
  },
  shop_stand(c) {
    const { hw, hh } = half(c);
    c.g
      .roundRect(-hw + 4, -hh + 20, (hw - 4) * 2, hh * 2 - 24, 5)
      .fill(0x9a6b3f)
      .stroke({ width: 4, color: OUTLINE });
    for (let i = 0; i < 6; i++) c.g.rect(-hw + 2 + i * ((hw * 2 - 4) / 6), -hh + 2, (hw * 2 - 4) / 6, 22).fill(i % 2 ? 0xf3ecd9 : 0xc0503f);
    c.g.rect(-hw + 2, -hh + 2, hw * 2 - 4, 22).stroke({ width: 3, color: OUTLINE });
    if (c.s.st.label && ITEM_BY_ID.has(c.s.st.label)) {
      const sp = new Sprite(itemTexture(c.s.st.label));
      sp.anchor.set(0.5);
      sp.width = sp.height = 30;
      sp.position.set(0, 14);
      c.inner.addChild(sp);
    }
  },
  campfire(c) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      c.g
        .circle(Math.cos(a) * 22, Math.sin(a) * 22, 7)
        .fill(0x8f949a)
        .stroke({ width: 2, color: OUTLINE });
    }
    c.g.roundRect(-18, -4, 36, 8, 3).fill(0x7a5230).stroke({ width: 2, color: OUTLINE });
    c.g.roundRect(-4, -18, 8, 36, 3).fill(0x6b4a2a).stroke({ width: 2, color: OUTLINE });
    const flame = new Graphics();
    flame.circle(0, 0, 13).fill({ color: 0xf07a2a, alpha: 0.85 }).circle(0, -2, 8).fill(0xf2c53d).circle(0, -3, 4).fill(0xfff2b0);
    c.inner.addChild(flame);
    c.inner.rotation = 0;
    const on = !!c.s.st.on;
    c.anims.push((_dt, t) => {
      const f = (on ? 1 : 0.45) * (0.85 + Math.sin(t * 11 + c.s.id) * 0.1 + Math.sin(t * 17) * 0.05);
      flame.scale.set(f);
    });
  },
  workbench(c) {
    const { hw, hh } = half(c);
    c.g
      .roundRect(-hw + 3, -hh + 8, (hw - 3) * 2, (hh - 8) * 2, 5)
      .fill(0xb07a45)
      .stroke({ width: 4, color: OUTLINE });
    c.g
      .moveTo(-hw + 3, 0)
      .lineTo(hw - 3, 0)
      .stroke({ width: 2, color: 0x8a5a33 });
    c.g.roundRect(-18, -12, 22, 6, 2).fill(0x9aa0a6).stroke({ width: 2, color: OUTLINE });
    c.g.roundRect(4, 4, 6, 18, 2).fill(0x7a5230).stroke({ width: 2, color: OUTLINE });
    c.g.roundRect(0, 0, 14, 7, 2).fill(0x6a6f78).stroke({ width: 2, color: OUTLINE });
  },
  anvil(c) {
    c.g.roundRect(-14, 4, 28, 18, 3).fill(0x3a3c40).stroke({ width: 3, color: OUTLINE });
    c.g.poly([-26, -16, 18, -16, 28, -8, 18, 4, -18, 4, -26, -4], true).fill(0x55595f).stroke({ width: 4, color: OUTLINE });
    c.g.roundRect(-20, -13, 30, 5, 2).fill({ color: 0xffffff, alpha: 0.2 });
  },
  furnace(c) {
    const { hw, hh } = half(c);
    furnaceBody(c, hw, hh, 0x8a8f96);
  },
  oven(c) {
    const { hw, hh } = half(c);
    c.g
      .circle(0, 2, hw - 4)
      .fill(0xb5553a)
      .stroke({ width: 4, color: OUTLINE });
    for (let i = 0; i < 3; i++) arcPath(c.g, 0, 2, hw - 12 - i * 8, Math.PI, Math.PI * 2).stroke({ width: 2, color: 0x8a3a2a });
    mouth(c, hh, 16);
  },
  blast_furnace(c) {
    const { hw } = half(c);
    c.g
      .circle(0, 0, hw - 6)
      .fill(0x6a4a3a)
      .stroke({ width: 5, color: OUTLINE });
    for (let i = 0; i < 3; i++) c.g.circle(0, 0, hw - 16 - i * 14).stroke({ width: 3, color: i === 0 ? 0x4a4c50 : 0x8a5a45 });
    const glow = new Graphics();
    glow
      .circle(0, 0, hw * 0.35)
      .fill({ color: 0xf07a2a })
      .circle(0, 0, hw * 0.2)
      .fill(0xffd35a);
    glow.visible = !!c.s.st.on;
    c.inner.addChild(glow);
    c.anims.push((_dt, t) => {
      glow.alpha = 0.75 + Math.sin(t * 5) * 0.2;
    });
    outputMark(c.g, c.h / 2);
  },
  water_wheel(c) {
    const { hw } = half(c);
    // Axle runs east–west (the ports); the wheel stands across the river.
    c.g
      .roundRect(-hw - 6, -6, hw * 2 + 12, 12, 5)
      .fill(0x6f757d)
      .stroke({ width: 3, color: OUTLINE });
    const L = TS * 1.5;
    const W = 30;
    c.g
      .roundRect(-W / 2 - 4, -L / 2, W + 8, L, 8)
      .fill(0x6b4a2a)
      .stroke({ width: 4, color: OUTLINE });
    const paddles = new Graphics();
    c.inner.addChild(paddles);
    const foam = new Graphics();
    c.inner.addChild(foam);
    c.anims.push((_dt, t) => {
      const a = c.angle(0);
      paddles.clear();
      const n = 10;
      for (let i = 0; i < n; i++) {
        const phase = (((i / n + a / (Math.PI * 2)) % 1) + 1) % 1;
        const theta = phase * Math.PI * 2;
        const y = Math.cos(theta) * (L / 2 - 6);
        const upper = Math.sin(theta) > 0;
        paddles
          .roundRect(-W / 2, y - 4, W, 8, 2)
          .fill(upper ? 0xb08050 : 0x7a5230)
          .stroke({ width: 2, color: OUTLINE, alpha: upper ? 1 : 0.5 });
      }
      foam.clear();
      const spinning = Math.abs(c.s.spin[0] ?? 0) > 0.01;
      if (spinning) {
        for (let k = 0; k < 4; k++) {
          const fy = L / 2 + 4 + Math.sin(t * 6 + k) * 3;
          foam.circle(-W / 2 + k * (W / 3), fy, 5 + Math.sin(t * 9 + k * 2) * 2).fill({ color: 0xffffff, alpha: 0.6 });
          foam.circle(-W / 2 + k * (W / 3), -fy, 4 + Math.cos(t * 8 + k) * 2).fill({ color: 0xffffff, alpha: 0.45 });
        }
      }
    });
  },
  windmill(c) {
    const { hh } = half(c);
    c.g
      .circle(0, 0, TS * 0.42)
      .fill(0xd6c7a6)
      .stroke({ width: 4, color: OUTLINE });
    c.g.circle(0, 0, TS * 0.3).stroke({ width: 2, color: 0xa89878 });
    c.g
      .roundRect(-6, hh - 14, 12, 14, 3)
      .fill(0x6f757d)
      .stroke({ width: 2, color: OUTLINE });
    const blades = new Container();
    const bg = new Graphics();
    const R = TS * 1.7;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      const px = -sin;
      const py = cos;
      const x0 = cos * 14;
      const y0 = sin * 14;
      const x1 = cos * R;
      const y1 = sin * R;
      bg.poly([x0 + px * 4, y0 + py * 4, x1 + px * 4, y1 + py * 4, x1 + px * 22, y1 + py * 22, x0 + px * 16, y0 + py * 16], true)
        .fill({ color: 0xf3ecd9, alpha: 0.85 })
        .stroke({ width: 3, color: OUTLINE });
      for (let k = 1; k < 5; k++) {
        const f = k / 5;
        bg.moveTo(x0 + (x1 - x0) * f + px * 4, y0 + (y1 - y0) * f + py * 4)
          .lineTo(x0 + (x1 - x0) * f + px * 20, y0 + (y1 - y0) * f + py * 20)
          .stroke({ width: 2, color: 0x9a8a6a });
      }
      bg.moveTo(x0, y0).lineTo(x1, y1).stroke({ width: 5, color: 0x7a5230 });
    }
    bg.circle(0, 0, 12).fill(0x7a5230).stroke({ width: 3, color: OUTLINE });
    blades.addChild(bg);
    const topInner = new Container();
    topInner.position.set(c.s.w * TS * 0.5, c.s.h * TS * 0.5);
    topInner.addChild(blades);
    (c.top ?? c.inner).addChild(c.top ? topInner : blades);
    c.anims.push(() => {
      blades.rotation = c.angle(0);
    });
  },
  hand_crank(c) {
    c.g.roundRect(-18, -18, 36, 36, 6).fill(0x8a6a45).stroke({ width: 4, color: OUTLINE });
    c.g
      .roundRect(-TS / 2 - 2, -5, TS + 4, 10, 4)
      .fill(0x6f757d)
      .stroke({ width: 2, color: OUTLINE });
    const arm = new Graphics();
    arm.roundRect(-4, -4, 26, 8, 4).fill(0x9a6b3f).stroke({ width: 2, color: OUTLINE });
    arm.circle(22, 0, 6).fill(0xc9a046).stroke({ width: 2, color: OUTLINE });
    arm.circle(0, 0, 6).fill(0x55595f).stroke({ width: 2, color: OUTLINE });
    spinner(c, arm, 0);
    if (c.s.st.crank) c.g.circle(0, 0, 24).stroke({ width: 2, color: 0xf2c53d, alpha: 0.6 });
  },
  steam_engine(c) {
    const { hw, hh } = half(c);
    c.g
      .roundRect(-hw + 6, -hh + 30, hw * 2 - 12, hh * 2 - 36, 16)
      .fill(0x8a3a2a)
      .stroke({ width: 5, color: OUTLINE });
    for (let i = 0; i < 4; i++) c.g.rect(-hw + 20 + i * 24, -hh + 30, 6, hh * 2 - 36).fill(0x55595f);
    c.g
      .circle(hw - 26, hh - 26, 12)
      .fill(0x3a3c40)
      .stroke({ width: 3, color: OUTLINE });
    const fly = new Graphics(gearContext(26, 14, 0x55595f, 6));
    fly.position.set(-hw + 34, -hh + 26);
    const flyC = new Container();
    flyC.addChild(fly);
    c.inner.addChild(flyC);
    const rod = new Graphics();
    c.inner.addChild(rod);
    c.anims.push(() => {
      const a = c.angle(0);
      fly.rotation = a;
      rod.clear();
      const px = -hw + 34 + Math.cos(a) * 16;
      const py = -hh + 26 + Math.sin(a) * 16;
      rod
        .moveTo(px, py)
        .lineTo(hw - 30, -hh + 26)
        .stroke({ width: 5, color: 0xb0b5bd })
        .circle(px, py, 4)
        .fill(0xd9b23d);
    });
    c.g
      .roundRect(hw - 40, -hh + 16, 24, 20, 4)
      .fill(0x6a6f78)
      .stroke({ width: 3, color: OUTLINE });
  },
  shaft(c) {
    const { hw } = half(c);
    const rod = new TilingSprite({ texture: shaftTex(), width: hw * 2 + 2, height: 16 });
    rod.anchor.set(0.5);
    c.inner.addChild(rod);
    c.g.roundRect(-hw - 1, -8, hw * 2 + 2, 16, 4).stroke({ width: 3, color: OUTLINE });
    const caps = new Graphics();
    caps.roundRect(-hw, -11, 7, 22, 2).fill(0x8a6a45).stroke({ width: 2, color: OUTLINE });
    caps
      .roundRect(hw - 7, -11, 7, 22, 2)
      .fill(0x8a6a45)
      .stroke({ width: 2, color: OUTLINE });
    c.inner.addChild(caps);
    c.anims.push(() => {
      rod.tilePosition.x = (c.angle(0) / (Math.PI * 2)) * 24;
    });
  },
  gearbox(c) {
    const { hw, hh } = half(c);
    stubs(c, [0, 1, 2, 3]);
    casing(c.g, hw, hh, 0x8e7a55, 5);
    bolts(c.g, hw, hh);
    const gear = new Graphics(gearContext(20, 10, 0xb0b5bd));
    spinner(c, gear, 0, parity(c.s));
  },
  speed_gearbox(c) {
    const { hw, hh } = half(c);
    stubs(c, [0, 1, 2, 3]);
    casing(c.g, hw, hh, 0xc9973a, 5);
    bolts(c.g, hw, hh);
    const big = new Graphics(gearContext(15, 12, 0xb0b5bd));
    big.position.set(0, 7);
    const bigC = new Container();
    bigC.addChild(big);
    c.inner.addChild(bigC);
    const small = new Graphics(gearContext(8, 6, 0xe0e4e8));
    const smallC = new Container();
    smallC.position.set(0, -15);
    smallC.addChild(small);
    c.inner.addChild(smallC);
    c.anims.push(() => {
      big.rotation = c.angle(0);
      small.rotation = -c.angle(1);
    });
    c.g.poly([-6, -hh + 9, 6, -hh + 9, 0, -hh + 3], true).fill(0xf3ecd9);
  },
  crusher(c) {
    const { hw, hh } = half(c);
    casing(c.g, hw, hh, 0x7d8189);
    c.g.roundRect(-hw + 10, -hh + 12, hw * 2 - 20, hh * 2 - 22, 4).fill(0x3a3c40);
    const left = new Graphics(gearContext(11, 9, 0x9aa0a6, 3));
    left.position.set(-11, 2);
    const right = new Graphics(gearContext(11, 9, 0x9aa0a6, 3));
    right.position.set(11, 2);
    c.inner.addChild(left, right);
    c.anims.push(() => {
      left.rotation = c.angle(0) * 2;
      right.rotation = -c.angle(0) * 2;
    });
    itemBadge(c, 0, -hh + 10, 16);
    outputMark(c.g, hh);
    bolts(c.g, hw, hh);
  },
  washer(c) {
    const { hw, hh } = half(c);
    c.g
      .circle(0, 0, hw - 4)
      .fill(0x8a6a45)
      .stroke({ width: 4, color: OUTLINE });
    c.g.circle(0, 0, hw - 11).fill(0x4f8fb8);
    const paddle = new Graphics();
    paddle.roundRect(-18, -3, 36, 6, 2).fill(0xd9dde2).roundRect(-3, -18, 6, 36, 2).fill(0xd9dde2).circle(0, 0, 5).fill(0x6a6f78);
    const bubbles = new Graphics();
    c.inner.addChild(bubbles);
    spinner(c, paddle, 0, parity(c.s));
    c.anims.push((_dt, t) => {
      bubbles.clear();
      if (!c.s.st.on) return;
      for (let i = 0; i < 5; i++) {
        const a = t * 2 + i * 1.3;
        bubbles.circle(Math.cos(a) * 14, Math.sin(a * 1.3) * 14, 2.5).fill({ color: 0xffffff, alpha: 0.7 });
      }
    });
    outputMark(c.g, hh);
  },
  press(c) {
    const { hw, hh } = half(c);
    casing(c.g, hw, hh, 0x6d7482);
    c.g.roundRect(-14, -14, 28, 28, 3).fill(0x3a3c40);
    itemBadge(c, 0, 0, 22);
    const head = new Graphics();
    head.roundRect(-17, -17, 34, 34, 4).fill(0x9aa0a6).stroke({ width: 3, color: OUTLINE });
    head.roundRect(-5, -5, 10, 10, 2).fill(0x55595f);
    c.inner.addChild(head);
    for (const [x, y] of [
      [-hw + 9, -hh + 9],
      [hw - 9, -hh + 9],
      [-hw + 9, hh - 9],
      [hw - 9, hh - 9],
    ])
      c.g.circle(x, y, 5).fill(0xb0b5bd).stroke({ width: 2, color: OUTLINE });
    c.anims.push(() => {
      // One stamp per quarter turn of the drive.
      const phase = ((c.angle(0) * 2) / Math.PI) % 1;
      const lift = c.s.st.on ? Math.abs(Math.sin(phase * Math.PI)) : 1;
      head.scale.set(0.82 + lift * 0.22);
      head.alpha = 0.8 + lift * 0.2;
    });
    outputMark(c.g, hh);
  },
  millstone(c) {
    const { hw, hh } = half(c);
    c.g
      .roundRect(-hw + 3, -hh + 3, hw * 2 - 6, hh * 2 - 6, 8)
      .fill(0x8a6a45)
      .stroke({ width: 4, color: OUTLINE });
    const stone = new Graphics();
    stone
      .circle(0, 0, hw - 8)
      .fill(0xa8a196)
      .stroke({ width: 4, color: OUTLINE });
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      stone
        .moveTo(Math.cos(a) * 7, Math.sin(a) * 7)
        .lineTo(Math.cos(a + 0.4) * (hw - 11), Math.sin(a + 0.4) * (hw - 11))
        .stroke({ width: 2, color: 0x7f786c });
    }
    stone.circle(0, 0, 6).fill(0x55595f).stroke({ width: 2, color: OUTLINE });
    spinner(c, stone, 0, parity(c.s));
    outputMark(c.g, hh);
  },
  saw(c) {
    const { hw, hh } = half(c);
    c.g
      .roundRect(-hw + 4, -hh + 4, hw * 2 - 8, hh * 2 - 8, 6)
      .fill(0x9a6b3f)
      .stroke({ width: 4, color: OUTLINE });
    c.g
      .moveTo(-hw + 4, 0)
      .lineTo(hw - 4, 0)
      .stroke({ width: 2, color: 0x7a5230 });
    itemBadge(c, 0, 14, 18);
    const blade = new Graphics();
    blade.poly(sawPoints(17, 18), true).fill(0xd9dde2).stroke({ width: 2.5, color: OUTLINE });
    blade.circle(0, 0, 5).fill(0x55595f);
    blade.position.set(0, -4);
    const bladeC = new Container();
    bladeC.addChild(blade);
    c.inner.addChild(bladeC);
    c.anims.push(() => {
      blade.rotation = c.angle(0) * 3;
    });
    outputMark(c.g, hh);
  },
  assembler(c) {
    const { hw, hh } = half(c);
    casing(c.g, hw, hh, 0x4a6a8a);
    c.g.circle(0, 0, 14).fill(0x2f4a66).stroke({ width: 3, color: OUTLINE });
    itemBadge(c, 0, 12, 16);
    const arm = new Graphics();
    arm.roundRect(-3, -3, 22, 6, 3).fill(0xe0b84c).stroke({ width: 2, color: OUTLINE });
    arm.poly([19, -7, 25, 0, 19, 7], true).fill(0xb0b5bd).stroke({ width: 2, color: OUTLINE });
    arm.circle(0, 0, 5).fill(0x55595f);
    c.inner.addChild(arm);
    c.anims.push((_dt, t) => {
      arm.rotation = c.s.st.on ? Math.sin(t * 2.2 + c.s.id) * 1.4 : arm.rotation;
    });
    const light = new Graphics();
    light.circle(hw - 12, -hh + 12, 4).fill(0x6fd06f);
    light.visible = !!c.s.st.on;
    c.inner.addChild(light);
    outputMark(c.g, hh);
  },
  conveyor(c) {
    beltBase(c);
  },
  splitter(c) {
    beltBase(c);
    const { hh } = half(c);
    c.inner.addChild(
      new Graphics()
        .poly([0, -8, 16, 12, -16, 12], true)
        .fill(0x3f6f9a)
        .stroke({ width: 3, color: OUTLINE })
        .poly([-hh + 6, -4, -hh + 14, 0, -hh + 6, 4], true)
        .fill(0xf3ecd9)
        .poly([hh - 6, -4, hh - 14, 0, hh - 6, 4], true)
        .fill(0xf3ecd9),
    );
  },
  filter(c) {
    beltBase(c);
    c.inner.addChild(new Graphics().roundRect(-15, -15, 30, 30, 6).fill(0x7a3f9a).stroke({ width: 3, color: OUTLINE }));
    if (c.s.st.filter && ITEM_BY_ID.has(c.s.st.filter)) {
      const sp = new Sprite(itemTexture(c.s.st.filter));
      sp.anchor.set(0.5);
      sp.width = sp.height = 22;
      sp.rotation = (-c.s.rot * Math.PI) / 2;
      c.inner.addChild(sp);
    } else c.inner.addChild(new Graphics().circle(0, 0, 6).fill(0xd8c0e8));
  },
  hopper(c) {
    const { hw, hh } = half(c);
    c.g
      .poly([-hw + 3, -hh + 3, hw - 3, -hh + 3, hw - 12, hh - 12, -hw + 12, hh - 12], true)
      .fill(0x6a6f78)
      .stroke({ width: 4, color: OUTLINE });
    c.g.roundRect(-12, -10, 24, 20, 3).fill(0x3a3c40);
    const a = arrow(new Graphics(), 22, 7, 0xf2c53d, 0.9) as Graphics;
    a.rotation = -Math.PI / 2;
    c.inner.addChild(a);
    outputMark(c.g, hh);
  },
  storage_crate(c) {
    crate(c, 0x8a6a45, 0x6b4a2a);
  },
  shipping_crate(c) {
    crate(c, 0x3f7a4f, 0x2b5a38);
    c.g.poly([-10, -2, 10, -2, 6, 8, -6, 8], true).fill(0xf3ecd9);
    c.g.rect(-2, -14, 4, 12).fill(0xf3ecd9);
  },
  crop(c) {
    const crop = c.s.st.crop ? CROP_BY_ID.get(c.s.st.crop) : undefined;
    const stage = c.s.st.stage ?? 0;
    const color = crop?.color ?? 0xe0b84c;
    c.inner.rotation = 0;
    for (let i = 0; i < 4; i++) {
      const x = -16 + (i % 2) * 32;
      const y = -14 + Math.floor(i / 2) * 28;
      if (stage === 0) c.g.circle(x, y, 3).fill(0x5a3a20);
      else {
        const size = 4 + stage * 3.2;
        for (let k = 0; k < 4; k++) {
          const a = (k / 4) * Math.PI * 2 + i;
          c.g
            .ellipse(x + Math.cos(a) * size * 0.5, y + Math.sin(a) * size * 0.5, size * 0.55, size * 0.3)
            .fill(stage >= 4 ? 0x4f8f3a : 0x6fb050);
        }
        if (stage >= 4) c.g.circle(x, y, 5.5).fill(color).stroke({ width: 1.5, color: OUTLINE });
      }
    }
  },
};

function drawGeneric(c: DrawCtx): void {
  const { hw, hh } = half(c);
  casing(c.g, hw, hh, 0x888888);
}

function stubs(c: DrawCtx, faces: number[]): void {
  for (const f of faces) {
    const a = (f * Math.PI) / 2 - Math.PI / 2;
    c.g
      .roundRect(Math.cos(a) * 26 - 7, Math.sin(a) * 26 - 7, 14, 14, 3)
      .fill(0x6f757d)
      .stroke({ width: 2, color: OUTLINE });
  }
}

function sawPoints(r: number, teeth: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2;
    const a1 = ((i + 0.6) / teeth) * Math.PI * 2;
    pts.push(Math.cos(a0) * r, Math.sin(a0) * r, Math.cos(a1) * (r + 5), Math.sin(a1) * (r + 5));
  }
  return pts;
}

function mouth(c: DrawCtx, hh: number, width: number): void {
  c.g
    .roundRect(-width / 2, -hh + 4, width, 14, 5)
    .fill(0x2a1a14)
    .stroke({ width: 2, color: OUTLINE });
  const glow = new Graphics();
  glow
    .roundRect(-width / 2 + 3, -hh + 6, width - 6, 10, 4)
    .fill(0xf07a2a)
    .roundRect(-width / 2 + 6, -hh + 8, width - 12, 5, 2)
    .fill(0xffd35a);
  glow.visible = !!c.s.st.on;
  c.inner.addChild(glow);
  c.anims.push((_dt, t) => {
    glow.alpha = 0.7 + Math.sin(t * 9 + c.s.id) * 0.2;
  });
}

function furnaceBody(c: DrawCtx, hw: number, hh: number, color: number): void {
  c.g
    .roundRect(-hw + 3, -hh + 3, hw * 2 - 6, hh * 2 - 6, 12)
    .fill(color)
    .stroke({ width: 4, color: OUTLINE });
  for (let row = 0; row < 3; row++)
    c.g
      .moveTo(-hw + 6, -hh + 20 + row * 14)
      .lineTo(hw - 6, -hh + 20 + row * 14)
      .stroke({ width: 2, color: shade(color, 0.8) });
  c.g.circle(0, 6, 11).fill(0x3a3c40).stroke({ width: 3, color: OUTLINE });
  mouth(c, hh, 26);
  itemBadge(c, 0, 6, 16);
}

function crate(c: DrawCtx, color: number, dark: number): void {
  const { hw, hh } = half(c);
  c.inner.rotation = 0;
  c.g
    .roundRect(-hw + 4, -hh + 4, hw * 2 - 8, hh * 2 - 8, 4)
    .fill(color)
    .stroke({ width: 4, color: OUTLINE });
  c.g
    .moveTo(-hw + 6, -hh + 6)
    .lineTo(hw - 6, hh - 6)
    .moveTo(hw - 6, -hh + 6)
    .lineTo(-hw + 6, hh - 6)
    .stroke({ width: 4, color: dark });
  c.g.roundRect(-hw + 4, -hh + 4, hw * 2 - 8, hh * 2 - 8, 4).stroke({ width: 6, color: dark });
  const fill = c.s.st.fill ?? 0;
  if (fill > 0) {
    c.g.roundRect(-hw + 8, hh - 12, (hw * 2 - 16) * fill, 5, 2).fill(fill > 0.95 ? 0xe8645a : 0x8fd45a);
  }
}

function fenceLike(c: DrawCtx, gate: boolean): void {
  c.inner.rotation = 0;
  const connects = (d: number) => {
    const n = neighbour(c, d);
    return !!n && (n.type === 'fence' || n.type === 'pen_gate' || n.type === 'wood_wall' || n.type === 'stone_wall');
  };
  const color = gate ? 0xc99a5b : 0x9a6b3f;
  for (let d = 0; d < 4; d++) {
    if (!connects(d) && !c.preview) continue;
    if (c.preview && d % 2 === 1) continue;
    const ex = DX[d] * 32;
    const ey = DY[d] * 32;
    c.g.moveTo(0, 0).lineTo(ex, ey).stroke({ width: 9, color: OUTLINE, cap: 'round' });
    c.g.moveTo(0, 0).lineTo(ex, ey).stroke({ width: 5, color, cap: 'round' });
  }
  c.g
    .circle(0, 0, gate ? 7 : 8)
    .fill(shade(color, 0.85))
    .stroke({ width: 3, color: OUTLINE });
  if (gate) c.g.roundRect(-14, -4, 28, 8, 3).stroke({ width: 3, color: 0xf3ecd9, alpha: 0.7 });
}

/** Conveyor belt, straight or curved when fed from one side only. */
function beltBase(c: DrawCtx): void {
  const { hw, hh } = half(c);
  const s = c.s;
  // Is it fed from behind, or only from one side?
  const feeds = (dir: number) => {
    const n = neighbour(c, dir);
    if (!n) return false;
    const outputs = !!n.def.logistics || !!n.def.machine;
    return outputs && n.rot === opposite(dir);
  };
  const back = opposite(s.rot);
  const left = (s.rot + 3) % 4;
  const right = (s.rot + 1) % 4;
  let curve = 0;
  if (s.def.logistics === 'conveyor' && !c.preview && !feeds(back)) {
    if (feeds(left) && !feeds(right)) curve = -1;
    else if (feeds(right) && !feeds(left)) curve = 1;
  }
  const speed = () => s.spin[0] ?? 0;
  if (curve === 0) {
    const belt = new TilingSprite({ texture: beltTex(), width: hw * 2 - 16, height: hh * 2 });
    belt.anchor.set(0.5);
    c.inner.addChild(belt);
    const rails = new Graphics();
    rails
      .roundRect(-hw + 2, -hh, 7, hh * 2, 3)
      .fill(0x8a8f96)
      .stroke({ width: 2, color: OUTLINE });
    rails
      .roundRect(hw - 9, -hh, 7, hh * 2, 3)
      .fill(0x8a8f96)
      .stroke({ width: 2, color: OUTLINE });
    c.inner.addChild(rails);
    const dot = new Graphics().circle(hw - 12, hh - 12, 3).fill({ color: 0xe8645a, alpha: 0.8 });
    c.inner.addChild(dot);
    c.anims.push((dt) => {
      belt.tilePosition.y -= speed() * TS * dt;
      dot.visible = !c.preview && speed() === 0;
    });
    return;
  }
  // Curved: a quarter ring around the corner shared by the entry side and the front.
  const cornerX = curve * hw;
  const cornerY = -hh;
  const r0 = 8;
  const r1 = hw * 2 - 8;
  const a0 = curve < 0 ? 0 : Math.PI / 2;
  const a1 = a0 + Math.PI / 2;
  const band = new Graphics();
  band.moveTo(cornerX + Math.cos(a0) * r1, cornerY + Math.sin(a0) * r1);
  band.arc(cornerX, cornerY, r1, a0, a1);
  band.lineTo(cornerX + Math.cos(a1) * r0, cornerY + Math.sin(a1) * r0);
  band.arc(cornerX, cornerY, r0, a1, a0, true);
  band.closePath().fill(0x3a3c42).stroke({ width: 3, color: OUTLINE });
  c.inner.addChild(band);
  const marks = new Graphics();
  c.inner.addChild(marks);
  let phase = 0;
  c.anims.push((dt) => {
    phase = (phase + speed() * dt) % 1;
    marks.clear();
    const rr = (r0 + r1) / 2;
    for (let k = 0; k < 3; k++) {
      const f = (k / 3 + phase) % 1;
      // Left feed: from the west edge (π/2) to the north edge (0); right feed: east (π/2) to north (π).
      const a = curve < 0 ? (Math.PI / 2) * (1 - f) : Math.PI / 2 + (Math.PI / 2) * f;
      marks.circle(cornerX + Math.cos(a) * rr, cornerY + Math.sin(a) * rr, 4).fill(0x6a6d74);
    }
  });
}
