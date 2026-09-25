import { beforeAll, describe, expect, it } from 'vitest';
import { countItem, type ServerMessage } from '@ironwild/shared';
import type { AccountRecord } from './persistence/storage';
import { MemoryStorage } from './persistence/memory-storage';
import { Game } from './game/game';
import { newCharacter, Player } from './game/player';
import type { ClientSession } from './game/session';
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

function place(p: Player, item: string, x: number, y: number, rot = 0): Structure {
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
