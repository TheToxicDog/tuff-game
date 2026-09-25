import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InputFlags, TILES, Tile } from '@ironwild/shared';
import { startServer, type RunningServer } from './bootstrap';
import { MemoryStorage } from './persistence/memory-storage';
import { Bot } from './testing/bot';
import type { Player } from './game/player';

let server: RunningServer;
let base: string;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ticks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) server.game.step();
  await sleep(20);
}

/** Keeps the game ticking until a condition holds (messages arrive asynchronously). */
async function until(cond: () => boolean, what: string, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    server.game.step();
    await sleep(10);
  }
}

function playerOf(bot: Bot): Player {
  for (const p of server.game.players.values()) if (p.account.username === bot.username) return p;
  throw new Error('no player');
}

beforeAll(async () => {
  server = await startServer({
    port: 0,
    storage: new MemoryStorage(),
    quiet: true,
    rateLimit: false,
    manualTicks: true,
    adminUsernames: ['admin'],
  });
  base = `http://127.0.0.1:${server.port}`;
});

afterAll(async () => {
  await server.close();
});

describe('IRONWILD server', () => {
  it('welcomes a new player with starting gear and ₡25 (§8)', async () => {
    const bot = await Bot.connect(base, 'alice', await Bot.register(base, 'alice'));
    await ticks(3);
    await bot.waitFor(() => bot.inv !== null && bot.status !== null && bot.me !== null);
    expect(bot.welcome!.world.settlements.map((s) => s.name)).toEqual(['Westhaven', 'Stonehaven', 'Greenfield', 'Port Meridian']);
    expect(bot.count('stone_axe')).toBe(1);
    expect(bot.count('stone_pickaxe')).toBe(1);
    expect(bot.status!.crests).toBe(25);
    // Walking moves the player.
    const x0 = bot.me!.x;
    for (let i = 0; i < 15; i++) bot.input(0, 1, 0, 0);
    await sleep(30);
    await ticks(12);
    expect(bot.me!.x).toBeGreaterThan(x0 + 1);
    bot.close();
  });

  it('chops a tree and sells the wood; prices fall as the market fills (§13)', async () => {
    const bot = await Bot.connect(base, 'bob', await Bot.register(base, 'bob'));
    await ticks(2);
    const p = playerOf(bot);
    const w = server.game.world;
    const tree = [...w.nodes.values()].find((n) => n.type === 'tree' && !w.settlementAt(n.x, n.y, 20))!;
    p.move.x = tree.x - 1.1;
    p.move.y = tree.y;
    // Hold the button: inputs stream at 30 Hz like a real client; hits land ~110 ms after a swing.
    for (let i = 0; i < 12; i++) {
      for (let k = 0; k < 8; k++) bot.input(InputFlags.Primary, 0, 0, 0);
      await sleep(15);
      await ticks(6);
      await sleep(120);
      await ticks(1);
    }
    await until(() => bot.count('wood') > 0, 'wood');
    const wood = bot.count('wood');
    expect(wood).toBeGreaterThanOrEqual(6);

    // Sell to the lumber merchant.
    const npc = w.settlements[0].npcs.find((n) => n.profession === 'lumber')!;
    p.move.x = npc.x + 1;
    p.move.y = npc.y;
    bot.send({ t: 'interact', kind: 'npc', id: npc.id });
    await until(() => bot.ui?.kind === 'trade', 'trade ui');
    const ui = bot.ui as Extract<typeof bot.ui, { kind: 'trade' }>;
    const listing = ui.buys.find((b) => b.item === 'wood')!;
    expect(listing.price).toBeGreaterThan(1);
    bot.send({ t: 'trade', npc: npc.id, op: 'sell', item: 'wood', n: wood });
    await until(() => bot.count('wood') === 0 && bot.status!.crests > 25, 'sale');
    const after = (bot.ui as Extract<typeof bot.ui, { kind: 'trade' }>).buys.find((b) => b.item === 'wood');
    // No wood left in the inventory, so it is no longer listed; the market price must have dropped.
    expect(after).toBeUndefined();
    const s = server.game.economy;
    const def = (await import('@ironwild/shared')).itemDef('wood');
    const sdef = (await import('@ironwild/shared')).SETTLEMENT_BY_ID.get('westhaven')!;
    expect(s.bid(sdef, (await import('@ironwild/shared')).PROFESSION_BY_ID.get('lumber')!, def)).toBeLessThan(listing.price);
    bot.close();
  });

  it('builds a powered crusher line with a conveyor into a crate (§20–24)', async () => {
    const bot = await Bot.connect(base, 'admin', await Bot.register(base, 'admin'));
    await ticks(2);
    const p = playerOf(bot);
    const w = server.game.world;
    // Find a river tile with dry, empty land to its east and north-east.
    let spot: [number, number] | null = null;
    const land = (x: number, y: number) =>
      TILES[w.tile(x, y)].land &&
      !w.settlementAt(x, y, 6) &&
      w.nodesNear(x + 0.5, y + 0.5, 1.5).every((n) => !n.def.solid || n.regrowAt > 0);
    for (let y = 40; y < w.size - 40 && !spot; y++) {
      for (let x = 40; x < w.size - 40 && !spot; x++) {
        if (w.tile(x, y) !== Tile.Water) continue;
        if ([1, 2].every((dx) => [0, -1, -2].every((dy) => land(x + dx, y + dy)))) spot = [x, y];
      }
    }
    expect(spot).not.toBeNull();
    const [x, y] = spot!;
    p.move.x = x + 1.5;
    p.move.y = y + 1.6;
    // Park the player out of the way of the solid blocks.
    for (const [item, n] of [
      ['water_wheel', 1],
      ['gearbox', 1],
      ['crusher', 1],
      ['conveyor', 2],
      ['storage_crate', 1],
    ] as const)
      server.game.playerSystem.give(p, { id: item, n }, true);
    // Wildlife wanders at random; clear it off the building site so it cannot block placement.
    for (const e of [...server.game.entities.values()])
      if (e.kind === 'creature' && Math.hypot(e.x - x, e.y - y) < 16) server.game.removeEntity(e.id);
    const place = (item: string, px: number, py: number, rot: number) => bot.send({ t: 'place', item, x: px, y: py, rot });
    place('water_wheel', x, y, 0);
    place('gearbox', x + 1, y, 0);
    place('crusher', x + 2, y, 0);
    place('conveyor', x + 2, y - 1, 3);
    place('conveyor', x + 1, y - 1, 0);
    place('storage_crate', x + 1, y - 2, 0);
    await sleep(30);
    await ticks(3);
    expect(bot.notices.filter((n) => n.includes('cannot') || n.includes('way') || n.includes('needs'))).toEqual([]);
    const crusher = w.structAt(x + 2, y)!;
    const crate = w.structAt(x + 1, y - 2)!;
    expect(crusher.type).toBe('crusher');
    expect(crusher.speed).toBe(16);
    const net = server.game.factory.netSummary(crusher.net)!;
    expect(net.cap).toBe(100);
    expect(net.load).toBe(41); // crusher 40 + two conveyor tiles × 0.5
    // Feed ore straight into the crusher and let the line run.
    for (let i = 0; i < 6; i++) expect(server.game.factory.insert(crusher, 0, { id: 'iron_ore', n: 1 })).toBe(true);
    await ticks(20 * 14);
    const crushed = crate.store!.reduce((n, s) => n + (s?.id === 'crushed_iron' ? s.n : 0), 0);
    expect(crushed).toBe(6);
    bot.close();
  });

  it('saves and reloads the world', async () => {
    const save = server.game.serialize();
    expect(save.structures.length).toBeGreaterThanOrEqual(6);
    const storage = new MemoryStorage();
    await storage.saveWorld(save);
    const again = await startServer({ port: 0, storage, quiet: true, manualTicks: true });
    try {
      expect(again.game.world.structures.size).toBe(server.game.world.structures.size);
      again.game.step();
      again.game.step();
      const crusher = [...again.game.world.structures.values()].find((s) => s.type === 'crusher')!;
      expect(crusher.speed).toBe(16);
    } finally {
      await again.close();
    }
  });
});
