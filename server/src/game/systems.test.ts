// Unit tests for server systems that run without network clients: navigation through doorways,
// noise attracting zombies, the empty-server pause and zombie population bookkeeping.

import { beforeAll, describe, expect, it } from 'vitest';
import { buildingTransform, isInsideBuilding, localToWorld, splitWall } from '@tuff/shared';
import { loadMap } from '../bootstrap';
import { loadContent } from '../content/loader';
import { MemoryStorage } from '../persistence/memory-storage';
import { Transform, Zombie } from './components';
import { Game } from './game';

let game: Game;

beforeAll(async () => {
  const content = loadContent();
  content.config.zombies.populationMultiplier = 0;
  game = new Game(content, structuredClone(loadMap(content)), new MemoryStorage(), { log: () => undefined, autosaveSeconds: 3600 });
  await game.init();
});

/** An exterior door of a house, with points two meters outside and inside it. */
function houseDoor() {
  for (const door of game.world.compiled.doors.values()) {
    if (!door.exterior || door.doorKind === 'garage') continue;
    const b = game.map.buildings.find((x) => x.id === door.buildingId);
    if (!b || b.type !== 'house') continue;
    const nx = -Math.sin(door.angle);
    const ny = Math.cos(door.angle);
    const a = { x: door.x + nx * 2, y: door.y + ny * 2 };
    const c = { x: door.x - nx * 2, y: door.y - ny * 2 };
    const aIn = isInsideBuilding(b, a.x, a.y);
    const cIn = isInsideBuilding(b, c.x, c.y);
    if (aIn === cIn) continue;
    return { door, building: b, outside: aIn ? c : a, inside: aIn ? a : c };
  }
  throw new Error('no house door found');
}

describe('navigation', () => {
  it('routes zombies through a doorway into a house', () => {
    const { door, outside, inside } = houseDoor();
    const path = game.nav.findPath(outside.x, outside.y, inside.x, inside.y);
    expect(path).not.toBeNull();
    // The path passes the doorway and ends at the goal.
    let nearDoor = false;
    for (let i = 0; i < path!.length; i += 2) {
      if (Math.hypot(path![i] - door.x, path![i + 1] - door.y) < 1.2) nearDoor = true;
    }
    expect(nearDoor).toBe(true);
    expect(path![path!.length - 2]).toBeCloseTo(inside.x, 5);
    expect(path![path!.length - 1]).toBeCloseTo(inside.y, 5);
  });

  it('treats walls as blocked and open ground as walkable', () => {
    const { building } = houseDoor();
    const t = buildingTransform(building);
    const wall = building.walls.find((w) => w.exterior)!;
    const seg = splitWall(wall.x1, wall.y1, wall.x2, wall.y2, wall.t, [...building.doors, ...building.windows])[0];
    const mid = localToWorld(t, (seg.x1 + seg.x2) / 2, (seg.y1 + seg.y2) / 2);
    expect(game.nav.walkable(mid.x, mid.y)).toBe(false);
    expect(game.nav.walkable(game.map.spawns[0].x, game.map.spawns[0].y)).toBe(true);
    // The map edge is impassable.
    expect(game.nav.walkable(0.2, 0.2)).toBe(false);
  });
});

describe('noise', () => {
  it('sends zombies within earshot to investigate, and leaves distant ones alone', () => {
    const x = game.map.spawns[0].x;
    const y = game.map.spawns[0].y;
    const near = game.spawnZombie({ x: x + 10, y, arch: 'walker', look: 1, zone: 'none', hp: 1 });
    const far = game.spawnZombie({ x: x + 60, y, arch: 'walker', look: 2, zone: 'none', hp: 1 });
    // A pistol shot is roughly intensity 55: heard ~33 m away in the open.
    game.noise.emit(x, y, 55);
    game.noise.process();
    const zn = game.ecs.get(near, Zombie)!;
    const zf = game.ecs.get(far, Zombie)!;
    expect(zn.state).toBe('investigate');
    expect(Math.hypot(zn.goalX - x, zn.goalY - y)).toBeLessThan(6);
    expect(zf.state).not.toBe('investigate');
    game.despawnEntity(near);
    game.despawnEntity(far);
  });

  it('muffles noise behind a closed door', () => {
    const { door, inside, outside } = houseDoor();
    const dx = outside.x - inside.x;
    const dy = outside.y - inside.y;
    const len = Math.hypot(dx, dy);
    // Nine meters from the zombie, straight out through the doorway.
    const sx = inside.x + (dx / len) * 9;
    const sy = inside.y + (dy / len) * 9;
    const hear = (open: boolean): string => {
      game.world.setObjectState(door.id, { open, locked: false });
      const z = game.spawnZombie({ x: inside.x, y: inside.y, arch: 'walker', look: 3, zone: 'none', hp: 1 });
      // Intensity 17 carries ~10 m in the open, ~6 m through walls.
      game.noise.emit(sx, sy, 17);
      game.noise.process();
      const state = game.ecs.get(z, Zombie)!.state;
      game.despawnEntity(z);
      return state;
    };
    expect(hear(true)).toBe('investigate');
    expect(hear(false)).not.toBe('investigate');
    game.world.setObjectState(door.id, {});
  });
});

describe('world clock', () => {
  it('pauses the world while nobody is online', () => {
    const minutes = game.minutes;
    const z = game.spawnZombie({ x: 100, y: 100, arch: 'runner', look: 4, zone: 'none', hp: 1 });
    const t = game.ecs.get(z, Transform)!;
    const before = { x: t.x, y: t.y };
    for (let i = 0; i < 40; i++) game.step();
    expect(game.minutes).toBe(minutes);
    expect(t.x).toBe(before.x);
    expect(t.y).toBe(before.y);
    game.despawnEntity(z);
  });
});
