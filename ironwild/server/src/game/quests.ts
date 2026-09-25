// Town quests (§53, "keep quests economically tied to the sandbox"). Besides bulk contracts, every
// contract board posts a bounty — clear the wolves out of the old mine, drive bandits off, hunt a
// bear — and a salvage job (§11): a supply wagon overturned out in the wilds, and the town wants
// its cargo back. Taking a quest marks the place on your map and sends the pack there, or puts the
// wreck there with a couple of bandits picking it over. A bounty pays on the last kill; salvage pays
// when the cargo is handed in at the board. One quest at a time; two game days to finish it.

import {
  CREATURE_BY_ID,
  Region,
  SETTLEMENT_BY_ID,
  TILES,
  Tile,
  countItem,
  formatCrests,
  removeItem,
  type ItemStack,
  type QuestInfo,
} from '@ironwild/shared';
import type { QuestSave } from '../persistence/storage';
import type { Creature } from './entities';
import type { Game } from './game';
import type { Player } from './player';
import type { Structure } from './world';

/** Game days to finish a quest once taken, and how long an untaken one stays on the board. */
const QUEST_DAYS = 2;
const POSTED_DAYS = 3;
/** Bounty kills count within this many tiles of the place. */
export const QUEST_RADIUS = 12;
const DIRS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

/** What a bounty hunts: how many, and the pay for each (before distance). */
const QUARRY: Record<string, { n: [number, number]; each: number }> = {
  wolf: { n: [3, 4], each: 55 },
  boar: { n: [3, 4], each: 40 },
  bandit: { n: [3, 3], each: 110 },
  bear: { n: [1, 1], each: 300 },
};

interface Site {
  name: string;
  x: number;
  y: number;
  creature: string;
}

const rand = (a: number, b: number) => a + Math.floor(Math.random() * (b - a + 1));
const round5 = (v: number) => Math.round(v / 5) * 5;

export class QuestSystem {
  quests: QuestSave[] = [];
  private nextId = 1;
  /** Road tiles (index), for placing wrecked wagons beside them. */
  private roads: number[] = [];
  private seconds = 0;

  constructor(private readonly game: Game) {}

  init(): void {
    const w = this.game.world;
    for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] === Tile.Road) this.roads.push(i);
    // Packs sent out by quests are not saved: put back what is left of them.
    for (const q of this.quests) if (q.taker && q.kind === 'bounty') this.sendPack(q, q.n - q.done);
    this.fill();
  }

  stepSecond(): void {
    if (++this.seconds % 30 === 0) this.check();
  }

  /** Every half minute: quests running out, and fresh ones on the boards. */
  check(): void {
    const now = this.game.minutes;
    for (const q of [...this.quests]) {
      if (q.taker && now > q.deadline) {
        const p = this.game.byAccount.get(q.taker);
        if (p) this.game.notice(p, `Quest failed: ${q.title}. You ran out of time.`, 'bad');
        this.end(q);
      } else if (!q.taker && now - q.posted > POSTED_DAYS * 1440) this.end(q);
    }
    this.fill();
  }

  /** Keeps a bounty and a salvage job on every board. */
  private fill(): void {
    for (const s of this.game.world.settlements) {
      if (!SETTLEMENT_BY_ID.has(s.id)) continue;
      for (const kind of ['bounty', 'salvage'] as const) {
        if (this.quests.some((q) => q.settlement === s.id && q.kind === kind)) continue;
        const q = kind === 'bounty' ? this.newBounty(s) : this.newSalvage(s);
        if (q) this.quests.push(q);
      }
    }
  }

  // ——— Posting ———

  private newBounty(s: { id: string; name: string; x: number; y: number }): QuestSave | null {
    const site = this.pickSite(s);
    if (!site) return null;
    const quarry = QUARRY[site.creature];
    const n = rand(quarry.n[0], quarry.n[1]);
    const d = Math.hypot(site.x - s.x, site.y - s.y);
    const [title, desc] =
      site.creature === 'wolf'
        ? [
            `Clear the wolves from ${site.name}`,
            `A wolf pack has settled in ${site.name} and nobody dares go near. Kill ${n} wolves there.`,
          ]
        : site.creature === 'bandit'
          ? [`Drive the bandits out of ${site.name}`, `Bandits from ${site.name} keep robbing the roads. Kill ${n} of them there.`]
          : site.creature === 'bear'
            ? [`Hunt the bear of ${site.name}`, `A bear has been mauling travellers in ${site.name}. Hunt it down.`]
            : [`Cull the boars in ${site.name}`, `Wild boars are tearing up ${site.name}. Kill ${n} of them there.`];
    return this.post(s.id, 'bounty', title, desc, site.x, site.y, n, round5(n * quarry.each * (1 + d / 250)), site.creature);
  }

  /** A dangerous place within reach of a town: the mine, the ruins, the bandit camp, or the wilds. */
  private pickSite(s: { name: string; x: number; y: number }): Site | null {
    const w = this.game.world;
    const sites: Site[] = [];
    for (const l of w.gen.landmarks) {
      const d = Math.hypot(l.x - s.x, l.y - s.y);
      if (d < 30 || d > 280) continue;
      if (l.kind === 'mine') sites.push({ name: l.name, x: l.x, y: l.y, creature: 'wolf' });
      if (l.kind === 'ruins') sites.push({ name: `the ${l.name}`, x: l.x, y: l.y, creature: Math.random() < 0.5 ? 'wolf' : 'boar' });
      if (l.kind === 'bandit_camp') sites.push({ name: 'the Bandit Camp', x: l.x, y: l.y, creature: 'bandit' });
    }
    for (let k = 0; k < 80; k++) {
      const a = Math.random() * Math.PI * 2;
      const d = 50 + Math.random() * 100;
      const x = Math.round(s.x + Math.cos(a) * d);
      const y = Math.round(s.y + Math.sin(a) * d);
      if (!this.open(x, y)) continue;
      const region = w.regions[y * w.size + x];
      const dir = DIRS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
      if (region === Region.Forest) sites.push({ name: `the woods ${dir} of ${s.name}`, x, y, creature: 'wolf' });
      else if (region === Region.Highlands || region === Region.Mountains)
        sites.push({ name: `the hills ${dir} of ${s.name}`, x, y, creature: 'bear' });
      else if (region === Region.Meadows || region === Region.Plains)
        sites.push({ name: `the fields ${dir} of ${s.name}`, x, y, creature: 'boar' });
      else continue;
      break;
    }
    return sites.length ? sites[Math.floor(Math.random() * sites.length)] : null;
  }

  private newSalvage(s: { id: string; name: string; x: number; y: number }): QuestSave | null {
    const w = this.game.world;
    for (let k = 0; k < 300 && this.roads.length; k++) {
      const i = this.roads[Math.floor(Math.random() * this.roads.length)];
      const rx = i % w.size;
      const ry = Math.floor(i / w.size);
      const d = Math.hypot(rx - s.x, ry - s.y);
      if (d < 50 || d > 170 || w.settlementAt(rx, ry, 10)) continue;
      const spot = this.wreckSpot(rx, ry);
      if (!spot) continue;
      const a = Math.atan2(spot.y - s.y, spot.x - s.x);
      const dir = DIRS[(Math.round(a / (Math.PI / 4)) + 8) % 8];
      return this.post(
        s.id,
        'salvage',
        'Recover a wrecked wagon’s cargo',
        `A supply wagon bound for ${s.name} overturned off the road, ${Math.round(d)} tiles ${dir} of here, and bandits have been seen picking it over. Bring its cargo back to this board.`,
        spot.x,
        spot.y,
        1,
        round5(250 + d * 2.5),
      );
    }
    return null;
  }

  private post(
    settlement: string,
    kind: QuestSave['kind'],
    title: string,
    desc: string,
    x: number,
    y: number,
    n: number,
    pay: number,
    creature?: string,
  ): QuestSave {
    return {
      id: `q${Date.now().toString(36)}${this.nextId++}`,
      settlement,
      kind,
      title,
      desc,
      x,
      y,
      ...(creature ? { creature } : {}),
      n,
      done: 0,
      pay,
      posted: this.game.minutes,
      deadline: 0,
      taker: null,
      takerName: null,
    };
  }

  /** Walkable open land away from towns and claims. */
  private open(x: number, y: number): boolean {
    const w = this.game.world;
    if (!w.inside(x, y)) return false;
    const t = w.tile(x, y);
    if (!TILES[t].land || t === Tile.Road || t === Tile.Oil) return false;
    if (w.settlementAt(x, y, 8) || w.claimAt(x, y) || this.game.creatures.collision.solidAt(x, y)) return false;
    return true;
  }

  /** A clear 2×1 patch a few tiles off the road at (rx, ry). */
  private wreckSpot(rx: number, ry: number): { x: number; y: number } | null {
    const w = this.game.world;
    for (let r = 2; r <= 5; r++)
      for (const [dx, dy] of [
        [r, 0],
        [-r - 1, 0],
        [0, r],
        [0, -r],
      ]) {
        const x = rx + dx;
        const y = ry + dy;
        if (!this.open(x, y) || !this.open(x + 1, y) || w.structAt(x, y) || w.structAt(x + 1, y)) continue;
        if (w.nodesNear(x + 1, y + 0.5, 2).some((n) => n.def.solid && !n.gone)) continue;
        return { x, y };
      }
    return null;
  }

  // ——— Taking, handing in, giving up ———

  handle(p: Player, op: 'accept' | 'deliver' | 'abandon', id: string): void {
    const q = this.quests.find((x) => x.id === id);
    if (!q) return;
    if (op === 'accept') this.accept(p, q);
    else if (op === 'abandon') {
      if (q.taker !== p.accountId) return;
      this.game.notice(p, `You gave up: ${q.title}.`, 'info');
      this.end(q);
    } else this.deliver(p, q);
    this.send(p);
    this.game.playerSystem.refreshUi(p, true);
  }

  private accept(p: Player, q: QuestSave): void {
    if (q.taker || !this.game.economy.atBoard(p, q.settlement)) return;
    if (this.quests.some((x) => x.taker === p.accountId)) {
      this.game.notice(p, 'Finish (or give up) the quest you are on first.', 'bad');
      return;
    }
    if (q.kind === 'salvage' && !this.placeWreck(q)) {
      this.game.notice(p, 'The wreck has been cleared away already.', 'info');
      this.end(q);
      return;
    }
    q.taker = p.accountId;
    q.takerName = p.name;
    q.deadline = this.game.minutes + QUEST_DAYS * 1440;
    if (q.kind === 'bounty') this.sendPack(q, q.n);
    this.game.notice(p, `Quest taken: ${q.title}. It is marked on your map (M).`, 'good');
  }

  private deliver(p: Player, q: QuestSave): void {
    if (q.taker !== p.accountId || q.kind !== 'salvage' || !this.game.economy.atBoard(p, q.settlement)) return;
    if (countItem(p.slots, 'lost_cargo') < 1) {
      this.game.notice(p, 'Bring the lost cargo from the wreck first.', 'bad');
      return;
    }
    removeItem(p.slots, 'lost_cargo', 1);
    p.invDirty = true;
    q.done = 1;
    this.complete(q);
  }

  /** Pays the taker and takes the quest off the board. */
  private complete(q: QuestSave): void {
    const town = SETTLEMENT_BY_ID.get(q.settlement)?.name ?? 'the town';
    if (q.taker) {
      this.game.economy.credit(q.taker, q.pay, 'Quest', q.settlement);
      const p = this.game.byAccount.get(q.taker);
      if (p) {
        p.stats.earned += q.pay;
        this.game.progression.addKnowledge(p, 10 + Math.min(40, q.pay / 40));
        this.game.notice(p, `Quest complete: ${q.title}! ${town} pays you ${formatCrests(q.pay)}.`, 'money');
        this.game.emit(['sfx', 'coins', Math.round(p.x * 100), Math.round(p.y * 100)], p.x, p.y, { only: p.id });
      }
    }
    this.game.economy.grow(q.settlement, q.pay);
    this.end(q);
  }

  /** Takes a quest off the board and clears away what it put in the world. */
  private end(q: QuestSave): void {
    this.quests = this.quests.filter((x) => x !== q);
    for (const e of [...this.game.entities.values()]) if (e.kind === 'creature' && e.quest === q.id) this.game.removeEntity(e.id);
    const wreck = q.wreck !== undefined ? this.game.world.structures.get(q.wreck) : undefined;
    if (wreck?.def.wreck) this.game.building.remove(wreck);
    const taker = q.taker ? this.game.byAccount.get(q.taker) : undefined;
    if (taker) this.send(taker);
    this.fill();
  }

  // ——— Out in the world ———

  /** The pack a bounty is for, around its place. */
  private sendPack(q: QuestSave, n: number): void {
    if (!q.creature) return;
    for (let i = 0; i < n; i++) this.spawnNear(q, q.creature, 3);
  }

  private spawnNear(q: QuestSave, type: string, spread: number): Creature | null {
    for (let k = 0; k < 20; k++) {
      const x = q.x + (Math.random() - 0.5) * spread * 2;
      const y = q.y + (Math.random() - 0.5) * spread * 2;
      if (this.game.creatures.collision.solidAt(Math.floor(x), Math.floor(y))) continue;
      const c = this.game.creatures.spawn(type, x, y, '');
      c.quest = q.id;
      c.homeX = q.x;
      c.homeY = q.y;
      return c;
    }
    return null;
  }

  /** The overturned wagon, its cargo and salvage, and two bandits picking it over. */
  private placeWreck(q: QuestSave): boolean {
    const w = this.game.world;
    const spot = w.structAt(q.x, q.y) || w.structAt(q.x + 1, q.y) ? this.wreckSpot(q.x, q.y) : { x: q.x, y: q.y };
    if (!spot) return false;
    q.x = spot.x;
    q.y = spot.y;
    for (const n of w.nodesNear(spot.x + 1, spot.y + 0.5, 2)) {
      if (n.gone || !n.def.solid) continue;
      n.gone = true;
      this.game.nodeChanged(n);
    }
    const town = SETTLEMENT_BY_ID.get(q.settlement)?.name ?? 'someone';
    const s: Structure = w.makeStructure(
      this.game.nextStructId++,
      'wrecked_wagon',
      spot.x,
      spot.y,
      Math.floor(Math.random() * 2) * 2,
      null,
      town,
    );
    this.game.factory.initStructure(s);
    const loot: ItemStack[] = [
      { id: 'lost_cargo', n: 1 },
      { id: 'scrap_metal', n: rand(3, 6) },
      { id: 'plank', n: rand(4, 8) },
    ];
    if (Math.random() < 0.6) loot.push({ id: 'iron_rod', n: rand(1, 3) });
    if (Math.random() < 0.35) loot.push({ id: 'iron_gear', n: rand(1, 2) });
    if (Math.random() < 0.3) loot.push({ id: 'rope', n: rand(1, 3) });
    loot.forEach((it, i) => (s.store![i] = it));
    w.addStructure(s);
    this.game.structAdded(s);
    q.wreck = s.id;
    for (let i = 0; i < 2; i++) this.spawnNear(q, 'bandit', 4);
    return true;
  }

  /** A creature died: one a bounty sent out (wherever it fell), or its kind at the bounty's place. */
  onKill(c: Creature): void {
    const q =
      this.quests.find((x) => x.taker && x.id === c.quest) ??
      this.quests.find(
        (x) => x.taker && x.kind === 'bounty' && x.creature === c.def.id && Math.hypot(c.x - x.x, c.y - x.y) <= QUEST_RADIUS,
      );
    if (!q || q.kind !== 'bounty' || !q.taker) return;
    q.done++;
    if (q.done >= q.n) {
      this.complete(q);
      return;
    }
    const p = this.game.byAccount.get(q.taker);
    if (!p) return;
    this.game.notice(p, `${q.title}: ${q.done} of ${q.n}.`, 'good');
    this.send(p);
  }

  // ——— To players ———

  info(q: QuestSave, p: Player): QuestInfo {
    return {
      id: q.id,
      settlement: SETTLEMENT_BY_ID.get(q.settlement)?.name ?? q.settlement,
      kind: q.kind,
      title: q.title,
      desc: q.desc,
      x: q.x + (q.kind === 'salvage' ? 1 : 0),
      y: q.y + (q.kind === 'salvage' ? 0.5 : 0),
      ...(q.creature ? { creature: q.creature } : {}),
      n: q.n,
      done: q.done,
      pay: q.pay,
      deadline: q.deadline,
      ...(q.takerName ? { taker: q.takerName } : {}),
      mine: q.taker === p.accountId,
    };
  }

  board(settlement: string, p: Player): QuestInfo[] {
    return this.quests.filter((q) => q.settlement === settlement).map((q) => this.info(q, p));
  }

  send(p: Player): void {
    p.session.send({ t: 'quests', list: this.quests.filter((q) => q.taker === p.accountId).map((q) => this.info(q, p)) });
  }

  // ——— Persistence ———

  save(): QuestSave[] {
    return this.quests;
  }

  load(saved: QuestSave[] | undefined): void {
    this.quests = (saved ?? []).filter((q) => SETTLEMENT_BY_ID.has(q.settlement) && (!q.creature || CREATURE_BY_ID.has(q.creature)));
  }
}
