// The client's copy of the world: the full terrain (sent once) plus the nodes, structures and
// conveyor items of the chunks around the player. It implements the same collision interface
// as the server so movement prediction collides with exactly the same things.

import {
  CHUNK,
  NODE_BY_ID,
  STRUCTURE_BY_ID,
  TILES,
  decodeTiles,
  rotatedSize,
  type BeltKeyframe,
  type Circle,
  type CollisionWorld,
  type HouseInfo,
  type LandmarkInfo,
  type NetSummary,
  type NodeDef,
  type NodeTuple,
  type SettlementInfo,
  type StructSpawn,
  type StructureDef,
  type StructVisual,
  type WelcomeMessage,
} from '@ironwild/shared';

export interface ClientNode {
  id: number;
  type: string;
  def: NodeDef;
  x: number;
  y: number;
  /** 0 = depleted, 1–100 remaining. */
  state: number;
  chunk: number;
}

export interface ClientStruct {
  id: number;
  type: string;
  def: StructureDef;
  x: number;
  y: number;
  rot: number;
  w: number;
  h: number;
  owner?: string;
  st: StructVisual;
  /** Speeds per gear group (RPM) or conveyor speed (tiles/s). */
  spin: number[];
  net?: number;
  chunk: number;
}

export interface BeltItemView {
  id: number;
  item: string;
  frames: BeltKeyframe[];
  removedAt?: number;
}

export interface WorldListener {
  chunkAdded(key: number): void;
  chunkRemoved(key: number): void;
  nodeAdded(n: ClientNode): void;
  nodeChanged(n: ClientNode): void;
  nodeRemoved(n: ClientNode): void;
  structAdded(s: ClientStruct): void;
  structRemoved(s: ClientStruct): void;
  structChanged(s: ClientStruct): void;
  tilesChanged(changes: [number, number, number][]): void;
}

export const chunkKey = (cx: number, cy: number): number => cy * 1024 + cx;
const GRID = 4;

export class ClientWorld implements CollisionWorld {
  readonly size: number;
  readonly tiles: Uint8Array;
  readonly regions: Uint8Array;
  readonly settlements: SettlementInfo[];
  readonly houses: HouseInfo[];
  readonly landmarks: LandmarkInfo[];
  readonly nodes = new Map<number, ClientNode>();
  readonly structs = new Map<number, ClientStruct>();
  readonly chunks = new Set<number>();
  readonly belt = new Map<number, BeltItemView>();
  private readonly objAt = new Map<number, number>();
  private readonly floorAt = new Map<number, number>();
  private readonly nodeGrid = new Map<number, Set<ClientNode>>();
  private readonly chunkNodes = new Map<number, Set<number>>();
  private readonly chunkStructs = new Map<number, Set<number>>();
  private readonly gridW: number;
  listener: WorldListener | null = null;
  networks = new Map<number, NetSummary>();
  /** Fluid networks (fluid, fill 0–1, flow per second) and which network each pipe or tank is in. */
  fluidNets = new Map<number, { fluid: string; fill: number; flow: number }>();
  fluidOf = new Map<number, number>();

  constructor(welcome: WelcomeMessage) {
    const w = welcome.world;
    this.size = w.size;
    this.tiles = decodeTiles(w.tiles, w.size * w.size);
    this.regions = decodeTiles(w.regions, w.size * w.size);
    this.settlements = w.settlements;
    this.houses = w.houses;
    this.landmarks = w.landmarks;
    this.gridW = Math.ceil(this.size / GRID);
  }

  tile(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return 0;
    return this.tiles[ty * this.size + tx];
  }

  region(x: number, y: number): number {
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return 0;
    return this.regions[ty * this.size + tx];
  }

  // ——— CollisionWorld ———

  solidAt(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return true;
    const i = ty * this.size + tx;
    if (!TILES[this.tiles[i]].walk) return true;
    const id = this.objAt.get(i);
    if (!id) return false;
    const s = this.structs.get(id);
    if (!s) return false;
    return s.def.door ? !s.st.open : s.def.solid;
  }

  circles(x: number, y: number, range: number, out: Circle[]): void {
    const gx0 = Math.floor((x - range - 2) / GRID);
    const gx1 = Math.floor((x + range + 2) / GRID);
    const gy0 = Math.floor((y - range - 2) / GRID);
    const gy1 = Math.floor((y + range + 2) / GRID);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        const set = this.nodeGrid.get(gy * this.gridW + gx);
        if (!set) continue;
        for (const n of set) {
          if (!n.def.solid || n.state === 0) continue;
          if (Math.abs(n.x - x) > range + n.def.radius || Math.abs(n.y - y) > range + n.def.radius) continue;
          out.push({ x: n.x, y: n.y, r: n.def.radius });
        }
      }
    }
  }

  speedAt(tx: number, ty: number): number {
    if (tx < 0 || ty < 0 || tx >= this.size || ty >= this.size) return 1;
    const i = ty * this.size + tx;
    if (this.floorAt.has(i)) return 1.1;
    return TILES[this.tiles[i]].speed;
  }

  // ——— Queries ———

  structAt(tx: number, ty: number): ClientStruct | undefined {
    const id = this.objAt.get(ty * this.size + tx);
    return id ? this.structs.get(id) : undefined;
  }

  floorAtTile(tx: number, ty: number): ClientStruct | undefined {
    const id = this.floorAt.get(ty * this.size + tx);
    return id ? this.structs.get(id) : undefined;
  }

  nodesNear(x: number, y: number, range: number): ClientNode[] {
    const out: ClientNode[] = [];
    const gx0 = Math.floor((x - range - 2) / GRID);
    const gx1 = Math.floor((x + range + 2) / GRID);
    const gy0 = Math.floor((y - range - 2) / GRID);
    const gy1 = Math.floor((y + range + 2) / GRID);
    for (let gy = gy0; gy <= gy1; gy++) {
      for (let gx = gx0; gx <= gx1; gx++) {
        for (const n of this.nodeGrid.get(gy * this.gridW + gx) ?? []) {
          if (Math.hypot(n.x - x, n.y - y) <= range + n.def.visual) out.push(n);
        }
      }
    }
    return out;
  }

  settlementAt(x: number, y: number, margin = 0): SettlementInfo | undefined {
    for (const s of this.settlements) if (Math.hypot(s.x - x, s.y - y) <= s.radius + margin) return s;
    return undefined;
  }

  // ——— Chunks ———

  addChunk(cx: number, cy: number, nodes: NodeTuple[], structs: StructSpawn[]): void {
    const key = chunkKey(cx, cy);
    if (this.chunks.has(key)) this.removeChunk(cx, cy);
    this.chunks.add(key);
    this.listener?.chunkAdded(key);
    const nset = new Set<number>();
    this.chunkNodes.set(key, nset);
    for (const [id, type, x, y, state] of nodes) {
      const def = NODE_BY_ID.get(type);
      if (!def) continue;
      const n: ClientNode = { id, type, def, x: x / 100, y: y / 100, state, chunk: key };
      this.nodes.set(id, n);
      nset.add(id);
      const cell = Math.floor(n.y / GRID) * this.gridW + Math.floor(n.x / GRID);
      let g = this.nodeGrid.get(cell);
      if (!g) this.nodeGrid.set(cell, (g = new Set()));
      g.add(n);
      this.listener?.nodeAdded(n);
    }
    this.chunkStructs.set(key, new Set());
    for (const s of structs) this.addStruct(s);
  }

  removeChunk(cx: number, cy: number): void {
    const key = chunkKey(cx, cy);
    if (!this.chunks.has(key)) return;
    for (const id of this.chunkNodes.get(key) ?? []) {
      const n = this.nodes.get(id);
      if (!n) continue;
      this.nodes.delete(id);
      this.nodeGrid.get(Math.floor(n.y / GRID) * this.gridW + Math.floor(n.x / GRID))?.delete(n);
      this.listener?.nodeRemoved(n);
    }
    for (const id of [...(this.chunkStructs.get(key) ?? [])]) this.removeStruct(id);
    this.chunkNodes.delete(key);
    this.chunkStructs.delete(key);
    this.chunks.delete(key);
    // Drop conveyor items on tiles of this chunk.
    for (const [id, it] of this.belt) {
      const f = it.frames[it.frames.length - 1];
      if (f?.x !== undefined && chunkKey(Math.floor(f.x / CHUNK), Math.floor((f.y ?? 0) / CHUNK)) === key) this.belt.delete(id);
    }
    this.listener?.chunkRemoved(key);
  }

  setNode(id: number, a: number): void {
    const n = this.nodes.get(id);
    if (!n) return;
    if (a < 0) {
      this.nodes.delete(id);
      this.nodeGrid.get(Math.floor(n.y / GRID) * this.gridW + Math.floor(n.x / GRID))?.delete(n);
      this.chunkNodes.get(n.chunk)?.delete(id);
      this.listener?.nodeRemoved(n);
      return;
    }
    n.state = a;
    this.listener?.nodeChanged(n);
  }

  addStruct(spawn: StructSpawn): void {
    const def = STRUCTURE_BY_ID.get(spawn.type);
    if (!def) return;
    if (this.structs.has(spawn.id)) this.removeStruct(spawn.id);
    const [w, h] = rotatedSize(def, spawn.r);
    const key = chunkKey(Math.floor(spawn.x / CHUNK), Math.floor(spawn.y / CHUNK));
    const s: ClientStruct = {
      id: spawn.id,
      type: spawn.type,
      def,
      x: spawn.x,
      y: spawn.y,
      rot: spawn.r,
      w,
      h,
      owner: spawn.owner,
      st: spawn.st ?? {},
      spin: spawn.k ?? [],
      net: spawn.n,
      chunk: key,
    };
    this.structs.set(s.id, s);
    let set = this.chunkStructs.get(key);
    if (!set) this.chunkStructs.set(key, (set = new Set()));
    set.add(s.id);
    const grid = def.layer === 'floor' ? this.floorAt : this.objAt;
    for (let y = s.y; y < s.y + h; y++) for (let x = s.x; x < s.x + w; x++) grid.set(y * this.size + x, s.id);
    this.listener?.structAdded(s);
    this.neighboursChanged(s);
  }

  removeStruct(id: number): void {
    const s = this.structs.get(id);
    if (!s) return;
    this.structs.delete(id);
    this.chunkStructs.get(s.chunk)?.delete(id);
    const grid = s.def.layer === 'floor' ? this.floorAt : this.objAt;
    for (let y = s.y; y < s.y + s.h; y++)
      for (let x = s.x; x < s.x + s.w; x++) if (grid.get(y * this.size + x) === id) grid.delete(y * this.size + x);
    this.listener?.structRemoved(s);
    this.neighboursChanged(s);
  }

  /** Conveyors and fences draw differently depending on their neighbours. */
  private neighboursChanged(s: ClientStruct): void {
    for (let y = s.y - 1; y <= s.y + s.h; y++) {
      for (let x = s.x - 1; x <= s.x + s.w; x++) {
        const n = this.structAt(x, y);
        if (n && n !== s && (n.def.logistics || n.type === 'fence' || n.type === 'pen_gate' || n.def.kinetic || n.def.fluid || n.def.rail))
          this.listener?.structChanged(n);
      }
    }
  }

  updateStruct(id: number, st: StructVisual): void {
    const s = this.structs.get(id);
    if (!s) return;
    s.st = st;
    this.listener?.structChanged(s);
  }

  setSpin(id: number, spin: number[]): void {
    const s = this.structs.get(id);
    if (s) s.spin = spin;
  }

  /** The fluid network a pipe or tank belongs to. */
  fluidAt(id: number): { fluid: string; fill: number; flow: number } | undefined {
    const net = this.fluidOf.get(id);
    return net === undefined ? undefined : this.fluidNets.get(net);
  }

  setNet(id: number, net: number): void {
    const s = this.structs.get(id);
    if (s) s.net = net;
  }

  applyTiles(changes: [number, number, number][]): void {
    for (const [x, y, t] of changes) this.tiles[y * this.size + x] = t;
    this.listener?.tilesChanged(changes);
  }

  // ——— Conveyor items ———

  beltKeyframes(frames: BeltKeyframe[]): void {
    for (const f of frames) {
      let it = this.belt.get(f.i);
      if (f.rm) {
        if (it) {
          it.frames.push(f);
          it.removedAt = f.k;
        }
        continue;
      }
      if (!it) {
        it = { id: f.i, item: f.it ?? 'stone', frames: [] };
        this.belt.set(f.i, it);
      }
      if (f.it) it.item = f.it;
      it.frames.push(f);
      if (it.frames.length > 6) it.frames.splice(0, it.frames.length - 6);
    }
  }
}
