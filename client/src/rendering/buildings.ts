// Buildings: floors, walls, doors, windows, furniture and roofs. Roofs cover the interior while the
// player is outside and fade out when they step in (design plan §84); doors swing and windows
// shatter according to the replicated world state.

import { Container, Graphics, TilingSprite, type Texture } from 'pixi.js';
import { splitWall, type BuildingDef, type CompiledWorld, type ContentRegistry, type DoorDef, type WindowDef } from '@tuff/shared';
import { drawBoards } from './barricades';
import { propContext, shade } from './prop-styles';
import { floorTexture, roofTexture } from './textures';

export interface BuildingLayers {
  floors: Container;
  low: Container;
  walls: Container;
  tall: Container;
  roofs: Container;
}

interface DoorView {
  def: DoorDef;
  slab: Graphics;
  boards: Graphics;
  closedRotation: number;
  openRotation: number;
  current: number;
  target: number;
  hidden: boolean;
}

interface WindowView {
  def: WindowDef;
  g: Graphics;
  boards: Graphics;
  broken: boolean | null;
  boardCount: number;
}

interface BuildingView {
  def: BuildingDef;
  containers: Container[];
  roof: Container;
  roofAlpha: number;
  doors: Map<string, DoorView>;
  windows: Map<string, WindowView>;
  searched: Map<string, Graphics>;
  /** Furniture graphics by prop id, hidden when the furniture is carried away. */
  furniture: Map<string, Graphics[]>;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const FLOOR_TILE_METERS = 2.5;

function hex(c: string): number {
  return parseInt(c.replace('#', ''), 16);
}

export class BuildingRenderer {
  private readonly views = new Map<string, BuildingView>();
  private readonly objectToBuilding = new Map<string, string>();

  constructor(
    private readonly layers: BuildingLayers,
    private readonly content: ContentRegistry,
    private readonly compiled: CompiledWorld,
  ) {}

  private place(c: Container, b: BuildingDef): Container {
    c.position.set(b.x, b.y);
    c.rotation = b.rot;
    c.pivot.set(b.w / 2, b.h / 2);
    return c;
  }

  add(b: BuildingDef): void {
    if (this.views.has(b.id)) return;
    const floors = this.place(new Container(), b);
    const low = this.place(new Container(), b);
    const walls = this.place(new Container(), b);
    const tall = this.place(new Container(), b);
    const roof = this.place(new Container(), b);

    // Foundation slab slightly larger than the footprint.
    const slab = new Graphics();
    slab.rect(-0.25, -0.25, b.w + 0.5, b.h + 0.5).fill(0x3a3936);
    floors.addChild(slab);
    for (const room of b.rooms) {
      const tex = floorTexture(room.floor);
      const t = new TilingSprite({ texture: tex, width: room.w, height: room.h });
      t.position.set(room.x, room.y);
      t.tileScale.set(FLOOR_TILE_METERS / tex.width);
      t.tilePosition.set((-room.x / FLOOR_TILE_METERS) * tex.width, (-room.y / FLOOR_TILE_METERS) * tex.width);
      floors.addChild(t);
      // Grime in corners: a soft darker border.
      const grime = new Graphics();
      grime.rect(room.x, room.y, room.w, room.h).stroke({ color: 0x000000, width: 0.35, alpha: 0.18 });
      floors.addChild(grime);
    }

    // Furniture.
    const searched = new Map<string, Graphics>();
    const furniture = new Map<string, Graphics[]>();
    for (const p of b.props) {
      const def = this.content.findProp(p.type);
      if (!def) continue;
      const w = p.w ?? def.w ?? 0.8;
      const h = p.h ?? def.h ?? 0.8;
      const g = new Graphics(propContext(def.style, w, h, def.r ?? 0.3, hex(def.color ?? '#777777'), p.variant ?? hashId(p.id)));
      g.position.set(p.x, p.y);
      g.rotation = p.rot;
      if (def.layer === 'ground') floors.addChild(g);
      else if (def.layer === 'tall') tall.addChild(g);
      else low.addChild(g);
      if (def.movable) {
        furniture.set(p.id, [g]);
        this.objectToBuilding.set(p.id, b.id);
      }
      if (def.container) {
        // Opened containers get a subtle mark so players can tell what they have searched.
        const mark = new Graphics();
        mark.circle(0, 0, 0.1).fill({ color: 0xd8d4c4, alpha: 0.5 });
        mark.position.set(p.x, p.y);
        mark.visible = false;
        (def.layer === 'tall' ? tall : low).addChild(mark);
        searched.set(p.id, mark);
        furniture.get(p.id)?.push(mark);
        this.objectToBuilding.set(p.id, b.id);
      }
    }

    // Walls split around doorways and windows.
    const wallG = new Graphics();
    const openings = [...b.doors, ...b.windows];
    const extColor = hex(b.exterior.color);
    for (const wall of b.walls) {
      for (const seg of splitWall(wall.x1, wall.y1, wall.x2, wall.y2, wall.t, openings)) {
        const dx = seg.x2 - seg.x1;
        const dy = seg.y2 - seg.y1;
        const len = Math.hypot(dx, dy);
        const nx = -dy / len;
        const ny = dx / len;
        const ht = wall.t / 2;
        const quad = [
          seg.x1 + nx * ht,
          seg.y1 + ny * ht,
          seg.x2 + nx * ht,
          seg.y2 + ny * ht,
          seg.x2 - nx * ht,
          seg.y2 - ny * ht,
          seg.x1 - nx * ht,
          seg.y1 - ny * ht,
        ];
        wallG.poly(quad).fill(wall.exterior ? shade(extColor, 0.42) : 0x5e5a52);
        if (wall.exterior) {
          const inner = [
            seg.x1 + nx * ht * 0.35,
            seg.y1 + ny * ht * 0.35,
            seg.x2 + nx * ht * 0.35,
            seg.y2 + ny * ht * 0.35,
            seg.x2 - nx * ht * 0.35,
            seg.y2 - ny * ht * 0.35,
            seg.x1 - nx * ht * 0.35,
            seg.y1 - ny * ht * 0.35,
          ];
          wallG.poly(inner).fill(shade(extColor, 0.7));
        } else {
          wallG.poly(quad).stroke({ color: 0x2a2826, width: 0.025, alpha: 0.8 });
        }
      }
    }
    walls.addChild(wallG);

    const view: BuildingView = {
      def: b,
      containers: [floors, low, walls, tall, roof],
      roof,
      roofAlpha: 1,
      doors: new Map(),
      windows: new Map(),
      searched,
      furniture,
      bounds: this.compiled.buildings.get(b.id)?.bounds ?? { minX: b.x - b.w, minY: b.y - b.h, maxX: b.x + b.w, maxY: b.y + b.h },
    };

    for (const d of b.doors) {
      const slab2 = new Graphics();
      drawDoor(slab2, d);
      const hingeX = d.x - (Math.cos(d.angle) * d.w * d.hinge) / 2;
      const hingeY = d.y - (Math.sin(d.angle) * d.w * d.hinge) / 2;
      slab2.position.set(hingeX, hingeY);
      const closedRotation = d.angle + (d.hinge === 1 ? 0 : Math.PI);
      const openRotation = closedRotation + (Math.PI / 2) * d.swing * d.hinge * 0.95;
      const boards = new Graphics();
      boards.position.set(d.x, d.y);
      boards.rotation = d.angle;
      const dv: DoorView = {
        def: d,
        slab: slab2,
        boards,
        closedRotation,
        openRotation,
        current: closedRotation,
        target: closedRotation,
        hidden: false,
      };
      slab2.rotation = closedRotation;
      walls.addChild(slab2);
      // Door frame posts.
      const posts = new Graphics();
      for (const s of [-1, 1]) {
        posts.circle(d.x + (Math.cos(d.angle) * d.w * s) / 2, d.y + (Math.sin(d.angle) * d.w * s) / 2, 0.08).fill(0x2a2622);
      }
      walls.addChild(posts, boards);
      view.doors.set(d.id, dv);
      this.objectToBuilding.set(d.id, b.id);
    }
    for (const w of b.windows) {
      const g = new Graphics();
      g.position.set(w.x, w.y);
      g.rotation = w.angle;
      const boards = new Graphics();
      boards.position.set(w.x, w.y);
      boards.rotation = w.angle;
      walls.addChild(g, boards);
      view.windows.set(w.id, { def: w, g, boards, broken: null, boardCount: -1 });
      this.objectToBuilding.set(w.id, b.id);
    }

    this.buildRoof(roof, b);
    this.layers.floors.addChild(floors);
    this.layers.low.addChild(low);
    this.layers.walls.addChild(walls);
    this.layers.tall.addChild(tall);
    this.layers.roofs.addChild(roof);
    this.views.set(b.id, view);
    for (const id of [...view.doors.keys(), ...view.windows.keys(), ...view.searched.keys(), ...view.furniture.keys()]) {
      this.objectChanged(id, true);
    }
  }

  private buildRoof(c: Container, b: BuildingDef): void {
    const over = 0.35;
    const x0 = -over;
    const y0 = -over;
    const w = b.w + over * 2;
    const h = b.h + over * 2;
    const shadow = new Graphics();
    shadow.rect(x0 + 0.5, y0 + 0.6, w, h).fill({ color: 0x000000, alpha: 0.28 });
    c.addChild(shadow);
    const flat = b.roof.style === 'flat';
    const tex: Texture = roofTexture(flat ? 'flat' : 'shingle', b.roof.color);
    const base = new TilingSprite({ texture: tex, width: w, height: h });
    base.position.set(x0, y0);
    base.tileScale.set(3 / tex.width);
    c.addChild(base);
    const g = new Graphics();
    if (flat) {
      g.rect(x0, y0, w, h).stroke({ color: shade(hex(b.roof.color), 0.6), width: 0.5, alignment: 1 });
      g.rect(x0 + 0.25, y0 + 0.25, w - 0.5, h - 0.5).stroke({ color: 0x000000, width: 0.12, alpha: 0.25 });
      // HVAC units and vents.
      const units = Math.max(1, Math.floor((b.w * b.h) / 250));
      for (let i = 0; i < units; i++) {
        const ux = b.w * (0.25 + ((i * 0.37) % 0.5));
        const uy = b.h * (0.3 + ((i * 0.53) % 0.4));
        g.rect(ux + 0.15, uy + 0.2, 1.8, 1.3).fill({ color: 0x000000, alpha: 0.3 });
        g.rect(ux, uy, 1.8, 1.3).fill(0x8a8c88);
        g.circle(ux + 0.9, uy + 0.65, 0.45).fill(0x5a5c58);
        g.circle(ux + 0.9, uy + 0.65, 0.35).stroke({ color: 0x3a3c3a, width: 0.05 });
      }
      for (let i = 0; i < 3; i++) g.circle(b.w * (0.15 + i * 0.3), b.h * 0.8, 0.18).fill(0x3a3a38);
    } else if (b.roof.style === 'gable') {
      // Ridge along the longer axis; the far slope is in shade.
      if (b.w >= b.h) {
        g.rect(x0, y0, w, h / 2).fill({ color: 0x000000, alpha: 0.22 });
        g.rect(x0, b.h / 2 - 0.08, w, 0.16).fill({ color: shade(hex(b.roof.color), 1.35), alpha: 0.9 });
      } else {
        g.rect(x0, y0, w / 2, h).fill({ color: 0x000000, alpha: 0.22 });
        g.rect(b.w / 2 - 0.08, y0, 0.16, h).fill({ color: shade(hex(b.roof.color), 1.35), alpha: 0.9 });
      }
    } else {
      // Hip roof: four facets meeting at a ridge.
      const inset = Math.min(w, h) / 2;
      const cx0 = x0 + inset;
      const cx1 = x0 + w - inset;
      const cy = y0 + h / 2;
      g.poly([x0, y0, x0 + w, y0, cx1, cy, cx0, cy]).fill({ color: 0x000000, alpha: 0.24 });
      g.poly([x0, y0, cx0, cy, x0, y0 + h]).fill({ color: 0x000000, alpha: 0.12 });
      g.poly([x0 + w, y0, x0 + w, y0 + h, cx1, cy]).fill({ color: 0xffffff, alpha: 0.05 });
      g.moveTo(x0, y0)
        .lineTo(cx0, cy)
        .lineTo(x0, y0 + h)
        .moveTo(x0 + w, y0)
        .lineTo(cx1, cy)
        .lineTo(x0 + w, y0 + h)
        .moveTo(cx0, cy)
        .lineTo(cx1, cy);
      g.stroke({ color: shade(hex(b.roof.color), 1.35), width: 0.12, alpha: 0.8 });
    }
    if (b.type === 'house') {
      // Chimney.
      g.rect(b.w * 0.72 + 0.1, b.h * 0.2 + 0.12, 0.7, 0.6).fill({ color: 0x000000, alpha: 0.3 });
      g.rect(b.w * 0.72, b.h * 0.2, 0.7, 0.6).fill(0x6a3a2c);
      g.rect(b.w * 0.72 + 0.12, b.h * 0.2 + 0.12, 0.46, 0.36).fill(0x1a1614);
    }
    g.rect(x0, y0, w, h).stroke({ color: 0x0e0e0d, width: 0.08, alpha: 0.8 });
    c.addChild(g);
  }

  remove(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    for (const c of v.containers) c.destroy({ children: true });
    for (const k of [...v.doors.keys(), ...v.windows.keys(), ...v.searched.keys(), ...v.furniture.keys()]) this.objectToBuilding.delete(k);
    this.views.delete(id);
  }

  objectChanged(id: string, instant = false): void {
    const bid = this.objectToBuilding.get(id);
    const v = bid ? this.views.get(bid) : undefined;
    if (!v) return;
    const state = this.compiled.effectiveState(id);
    const door = v.doors.get(id);
    if (door) {
      door.hidden = state.broken || (door.def.kind === 'garage' && state.open);
      door.target = state.open ? door.openRotation : door.closedRotation;
      if (instant) door.current = door.target;
      door.slab.visible = !door.hidden;
      if (state.broken) door.slab.visible = false;
      drawBoards(door.boards, door.def.w, state.boards, hashId(id));
      return;
    }
    const win = v.windows.get(id);
    if (win) {
      if (win.broken !== state.broken) {
        win.broken = state.broken;
        drawWindow(win.g, win.def, state.broken);
      }
      if (win.boardCount !== state.boards) {
        win.boardCount = state.boards;
        drawBoards(win.boards, win.def.w, state.boards, hashId(id));
      }
      return;
    }
    const pieces = v.furniture.get(id);
    if (pieces && state.removed) for (const g of pieces) g.visible = false;
    const mark = v.searched.get(id);
    if (mark) mark.visible = state.searched && !state.removed;
  }

  /** Door animation, roof fading and culling. */
  update(dt: number, insideId: string | null, view: { minX: number; minY: number; maxX: number; maxY: number }): void {
    for (const v of this.views.values()) {
      const visible = v.bounds.maxX >= view.minX && v.bounds.minX <= view.maxX && v.bounds.maxY >= view.minY && v.bounds.minY <= view.maxY;
      for (const c of v.containers) c.visible = visible;
      if (!visible) continue;
      const targetAlpha = v.def.id === insideId ? 0.0 : 1;
      // 150–250 ms fade, per the design plan.
      const speed = dt / 0.2;
      v.roofAlpha = targetAlpha < v.roofAlpha ? Math.max(targetAlpha, v.roofAlpha - speed) : Math.min(targetAlpha, v.roofAlpha + speed);
      v.roof.alpha = v.roofAlpha;
      v.roof.visible = v.roofAlpha > 0.01;
      for (const d of v.doors.values()) {
        if (d.current !== d.target) {
          const step = dt * 9;
          const diff = d.target - d.current;
          d.current = Math.abs(diff) <= step ? d.target : d.current + Math.sign(diff) * step;
          d.slab.rotation = d.current;
        }
      }
    }
  }

  /** Roof bounds for the minimap and debugging. */
  get count(): number {
    return this.views.size;
  }
}

function drawDoor(g: Graphics, d: DoorDef): void {
  g.clear();
  const w = d.w;
  switch (d.kind) {
    case 'glass':
      g.rect(0, -0.04, w, 0.08).fill({ color: 0xa8c0cc, alpha: 0.55 });
      g.rect(0, -0.04, w, 0.08).stroke({ color: 0x3a3e42, width: 0.03 });
      break;
    case 'metal':
      g.rect(0, -0.05, w, 0.1).fill(0x5a5e62);
      g.rect(w - 0.12, -0.02, 0.06, 0.04).fill(0x2a2c2e);
      break;
    case 'garage':
      g.rect(0, -0.06, w, 0.12).fill(0x9a9690);
      for (let x = 0.2; x < w; x += 0.3) g.rect(x, -0.06, 0.02, 0.12).fill(0x6a6660);
      break;
    case 'cell':
      g.rect(0, -0.03, w, 0.06).stroke({ color: 0x3a3c3e, width: 0.03 });
      for (let x = 0.1; x < w; x += 0.12) g.rect(x, -0.04, 0.03, 0.08).fill(0x3a3c3e);
      break;
    case 'exterior':
      g.rect(0, -0.055, w, 0.11).fill(0x4a3024);
      g.rect(0.04, -0.035, w - 0.08, 0.07).fill(0x5a3a2a);
      g.circle(w - 0.1, 0, 0.03).fill(0xb8a060);
      break;
    default:
      g.rect(0, -0.045, w, 0.09).fill(0x7a5a3e);
      g.rect(0.03, -0.03, w - 0.06, 0.06).fill(0x8a6a4a);
      g.circle(w - 0.1, 0, 0.025).fill(0xb8a060);
  }
}

function drawWindow(g: Graphics, w: WindowDef, broken: boolean): void {
  g.clear();
  const half = w.w / 2;
  if (!broken) {
    g.rect(-half, -0.07, w.w, 0.14).fill(0x2a2826);
    g.rect(-half + 0.04, -0.035, w.w - 0.08, 0.07).fill({ color: 0x9ab8c4, alpha: 0.75 });
    g.rect(-0.015, -0.05, 0.03, 0.1).fill(0x2a2826);
    return;
  }
  g.rect(-half, -0.07, 0.06, 0.14).fill(0x2a2826);
  g.rect(half - 0.06, -0.07, 0.06, 0.14).fill(0x2a2826);
  // Jagged shards left in the frame.
  g.poly([-half + 0.06, -0.03, -half + 0.26, 0, -half + 0.06, 0.03]).fill({ color: 0x9ab8c4, alpha: 0.7 });
  g.poly([half - 0.06, -0.03, half - 0.2, 0.01, half - 0.06, 0.03]).fill({ color: 0x9ab8c4, alpha: 0.7 });
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export { hashId };
