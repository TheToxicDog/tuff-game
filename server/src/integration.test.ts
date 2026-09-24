// End-to-end tests over real HTTP and WebSocket connections with headless bot clients.
// The first test is the design plan's Phase 0 success condition: two clients connect and see
// each other's characters move through the same world.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Buttons, CorpseFlags, EntityKind, NetEventType, type ItemStack } from '@tuff/shared';
import { loadMap, startServer, type RunningServer } from './bootstrap';
import { loadContent } from './content/loader';
import { Corpse, Player, Transform } from './game/components';
import { MemoryStorage } from './persistence/memory-storage';
import { Bot, sleep } from './testing/bot';

let server: RunningServer;
let base: string;
const bots: Bot[] = [];

beforeAll(async () => {
  const content = loadContent();
  content.config.zombies.populationMultiplier = 0;
  content.config.player.startingItems = [
    { item: 'water_bottle', qty: 1 },
    { item: 'pistol_9mm', qty: 1, slot: 1 },
    { item: 'ammo_9mm', qty: 30 },
  ];
  const map = structuredClone(loadMap(content));
  map.spawns = [{ x: 22, y: 327 }];
  server = await startServer({
    port: 0,
    host: '127.0.0.1',
    storage: new MemoryStorage(),
    content,
    map,
    quiet: true,
    autosaveSeconds: 3600,
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  for (const b of bots) b.close();
  await server?.close();
});

async function connect(name: string): Promise<Bot> {
  const token = await Bot.register(base, name);
  const bot = await Bot.connect(base, name, token);
  bots.push(bot);
  return bot;
}

describe('multiplayer foundation', () => {
  it('lets two clients see each other move (Phase 0 success condition)', async () => {
    const a = await connect('alice');
    const b = await connect('bob');
    await b.waitFor(() => b.entities.has(a.entityId), 3000, 'alice to appear for bob');
    await a.waitFor(() => a.entities.has(b.entityId), 3000, 'bob to appear for alice');
    expect(b.entities.get(a.entityId)?.kind).toBe(EntityKind.Player);
    expect(b.entities.get(a.entityId)?.name).toBe('alice');
    // Chunks around the spawn were streamed.
    expect(a.chunks.size).toBeGreaterThanOrEqual(4);

    const startX = b.entities.get(a.entityId)!.x;
    await a.act(1.0, { moveX: 1 });
    await b.waitFor(() => b.entities.get(a.entityId)!.x > startX + 2.5, 3000, 'alice to move east');
    // The mover's own authoritative state agrees and acknowledges its inputs.
    await a.waitFor(() => a.ackSeq >= 60, 2000, 'input acknowledgement');
    expect(Math.abs(a.self!.x - b.entities.get(a.entityId)!.x)).toBeLessThan(0.5);
  });

  it('rejects connections without a valid session', async () => {
    await expect(Bot.connect(base, 'nobody', 'x'.repeat(43))).rejects.toThrow();
  });

  it('resolves lag-compensated shots against zombies', async () => {
    const a = bots[0];
    const b = bots[1];
    const game = server.game;
    // Equip the pistol and settle precision aim.
    await a.act(0.6, { slot: 1 });
    const pt = game.ecs.get(a.entityId, Transform)!;
    const zid = game.spawnZombie({ x: pt.x + 5, y: pt.y, arch: 'slow_walker', look: 7, zone: 'none', hp: 1 });
    await a.waitFor(() => a.entities.has(zid), 2000, 'zombie replicated');
    for (let i = 0; i < 12 && game.ecs.isAlive(zid); i++) {
      const zt = game.ecs.get(zid, Transform);
      const aim = zt ? Math.atan2(zt.y - pt.y, zt.x - pt.x) : 0;
      await a.act(0.2, { slot: 1, aim, buttons: Buttons.Aim });
      await a.act(0.1, { slot: 1, aim, buttons: Buttons.Aim | Buttons.Attack });
    }
    await sleep(200);
    expect(game.ecs.isAlive(zid)).toBe(false);
    expect(game.ecs.get(a.entityId, Player)!.stats.kills).toBe(1);
    // Bob heard the shots; Alice did not get her own predicted shots echoed back.
    expect(b.events.some((e) => e.type === NetEventType.Shot && e.shooter === a.entityId)).toBe(true);
    expect(a.events.some((e) => e.type === NetEventType.Shot && e.shooter === a.entityId)).toBe(false);
    expect(a.events.some((e) => e.type === NetEventType.Hit && e.source === a.entityId)).toBe(true);
    // The body stays in the world.
    await a.waitFor(() => [...a.entities.values()].some((e) => e.kind === EntityKind.Corpse), 2000, 'corpse');
    // Ammunition was spent from the magazine.
    expect(a.self!.magAmmo).toBeLessThan(15);
  });

  it('zombies notice, chase and wound a player standing in the open', async () => {
    const c = await connect('carol');
    const game = server.game;
    const p = game.ecs.get(c.entityId, Player)!;
    const t = game.ecs.get(c.entityId, Transform)!;
    // Move Carol away from the others so the zombie has only one target.
    for (let dx = 30; dx < 80; dx += 2) {
      if (game.world.isWalkable(t.x + dx, t.y, 0.5) && game.world.isWalkable(t.x + dx + 4, t.y, 0.5)) {
        p.sim.x = t.x = t.x + dx;
        break;
      }
    }
    game.spatial.set(c.entityId, t.x, t.y);
    const zid = game.spawnZombie({ x: t.x + 4, y: t.y, arch: 'walker', look: 11, zone: 'none', hp: 1 });
    game.ecs.get(zid, Transform)!.angle = Math.PI;
    await c.act(0.2, {});
    const deadline = Date.now() + 15_000;
    while (p.body.health >= 100 && Date.now() < deadline) await c.act(0.25, {});
    expect(p.body.health).toBeLessThan(100);
    expect(p.body.wounds.length).toBeGreaterThan(0);
    await c.waitFor(
      () => c.events.some((e) => e.type === NetEventType.Hit && e.target === c.entityId && e.source === zid),
      2000,
      'hit event',
    );
    await c.waitFor(() => !!c.last('status') && c.last('status')!.status.wounds.length > 0, 2000, 'status with wounds');
    game.despawnEntity(zid);
  });

  it('treats a wound with a bandage from the inventory', async () => {
    const c = bots.find((b) => b.username === 'carol')!;
    const game = server.game;
    const p = game.ecs.get(c.entityId, Player)!;
    const wound = p.body.wounds.find((w) => w.type !== 'bruise' && w.type !== 'fracture') ?? p.body.wounds[0];
    expect(wound).toBeDefined();
    wound.bandage = 0;
    p.inventory.pockets.push({ uid: 515151, id: 'bandage', qty: 1 });
    p.inventoryDirty = true;
    c.send({ t: 'use', uid: 515151, woundId: wound.id });
    await c.waitFor(() => c.last('progress')?.label === 'Treating Bandage', 2000, 'treatment to start');
    // Standing still while the dressing is applied.
    await c.act(3, {});
    await c.waitFor(() => !!c.last('status')?.status.wounds.find((w) => w.id === wound.id && w.bandage > 0), 3000, 'dressed wound');
    expect(p.inventory.pockets.some((s) => s.uid === 515151)).toBe(false);
  });

  it('searches containers and moves loot into the inventory', async () => {
    const a = bots[0];
    const game = server.game;
    const p = game.ecs.get(a.entityId, Player)!;
    const t = game.ecs.get(a.entityId, Transform)!;
    // Pick the closest world container and stand next to it.
    const containers = [...game.world.compiled.containers.values()].sort(
      (c1, c2) => Math.hypot(c1.x - t.x, c1.y - t.y) - Math.hypot(c2.x - t.x, c2.y - t.y),
    );
    let target: (typeof containers)[number] | undefined;
    let spot: { x: number; y: number } | undefined;
    for (const c of containers) {
      for (let k = 0; k < 16 && !spot; k++) {
        const ang = (k / 16) * Math.PI * 2;
        const x = c.x + Math.cos(ang) * (c.radius + 0.6);
        const y = c.y + Math.sin(ang) * (c.radius + 0.6);
        if (game.world.isWalkable(x, y, 0.35)) spot = { x, y };
      }
      if (spot) {
        target = c;
        break;
      }
    }
    expect(target).toBeDefined();
    p.sim.x = t.x = spot!.x;
    p.sim.y = t.y = spot!.y;
    game.spatial.set(a.entityId, t.x, t.y);
    game.world.setContainer(target!.id, { items: [{ uid: 424242, id: 'canned_beans', qty: 2 }] });
    a.send({ t: 'open', target: target!.id });
    await a.waitFor(() => !!a.last('container')?.container, 4000, 'container contents');
    expect(a.last('container')!.container!.items[0].id).toBe('canned_beans');
    a.send({ t: 'move', uid: 424242, from: { kind: 'container', id: target!.id }, to: { kind: 'pockets' } });
    await a.waitFor(
      () => !!a.last('inventory')?.inventory.pockets.some((s: ItemStack) => s.id === 'canned_beans'),
      2000,
      'beans in pockets',
    );
    expect(game.world.containers.get(target!.id)!.items).toHaveLength(0);
  });

  it('persists characters across reconnects', async () => {
    const a = bots[0];
    a.close();
    await sleep(300);
    const token = await Bot.login(base, 'alice');
    const again = await Bot.connect(base, 'alice', token);
    bots.push(again);
    const inv = again.last('inventory')!.inventory;
    expect(inv.pockets.some((s) => s.id === 'canned_beans')).toBe(true);
    expect(inv.slots[1]?.id).toBe('pistol_9mm');
  });

  it('kills players, leaves their gear on the body, and respawns them', async () => {
    const bot = bots[bots.length - 1];
    const game = server.game;
    const p = game.ecs.get(bot.entityId, Player)!;
    p.body.health = 0.5;
    p.body.wounds.push({
      id: 99,
      part: 'torso',
      type: 'bite',
      severity: 1,
      bleeding: 1,
      bandage: 0,
      dirty: 0,
      disinfected: false,
      contamination: 0.8,
      infection: 0,
      sutured: false,
      splinted: false,
      age: 0,
    });
    await bot.waitFor(() => !!bot.last('died'), 3000, 'death');
    expect(bot.last('died')!.cause).toMatch(/Bled out/);
    await bot.waitFor(
      () => [...bot.entities.values()].some((e) => e.kind === EntityKind.Corpse && (e.flags & CorpseFlags.Player) !== 0),
      2000,
      'player corpse',
    );
    // Everything the player carried is on the body.
    const bodies = game.ecs
      .query(Corpse)
      .map((c) => game.ecs.get(c, Corpse)!)
      .filter((c) => c.player);
    expect(bodies).toHaveLength(1);
    expect(bodies[0].items.some((s) => s.id === 'canned_beans')).toBe(true);
    expect(bodies[0].items.some((s) => s.id === 'pistol_9mm')).toBe(true);
    await sleep(game.config.death.respawnDelaySeconds * 1000 + 100);
    const oldEntity = bot.entityId;
    bot.send({ t: 'respawn' });
    await bot.waitFor(() => bot.entityId !== oldEntity, 3000, 'respawn');
    const fresh = game.ecs.get(bot.entityId, Player)!;
    expect(fresh.body.health).toBe(100);
    // A fresh start: only the starting kit, and temporary post-respawn weakness.
    expect(fresh.inventory.pockets.some((s) => s.id === 'canned_beans')).toBe(false);
    expect(fresh.weaknessUntil).toBeGreaterThan(game.minutes);
    expect(fresh.stats.deaths).toBe(1);
  });
});
