import { describe, expect, it } from 'vitest';
import { ContentRegistry } from '../content/registry';
import type { ConstructionDef, ItemDef, PropDef, RecipeDef } from '../content/types';
import { checkRecipe, planConsumption } from '../items/crafting';
import { emptyInventory } from '../items/inventory';
import { createBody, createNeeds, sleepProblem, updateBodyGameTime } from '../sim/body';
import { Rng } from '../math/rng';
import { Block } from './collision';
import { BOARD_HP, CompiledWorld, storageId } from './compile';
import type { BuildingDef } from './map';
import { placementProblem, snapPlacement, structureShape } from './structures';

const item = (id: string, tags: string[] = [], extra: Partial<ItemDef> = {}): ItemDef => ({
  id,
  name: id,
  category: 'material',
  weight: 1,
  volume: 1,
  stackSize: 10,
  tags,
  ...extra,
});

const wall: ConstructionDef = {
  id: 'wall',
  name: 'Wall',
  category: 'walls',
  kind: 'wall',
  w: 2,
  h: 0.2,
  blocks: ['player', 'zombie', 'sight', 'bullet'],
  material: 'wood',
  hp: 200,
  time: 5,
  materials: [{ item: 'plank', qty: 2 }],
  tools: ['hammer'],
  style: 'wood_wall',
};
const door: ConstructionDef = { ...wall, id: 'door', kind: 'door', opening: 1 };
const crate: ConstructionDef = { ...wall, id: 'crate', kind: 'container', w: 1, h: 0.7, container: { name: 'Crate', volume: 50 } };
const chair: PropDef = {
  id: 'chair',
  name: 'Chair',
  shape: 'box',
  w: 0.5,
  h: 0.5,
  blocks: ['player'],
  material: 'wood',
  layer: 'low',
  style: 'chair',
  movable: { weight: 4 },
};
const stew: RecipeDef = {
  id: 'stew',
  name: 'Stew',
  category: 'cooking',
  station: 'heat',
  time: 5,
  inputs: [
    { tag: 'vegetable', qty: 3 },
    { item: 'water', qty: 1 },
  ],
  tools: ['pot'],
  outputs: [{ item: 'stew', qty: 2 }],
};

const content = new ContentRegistry({
  hash: 't',
  items: [item('plank'), item('carrot', ['vegetable']), item('potato', ['vegetable']), item('water'), item('pot', ['pot']), item('stew')],
  zombies: [],
  props: [chair],
  recipes: [stew],
  constructions: [wall, door, crate],
});

describe('crafting requirements', () => {
  it('checks ingredients by tag, tools and stations', () => {
    const inv = emptyInventory();
    inv.pockets.push({ uid: 1, id: 'carrot', qty: 2 }, { uid: 2, id: 'potato', qty: 1 }, { uid: 3, id: 'water', qty: 1 });
    expect(checkRecipe(content, inv, stew, new Set(['heat'])).problem).toBe('You need a cooking pot.');
    inv.pockets.push({ uid: 4, id: 'pot', qty: 1 });
    expect(checkRecipe(content, inv, stew, new Set()).problem).toMatch(/heat source/);
    const ok = checkRecipe(content, inv, stew, new Set(['heat']));
    expect(ok.ok).toBe(true);
    expect(ok.inputs[0]).toMatchObject({ have: 3, need: 3 });
  });

  it('plans consumption across stacks without touching tools', () => {
    const inv = emptyInventory();
    inv.pockets.push(
      { uid: 1, id: 'carrot', qty: 2 },
      { uid: 2, id: 'potato', qty: 5 },
      { uid: 3, id: 'water', qty: 1 },
      { uid: 4, id: 'pot', qty: 1 },
    );
    const plan = planConsumption(content, inv, stew.inputs)!;
    expect(plan.reduce((n, p) => n + p.qty, 0)).toBe(4);
    expect(plan.some((p) => p.uid === 4)).toBe(false);
    inv.pockets.pop();
    inv.pockets.splice(2, 1);
    expect(planConsumption(content, inv, stew.inputs)).toBeNull();
  });
});

describe('structures', () => {
  it('snaps placement to the grid and rotation steps', () => {
    expect(snapPlacement(10.26, 4.74, 1.5)).toEqual({ x: 10.5, y: 4.5, rot: Math.round((Math.PI / 2) * 1e6) / 1e6 });
  });

  it('compiles doors, storage and blocking walls, and rejects overlapping placements', () => {
    const world = new CompiledWorld(content);
    world.addStructure({ id: 's1', type: 'wall', x: 20, y: 20, rot: 0, owner: 'a', ownerName: 'A' });
    world.addStructure({ id: 's2', type: 'door', x: 22, y: 20, rot: 0, owner: 'a', ownerName: 'A' });
    world.addStructure({ id: 's3', type: 'crate', x: 20, y: 24, rot: 0, owner: 'a', ownerName: 'A' });
    expect(world.collision.overlapsCircle(20, 20, 0.05, Block.Player)).toBe(true);
    expect(world.doors.get('s2.door')?.structureId).toBe('s2');
    expect(world.containers.get(storageId('s3'))?.owner).toBe('a');
    const ctx = { content, collision: world.collision, mapWidth: 100, mapHeight: 100 };
    // End to end with the first wall is fine; through it is not.
    expect(placementProblem(ctx, 'wall', undefined, 18, 20, 0, { x: 18, y: 21 })).toBeNull();
    expect(placementProblem(ctx, 'wall', undefined, 20, 20, Math.PI / 2, { x: 18, y: 21 })).toBe('Something is in the way.');
    expect(placementProblem(ctx, 'wall', undefined, 60, 60, 0, { x: 18, y: 21 })).toBe('Too far away.');
    expect(structureShape(content, 'furniture', 'chair')?.kind).toBe('furniture');
    world.removeElement('s2');
    expect(world.doors.has('s2.door')).toBe(false);
  });

  it('barricades close a doorway even when the door is broken, and removed furniture stops blocking', () => {
    const b: BuildingDef = {
      id: 'b',
      type: 'house',
      x: 50,
      y: 50,
      w: 6,
      h: 6,
      rot: 0,
      exterior: { material: 'wood', color: '#888888' },
      rooms: [{ id: 'r', type: 'living', x: 0, y: 0, w: 6, h: 6, floor: 'wood' }],
      walls: [],
      doors: [{ id: 'd', x: 3, y: 6, w: 1, angle: 0, kind: 'wood', hinge: 1, swing: 1 }],
      windows: [],
      props: [{ id: 'c', type: 'chair', x: 2, y: 2, rot: 0 }],
      roof: { style: 'flat', color: '#333333', axis: 'x' },
    };
    const world = new CompiledWorld(content);
    world.addBuilding(b);
    const d = world.doors.get('d')!;
    world.setState('d', { broken: true });
    expect(d.collider.enabled).toBe(false);
    world.setState('d', { broken: true, boards: 2, boardHp: BOARD_HP * 2 });
    expect(d.collider.enabled).toBe(true);
    expect(d.collider.flags & Block.Sight).toBeTruthy();
    expect(world.collision.overlapsCircle(49, 49, 0.1, Block.Player)).toBe(true);
    world.setState('c', { removed: true });
    expect(world.collision.overlapsCircle(49, 49, 0.1, Block.Player)).toBe(false);
  });
});

describe('sleep', () => {
  it('restores energy faster in a bed than on the floor and blocks sleep when rested', () => {
    const bed = createNeeds();
    const floor = createNeeds();
    bed.energy = floor.energy = 20;
    updateBodyGameTime(createBody(), bed, 60, 0, new Rng(1), 1);
    updateBodyGameTime(createBody(), floor, 60, 0, new Rng(1), 0.25);
    expect(bed.energy).toBeGreaterThan(floor.energy);
    expect(floor.energy).toBeGreaterThan(20);
    const awake = createNeeds();
    updateBodyGameTime(createBody(), awake, 60, 0, new Rng(1));
    expect(awake.energy).toBeLessThan(createNeeds().energy);
    expect(sleepProblem(createBody(), createNeeds(), 0)).toMatch(/not tired/);
    expect(sleepProblem(createBody(), { ...createNeeds(), energy: 30 }, 0)).toBeNull();
  });
});
