// Helpers for procedurally constructing buildings in local coordinates.
//
// Conventions: local coordinates run from (0, 0) to (w, h). The street-facing front of a building
// is the local +y side (y = h). Furniture is authored facing local +y, so a prop placed against a
// wall is rotated to face into the room.

import type { Rng } from '../../math/rng';
import type { Material } from '../collision';
import type { BuildingDef, BuildingType, DoorKind, FloorMaterial, PropInstance, RoofDef, RoomDef, RoomType, WindowKind } from '../map';

export type Side = 'n' | 's' | 'e' | 'w';

export const EXTERIOR_WALL = 0.28;
export const INTERIOR_WALL = 0.14;

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PropSize {
  w: number;
  h: number;
}

export class BuildingBuilder {
  readonly def: BuildingDef;
  private doorCount = 0;
  private windowCount = 0;
  private propCount = 0;
  /** Areas furniture must not occupy (door swings, walkways), in local coordinates. */
  private readonly reserved: Rect[] = [];
  /** Areas occupied by furniture. */
  private readonly occupied: Rect[] = [];
  /** Window positions, which tall furniture avoids. */
  private readonly windowZones: Rect[] = [];

  constructor(
    id: string,
    type: BuildingType,
    w: number,
    h: number,
    exterior: { material: Material; color: string },
    roof: RoofDef,
    name?: string,
  ) {
    this.def = {
      id,
      type,
      name,
      x: 0,
      y: 0,
      w,
      h,
      rot: 0,
      exterior,
      rooms: [],
      walls: [],
      doors: [],
      windows: [],
      props: [],
      roof,
    };
  }

  get w(): number {
    return this.def.w;
  }

  get h(): number {
    return this.def.h;
  }

  room(type: RoomType, x: number, y: number, w: number, h: number, floor: FloorMaterial, name?: string): RoomDef {
    const room: RoomDef = { id: `${this.def.id}.r${this.def.rooms.length + 1}`, type, name, x, y, w, h, floor };
    this.def.rooms.push(room);
    return room;
  }

  exteriorWalls(material?: Material): void {
    const m = material ?? this.def.exterior.material;
    const { w, h } = this.def;
    const t = EXTERIOR_WALL;
    this.def.walls.push(
      { x1: 0, y1: 0, x2: w, y2: 0, t, exterior: true, material: m },
      { x1: w, y1: 0, x2: w, y2: h, t, exterior: true, material: m },
      { x1: w, y1: h, x2: 0, y2: h, t, exterior: true, material: m },
      { x1: 0, y1: h, x2: 0, y2: 0, t, exterior: true, material: m },
    );
  }

  wall(x1: number, y1: number, x2: number, y2: number, material: Material = 'drywall', t = INTERIOR_WALL): void {
    this.def.walls.push({ x1, y1, x2, y2, t, exterior: false, material });
  }

  /** Adds a door centred at (x, y) on a wall running horizontally ('h') or vertically ('v'). */
  door(
    x: number,
    y: number,
    orientation: 'h' | 'v',
    kind: DoorKind,
    rng: Rng,
    opts: { w?: number; locked?: boolean; open?: boolean; swing?: -1 | 1; hinge?: -1 | 1 } = {},
  ): string {
    const w = opts.w ?? (kind === 'garage' ? 2.6 : kind === 'glass' ? 1.6 : kind === 'exterior' ? 0.95 : 0.85);
    const id = `${this.def.id}.d${++this.doorCount}`;
    this.def.doors.push({
      id,
      x,
      y,
      w,
      angle: orientation === 'h' ? 0 : Math.PI / 2,
      kind,
      hinge: opts.hinge ?? (rng.chance(0.5) ? 1 : -1),
      swing: opts.swing ?? (rng.chance(0.5) ? 1 : -1),
      locked: opts.locked || undefined,
      open: opts.open || undefined,
    });
    // Keep the doorway and its swing clear of furniture.
    const clearance = kind === 'garage' ? 3 : 1.1;
    if (orientation === 'h') this.reserved.push({ x: x - w / 2 - 0.1, y: y - clearance, w: w + 0.2, h: clearance * 2 });
    else this.reserved.push({ x: x - clearance, y: y - w / 2 - 0.1, w: clearance * 2, h: w + 0.2 });
    return id;
  }

  window(x: number, y: number, orientation: 'h' | 'v', kind: WindowKind, w = 1.2): string {
    const id = `${this.def.id}.w${++this.windowCount}`;
    this.def.windows.push({ id, x, y, w, angle: orientation === 'h' ? 0 : Math.PI / 2, kind });
    if (orientation === 'h') this.windowZones.push({ x: x - w / 2, y: y - 0.9, w, h: 1.8 });
    else this.windowZones.push({ x: x - 0.9, y: y - w / 2, w: 1.8, h: w });
    return id;
  }

  /** Reserves a rectangle so furniture is not placed there (walkways, aisles). */
  reserve(x: number, y: number, w: number, h: number): void {
    this.reserved.push({ x, y, w, h });
  }

  /** Places a prop without any overlap checks. */
  prop(
    type: string,
    x: number,
    y: number,
    rot: number,
    opts: { w?: number; h?: number; loot?: string; size?: PropSize; variant?: number } = {},
  ): PropInstance {
    const p: PropInstance = { id: `${this.def.id}.p${++this.propCount}`, type, x, y, rot };
    if (opts.w !== undefined) p.w = opts.w;
    if (opts.h !== undefined) p.h = opts.h;
    if (opts.loot) p.loot = opts.loot;
    if (opts.variant !== undefined) p.variant = opts.variant;
    this.def.props.push(p);
    if (opts.size) {
      const quarter = Math.abs(Math.sin(rot)) > 0.7;
      const fw = quarter ? opts.size.h : opts.size.w;
      const fh = quarter ? opts.size.w : opts.size.h;
      this.occupied.push({ x: x - fw / 2, y: y - fh / 2, w: fw, h: fh });
    }
    return p;
  }

  /** True if a footprint is free of furniture, reserved areas and (optionally) windows. */
  isFree(r: Rect, avoidWindows: boolean): boolean {
    const hit = (o: Rect) => r.x < o.x + o.w && r.x + r.w > o.x && r.y < o.y + o.h && r.y + r.h > o.y;
    if (this.occupied.some(hit) || this.reserved.some(hit)) return false;
    if (avoidWindows && this.windowZones.some(hit)) return false;
    return true;
  }

  /**
   * Places furniture with its back against one wall of a room. Tries several positions along the
   * wall and returns the prop, or null if nothing fit.
   */
  againstWall(
    room: RoomDef,
    side: Side,
    type: string,
    size: PropSize,
    rng: Rng,
    opts: { loot?: string; tall?: boolean; gap?: number; along?: number; w?: number; h?: number } = {},
  ): PropInstance | null {
    const inset =
      (room.x === 0 || room.y === 0 || room.x + room.w >= this.w || room.y + room.h >= this.h ? EXTERIOR_WALL : INTERIOR_WALL) / 2;
    const gap = opts.gap ?? 0.05;
    const horizontal = side === 'n' || side === 's';
    const span = horizontal ? room.w : room.h;
    const margin = 0.25 + size.w / 2;
    if (span < size.w + 0.5) return null;
    const candidates: number[] = [];
    if (opts.along !== undefined) candidates.push(opts.along);
    for (let i = 0; i < 10; i++) candidates.push(rng.range(margin, span - margin));
    for (const along of candidates) {
      let x: number;
      let y: number;
      let rot: number;
      switch (side) {
        case 'n':
          x = room.x + along;
          y = room.y + inset + gap + size.h / 2;
          rot = 0;
          break;
        case 's':
          x = room.x + along;
          y = room.y + room.h - inset - gap - size.h / 2;
          rot = Math.PI;
          break;
        case 'w':
          x = room.x + inset + gap + size.h / 2;
          y = room.y + along;
          rot = -Math.PI / 2;
          break;
        default:
          x = room.x + room.w - inset - gap - size.h / 2;
          y = room.y + along;
          rot = Math.PI / 2;
          break;
      }
      const fw = horizontal ? size.w : size.h;
      const fh = horizontal ? size.h : size.w;
      const rect = { x: x - fw / 2, y: y - fh / 2, w: fw, h: fh };
      if (rect.x < room.x || rect.y < room.y || rect.x + rect.w > room.x + room.w || rect.y + rect.h > room.y + room.h) continue;
      if (!this.isFree(rect, opts.tall ?? false)) continue;
      return this.prop(type, x, y, rot, { loot: opts.loot, size, w: opts.w, h: opts.h });
    }
    return null;
  }

  /** Places a free-standing prop somewhere inside a room, away from walls. */
  inRoom(
    room: RoomDef,
    type: string,
    size: PropSize,
    rng: Rng,
    opts: { rot?: number; loot?: string; margin?: number } = {},
  ): PropInstance | null {
    const margin = opts.margin ?? 0.8;
    for (let i = 0; i < 16; i++) {
      const rot = opts.rot ?? (rng.chance(0.5) ? 0 : Math.PI / 2);
      const quarter = Math.abs(Math.sin(rot)) > 0.7;
      const fw = quarter ? size.h : size.w;
      const fh = quarter ? size.w : size.h;
      if (room.w < fw + margin * 2 || room.h < fh + margin * 2) return null;
      const x = rng.range(room.x + margin + fw / 2, room.x + room.w - margin - fw / 2);
      const y = rng.range(room.y + margin + fh / 2, room.y + room.h - margin - fh / 2);
      const rect = { x: x - fw / 2, y: y - fh / 2, w: fw, h: fh };
      if (!this.isFree(rect, false)) continue;
      return this.prop(type, x, y, rot, { loot: opts.loot, size });
    }
    return null;
  }

  /** Adds windows spaced along an exterior wall segment, skipping door openings. */
  windowsAlong(side: Side, from: number, to: number, count: number, kind: WindowKind, w = 1.2): void {
    const len = to - from;
    if (count <= 0 || len < w + 0.8) return;
    for (let i = 0; i < count; i++) {
      const t = from + (len * (i + 0.5)) / count;
      const pos = this.positionOn(side, t);
      const blocked = this.def.doors.some((d) => Math.abs(d.x - pos.x) + Math.abs(d.y - pos.y) < d.w / 2 + w / 2 + 0.3);
      if (blocked) continue;
      this.window(pos.x, pos.y, side === 'n' || side === 's' ? 'h' : 'v', kind, w);
    }
  }

  /** Local position of a point `t` meters along the given exterior side. */
  positionOn(side: Side, t: number): { x: number; y: number } {
    switch (side) {
      case 'n':
        return { x: t, y: 0 };
      case 's':
        return { x: t, y: this.h };
      case 'w':
        return { x: 0, y: t };
      default:
        return { x: this.w, y: t };
    }
  }

  finish(x: number, y: number, rot: number): BuildingDef {
    this.def.x = x;
    this.def.y = y;
    this.def.rot = rot;
    return this.def;
  }
}

/** Rotation that makes a building's local front (+y) face the given world direction. */
export function rotationFacing(direction: Side): number {
  switch (direction) {
    case 's':
      return 0;
    case 'w':
      return Math.PI / 2;
    case 'n':
      return Math.PI;
    default:
      return -Math.PI / 2;
  }
}

export const SIDING_COLORS = ['#b9b4a6', '#9aa3a6', '#a89c84', '#8c9884', '#b8a878', '#7d8a94', '#a4877a', '#c0b9a8'];
export const ROOF_COLORS = ['#3e3b3a', '#4a3a32', '#503630', '#3a4248', '#44493e', '#2e3034'];
