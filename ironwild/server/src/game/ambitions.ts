// Ambitions and standings (§47–50, §63): the long game after the guide. Every player climbs the
// wealth ladder — the highest rung is the title under their name — and chases the endgame feats,
// each worth prestige. The Standings window (L) ranks players and companies by worth, the day's
// takings and prestige, and shows who dominates trade in each town.
//
// Tallies are kept per account and per company ('co:<id>') in the world save, so machines that
// run and shops that sell while their owner is offline still count.

import {
  AMBITIONS,
  ITEM_BY_ID,
  TICK_RATE,
  formatCrests,
  qualityMultiplier,
  rankTitle,
  type Ambition,
  type AmbitionInfo,
  type Slots,
  type StandingRow,
  type StandingsInfo,
} from '@ironwild/shared';
import type { AmbitionSave } from '../persistence/storage';
import { companyAccount, isCompanyAccount } from './companies';
import type { Game } from './game';
import type { Player } from './player';
import type { Structure } from './world';

type Tally = Omit<AmbitionSave, 'id'>;

/** Seconds between ambition checks. */
const CHECK_SECONDS = 5;
const CART_ITEM = { hand: 'hand_cart', wagon: 'wagon', minecart: 'minecart' } as const;
const BOARD_SIZE = 10;

const article = (title: string) => (/^[AEIOU]/.test(title) ? 'an' : 'a');

export class Ambitions {
  private readonly tallies = new Map<string, Tally>();
  private property: { tick: number; map: Map<string, number> } | null = null;
  private readonly lastAsk = new Map<number, number>();

  constructor(private readonly game: Game) {}

  private get today(): number {
    return Math.floor(this.game.minutes / 1440);
  }

  private tally(key: string): Tally {
    let t = this.tallies.get(key);
    if (!t) {
      t = {
        name: this.nameOf(key),
        done: [],
        n: {},
        day: this.today,
        income: 0,
        added: 0,
        best: { income: 0, added: 0 },
        carried: 0,
        seen: Math.round(this.game.minutes),
      };
      this.tallies.set(key, t);
    }
    // A new day starts the day's counters again.
    if (t.day !== this.today) {
      t.day = this.today;
      t.income = 0;
      t.added = 0;
    }
    return t;
  }

  private nameOf(key: string): string {
    if (isCompanyAccount(key)) return this.game.companies.name(key.slice(3)) ?? 'A company';
    return this.game.byAccount.get(key)?.name ?? 'Someone';
  }

  private bump(t: Tally, key: string, n: number): void {
    t.n[key] = (t.n[key] ?? 0) + n;
  }

  // ——— Hooks ———

  /** Money taken in by an account or company, and in which settlement (for the town standings). */
  earned(key: string, amount: number, settlement?: string): void {
    if (!(amount > 0)) return;
    const t = this.tally(key);
    t.income += amount;
    t.best.income = Math.max(t.best.income, t.income);
    if (settlement) this.bump(t, `sales:${settlement}`, amount);
    // Offline players are paid into their saved character: keep their worth in step.
    if (!isCompanyAccount(key) && !this.game.byAccount.has(key)) t.carried += amount;
  }

  /** A machine finished a job: what came out and the value it added to its inputs. */
  job(owner: string, made: [string, number][], added: number): void {
    const t = this.tally(owner);
    for (const [item, n] of made) this.bump(t, `made:${item}`, n);
    t.added += added;
    t.best.added = Math.max(t.best.added, t.added);
  }

  /** Counters: 'projects' (value delivered), 'freight' (items by rail), 'masterwork', 'monument'. */
  count(owner: string | null, what: string, n: number): void {
    if (!owner || !(n > 0)) return;
    this.bump(this.tally(owner), what, n);
  }

  joined(p: Player): void {
    const t = this.tally(p.accountId);
    t.name = p.name;
    t.seen = Math.round(this.game.minutes);
  }

  left(p: Player): void {
    const t = this.tally(p.accountId);
    t.carried = this.carried(p);
    t.seen = Math.round(this.game.minutes);
  }

  // ——— Worth ———

  private slotsValue(slots: Slots | null | undefined): number {
    let v = 0;
    for (const st of slots ?? []) if (st) v += (ITEM_BY_ID.get(st.id)?.value ?? 0) * st.n * qualityMultiplier(st.q);
    return v;
  }

  private structureValue(s: Structure): number {
    let v = ITEM_BY_ID.get(s.def.item)?.value ?? 0;
    v += this.slotsValue(s.store);
    if (s.machine) v += this.slotsValue(s.machine.in) + this.slotsValue(s.machine.out) + this.slotsValue(s.machine.fuel);
    for (const it of s.items ?? []) v += (ITEM_BY_ID.get(it.item)?.value ?? 0) * qualityMultiplier(it.q);
    return v;
  }

  /** What everything each owner has out in the world is worth, contents included (cached for 2 s). */
  private propertyByOwner(): Map<string, number> {
    if (this.property && this.game.tick - this.property.tick < TICK_RATE * 2) return this.property.map;
    const map = new Map<string, number>();
    const add = (owner: string, v: number) => map.set(owner, (map.get(owner) ?? 0) + v);
    for (const s of this.game.world.structures.values()) if (s.owner && !s.town) add(s.owner, this.structureValue(s));
    for (const e of this.game.entities.values()) {
      if (e.kind === 'cart' && e.owner) add(e.owner, (ITEM_BY_ID.get(CART_ITEM[e.type])?.value ?? 0) + this.slotsValue(e.slots));
      else if (e.kind === 'creature' && e.owner) add(e.owner, ITEM_BY_ID.get(e.def.id)?.value ?? 0);
    }
    this.property = { tick: this.game.tick, map };
    return map;
  }

  private carried(p: Player): number {
    return p.crests + this.slotsValue(p.slots);
  }

  /** A player's own worth: Crests, what they carry, and what they own. */
  worth(accountId: string): number {
    const p = this.game.byAccount.get(accountId);
    const carried = p ? this.carried(p) : (this.tallies.get(accountId)?.carried ?? 0);
    return carried + (this.propertyByOwner().get(accountId) ?? 0);
  }

  companyWorth(id: string): number {
    return (this.game.companies.treasuryOf(id) ?? 0) + (this.propertyByOwner().get(companyAccount(id)) ?? 0);
  }

  // ——— Progress ———

  /** How far a player is towards an ambition. A company's achievements count for its members. */
  private value(p: Player, a: Ambition, grids: Map<string, number>): number {
    const mine = this.tally(p.accountId);
    const co = p.company ? this.tally(companyAccount(p.company)) : null;
    const both = (f: (t: Tally) => number) => Math.max(f(mine), co ? f(co) : 0);
    switch (a.kind) {
      case 'worth':
        return Math.max(this.worth(p.accountId), p.company ? this.companyWorth(p.company) : 0);
      case 'day_income':
        return both((t) => t.best.income);
      case 'day_added':
        return both((t) => t.best.added);
      case 'made':
        return both((t) => t.n[`made:${a.item}`] ?? 0);
      case 'freight':
        return both((t) => t.n.freight ?? 0);
      case 'town_sales':
        return both((t) => Math.max(0, ...Object.entries(t.n).map(([k, v]) => (k.startsWith('sales:') ? v : 0))));
      case 'grid':
        return Math.max(grids.get(p.accountId) ?? 0, p.company ? (grids.get(companyAccount(p.company)) ?? 0) : 0);
      case 'projects':
      case 'masterwork':
      case 'monument':
        return mine.n[a.kind] ?? 0;
    }
  }

  private text(a: Ambition, v: number): string {
    const money =
      a.kind === 'worth' || a.kind === 'day_income' || a.kind === 'day_added' || a.kind === 'projects' || a.kind === 'town_sales';
    const show = (x: number) => (money ? formatCrests(Math.floor(x)) : Math.floor(x).toLocaleString('en-US'));
    return `${show(Math.min(v, a.n))} / ${show(a.n)}`;
  }

  stepSecond(): void {
    if (this.game.tick % (TICK_RATE * CHECK_SECONDS) !== 0 || this.game.players.size === 0) return;
    const grids = this.game.power.supplyByOwner();
    for (const p of this.game.players.values()) {
      const t = this.tally(p.accountId);
      t.carried = this.carried(p);
      for (const a of AMBITIONS) if (!t.done.includes(a.id) && this.value(p, a, grids) >= a.n) this.complete(p, t, a);
    }
  }

  private complete(p: Player, t: Tally, a: Ambition): void {
    t.done.push(a.id);
    this.game.notice(p, `Ambition achieved: ${a.title}! +${a.prestige} prestige.`, 'money');
    this.game.emit(['sfx', 'research', Math.round(p.x * 100), Math.round(p.y * 100)], p.x, p.y, { only: p.id });
    this.game.broadcastChat(
      '',
      a.rank ? `${p.name} is now ${article(a.title)} ${a.title}!` : `${p.name} achieved "${a.title}": ${a.desc.replace(/\.$/, '')}.`,
      'system',
    );
  }

  /** The title under a player's name: the highest rung of the wealth ladder they reached. */
  title(accountId: string): string | null {
    const t = this.tallies.get(accountId);
    return t ? rankTitle(t.done) : null;
  }

  prestige(accountId: string): number {
    const t = this.tallies.get(accountId);
    if (!t) return 0;
    let n = 0;
    for (const a of AMBITIONS) if (t.done.includes(a.id)) n += a.prestige;
    return n + (t.n.monument_prestige ?? 0);
  }

  // ——— The Standings window ———

  standings(p: Player): StandingsInfo | null {
    const now = Date.now();
    if (now - (this.lastAsk.get(p.id) ?? 0) < 900) return null;
    this.lastAsk.set(p.id, now);
    const grids = this.game.power.supplyByOwner();
    const mine = this.tally(p.accountId);
    const ambitions: AmbitionInfo[] = AMBITIONS.map((a) => {
      const done = mine.done.includes(a.id);
      const v = done ? a.n : this.value(p, a, grids);
      return { id: a.id, progress: Math.min(1, v / a.n), text: done ? 'Done' : this.text(a, v), done };
    });
    const players = [...this.tallies].filter(([key]) => !isCompanyAccount(key));
    const row = (key: string, t: Tally, value: number): StandingRow => {
      const company = isCompanyAccount(key) ? undefined : this.game.companies.companyOf(key);
      return {
        name: t.name,
        value: Math.round(value),
        ...(rankTitle(t.done) ? { title: rankTitle(t.done)! } : {}),
        ...(company ? { company: this.game.companies.name(company) } : {}),
        ...(this.game.byAccount.has(key) ? { online: true } : {}),
        ...(key === p.accountId ? { you: true } : {}),
      };
    };
    const top = (list: [string, Tally][], f: (key: string, t: Tally) => number): StandingRow[] =>
      list
        .map(([key, t]) => ({ key, t, v: f(key, t) }))
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, BOARD_SIZE)
        .map((x) => row(x.key, x.t, x.v));
    const today = this.today;
    const companies = this.game.companies.all().map((c) => ({
      name: c.name,
      value: Math.round(this.companyWorth(c.id)),
      ...(p.company === c.id ? { you: true } : {}),
    }));
    const towns = this.game.world.settlements.map((g) => ({
      name: g.name,
      rows: [...this.tallies]
        .map(([key, t]) => ({ key, t, v: t.n[`sales:${g.id}`] ?? 0 }))
        .filter((x) => x.v > 0)
        .sort((a, b) => b.v - a.v)
        .slice(0, 3)
        .map((x) => row(x.key, x.t, x.v)),
    }));
    return {
      you: {
        worth: Math.round(this.worth(p.accountId)),
        prestige: this.prestige(p.accountId),
        title: rankTitle(mine.done),
        today: Math.round(mine.income),
        best: Math.round(mine.best.income),
      },
      ambitions,
      boards: [
        { id: 'worth', title: 'Richest', unit: 'crests', rows: top(players, (key) => this.worth(key)) },
        { id: 'today', title: "Today's takings", unit: 'crests', rows: top(players, (_, t) => (t.day === today ? t.income : 0)) },
        { id: 'prestige', title: 'Prestige', unit: 'points', rows: top(players, (key) => this.prestige(key)) },
        {
          id: 'companies',
          title: 'Companies',
          unit: 'crests',
          rows: companies
            .filter((c) => c.value > 0)
            .sort((a, b) => b.value - a.value)
            .slice(0, BOARD_SIZE),
        },
      ],
      towns,
    };
  }

  // ——— Persistence ———

  save(): AmbitionSave[] {
    for (const p of this.game.players.values()) this.tally(p.accountId).carried = this.carried(p);
    return [...this.tallies].map(([id, t]) => ({ id, ...t }));
  }

  load(list: AmbitionSave[] | undefined): void {
    for (const { id, ...t } of list ?? [])
      this.tallies.set(id, { ...t, n: t.n ?? {}, done: t.done ?? [], best: t.best ?? { income: 0, added: 0 } });
  }

  /** For tests. */
  tallyOf(key: string): Readonly<Tally> {
    return this.tally(key);
  }
}
