// Turns map definitions into runtime geometry: colliders for walls, doors, windows, furniture and
// fences, plus lookup tables for interactive world objects. Server and client both run this so
// their collision worlds match exactly.

import type { ContentRegistry } from '../content/registry';
import type { BlockName, PropDef, StationKind } from '../content/types';
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
import { structureBounds, structureShape, type StructureDef, type StructureShape } from './structures';

/** Mutable runtime state of a world object. Only values that differ from the defaults are stored. */
export interface ObjectState {
  open?: boolean;
  locked?: boolean;
  broken?: boolean;
  /** Remaining structural health. */
  hp?: number;
  /** A container that has been searched at least once. */
  searched?: boolean;
  /** Planks nailed across a door or window (design plan §54). */
  boards?: number;
  /** Remaining health of those planks. */
  boardHp?: number;
  /** Furniture that has been picked up and carried away. */
  removed?: boolean;
  /** Game minute a fire burns until. */
  until?: number;
}

export interface DoorObject {
  kind: 'door';
  id: string;
  /** Owning building, or structure for player-built doors. */
  buildingId: string;
  /** Set for doors in player structures. */
  structureId: string | null;
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
  /** Loot table rolled on first open; empty for player storage. */
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
  /** Player storage: owning account and structure. */
  owner: string | null;
  structureId: string | null;
}

/** A bed, couch or bunk (base map furniture or placed furniture). */
export interface SleepSpot {
  id: string;
  name: string;
  quality: number;
  x: number;
  y: number;
  radius: number;
}

/** A crafting station: a stove, a workbench or a fire. */
export interface StationObject {
  id: string;
  kind: StationKind;
  name: string;
  x: number;
  y: number;
  radius: number;
  /** Fires only work while lit (see ObjectState.until). */
  fire: boolean;
}

/** Base-map furniture that can be picked up. */
export interface MovableObject {
  kind: 'movable';
  id: string;
  propType: string;
  name: string;
  x: number;
  y: number;
  rot: number;
  radius: number;
  buildingId: string | null;
  colliders: Collider[];
}

/** A player-built structure. */
export interface StructureObject {
  kind: 'structure';
  id: string;
  def: StructureDef;
  shape: StructureShape;
  x: number;
  y: number;
  rot: number;
  radius: number;
  maxHp: number;
  colliders: Collider[];
}

export type WorldObject = DoorObject | WindowObject | ContainerObject | StructureObject | MovableObject;

export const DOOR_HP: Record<DoorKind, number> = {
  wood: 70,
  exterior: 140,
  glass: 55,
  metal: 320,
  garage: 220,
  cell: 500,
  plank: 160,
  gate: 110,
};

export const WINDOW_HP: Record<WindowKind, number> = {
  residential: 14,
  storefront: 30,
  industrial: 22,
};

/** Barricades: planks per door or window and health per plank. */
export const MAX_BOARDS = 4;
export const BOARD_HP = 45;

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
  // Glass doors, cell doors and gates stop people and bullets (gates: people) but not sight.
  if (kind === 'gate') return Block.Player | Block.Zombie;
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
  readonly beds = new Map<string, SleepSpot>();
  readonly stations = new Map<string, StationObject>();
  readonly movables = new Map<string, MovableObject>();
  readonly structures = new Map<string, StructureObject>();
  readonly buildings = new Map<string, CompiledBuilding>();
  private readonly elements = new Map<string, CompiledElement>();
  private readonly states = new Map<string, ObjectState>();

  constructor(private readonly content: ContentRegistry) {}

  hasElement(id: string): boolean {
    return this.elements.has(id);
  }

  /** Ids of the interactive objects an element owns (doors, windows, containers, furniture). */
  elementObjects(id: string): readonly string[] {
    return this.elements.get(id)?.objects ?? [];
  }

  object(id: string): WorldObject | undefined {
    return this.doors.get(id) ?? this.windows.get(id) ?? this.containers.get(id) ?? this.structures.get(id) ?? this.movables.get(id);
  }

  /** True for ids that can carry state (including furniture that has been carried away). */
  hasObject(id: string): boolean {
    return this.object(id) !== undefined;
  }

  stateOf(id: string): ObjectState {
    return this.states.get(id) ?? {};
  }

  /** Default state for an object according to the base map. */
  defaultState(id: string): ObjectState {
    const door = this.doors.get(id);
    if (door) return { open: !!door.def.open, locked: door.lockedByDefault, broken: false, hp: door.maxHp, boards: 0, boardHp: 0 };
    const win = this.windows.get(id);
    if (win) return { broken: false, hp: win.maxHp, boards: 0, boardHp: 0 };
    const s = this.structures.get(id);
    if (s) return { hp: s.maxHp, locked: false, until: 0, searched: false };
    return { searched: false, removed: false, locked: false };
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
      boards: s.boards ?? d.boards ?? 0,
      boardHp: s.boardHp ?? d.boardHp ?? 0,
      removed: s.removed ?? d.removed ?? false,
      until: s.until ?? d.until ?? 0,
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
    const movable = this.movables.get(id);
    if (movable && s.removed) {
      // Carried away: its colliders, storage, bed and station go with it.
      for (const c of movable.colliders) this.collision.remove(c);
      movable.colliders = [];
      this.containers.delete(id);
      this.beds.delete(id);
      this.stations.delete(id);
    }
    const door = this.doors.get(id);
    if (door) {
      door.collider.enabled = (!s.open && !s.broken) || s.boards > 0;
      door.collider.flags = doorColliderFlags(door.doorKind) | (s.boards >= 2 ? Block.Sight | Block.Bullet : 0);
      return;
    }
    const win = this.windows.get(id);
    if (win) {
      win.collider.enabled = !s.broken || s.boards > 0;
      win.collider.flags = WINDOW_FLAGS | (s.boards >= 2 ? Block.Sight : 0);
    }
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

    for (const d of def.doors) this.compileDoor(d, t, def.rot, def.id, null, isOnPerimeter(def, d.x, d.y), element);

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
    for (const id of element.objects) if (this.states.has(id)) this.syncCollider(id);
  }

  addProp(p: PropInstance): void {
    if (this.elements.has(p.id)) return;
    const element: CompiledElement = { colliders: [], objects: [] };
    this.compileProp(p, null, 0, element, null, null, null);
    this.elements.set(p.id, element);
    if (this.states.has(p.id)) this.syncCollider(p.id);
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

  /** Compiles a player-built structure (walls, doors, crates, fires, placed furniture). */
  addStructure(s: StructureDef): void {
    if (this.elements.has(s.id)) return;
    const shape = structureShape(this.content, s.type, s.prop);
    if (!shape) return;
    const element: CompiledElement = { colliders: [], objects: [] };
    const cos = Math.cos(s.rot);
    const sin = Math.sin(s.rot);
    const t: Transform2D = { x: s.x, y: s.y, cos, sin, px: 0, py: 0 };
    const flags = blockFlags(shape.blocks);
    const pieces: Collider[] = [];
    if (shape.kind === 'door' || shape.kind === 'gate') {
      const side = (shape.w - shape.opening) / 2;
      if (side > 0.01) {
        for (const sign of [-1, 1]) {
          const c = localToWorld(t, sign * (shape.opening / 2 + side / 2), 0);
          pieces.push(
            this.collision.add({
              shape: ShapeKind.Box,
              x: c.x,
              y: c.y,
              hx: side / 2,
              hy: shape.h / 2,
              angle: s.rot,
              flags,
              material: shape.material,
              objectId: s.id,
            }),
          );
        }
      }
      const door: DoorDef = {
        id: `${s.id}.door`,
        x: 0,
        y: 0,
        w: shape.opening,
        angle: 0,
        kind: shape.kind === 'gate' ? 'gate' : 'plank',
        hinge: 1,
        swing: 1,
      };
      this.compileDoor(door, t, s.rot, s.id, s.id, true, element);
    } else if (flags !== 0 && shape.kind !== 'floor') {
      pieces.push(
        shape.r > 0
          ? this.collision.add({ shape: ShapeKind.Circle, x: s.x, y: s.y, r: shape.r, flags, material: shape.material, objectId: s.id })
          : this.collision.add({
              shape: ShapeKind.Box,
              x: s.x,
              y: s.y,
              hx: shape.w / 2,
              hy: shape.h / 2,
              angle: s.rot,
              flags,
              material: shape.material,
              objectId: s.id,
            }),
      );
    }
    element.colliders.push(...pieces);
    const b = structureBounds(s, shape);
    const radius = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2;
    this.structures.set(s.id, {
      kind: 'structure',
      id: s.id,
      def: s,
      shape,
      x: s.x,
      y: s.y,
      rot: s.rot,
      radius,
      maxHp: shape.maxHp,
      colliders: pieces,
    });
    element.objects.push(s.id);
    if (shape.container) {
      const boxId = storageId(s.id);
      this.containers.set(boxId, {
        kind: 'container',
        id: boxId,
        propType: s.prop ?? s.type,
        name: shape.container.name,
        loot: '',
        searchTime: 0.4,
        volume: shape.container.volume,
        x: s.x,
        y: s.y,
        rot: s.rot,
        radius: Math.hypot(shape.w, shape.h) / 2,
        buildingId: null,
        buildingType: null,
        roomType: null,
        owner: s.owner,
        structureId: s.id,
      });
      element.objects.push(boxId);
    }
    if (shape.station) {
      this.stations.set(s.id, { id: s.id, kind: shape.station, name: shape.name, x: s.x, y: s.y, radius, fire: shape.kind === 'fire' });
    }
    if (shape.sleep !== null) this.beds.set(s.id, { id: s.id, name: shape.name, quality: shape.sleep, x: s.x, y: s.y, radius });
    this.elements.set(s.id, element);
  }

  /** Removes a building, prop, fence or structure and everything compiled from it. */
  removeElement(id: string): void {
    const element = this.elements.get(id);
    if (!element) return;
    for (const c of element.colliders) this.collision.remove(c);
    for (const objectId of element.objects) {
      this.doors.delete(objectId);
      this.windows.delete(objectId);
      this.containers.delete(objectId);
      this.beds.delete(objectId);
      this.stations.delete(objectId);
      this.movables.delete(objectId);
      this.structures.delete(objectId);
    }
    this.buildings.delete(id);
    this.elements.delete(id);
  }

  private compileDoor(
    d: DoorDef,
    t: Transform2D,
    baseRot: number,
    ownerId: string,
    structureId: string | null,
    exterior: boolean,
    element: CompiledElement,
  ): void {
    const c = localToWorld(t, d.x, d.y);
    const angle = d.angle + baseRot;
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
    this.doors.set(d.id, {
      kind: 'door',
      id: d.id,
      buildingId: ownerId,
      structureId,
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
    const w = p.w ?? def.w ?? 1;
    const h = p.h ?? def.h ?? 1;
    const radius = def.shape === 'circle' ? (def.r ?? 0.3) : Math.sqrt(w * w + h * h) / 2;
    const colliders: Collider[] = [];
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
              hx: w / 2,
              hy: h / 2,
              angle: rot,
              flags,
              material: def.material,
              objectId: p.id,
            });
      colliders.push(collider);
      element.colliders.push(collider);
    }
    let owns = false;
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
        radius,
        buildingId,
        buildingType,
        roomType,
        owner: null,
        structureId: null,
      });
      owns = true;
    }
    if (def.sleep) {
      this.beds.set(p.id, { id: p.id, name: def.name, quality: def.sleep.quality, x: pos.x, y: pos.y, radius });
      owns = true;
    }
    if (def.station) {
      this.stations.set(p.id, { id: p.id, kind: def.station, name: def.name, x: pos.x, y: pos.y, radius, fire: false });
      owns = true;
    }
    if (def.movable) {
      this.movables.set(p.id, {
        kind: 'movable',
        id: p.id,
        propType: def.id,
        name: def.name,
        x: pos.x,
        y: pos.y,
        rot,
        radius,
        buildingId,
        colliders,
      });
      owns = true;
    }
    if (owns) element.objects.push(p.id);
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

/** Container id of a storage structure (crates, placed furniture with storage). */
export function storageId(structureId: string): string {
  return `${structureId}.box`;
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
