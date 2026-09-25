// The economy (§7, §12–15, §33–35, §47): settlement markets whose prices follow supply and
// demand, NPC traders by profession, bulk contracts, shipping crates that sell automatically at
// dawn, the player exchange (buy orders) and player shop stands.

import {
  ASK_MARKUP,
  ITEMS,
  ITEM_BY_ID,
  PROFESSION_BY_ID,
  SETTLEMENT_BY_ID,
  addStack,
  countItem,
  formatCrests,
  midPrice,
  purchaseCost,
  qualityMultiplier,
  recoverStock,
  removeItem,
  roomFor,
  roundCrests,
  saleValue,
  targetStock,
  type BoardUi,
  type ClientMessage,
  type ContractInfo,
  type ExchangeUi,
  type GenNpc,
  type ItemDef,
  type ItemStack,
  type Profession,
  type SettlementDef,
  type ShopUi,
  type TradeListing,
  type TradeUi,
  type UiState,
} from '@ironwild/shared';
import type { ContractSave, OrderSave, WorldSave } from '../persistence/storage';
import { isCompanyAccount } from './companies';
import type { Game } from './game';
import type { Player } from './player';
import type { Structure } from './world';

interface NpcRef {
  npc: GenNpc;
  prof: Profession;
  settlement: SettlementDef;
}

/** Market events (§14): news that shifts what a settlement wants for a day or so. */
interface EventTemplate {
  kind: string;
  title: string;
  /** `{town}` is replaced by the settlement's name. */
  text: string;
  items?: string[];
  tags?: string[];
  /** Target stock multiplier while it lasts (demand), and a one-off change to current stock (supply). */
  demand: number;
  supply: number;
  only?: string[];
}

const EVENTS: EventTemplate[] = [
  {
    kind: 'shortage',
    title: 'Iron shortage',
    text: "{town}'s smelters have run dry: iron in any form sells dear.",
    items: ['iron_ore', 'crushed_iron', 'iron_concentrate', 'iron_ingot', 'iron_plate', 'iron_rod'],
    demand: 2,
    supply: 0.5,
  },
  {
    kind: 'shortage',
    title: 'Coal shortage',
    text: 'A cold snap in {town}: coal and charcoal are wanted.',
    items: ['coal', 'charcoal'],
    demand: 2.2,
    supply: 0.4,
  },
  {
    kind: 'festival',
    title: 'Harvest festival',
    text: '{town} is celebrating: food sells for more than usual.',
    tags: ['food'],
    demand: 1.8,
    supply: 0.7,
  },
  {
    kind: 'shortage',
    title: 'Bad harvest',
    text: 'Blight in the fields around {town}: grain, flour and bread are scarce.',
    items: ['wheat', 'flour', 'bread', 'carrot', 'potato'],
    demand: 2,
    supply: 0.4,
  },
  {
    kind: 'boom',
    title: 'Building boom',
    text: '{town} is building: planks, bricks, stone and glass are in demand.',
    items: ['plank', 'hardwood_plank', 'stone_brick', 'brick', 'glass', 'stone', 'wood'],
    demand: 1.8,
    supply: 0.6,
  },
  {
    kind: 'shortage',
    title: 'Bandit scare',
    text: 'Bandits on the roads near {town}: weapons and arrows are in demand.',
    tags: ['weapon'],
    demand: 2,
    supply: 0.5,
  },
  {
    kind: 'boom',
    title: 'Mill expansion',
    text: "{town}'s mills are expanding: gears, rods, wire and bearings are wanted.",
    items: ['iron_gear', 'steel_gear', 'iron_rod', 'copper_wire', 'bearing', 'gearbox_unit'],
    demand: 2,
    supply: 0.5,
  },
  {
    kind: 'festival',
    title: 'Wedding season',
    text: 'Wealthy families in {town} want gems, silver and gold.',
    tags: ['luxury'],
    demand: 1.8,
    supply: 0.6,
  },
  {
    kind: 'festival',
    title: 'Fish week',
    text: '{town} is off meat for the week: fish is in demand.',
    items: ['perch', 'trout', 'carp', 'pike', 'salmon', 'mackerel', 'sea_bass', 'cooked_fish'],
    demand: 2,
    supply: 0.5,
  },
  {
    kind: 'glut',
    title: 'Timber glut',
    text: 'A logging camp flooded {town} with timber: wood is cheap.',
    items: ['wood', 'hardwood', 'plank', 'hardwood_plank'],
    demand: 1,
    supply: 2.5,
  },
  {
    kind: 'glut',
    title: 'Ore glut',
    text: 'A rich new seam near {town}: ore is cheap for now.',
    items: ['iron_ore', 'copper_ore', 'coal'],
    demand: 1,
    supply: 2.5,
  },
];

export interface MarketEvent {
  id: number;
  settlement: string;
  title: string;
  text: string;
  items: string[];
  demand: number;
  /** Game minute it ends. */
  ends: number;
}

const MAX_EVENTS = 2;

const OPEN_CONTRACTS = 3;
const MAX_CONTRACTS_PER_PLAYER = 3;
const HAULAGE_FEE = 0.1;

export class Economy {
  private readonly npcs = new Map<string, NpcRef>();
  /** Settlement → item → stock. */
  private readonly stock = new Map<string, Map<string, number>>();
  private readonly traded = new Map<string, Set<string>>();
  readonly prosperity = new Map<string, number>();
  contracts: ContractSave[] = [];
  orders: OrderSave[] = [];
  private lastShippingDay = 0;
  private nextId = 1;
  events: MarketEvent[] = [];
  private lastEventHour = -1;

  constructor(private readonly game: Game) {
    for (const s of game.world.settlements) {
      const def = SETTLEMENT_BY_ID.get(s.id)!;
      for (const n of s.npcs) this.npcs.set(n.id, { npc: n, prof: PROFESSION_BY_ID.get(n.profession)!, settlement: def });
      const traded = new Set<string>();
      for (const t of [...def.traders, ...def.growth.map((g) => g.trader)]) {
        const prof = PROFESSION_BY_ID.get(t)!;
        for (const id of prof.sells) traded.add(id);
        for (const it of ITEMS) if (it.tags.some((tag) => prof.buys.includes(tag))) traded.add(it.id);
      }
      this.traded.set(s.id, traded);
      this.stock.set(s.id, new Map());
    }
  }

  init(): void {
    for (const s of this.game.world.settlements) {
      const def = SETTLEMENT_BY_ID.get(s.id)!;
      const m = this.stock.get(s.id)!;
      for (const id of this.traded.get(s.id)!) if (!m.has(id)) m.set(id, this.target(ITEM_BY_ID.get(id)!, def));
      while (this.contracts.filter((c) => c.settlement === s.id).length < OPEN_CONTRACTS) this.newContract(def);
    }
    this.lastShippingDay = this.game.hour >= 6 ? this.game.day : this.game.day - 1;
  }

  npc(id: string): GenNpc | undefined {
    return this.npcs.get(id)?.npc;
  }

  private target(def: ItemDef, s: SettlementDef): number {
    const growth = (1 + (this.prosperity.get(s.id) ?? 0) / 60000) * this.game.projects.scale(s.id);
    let demand = 1;
    for (const e of this.events) if (e.settlement === s.id && e.items.includes(def.id)) demand *= e.demand;
    return targetStock(def, s) * growth * demand;
  }

  private stockOf(s: SettlementDef, item: string): number {
    const m = this.stock.get(s.id)!;
    let v = m.get(item);
    if (v === undefined) {
      v = this.target(ITEM_BY_ID.get(item)!, s);
      m.set(item, v);
    }
    return v;
  }

  private tradingBonus(p: Player): number {
    return p.skill('trading') * 0.005;
  }

  /** Price per unit a trader pays for the next unit. */
  bid(s: SettlementDef, prof: Profession, def: ItemDef, q?: number): number {
    const target = this.target(def, s);
    return midPrice(def, s, this.stockOf(s, def.id), target) * prof.bidRate * qualityMultiplier(q);
  }

  ask(s: SettlementDef, def: ItemDef): number {
    const target = this.target(def, s);
    return midPrice(def, s, this.stockOf(s, def.id), target) * ASK_MARKUP;
  }

  private buysItem(prof: Profession, def: ItemDef): boolean {
    return def.tags.some((t) => prof.buys.includes(t));
  }

  /** Best trader in a settlement for selling an item, or null if nobody buys it. */
  /** Traders with an open stall in a settlement (grows with prosperity, §54). */
  openTraders(s: SettlementDef): string[] {
    const p = this.prosperity.get(s.id) ?? 0;
    return [...s.traders, ...s.growth.filter((g) => p >= g.at).map((g) => g.trader)];
  }

  isOpen(npcId: string): boolean {
    const ref = this.npcs.get(npcId);
    if (!ref) return false;
    return (ref.npc.unlock ?? 0) <= (this.prosperity.get(ref.settlement.id) ?? 0);
  }

  bestBuyer(s: SettlementDef, def: ItemDef): Profession | null {
    let best: Profession | null = null;
    for (const t of this.openTraders(s)) {
      const prof = PROFESSION_BY_ID.get(t)!;
      if (!this.buysItem(prof, def)) continue;
      if (!best || prof.bidRate > best.bidRate) best = prof;
    }
    return best;
  }

  // ——— Ticking ———

  stepSecond(): void {
    if (this.game.tick % (5 * 20) === 0) {
      const days = 5 / this.game.dayLength;
      for (const s of this.game.world.settlements) {
        const def = SETTLEMENT_BY_ID.get(s.id)!;
        for (const [item, v] of this.stock.get(s.id)!) {
          const target = this.target(ITEM_BY_ID.get(item)!, def);
          if (Math.abs(v - target) < 0.05) continue;
          this.stock.get(s.id)!.set(item, recoverStock(v, target, days));
        }
      }
    }
    // Contracts expire.
    for (const c of [...this.contracts]) {
      if (this.game.minutes <= c.deadline) continue;
      this.contracts = this.contracts.filter((x) => x !== c);
      if (c.taker) {
        const def = ITEM_BY_ID.get(c.item)!;
        const partial = roundCrests(c.delivered * (c.pay / c.n) * 0.5);
        this.credit(c.taker, partial);
        const p = this.game.byAccount.get(c.taker);
        if (p) {
          this.game.notice(
            p,
            `Contract expired: ${c.n}× ${def.name}. You were paid ${formatCrests(partial)} for what you delivered.`,
            'bad',
          );
          this.sendContracts(p);
        }
      }
      this.newContract(SETTLEMENT_BY_ID.get(c.settlement)!);
    }
    // Market news, checked once a game hour.
    const hour = Math.floor(this.game.minutes / 60);
    if (hour !== this.lastEventHour) {
      this.lastEventHour = hour;
      this.stepEvents();
    }
    // Merchant wagons collect shipping crates at dawn (§35).
    if (this.game.hour >= 6 && this.game.day > this.lastShippingDay) {
      this.lastShippingDay = this.game.day;
      this.shipAll();
    }
  }

  // ——— Market events (§14) ———

  private stepEvents(): void {
    const now = this.game.minutes;
    const ended = this.events.filter((e) => e.ends <= now);
    if (ended.length) {
      this.events = this.events.filter((e) => e.ends > now);
      for (const e of ended) {
        const town = SETTLEMENT_BY_ID.get(e.settlement)?.name ?? e.settlement;
        this.game.broadcastChat('', `Market news: the ${e.title.toLowerCase()} in ${town} is over.`, 'system');
      }
      this.sendTowns();
    }
    if (this.events.length < MAX_EVENTS && Math.random() < 0.12) this.startEvent();
  }

  /** Starts a random event (or a given one) in a random settlement that trades its goods. */
  startEvent(title?: string, settlement?: string): MarketEvent | null {
    const towns = this.game.world.settlements.filter((g) => !settlement || g.id === settlement);
    const options: { t: EventTemplate; s: SettlementDef; items: string[] }[] = [];
    for (const g of towns) {
      const def = SETTLEMENT_BY_ID.get(g.id)!;
      const traded = this.traded.get(g.id)!;
      for (const t of EVENTS) {
        if (title && t.title.toLowerCase() !== title.toLowerCase()) continue;
        if (this.events.some((e) => e.settlement === g.id && (e.title === t.title || !settlement))) continue;
        const items = ITEMS.filter(
          (it) => traded.has(it.id) && (t.items?.includes(it.id) || it.tags.some((tag) => t.tags?.includes(tag))),
        ).map((it) => it.id);
        if (items.length >= 2) options.push({ t, s: def, items });
      }
    }
    if (options.length === 0) return null;
    const pick = options[Math.floor(Math.random() * options.length)];
    const e: MarketEvent = {
      id: this.nextId++,
      settlement: pick.s.id,
      title: pick.t.title,
      text: pick.t.text.replace('{town}', pick.s.name),
      items: pick.items,
      demand: pick.t.demand,
      ends: this.game.minutes + (0.6 + Math.random() * 0.6) * 1440,
    };
    this.events.push(e);
    const m = this.stock.get(pick.s.id)!;
    for (const id of pick.items) m.set(id, this.stockOf(pick.s, id) * pick.t.supply);
    this.game.broadcastChat('', `Market news — ${e.title}: ${e.text}`, 'system');
    this.sendTowns();
    return e;
  }

  newDay(): void {
    this.game.log(`day ${this.game.day} begins`);
  }

  // ——— NPC UIs ———

  npcUi(p: Player, id: string): UiState | null {
    const ref = this.npcs.get(id);
    if (!ref || !this.isOpen(id)) return null;
    if (Math.hypot(ref.npc.x - p.x, ref.npc.y - p.y) > 5) return null;
    if (ref.prof.id === 'board') return this.boardUi(p, ref);
    if (ref.prof.id === 'exchange') return this.exchangeUi(p, ref);
    return this.tradeUi(p, ref);
  }

  private tradeUi(p: Player, ref: NpcRef): TradeUi {
    const { prof, settlement: s, npc } = ref;
    const bonus = this.tradingBonus(p);
    const sells: TradeListing[] = [];
    for (const id of prof.sells) {
      const def = ITEM_BY_ID.get(id)!;
      const stock = this.stockOf(s, id);
      sells.push({
        item: id,
        price: roundCrests(this.ask(s, def) * (1 - bonus)),
        stock: Math.floor(stock),
        level: Math.round((stock / this.target(def, s)) * 100) / 100,
      });
    }
    const buys: TradeListing[] = [];
    const seen = new Set<string>();
    for (const st of p.slots) {
      if (!st) continue;
      const key = `${st.id}:${st.q ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const def = ITEM_BY_ID.get(st.id);
      if (!def || !this.buysItem(prof, def)) continue;
      const stock = this.stockOf(s, st.id);
      buys.push({
        item: st.id,
        q: st.q,
        price: roundCrests(this.bid(s, prof, def, st.q) * (1 + bonus)),
        stock: Math.floor(stock),
        level: Math.round((stock / this.target(def, s)) * 100) / 100,
      });
    }
    const line = prof.lines[Math.floor(this.game.tick / 400) % prof.lines.length];
    return { kind: 'trade', npc: npc.id, name: npc.name, title: prof.title, settlement: s.name, line, sells, buys };
  }

  trade(p: Player, npcId: string, op: 'buy' | 'sell', item: string, n: number, q?: number): void {
    const ref = this.npcs.get(npcId);
    const def = ITEM_BY_ID.get(item);
    if (!ref || !def || !Number.isFinite(n) || n < 1 || !this.isOpen(npcId)) return;
    if (Math.hypot(ref.npc.x - p.x, ref.npc.y - p.y) > 5) return;
    const { prof, settlement: s } = ref;
    const m = this.stock.get(s.id)!;
    const target = this.target(def, s);
    const stock = this.stockOf(s, item);
    const bonus = this.tradingBonus(p);
    if (op === 'sell') {
      if (!this.buysItem(prof, def)) return;
      const quality = def.quality ? (q ?? 1) : undefined;
      const count = Math.min(Math.floor(n), countItem(p.slots, item, quality));
      if (count <= 0) return;
      const value = roundCrests(saleValue(def, s, stock, target, count, prof.bidRate, quality) * (1 + bonus));
      removeExact(p.slots, item, quality, count);
      m.set(item, stock + count);
      p.crests = roundCrests(p.crests + value);
      p.stats.earned += value;
      p.invDirty = p.statusDirty = true;
      p.addXp('trading', Math.max(1, value / 20));
      this.addProsperity(s.id, value);
      this.game.notice(p, `${ref.npc.name}: "I'll give you ${formatCrests(value).replace('₡', '')} Crests for the lot."`, 'money');
      this.game.emit(['sfx', 'coins', Math.round(p.x * 100), Math.round(p.y * 100)], p.x, p.y, { only: p.id });
      this.game.progression.onSell(p, s.id, item, count, value);
    } else {
      if (!prof.sells.includes(item)) return;
      let count = Math.min(Math.floor(n), Math.floor(stock));
      if (count <= 0) {
        this.game.notice(p, `${ref.npc.name} is sold out of ${def.name}.`, 'bad');
        return;
      }
      count = Math.min(count, roomFor(p.slots, { id: item, n: count, ...(def.quality ? { q: 1 } : {}) }));
      if (count <= 0) {
        this.game.notice(p, 'No room in your backpack.', 'bad');
        return;
      }
      let cost = roundCrests(purchaseCost(def, s, stock, target, count) * (1 - bonus));
      while (count > 0 && cost > p.crests) {
        count--;
        cost = roundCrests(purchaseCost(def, s, stock, target, count) * (1 - bonus));
      }
      if (count <= 0) {
        this.game.notice(p, `You can't afford ${def.name}.`, 'bad');
        return;
      }
      p.crests = roundCrests(p.crests - cost);
      m.set(item, stock - count);
      addStack(p.slots, { id: item, n: count, ...(def.quality ? { q: 1 } : {}) });
      p.invDirty = p.statusDirty = true;
      p.addXp('trading', Math.max(1, cost / 40));
      this.addProsperity(s.id, cost);
      this.game.notice(p, `Bought ${count}× ${def.name} for ${formatCrests(cost)}.`, 'money');
      this.game.emit(['sfx', 'coins', Math.round(p.x * 100), Math.round(p.y * 100)], p.x, p.y, { only: p.id });
      this.game.progression.onBuy(p, item, count);
    }
    this.game.playerSystem.refreshUi(p, true);
  }

  /** A town project finished: prosperity all at once. */
  grow(settlement: string, value: number): void {
    this.addProsperity(settlement, value);
    this.sendTowns();
  }

  private addProsperity(settlement: string, value: number): void {
    const before = this.prosperity.get(settlement) ?? 0;
    const after = before + value;
    this.prosperity.set(settlement, after);
    const def = SETTLEMENT_BY_ID.get(settlement);
    if (!def) return;
    for (const g of def.growth) {
      if (before < g.at && after >= g.at) {
        const title = PROFESSION_BY_ID.get(g.trader)?.title ?? g.trader;
        this.game.broadcastChat('', `${def.name} is growing! A ${title} has opened a stall in the square.`, 'system');
        this.sendTowns();
      }
    }
  }

  /** Settlement prosperity and the next stall each will open (to everyone, or one player). */
  sendTowns(p?: Player): void {
    const list = this.game.world.settlements.map((g) => {
      const def = SETTLEMENT_BY_ID.get(g.id)!;
      const prosperity = Math.round(this.prosperity.get(g.id) ?? 0);
      const next = def.growth.find((x) => x.at > prosperity);
      const events = this.events.filter((e) => e.settlement === g.id).map((e) => ({ title: e.title, text: e.text, ends: e.ends }));
      return {
        id: g.id,
        prosperity,
        ...(next ? { next: { at: next.at, title: PROFESSION_BY_ID.get(next.trader)?.title ?? next.trader } } : {}),
        ...(events.length ? { events } : {}),
      };
    });
    const msg = { t: 'towns' as const, list };
    if (p) p.session.send(msg);
    else for (const pl of this.game.players.values()) pl.session.send(msg);
  }

  // ——— Contracts (§15) ———

  private newContract(s: SettlementDef): void {
    const t = s.contracts[Math.floor(Math.random() * s.contracts.length)];
    const def = ITEM_BY_ID.get(t.item)!;
    const step = t.max >= 50 ? 10 : t.max >= 10 ? 5 : 1;
    const n = Math.max(step, Math.round((t.min + Math.random() * (t.max - t.min)) / step) * step);
    const unit = def.value * Math.max(1, s.factors[def.tags[0]] ?? 1);
    const pay = Math.round(n * unit * (1.35 + Math.random() * 0.25));
    const days = 1.5 + Math.random() * 1.5;
    const now = this.game.minutes;
    this.contracts.push({
      id: `c${Date.now().toString(36)}${this.nextId++}`,
      settlement: s.id,
      item: t.item,
      n,
      delivered: 0,
      pay,
      bonus: Math.round(pay * 0.2),
      bonusBy: now + days * 1440 * 0.45,
      deadline: now + days * 1440,
      taker: null,
      takerName: null,
    });
  }

  private contractInfo(c: ContractSave, p: Player): ContractInfo {
    const s = SETTLEMENT_BY_ID.get(c.settlement)!;
    return {
      id: c.id,
      settlement: s.name,
      issuer: `${s.name} ${ITEM_BY_ID.get(c.item)?.category === 'food' ? 'Provisions Office' : 'Guild Hall'}`,
      item: c.item,
      n: c.n,
      delivered: c.delivered,
      pay: c.pay,
      bonus: c.bonus,
      bonusBy: c.bonusBy,
      deadline: c.deadline,
      taker: c.takerName ?? undefined,
      mine: c.taker === p.accountId,
    };
  }

  private boardUi(p: Player, ref: NpcRef): BoardUi {
    return {
      kind: 'board',
      npc: ref.npc.id,
      settlement: ref.settlement.name,
      contracts: this.contracts.filter((c) => c.settlement === ref.settlement.id).map((c) => this.contractInfo(c, p)),
      project: this.game.projects.info(ref.settlement.id),
    };
  }

  sendContracts(p: Player): void {
    p.session.send({ t: 'contracts', list: this.contracts.filter((c) => c.taker === p.accountId).map((c) => this.contractInfo(c, p)) });
  }

  contract(p: Player, op: 'accept' | 'deliver' | 'abandon', id: string): void {
    const c = this.contracts.find((x) => x.id === id);
    if (!c) return;
    const board = [...this.npcs.values()].find((r) => r.prof.id === 'board' && r.settlement.id === c.settlement);
    const atBoard = board && Math.hypot(board.npc.x - p.x, board.npc.y - p.y) <= 5;
    if (op === 'accept') {
      if (c.taker || !atBoard) return;
      if (this.contracts.filter((x) => x.taker === p.accountId).length >= MAX_CONTRACTS_PER_PLAYER) {
        this.game.notice(p, `You can hold at most ${MAX_CONTRACTS_PER_PLAYER} contracts.`, 'bad');
        return;
      }
      c.taker = p.accountId;
      c.takerName = p.name;
      this.game.notice(
        p,
        `Contract accepted: deliver ${c.n}× ${ITEM_BY_ID.get(c.item)?.name} to ${SETTLEMENT_BY_ID.get(c.settlement)?.name}.`,
        'good',
      );
    } else if (op === 'abandon') {
      if (c.taker !== p.accountId) return;
      c.taker = null;
      c.takerName = null;
    } else {
      if (c.taker !== p.accountId || !atBoard) return;
      const have = countItem(p.slots, c.item);
      const k = Math.min(have, c.n - c.delivered);
      if (k <= 0) {
        this.game.notice(p, `You have no ${ITEM_BY_ID.get(c.item)?.name} to deliver.`, 'bad');
        return;
      }
      removeItem(p.slots, c.item, k);
      c.delivered += k;
      p.invDirty = true;
      if (c.delivered >= c.n) {
        const onTime = this.game.minutes <= c.bonusBy;
        const total = c.pay + (onTime ? c.bonus : 0);
        p.crests = roundCrests(p.crests + total);
        p.stats.earned += total;
        p.statusDirty = true;
        this.addProsperity(c.settlement, total);
        this.contracts = this.contracts.filter((x) => x !== c);
        this.newContract(SETTLEMENT_BY_ID.get(c.settlement)!);
        this.game.progression.addKnowledge(p, 8 + Math.min(40, total / 150));
        this.game.notice(
          p,
          `Contract complete! Paid ${formatCrests(total)}${onTime ? ' including the early-delivery bonus' : ''}.`,
          'money',
        );
        this.game.emit(['sfx', 'coins', Math.round(p.x * 100), Math.round(p.y * 100)], p.x, p.y, { only: p.id });
        this.game.progression.onContract(p);
      } else this.game.notice(p, `Delivered ${k}. ${c.n - c.delivered} to go.`, 'good');
    }
    this.sendContracts(p);
    this.game.playerSystem.refreshUi(p, true);
  }

  // ——— Shipping crates (§35) ———

  private shipAll(): void {
    const totals = new Map<string, { value: number; items: number; where: string }>();
    for (const s of this.game.world.structures.values()) {
      if (!s.def.shipping || !s.store || !s.owner) continue;
      const g = this.game.world.nearestSettlement(s.x, s.y);
      const def = SETTLEMENT_BY_ID.get(g.id)!;
      const m = this.stock.get(def.id)!;
      let value = 0;
      let items = 0;
      for (let i = 0; i < s.store.length; i++) {
        const st = s.store[i];
        if (!st) continue;
        const idef = ITEM_BY_ID.get(st.id);
        if (!idef) continue;
        const buyer = this.bestBuyer(def, idef);
        if (!buyer) continue;
        const stock = this.stockOf(def, st.id);
        value += saleValue(idef, def, stock, this.target(idef, def), st.n, buyer.bidRate, st.q) * (1 - HAULAGE_FEE);
        m.set(st.id, stock + st.n);
        items += st.n;
        s.store[i] = null;
      }
      if (items === 0) continue;
      const t = totals.get(s.owner) ?? { value: 0, items: 0, where: g.name };
      t.value += value;
      t.items += items;
      totals.set(s.owner, t);
      this.addProsperity(def.id, value);
      this.game.structVisual(s);
    }
    for (const [owner, t] of totals) {
      const value = roundCrests(t.value);
      this.credit(owner, value, 'Shipping');
      if (isCompanyAccount(owner))
        this.game.companies.notify(owner, `The merchant wagon sold ${t.items} items in ${t.where} for ${formatCrests(value)}.`);
      const p = this.game.byAccount.get(owner);
      if (p) {
        p.stats.earned += value;
        this.game.notice(
          p,
          `The merchant wagon sold ${t.items} items from your shipping crates in ${t.where} for ${formatCrests(value)}.`,
          'money',
        );
      }
    }
  }

  /** Adds Crests to an account (online or not) or to a company's treasury. */
  credit(accountId: string, amount: number, source = 'Income'): void {
    if (amount <= 0) return;
    if (isCompanyAccount(accountId)) {
      this.game.companies.income(accountId, amount, source);
      return;
    }
    const p = this.game.byAccount.get(accountId);
    if (p) {
      p.crests = roundCrests(p.crests + amount);
      p.statusDirty = true;
      return;
    }
    void (async () => {
      const data = await this.game.storage.loadCharacter(accountId);
      if (!data) return;
      // They may have logged in meanwhile.
      const online = this.game.byAccount.get(accountId);
      if (online) {
        online.crests = roundCrests(online.crests + amount);
        online.statusDirty = true;
        return;
      }
      data.crests = roundCrests(data.crests + amount);
      await this.game.storage.saveCharacters([{ accountId, data }]);
    })().catch((err) => this.game.log(`offline credit failed: ${err}`));
  }

  // ——— Exchange: buy orders (§34) ———

  private exchangeUi(p: Player, ref: NpcRef): ExchangeUi {
    return {
      kind: 'exchange',
      npc: ref.npc.id,
      orders: this.orders.map((o) => ({
        id: o.id,
        owner: o.ownerName,
        item: o.item,
        n: o.n,
        filled: o.filled,
        price: o.price,
        mine: o.owner === p.accountId,
      })),
      pending: this.orders.filter((o) => o.owner === p.accountId && o.waiting > 0).map((o) => ({ id: o.item, n: o.waiting })),
    };
  }

  private atExchange(p: Player): boolean {
    for (const r of this.npcs.values()) if (r.prof.id === 'exchange' && Math.hypot(r.npc.x - p.x, r.npc.y - p.y) <= 5) return true;
    return false;
  }

  order(p: Player, msg: Extract<ClientMessage, { t: 'order' }>): void {
    if (!this.atExchange(p)) return;
    if (msg.op === 'post') {
      const def = ITEM_BY_ID.get(msg.item);
      const n = Math.floor(msg.n);
      const price = roundCrests(msg.price);
      if (!def || !(n >= 1 && n <= 100000) || !(price >= 0.1 && price <= 1_000_000)) return;
      if (this.orders.filter((o) => o.owner === p.accountId).length >= 10) {
        this.game.notice(p, 'You can have at most 10 buy orders.', 'bad');
        return;
      }
      const escrow = roundCrests(n * price);
      if (escrow > p.crests) {
        this.game.notice(p, `That order needs ${formatCrests(escrow)} held in escrow.`, 'bad');
        return;
      }
      p.crests = roundCrests(p.crests - escrow);
      p.statusDirty = true;
      this.orders.push({
        id: `o${Date.now().toString(36)}${this.nextId++}`,
        owner: p.accountId,
        ownerName: p.name,
        item: def.id,
        n,
        filled: 0,
        price,
        waiting: 0,
        created: Date.now(),
      });
      this.game.notice(p, `Buy order posted: ${n}× ${def.name} at ${formatCrests(price)} each.`, 'good');
      this.game.broadcastChat('', `${p.name} is buying ${n}× ${def.name} at ${formatCrests(price)} each (Westhaven Exchange).`, 'system');
    } else {
      const o = this.orders.find((x) => x.id === msg.id);
      if (!o) return;
      if (msg.op === 'fill') {
        if (o.owner === p.accountId) return;
        const k = Math.min(Math.floor(msg.n), countItem(p.slots, o.item), o.n - o.filled);
        if (!(k > 0)) return;
        removeItem(p.slots, o.item, k);
        const pay = roundCrests(k * o.price);
        p.crests = roundCrests(p.crests + pay);
        p.stats.earned += pay;
        o.filled += k;
        o.waiting += k;
        p.invDirty = p.statusDirty = true;
        this.game.notice(p, `Delivered ${k}× ${ITEM_BY_ID.get(o.item)?.name} for ${formatCrests(pay)}.`, 'money');
        const owner = this.game.byAccount.get(o.owner);
        if (owner)
          this.game.notice(
            owner,
            `${p.name} filled ${k} of your ${ITEM_BY_ID.get(o.item)?.name} order. Collect it at the Exchange.`,
            'good',
          );
      } else if (msg.op === 'collect' || msg.op === 'cancel') {
        if (o.owner !== p.accountId) return;
        if (msg.op === 'cancel' && o.filled < o.n) {
          const refund = roundCrests((o.n - o.filled) * o.price);
          p.crests = roundCrests(p.crests + refund);
          o.n = o.filled;
          p.statusDirty = true;
          this.game.notice(p, `Order cancelled, ${formatCrests(refund)} returned.`, 'info');
        }
        if (o.waiting > 0) {
          const def = ITEM_BY_ID.get(o.item)!;
          const room = roomFor(p.slots, { id: o.item, n: o.waiting, ...(def.quality ? { q: 1 } : {}) });
          if (room > 0) {
            addStack(p.slots, { id: o.item, n: room, ...(def.quality ? { q: 1 } : {}) });
            o.waiting -= room;
            p.invDirty = true;
          } else this.game.notice(p, 'No room in your backpack.', 'bad');
        }
        if (o.filled >= o.n && o.waiting <= 0) this.orders = this.orders.filter((x) => x !== o);
      }
    }
    this.game.playerSystem.refreshUi(p, true);
  }

  // ——— Shop stands (§33) ———

  shopUi(p: Player, s: Structure): ShopUi {
    return {
      kind: 'shop',
      id: s.id,
      owner: s.ownerName,
      mine: this.game.building.canManage(p, s),
      title: `${s.ownerName}'s shop`,
      store: s.store ?? [],
      prices: s.prices ?? [],
    };
  }

  shopPrice(p: Player, id: number, item: string, q: number | undefined, price: number | null): void {
    const s = this.game.world.structures.get(id);
    if (!s?.def.shop || !this.game.building.canManage(p, s) || !ITEM_BY_ID.has(item)) return;
    s.prices = (s.prices ?? []).filter((x) => !(x.item === item && (x.q ?? null) === (q ?? null)));
    if (price !== null && Number.isFinite(price) && price > 0)
      s.prices.push({ item, ...(q !== undefined ? { q } : {}), price: roundCrests(price) });
    this.game.structVisual(s);
    this.game.playerSystem.refreshUi(p, true);
  }

  shopBuy(p: Player, id: number, item: string, q: number | undefined, n: number): void {
    const s = this.game.world.structures.get(id);
    if (!s?.def.shop || !s.store || s.owner === p.accountId) return;
    // Colleagues take stock out of a company stand; they don't buy it.
    if (s.owner && this.game.companies.sameCompany(p.accountId, s.owner)) return;
    if (Math.hypot(s.x + 0.5 - p.x, s.y + 0.5 - p.y) > 4) return;
    const listing = s.prices?.find((x) => x.item === item && (x.q ?? null) === (q ?? null));
    if (!listing) return;
    const def = ITEM_BY_ID.get(item)!;
    const quality = def.quality ? (q ?? 1) : undefined;
    let k = Math.min(Math.floor(n), countItem(s.store, item, quality));
    k = Math.min(k, roomFor(p.slots, { id: item, n: k, ...(quality !== undefined ? { q: quality } : {}) }));
    k = Math.min(k, Math.floor(p.crests / listing.price));
    if (!(k > 0)) {
      this.game.notice(p, 'You cannot buy that right now (stock, room or Crests).', 'bad');
      return;
    }
    const cost = roundCrests(k * listing.price);
    removeExact(s.store, item, quality, k);
    addStack(p.slots, { id: item, n: k, ...(quality !== undefined ? { q: quality } : {}) });
    p.crests = roundCrests(p.crests - cost);
    p.invDirty = p.statusDirty = true;
    if (s.owner) {
      this.credit(s.owner, cost, 'Shop sales');
      if (isCompanyAccount(s.owner)) this.game.companies.notify(s.owner, `${p.name} bought ${k}× ${def.name} for ${formatCrests(cost)}.`);
      const owner = this.game.byAccount.get(s.owner);
      if (owner) {
        owner.stats.earned += cost;
        this.game.notice(owner, `${p.name} bought ${k}× ${def.name} from your shop for ${formatCrests(cost)}.`, 'money');
      }
    }
    this.game.notice(p, `Bought ${k}× ${def.name} for ${formatCrests(cost)}.`, 'money');
    this.game.structVisual(s);
    this.game.playerSystem.refreshUi(p, true);
  }

  // ——— Market report (for the map) ———

  sendMarkets(p: Player): void {
    const KEY = [
      'wood',
      'plank',
      'stone',
      'coal',
      'iron_ore',
      'copper_ore',
      'iron_ingot',
      'iron_plate',
      'iron_gear',
      'copper_wire',
      'wheat',
      'flour',
      'bread',
      'cooked_meat',
      'leather',
      'steel_ingot',
      'hoe',
      'iron_pickaxe',
      'millstone',
    ];
    // Whatever the news is about, too.
    for (const e of this.events) for (const id of e.items.slice(0, 4)) if (!KEY.includes(id)) KEY.push(id);
    const list = this.game.world.settlements.map((g) => {
      const s = SETTLEMENT_BY_ID.get(g.id)!;
      const items: [string, number, number][] = [];
      for (const id of KEY) {
        const def = ITEM_BY_ID.get(id)!;
        const buyer = this.bestBuyer(s, def);
        const bid = buyer ? roundCrests(this.bid(s, buyer, def)) : 0;
        const sells = this.openTraders(s).some((t) => PROFESSION_BY_ID.get(t)!.sells.includes(id));
        const ask = sells ? roundCrests(this.ask(s, def)) : 0;
        items.push([id, bid, ask]);
      }
      return { settlement: g.name, items };
    });
    p.session.send({ t: 'markets', list });
  }

  // ——— Persistence ———

  save(): Pick<WorldSave, 'markets' | 'prosperity' | 'contracts' | 'orders' | 'events'> {
    const markets: Record<string, Record<string, number>> = {};
    for (const [s, m] of this.stock) {
      const def = SETTLEMENT_BY_ID.get(s)!;
      const out: Record<string, number> = {};
      for (const [item, v] of m) if (Math.abs(v - this.target(ITEM_BY_ID.get(item)!, def)) > 0.5) out[item] = Math.round(v * 10) / 10;
      markets[s] = out;
    }
    return {
      markets,
      prosperity: Object.fromEntries(this.prosperity),
      contracts: this.contracts,
      orders: this.orders,
      events: this.events,
    };
  }

  load(save: WorldSave): void {
    for (const [s, m] of Object.entries(save.markets ?? {})) {
      const map = this.stock.get(s);
      if (!map) continue;
      for (const [item, v] of Object.entries(m)) if (ITEM_BY_ID.has(item)) map.set(item, v);
    }
    for (const [s, v] of Object.entries(save.prosperity ?? {})) this.prosperity.set(s, v);
    this.contracts = (save.contracts ?? []).filter((c) => ITEM_BY_ID.has(c.item) && SETTLEMENT_BY_ID.has(c.settlement));
    this.orders = (save.orders ?? []).filter((o) => ITEM_BY_ID.has(o.item));
    this.events = (save.events ?? []).filter((e) => SETTLEMENT_BY_ID.has(e.settlement));
    for (const e of this.events) {
      e.items = e.items.filter((id) => ITEM_BY_ID.has(id));
      this.nextId = Math.max(this.nextId, e.id + 1);
    }
  }
}

/** Removes exactly `n` units of an item with a given quality (undefined matches unqualitied items). */
function removeExact(slots: (ItemStack | null)[], id: string, q: number | undefined, n: number): void {
  let left = n;
  for (let i = 0; i < slots.length && left > 0; i++) {
    const s = slots[i];
    if (!s || s.id !== id || (q !== undefined && s.q !== q)) continue;
    const take = Math.min(left, s.n);
    s.n -= take;
    left -= take;
    if (s.n <= 0) slots[i] = null;
  }
}
