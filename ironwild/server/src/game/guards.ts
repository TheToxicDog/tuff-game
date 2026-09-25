// Hired guards (§42, "guards later"): a guard house on your land takes on a guard for wages paid in
// advance, a game day at a time. The guard keeps watch by the house, fights raiders and wild animals
// that come within reach of it, and mends between fights. When the wages run out the guard goes
// home; one who falls is replaced a couple of game hours later while the wages last. Wages are a
// money sink: they go to nobody.

import {
  CREATURE_BY_ID,
  GUARD_LEASH,
  GUARD_MAX_DAYS,
  GUARD_REPLACE_MINUTES,
  GUARD_TERMS,
  GUARD_WAGE,
  INTERACT_RANGE,
  formatCrests,
  roundCrests,
  type GuardUi,
} from '@ironwild/shared';
import { isCompanyAccount } from './companies';
import type { Creature } from './entities';
import type { Game } from './game';
import type { Player } from './player';
import type { Structure } from './world';

/** How far a guard strolls from their post while all is quiet, and how fast they mend (health/s). */
const PATROL = 3.5;
const MEND = 3;
/** Game minutes before the wages run out when the owner is warned. */
const WARN_MINUTES = 180;

/** Whether a creature is a threat guards (and towers and traps) go for. */
export function hostileCreature(e: Creature): boolean {
  if (e.rider || e.guard) return false;
  return !!e.raider || e.def.temperament === 'aggressive' || (e.def.temperament === 'neutral' && e.aggro > 0) || !!e.foe;
}

export class GuardSystem {
  constructor(private readonly game: Game) {}

  /** Puts the guards of saved guard houses back on duty. */
  init(): void {
    for (const s of this.game.world.guardHouses) if (s.guard && !s.guard.back) this.report(s);
  }

  /** Once a second: wages running out, replacements reporting for duty. */
  stepSecond(): void {
    const now = this.game.minutes;
    for (const s of [...this.game.world.guardHouses]) {
      const g = s.guard;
      if (!g) continue;
      if (now >= g.until) {
        this.dismiss(s);
        this.tell(s, `Your guard's wages at the guard house ran out and they went home. Hire another there (E).`, 'info');
        continue;
      }
      if (!g.entity && now >= g.back) {
        g.back = 0;
        g.hp = CREATURE_BY_ID.get('guard')!.hp;
        this.report(s);
        this.tell(s, 'A new guard has reported for duty at your guard house.', 'good');
      }
      if (!g.warned && g.until - now < WARN_MINUTES) {
        g.warned = true;
        this.tell(s, 'Your guard’s wages run out in a few hours. Pay more at the guard house (E).', 'info');
      }
    }
  }

  // ——— Hiring ———

  hire(p: Player, id: number, days: number): void {
    const s = this.house(p, id);
    if (!s || !(GUARD_TERMS as readonly number[]).includes(days)) return;
    if (!this.game.building.canUse(p, s)) {
      this.game.notice(p, `That guard house belongs to ${s.ownerName}.`, 'bad');
      return;
    }
    const now = this.game.minutes;
    const from = Math.max(now, s.guard?.until ?? now);
    if (from + days * 1440 - now > GUARD_MAX_DAYS * 1440) {
      this.game.notice(p, `Wages can be paid at most ${GUARD_MAX_DAYS} days ahead.`, 'bad');
      return;
    }
    const cost = GUARD_WAGE * days;
    if (p.crests < cost) {
      this.game.notice(p, `${days} day${days > 1 ? 's' : ''} of wages come to ${formatCrests(cost)}.`, 'bad');
      return;
    }
    p.crests = roundCrests(p.crests - cost);
    p.statusDirty = true;
    this.game.emit(['sfx', 'coins', Math.round(p.x * 100), Math.round(p.y * 100)], p.x, p.y, { only: p.id });
    if (s.guard) {
      s.guard.until = from + days * 1440;
      s.guard.warned = false;
      this.game.notice(p, `Paid the guard ${days} more day${days > 1 ? 's' : ''} (${formatCrests(cost)}).`, 'good');
      return;
    }
    s.guard = { until: now + days * 1440, hp: CREATURE_BY_ID.get('guard')!.hp, entity: 0, back: 0 };
    this.report(s);
    this.game.notice(p, `A guard reports for duty: ${formatCrests(cost)} for ${days} day${days > 1 ? 's' : ''}.`, 'good');
  }

  /** Sends the guard home (no refund). */
  release(p: Player, id: number): void {
    const s = this.house(p, id);
    if (!s?.guard) return;
    if (!this.game.building.canManage(p, s)) {
      this.game.notice(p, 'Only the owner can send the guard home.', 'bad');
      return;
    }
    this.dismiss(s);
    this.game.notice(p, 'The guard packs up and goes home.', 'info');
  }

  private house(p: Player, id: number): Structure | undefined {
    const s = this.game.world.structures.get(id);
    if (!s?.def.guardHouse) return undefined;
    const nx = Math.max(s.x, Math.min(p.x, s.x + s.w));
    const ny = Math.max(s.y, Math.min(p.y, s.y + s.h));
    return Math.hypot(nx - p.x, ny - p.y) <= INTERACT_RANGE + 2 ? s : undefined;
  }

  /** A guard steps out in front of the house. */
  private report(s: Structure): void {
    const g = s.guard!;
    const def = CREATURE_BY_ID.get('guard')!;
    const c = this.game.creatures.spawn('guard', s.x + s.w / 2, s.y + s.h + 0.6, '');
    c.guard = { post: s.id, nav: { stuck: 0, detourUntil: 0, dx: 0, dy: 0 } };
    c.owner = s.owner;
    c.ownerName = s.ownerName;
    c.hp = Math.max(1, Math.min(def.hp, g.hp));
    c.homeX = c.x;
    c.homeY = c.y;
    g.entity = c.id;
    this.game.structVisual(s);
  }

  private dismiss(s: Structure): void {
    if (s.guard?.entity) this.game.removeEntity(s.guard.entity);
    s.guard = undefined;
    this.game.structVisual(s);
  }

  /** A guard fell: a replacement comes while the wages last. */
  fell(c: Creature): void {
    const s = c.guard ? this.game.world.structures.get(c.guard.post) : undefined;
    if (!s?.guard || s.guard.entity !== c.id) return;
    s.guard.entity = 0;
    s.guard.back = this.game.minutes + GUARD_REPLACE_MINUTES;
    this.game.structVisual(s);
    this.tell(s, 'Your guard fell defending your land. A replacement will report for duty in a couple of hours.', 'bad');
  }

  private tell(s: Structure, text: string, kind: 'info' | 'good' | 'bad'): void {
    if (!s.owner) return;
    if (isCompanyAccount(s.owner)) {
      this.game.companies.notify(s.owner, text);
      return;
    }
    const owner = this.game.byAccount.get(s.owner);
    if (owner) this.game.notice(owner, text, kind);
  }

  // ——— On duty ———

  think(c: Creature, dt: number): void {
    const s = this.game.world.structures.get(c.guard!.post);
    if (!s?.guard || s.guard.entity !== c.id) {
      this.game.removeEntity(c.id);
      return;
    }
    const creatures = this.game.creatures;
    s.guard.hp = c.hp;
    const foe = this.foe(c, s);
    if (foe) {
      c.state = 'chase';
      c.target = foe.id;
      creatures.pursue(c, foe.x, foe.y, creatures.attackCreature(c, foe, dt), dt, c.guard!.nav);
      if (Math.hypot(foe.x - c.x, foe.y - c.y) < c.def.radius + foe.def.radius + 0.6) c.angle = Math.atan2(foe.y - c.y, foe.x - c.x);
      return;
    }
    // All quiet: back to the post, a few steps about it now and then, and mend.
    c.hp = Math.min(c.def.hp, c.hp + MEND * dt);
    const away = Math.hypot(c.x - c.homeX, c.y - c.homeY);
    if (away > PATROL + 1) {
      c.state = 'return';
      creatures.pursue(c, c.homeX, c.homeY, c.def.speed * 0.7, dt, c.guard!.nav);
      return;
    }
    if (c.timer <= 0) {
      c.timer = 3 + Math.random() * 5;
      c.state = Math.random() < 0.5 ? 'wander' : 'idle';
      c.wx = c.homeX + (Math.random() - 0.5) * PATROL * 2;
      c.wy = c.homeY + (Math.random() - 0.5) * PATROL * 2;
    }
    const strolling = c.state === 'wander' && Math.hypot(c.x - c.wx, c.y - c.wy) > 0.6;
    creatures.steer(c, c.wx, c.wy, strolling ? c.def.speed * 0.3 : 0, dt);
  }

  /** The nearest threat in sight that is close enough to the house to be the guard's business. */
  private foe(c: Creature, s: Structure): Creature | null {
    const hx = s.x + s.w / 2;
    const hy = s.y + s.h / 2;
    let best: Creature | null = null;
    let bestD = c.def.sight;
    for (const e of this.game.entities.values()) {
      if (e.kind !== 'creature' || e === c || !hostileCreature(e)) continue;
      if (Math.hypot(e.x - hx, e.y - hy) > GUARD_LEASH) continue;
      // Whoever is going for the guard comes first.
      const d = Math.hypot(e.x - c.x, e.y - c.y) - (e.foe === c.id ? 3 : 0);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  /** The nearest guard on duty within `r` of (x, y). */
  nearest(x: number, y: number, r: number): Creature | null {
    let best: Creature | null = null;
    let bestD = r;
    for (const s of this.game.world.guardHouses) {
      const e = s.guard?.entity ? this.game.entities.get(s.guard.entity) : undefined;
      if (e?.kind !== 'creature') continue;
      const d = Math.hypot(e.x - x, e.y - y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  // ——— Window ———

  ui(p: Player, s: Structure): GuardUi {
    const g = s.guard;
    const e = g?.entity ? this.game.entities.get(g.entity) : undefined;
    const guard = e?.kind === 'creature' ? e : undefined;
    let status = 'Nobody hired. A guard fights raiders and wild animals within 14 tiles of the house.';
    if (g && !guard) status = 'A new guard is on the way.';
    else if (guard?.state === 'chase') {
      const foe = this.game.entities.get(guard.target);
      status = foe?.kind === 'creature' ? `Fighting ${foe.raider ? 'a raider' : `a ${foe.def.name.toLowerCase()}`}!` : 'Fighting!';
    } else if (guard) status = guard.hp < guard.def.hp ? 'On watch, patching up wounds.' : 'On watch.';
    return {
      kind: 'guard',
      id: s.id,
      owner: s.ownerName,
      left: g ? Math.max(0, Math.round((g.until - this.game.minutes) / 10) * 10) : 0,
      hp: guard ? Math.round((guard.hp / guard.def.hp) * 100) : 0,
      status,
      wage: GUARD_WAGE,
      terms: [...GUARD_TERMS],
      manage: this.game.building.canManage(p, s),
    };
  }
}
