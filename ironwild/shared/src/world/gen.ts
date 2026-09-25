// Procedural world generation (§4, §66). The valley is an island ringed by sea: meadows around
// Westhaven in the middle-west, forest to the north, highlands and the mining village Stonehaven
// to the east, mountains beyond them, fertile plains and Greenfield to the south, marshes in the
// south-west and a desert in the south-east. A river runs from the northern mountains to a
// marsh lake, fed by a creek from the highlands.

import { NODE_BY_ID } from '../content/nodes';
import { SETTLEMENTS, NPC_FIRST_NAMES, type SettlementDef } from '../content/settlements';
import { clamp, dist, fbm, Rng } from '../math';
import { Region, Tile } from './terrain';

export const WORLD_SIZE = 512;

export interface GenNode {
  id: number;
  type: string;
  x: number;
  y: number;
}

export interface GenNpc {
  id: string;
  settlement: string;
  profession: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  /** Prosperity needed before this stall opens. */
  unlock?: number;
}

export interface GenHouse {
  x: number;
  y: number;
  w: number;
  h: number;
  style: 'house' | 'tent' | 'ruin' | 'hall' | 'ship';
  color: number;
}

export interface GenSettlement {
  id: string;
  name: string;
  x: number;
  y: number;
  radius: number;
  npcs: GenNpc[];
}

export interface Landmark {
  id: string;
  name: string;
  kind: 'bandit_camp' | 'ruins' | 'mine' | 'lake' | 'wreck' | 'oil';
  x: number;
  y: number;
}

export interface GeneratedWorld {
  seed: number;
  size: number;
  tiles: Uint8Array;
  regions: Uint8Array;
  nodes: GenNode[];
  settlements: GenSettlement[];
  houses: GenHouse[];
  landmarks: Landmark[];
  spawn: { x: number; y: number };
}

type Anchor = [Region, number, number];

const ANCHORS: Anchor[] = [
  [Region.Meadows, 0.44, 0.5],
  [Region.Meadows, 0.3, 0.42],
  [Region.Meadows, 0.55, 0.58],
  [Region.Forest, 0.22, 0.2],
  [Region.Forest, 0.45, 0.14],
  [Region.Forest, 0.12, 0.42],
  [Region.Forest, 0.62, 0.1],
  [Region.Highlands, 0.72, 0.42],
  [Region.Highlands, 0.66, 0.27],
  [Region.Highlands, 0.78, 0.55],
  [Region.Mountains, 0.9, 0.22],
  [Region.Mountains, 0.93, 0.48],
  [Region.Mountains, 0.8, 0.07],
  [Region.Plains, 0.52, 0.8],
  [Region.Plains, 0.36, 0.72],
  [Region.Plains, 0.64, 0.7],
  [Region.Marsh, 0.14, 0.72],
  [Region.Marsh, 0.22, 0.9],
  [Region.Desert, 0.86, 0.82],
  [Region.Desert, 0.76, 0.92],
];

/** Node densities per 3 × 3 tile cell, by region. */
const NODE_TABLE: Record<number, [string, number][]> = {
  [Region.Meadows]: [
    ['tree', 0.1],
    ['rock', 0.05],
    ['berry_bush', 0.035],
    ['fiber_grass', 0.05],
    ['iron_vein', 0.006],
    ['copper_vein', 0.004],
    ['coal_vein', 0.004],
  ],
  [Region.Forest]: [
    ['tree', 0.22],
    ['pine', 0.14],
    ['hardwood_tree', 0.03],
    ['berry_bush', 0.02],
    ['mushroom_patch', 0.03],
    ['herb_patch', 0.01],
    ['rock', 0.03],
    ['fiber_grass', 0.02],
  ],
  [Region.Highlands]: [
    ['rock', 0.08],
    ['boulder', 0.02],
    ['coal_vein', 0.045],
    ['iron_vein', 0.05],
    ['copper_vein', 0.04],
    ['pine', 0.04],
    ['fiber_grass', 0.02],
  ],
  [Region.Mountains]: [
    ['rock', 0.06],
    ['boulder', 0.04],
    ['rich_iron', 0.02],
    ['iron_vein', 0.03],
    ['coal_vein', 0.03],
    ['silver_vein', 0.02],
    ['gold_vein', 0.01],
    ['gem_rock', 0.008],
    ['pine', 0.02],
  ],
  [Region.Plains]: [
    ['wild_wheat', 0.08],
    ['tree', 0.025],
    ['berry_bush', 0.03],
    ['rock', 0.015],
    ['fiber_grass', 0.04],
    ['herb_patch', 0.005],
  ],
  [Region.Marsh]: [
    ['swamp_tree', 0.1],
    ['reeds', 0.1],
    ['clay_deposit', 0.06],
    ['herb_patch', 0.03],
    ['mushroom_patch', 0.02],
  ],
  [Region.Desert]: [
    ['sand_dune', 0.05],
    ['salt_deposit', 0.03],
    ['cactus', 0.04],
    ['rock', 0.03],
    ['copper_vein', 0.01],
    ['gold_vein', 0.002],
  ],
};

const RIVER: [number, number][] = [
  [0.66, -0.02],
  [0.6, 0.12],
  [0.5, 0.24],
  [0.42, 0.34],
  [0.37, 0.46],
  [0.32, 0.58],
  [0.25, 0.7],
  [0.18, 0.8],
  [0.15, 0.84],
];

const CREEK: [number, number][] = [
  [0.8, 0.37],
  [0.7, 0.33],
  [0.6, 0.3],
  [0.52, 0.27],
  [0.47, 0.28],
];

const SETTLEMENT_SPOTS: Record<string, [number, number]> = {
  westhaven: [0.45, 0.5],
  stonehaven: [0.72, 0.41],
  greenfield: [0.52, 0.79],
};

function catmull(points: [number, number][], samplesPerSegment: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < samplesPerSegment; s++) {
      const t = s / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

export function generateWorld(seed: number, size = WORLD_SIZE): GeneratedWorld {
  const rng = new Rng(seed ^ 0x51ed270b);
  const S = size;
  const tiles = new Uint8Array(S * S);
  const regions = new Uint8Array(S * S);
  const idx = (x: number, y: number) => y * S + x;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S;

  // ——— Regions ———
  const anchors = ANCHORS.map(([r, u, v]) => [r, u + rng.range(-0.025, 0.025), v + rng.range(-0.025, 0.025)] as Anchor);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = x / S + (fbm(x, y, seed + 11, 70, 3) - 0.5) * 0.16;
      const v = y / S + (fbm(x, y, seed + 23, 70, 3) - 0.5) * 0.16;
      let best = 0;
      let bestD = Infinity;
      for (let a = 0; a < anchors.length; a++) {
        const du = u - anchors[a][1];
        const dv = v - anchors[a][2];
        const d = du * du + dv * dv;
        if (d < bestD) {
          bestD = d;
          best = a;
        }
      }
      regions[idx(x, y)] = anchors[best][0];
    }
  }

  // ——— Base terrain ———
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = idx(x, y);
      const region = regions[i];
      let t: number = Tile.Grass;
      switch (region) {
        case Region.Meadows:
          t = Tile.Grass;
          break;
        case Region.Forest:
          t = fbm(x, y, seed + 51, 24, 3) > 0.68 ? Tile.Grass : Tile.Forest;
          break;
        case Region.Highlands:
          t = fbm(x, y, seed + 53, 18, 3) > 0.64 ? Tile.Mountain : Tile.Highland;
          break;
        case Region.Mountains: {
          const ridge = 1 - Math.abs(2 * fbm(x, y, seed + 31, 45, 4) - 1);
          if (ridge > 0.87) t = Tile.Cliff;
          else if (fbm(x, y, seed + 37, 60, 3) > 0.6) t = Tile.Snow;
          else t = Tile.Mountain;
          break;
        }
        case Region.Plains:
          t = Tile.Plains;
          break;
        case Region.Marsh:
          t = fbm(x, y, seed + 41, 12, 3) > 0.64 ? Tile.Water : Tile.Marsh;
          break;
        case Region.Desert:
          t = Tile.Desert;
          break;
      }
      tiles[i] = t;
    }
  }

  // ——— Coast ———
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = idx(x, y);
      const edge = Math.min(x, y, S - 1 - x, S - 1 - y);
      const coast = 9 + fbm(x, y, seed + 5, 40, 3) * 16;
      if (edge < coast) {
        tiles[i] = Tile.DeepWater;
        regions[i] = Region.Ocean;
      } else if (edge < coast + 3 && regions[i] !== Region.Mountains) {
        tiles[i] = Tile.Sand;
      }
    }
  }

  // ——— Rivers and the lake ———
  const paint = (cx: number, cy: number, r: number, fn: (x: number, y: number, d: number) => void) => {
    const x0 = Math.floor(cx - r - 1);
    const x1 = Math.ceil(cx + r + 1);
    const y0 = Math.floor(cy - r - 1);
    const y1 = Math.ceil(cy + r + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inside(x, y)) continue;
        const d = dist(x + 0.5, y + 0.5, cx, cy);
        if (d <= r) fn(x, y, d);
      }
    }
  };

  const riverPath = (points: [number, number][], r0: number, r1: number, wiggle: number, noiseSeed: number) => {
    const pts = points.map(([u, v]) => [u * S + rng.range(-6, 6), v * S + rng.range(-6, 6)] as [number, number]);
    const samples = catmull(pts, 40);
    const water: [number, number, number][] = [];
    for (let k = 0; k < samples.length; k++) {
      const [px, py] = samples[k];
      const [nx, ny] = samples[Math.min(samples.length - 1, k + 1)];
      const dx = nx - px;
      const dy = ny - py;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const off = (fbm(k * 0.9, 0, noiseSeed, 18, 2) - 0.5) * wiggle;
      const cx = px + (-dy / len) * off;
      const cy = py + (dx / len) * off;
      const r = r0 + (r1 - r0) * (k / samples.length);
      water.push([cx, cy, r]);
    }
    for (const [cx, cy, r] of water) {
      paint(cx, cy, r + 1.3, (x, y, d) => {
        const i = idx(x, y);
        const t = tiles[i];
        if (t === Tile.DeepWater || t === Tile.Water) return;
        if (d <= r) tiles[i] = Tile.Water;
        else if (t === Tile.Grass || t === Tile.Forest || t === Tile.Plains || t === Tile.Highland) tiles[i] = Tile.Sand;
      });
    }
  };
  riverPath(RIVER, 1.8, 2.8, 14, seed + 61);
  riverPath(CREEK, 1.2, 1.5, 8, seed + 67);

  const lakeX = 0.14 * S;
  const lakeY = 0.85 * S;
  paint(lakeX, lakeY, 22, (x, y, d) => {
    const n = fbm(x, y, seed + 71, 10, 2);
    const r = 14 + n * 8;
    const i = idx(x, y);
    if (d < r * 0.65) tiles[i] = Tile.DeepWater;
    else if (d < r) tiles[i] = Tile.Water;
    else if (d < r + 1.5 && tiles[i] !== Tile.DeepWater && tiles[i] !== Tile.Water) tiles[i] = Tile.Sand;
  });

  // ——— Settlements ———
  const houses: GenHouse[] = [];
  const settlements: GenSettlement[] = [];
  const clearZones: { x: number; y: number; r: number }[] = [];

  const landAround = (cx: number, cy: number, r: number): boolean => {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if (!inside(x, y)) return false;
        const t = tiles[idx(x, y)];
        if (t === Tile.DeepWater || t === Tile.Water || t === Tile.Cliff) return false;
      }
    }
    return true;
  };

  const findSpot = (u: number, v: number, r: number): [number, number] => {
    const bx = Math.round(u * S);
    const by = Math.round(v * S);
    for (let ring = 0; ring < 60; ring++) {
      for (let a = 0; a < Math.max(1, ring * 6); a++) {
        const ang = (a / Math.max(1, ring * 6)) * Math.PI * 2;
        const x = Math.round(bx + Math.cos(ang) * ring);
        const y = Math.round(by + Math.sin(ang) * ring);
        if (landAround(x, y, r + 3)) return [x, y];
      }
    }
    return [bx, by];
  };

  let npcCounter = 0;
  const buildSettlement = (def: SettlementDef, cx: number, cy: number, rng: Rng): GenSettlement => {
    const R = def.radius;
    const plazaR = R - 4.5;
    clearZones.push({ x: cx + 0.5, y: cy + 0.5, r: R + 3 });
    // Ground: plaza inside, grass ring outside.
    paint(cx + 0.5, cy + 0.5, R + 2, (x, y, d) => {
      const i = idx(x, y);
      if (d <= plazaR) tiles[i] = Tile.Plaza;
      else if (tiles[i] !== Tile.Road) tiles[i] = regions[i] === Region.Desert ? Tile.Desert : Tile.Grass;
    });
    // Houses on a ring around the plaza, leaving four road gaps.
    const houseCount = def.kind === 'town' ? 12 : 7;
    for (let h = 0; h < houseCount; h++) {
      const ang = ((h + 0.5) / houseCount) * Math.PI * 2 + 0.2;
      // Leave gaps where the roads come in (N, E, S, W).
      const quarter = ((ang % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
      if (quarter < 0.3 || quarter > Math.PI / 2 - 0.3) continue;
      const w = rng.int(3, 4);
      const hh = rng.int(3, 4);
      const rr = plazaR + 2.2 + rng.range(0, 1);
      const hx = Math.round(cx + Math.cos(ang) * rr - w / 2);
      const hy = Math.round(cy + Math.sin(ang) * rr - hh / 2);
      let ok = true;
      for (let y = hy; y < hy + hh && ok; y++) {
        for (let x = hx; x < hx + w; x++) {
          const t = inside(x, y) ? tiles[idx(x, y)] : Tile.DeepWater;
          if (t === Tile.Plaza || t === Tile.House || t === Tile.Water || t === Tile.DeepWater) ok = false;
        }
      }
      if (!ok) continue;
      for (let y = hy; y < hy + hh; y++) for (let x = hx; x < hx + w; x++) tiles[idx(x, y)] = Tile.House;
      const roofs = [0xa9553f, 0x8a5a3c, 0x6f4e37, 0x9a4a3a, 0x7a6048];
      houses.push({ x: hx, y: hy, w, h: hh, style: 'house', color: rng.pick(roofs) });
    }
    // Market stalls in a ring inside the plaza.
    const npcs: GenNpc[] = [];
    const ring = Math.max(4, plazaR * 0.62);
    const stalls: { prof: string; unlock?: number }[] = [
      ...def.traders.map((prof) => ({ prof })),
      ...def.growth.map((g) => ({ prof: g.trader, unlock: g.at })),
    ];
    stalls.forEach(({ prof, unlock }, k) => {
      const ang = (k / stalls.length) * Math.PI * 2 - Math.PI / 2 + 0.3;
      const x = cx + 0.5 + Math.cos(ang) * ring;
      const y = cy + 0.5 + Math.sin(ang) * ring;
      npcs.push({
        id: `${def.id}:${prof}`,
        settlement: def.id,
        profession: prof,
        name: NPC_FIRST_NAMES[(npcCounter++ * 7 + seed) % NPC_FIRST_NAMES.length],
        x,
        y,
        angle: Math.atan2(cy + 0.5 - y, cx + 0.5 - x),
        ...(unlock !== undefined ? { unlock } : {}),
      });
    });
    const town: GenSettlement = { id: def.id, name: def.name, x: cx + 0.5, y: cy + 0.5, radius: R, npcs };
    settlements.push(town);
    return town;
  };
  for (const def of SETTLEMENTS) {
    if (def.coastal) continue;
    const [u, v] = SETTLEMENT_SPOTS[def.id] ?? [0.5, 0.5];
    const [cx, cy] = findSpot(u, v, def.radius);
    buildSettlement(def, cx, cy, rng);
  }

  // ——— Roads between settlements ———
  const road = (a: GenSettlement, b: GenSettlement, noiseSeed: number) => {
    const len = dist(a.x, a.y, b.x, b.y);
    const steps = Math.ceil(len * 2);
    const nx = -(b.y - a.y) / len;
    const ny = (b.x - a.x) / len;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      const bend = Math.sin(t * Math.PI) * (fbm(t * 20, 0, noiseSeed, 6, 2) - 0.5) * 30;
      const px = a.x + (b.x - a.x) * t + nx * bend;
      const py = a.y + (b.y - a.y) * t + ny * bend;
      paint(px, py, 1.25, (x, y) => {
        const i = idx(x, y);
        const cur = tiles[i];
        if (cur === Tile.Plaza || cur === Tile.House) return;
        if (cur === Tile.Water || cur === Tile.DeepWater || cur === Tile.Bridge) tiles[i] = Tile.Bridge;
        else tiles[i] = Tile.Road;
      });
    }
  };
  const [west, stone, green] = settlements;
  road(west, stone, seed + 81);
  road(west, green, seed + 83);
  road(green, stone, seed + 85);

  // ——— Landmarks ———
  const landmarks: Landmark[] = [];
  const camp = (id: string, name: string, kind: Landmark['kind'], u: number, v: number, r: number, style: GenHouse['style']) => {
    const [x, y] = findSpot(u, v, r);
    landmarks.push({ id, name, kind, x: x + 0.5, y: y + 0.5 });
    clearZones.push({ x: x + 0.5, y: y + 0.5, r: r + 1 });
    paint(x + 0.5, y + 0.5, r, (tx, ty) => {
      const i = idx(tx, ty);
      if (tiles[i] !== Tile.Water && tiles[i] !== Tile.DeepWater) tiles[i] = Tile.Road;
    });
    const count = style === 'tent' ? 4 : 3;
    for (let k = 0; k < count; k++) {
      const ang = (k / count) * Math.PI * 2 + rng.range(0, 1);
      const hx = Math.round(x + Math.cos(ang) * (r - 2.5) - 1);
      const hy = Math.round(y + Math.sin(ang) * (r - 2.5) - 1);
      const w = style === 'tent' ? 2 : 3;
      for (let ty = hy; ty < hy + w; ty++) for (let tx = hx; tx < hx + w; tx++) if (inside(tx, ty)) tiles[idx(tx, ty)] = Tile.House;
      houses.push({ x: hx, y: hy, w, h: w, style, color: style === 'tent' ? 0x7a5a3a : 0x6e6a64 });
    }
  };
  camp('bandit_camp', 'Bandit Camp', 'bandit_camp', 0.6, 0.13, 7, 'tent');
  camp('old_mill', 'Old Mill Ruins', 'ruins', 0.64, 0.63, 6, 'ruin');
  camp('deepcut', 'Deepcut Mine', 'mine', 0.85, 0.4, 6, 'ruin');
  landmarks.push({ id: 'lake', name: 'Mirror Lake', kind: 'lake', x: lakeX, y: lakeY });

  // ——— Resource nodes ———
  const nodes: GenNode[] = [];
  const GRID = 4;
  const gridW = Math.ceil(S / GRID);
  const grid: number[][] = Array.from({ length: gridW * gridW }, () => []);
  const canPlace = (type: string, x: number, y: number, ignoreZones = false): boolean => {
    const def = NODE_BY_ID.get(type)!;
    const tx = Math.floor(x);
    const ty = Math.floor(y);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (!inside(tx + ox, ty + oy)) return false;
        const t = tiles[idx(tx + ox, ty + oy)];
        if (
          t === Tile.DeepWater ||
          t === Tile.Water ||
          t === Tile.Cliff ||
          t === Tile.Road ||
          t === Tile.Plaza ||
          t === Tile.Bridge ||
          t === Tile.House
        )
          return false;
      }
    }
    if (!ignoreZones) for (const z of clearZones) if (dist(x, y, z.x, z.y) < z.r + 2) return false;
    const gx = Math.floor(x / GRID);
    const gy = Math.floor(y / GRID);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = gx + ox;
        const cy = gy + oy;
        if (cx < 0 || cy < 0 || cx >= gridW || cy >= gridW) continue;
        for (const n of grid[cy * gridW + cx]) {
          const other = nodes[n];
          const od = NODE_BY_ID.get(other.type)!;
          const need = def.solid && od.solid ? def.radius + od.radius + 0.9 : Math.max(def.visual, od.visual) * 0.9;
          if (dist(x, y, other.x, other.y) < need) return false;
        }
      }
    }
    return true;
  };
  const add = (type: string, x: number, y: number) => {
    const id = nodes.length + 1;
    nodes.push({ id, type, x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
    grid[Math.floor(y / GRID) * gridW + Math.floor(x / GRID)].push(nodes.length - 1);
  };

  // Hand-placed starter deposits near Westhaven so the first trip finds iron (§9).
  const starter: [string, number][] = [
    ['iron_vein', 7],
    ['copper_vein', 4],
    ['coal_vein', 5],
    ['rock', 6],
    ['boulder', 2],
    ['berry_bush', 4],
  ];
  for (const [type, count] of starter) {
    let placed = 0;
    for (let attempt = 0; attempt < 400 && placed < count; attempt++) {
      const ang = rng.range(-1.2, 1.2);
      const r = rng.range(west.radius + 10, west.radius + 45);
      const x = west.x + Math.cos(ang) * r;
      const y = west.y + Math.sin(ang) * r;
      if (canPlace(type, x, y)) {
        add(type, x, y);
        placed++;
      }
    }
  }

  // Landmark clusters: salvage at the ruins and the mine, rich ore at the mine.
  const cluster = (lm: Landmark, types: [string, number][]) => {
    for (const [type, count] of types) {
      let placed = 0;
      for (let attempt = 0; attempt < 200 && placed < count; attempt++) {
        const ang = rng.range(0, Math.PI * 2);
        const r = rng.range(3, 10);
        const x = lm.x + Math.cos(ang) * r;
        const y = lm.y + Math.sin(ang) * r;
        if (canPlace(type, x, y, true)) {
          add(type, x, y);
          placed++;
        }
      }
    }
  };
  for (const lm of landmarks) {
    if (lm.kind === 'ruins')
      cluster(lm, [
        ['salvage', 7],
        ['tree', 3],
      ]);
    if (lm.kind === 'mine')
      cluster(lm, [
        ['salvage', 4],
        ['rich_iron', 3],
        ['coal_vein', 3],
        ['silver_vein', 1],
      ]);
  }

  const CELL = 3;
  for (let cy = 0; cy < S; cy += CELL) {
    for (let cx = 0; cx < S; cx += CELL) {
      const region = regions[idx(Math.min(S - 1, cx + 1), Math.min(S - 1, cy + 1))];
      const table = NODE_TABLE[region];
      if (!table) continue;
      // Patchiness: some areas are denser than others.
      const density = 0.55 + fbm(cx, cy, seed + 91, 30, 2) * 0.9;
      const roll = rng.next();
      let acc = 0;
      for (const [type, p] of table) {
        acc += p * density;
        if (roll < acc) {
          const x = cx + rng.range(0.4, CELL - 0.4);
          const y = cy + rng.range(0.4, CELL - 0.4);
          if (canPlace(type, x, y)) add(type, x, y);
          break;
        }
      }
    }
  }

  // ——— Port Meridian (§14) ———
  // The harbour is laid out last, from its own random stream, so the inland world does not shift:
  // a coastal town on the south shore with a pier, a moored ship and a road to Greenfield.
  for (const def of SETTLEMENTS) {
    if (!def.coastal) continue;
    const portRng = new Rng(seed + 131);
    const R = def.radius;
    const oceanNear = (x: number, y: number, r: number): number => {
      let n = 0;
      for (let oy = -r; oy <= r; oy += 2)
        for (let ox = -r; ox <= r; ox += 2)
          if (inside(x + ox, y + oy) && tiles[idx(x + ox, y + oy)] === Tile.DeepWater && regions[idx(x + ox, y + oy)] === Region.Ocean) n++;
      return n;
    };
    let spot: [number, number] | null = null;
    const bx = Math.round(0.62 * S);
    const by = Math.round(0.9 * S);
    for (let ring = 0; ring < 90 && !spot; ring++) {
      for (let a = 0; a < Math.max(1, ring * 6) && !spot; a++) {
        const ang = (a / Math.max(1, ring * 6)) * Math.PI * 2;
        const x = Math.round(bx + Math.cos(ang) * ring);
        const y = Math.round(by + Math.sin(ang) * ring);
        if (!landAround(x, y, R + 1)) continue;
        if (oceanNear(x, y, R + 9) < 6) continue;
        if (settlements.some((t) => dist(x, y, t.x, t.y) < t.radius + R + 30)) continue;
        spot = [x, y];
      }
    }
    if (!spot) continue;
    const [cx, cy] = spot;
    const port = buildSettlement(def, cx, cy, portRng);
    // The pier runs from the square toward the nearest open sea, three tiles wide.
    let best = { dx: 0, dy: 1, d: Infinity };
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ]) {
      for (let d = R - 4; d < R + 20; d++) {
        const x = cx + dx * d;
        const y = cy + dy * d;
        if (!inside(x, y)) break;
        if (tiles[idx(x, y)] === Tile.DeepWater) {
          if (d < best.d) best = { dx, dy, d };
          break;
        }
      }
    }
    if (best.d < Infinity) {
      const end = best.d + 7;
      for (let d = Math.floor(R - 4.5); d <= end; d++) {
        for (let w = -1; w <= 1; w++) {
          const x = cx + best.dx * d + (best.dy !== 0 ? w : 0);
          const y = cy + best.dy * d + (best.dx !== 0 ? w : 0);
          if (inside(x, y) && tiles[idx(x, y)] !== Tile.Plaza) tiles[idx(x, y)] = Tile.Bridge;
        }
      }
      // A merchant ship moored alongside the end of the pier.
      const len = 7;
      const cells: [number, number][] = [];
      for (let a = end - len + 1; a <= end; a++)
        for (let q = 2; q <= 4; q++) cells.push([cx + best.dx * a + (best.dy !== 0 ? q : 0), cy + best.dy * a + (best.dx !== 0 ? q : 0)]);
      const water = (x: number, y: number) => inside(x, y) && (tiles[idx(x, y)] === Tile.DeepWater || tiles[idx(x, y)] === Tile.Water);
      if (cells.every(([x, y]) => water(x, y))) {
        for (const [x, y] of cells) tiles[idx(x, y)] = Tile.House;
        const hx = Math.min(...cells.map((c) => c[0]));
        const hy = Math.min(...cells.map((c) => c[1]));
        const w = Math.max(...cells.map((c) => c[0])) - hx + 1;
        const h = Math.max(...cells.map((c) => c[1])) - hy + 1;
        houses.push({ x: hx, y: hy, w, h, style: 'ship', color: 0x6b4a2a });
      }
    }
    road(green, port, seed + 87);
    clearZones.push({ x: cx + 0.5, y: cy + 0.5, r: R + 3 });
    // Clear resource nodes from the town, the pier and the new road.
    const blocked = (x: number, y: number) => {
      const t = tiles[idx(Math.floor(x), Math.floor(y))];
      return t === Tile.Road || t === Tile.Plaza || t === Tile.House || t === Tile.Bridge || t === Tile.Water || t === Tile.DeepWater;
    };
    for (let i = nodes.length - 1; i >= 0; i--) {
      const n = nodes[i];
      if (
        dist(n.x, n.y, cx + 0.5, cy + 0.5) < R + 4 ||
        blocked(n.x, n.y) ||
        blocked(n.x + 0.8, n.y) ||
        blocked(n.x - 0.8, n.y) ||
        blocked(n.x, n.y + 0.8) ||
        blocked(n.x, n.y - 0.8)
      )
        nodes.splice(i, 1);
    }
  }

  // Shipwrecks on the beaches (salvage, §11). Placed last, from their own random stream, so the
  // rest of the world does not shift.
  const wreckRng = new Rng(seed + 97);
  const wrecks: { x: number; y: number }[] = [];
  const beach = (tx: number, ty: number): boolean => {
    if (!inside(tx, ty) || tiles[idx(tx, ty)] !== Tile.Sand) return false;
    let sea = false;
    for (let oy = -2; oy <= 2; oy++)
      for (let ox = -2; ox <= 2; ox++) {
        if (!inside(tx + ox, ty + oy)) return false;
        const t = tiles[idx(tx + ox, ty + oy)];
        if (t === Tile.DeepWater && regions[idx(tx + ox, ty + oy)] === Region.Ocean) sea = true;
        if (Math.abs(ox) <= 1 && Math.abs(oy) <= 1 && t !== Tile.Sand && t !== Tile.Grass) return false;
      }
    return sea;
  };
  for (let attempt = 0; attempt < 6000 && wrecks.length < 6; attempt++) {
    const tx = Math.floor(wreckRng.range(8, S - 8));
    const ty = Math.floor(wreckRng.range(8, S - 8));
    if (!beach(tx, ty)) continue;
    const x = tx + 0.5;
    const y = ty + 0.5;
    if (wrecks.some((w) => dist(x, y, w.x, w.y) < 70)) continue;
    if (settlements.some((st) => dist(x, y, st.x, st.y) < st.radius + 12)) continue;
    wrecks.push({ x, y });
    add('shipwreck', x, y);
  }
  const WRECK_NAMES = ['Wreck of the Gull', 'Wreck of the Merriweather', 'Wreck of the Iron Maid'];
  wrecks
    .slice(0, WRECK_NAMES.length)
    .forEach((w, i) => landmarks.push({ id: `wreck${i + 1}`, name: WRECK_NAMES[i], kind: 'wreck', x: w.x, y: w.y }));

  // Oil seeps in the desert (§25–27), for pumpjacks. Also last, from their own stream.
  const oilRng = new Rng(seed + 149);
  const seeps: { x: number; y: number }[] = [];
  for (let attempt = 0; attempt < 8000 && seeps.length < 14; attempt++) {
    const x = Math.floor(oilRng.range(10, S - 10));
    const y = Math.floor(oilRng.range(10, S - 10));
    if (regions[idx(x, y)] !== Region.Desert || tiles[idx(x, y)] !== Tile.Desert) continue;
    if (seeps.some((o) => dist(x, y, o.x, o.y) < 22)) continue;
    if (settlements.some((st) => dist(x, y, st.x, st.y) < st.radius + 10)) continue;
    let ok = true;
    for (let oy = -2; oy <= 2 && ok; oy++)
      for (let ox = -2; ox <= 2 && ok; ox++) if (tiles[idx(x + ox, y + oy)] !== Tile.Desert) ok = false;
    if (!ok) continue;
    seeps.push({ x, y });
    // A small irregular pool: the centre, its four neighbours and a couple more.
    const cells: [number, number][] = [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ];
    for (const [ox, oy] of [
      [1, 1],
      [-1, 1],
      [1, -1],
      [-1, -1],
    ])
      if (oilRng.next() < 0.5) cells.push([ox, oy]);
    for (const [ox, oy] of cells) tiles[idx(x + ox, y + oy)] = Tile.Oil;
  }
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i];
    for (const o of seeps)
      if (dist(n.x, n.y, o.x + 0.5, o.y + 0.5) < 3) {
        nodes.splice(i, 1);
        break;
      }
  }
  if (seeps.length) landmarks.push({ id: 'oilfield', name: 'Tar Flats', kind: 'oil', x: seeps[0].x + 0.5, y: seeps[0].y + 0.5 });

  const spawn = { x: west.x, y: west.y + west.radius - 3 };
  return { seed, size: S, tiles, regions, nodes, settlements, houses, landmarks, spawn };
}

/** Tile-space bounds check helper for consumers. */
export function tileIndex(size: number, x: number, y: number): number {
  return clamp(Math.floor(y), 0, size - 1) * size + clamp(Math.floor(x), 0, size - 1);
}
