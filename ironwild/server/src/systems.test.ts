import { beforeAll, describe, expect, it } from 'vitest';
import {
  EntityFlags,
  GUARD_REPLACE_MINUTES,
  GUARD_WAGE,
  ITEM_BY_ID,
  SETTLEMENT_BY_ID,
  TILES,
  TRUCK_PAVED,
  TRUCK_SLOTS,
  TRUCK_SPEED,
  TRUCK_TANK,
  TRUCK_TILES_PER_FUEL,
  Tile,
  countItem,
  type BoardUi,
  type ServerMessage,
  type Snapshot,
} from '@ironwild/shared';
import type { AccountRecord } from './persistence/storage';
import { MemoryStorage } from './persistence/memory-storage';
import { Game } from './game/game';
import { newCharacter, Player } from './game/player';
import type { ClientSession } from './game/session';
import type { Cart, Creature } from './game/entities';
import { hostileCreature } from './game/guards';
import { QUEST_RADIUS } from './game/quests';
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

describe('hired guards (§42)', () => {
  it('work for wages paid ahead, see off wolves and raiders, are replaced if they fall and go home unpaid', () => {
    const owner = join('marshal');
    const spot = clearSpot(4, 4, 40);
    owner.move.x = spot.x + 0.5;
    owner.move.y = spot.y + 1.5;
    owner.crests = 3000;
    const claim = place(owner, 'land_claim', spot.x, spot.y);
    const house = place(owner, 'guard_house', spot.x + 2, spot.y);
    const chest = place(owner, 'chest', spot.x + 1, spot.y + 3);
    const stranger = join('drifter', spot.x + 1.5, spot.y + 2.5);
    stranger.crests = 1000;
    game.guards.hire(stranger, house.id, 1);
    expect(house.guard).toBeUndefined();
    expect(notices(stranger).slice(-1)[0]).toMatch(/belongs to marshal/);
    game.guards.hire(owner, house.id, 2); // not one of the terms
    expect(house.guard).toBeUndefined();
    game.guards.hire(owner, house.id, 1);
    expect(owner.crests).toBe(3000 - GUARD_WAGE);
    const guard = game.entities.get(house.guard!.entity) as Creature;
    expect(guard.guard?.post).toBe(house.id);
    expect(game.replication.visual(house)?.on).toBe(true);
    // Paying ahead extends the contract, up to two weeks.
    game.guards.hire(owner, house.id, 7);
    game.guards.hire(owner, house.id, 7);
    expect(notices(owner).slice(-1)[0]).toMatch(/at most 14 days/);
    expect(owner.crests).toBe(3000 - 8 * GUARD_WAGE);
    expect(game.guards.ui(owner, house)).toMatchObject({ kind: 'guard', status: 'On watch.', hp: 100, manage: true });
    expect(game.guards.ui(owner, house).left).toBeCloseTo(8 * 1440, -1);

    // The owner steps away; a wolf comes by the house and the guard sees it off, then mends.
    owner.move.x = spot.x + 30;
    const wolf = game.creatures.spawn('wolf', guard.x + 4, guard.y + 1, '');
    let bitten = false;
    for (let i = 0; i < 20 * 20 && game.entities.has(wolf.id); i++) {
      game.step();
      if (guard.hp < guard.def.hp) bitten = true;
    }
    expect(game.entities.has(wolf.id)).toBe(false);
    expect(game.entities.has(guard.id)).toBe(true);
    expect(bitten).toBe(true);
    const hurt = guard.hp;
    ticks(40);
    expect(guard.hp).toBeGreaterThan(Math.min(hurt, guard.def.hp - 1));
    // Players can't cut down a guard, and towers and traps leave them be.
    expect(hostileCreature(guard)).toBe(false);

    // Raiders come for the claim: the guard takes them on.
    chest.store![0] = { id: 'gold_ingot', n: 10 };
    guard.hp = guard.def.hp;
    expect(game.raids.start(claim, 0)).toBe(true);
    let fought = false;
    for (let i = 0; i < 20 * 240 && game.raids.active; i++) {
      game.step();
      for (const e of game.entities.values()) if (e.kind === 'creature' && e.raider && e.foe && e.hp < e.def.hp) fought = true;
    }
    expect(fought).toBe(true);
    expect(game.raids.active).toBe(false);

    // A fallen guard is replaced a couple of hours later, while the wages last.
    if (!house.guard!.entity) {
      // (Should the raiders have won, the replacement has had time to arrive.)
      game.minutes += GUARD_REPLACE_MINUTES;
      ticks(21);
    }
    game.creatures.damage(game.entities.get(house.guard!.entity) as Creature, 10_000, null, 0, false);
    expect(house.guard!.entity).toBe(0);
    expect(game.guards.ui(owner, house).status).toBe('A new guard is on the way.');
    expect(game.replication.visual(house)?.on).toBeFalsy();
    game.minutes += GUARD_REPLACE_MINUTES;
    ticks(21);
    const replacement = game.entities.get(house.guard!.entity) as Creature;
    expect(replacement?.guard?.post).toBe(house.id);
    expect(replacement.hp).toBe(replacement.def.hp);
    // Saved with the house, not as an animal.
    expect(game.factory.saveStructure(house).data).toMatchObject({ guard: { until: house.guard!.until } });
    expect(game.creatures.save().some((e) => e.type === 'guard')).toBe(false);

    // When the wages run out, the guard goes home.
    house.guard!.until = game.minutes;
    ticks(21);
    expect(house.guard).toBeUndefined();
    expect(game.entities.has(replacement.id)).toBe(false);
    expect(notices(owner).some((n) => /wages at the guard house ran out/.test(n))).toBe(true);
  });
});

describe('town quests (§53)', () => {
  it('bounties pay on the last kill; salvage jobs put out a wreck whose cargo pays at the board', () => {
    for (const s of game.world.settlements) {
      const kinds = game.quests.quests.filter((q) => q.settlement === s.id).map((q) => q.kind);
      expect(kinds.sort(), s.id).toEqual(['bounty', 'salvage']);
    }
    const p = join('questor');
    const town = game.world.settlements[0];
    const board = town.npcs.find((n) => n.profession === 'board')!;
    const toBoard = () => {
      p.move.x = board.x + 1;
      p.move.y = board.y;
    };
    toBoard();
    const bounty = game.quests.quests.find((q) => q.settlement === town.id && q.kind === 'bounty')!;
    const salvage = game.quests.quests.find((q) => q.settlement === town.id && q.kind === 'salvage')!;
    const ui = game.economy.npcUi(p, board.id) as BoardUi;
    expect(ui.quests.map((q) => q.id).sort()).toEqual([bounty.id, salvage.id].sort());

    // Taking the bounty sends the pack to its place; one quest at a time.
    game.quests.handle(p, 'accept', bounty.id);
    expect(bounty.taker).toBe(p.accountId);
    const pack = [...game.entities.values()].filter((e) => e.kind === 'creature' && e.quest === bounty.id) as Creature[];
    expect(pack).toHaveLength(bounty.n);
    expect(pack.every((c) => c.def.id === bounty.creature && Math.hypot(c.x - bounty.x, c.y - bounty.y) < QUEST_RADIUS)).toBe(true);
    game.quests.handle(p, 'accept', salvage.id);
    expect(salvage.taker).toBeNull();
    // Killing them there pays on the last one, and a new bounty goes up.
    const before = p.crests;
    for (const c of pack) game.creatures.damage(c, 10_000, p, 0, false);
    expect(p.crests).toBeGreaterThanOrEqual(before + bounty.pay);
    expect(game.quests.quests.includes(bounty)).toBe(false);
    expect(notices(p).some((n) => n.startsWith(`Quest complete: ${bounty.title}`))).toBe(true);
    expect(game.quests.quests.some((q) => q.settlement === town.id && q.kind === 'bounty')).toBe(true);

    // Salvage: a wreck with the cargo appears out there, watched by two bandits; nobody can carry it off.
    game.quests.handle(p, 'accept', salvage.id);
    const wreck = game.world.structures.get(salvage.wreck!)!;
    expect(wreck.def.wreck).toBe(true);
    expect(countItem(wreck.store!, 'lost_cargo')).toBe(1);
    expect([...game.entities.values()].filter((e) => e.kind === 'creature' && e.quest === salvage.id)).toHaveLength(2);
    expect(game.building.canRemove(p, wreck)).toBe(false);
    game.quests.handle(p, 'deliver', salvage.id);
    expect(notices(p).slice(-1)[0]).toMatch(/Bring the lost cargo/);
    // Search the wreck, take the cargo home, hand it in.
    p.move.x = wreck.x + 1;
    p.move.y = wreck.y + 1.8;
    game.playerSystem.interact(p, 'struct', wreck.id);
    game.playerSystem.quickMove(p, { s: 'store', i: wreck.store!.findIndex((x) => x?.id === 'lost_cargo') });
    expect(countItem(p.slots, 'lost_cargo')).toBe(1);
    toBoard();
    const before2 = p.crests;
    game.quests.handle(p, 'deliver', salvage.id);
    expect(p.crests).toBe(before2 + salvage.pay);
    expect(countItem(p.slots, 'lost_cargo')).toBe(0);
    expect(game.world.structures.has(wreck.id)).toBe(false);
    expect([...game.entities.values()].some((e) => e.kind === 'creature' && e.quest === salvage.id)).toBe(false);

    // A quest not finished in two days fails and its pack goes away.
    const next = game.quests.quests.find((q) => q.settlement === town.id && q.kind === 'bounty')!;
    game.quests.handle(p, 'accept', next.id);
    expect([...game.entities.values()].some((e) => e.kind === 'creature' && e.quest === next.id)).toBe(true);
    const was = game.minutes;
    game.minutes = next.deadline + 1;
    game.quests.check();
    game.minutes = was;
    expect(game.quests.quests.includes(next)).toBe(false);
    expect([...game.entities.values()].some((e) => e.kind === 'creature' && e.quest === next.id)).toBe(false);
    expect(notices(p).slice(-1)[0]).toMatch(/Quest failed/);
    expect(game.quests.save().length).toBe(game.world.settlements.length * 2);
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

describe('motor trucks (§36)', () => {
  it('fill up with fuel oil, drive fast, burn fuel by the tile, top up from the bed and stop when dry', () => {
    const spot = openGround(6, 3, 120);
    const p = join('trucker', spot.x + 1.5, spot.y + 1.5);
    game.playerSystem.give(p, { id: 'motor_truck', n: 1 }, true);
    game.playerSystem.useItem(
      p,
      p.slots.findIndex((s) => s?.id === 'motor_truck'),
      spot.x + 3.5,
      spot.y + 1.5,
    );
    const truck = [...game.entities.values()].find((e) => e.kind === 'cart' && e.type === 'truck') as Cart;
    expect(truck.slots).toHaveLength(TRUCK_SLOTS);
    // It comes with an empty tank and won't start.
    game.playerSystem.interact(p, 'entity', truck.id, 'grab');
    expect(p.driving).toBe(0);
    expect(notices(p).slice(-1)[0]).toMatch(/tank is empty/);
    // E with fuel oil in hand fills the tank (six fit); with a full tank E opens the bed instead.
    game.playerSystem.give(p, { id: 'fuel_oil', n: 10 }, true);
    p.sel = p.slots.findIndex((s) => s?.id === 'fuel_oil');
    game.playerSystem.interact(p, 'entity', truck.id);
    expect(truck.fuel).toBe(TRUCK_TANK * TRUCK_TILES_PER_FUEL);
    expect(countItem(p.slots, 'fuel_oil')).toBe(4);
    expect(p.uiTarget).toBeNull();
    game.playerSystem.interact(p, 'entity', truck.id);
    expect(countItem(p.slots, 'fuel_oil')).toBe(4);
    expect(p.ui).toMatchObject({ kind: 'container', title: "trucker's motor truck — tank 100 %" });
    game.playerSystem.closeUi(p);

    // Behind the wheel: faster than a horse, quicker still on roads, and the truck is drawn under the driver.
    game.playerSystem.interact(p, 'entity', truck.id, 'grab');
    expect(p.driving).toBe(truck.id);
    expect(truck.driver).toBe(p.id);
    ticks(1);
    expect(p.mods).toMatchObject({ speed: TRUCK_SPEED, paved: TRUCK_PAVED });
    const watcher = join('watcher', spot.x + 2, spot.y + 2.5);
    const snap = (game.replication as unknown as { snapshot(s: unknown, p: Player): Snapshot }).snapshot(watcher.session, watcher);
    expect(snap.e.some((t) => t[0] === truck.id)).toBe(false);
    expect(snap.sp?.find((sp) => sp.id === p.id)).toMatchObject({ mount: 'truck', n: 0 });
    expect(snap.e.find((t) => t[0] === p.id)![5] & EntityFlags.Driving).toBeTruthy();
    // Four tiles west burn four tiles of fuel, and the truck keeps up.
    const before = truck.fuel!;
    p.move.x -= 4;
    p.inputs.push([p.lastSeq + 1, 0, 0, 0, 0]);
    ticks(1);
    expect(truck.x).toBeCloseTo(p.x, 6);
    expect(before - truck.fuel!).toBeCloseTo(4, 6);

    // Nearly dry: a fuel oil carried in the bed tops the tank up.
    truck.fuel = 1;
    truck.slots[0] = { id: 'fuel_oil', n: 1 };
    p.move.x += 3;
    p.inputs.push([p.lastSeq + 1, 0, 0, 0, 0]);
    ticks(1);
    expect(truck.slots[0]).toBeNull();
    expect(truck.fuel).toBeCloseTo(1 + TRUCK_TILES_PER_FUEL - 3, 6);
    // Nothing left: the truck stops and the driver climbs out.
    truck.fuel = 0.5;
    p.move.x += 2;
    p.inputs.push([p.lastSeq + 1, 0, 0, 0, 0]);
    ticks(1);
    expect(p.driving).toBe(0);
    expect(truck.driver).toBe(0);
    expect(truck.fuel).toBe(0);
    expect(notices(p).slice(-1)[0]).toMatch(/ran out of fuel oil/);

    // G gets you out; the tank and load are saved.
    truck.fuel = 200;
    game.playerSystem.interact(p, 'entity', truck.id, 'grab');
    expect(p.driving).toBe(truck.id);
    game.playerSystem.dismount(p);
    expect(p.driving).toBe(0);
    expect(truck.driver).toBe(0);
    // The driver steps down beside the cab.
    expect(Math.hypot(p.x - truck.x, p.y - truck.y)).toBeCloseTo(0.95, 3);
    const saved = game.combat.save().find((e) => e.kind === 'cart' && e.type === 'truck');
    expect(saved).toMatchObject({ data: { fuel: 200 } });
    game.removeEntity(truck.id);
    game.combat.load([saved!]);
    const loaded = [...game.entities.values()].find((e) => e.kind === 'cart' && e.type === 'truck') as Cart;
    expect(loaded.fuel).toBe(200);
    expect(loaded.slots).toHaveLength(TRUCK_SLOTS);
    game.removeEntity(loaded.id);
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
    expect((game.economy.prosperity.get('westhaven') ?? 0) - before).toBeGreaterThan(5999.99);
    const wheel = [...game.world.structures.values()].find((s) => s.type === 'water_wheel' && s.town);
    expect(wheel).toBeDefined();
    // Nobody can take it down.
    expect(game.building.canRemove(q, wheel!)).toBe(false);
  });
});

describe('ambitions (§63)', () => {
  it('tallies sales by town and value added, climbs the wealth ladder, ranks the standings and saves', async () => {
    const p = join('tycoon');
    const smith = game.world.settlements[0].npcs.find((n) => n.profession === 'blacksmith')!;
    p.move.x = smith.x + 1;
    p.move.y = smith.y;
    game.playerSystem.give(p, { id: 'iron_ore', n: 20 }, true);
    const before = p.crests;
    game.economy.trade(p, smith.id, 'sell', 'iron_ore', 20);
    const earned = p.crests - before;
    const t = game.ambitions.tallyOf(p.accountId);
    expect(earned).toBeGreaterThan(0);
    expect(t.income).toBeCloseTo(earned, 1);
    expect(t.n['sales:westhaven']).toBeCloseTo(earned, 1);

    // A furnace's work counts: the ingots it makes and the value it adds to the ore.
    const spot = clearSpot(2, 2);
    p.move.x = spot.x + 0.5;
    p.move.y = spot.y + 2.5;
    const furnace = place(p, 'furnace', spot.x, spot.y);
    furnace.machine!.in[0] = { id: 'iron_ore', n: 10 };
    furnace.machine!.fuel![0] = { id: 'coal', n: 5 };
    ticks(20 * 3 * 10 + 20);
    expect(t.n['made:iron_ingot']).toBe(7);
    expect(t.best.added).toBeGreaterThan(0);

    // Worth ₡5,000: the first rung of the ladder, announced to everyone.
    expect(game.ambitions.title(p.accountId)).toBeNull();
    p.crests += 6000;
    ticks(20 * 5);
    expect(game.ambitions.title(p.accountId)).toBe('Homesteader');
    expect(game.ambitions.prestige(p.accountId)).toBe(1);
    expect(notices(p).some((n) => n.includes('Ambition achieved: Homesteader'))).toBe(true);
    const chat = (p.session as unknown as { messages: ServerMessage[] }).messages.filter((m) => m.t === 'chat');
    expect(chat.some((m) => (m as { text: string }).text.includes('tycoon is now a Homesteader'))).toBe(true);

    const info = game.ambitions.standings(p)!;
    expect(info.you.title).toBe('Homesteader');
    expect(info.ambitions.find((a) => a.id === 'homesteader')?.done).toBe(true);
    expect(info.ambitions.find((a) => a.id === 'craftsman')?.progress).toBeGreaterThan(0.2);
    expect(info.boards.find((b) => b.id === 'worth')!.rows.find((r) => r.you)).toMatchObject({ name: 'tycoon', title: 'Homesteader' });
    const westhaven = info.towns.find((x) => x.name === 'Westhaven')!.rows;
    expect(westhaven.length).toBeGreaterThan(0);
    expect(westhaven.every((r, i) => i === 0 || r.value <= westhaven[i - 1].value)).toBe(true);

    // Tallies live in the world save, so they survive a restart.
    const storage = new MemoryStorage();
    await storage.saveWorld(game.serialize());
    const again = new Game(storage, { seed: 777 });
    again.log = () => undefined;
    await again.init();
    expect(again.ambitions.tallyOf(p.accountId).done).toContain('homesteader');
    expect(again.ambitions.tallyOf(p.accountId).n['made:iron_ingot']).toBe(7);
  });
});

describe('monuments (§64)', () => {
  it('stand for good once raised, add prestige, show on every map and refresh people nearby', () => {
    const p = join('patron');
    const spot = clearSpot(6, 4, 40);
    p.move.x = spot.x + 3;
    p.move.y = spot.y + 4.6;
    const before = game.ambitions.prestige(p.accountId);
    const worth = game.ambitions.worth(p.accountId);
    const obelisk = place(p, 'obelisk', spot.x, spot.y);
    expect(obelisk.raised).toBeGreaterThan(0);
    // The money is sunk: a raised monument adds prestige, not worth.
    expect(game.ambitions.worth(p.accountId)).toBeCloseTo(worth, 0);
    const chat = (p.session as unknown as { messages: ServerMessage[] }).messages.filter((m) => m.t === 'chat');
    expect(chat.some((m) => (m as { text: string }).text.includes('patron raised a Stone Obelisk'))).toBe(true);
    expect(game.ambitions.prestige(p.accountId)).toBe(before + 3);
    expect(game.ambitions.monumentList()).toContainEqual({ type: 'obelisk', x: spot.x + 1, y: spot.y + 1, owner: 'patron' });
    // No hammer takes it down, not even its owner's.
    expect(game.building.canRemove(p, obelisk)).toBe(false);
    ticks(20 * 5);
    expect(game.ambitions.tallyOf(p.accountId).done).toContain('monument_builder');

    // A grand fountain gives people resting by it their wind back.
    const fountain = place(p, 'grand_fountain', spot.x + 3, spot.y);
    expect(fountain.def.monument?.refresh).toBeGreaterThan(0);
    p.buffs.clear();
    ticks(20);
    expect(p.buffs.has('stamina')).toBe(true);
    expect(p.buffs.has('regen')).toBe(true);
  });
});

describe('mechanical drills (§62)', () => {
  it('mines the vein it stands over without end, and gives it back when taken away', () => {
    const p = join('driller');
    const w = game.world;
    // An iron vein with open meadow round it.
    const vein = [...w.nodes.values()].find((n) => {
      if (n.type !== 'iron_vein' || n.gone || w.settlementAt(n.x, n.y, 20)) return false;
      const x = Math.floor(n.x) - 1;
      const y = Math.floor(n.y) - 1;
      for (let ty = y - 2; ty <= y + 4; ty++)
        for (let tx = x - 2; tx <= x + 3; tx++) if (!TILES[w.tile(tx, ty)].land || w.structAt(tx, ty) || w.claimAt(tx, ty)) return false;
      return true;
    })!;
    expect(vein).toBeDefined();
    const x = Math.floor(vein.x) - 1;
    const y = Math.floor(vein.y) - 1;
    for (const n of w.nodesNear(x + 1, y + 1, 5)) if (n !== vein) n.gone = true;
    p.move.x = x + 1;
    p.move.y = y + 3.6;

    // Not over a vein: refused.
    game.playerSystem.give(p, { id: 'drill', n: 1 }, true);
    game.building.place(p, 'drill', x - 3, y + 2, 0);
    expect(notices(p).some((t) => t.includes('must stand over an ore vein'))).toBe(true);

    const drill = place(p, 'drill', x, y);
    expect(drill.node).toBe(vein.id);
    expect(vein.gone).toBe(true);
    expect(drill.machine!.mode).toBe('iron_vein');
    // A windmill turns it through a gearbox; a crate in front catches what it digs.
    place(p, 'gearbox', x - 1, y);
    place(p, 'windmill', x - 1, y - 1);
    const crate = place(p, 'storage_crate', x, y - 1);
    ticks(20 * 40);
    expect(drill.speed).toBeGreaterThan(0);
    expect(countItem(crate.store!, 'iron_ore')).toBeGreaterThan(1);
    expect(countItem(crate.store!, 'stone')).toBeGreaterThan(0);
    expect(game.ambitions.tallyOf(p.accountId).n['made:iron_ore']).toBeGreaterThan(1);

    // Take the drill away and the vein is back, whole.
    game.building.hammer(p, drill);
    expect(w.structures.has(drill.id)).toBe(false);
    expect(vein.gone).toBe(false);
    expect(vein.amount).toBe(vein.def.amount);
    expect(countItem(p.slots, 'drill')).toBe(2);
  });
});

describe('interaction reach', () => {
  it('lets you use what the prompt offers: a chest 3.3 tiles off, a horse at arm’s length', () => {
    const spot = clearSpot(6, 3, 30);
    const p = join('reacher', spot.x + 3, spot.y + 2);
    const chest = place(p, 'chest', spot.x, spot.y);
    // The client offers "E Open" up to INTERACT_RANGE + 0.6 from the nearest edge.
    p.move.x = spot.x + 1 + 3.3;
    p.move.y = spot.y + 0.5;
    game.playerSystem.interact(p, 'struct', chest.id);
    expect(p.uiTarget).toMatchObject({ kind: 'struct', id: chest.id });
    game.playerSystem.closeUi(p);

    game.playerSystem.give(p, { id: 'horse', n: 1 }, true);
    const slot = p.slots.findIndex((x) => x?.id === 'horse');
    game.playerSystem.useItem(p, slot, p.x + 1.5, p.y);
    const horse = [...game.entities.values()].find((e) => e.kind === 'creature' && e.def.id === 'horse' && e.owner === p.accountId)!;
    expect(horse).toBeDefined();
    // It wandered a little: 3.6 tiles from us, centre to centre.
    horse.x = p.x + 3.6;
    horse.y = p.y;
    game.playerSystem.interact(p, 'entity', horse.id, 'grab');
    expect(p.mounted).toBe(horse.id);
    // G in the saddle: the ridden horse isn't sent to the client, so it just asks to get down.
    (p.session as unknown as { player: Player }).player = p;
    game.handleMessage(p.session, { t: 'dismount' });
    expect(p.mounted).toBe(0);
    expect((horse as { rider?: number }).rider).toBeUndefined();
  });
});

describe('power plants (§64)', () => {
  it('a steam turbine turns a boiler’s steam straight into power on the grid', () => {
    const w = game.world;
    const land = (x: number, y: number) => TILES[w.tile(x, y)].land && !w.structAt(x, y) && !w.claimAt(x, y) && !w.settlementAt(x, y, 8);
    let spot: { x: number; y: number } | null = null;
    for (let y = 40; y < w.size - 40 && !spot; y++)
      for (let x = 40; x < w.size - 40 && !spot; x++) {
        if (w.tile(x - 1, y) !== Tile.Water) continue;
        let ok = true;
        for (let dy = -2; dy <= 2 && ok; dy++) for (let dx = 0; dx <= 8 && ok; dx++) if (!land(x + dx, y + dy)) ok = false;
        if (ok) spot = { x, y };
      }
    expect(spot).not.toBeNull();
    const { x, y } = spot!;
    for (const n of w.nodesNear(x + 4, y, 10)) n.gone = true;
    for (const e of [...game.entities.values()]) if (e.kind === 'creature' && Math.hypot(e.x - x, e.y - y) < 16) game.removeEntity(e.id);
    const p = join('plant manager', x + 3.5, y + 3.5);
    // Windmill → gearbox → pump; pipe → boiler (steam out east) → pipe → turbine; a pole beside it.
    place(p, 'windmill', x, y - 2);
    place(p, 'gearbox', x, y - 1);
    place(p, 'pump', x, y);
    place(p, 'pipe', x + 1, y);
    const boiler = place(p, 'boiler', x + 2, y, 1);
    place(p, 'pipe', x + 4, y);
    const turbine = place(p, 'steam_turbine', x + 5, y - 1);
    place(p, 'power_pole', x + 6, y + 1);
    ticks(20 * 4);
    expect(turbine.machine!.status).toBe('No steam');
    expect(game.power.gridAt(turbine)?.supply).toBe(0);
    boiler.machine!.fuel![0] = { id: 'coal', n: 10 };
    ticks(20 * 8);
    // A windmill pump gives 12.5–20 water a second, so the turbine runs at 60–100 %.
    expect(turbine.machine!.active).toBe(true);
    const supply = game.power.gridAt(turbine)!.supply;
    expect(supply).toBeGreaterThan(1100);
    expect(supply).toBeLessThanOrEqual(2000);
    const ui = game.factory.machineUi(p, turbine);
    expect(ui.tanks?.[0].fluid).toBe('Steam');
    expect(ui.rate?.perSec).toBeGreaterThan(10);
    expect(ui.grid?.supply).toBe(supply);
  });
});

describe('storehouses and lubricators (§23, §61)', () => {
  it('a storehouse holds 72 stacks; a lubricator oils its neighbours and takes nothing but lubricant', () => {
    const spot = clearSpot(6, 3, 30);
    const p = join('quartermaster', spot.x + 3, spot.y + 4);
    const store = place(p, 'storehouse', spot.x, spot.y);
    expect(store.store).toHaveLength(72);
    expect(game.factory.insert(store, 1, { id: 'iron_ore', n: 1 })).toBe(true);

    const furnace = place(p, 'furnace', spot.x + 4, spot.y);
    const oiler = place(p, 'lubricator', spot.x + 5, spot.y);
    // One item only, from conveyors and by hand.
    expect(game.factory.insert(oiler, 1, { id: 'stone', n: 1 })).toBe(false);
    expect(game.factory.insert(oiler, 1, { id: 'lubricant', n: 1 })).toBe(true);
    oiler.store![0]!.n = 3;
    furnace.machine!.wear = 0.5;
    ticks(20 + 1);
    expect(furnace.machine!.wear).toBe(0);
    expect(furnace.machine!.lube).toBeGreaterThan(game.minutes);
    expect(countItem(oiler.store!, 'lubricant')).toBe(2);
    // Oiled machines are left alone until their day is up.
    ticks(20 * 3);
    expect(countItem(oiler.store!, 'lubricant')).toBe(2);
    furnace.machine!.lube = game.minutes - 1;
    ticks(20 + 1);
    expect(countItem(oiler.store!, 'lubricant')).toBe(1);
  });
});
