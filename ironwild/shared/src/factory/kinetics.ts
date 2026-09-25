// Mechanical power networks (§20–22). Rotation physically travels through connected blocks:
// sources (water wheels, windmills, cranks, engines) → shafts and gearboxes → machines and
// conveyors. A network runs at one base speed; gearboxes change the speed of what lies beyond
// them. Load is measured Create-style in stress units: torque × (rpm / 16). A machine running
// twice as fast works twice as fast but costs twice the stress. When load exceeds capacity the
// whole network stalls.

import { BASE_RPM, DX, DY, opposite } from '../constants';
import { worldPorts, rotatedSize, type StructureDef } from '../content/structures';

export const BELT_STRESS_PER_TILE = 0.5;
export const MAX_RPM = 256;

export interface KineticBlock {
  id: number;
  def: StructureDef;
  x: number;
  y: number;
  rot: number;
  /** Sources only: currently producing (a crank being turned, an engine with fuel and water). */
  active: boolean;
  /** Sources only: speed override (windmills vary with altitude). */
  rpm?: number;
}

export interface BeltGroup {
  id: number;
  tiles: readonly { x: number; y: number }[];
}

export interface NetworkInfo {
  id: number;
  /** Speed at ratio 1. */
  rpm: number;
  /** Stress capacity and load in stress units. */
  capacity: number;
  load: number;
  stalled: boolean;
  /** Gears locked: loops with contradicting ratios. */
  conflict: boolean;
  sources: number;
  consumers: number;
  blocks: number[];
}

export interface KineticSolution {
  networks: Map<number, NetworkInfo>;
  /** Signed speed per group for transmitters, one entry for consumers. 0 when stalled. */
  speeds: Map<number, number[]>;
  netOf: Map<number, number>;
  beltSpeed: Map<number, number>;
  beltNet: Map<number, number>;
}

const portKey = (x: number, y: number, face: number): number => ((y * 4096 + x) << 2) | face;

interface PortRef {
  block: KineticBlock;
  group: number;
}

function ratiosOf(def: StructureDef): number[] {
  return def.kinetic?.ratios ?? [1];
}

/** Edge tiles and outward faces of a block's footprint. */
function footprintFaces(block: KineticBlock): { x: number; y: number; face: number }[] {
  const [w, h] = rotatedSize(block.def, block.rot);
  const out: { x: number; y: number; face: number }[] = [];
  for (let i = 0; i < w; i++) out.push({ x: block.x + i, y: block.y, face: 0 });
  for (let j = 0; j < h; j++) out.push({ x: block.x + w - 1, y: block.y + j, face: 1 });
  for (let i = 0; i < w; i++) out.push({ x: block.x + i, y: block.y + h - 1, face: 2 });
  for (let j = 0; j < h; j++) out.push({ x: block.x, y: block.y + j, face: 3 });
  return out;
}

export function solveKinetics(blocks: readonly KineticBlock[], belts: readonly BeltGroup[] = []): KineticSolution {
  const ports = new Map<number, PortRef>();
  const transmitters: KineticBlock[] = [];
  const consumers: KineticBlock[] = [];
  for (const b of blocks) {
    const role = b.def.kinetic?.role;
    if (!role) continue;
    if (role === 'consumer') {
      consumers.push(b);
      continue;
    }
    transmitters.push(b);
    for (const p of worldPorts(b.def, b.x, b.y, b.rot)) ports.set(portKey(p.x, p.y, p.face), { block: b, group: p.group });
  }

  /** Ratio of group 0 for every visited transmitter. */
  const base = new Map<number, number>();
  const netOf = new Map<number, number>();
  const networks = new Map<number, NetworkInfo>();
  let nextNet = 1;

  const facing = (x: number, y: number, face: number): PortRef | undefined =>
    ports.get(portKey(x + DX[face], y + DY[face], opposite(face)));

  for (const start of transmitters) {
    if (base.has(start.id)) continue;
    const net: NetworkInfo = {
      id: nextNet++,
      rpm: 0,
      capacity: 0,
      load: 0,
      stalled: false,
      conflict: false,
      sources: 0,
      consumers: 0,
      blocks: [],
    };
    networks.set(net.id, net);
    base.set(start.id, 1);
    netOf.set(start.id, net.id);
    const queue: KineticBlock[] = [start];
    while (queue.length > 0) {
      const b = queue.shift()!;
      net.blocks.push(b.id);
      const bBase = base.get(b.id)!;
      const ratios = ratiosOf(b.def);
      for (const p of worldPorts(b.def, b.x, b.y, b.rot)) {
        const other = facing(p.x, p.y, p.face);
        if (!other || other.block === b) continue;
        const speed = bBase * (ratios[p.group] ?? 1);
        const otherBase = speed / (ratiosOf(other.block.def)[other.group] ?? 1);
        const known = base.get(other.block.id);
        if (known === undefined) {
          base.set(other.block.id, otherBase);
          netOf.set(other.block.id, net.id);
          queue.push(other.block);
        } else if (Math.abs(known - otherBase) > 1e-6 * Math.max(known, otherBase)) {
          net.conflict = true;
        }
      }
    }
  }

  // Consumers and belts attach to the first port that faces them.
  const consumerRatio = new Map<number, number>();
  for (const c of consumers) {
    for (const f of footprintFaces(c)) {
      const ref = facing(f.x, f.y, f.face);
      if (!ref) continue;
      const ratio = base.get(ref.block.id)! * (ratiosOf(ref.block.def)[ref.group] ?? 1);
      consumerRatio.set(c.id, ratio);
      netOf.set(c.id, netOf.get(ref.block.id)!);
      break;
    }
  }
  const beltRatio = new Map<number, number>();
  const beltNet = new Map<number, number>();
  for (const g of belts) {
    let found = false;
    for (const t of g.tiles) {
      for (let face = 0; face < 4 && !found; face++) {
        const ref = facing(t.x, t.y, face);
        if (!ref) continue;
        beltRatio.set(g.id, base.get(ref.block.id)! * (ratiosOf(ref.block.def)[ref.group] ?? 1));
        beltNet.set(g.id, netOf.get(ref.block.id)!);
        found = true;
      }
      if (found) break;
    }
  }

  // Per network: base speed from the slowest source, then capacity against load.
  const byId = new Map(transmitters.map((t) => [t.id, t]));
  for (const net of networks.values()) {
    let omega = Infinity;
    for (const id of net.blocks) {
      const b = byId.get(id);
      if (!b || b.def.kinetic?.role !== 'source' || !b.active) continue;
      net.sources++;
      omega = Math.min(omega, (b.rpm ?? b.def.kinetic.rpm ?? BASE_RPM) / base.get(id)!);
    }
    if (!Number.isFinite(omega)) omega = 0;
    net.rpm = omega;
    for (const id of net.blocks) {
      const b = byId.get(id);
      if (!b || b.def.kinetic?.role !== 'source' || !b.active) continue;
      net.capacity += (b.def.kinetic.torque ?? 0) * ((omega * base.get(id)!) / BASE_RPM);
    }
  }
  for (const c of consumers) {
    const netId = netOf.get(c.id);
    if (netId === undefined) continue;
    const net = networks.get(netId)!;
    net.consumers++;
    net.load += (c.def.kinetic?.stress ?? 0) * ((net.rpm * consumerRatio.get(c.id)!) / BASE_RPM);
  }
  for (const g of belts) {
    const netId = beltNet.get(g.id);
    if (netId === undefined) continue;
    const net = networks.get(netId)!;
    net.load += BELT_STRESS_PER_TILE * g.tiles.length * ((net.rpm * beltRatio.get(g.id)!) / BASE_RPM);
  }
  for (const net of networks.values()) {
    net.capacity = Math.round(net.capacity * 100) / 100;
    net.load = Math.round(net.load * 100) / 100;
    net.stalled = net.rpm > 0 && net.load > net.capacity + 1e-6;
  }

  const running = (netId: number | undefined): number => {
    if (netId === undefined) return 0;
    const net = networks.get(netId)!;
    return net.stalled || net.conflict ? 0 : net.rpm;
  };
  const speeds = new Map<number, number[]>();
  for (const b of transmitters) {
    const w = running(netOf.get(b.id));
    const bBase = base.get(b.id) ?? 0;
    speeds.set(
      b.id,
      ratiosOf(b.def).map((r) => Math.min(MAX_RPM, w * bBase * r)),
    );
  }
  for (const c of consumers) speeds.set(c.id, [Math.min(MAX_RPM, running(netOf.get(c.id)) * (consumerRatio.get(c.id) ?? 0))]);
  const beltSpeed = new Map<number, number>();
  for (const g of belts) beltSpeed.set(g.id, Math.min(MAX_RPM, running(beltNet.get(g.id)) * (beltRatio.get(g.id) ?? 0)));
  return { networks, speeds, netOf, beltSpeed, beltNet };
}
