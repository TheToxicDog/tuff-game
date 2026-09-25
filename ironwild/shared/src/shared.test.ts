import { describe, expect, it } from 'vitest';
import { ITEMS, itemDef } from './content/items';
import { NODES } from './content/nodes';
import { RECIPES } from './content/recipes';
import { RESEARCH, RESEARCH_BY_ID } from './content/research';
import { SETTLEMENTS, PROFESSION_BY_ID } from './content/settlements';
import { STRUCTURES, STRUCTURE_BY_ID, rotateOffset, structureDef } from './content/structures';
import { fluidFace, fluidJoins } from './factory/fluids';
import { CREATURES } from './content/creatures';
import { CROPS } from './content/crops';
import { addStack, countItem, emptySlots, moveBetween, removeItem, roomFor } from './inventory';
import { midPrice, recoverStock, saleValue, targetStock } from './economy/pricing';
import { generateWorld } from './world/gen';
import { decodeTiles, encodeTiles, TILES } from './world/terrain';
import { newMoveState, stepMovement, type CollisionWorld } from './sim/movement';
import { INPUT_DT } from './constants';

describe('content', () => {
  it('references only existing ids', () => {
    const items = new Set(ITEMS.map((i) => i.id));
    for (const r of RECIPES) {
      for (const s of [...r.inputs, ...r.outputs]) expect(items.has(s.item), `${r.id}: ${s.item}`).toBe(true);
      if (r.research) expect(RESEARCH_BY_ID.has(r.research), `${r.id}: ${r.research}`).toBe(true);
    }
    for (const n of NODES) for (const d of n.drops) expect(items.has(d.item), `${n.id}: ${d.item}`).toBe(true);
    for (const s of STRUCTURES) expect(items.has(s.item), s.id).toBe(true);
    for (const i of ITEMS) if (i.place) expect(STRUCTURE_BY_ID.has(i.place), i.id).toBe(true);
    for (const c of CREATURES) for (const d of c.drops) expect(items.has(d.item), `${c.id}: ${d.item}`).toBe(true);
    for (const c of CROPS) for (const y of c.yields) expect(items.has(y.item)).toBe(true);
    for (const r of RESEARCH) for (const q of r.requires) expect(RESEARCH_BY_ID.has(q)).toBe(true);
    for (const s of SETTLEMENTS) {
      for (const t of s.traders) expect(PROFESSION_BY_ID.has(t), t).toBe(true);
      for (const c of s.contracts) expect(items.has(c.item), c.item).toBe(true);
    }
    for (const p of PROFESSION_BY_ID.values()) for (const id of p.sells) expect(items.has(id), `${p.id}: ${id}`).toBe(true);
  });

  it('makes processing more valuable at every step of the iron ladder (§10)', () => {
    const v = (id: string) => itemDef(id).value;
    expect(v('crushed_iron')).toBeGreaterThan(v('iron_ore'));
    expect(v('iron_concentrate')).toBeGreaterThan(v('crushed_iron'));
    expect(v('iron_plate')).toBeGreaterThan(v('iron_ingot'));
    expect(v('iron_gear')).toBeGreaterThan(v('iron_plate'));
    expect(v('gearbox_unit')).toBeGreaterThan(2 * v('steel_gear'));
  });

  it('rotates footprints clockwise', () => {
    const def = { ...STRUCTURE_BY_ID.get('blast_furnace')!, size: [2, 1] as [number, number] };
    expect(rotateOffset(0, 0, def, 1)).toEqual([0, 0]);
    expect(rotateOffset(1, 0, def, 1)).toEqual([0, 1]);
    expect(rotateOffset(0, 0, def, 2)).toEqual([1, 0]);
  });
});

describe('inventory', () => {
  it('stacks, overflows and removes lowest quality first', () => {
    const slots = emptySlots(3);
    expect(addStack(slots, { id: 'wood', n: 150 })).toBe(0);
    expect(countItem(slots, 'wood')).toBe(150);
    expect(roomFor(slots, { id: 'wood', n: 100 })).toBe(100);
    expect(addStack(slots, { id: 'iron_ingot', n: 5, q: 4 })).toBe(0);
    expect(roomFor(slots, { id: 'iron_ingot', n: 5, q: 1 })).toBe(0);
    const slots2 = emptySlots(4);
    addStack(slots2, { id: 'iron_ingot', n: 3, q: 4 });
    addStack(slots2, { id: 'iron_ingot', n: 3, q: 1 });
    const removed = removeItem(slots2, 'iron_ingot', 4);
    expect(removed).toEqual([
      { id: 'iron_ingot', n: 3, q: 1 },
      { id: 'iron_ingot', n: 1, q: 4 },
    ]);
  });

  it('moves, merges and swaps between slot arrays', () => {
    const a = emptySlots(2);
    const b = emptySlots(2);
    addStack(a, { id: 'stone', n: 30 });
    addStack(b, { id: 'stone', n: 90 });
    expect(moveBetween(a, 0, b, 0)).toBe(true);
    expect(b[0]!.n).toBe(100);
    expect(a[0]!.n).toBe(20);
    b[1] = { id: 'coal', n: 5 };
    expect(moveBetween(a, 0, b, 1)).toBe(true);
    expect(a[0]).toEqual({ id: 'coal', n: 5 });
    expect(b[1]).toEqual({ id: 'stone', n: 20 });
  });
});

describe('pricing', () => {
  const west = SETTLEMENTS[0];
  const stone = SETTLEMENTS[1];
  const ore = itemDef('iron_ore');

  it('lowers the price as a market saturates and recovers over time (§13–14)', () => {
    const target = targetStock(ore, west);
    const normal = midPrice(ore, west, target, target);
    expect(normal).toBeCloseTo(8, 5);
    const flooded = midPrice(ore, west, target * 5, target);
    expect(flooded).toBeLessThan(normal * 0.5);
    const after = recoverStock(target * 5, target, 2);
    expect(after).toBeLessThan(target * 1.3);
    expect(saleValue(ore, west, target, target, 50, 0.9)).toBeLessThan(50 * normal * 0.9);
  });

  it('makes mining towns cheap for ore (§12)', () => {
    const t1 = targetStock(ore, stone);
    const t2 = targetStock(ore, west);
    expect(midPrice(ore, stone, t1, t1)).toBeLessThan(midPrice(ore, west, t2, t2));
  });
});

describe('world generation', () => {
  it('is deterministic and puts settlements on dry land', () => {
    const a = generateWorld(42, 256);
    const b = generateWorld(42, 256);
    expect(a.tiles).toEqual(b.tiles);
    expect(a.nodes).toEqual(b.nodes);
    expect(a.settlements.map((s) => s.id)).toEqual(['westhaven', 'stonehaven', 'greenfield', 'port_meridian']);
    // Port Meridian has its ship moored at the pier.
    expect(a.houses.some((h) => h.style === 'ship')).toBe(true);
    for (const s of a.settlements) {
      const t = a.tiles[Math.floor(s.y) * a.size + Math.floor(s.x)];
      expect(TILES[t].walk).toBe(true);
    }
    expect(decodeTiles(encodeTiles(a.tiles), a.tiles.length)).toEqual(a.tiles);
  });
});

describe('movement', () => {
  const world: CollisionWorld = {
    size: 64,
    solidAt: (x, y) => x === 10 && y >= 0 && y < 64,
    circles: (x, y, range, out) => {
      if (Math.abs(x - 5) < range + 1 && Math.abs(y - 20) < range + 1) out.push({ x: 5, y: 20, r: 1 });
    },
    speedAt: () => 1,
  };

  it('walks, is stopped by walls and slides around circles', () => {
    const s = newMoveState(5, 5);
    for (let i = 0; i < 90; i++) stepMovement(s, { mx: 1, my: 0, sprint: false, dodge: false, slow: false }, INPUT_DT, world);
    expect(s.x).toBeLessThanOrEqual(10 - 0.42 + 1e-9);
    expect(s.x).toBeGreaterThan(9);
    const c = newMoveState(5, 17);
    for (let i = 0; i < 60; i++) stepMovement(c, { mx: 0, my: 1, sprint: false, dodge: false, slow: false }, INPUT_DT, world);
    expect(Math.hypot(c.x - 5, c.y - 20)).toBeGreaterThanOrEqual(1.42 - 1e-6);
  });

  it('sprinting drains stamina and dodging needs movement', () => {
    const s = newMoveState(30, 30);
    stepMovement(s, { mx: 0, my: 0, sprint: false, dodge: true, slow: false }, INPUT_DT, world);
    expect(s.dodgeT).toBe(0);
    for (let i = 0; i < 30; i++) stepMovement(s, { mx: 0, my: -1, sprint: true, dodge: false, slow: false }, INPUT_DT, world);
    expect(s.stamina).toBeLessThan(100);
    stepMovement(s, { mx: 1, my: 0, sprint: false, dodge: true, slow: false }, INPUT_DT, world);
    expect(s.dodgeT).toBeGreaterThan(0);
  });
});

describe('fluids', () => {
  it('connects boilers, pumps and engines through the right faces', () => {
    const boiler = { def: structureDef('boiler'), rot: 1 };
    const pump = { def: structureDef('pump'), rot: 0 };
    const engine = { def: structureDef('steam_engine'), rot: 0 };
    const pipe = { def: structureDef('pipe'), rot: 0 };
    // A boiler facing east lets steam out of its east face and takes water everywhere else.
    expect(fluidFace(boiler.def, 1, 1)).toEqual({ fluid: 'steam', io: 'out' });
    expect(fluidFace(boiler.def, 1, 3)).toEqual({ fluid: 'water', io: 'in' });
    // A pump west of the boiler feeds it directly; an engine east of it takes its steam.
    expect(fluidJoins(pump, boiler, 1)).toBe(true);
    expect(fluidJoins(boiler, engine, 1)).toBe(true);
    // But a pump cannot push water into an engine, and an engine's drive shaft side has no inlet.
    expect(fluidJoins(pump, engine, 3)).toBe(false);
    expect(fluidFace(engine.def, 0, 0)).toBeNull();
    // Pipes join anything with a fluid face.
    expect(fluidJoins(pipe, engine, 1)).toBe(true);
    expect(fluidJoins(pipe, pipe, 2)).toBe(true);
  });
});
