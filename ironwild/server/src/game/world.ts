// The server's view of the map: terrain, resource nodes, placed structures and the queries the
// simulation needs (collision, placement, chunk membership).

import {
  CHUNK,
  NODE_BY_ID,
  STRUCTURE_BY_ID,
  TILES,
  Tile,
  dist,
  generateWorld,
  rotatedSize,
  type Circle,
  type CollisionWorld,
  type GeneratedWorld,
  type GenSettlement,
  type NodeDef,
  type Slots,
  type StructureDef,
} from '@ironwild/shared';
import type { ClaimMemberSave } from '../persistence/storage';

export interface ResourceNode {
  id: number;
  type: string;
  def: NodeDef;
  x: number;
  y: number;
  amount: number;
  /** Epoch ms when a depleted node regrows (0 while standing). */
  regrowAt: number;
  /** Removed for good (built over). */
  gone: boolean;
  chunk: number;
}

export interface MachineState {
  in: Slots;
  fuel: Slots | null;
  out: Slots;
  progress: number;
  recipe: string | null;
  /** Remaining fuel, in operations. */
  burn: number;
  /** Fractional yields carried between operations (10 ore → 7 ingots). */
  acc: Record<string, number>;
  mode?: string;
  status: string;
  active: boolean;
  /** Owner earns knowledge for machine output. */
  outputs: number;
  /** Overclock level (index into OVERCLOCK) and wear 0–1 (§60–61). */
  oc: number;
  wear: number;
  /** Share of recent time spent working (moving average). */
  util: number;
  /** Outputs in the last minute: [time ms, item, count]. */
  made: [number, string, number][];
}

export interface BeltItem {
  id: number;
  item: string;
  q?: number;
  p: number;
  /** Side the item entered through and the side it will leave through. */
  entry: number;
  exit: number;
  /** Speed at the last keyframe sent, and the current speed. */
  sentV: number;
  v: number;
  /** A keyframe must go out (new tile, new speed). */
  dirty: boolean;
}

export interface Structure {
  id: number;
  type: string;
  def: StructureDef;
  x: number;
  y: number;
  rot: number;
  w: number;
  h: number;
  owner: string | null;
  ownerName: string;
  hp: number;
  chunk: number;
  store?: Slots;
  machine?: MachineState;
  items?: BeltItem[];
  /** Round-robin index for splitters and filters. */
  rr?: number;
  filter?: string | null;
  open?: boolean;
  members?: ClaimMemberSave[];
  prices?: { item: string; q?: number; price: number }[];
  crank?: { player: number; until: number };
  crop?: { id: string; planted: number; grow: number };
  /** Last crop stage sent to clients. */
  stage?: number;
  /** Hopper transfer timer. */
  timer?: number;
  /** Speed of conveyors (tiles/s) and machines (RPM), from the power solver. */
  speed?: number;
  /** Rotation per gear group for drawing, and the power network. */
  spin?: number[];
  net?: number;
  /** Source speed override (windmills depend on altitude). */
  rpm?: number;
}

export const chunkKey = (cx: number, cy: number): number => cy * 1024 + cx;
export const chunkOf = (x: number, y: number): number => chunkKey(Math.floor(x / CHUNK), Math.floor(y / CHUNK));

const GRID = 4;

export class World implements CollisionWorld {
  readonly size: number;
  readonly tiles: Uint8Array;
  readonly regions: Uint8Array;
  readonly gen: GeneratedWorld;
  readonly nodes = new Map<number, ResourceNode>();
  readonly structures = new Map<number, Structure>();
  readonly nodesByChunk = new Map<number, ResourceNode[]>();
  readonly structsByChunk = new Map<number, Set<number>>();
  /** Object-layer structure id per tile (0 = none). */
  readonly objAt: Int32Array;
  readonly floorAt: Int32Array;
  readonly tileChanges = new Map<number, number>();
  private readonly nodeGrid = new Map<number, ResourceNode[]>();
  private readonly gridW: number;
  readonly settlements: GenSettlement[];
  /** Claim structures, for permission checks. */
  readonly claims = new Set<Structure>();

  constructor(seed: number) {
    this.gen = generateWorld(seed);
    this.size = this.gen.size;
    this.tiles = this.gen.tiles;
    this.regions = this.gen.regions;
    this.settlements = this.gen.settlements;
    this.objAt = new Int32Array(this.size * this.size);
    this.floorAt = new Int32Array(this.size * this.size);
    this.gridW = Math.ceil(this.size / GRID);
    for (const g of this.gen.nodes) {
      const def = NODE_BY_ID.get(g.type)!;
      const node: ResourceNode = {
        id: g.id,
        type: g.type,
        def,
        x: g.x,
        y: g.y,
        amount: def.amount,
        regrowAt: 0,
        gone: false,
        chunk: chunkOf(g.x, g.y),
      };
      this.nodes.set(node.id, node);
      let list = this.nodesByChunk.get(node.chunk);
      if (!list) this.nodesByChunk.set(node.chunk, (list = []));
      list.push(node);
      const cell = Math.floor(g.y / GRID) * this.gridW + Math.floor(g.x / GRID);
      let cl = this.nodeGrid.get(cell);
      if (!cl) this.nodeGrid.set(cell, (cl = []));
      cl.push(node);
    }
  }

  inside(tx: number, ty: number): boolean {
    return tx >= 0 && ty >= 0 && tx < this.size && ty < this.size;
  }

  tile(tx: number, ty: number): number {
    return this.inside(tx, ty) ? this.tiles[ty * this.size + tx] : Tile.DeepWater;
  }

  setTile(tx: number, ty: number, t: number): void {
    const i = ty * this.size + tx;
    this.tiles[i] = t;
    this.tileChanges.set(i, t);
  }

  structAt(tx: number, ty: number): Structure | undefined {
    if (!this.inside(tx, ty)) return undefined;
    const id = this.objAt[ty * this.size + tx];
    return id ? this.structures.get(id) : undefined;
  }

  floorStructAt(tx: number, ty: number): Structure | undefined {
    if (!this.inside(tx, ty)) return undefined;
    const id = this.floorAt[ty * this.size + tx];
    return id ? this.structures.get(id) : undefined;
  }

  // ——— CollisionWorld ———

  solidAt(tx: number, ty: number): boolean {
    if (!this.inside(tx, ty)) return true;
    const i = ty * this.size + tx;
    if (!TILES[this.tiles[i]].walk) return true;
    const id = this.objAt[i];
    if (!id) return false;
    const s = this.structures.get(id)!;
    return structureSolid(s);
  }

  circles(x: number, y: number, range: number, out: Circle[]): void {
    const gx0 = Math.floor((x - range - 2) / GRID);
    const gx1 = Math.floor((x + range + 2) / GRID);
    const gy0 = Math.floor((y - range - 2) / GRID);
    const gy1 = Math.floor((y + range + 2) / GRID);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        if (gx < 0 || gy < 0 || gx >= this.gridW || gy >= this.gridW) continue;
        const list = this.nodeGrid.get(gy * this.gridW + gx);
        if (!list) continue;
        for (const n of list) {
          if (!n.def.solid || n.regrowAt > 0 || n.gone) continue;
          if (Math.abs(n.x - x) > range + n.def.radius || Math.abs(n.y - y) > range + n.def.radius) continue;
          out.push({ x: n.x, y: n.y, r: n.def.radius });
        }
      }
    }
  }

  speedAt(tx: number, ty: number): number {
    if (!this.inside(tx, ty)) return 1;
    const i = ty * this.size + tx;
    if (this.floorAt[i]) return 1.1;
    return TILES[this.tiles[i]].speed;
  }

  // ——— Nodes ———

  nodesNear(x: number, y: number, range: number): ResourceNode[] {
    const out: ResourceNode[] = [];
    const gx0 = Math.floor((x - range - 2) / GRID);
    const gx1 = Math.floor((x + range + 2) / GRID);
    const gy0 = Math.floor((y - range - 2) / GRID);
    const gy1 = Math.floor((y + range + 2) / GRID);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        if (gx < 0 || gy < 0 || gx >= this.gridW || gy >= this.gridW) continue;
        for (const n of this.nodeGrid.get(gy * this.gridW + gx) ?? []) {
          if (n.gone) continue;
          if (dist(n.x, n.y, x, y) <= range + n.def.visual) out.push(n);
        }
      }
    }
    return out;
  }

  /** Remaining fraction for replication: 0 = depleted, 1–100 otherwise. */
  nodeState(n: ResourceNode): number {
    if (n.gone || n.regrowAt > 0) return 0;
    return Math.max(1, Math.round((n.amount / n.def.amount) * 100));
  }

  // ——— Structures ———

  addStructure(s: Structure): void {
    this.structures.set(s.id, s);
    const grid = s.def.layer === 'floor' ? this.floorAt : this.objAt;
    for (let y = s.y; y < s.y + s.h; y++) for (let x = s.x; x < s.x + s.w; x++) grid[y * this.size + x] = s.id;
    let set = this.structsByChunk.get(s.chunk);
    if (!set) this.structsByChunk.set(s.chunk, (set = new Set()));
    set.add(s.id);
    if (s.def.claimRadius) this.claims.add(s);
  }

  removeStructure(s: Structure): void {
    this.structures.delete(s.id);
    const grid = s.def.layer === 'floor' ? this.floorAt : this.objAt;
    for (let y = s.y; y < s.y + s.h; y++)
      for (let x = s.x; x < s.x + s.w; x++) if (grid[y * this.size + x] === s.id) grid[y * this.size + x] = 0;
    this.structsByChunk.get(s.chunk)?.delete(s.id);
    this.claims.delete(s);
  }

  makeStructure(id: number, type: string, x: number, y: number, rot: number, owner: string | null, ownerName: string): Structure {
    const def = STRUCTURE_BY_ID.get(type)!;
    const [w, h] = rotatedSize(def, rot);
    return { id, type, def, x, y, rot, w, h, owner, ownerName, hp: def.hp, chunk: chunkOf(x, y) };
  }

  settlementAt(x: number, y: number, margin = 0): GenSettlement | undefined {
    for (const s of this.settlements) if (dist(x, y, s.x, s.y) <= s.radius + margin) return s;
    return undefined;
  }

  nearestSettlement(x: number, y: number): GenSettlement {
    let best = this.settlements[0];
    let bestD = Infinity;
    for (const s of this.settlements) {
      const d = dist(x, y, s.x, s.y);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return best;
  }

  /** The claim covering a tile, if any. */
  claimAt(tx: number, ty: number): Structure | undefined {
    for (const c of this.claims) {
      const r = c.def.claimRadius!;
      if (Math.abs(tx - c.x) <= r && Math.abs(ty - c.y) <= r) return c;
    }
    return undefined;
  }

  /** Whether a tile touches water (for washers and steam engines). */
  touchesWater(x: number, y: number, w: number, h: number): boolean {
    for (let ty = y - 1; ty <= y + h; ty++) {
      for (let tx = x - 1; tx <= x + w; tx++) {
        if (tx >= x && tx < x + w && ty >= y && ty < y + h) continue;
        if (TILES[this.tile(tx, ty)].water) return true;
      }
    }
    return false;
  }
}

export function structureSolid(s: Structure): boolean {
  if (s.def.door) return !s.open;
  return s.def.solid;
}
