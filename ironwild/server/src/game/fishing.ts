// Fishing (§11): cast a float into water, wait for a bite, click in time. Rivers, Mirror Lake and
// the sea each have their own catch; now and then the line brings up junk, salvage or a lost purse.

import { ITEM_BY_ID, InputFlags, Region, TILES, Tile, addStack, roomFor } from '@ironwild/shared';
import type { Game } from './game';
import type { Player } from './player';

export type Water = 'river' | 'lake' | 'sea';

export interface FishingLine {
  x: number;
  y: number;
  /** Where the player stood when casting: walking away reels in. */
  ox: number;
  oy: number;
  water: Water;
  biteAt: number;
  /** While biting: the moment the fish lets go. */
  biteUntil: number;
}

type Catch = { item: string; n?: number; w: number } | { crests: [number, number]; w: number };

const CATCH: Record<Water, Catch[]> = {
  river: [
    { item: 'perch', w: 40 },
    { item: 'trout', w: 34 },
    { item: 'salmon', w: 8 },
    { item: 'carp', w: 5 },
    { item: 'soggy_boot', w: 7 },
    { item: 'scrap_metal', n: 2, w: 3 },
    { crests: [10, 40], w: 1.5 },
    { item: 'rough_gem', w: 0.4 },
  ],
  lake: [
    { item: 'perch', w: 35 },
    { item: 'carp', w: 30 },
    { item: 'pike', w: 18 },
    { item: 'trout', w: 5 },
    { item: 'soggy_boot', w: 6 },
    { item: 'scrap_metal', n: 2, w: 3 },
    { crests: [10, 50], w: 2 },
    { item: 'rough_gem', w: 0.8 },
  ],
  sea: [
    { item: 'mackerel', w: 45 },
    { item: 'sea_bass', w: 25 },
    { item: 'salmon', w: 6 },
    { item: 'soggy_boot', w: 5 },
    { item: 'scrap_metal', n: 3, w: 10 },
    { crests: [15, 80], w: 4 },
    { item: 'rough_gem', w: 1.5 },
  ],
};

/** Rare catches get likelier with skill. */
const RARE = new Set(['salmon', 'pike', 'sea_bass', 'rough_gem']);

const CAST_MIN = 1.4;
const CAST_MAX = 5.5;

export class Fishing {
  private readonly lake: { x: number; y: number } | null;

  constructor(private readonly game: Game) {
    const l = game.world.gen.landmarks.find((m) => m.kind === 'lake');
    this.lake = l ? { x: l.x, y: l.y } : null;
  }

  /** Called for every processed input step while a fishing rod is held. */
  input(p: Player): void {
    const primary = (p.flags & InputFlags.Primary) !== 0;
    const wasPrimary = (p.prevFlags & InputFlags.Primary) !== 0;
    if (!primary || wasPrimary || p.mounted || p.driving) return;
    const line = p.fishing;
    if (!line) this.cast(p);
    else if (line.biteUntil > 0) this.land(p, line);
    else this.reel(p);
  }

  step(): void {
    const now = Date.now();
    for (const p of this.game.players.values()) {
      const line = p.fishing;
      if (!line) continue;
      if (p.dead || p.mounted || p.driving || p.tool().kind !== 'rod' || Math.hypot(p.x - line.ox, p.y - line.oy) > 1.6) {
        this.reel(p);
        continue;
      }
      if (line.biteUntil > 0 && now > line.biteUntil) {
        line.biteUntil = 0;
        line.biteAt = now + this.wait(p);
        this.game.notice(p, 'It got away…', 'info');
        this.emit(p, 1);
      } else if (line.biteUntil === 0 && now >= line.biteAt) {
        line.biteUntil = now + 1200 + p.skill('fishing') * 30;
        this.emit(p, 2);
      }
    }
  }

  private cast(p: Player): void {
    const w = this.game.world;
    const cos = Math.cos(p.angle);
    const sin = Math.sin(p.angle);
    let hit: { x: number; y: number } | null = null;
    // The float lands at the far end of the first stretch of water along the aim.
    for (let d = CAST_MIN; d <= CAST_MAX; d += 0.25) {
      const x = p.x + cos * d;
      const y = p.y + sin * d;
      const t = w.tile(Math.floor(x), Math.floor(y));
      if (TILES[t]?.water && !w.structAt(Math.floor(x), Math.floor(y))) hit = { x, y };
      else if (hit) break;
    }
    if (!hit) {
      this.game.notice(p, 'Cast into open water: face a river, the lake or the sea.', 'info');
      return;
    }
    p.fishing = {
      x: hit.x,
      y: hit.y,
      ox: p.x,
      oy: p.y,
      water: this.waterAt(hit.x, hit.y),
      biteAt: Date.now() + this.wait(p),
      biteUntil: 0,
    };
    this.emit(p, 1);
    this.game.emit(['sfx', 'splash', Math.round(hit.x * 100), Math.round(hit.y * 100)], hit.x, hit.y, { r: 16 });
  }

  reel(p: Player): void {
    if (!p.fishing) return;
    this.emit(p, 0);
    p.fishing = null;
  }

  private land(p: Player, line: FishingLine): void {
    const table = CATCH[line.water];
    const skill = p.skill('fishing');
    const weight = (c: Catch) => ('item' in c && RARE.has(c.item) ? c.w * (1 + skill * 0.08) : c.w);
    const total = table.reduce((s, c) => s + weight(c), 0);
    let roll = Math.random() * total;
    let pick = table[0];
    for (const c of table) {
      roll -= weight(c);
      if (roll <= 0) {
        pick = c;
        break;
      }
    }
    const at = [Math.round(line.x * 100), Math.round(line.y * 100)] as const;
    if ('crests' in pick) {
      const n = pick.crests[0] + Math.floor(Math.random() * (pick.crests[1] - pick.crests[0] + 1));
      p.crests += n;
      p.statusDirty = true;
      this.game.emit(['pop', at[0], at[1], `A lost purse! +₡${n}`, 0xf2c53d], line.x, line.y, { only: p.id });
      this.game.emit(['sfx', 'coins', at[0], at[1]], line.x, line.y, { only: p.id });
    } else {
      const stack = { id: pick.item, n: pick.n ?? 1 };
      if (roomFor(p.slots, stack) < stack.n) this.game.playerSystem.spawnDrop(p.x, p.y, stack);
      else addStack(p.slots, stack);
      p.invDirty = true;
      this.game.progression.discover(p, stack.id);
      this.game.progression.onGather(p, stack.id, stack.n);
      const name = ITEM_BY_ID.get(stack.id)?.name ?? stack.id;
      this.game.emit(['pop', at[0], at[1], `+${stack.n} ${name}`, RARE.has(stack.id) ? 0x7ad0ff : 0xffffff], line.x, line.y, {
        only: p.id,
      });
    }
    p.addXp('fishing', 'item' in pick && RARE.has(pick.item) ? 6 : 2);
    this.game.emit(['sfx', 'reel', at[0], at[1]], line.x, line.y, { r: 16 });
    this.emit(p, 0);
    p.fishing = null;
  }

  /** Seconds until the next bite, shorter with skill. */
  private wait(p: Player): number {
    return (3.5 + Math.random() * 8) * 1000 * (1 - p.skill('fishing') * 0.025);
  }

  private waterAt(x: number, y: number): Water {
    const w = this.game.world;
    if (this.lake && Math.hypot(x - this.lake.x, y - this.lake.y) < 30) return 'lake';
    const i = Math.floor(y) * w.size + Math.floor(x);
    if (w.regions[i] === Region.Ocean || w.tiles[i] === Tile.DeepWater) return 'sea';
    return 'river';
  }

  private emit(p: Player, state: number): void {
    const line = p.fishing;
    if (!line) return;
    this.game.emit(['fish', p.id, Math.round(line.x * 100), Math.round(line.y * 100), state], line.x, line.y, { r: 40 });
  }
}
