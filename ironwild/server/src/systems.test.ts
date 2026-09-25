import { beforeAll, describe, expect, it } from 'vitest';
import { ITEM_BY_ID, SETTLEMENT_BY_ID, TILES, Tile, countItem, type ServerMessage } from '@ironwild/shared';
import type { AccountRecord } from './persistence/storage';
import { MemoryStorage } from './persistence/memory-storage';
import { Game } from './game/game';
import { newCharacter, Player } from './game/player';
import type { ClientSession } from './game/session';
import type { Cart } from './game/entities';
import type { Structure } from './game/world';

let game: Game;
let nextAccount = 1;

function fakeSession(): ClientSession & { messages: ServerMessage[] } {
  const messages: ServerMessage[] = [];
  return {
    messages,
    send: (m: object) => messages.push(m as ServerMessage),
    sendRaw: (json: string) => messages.push(JSON.parse(json) as ServerMessage),
    chunks: new Set(),
    known: new Set(),
    connected: true,
    backlog: 0,
    close: () => undefined,
  } as unknown as ClientSession & { messages: ServerMessage[] };
}

function join(name: string, x?: number, y?: number): Player {
  const account: AccountRecord = {
    id: `acc-${nextAccount++}`,
    username: name,
    displayName: name,
    passwordHash: '',
    createdAt: 0,
    lastLoginAt: 0,
    isAdmin: false,
  };
  const spawn = game.world.gen.spawn;
  const p = new Player(game.newEntityId(), fakeSession(), account, newCharacter(name, x ?? spawn.x, y ?? spawn.y));
  game.players.set(p.id, p);
  game.byAccount.set(account.id, p);
  return p;
}

function notices(p: Player): string[] {
  return (p.session as unknown as { messages: ServerMessage[] }).messages
    .filter((m) => m.t === 'notice')
    .map((m) => (m as { text: string }).text);
}

/** A clear patch of meadow away from towns, `w`×`h` tiles, for building. */
function clearSpot(w: number, h: number, minRadius = 25): { x: number; y: number } {
  const world = game.world;
  const s = world.settlements[0];
  for (let r = minRadius; r < 160; r++) {
    for (let a = 0; a < 40; a++) {
      const x = Math.round(s.x + Math.cos((a / 40) * Math.PI * 2) * r);
      const y = Math.round(s.y + Math.sin((a / 40) * Math.PI * 2) * r);
      let ok = true;
      for (let dy = -1; dy <= h && ok; dy++)
        for (let dx = -1; dx <= w && ok; dx++) if (world.tile(x + dx, y + dy) !== 3 || world.structAt(x + dx, y + dy)) ok = false;
      if (!ok || world.settlementAt(x, y, minRadius > 25 ? 24 : 12) || world.claimAt(x, y) || world.claimAt(x + w, y + h)) continue;
      if (world.nodesNear(x + w / 2, y + h / 2, Math.max(w, h) + 2).some((n) => n.def.solid)) continue;
      return { x, y };
    }
  }
  throw new Error('no clear spot');
}

/** A patch of open grass, `w`×`h` tiles, cleared of trees and rocks. */
function openGround(w: number, h: number, minRadius: number): { x: number; y: number } {
  const world = game.world;
  const s = world.settlements[0];
  for (let r = minRadius; r < 200; r++) {
    for (let a = 0; a < 60; a++) {
      const x = Math.round(s.x + Math.cos((a / 60) * Math.PI * 2) * r);
      const y = Math.round(s.y + Math.sin((a / 60) * Math.PI * 2) * r);
      let ok = true;
      for (let dy = -1; dy <= h && ok; dy++)
        for (let dx = -1; dx <= w && ok; dx++)
          if (world.tile(x + dx, y + dy) !== 3 || world.structAt(x + dx, y + dy) || world.claimAt(x + dx, y + dy)) ok = false;
      if (!ok || world.settlementAt(x, y, 20)) continue;
      for (const n of world.nodesNear(x + w / 2, y + h / 2, Math.max(w, h) + 2)) n.gone = true;
      for (const e of [...game.entities.values()])
        if (e.kind === 'creature' && Math.hypot(e.x - x - w / 2, e.y - y - h / 2) < Math.max(w, h) + 8) game.removeEntity(e.id);
      return { x, y };
    }
  }
  throw new Error('no open ground');
}

/** A clear spot far enough from every claim to put down a new one. */
function claimSpot(): { x: number; y: number } {
  for (let r = 40; r < 160; r += 4) {
    const s = clearSpot(3, 3, r);
    if ([...game.world.claims].every((c) => Math.abs(c.x - s.x) > 33 || Math.abs(c.y - s.y) > 33)) return s;
  }
  throw new Error('no spot for a claim');
}

function place(p: Player, item: string, x: number, y: number, rot = 0): Structure {
  // Wildlife wanders at random; keep it off the spot.
  for (const e of [...game.entities.values()])
    if (e.kind === 'creature' && !e.owner && Math.hypot(e.x - x - 0.5, e.y - y - 0.5) < 3.5) game.removeEntity(e.id);
  game.playerSystem.give(p, { id: item, n: 1 }, true);
  game.building.place(p, item, x, y, rot);
  const s = game.world.structAt(x, y) ?? game.world.floorStructAt(x, y);
  if (!s) throw new Error(`could not place ${item}: ${notices(p).slice(-1)[0]}`);
  return s;
}

function ticks(n: number): void {
  for (let i = 0; i < n; i++) game.step();
}

beforeAll(async () => {
  game = new Game(new MemoryStorage(), { seed: 777 });
  game.log = () => undefined;
  await game.init();
});

describe('economy', () => {
  it('pays for a completed contract with an on-time bonus (§15)', () => {
    const p = join('contractor');
    const board = game.world.settlements[0].npcs.find((n) => n.profession === 'board')!;
    p.move.x = board.x + 1;
    p.move.y = board.y;
    const c = game.economy.contracts.find((x) => x.settlement === 'westhaven')!;
    game.economy.contract(p, 'accept', c.id);
    expect(c.taker).toBe(p.accountId);
    const before = p.crests;
    game.playerSystem.give(p, { id: c.item, n: c.n }, true);
    game.economy.contract(p, 'deliver', c.id);
    expect(p.crests).toBe(before + c.pay + c.bonus);
    expect(game.economy.contracts.some((x) => x.id === c.id)).toBe(false);
    expect(game.economy.contracts.filter((x) => x.settlement === 'westhaven')).toHaveLength(3);
  });

  it('sells shipping crate contents at dawn (§35)', () => {
    const p = join('shipper');
    const spot = clearSpot(2, 2);
    p.move.x = spot.x + 0.5;
    p.move.y = spot.y + 2.5;
    const crate = place(p, 'shipping_crate', spot.x, spot.y);
    crate.store![0] = { id: 'iron_ingot', n: 20, q: 1 };
    const before = p.crests;
    // Jump to just before dawn of the next day.
    game.minutes = game.day * 1440 + 5.99 * 60;
    ticks(40);
    expect(crate.store!.every((s) => !s)).toBe(true);
    expect(p.crests).toBeGreaterThan(before + 200);
    expect(notices(p).some((n) => n.includes('merchant wagon'))).toBe(true);
  });

  it('fills buy orders on the exchange with escrow (§34)', () => {
    const buyer = join('buyer');
    const miner = join('miner');
    const clerk = game.world.settlements[0].npcs.find((n) => n.profession === 'exchange')!;
    for (const p of [buyer, miner]) {
      p.move.x = clerk.x + 1;
      p.move.y = clerk.y;
    }
    buyer.crests = 1000;
    game.economy.order(buyer, { t: 'order', op: 'post', item: 'iron_ore', n: 50, price: 9 });
    expect(buyer.crests).toBe(550);
    const order = game.economy.orders.find((o) => o.owner === buyer.accountId)!;
    game.playerSystem.give(miner, { id: 'iron_ore', n: 30 }, true);
    const minerBefore = miner.crests;
    game.economy.order(miner, { t: 'order', op: 'fill', id: order.id, n: 30 });
    expect(miner.crests).toBe(minerBefore + 270);
    expect(countItem(miner.slots, 'iron_ore')).toBe(0);
    game.economy.order(buyer, { t: 'order', op: 'collect', id: order.id });
    expect(countItem(buyer.slots, 'iron_ore')).toBe(30);
    game.economy.order(buyer, { t: 'order', op: 'cancel', id: order.id });
    expect(buyer.crests).toBe(550 + 180);
  });

  it('runs shop stands that pay their owner (§33)', () => {
    const owner = join('shopkeeper');
    const customer = join('customer');
    const spot = clearSpot(2, 2);
    owner.move.x = customer.move.x = spot.x + 0.5;
    owner.move.y = customer.move.y = spot.y + 2.2;
    const stand = place(owner, 'shop_stand', spot.x, spot.y);
    stand.store![0] = { id: 'iron_gear', n: 10, q: 1 };
    game.economy.shopPrice(owner, stand.id, 'iron_gear', 1, 50);
    customer.crests = 500;
    const ownerBefore = owner.crests;
    game.economy.shopBuy(customer, stand.id, 'iron_gear', 1, 3);
    expect(customer.crests).toBe(350);
    expect(owner.crests).toBe(ownerBefore + 150);
    expect(countItem(customer.slots, 'iron_gear')).toBe(3);
    expect(countItem(stand.store!, 'iron_gear')).toBe(7);
  });
});

describe('world systems', () => {
  it('tills, plants and harvests crops', () => {
    const p = join('farmer');
    const spot = clearSpot(2, 2);
    p.move.x = spot.x + 0.5;
    p.move.y = spot.y + 1.5;
    game.farming.till(p, spot.x, spot.y);
    expect(game.world.tile(spot.x, spot.y)).toBe(13);
    expect(game.farming.plant(p, spot.x, spot.y, 'wheat')).toBe(true);
    const crop = game.world.structAt(spot.x, spot.y)!;
    game.farming.harvest(p, crop);
    expect(game.world.structAt(spot.x, spot.y)).toBe(crop);
    crop.crop!.planted -= crop.crop!.grow + 1000;
    game.farming.harvest(p, crop);
    expect(game.world.structAt(spot.x, spot.y)).toBeUndefined();
    expect(countItem(p.slots, 'wheat')).toBeGreaterThanOrEqual(2);
  });

  it('protects claimed land and its containers (§44)', () => {
    const owner = join('landlord');
    const stranger = join('stranger');
    const spot = clearSpot(3, 3, 40);
    owner.move.x = stranger.move.x = spot.x + 0.5;
    owner.move.y = stranger.move.y = spot.y + 3.5;
    place(owner, 'land_claim', spot.x, spot.y);
    const chest = place(owner, 'chest', spot.x + 2, spot.y);
    expect(game.building.canUse(stranger, chest)).toBe(false);
    game.playerSystem.give(stranger, { id: 'wood_wall', n: 1 }, true);
    game.building.place(stranger, 'wood_wall', spot.x + 1, spot.y + 2, 0);
    expect(game.world.structAt(spot.x + 1, spot.y + 2)).toBeUndefined();
    const claim = game.world.structAt(spot.x, spot.y)!;
    game.players.set(stranger.id, stranger);
    game.building.claimMember(owner, claim.id, 'add', 'stranger', 'worker');
    expect(game.building.canUse(stranger, chest)).toBe(true);
    expect(game.building.canBuildAt(stranger, spot.x + 1, spot.y + 2)).toBe(false);
  });

  it('drops a bag with a quarter of resources on death and keeps tools (§39)', () => {
    const p = join('unlucky');
    game.playerSystem.give(p, { id: 'wood', n: 100 }, true);
    p.crests = 200;
    game.playerSystem.kill(p, 'a bear');
    expect(p.dead).toBe(true);
    expect(p.crests).toBe(180);
    expect(countItem(p.slots, 'wood')).toBe(75);
    expect(countItem(p.slots, 'stone_axe')).toBe(1);
    const bag = [...game.entities.values()].find((e) => e.kind === 'bag' && e.owner === p.accountId);
    expect(bag).toBeDefined();
    game.playerSystem.respawn(p);
    p.move.x = bag!.x;
    p.move.y = bag!.y;
    game.playerSystem.pickup(p);
    expect(countItem(p.slots, 'wood')).toBe(100);
  });

  it('smelts with fractional yields: 10 ore → 7 ingots (§24)', () => {
    const p = join('smelter');
    const spot = clearSpot(2, 2);
    p.move.x = spot.x + 0.5;
    p.move.y = spot.y + 2.5;
    const furnace = place(p, 'furnace', spot.x, spot.y);
    furnace.machine!.in[0] = { id: 'iron_ore', n: 10 };
    furnace.machine!.fuel![0] = { id: 'coal', n: 5 };
    ticks(20 * 3 * 10 + 20);
    expect(countItem(furnace.machine!.out, 'iron_ingot')).toBe(7);
  });

  it('routes items with hoppers, splitters and filters', () => {
    const p = join('logistician');
    const spot = clearSpot(6, 5);
    const { x, y } = spot;
    p.move.x = x + 3;
    p.move.y = y + 5.5;
    // crate → hopper → conveyor → filter (stone straight on, others to the sides) → crates.
    place(p, 'hand_crank', x, y + 1);
    const src = place(p, 'storage_crate', x + 1, y);
    place(p, 'hopper', x + 2, y, 1);
    place(p, 'conveyor', x + 3, y, 1);
    const filter = place(p, 'filter', x + 4, y, 1);
    const straight = place(p, 'storage_crate', x + 5, y);
    const side = place(p, 'storage_crate', x + 4, y + 1);
    // Power the belt from a gearbox under it, driven by the crank.
    place(p, 'gearbox', x + 1, y + 1);
    place(p, 'shaft', x + 2, y + 1);
    place(p, 'gearbox', x + 3, y + 1);
    filter.filter = 'stone';
    src.store![0] = { id: 'stone', n: 3 };
    src.store![1] = { id: 'wood', n: 3 };
    const crank = game.world.structAt(x, y + 1)!;
    p.move.x = x + 0.5;
    p.move.y = y + 2.4;
    for (let i = 0; i < 20 * 20; i++) {
      if (i % 10 === 0) game.factory.crank(p, crank.id, true);
      p.move.stamina = 100;
      game.step();
    }
    expect(countItem(straight.store!, 'stone')).toBe(3);
    expect(countItem(side.store!, 'wood')).toBe(3);
  });
});

describe('factory depth', () => {
  it('overclocking trades stress for speed, and wear slows machines until repaired (§60–61)', () => {
    const p = join('tinkerer');
    const spot = clearSpot(3, 2);
    const { x, y } = spot;
    p.move.x = x + 1.5;
    p.move.y = y + 2.5;
    place(p, 'hand_crank', x, y);
    const saw = place(p, 'saw', x + 1, y);
    const crank = game.world.structAt(x, y)!;
    game.factory.crank(p, crank.id, true);
    ticks(2);
    const base = game.factory.netSummary(saw.net)!;
    expect(base.load).toBe(12.5); // 25 torque at 8 RPM
    game.factory.configure(p, { t: 'machine', id: saw.id, op: 'oc', level: 2 });
    game.factory.crank(p, crank.id, true);
    ticks(2);
    expect(game.factory.netSummary(saw.net)!.load).toBeCloseTo(28.75, 5);
    // A hand crank only gives 16 stress at 8 RPM: the overclocked saw overloads it.
    expect(game.factory.netSummary(saw.net)!.stalled).toBe(true);
    // Worn machines can be repaired with an iron gear.
    saw.machine!.wear = 0.8;
    game.playerSystem.give(p, { id: 'iron_gear', n: 1, q: 1 }, true);
    game.factory.configure(p, { t: 'machine', id: saw.id, op: 'repair' });
    expect(saw.machine!.wear).toBe(0);
    expect(countItem(p.slots, 'iron_gear')).toBe(0);
  });

  it('reports output and bottlenecks in the factory overview (§59)', () => {
    const p = join('overseer');
    const spot = clearSpot(2, 2);
    p.move.x = spot.x + 0.5;
    p.move.y = spot.y + 2.5;
    const furnace = place(p, 'furnace', spot.x, spot.y);
    furnace.machine!.in[0] = { id: 'iron_ore', n: 50 };
    ticks(20 * 5);
    let stats = game.factory.stats(p);
    expect(stats.machines[0].type).toBe('furnace');
    expect(stats.hints.some((h) => h.includes('out of fuel'))).toBe(true);
    furnace.machine!.fuel![0] = { id: 'coal', n: 10 };
    ticks(20 * 10);
    stats = game.factory.stats(p);
    expect(stats.machines[0].perMin.find(([item]) => item === 'iron_ingot')?.[1]).toBeGreaterThan(0);
    expect(stats.valuePerMin).toBeGreaterThan(0);
  });
});

describe('town growth (§54)', () => {
  it('opens new stalls as trade makes a settlement prosper', () => {
    const lumber = game.world.settlements.find((s) => s.id === 'stonehaven')!.npcs.find((n) => n.profession === 'lumber')!;
    expect(lumber.unlock).toBe(4000);
    expect(game.economy.isOpen(lumber.id)).toBe(false);
    const p = join('merchant');
    game.economy.credit(p.accountId, 0);
    // Sell a lot of ore in Stonehaven.
    const miner = game.world.settlements.find((s) => s.id === 'stonehaven')!.npcs.find((n) => n.profession === 'miner')!;
    p.move.x = miner.x + 1;
    p.move.y = miner.y;
    for (let i = 0; i < 12; i++) {
      game.playerSystem.give(p, { id: 'gold_ore', n: 50 }, true);
      game.economy.trade(p, miner.id, 'sell', 'gold_ore', 50);
    }
    expect(game.economy.prosperity.get('stonehaven')).toBeGreaterThan(4000);
    expect(game.economy.isOpen(lumber.id)).toBe(true);
  });
});

describe('raids and defenses (§42)', () => {
  it('raiders smash through walls, rob storage, and drop the loot when killed', () => {
    const owner = join('baron');
    const spot = clearSpot(4, 4, 40);
    owner.move.x = spot.x + 0.5;
    owner.move.y = spot.y + 1.5;
    const claim = place(owner, 'land_claim', spot.x, spot.y);
    const cx = spot.x + 2;
    const cy = spot.y + 2;
    const chest = place(owner, 'chest', cx, cy);
    const walls: Structure[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) walls.push(place(owner, 'wood_wall', cx + dx, cy + dy));
    chest.store![0] = { id: 'gold_ingot', n: 10 };
    expect(game.raids.wealth(claim)).toBeGreaterThan(950);
    expect(game.raids.start(claim, 0)).toBe(true);
    // The owner steps away (raiders would fight them otherwise).
    owner.move.x = game.world.gen.spawn.x;
    owner.move.y = game.world.gen.spawn.y;
    let robber = null;
    for (let i = 0; i < 20 * 140 && !robber; i++) {
      game.step();
      for (const e of game.entities.values()) if (e.kind === 'creature' && e.raider?.loot.length) robber = e;
    }
    expect(robber).not.toBeNull();
    expect(chest.store!.some((s) => s?.id === 'gold_ingot')).toBe(false);
    // They had to break through: some wall is damaged or gone.
    expect(walls.some((w) => w.hp < w.def.hp || !game.world.structures.has(w.id))).toBe(true);
    game.creatures.damage(robber!, 10_000, owner, 0, false);
    const dropped = [...game.entities.values()].filter((e) => e.kind === 'drop' && e.stack.id === 'gold_ingot');
    expect(dropped.reduce((n, d) => n + (d.kind === 'drop' ? d.stack.n : 0), 0)).toBe(10);
    // Leftover raiders run off; the raid ends and walls start to mend.
    for (let i = 0; i < 20 * 240 && game.raids.active; i++) game.step();
    expect(game.raids.active).toBe(false);
  });

  it('arrow towers shoot predators and spike traps hurt what steps on them', () => {
    const owner = join('warden');
    const spot = clearSpot(5, 3, 40);
    owner.move.x = spot.x + 0.5;
    owner.move.y = spot.y + 2.5;
    const tower = place(owner, 'arrow_tower', spot.x, spot.y);
    tower.store![0] = { id: 'arrow', n: 5 };
    const wolf = game.creatures.spawn('wolf', spot.x + 5.5, spot.y + 0.5, '');
    ticks(40);
    expect(tower.store![0]?.n ?? 0).toBeLessThan(5);
    expect(!game.entities.has(wolf.id) || wolf.hp < wolf.def.hp).toBe(true);
    const trap = place(owner, 'spike_trap', spot.x + 4, spot.y + 2);
    const bandit = game.creatures.spawn('bandit', spot.x + 4.5, spot.y + 2.5, '');
    game.raids.damageStructure(tower, 10_000); // (no more arrows flying at it)
    bandit.hp = bandit.def.hp;
    ticks(10);
    expect(bandit.hp).toBeLessThan(bandit.def.hp);
    expect(trap.hp).toBeLessThan(trap.def.hp);
    game.creatures.kill(bandit, null);
  });
});

describe('fishing (§11)', () => {
  it('casts into water, waits for a bite and lands a catch', () => {
    const w = game.world;
    const spawn = w.gen.spawn;
    // A bank tile with water right to the east.
    let bank: { x: number; y: number } | null = null;
    for (let r = 0; r < 120 && !bank; r++)
      for (let dy = -r; dy <= r && !bank; dy++)
        for (let dx = -r; dx <= r && !bank; dx++) {
          const x = Math.floor(spawn.x) + dx;
          const y = Math.floor(spawn.y) + dy;
          if (w.solidAt(x, y) || w.tile(x, y) === 1) continue;
          if (w.tile(x + 2, y) === 1 && w.tile(x + 3, y) === 1 && !w.structAt(x + 2, y)) bank = { x, y };
        }
    expect(bank).not.toBeNull();
    const p = join('angler', bank!.x + 0.5, bank!.y + 0.5);
    p.slots = p.slots.map(() => null);
    p.slots[0] = { id: 'fishing_rod', n: 1 };
    p.sel = 0;
    p.angle = 0;
    p.flags = 2; // primary, pressed
    p.prevFlags = 0;
    game.fishing.input(p);
    expect(p.fishing).not.toBeNull();
    p.fishing!.biteAt = Date.now() - 1;
    game.fishing.step();
    expect(p.fishing!.biteUntil).toBeGreaterThan(0);
    const before = p.crests;
    game.fishing.input(p);
    expect(p.fishing).toBeNull();
    const caught = p.slots.slice(1).some((s) => s) || p.crests > before;
    expect(caught).toBe(true);
  });
});

describe('market events (§14)', () => {
  it('a shortage raises prices for its goods until it ends', () => {
    game.economy.events.length = 0;
    const town = SETTLEMENT_BY_ID.get('westhaven')!;
    const ingot = ITEM_BY_ID.get('iron_ingot')!;
    const before = game.economy.ask(town, ingot);
    const e = game.economy.startEvent('Iron shortage', 'westhaven');
    expect(e).not.toBeNull();
    expect(e!.items).toContain('iron_ingot');
    const during = game.economy.ask(town, ingot);
    expect(during).toBeGreaterThan(before * 1.5);
    // Unrelated goods are unaffected.
    const bread = ITEM_BY_ID.get('bread')!;
    const breadPrice = game.economy.ask(town, bread);
    game.minutes = e!.ends + 61;
    game.economy.stepSecond();
    expect(game.economy.events.some((x) => x.id === e!.id)).toBe(false);
    expect(game.economy.ask(town, ingot)).toBeLessThan(during);
    expect(game.economy.ask(town, bread)).toBeCloseTo(breadPrice, 5);
  });
});

describe('Port Meridian (§14)', () => {
  it('sells imports that are worth more inland, and pays well for finished goods', async () => {
    // A fresh world: earlier tests' trading and market news would skew the comparison.
    const fresh = new Game(new MemoryStorage(), { seed: 777 });
    fresh.log = () => undefined;
    await fresh.init();
    fresh.economy.events.length = 0;
    const port = SETTLEMENT_BY_ID.get('port_meridian')!;
    const west = SETTLEMENT_BY_ID.get('westhaven')!;
    expect(fresh.world.settlements.some((s) => s.id === 'port_meridian')).toBe(true);
    const spices = ITEM_BY_ID.get('spices')!;
    const buyer = fresh.economy.bestBuyer(west, spices)!;
    expect(fresh.economy.bid(west, buyer, spices)).toBeGreaterThan(fresh.economy.ask(port, spices));
    const gear = ITEM_BY_ID.get('iron_gear')!;
    const exporter = fresh.economy.bestBuyer(port, gear)!;
    expect(exporter.id).toBe('exporter');
    expect(fresh.economy.bid(port, exporter, gear)).toBeGreaterThan(fresh.economy.bid(west, fresh.economy.bestBuyer(west, gear)!, gear));
  });
});

describe('steam power (§19)', () => {
  it('pumps river water to a coal-fired boiler whose steam drives an engine', () => {
    const w = game.world;
    // A river bank with a 7 × 4 patch of dry land to its east.
    const land = (x: number, y: number) => TILES[w.tile(x, y)].land && !w.structAt(x, y) && !w.claimAt(x, y) && !w.settlementAt(x, y, 8);
    let spot: { x: number; y: number } | null = null;
    for (let y = 40; y < w.size - 40 && !spot; y++)
      for (let x = 40; x < w.size - 40 && !spot; x++) {
        if (w.tile(x - 1, y) !== Tile.Water) continue;
        let ok = true;
        for (let dy = -2; dy <= 1 && ok; dy++) for (let dx = 0; dx <= 6 && ok; dx++) if (!land(x + dx, y + dy)) ok = false;
        if (ok) spot = { x, y };
      }
    expect(spot).not.toBeNull();
    const { x, y } = spot!;
    for (const n of w.nodesNear(x + 3, y, 9)) n.gone = true;
    for (const e of [...game.entities.values()]) if (e.kind === 'creature' && Math.hypot(e.x - x, e.y - y) < 16) game.removeEntity(e.id);
    const p = join('stoker', x + 3.5, y + 3.5);
    // Windmill → gearbox → pump on the bank; pipe → boiler (steam out east) → pipe → engine.
    place(p, 'windmill', x, y - 2);
    place(p, 'gearbox', x, y - 1);
    const pump = place(p, 'pump', x, y);
    place(p, 'pipe', x + 1, y);
    const boiler = place(p, 'boiler', x + 2, y, 1);
    place(p, 'pipe', x + 4, y);
    const engine = place(p, 'steam_engine', x + 5, y);
    ticks(20 * 6);
    expect(pump.machine!.status).toBe('Running');
    // A windmill turns 10–16 RPM here, so the pump lifts 12.5–20 water a second.
    expect(pump.machine!.rate!).toBeGreaterThan(12);
    // No fuel yet: the boiler fills with water but makes no steam.
    expect(boiler.machine!.status).toBe('No fuel');
    expect(boiler.buf!.water).toBeGreaterThan(50);
    expect(engine.machine!.active).toBe(false);
    boiler.machine!.fuel![0] = { id: 'coal', n: 5 };
    ticks(20 * 3);
    expect(boiler.machine!.status).toBe('Running');
    expect(engine.machine!.active).toBe(true);
    expect(engine.spin?.[0]).toBe(32);
    expect(game.factory.netSummary(engine.net)!.cap).toBeGreaterThanOrEqual(256);
    const ui = game.factory.machineUi(p, boiler);
    expect(ui.tanks?.map((t) => t.fluid)).toEqual(['Water', 'Steam']);
    expect(ui.rate?.perSec).toBeGreaterThan(5);
    // Starve the boiler of water: the engine runs down and stops.
    game.building.remove(w.structAt(x + 1, y)!);
    ticks(20 * 12);
    expect(boiler.machine!.status).toBe('No water');
    expect(engine.machine!.active).toBe(false);
  });

  it('keeps one fluid per network and saves pipe contents', () => {
    const spot = clearSpot(4, 1, 60);
    const p = join('plumber', spot.x + 0.5, spot.y + 2.5);
    const a = place(p, 'pipe', spot.x, spot.y);
    const tank = place(p, 'fluid_tank', spot.x + 1, spot.y);
    place(p, 'pipe', spot.x + 2, spot.y);
    // (As if loaded from a save: the tank holds water.)
    tank.fluid = { kind: 'water', amount: 1000 };
    ticks(1);
    expect(game.fluids.netAt(a)).toMatchObject({ fluid: 'water', amount: 1000, capacity: 50 + 2000 + 50 });
    // Regrouping (a new pipe) keeps what the network held.
    place(p, 'pipe', spot.x + 3, spot.y);
    ticks(1);
    expect(game.fluids.netAt(a)!.amount).toBeCloseTo(1000, 3);
    expect(game.fluids.netAt(a)!.capacity).toBe(2150);
    const save = game.serialize();
    const saved = save.structures.find((s) => s.id === tank.id)!;
    expect((saved.data as { fluid?: { kind: string } }).fluid?.kind).toBe('water');
  });
});

describe('companies (§46)', () => {
  it('owns land handed to it, lets officers manage it and banks its shop sales', () => {
    const founder = join('founder');
    const hand = join('farmhand');
    const customer = join('patron');
    founder.crests = 2000;
    game.companies.handle(founder, { t: 'company', op: 'create', name: 'Acme Works' });
    expect(founder.company).not.toBeNull();
    game.companies.handle(founder, { t: 'company', op: 'invite', name: 'farmhand' });
    game.companies.handle(hand, { t: 'company', op: 'accept' });
    expect(hand.company).toBe(founder.company);

    const spot = claimSpot();
    for (const p of [founder, hand, customer]) {
      p.move.x = spot.x + 1.5;
      p.move.y = spot.y + 3.5;
    }
    const claim = place(founder, 'land_claim', spot.x, spot.y);
    const stand = place(founder, 'shop_stand', spot.x + 2, spot.y);
    game.companies.handle(founder, { t: 'company', op: 'transfer', claim: claim.id });
    expect(claim.owner).toBe(`co:${founder.company}`);
    expect(stand.ownerName).toBe('Acme Works');

    // Members use company property; only officers may pick it up.
    expect(game.building.canUse(hand, stand)).toBe(true);
    expect(game.building.canRemove(hand, stand)).toBe(false);
    expect(game.building.canRemove(founder, stand)).toBe(true);
    game.companies.handle(founder, { t: 'company', op: 'promote', name: 'farmhand' });
    expect(game.building.canRemove(hand, stand)).toBe(true);
    expect(game.building.canRemove(customer, stand)).toBe(false);

    // Shop sales go to the treasury, not to anyone's pocket.
    stand.store![0] = { id: 'iron_gear', n: 10, q: 1 };
    game.economy.shopPrice(founder, stand.id, 'iron_gear', 1, 40);
    customer.crests = 500;
    const pocket = founder.crests;
    game.economy.shopBuy(customer, stand.id, 'iron_gear', 1, 5);
    expect(founder.crests).toBe(pocket);
    const sent = (founder.session as unknown as { messages: ServerMessage[] }).messages.filter((m) => m.t === 'company');
    const info = (sent[sent.length - 1] as Extract<ServerMessage, { t: 'company' }>).info!;
    expect(info.treasury).toBe(200);
    expect(info.income).toContainEqual(['Shop sales', 200]);
    expect(info.property.count).toBe(2);

    // When the last member leaves, the property reverts to them.
    game.companies.handle(hand, { t: 'company', op: 'leave' });
    game.companies.handle(founder, { t: 'company', op: 'leave' });
    expect(claim.owner).toBe(founder.accountId);
    expect(founder.crests).toBe(pocket + 200);
  });
});

describe('railways (§36)', () => {
  it('shuttles goods from a loading station to an unloading one and back', () => {
    const spot = openGround(11, 3, 70);
    const { x, y } = { x: spot.x, y: spot.y + 1 };
    const p = join('railman', x + 5.5, y + 2.5);
    const from = place(p, 'chest', x, y - 1);
    const load = place(p, 'rail_station', x, y);
    for (let i = 1; i < 10; i++) place(p, 'rail', x + i, y);
    const unload = place(p, 'rail_station', x + 10, y);
    const to = place(p, 'chest', x + 10, y + 1);
    // Stations start in load mode; E switches the far one to unload.
    game.rails.interact(p, unload);
    expect(unload.rmode).toBe('unload');
    from.store![0] = { id: 'iron_ore', n: 30 };
    // Set a minecart on the loading station, facing east.
    game.playerSystem.give(p, { id: 'minecart', n: 1 }, true);
    p.angle = 0;
    p.move.x = x + 1.5;
    p.move.y = y + 2;
    game.playerSystem.useItem(
      p,
      p.slots.findIndex((s) => s?.id === 'minecart'),
      x + 0.5,
      y + 0.5,
    );
    const cart = [...game.entities.values()].find((e) => e.kind === 'cart' && e.type === 'minecart') as Cart;
    expect(cart).toBeDefined();
    // The first pass east is empty (it was set down past the loading point); it unloads nothing,
    // turns at the end of the line, comes back, loads, and delivers.
    for (let i = 0; i < 20 * 40 && countItem(to.store!, 'iron_ore') < 30; i++) game.step();
    expect(countItem(from.store!, 'iron_ore')).toBe(0);
    expect(countItem(to.store!, 'iron_ore')).toBe(30);
    void load;
  });

  it('follows a junction switch and reverses on request', () => {
    const spot = openGround(5, 5, 90);
    const p = join('switcher', spot.x + 0.5, spot.y + 5.5);
    // A T: a line west–east with a branch south from the middle.
    for (let i = 0; i < 5; i++) place(p, 'rail', spot.x + i, spot.y);
    for (let j = 1; j < 4; j++) place(p, 'rail', spot.x + 2, spot.y + j);
    const junction = game.world.structAt(spot.x + 2, spot.y)!;
    expect(game.rails.links(junction).sort()).toEqual([1, 2, 3]);
    // Point the switch south.
    game.rails.interact(p, junction);
    while (junction.sw !== 2) game.rails.interact(p, junction);
    game.playerSystem.give(p, { id: 'minecart', n: 1 }, true);
    p.angle = 0;
    p.move.x = spot.x + 0.5;
    p.move.y = spot.y + 1.8;
    game.playerSystem.useItem(
      p,
      p.slots.findIndex((s) => s?.id === 'minecart'),
      spot.x + 0.5,
      spot.y + 0.5,
    );
    const cart = [...game.entities.values()].find((e) => e.kind === 'cart' && e.type === 'minecart' && Math.abs(e.x - spot.x) < 3) as Cart;
    expect(cart).toBeDefined();
    let maxY = 0;
    for (let i = 0; i < 20 * 3; i++) {
      game.step();
      maxY = Math.max(maxY, cart.y);
    }
    expect(maxY).toBeGreaterThan(spot.y + 2.5);
    const before = cart.rail!.exit;
    p.move.x = cart.x + 1;
    p.move.y = cart.y;
    game.playerSystem.interact(p, 'entity', cart.id, 'grab');
    expect(cart.rail!.exit).not.toBe(before);
  });
});

describe('wagons (§36)', () => {
  it('hitch to a horse, follow it, and unhitch when the rider dismounts', () => {
    const spot = openGround(6, 3, 110);
    const p = join('carter', spot.x + 1.5, spot.y + 1.5);
    game.playerSystem.give(p, { id: 'wagon', n: 1 }, true);
    game.playerSystem.useItem(
      p,
      p.slots.findIndex((s) => s?.id === 'wagon'),
      spot.x + 3.5,
      spot.y + 1.5,
    );
    const wagon = [...game.entities.values()].find((e) => e.kind === 'cart' && e.type === 'wagon') as Cart;
    expect(wagon.slots).toHaveLength(48);
    // On foot it won't hitch.
    game.playerSystem.interact(p, 'entity', wagon.id, 'grab');
    expect(wagon.puller).toBe(0);
    const horse = game.creatures.spawn('horse', spot.x + 2.5, spot.y + 1.5, '');
    horse.owner = p.accountId;
    game.playerSystem.interact(p, 'entity', horse.id, 'grab');
    expect(p.mounted).toBe(horse.id);
    game.playerSystem.interact(p, 'entity', wagon.id, 'grab');
    expect(wagon.puller).toBe(p.id);
    // Ride off west: the wagon follows on its rope (it is dragged as inputs are processed).
    p.move.x -= 4;
    for (let i = 1; i <= 3; i++) p.inputs.push([p.lastSeq + i, 0, 0, 0, 0]);
    ticks(2);
    expect(Math.hypot(wagon.x - p.x, wagon.y - p.y)).toBeLessThan(2.4);
    // Dismounting unhitches.
    game.playerSystem.dismount(p);
    expect(wagon.puller).toBe(0);
  });
});

describe('electricity (§19)', () => {
  it('carries power from a generator over poles to a lathe, and shares it out when short', () => {
    const spot = openGround(12, 4, 120);
    const { x, y } = spot;
    const p = join('sparky', x + 6.5, y + 4.5);
    place(p, 'windmill', x, y);
    place(p, 'gearbox', x, y + 1);
    const gen = place(p, 'generator', x + 1, y + 1);
    place(p, 'power_pole', x + 1, y + 2);
    place(p, 'power_pole', x + 9, y + 2);
    const lathe = place(p, 'lathe', x + 10, y + 1);
    ticks(2);
    expect(gen.speed).toBeGreaterThan(0);
    // Nothing to do yet: the lathe asks for nothing.
    expect(game.power.gridAt(lathe)!.demand).toBe(0);
    lathe.machine!.in[0] = { id: 'iron_rod', n: 10 };
    ticks(20 * 6);
    expect(game.power.gridAt(lathe)!.demand).toBe(50);
    expect(game.power.gridAt(lathe)!.share).toBe(1);
    expect(countItem(lathe.machine!.out, 'spring')).toBeGreaterThanOrEqual(4);
    // An electric motor on the same grid asks for 100 more than a windmill can give.
    const motor = place(p, 'electric_motor', x + 11, y + 2);
    ticks(5);
    const grid = game.power.gridAt(motor)!;
    expect(grid.demand).toBe(150);
    expect(grid.share).toBeLessThan(1);
    expect(motor.power).toBeLessThan(1);
    expect(motor.power).toBeGreaterThan(0);
    // A lathe with no pole in reach does not run.
    const lonely = place(p, 'lathe', x + 5, y + 3);
    lonely.machine!.in[0] = { id: 'iron_rod', n: 2 };
    ticks(3);
    expect(lonely.machine!.status).toBe('No power pole nearby');
  });
});

describe('packaging (§12)', () => {
  it('packs ten gears and a plank into a crate worth more than the loose gears', () => {
    const spot = openGround(3, 3, 130);
    const p = join('packer', spot.x + 1.5, spot.y + 3.5);
    const pack = place(p, 'packager', spot.x, spot.y);
    place(p, 'power_pole', spot.x + 1, spot.y);
    // Power: windmill → gearbox → generator, all beside the pole.
    place(p, 'windmill', spot.x + 2, spot.y - 1);
    place(p, 'gearbox', spot.x + 2, spot.y);
    place(p, 'generator', spot.x + 2, spot.y + 1);
    pack.machine!.in[0] = { id: 'iron_gear', n: 20, q: 1 };
    pack.machine!.in[1] = { id: 'plank', n: 2 };
    ticks(20 * 8);
    expect(countItem(pack.machine!.out, 'packed_gears')).toBe(2);
    expect(ITEM_BY_ID.get('packed_gears')!.value).toBeGreaterThan(ITEM_BY_ID.get('iron_gear')!.value * 10);
  });
});

describe('oil (§25–27)', () => {
  it('pumps crude from a seep through pipes to a refinery that makes plastic', () => {
    const w = game.world;
    // Find an oil seep with room around it.
    let seep: { x: number; y: number } | null = null;
    for (let y = 10; y < w.size - 10 && !seep; y++)
      for (let x = 10; x < w.size - 10 && !seep; x++)
        if (w.tile(x, y) === Tile.Oil && w.tile(x - 1, y) === Tile.Oil) seep = { x: x - 1, y };
    expect(seep).not.toBeNull();
    const { x, y } = seep!;
    for (const n of w.nodesNear(x + 3, y, 9)) n.gone = true;
    const p = join('oilman', x + 3.5, y + 4.5);
    // Pumpjack on the seep, driven by a windmill; pipe east to a refinery powered by a generator.
    const jack = place(p, 'pumpjack', x, y);
    place(p, 'windmill', x - 2, y - 1);
    place(p, 'gearbox', x - 2, y);
    place(p, 'gearbox', x - 1, y);
    place(p, 'pipe', x + 2, y);
    const refinery = place(p, 'refinery', x + 3, y, 1);
    refinery.machine!.mode = 'plastic';
    place(p, 'power_pole', x + 5, y + 2);
    place(p, 'windmill', x + 6, y + 2);
    place(p, 'gearbox', x + 6, y + 3);
    place(p, 'generator', x + 5, y + 3);
    ticks(20 * 12);
    expect(jack.machine!.status).toBe('Running');
    expect(countItem(refinery.machine!.out, 'plastic')).toBeGreaterThan(0);
    // Off the seep, a pumpjack cannot be placed.
    game.playerSystem.give(p, { id: 'pumpjack', n: 1 }, true);
    game.building.place(p, 'pumpjack', x + 1, y + 4, 0);
    expect(notices(p).slice(-1)[0]).toMatch(/oil seep/);
  });
});

describe('town projects (§53)', () => {
  it('pays for deliveries; finishing the mill builds a wheel on the river and grows the town', () => {
    const board = game.world.settlements.find((s) => s.id === 'westhaven')!.npcs.find((n) => n.profession === 'board')!;
    const p = join('mason', board.x + 1, board.y);
    expect(game.projects.current('westhaven')?.id).toBe('westhaven_mill');
    const before = game.economy.prosperity.get('westhaven') ?? 0;
    game.playerSystem.give(p, { id: 'plank', n: 70 }, true);
    const crests = p.crests;
    game.projects.deliver(p, board.id, 'plank');
    expect(p.crests).toBeGreaterThan(crests);
    expect(countItem(p.slots, 'plank')).toBe(0);
    const info = game.projects.info('westhaven')!;
    expect(info.needs.find((n) => n.item === 'plank')!.done).toBe(70);
    // A second helper finishes it.
    const q = join('carpenter', board.x - 1, board.y);
    game.playerSystem.give(q, { id: 'plank', n: 60 }, true);
    game.playerSystem.give(q, { id: 'iron_gear', n: 12, q: 1 }, true);
    game.playerSystem.give(q, { id: 'iron_plate', n: 6, q: 1 }, true);
    for (const item of ['plank', 'iron_gear', 'iron_plate']) game.projects.deliver(q, board.id, item);
    // Only 50 more planks were needed; 10 stay in the pack.
    expect(countItem(q.slots, 'plank')).toBe(10);
    expect(game.projects.current('westhaven')?.id).toBe('westhaven_warehouse');
    expect((game.economy.prosperity.get('westhaven') ?? 0) - before).toBeGreaterThanOrEqual(6000);
    const wheel = [...game.world.structures.values()].find((s) => s.type === 'water_wheel' && s.town);
    expect(wheel).toBeDefined();
    // Nobody can take it down.
    expect(game.building.canRemove(q, wheel!)).toBe(false);
  });
});
