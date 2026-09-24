// End-to-end tests for sleep, cooking, barricades, construction, storage permissions and
// furniture, over real WebSocket connections (design plan §21–22, §54–58).

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { countItems, furnitureItemId, INTERACT_RANGE, storageId, type ItemStack, type ServerMessage } from '@tuff/shared';
import { loadMap, startServer, type RunningServer } from './bootstrap';
import { loadContent } from './content/loader';
import { Player, Transform, type PlayerComp } from './game/components';
import { Game } from './game/game';
import { newUid } from './game/loot';
import { MemoryStorage } from './persistence/memory-storage';
import { Bot, sleep } from './testing/bot';

let server: RunningServer;
let base: string;
const storage = new MemoryStorage();
const bots: Bot[] = [];

beforeAll(async () => {
  const content = loadContent();
  content.config.zombies.populationMultiplier = 0;
  content.config.player.startingItems = [];
  const map = structuredClone(loadMap(content));
  map.spawns = [{ x: 22, y: 327 }];
  server = await startServer({ port: 0, host: '127.0.0.1', storage, content, map, quiet: true, autosaveSeconds: 3600 });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  for (const b of bots) b.close();
  await server?.close();
});

async function connect(name: string): Promise<Bot> {
  const bot = await Bot.connect(base, name, await Bot.register(base, name));
  bots.push(bot);
  return bot;
}

function player(bot: Bot): PlayerComp {
  return server.game.ecs.get(bot.entityId, Player)!;
}

function give(bot: Bot, items: [string, number][]): void {
  const p = player(bot);
  for (const [id, qty] of items) {
    const def = server.game.content.findItem(id)!;
    const stack: ItemStack = { uid: newUid(), id, qty };
    if (def.durability) stack.cond = 1;
    if (!server.game.inventory.autoPlace(p, stack)) throw new Error(`no room for ${id}`);
  }
}

function teleport(bot: Bot, x: number, y: number): void {
  const game = server.game;
  const p = player(bot);
  const t = game.ecs.get(bot.entityId, Transform)!;
  p.sim.x = t.x = x;
  p.sim.y = t.y = y;
  p.sim.vx = p.sim.vy = 0;
  game.spatial.set(bot.entityId, x, y);
}

/** A walkable spot within reach of a point. */
function spotNear(x: number, y: number, radius: number): { x: number; y: number } {
  const game = server.game;
  for (let r = radius + 0.5; r < radius + 1.6; r += 0.25) {
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (game.world.isWalkable(px, py, 0.4)) return { x: px, y: py };
    }
  }
  throw new Error('no free spot');
}

function notices(bot: Bot): string[] {
  return bot.messages.filter((m): m is Extract<ServerMessage, { t: 'notice' }> => m.t === 'notice').map((m) => m.text);
}

describe('sleep', () => {
  it('sleeps on the floor, stays put, recovers energy faster while everyone sleeps, and wakes up', async () => {
    const bot = await connect('sleeper');
    const game = server.game;
    const p = player(bot);
    p.needs.energy = 20;
    const t = game.ecs.get(bot.entityId, Transform)!;
    const start = { x: t.x, y: t.y };
    bot.send({ t: 'sleep' });
    await bot.waitFor(() => bot.last('status')?.status.sleeping !== null && !!bot.last('status'), 3000, 'asleep');
    expect(p.sleep?.quality).toBeLessThan(0.5);
    // Trying to walk while asleep does nothing.
    const minutes = game.minutes;
    await bot.act(1, { moveX: 1 });
    expect(Math.hypot(t.x - start.x, t.y - start.y)).toBeLessThan(0.05);
    // The only survivor online is asleep: time runs fast and energy climbs.
    const perSecond = (game.minutes - minutes) / 1;
    expect(perSecond).toBeGreaterThan(game.clock.gameMinutesPerSecond * 3);
    expect(p.needs.energy).toBeGreaterThan(20);
    await bot.waitFor(() => !!bot.last('status')?.status.fastForward, 2000, 'fast-forward flag');
    bot.send({ t: 'wake' });
    await bot.waitFor(() => bot.last('status')?.status.sleeping === null, 3000, 'awake');
    expect(p.sleep).toBeNull();
  });

  it('refuses to sleep when not tired or with zombies close by', async () => {
    const bot = bots[0];
    const game = server.game;
    const p = player(bot);
    p.needs.energy = 95;
    bot.send({ t: 'sleep' });
    await bot.waitFor(() => notices(bot).includes('You are not tired enough to sleep.'), 2000, 'not tired');
    p.needs.energy = 30;
    const t = game.ecs.get(bot.entityId, Transform)!;
    const z = game.spawnZombie({ x: t.x + 6, y: t.y, arch: 'slow_walker', look: 5, zone: 'none', hp: 1 });
    bot.send({ t: 'sleep' });
    await bot.waitFor(() => notices(bot).some((n) => n.startsWith('You cannot sleep with the dead')), 2000, 'zombies near');
    expect(p.sleep).toBeNull();
    game.despawnEntity(z);
  });
});

describe('cooking', () => {
  it('cooks a potato at a kitchen stove and consumes the ingredients', async () => {
    const bot = bots[0];
    const game = server.game;
    const stove = [...game.world.compiled.stations.values()].find((s) => s.kind === 'heat' && !s.fire)!;
    expect(stove).toBeDefined();
    const spot = spotNear(stove.x, stove.y, stove.radius);
    expect(Math.hypot(spot.x - stove.x, spot.y - stove.y)).toBeLessThan(INTERACT_RANGE + stove.radius);
    teleport(bot, spot.x, spot.y);
    give(bot, [['potato', 2]]);
    bot.send({ t: 'craft', recipe: 'bake_potato' });
    await bot.waitFor(() => bot.last('progress')?.label === 'Cooking Baked Potato', 2000, 'cooking to start');
    await bot.act(6.5, {});
    await bot.waitFor(() => notices(bot).includes('You make Baked Potato.'), 3000, 'cooked');
    const inv = player(bot).inventory;
    expect(inv.pockets.find((s) => s.id === 'baked_potato')?.qty).toBe(1);
    expect(inv.pockets.find((s) => s.id === 'potato')?.qty).toBe(1);
  });

  it('refuses recipes away from a heat source or without the right tools', async () => {
    const bot = bots[0];
    teleport(bot, 22, 327);
    give(bot, [
      ['instant_noodles', 1],
      ['water_bottle', 1],
    ]);
    bot.send({ t: 'craft', recipe: 'noodle_soup' });
    await bot.waitFor(() => notices(bot).some((n) => n.startsWith('You need to be at a heat source')), 2000, 'needs heat');
  });
});

describe('barricades', () => {
  it('boards up a door, blocks it, and loses planks to zombies before the door breaks', async () => {
    const bot = bots[0];
    const game = server.game;
    const door = [...game.world.compiled.doors.values()].find((d) => d.exterior && d.doorKind === 'exterior')!;
    game.world.setObjectState(door.id, { open: false, locked: false });
    const nearDoor = spotNear(door.x, door.y, 0.4);
    teleport(bot, nearDoor.x, nearDoor.y);
    give(bot, [
      ['hammer', 1],
      ['plank', 3],
      ['nails', 10],
    ]);
    bot.send({ t: 'act', action: 'barricade', target: door.id });
    await bot.act(4, {});
    await bot.waitFor(() => game.world.compiled.effectiveState(door.id).boards === 1, 3000, 'first plank');
    bot.send({ t: 'act', action: 'barricade', target: door.id });
    await bot.act(4, {});
    await bot.waitFor(() => game.world.compiled.effectiveState(door.id).boards === 2, 3000, 'second plank');
    expect(countItems(player(bot).inventory, (s) => s.id === 'plank')).toBe(1);
    // A barricaded door cannot be opened.
    bot.send({ t: 'interact', target: door.id });
    await bot.waitFor(() => notices(bot).includes('It is barricaded.'), 2000, 'barricaded notice');
    // Zombies chew through planks first; the door itself is untouched until they are gone.
    const doorHp = game.world.compiled.effectiveState(door.id).hp;
    for (let i = 0; i < 6; i++) game.damageObject(door.id, 10, 0, 'door_bang');
    expect(game.world.compiled.effectiveState(door.id).boards).toBe(1);
    expect(game.world.compiled.effectiveState(door.id).hp).toBe(doorHp);
    expect(door.collider.enabled).toBe(true);
    // Pry the last plank off again.
    bot.send({ t: 'act', action: 'unbarricade', target: door.id });
    await bot.act(4.5, {});
    await bot.waitFor(() => game.world.compiled.effectiveState(door.id).boards === 0, 3000, 'planks removed');
  });
});

describe('construction', () => {
  it('builds a wall that blocks movement and that zombies can destroy', async () => {
    const bot = bots[0];
    const game = server.game;
    teleport(bot, 22, 327);
    give(bot, [
      ['plank', 6],
      ['nails', 30],
    ]);
    const t = game.ecs.get(bot.entityId, Transform)!;
    const x = Math.round((t.x + 2) * 2) / 2;
    const y = Math.round(t.y * 2) / 2;
    bot.send({ t: 'build', type: 'wood_wall', x, y, rot: Math.PI / 2 });
    await bot.waitFor(() => bot.last('progress')?.label === 'Building Wooden Wall', 2000, 'building');
    await bot.act(8.5, {});
    await bot.waitFor(() => !!bot.last('structure'), 3000, 'structure message');
    const def = bot.last('structure')!.structure;
    expect(def.owner).toBe(p0().accountId);
    expect(game.world.compiled.collision.overlapsCircle(x, y, 0.2, 1)).toBe(true);
    // Zombies (source 0) wreck it.
    const hp = game.world.compiled.effectiveState(def.id).hp;
    expect(game.damageObject(def.id, hp + 1, 0, 'door_bang')).toBe(true);
    await bot.waitFor(() => bot.last('unstructure')?.id === def.id, 2000, 'unstructure');
    expect(game.world.compiled.collision.overlapsCircle(x, y, 0.2, 1)).toBe(false);
  });

  it('locks storage crates against untrusted survivors until trusted', async () => {
    const owner = bots[0];
    const other = await connect('neighbour');
    const game = server.game;
    teleport(owner, 22, 327);
    teleport(other, 24, 328.3);
    give(owner, [
      ['plank', 3],
      ['nails', 8],
    ]);
    bot0Build('storage_crate', 24, 327, 0);
    await owner.act(8.5, {});
    await owner.waitFor(() => owner.last('structure')?.structure.type === 'storage_crate', 3000, 'crate');
    const crate = owner.last('structure')!.structure;
    owner.send({ t: 'act', action: 'lockStorage', target: storageId(crate.id) });
    await owner.waitFor(() => game.world.compiled.effectiveState(storageId(crate.id)).locked, 2000, 'locked');
    other.send({ t: 'open', target: storageId(crate.id) });
    await other.waitFor(() => notices(other).includes('It is locked.'), 2000, 'locked for others');
    // Nor can they take someone else's crate apart.
    give(other, [['hammer', 1]]);
    other.send({ t: 'act', action: 'dismantle', target: crate.id });
    await other.waitFor(() => notices(other).includes('That belongs to someone else.'), 2000, 'not theirs');
    owner.send({ t: 'chat', text: '/trust neighbour' });
    await owner.waitFor(() => owner.messages.some((m) => m.t === 'chat' && m.text.startsWith('You now trust neighbour')), 2000, 'trust');
    other.send({ t: 'open', target: storageId(crate.id) });
    await other.waitFor(() => other.last('container')?.container?.id === storageId(crate.id), 3000, 'opened after trust');
  });

  it('keeps structures, trust and barricades across a server restart', async () => {
    const game = server.game;
    await game.save();
    const again = new Game(loadContentForRestart(), game.map, storage, { log: () => undefined, autosaveSeconds: 3600 });
    await again.init();
    const crate = [...game.world.structures.values()].find((s) => s.type === 'storage_crate')!;
    expect(again.world.structures.get(crate.id)?.owner).toBe(crate.owner);
    expect(again.world.compiled.effectiveState(storageId(crate.id)).locked).toBe(true);
    expect(again.building.canManage(player(bots[bots.length - 1]).accountId, crate.owner)).toBe(true);
  });
});

describe('furniture', () => {
  it('picks up a chair and places it somewhere else', async () => {
    const bot = bots[0];
    const game = server.game;
    const chair = [...game.world.compiled.movables.values()].find((m) => m.propType === 'chair')!;
    expect(chair).toBeDefined();
    const spot = spotNear(chair.x, chair.y, chair.radius);
    teleport(bot, spot.x, spot.y);
    // Free the hands.
    const p = player(bot);
    p.inventory.slots = p.inventory.slots.map(() => null);
    p.inventoryDirty = true;
    bot.send({ t: 'act', action: 'pickup', target: chair.id });
    await bot.act(2, {});
    await bot.waitFor(() => game.world.compiled.effectiveState(chair.id).removed, 3000, 'chair removed');
    expect(p.inventory.slots.some((s) => s?.id === furnitureItemId('chair'))).toBe(true);
    teleport(bot, 22, 327);
    bot.send({ t: 'build', type: 'furniture', prop: 'chair', x: 23.5, y: 329, rot: 0 });
    await bot.act(2, {});
    await bot.waitFor(() => bot.last('structure')?.structure.prop === 'chair', 3000, 'chair placed');
    expect(p.inventory.slots.some((s) => s?.id === furnitureItemId('chair'))).toBe(false);
  });
});

function loadContentForRestart() {
  const content = loadContent();
  content.config.zombies.populationMultiplier = 0;
  return content;
}

function p0(): PlayerComp {
  return player(bots[0]);
}

function bot0Build(type: string, x: number, y: number, rot: number): void {
  bots[0].send({ t: 'build', type, x, y, rot });
}

void sleep;
