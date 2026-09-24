// Player-built structures (design plan §54–56, §82 "Player construction"): plank walls, doors,
// barricades, fences and gates, floors, crates, workbenches, campfires and placed furniture.
// Doors swing like building doors, fires flicker while lit, and damaged structures show cracks.

import { Container, Graphics } from 'pixi.js';
import { storageId, structureShape, type CompiledWorld, type ContentRegistry, type StructureDef, type StructureShape } from '@tuff/shared';
import { drawBoards } from './barricades';
import { hashId } from './buildings';
import { propContext, shade } from './prop-styles';

export interface StructureLayers {
  floors: Container;
  low: Container;
  walls: Container;
  tall: Container;
}

interface DoorPart {
  slab: Graphics;
  boards: Graphics;
  closed: number;
  open: number;
  current: number;
  target: number;
}

interface View {
  def: StructureDef;
  shape: StructureShape;
  root: Container;
  door: DoorPart | null;
  flame: Graphics | null;
  cracks: Graphics;
  lock: Graphics | null;
  lit: boolean;
}

function hex(c: string | undefined, fallback = 0x8a6a48): number {
  return c ? parseInt(c.replace('#', ''), 16) : fallback;
}

export class StructureRenderer {
  private readonly views = new Map<string, View>();
  private readonly objectToStructure = new Map<string, string>();
  private time = 0;

  constructor(
    private readonly layers: StructureLayers,
    private readonly content: ContentRegistry,
    private readonly compiled: CompiledWorld,
  ) {}

  add(def: StructureDef): void {
    if (this.views.has(def.id)) return;
    const shape = structureShape(this.content, def.type, def.prop);
    if (!shape) return;
    const root = new Container();
    root.position.set(def.x, def.y);
    root.rotation = def.rot;
    const variant = hashId(def.id);
    const con = shape.construction;
    const color = hex(con?.color ?? shape.prop?.color);
    let door: DoorPart | null = null;
    let flame: Graphics | null = null;
    let lock: Graphics | null = null;
    let layer: Container = this.layers.low;

    if (shape.kind === 'furniture' && shape.prop) {
      const p = shape.prop;
      root.addChild(new Graphics(propContext(p.style, shape.w, shape.h, shape.r || 0.3, hex(p.color, 0x777777), variant)));
      layer = p.layer === 'ground' ? this.layers.floors : p.layer === 'tall' ? this.layers.tall : this.layers.low;
    } else if (con && (shape.kind === 'door' || shape.kind === 'gate')) {
      const side = (shape.w - shape.opening) / 2;
      for (const sign of [-1, 1]) {
        const g = new Graphics(propContext(con.style, side, shape.h, 0, color, variant + sign));
        g.position.set(sign * (shape.opening / 2 + side / 2), 0);
        root.addChild(g);
      }
      const slab = new Graphics();
      const thick = shape.kind === 'gate' ? 0.08 : 0.1;
      slab.rect(0, -thick / 2, shape.opening, thick).fill(shade(color, 0.95));
      slab.rect(0.03, -thick / 4, shape.opening - 0.06, thick / 2).fill(shade(color, 1.15));
      if (shape.kind === 'gate')
        for (let x = 0.2; x < shape.opening; x += 0.3) slab.rect(x, -thick / 2, 0.03, thick).fill(shade(color, 0.6));
      else slab.circle(shape.opening - 0.1, 0, 0.025).fill(0x9a8a60);
      slab.position.set(-shape.opening / 2, 0);
      root.addChild(slab);
      const boards = new Graphics();
      root.addChild(boards);
      door = { slab, boards, closed: 0, open: (Math.PI / 2) * 0.95, current: 0, target: 0 };
      this.objectToStructure.set(`${def.id}.door`, def.id);
      layer = this.layers.walls;
    } else if (con) {
      root.addChild(new Graphics(propContext(con.style, shape.w, shape.h, 0, color, variant)));
      if (shape.kind === 'floor') layer = this.layers.floors;
      else if (shape.kind === 'wall' || shape.kind === 'fence') layer = this.layers.walls;
      if (shape.kind === 'fire') {
        flame = new Graphics();
        root.addChild(flame);
      }
    }
    if (shape.container) {
      lock = new Graphics();
      lock.roundRect(-0.07, shape.h / 2 - 0.12, 0.14, 0.11, 0.02).fill(0xb89a40);
      lock.circle(0, shape.h / 2 - 0.13, 0.045).stroke({ color: 0x8a7a50, width: 0.02 });
      lock.visible = false;
      root.addChild(lock);
      this.objectToStructure.set(storageId(def.id), def.id);
    }
    const cracks = new Graphics();
    for (let i = 0; i < 3; i++) {
      const x = -shape.w / 2 + (((variant >> (i * 3)) % 7) / 7) * shape.w;
      cracks
        .moveTo(x, -shape.h / 2)
        .lineTo(x + 0.12, 0)
        .lineTo(x - 0.05, shape.h / 2);
    }
    cracks.stroke({ color: 0x1a1410, width: 0.03, alpha: 0.8 });
    cracks.visible = false;
    root.addChild(cracks);
    layer.addChild(root);
    this.views.set(def.id, { def, shape, root, door, flame, cracks, lock, lit: false });
    this.objectToStructure.set(def.id, def.id);
    this.objectChanged(def.id, true);
    if (door) this.objectChanged(`${def.id}.door`, true);
    if (lock) this.objectChanged(storageId(def.id), true);
  }

  remove(id: string): void {
    const v = this.views.get(id);
    if (!v) return;
    v.root.destroy({ children: true });
    this.views.delete(id);
    for (const [k, sid] of this.objectToStructure) if (sid === id) this.objectToStructure.delete(k);
  }

  objectChanged(id: string, instant = false): void {
    const sid = this.objectToStructure.get(id);
    const v = sid ? this.views.get(sid) : undefined;
    if (!v) return;
    const s = this.compiled.effectiveState(id);
    if (v.door && id.endsWith('.door')) {
      v.door.target = s.open ? v.door.open : v.door.closed;
      if (instant) v.door.current = v.door.target;
      v.door.slab.visible = !s.broken;
      drawBoards(v.door.boards, v.shape.opening, s.boards, hashId(id));
      return;
    }
    if (v.lock && id.endsWith('.box')) {
      v.lock.visible = s.locked;
      return;
    }
    v.cracks.visible = s.hp < v.shape.maxHp * 0.55;
  }

  /** Door animation, fire flicker and culling. */
  update(dt: number, worldMinutes: number, view: { minX: number; minY: number; maxX: number; maxY: number }): void {
    this.time += dt;
    for (const v of this.views.values()) {
      const r = Math.max(v.shape.w, v.shape.h);
      const visible = v.def.x + r >= view.minX && v.def.x - r <= view.maxX && v.def.y + r >= view.minY && v.def.y - r <= view.maxY;
      v.root.visible = visible;
      if (!visible) continue;
      const d = v.door;
      if (d && d.current !== d.target) {
        const step = dt * 9;
        const diff = d.target - d.current;
        d.current = Math.abs(diff) <= step ? d.target : d.current + Math.sign(diff) * step;
        d.slab.rotation = d.current;
      }
      if (v.flame) {
        const lit = this.compiled.effectiveState(v.def.id).until > worldMinutes;
        v.lit = lit;
        const g = v.flame;
        g.clear();
        if (!lit) continue;
        const t = this.time;
        const base = Math.min(v.shape.w, v.shape.h) * 0.32;
        for (let i = 0; i < 5; i++) {
          const a = t * (2.1 + i * 0.37) + i * 1.7;
          const fr = base * (0.55 + 0.25 * Math.sin(a) + 0.1 * Math.sin(a * 2.3));
          const ox = Math.sin(a * 0.8 + i) * base * 0.25;
          const oy = Math.cos(a * 0.6 + i * 2) * base * 0.25;
          g.circle(ox, oy, fr).fill({ color: i < 2 ? 0xc84a18 : i < 4 ? 0xe8902a : 0xffd070, alpha: 0.55 + 0.1 * i });
        }
      }
    }
  }

  /** Lit fires, for the light map. */
  *fires(): Generator<{ x: number; y: number; radius: number; intensity: number }> {
    for (const v of this.views.values()) {
      const light = v.shape.construction?.light;
      if (!v.lit || !light) continue;
      const flicker = 0.88 + 0.12 * Math.sin(this.time * 9 + v.def.x) * Math.sin(this.time * 5.3 + v.def.y);
      yield { x: v.def.x, y: v.def.y, radius: light.radius, intensity: light.intensity * flicker };
    }
  }
}
