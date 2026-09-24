// Turns map definitions into runtime geometry: colliders for walls, doors, windows, furniture and
// fences, plus lookup tables for interactive world objects. Server and client both run this so
// their collision worlds match exactly.

import type { ContentRegistry } from '../content/registry';
import type { BlockName, PropDef } from '../content/types';
import { Block, BLOCK_ALL, type Collider, CollisionWorld, ShapeKind, type Material } from './collision';
import {
  buildingBounds,
  buildingTransform,
  localToWorld,
  type BuildingDef,
  type BuildingType,
  type DoorDef,
  type DoorKind,
  type FenceDef,
  type PropInstance,
  type RoomType,
  type Transform2D,
  type WindowDef,
  type WindowKind,
} from './map';

/** Mutable runtime state of a world object. Only values that differ from the defaults are stored. */
export interface ObjectState {
  open?: boolean;
  locked?: boolean;
  broken?: boolean;
  /** Remaining structural health. */
  hp?: number;
  /** A container that has been searched at least once. */
  searched?: boolean;
}

export interface DoorObject {
  kind: 'door';
  id: string;
  buildingId: string;
  def: DoorDef;
  doorKind: DoorKind;
  /** Centre of the doorway in world space. */
  x: number;
  y: number;
  /** World angle along the doorway. */
  angle: number;
  w: number;
  /** Hinge position in world space. */
  hingeX: number;
  hingeY: number;
  /** Direction (sign) the door swings open toward, perpendicular to the doorway. */
  swing: -1 | 1;
  hinge: -1 | 1;
  maxHp: number;
  lockedByDefault: boolean;
  exterior: boolean;
  collider: Collider;
}

export interface WindowObject {
  kind: 'window';
  id: string;
  buildingId: string;
  windowKind: WindowKind;
  x: number;
  y: number;
  angle: number;
  w: number;
  maxHp: number;
  collider: Collider;
}

export interface ContainerObject {
  kind: 'container';
  id: string;
  propType: string;
  name: string;
  loot: string;
  searchTime: number;
  volume: number;
  x: number;
  y: number;
  rot: number;
  /** Rough half-size of the container's footprint, for interaction range checks. */
  radius: number;
  buildingId: string | null;
  buildingType: BuildingType | null;
  roomType: RoomType | null;
}

export type WorldObject = DoorObject | WindowObject | ContainerObject;

export const DOOR_HP: Record<DoorKind, number> = {
  wood: 70,
  exterior: 140,
  glass: 55,
  metal: 320,
  garage: 220,
  cell: 500,
};

export const WINDOW_HP: Record<WindowKind, number> = {
  residential: 14,
  storefront: 30,
  industrial: 22,
};

export const DOOR_THICKNESS = 0.09;

export function blockFlags(names: readonly BlockName[]): number {
  let flags = 0;
  for (const n of names) {
    if (n === 'player') flags |= Block.Player;
    else if (n === 'zombie') flags |= Block.Zombie;
    else if (n === 'sight') flags |= Block.Sight;
    else if (n === 'bullet') flags |= Block.Bullet;
  }
  return flags;
}

export function doorColliderFlags(kind: DoorKind): number {
  // Glass doors stop people and bullets but not sight.
  return kind === 'glass' || kind === 'cell' ? Block.Player | Block.Zombie | Block.Bullet : BLOCK_ALL;
}

export const WINDOW_FLAGS = Block.Player | Block.Zombie | Block.Bullet;

interface CompiledElement {
  colliders: Collider[];
  objects: string[];
}

export interface CompiledBuilding {
  def: BuildingDef;
  transform: Transform2D;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/**
 * A collision world plus interactive objects, built from map elements. Elements can be added and
 * removed individually, which the client uses to stream chunks in and out.
 */
export class CompiledWorld {
  readonly collision = new CollisionWorld();
  readonly doors = new Map<string, DoorObject>();
  readonly windows = new Map<string, WindowObject>();
  readonly containers = new Map<string, ContainerObject>();
  readonly buildings = new Map<string, CompiledBuilding>();
  private readonly elements = new Map<string, CompiledElement>();
  private readonly states = new Map<string, ObjectState>();

  constructor(private readonly content: ContentRegistry) {}

  hasElement(id: string): boolean {
    return this.elements.has(id);
  }

  object(id: string): WorldObject | undefined {
    return this.doors.get(id) ?? this.windows.get(id) ?? this.containers.get(id);
  }

  stateOf(id: string): ObjectState {
    return this.states.get(id) ?? {};
  }

  /** Default state for an object according to the base map. */
  defaultState(id: string): ObjectState {
    const door = this.doors.get(id);
    if (door) return { open: !!door.def.open, locked: door.lockedByDefault, broken: false, hp: door.maxHp };
    const win = this.windows.get(id);
    if (win) return { broken: false, hp: win.maxHp };
    return { searched: false };
  }

  /** Effective state = defaults overlaid with stored deltas. */
  effectiveState(id: string): Required<ObjectState> {
    const d = this.defaultState(id);
    const s = this.states.get(id) ?? {};
    return {
      open: s.open ?? d.open ?? false,
      locked: s.locked ?? d.locked ?? false,
      broken: s.broken ?? d.broken ?? false,
      hp: s.hp ?? d.hp ?? 0,
      searched: s.searched ?? d.searched ?? false,
    };
  }

  /** Stores a delta state and updates colliders to match. */
  setState(id: string, state: ObjectState): void {
    this.states.set(id, state);
    this.syncCollider(id);
  }

  allStates(): Map<string, ObjectState> {
    return this.states;
  }

  private syncCollider(id: string): void {
    const s = this.effectiveState(id);
    const door = this.doors.get(id);
    if (door) {
      door.collider.enabled = !s.open && !s.broken;
      return;
    }
    const win = this.windows.get(id);
    if (win) win.collider.enabled = !s.broken;
  }

  addBuilding(def: BuildingDef): void {
    if (this.elements.has(def.id)) return;
    const element: CompiledElement = { colliders: [], objects: [] };
    const t = buildingTransform(def);
    this.buildings.set(def.id, { def, transform: t, bounds: buildingBounds(def) });

    // Walls, split around doorways and windows.
    const openings = [...def.doors, ...def.windows];
    for (const wall of def.walls) {
      for (const seg of splitWall(wall.x1, wall.y1, wall.x2, wall.y2, wall.t, openings)) {
        const a = localToWorld(t, seg.x1, seg.y1);
        const b = localToWorld(t, seg.x2, seg.y2);
        element.colliders.push(this.addSegment(a.x, a.y, b.x, b.y, wall.t, BLOCK_ALL, wall.material));
      }
    }

    for (const d of def.doors) {
      const c = localToWorld(t, d.x, d.y);
      const angle = d.angle + def.rot;
      const hingeLocal = { x: d.x - (Math.cos(d.angle) * d.w * d.hinge) / 2, y: d.y - (Math.sin(d.angle) * d.w * d.hinge) / 2 };
      const hinge = localToWorld(t, hingeLocal.x, hingeLocal.y);
      const collider = this.collision.add({
        shape: ShapeKind.Box,
        x: c.x,
        y: c.y,
        hx: d.w / 2,
        hy: DOOR_THICKNESS,
        angle,
        flags: doorColliderFlags(d.kind),
        material: d.kind === 'glass' ? 'glass' : d.kind === 'metal' || d.kind === 'cell' || d.kind === 'garage' ? 'metal' : 'wood',
        objectId: d.id,
      });
      element.colliders.push(collider);
      const exterior = isOnPerimeter(def, d.x, d.y);
      this.doors.set(d.id, {
        kind: 'door',
        id: d.id,
        buildingId: def.id,
        def: d,
        doorKind: d.kind,
        x: c.x,
        y: c.y,
        angle,
        w: d.w,
        hingeX: hinge.x,
        hingeY: hinge.y,
        hinge: d.hinge,
        swing: d.swing,
        maxHp: DOOR_HP[d.kind],
        lockedByDefault: !!d.locked,
        exterior,
        collider,
      });
      element.objects.push(d.id);
      this.syncCollider(d.id);
    }

    for (const w of def.windows) {
      const c = localToWorld(t, w.x, w.y);
      const collider = this.collision.add({
        shape: ShapeKind.Box,
        x: c.x,
        y: c.y,
        hx: w.w / 2,
        hy: 0.07,
        angle: w.angle + def.rot,
        flags: WINDOW_FLAGS,
        material: 'glass',
        objectId: w.id,
      });
      element.colliders.push(collider);
      this.windows.set(w.id, {
        kind: 'window',
        id: w.id,
        buildingId: def.id,
        windowKind: w.kind,
        x: c.x,
        y: c.y,
        angle: w.angle + def.rot,
        w: w.w,
        maxHp: WINDOW_HP[w.kind],
        collider,
      });
      element.objects.push(w.id);
      this.syncCollider(w.id);
    }

    for (const p of def.props) {
      const room = def.rooms.find((r) => p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h);
      this.compileProp(p, t, def.rot, element, def.id, def.type, room?.type ?? null);
    }
    this.elements.set(def.id, element);
  }

  addProp(p: PropInstance): void {
    if (this.elements.has(p.id)) return;
    const element: CompiledElement = { colliders: [], objects: [] };
    this.compileProp(p, null, 0, element, null, null, null);
    this.elements.set(p.id, element);
  }

  addFence(f: FenceDef): void {
    if (this.elements.has(f.id)) return;
    const element: CompiledElement = { colliders: [], objects: [] };
    const flags = f.kind === 'wood' ? Block.Player | Block.Zombie | Block.Sight : Block.Player | Block.Zombie;
    const material: Material = f.kind === 'chainlink' ? 'metal' : 'wood';
    for (let i = 0; i + 1 < f.points.length; i++) {
      const [x1, y1] = f.points[i];
      const [x2, y2] = f.points[i + 1];
      element.colliders.push(this.addSegment(x1, y1, x2, y2, 0.12, flags, material));
    }
    this.elements.set(f.id, element);
  }

  /** Removes a building, prop or fence and everything compiled from it. */
  removeElement(id: string): void {
    const element = this.elements.get(id);
    if (!element) return;
    for (const c of element.colliders) this.collision.remove(c);
    for (const objectId of element.objects) {
      this.doors.delete(objectId);
      this.windows.delete(objectId);
      this.containers.delete(objectId);
    }
    this.buildings.delete(id);
    this.elements.delete(id);
  }

  private compileProp(
    p: PropInstance,
    t: Transform2D | null,
    baseRot: number,
    element: CompiledElement,
    buildingId: string | null,
    buildingType: BuildingType | null,
    roomType: RoomType | null,
  ): void {
    const def: PropDef | undefined = this.content.findProp(p.type);
    if (!def) return;
    const pos = t ? localToWorld(t, p.x, p.y) : { x: p.x, y: p.y };
    const rot = p.rot + baseRot;
    const flags = blockFlags(def.blocks);
    if (def.shape !== 'none' && flags !== 0) {
      const collider =
        def.shape === 'circle'
          ? this.collision.add({
              shape: ShapeKind.Circle,
              x: pos.x,
              y: pos.y,
              r: def.r ?? 0.3,
              flags,
              material: def.material,
              objectId: p.id,
            })
          : this.collision.add({
              shape: ShapeKind.Box,
              x: pos.x,
              y: pos.y,
              hx: (p.w ?? def.w ?? 1) / 2,
              hy: (p.h ?? def.h ?? 1) / 2,
              angle: rot,
              flags,
              material: def.material,
              objectId: p.id,
            });
      element.colliders.push(collider);
    }
    if (def.container) {
      this.containers.set(p.id, {
        kind: 'container',
        id: p.id,
        propType: def.id,
        name: def.container.name,
        loot: p.loot ?? def.container.loot,
        searchTime: def.container.searchTime,
        volume: def.container.volume,
        x: pos.x,
        y: pos.y,
        rot,
        radius: def.shape === 'circle' ? (def.r ?? 0.3) : Math.sqrt((p.w ?? def.w ?? 1) ** 2 + (p.h ?? def.h ?? 1) ** 2) / 2,
        buildingId,
        buildingType,
        roomType,
      });
      element.objects.push(p.id);
    }
  }

  private addSegment(x1: number, y1: number, x2: number, y2: number, thickness: number, flags: number, material: Material): Collider {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    return this.collision.add({
      shape: ShapeKind.Box,
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2,
      hx: len / 2,
      hy: thickness / 2,
      angle: Math.atan2(dy, dx),
      flags,
      material,
    });
  }
}

function isOnPerimeter(def: BuildingDef, x: number, y: number): boolean {
  const e = 0.4;
  return x < e || y < e || x > def.w - e || y > def.h - e;
}

interface Opening {
  x: number;
  y: number;
  w: number;
  angle: number;
}

export interface WallSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Splits a wall into solid segments around the openings (doors, windows) that lie on it. Segment
 * ends at the wall's original endpoints are extended by half the thickness so corners close.
 */
export function splitWall(x1: number, y1: number, x2: number, y2: number, thickness: number, openings: readonly Opening[]): WallSegment[] {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1e-6) return [];
  const ux = dx / len;
  const uy = dy / len;
  const cuts: [number, number][] = [];
  for (const o of openings) {
    const ox = o.x - x1;
    const oy = o.y - y1;
    const along = ox * ux + oy * uy;
    const across = Math.abs(-ox * uy + oy * ux);
    const parallel = Math.abs(Math.cos(o.angle) * uy - Math.sin(o.angle) * ux) < 0.05;
    if (!parallel || across > thickness / 2 + 0.05) continue;
    if (along < -o.w / 2 || along > len + o.w / 2) continue;
    cuts.push([along - o.w / 2, along + o.w / 2]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  const half = thickness / 2;
  const segments: WallSegment[] = [];
  let start = -half;
  for (const [a, b] of cuts) {
    if (a > start + 0.01) segments.push(seg(start, Math.min(a, len + half)));
    start = Math.max(start, b);
  }
  if (start < len + half - 0.01) segments.push(seg(start, len + half));
  return segments;

  function seg(a: number, b: number): WallSegment {
    return { x1: x1 + ux * a, y1: y1 + uy * a, x2: x1 + ux * b, y2: y1 + uy * b };
  }
}
