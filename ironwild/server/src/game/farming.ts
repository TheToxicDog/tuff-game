// Farming and ranching (§11): till ground with a hoe, plant seeds, harvest ripe crops, collect
// eggs, wool and milk from your animals.

import { CROP_BY_ID, CROP_STAGES, ITEM_BY_ID, Tile } from '@ironwild/shared';
import type { Creature } from './entities';
import type { Game } from './game';
import type { Player } from './player';
import type { Structure } from './world';

const TILLABLE = new Set<number>([Tile.Grass, Tile.Plains, Tile.Forest, Tile.Highland, Tile.Marsh, Tile.Sand]);

export class Farming {
  private readonly crops = new Set<Structure>();
  private timer = 0;

  constructor(private readonly game: Game) {}

  step(dt: number): void {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 1;
    const now = Date.now();
    for (const s of this.crops) {
      if (!this.game.world.structures.has(s.id)) {
        this.crops.delete(s);
        continue;
      }
      const stage = this.stage(s, now);
      if (s.stage !== stage) {
        s.stage = stage;
        this.game.structVisual(s);
      }
    }
  }

  /** Registers a crop loaded from a save. */
  track(s: Structure): void {
    if (s.crop) this.crops.add(s);
  }

  stage(s: Structure, now = Date.now()): number {
    if (!s.crop) return 0;
    return Math.min(CROP_STAGES, Math.floor(((now - s.crop.planted) / s.crop.grow) * CROP_STAGES));
  }

  till(p: Player, tx: number, ty: number): void {
    const w = this.game.world;
    const t = w.tile(tx, ty);
    if (!TILLABLE.has(t)) {
      this.game.notice(p, 'You cannot till that ground.', 'bad');
      return;
    }
    if (w.settlementAt(tx + 0.5, ty + 0.5, 3) || !this.game.building.canBuildAt(p, tx, ty) || w.structAt(tx, ty)) return;
    for (const n of w.nodesNear(tx + 0.5, ty + 0.5, 1)) {
      if (n.def.solid && n.regrowAt === 0 && Math.hypot(n.x - tx - 0.5, n.y - ty - 0.5) < n.def.radius + 0.5) return;
    }
    w.setTile(tx, ty, Tile.Farmland);
    this.game.replication.tileChanged(tx, ty, Tile.Farmland);
    p.addXp('farming', 1);
    this.game.emit(['hit', Math.round((tx + 0.5) * 100), Math.round((ty + 0.5) * 100), 'dirt'], tx, ty);
  }

  plant(p: Player, tx: number, ty: number, crop: string): boolean {
    const w = this.game.world;
    const def = CROP_BY_ID.get(crop);
    if (!def) return false;
    if (w.tile(tx, ty) !== Tile.Farmland) {
      this.game.notice(p, 'Seeds need tilled farmland. Use a hoe first.', 'bad');
      return false;
    }
    if (w.structAt(tx, ty) || !this.game.building.canBuildAt(p, tx, ty)) return false;
    const s = w.makeStructure(this.game.nextStructId++, 'crop', tx, ty, 0, p.accountId, p.name);
    s.crop = { id: crop, planted: Date.now(), grow: def.grow * 1000 * (1 - p.skill('farming') * 0.015) };
    w.addStructure(s);
    this.crops.add(s);
    this.game.structAdded(s);
    p.addXp('farming', 1);
    return true;
  }

  harvest(p: Player, s: Structure): void {
    if (!s.crop) return;
    const def = CROP_BY_ID.get(s.crop.id);
    if (!def) return;
    const stage = this.stage(s);
    if (stage < CROP_STAGES) {
      const pct = Math.floor(((Date.now() - s.crop.planted) / s.crop.grow) * 100);
      this.game.notice(p, `${def.name}: not ripe yet (${pct}%).`, 'info');
      return;
    }
    if (s.owner && s.owner !== p.accountId && !this.game.building.canUse(p, s)) {
      this.game.notice(p, `Those are ${s.ownerName}'s crops.`, 'bad');
      return;
    }
    this.game.building.remove(s);
    this.crops.delete(s);
    const bonus = 1 + p.skill('farming') * 0.03;
    for (const y of def.yields) {
      const n = Math.round((y.min + Math.random() * (y.max - y.min)) * bonus);
      if (n > 0) this.game.playerSystem.give(p, { id: y.item, n });
    }
    p.addXp('farming', 3);
    this.game.emit(['pop', Math.round((s.x + 0.5) * 100), Math.round((s.y + 0.5) * 100), `Harvested ${def.name}`, 0xe0b84c], s.x, s.y, {
      only: p.id,
    });
  }

  collect(p: Player, c: Creature): void {
    if (!c.owner || !c.def.product) return;
    if (c.owner !== p.accountId && !this.game.companies.sameCompany(p.accountId, c.owner)) {
      this.game.notice(p, `That ${c.def.name.toLowerCase()} belongs to ${c.ownerName}.`, 'bad');
      return;
    }
    if (!c.hasProduct) {
      this.game.notice(p, `Your ${c.def.name.toLowerCase()} has nothing for you yet.`, 'info');
      return;
    }
    c.hasProduct = false;
    c.productIn = c.def.product.every;
    const n = c.def.id === 'chicken' ? 1 + (Math.random() < 0.3 ? 1 : 0) : 1 + (Math.random() < p.skill('farming') * 0.03 ? 1 : 0);
    this.game.playerSystem.give(p, { id: c.def.product.item, n });
    p.addXp('farming', 2);
    this.game.emit(
      ['pop', Math.round(c.x * 100), Math.round(c.y * 100), `+${n} ${ITEM_BY_ID.get(c.def.product.item)?.name}`, 0xffffff],
      c.x,
      c.y,
      {
        only: p.id,
      },
    );
  }
}
