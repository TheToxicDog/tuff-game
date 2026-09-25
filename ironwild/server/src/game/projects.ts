// Town projects (§53–54): each settlement works through a list of things it wants built. Anyone can
// deliver the goods at the contract board and is paid a little above market; when the last good is
// in, the town prospers, its market deepens, the biggest helpers share a bonus, and the new
// building appears in town.

import {
  ITEM_BY_ID,
  PROJECT_BY_ID,
  SETTLEMENT_BY_ID,
  STRUCTURE_BY_ID,
  TILES,
  Tile,
  countItem,
  formatCrests,
  projectsFor,
  removeItem,
  roundCrests,
  type ProjectInfo,
  type TownProject,
} from '@ironwild/shared';
import type { ProjectSave } from '../persistence/storage';
import type { Game } from './game';
import type { Player } from './player';
import type { Structure } from './world';

interface TownState {
  /** Index of the project under way in the settlement's list. */
  index: number;
  delivered: Record<string, number>;
  /** Account → name and value delivered. */
  helpers: Record<string, { name: string; value: number }>;
}

/** Premium over the market for goods delivered to a project. */
const PREMIUM = 1.1;
/** Share of a project's delivered value paid out again, split among helpers, when it finishes. */
const COMPLETION_BONUS = 0.1;

export class TownProjects {
  private readonly towns = new Map<string, TownState>();

  constructor(private readonly game: Game) {}

  private state(settlement: string): TownState {
    let t = this.towns.get(settlement);
    if (!t) this.towns.set(settlement, (t = { index: 0, delivered: {}, helpers: {} }));
    return t;
  }

  current(settlement: string): TownProject | undefined {
    return projectsFor(settlement)[this.state(settlement).index];
  }

  /** Market depth from finished projects. */
  scale(settlement: string): number {
    let s = 1;
    const done = this.state(settlement).index;
    for (const p of projectsFor(settlement).slice(0, done)) s *= p.scale ?? 1;
    return s;
  }

  /** What a project pays per unit of a good: a little over what the town's best trader offers. */
  private price(settlement: string, item: string): number {
    const def = ITEM_BY_ID.get(item)!;
    const s = SETTLEMENT_BY_ID.get(settlement)!;
    const buyer = this.game.economy.bestBuyer(s, def);
    const bid = buyer ? this.game.economy.bid(s, buyer, def) : def.value * 0.8;
    return roundCrests(Math.max(bid, def.value * 0.8) * PREMIUM);
  }

  info(settlement: string): ProjectInfo | undefined {
    const project = this.current(settlement);
    if (!project) return undefined;
    const st = this.state(settlement);
    const total = Object.values(st.helpers).reduce((a, h) => a + h.value, 0);
    return {
      id: project.id,
      title: project.title,
      desc: project.desc,
      needs: project.needs.map((n) => ({ item: n.item, n: n.n, done: st.delivered[n.item] ?? 0, price: this.price(settlement, n.item) })),
      top: Object.values(st.helpers)
        .sort((a, b) => b.value - a.value)
        .slice(0, 3)
        .map((h) => [h.name, total > 0 ? Math.round((h.value / total) * 100) / 100 : 0] as [string, number]),
      finished: st.index,
      total: projectsFor(settlement).length,
    };
  }

  /** Delivers everything the player carries of one good (up to what is still needed). */
  deliver(p: Player, npcId: string, item: string): void {
    const npc = this.game.economy.npc(npcId);
    if (!npc || npc.profession !== 'board' || Math.hypot(npc.x - p.x, npc.y - p.y) > 5) return;
    const settlement = npc.settlement;
    const project = this.current(settlement);
    const need = project?.needs.find((n) => n.item === item);
    if (!project || !need) return;
    const st = this.state(settlement);
    const left = need.n - (st.delivered[item] ?? 0);
    const n = Math.min(left, countItem(p.slots, item));
    if (n <= 0) return;
    removeItem(p.slots, item, n);
    const pay = roundCrests(n * this.price(settlement, item));
    p.crests = roundCrests(p.crests + pay);
    p.stats.earned += pay;
    p.invDirty = p.statusDirty = true;
    st.delivered[item] = (st.delivered[item] ?? 0) + n;
    const h = (st.helpers[p.accountId] ??= { name: p.name, value: 0 });
    h.value += pay;
    this.game.progression.addKnowledge(p, Math.max(1, Math.round(pay / 200)), true);
    this.game.notice(p, `Delivered ${n}× ${ITEM_BY_ID.get(item)?.name} to "${project.title}" for ${formatCrests(pay)}.`, 'money');
    this.game.emit(['sfx', 'coins', Math.round(p.x * 100), Math.round(p.y * 100)], p.x, p.y, { only: p.id });
    if (project.needs.every((x) => (st.delivered[x.item] ?? 0) >= x.n)) this.complete(settlement, project);
    this.game.playerSystem.refreshUi(p, true);
  }

  private complete(settlement: string, project: TownProject): void {
    const st = this.state(settlement);
    const town = SETTLEMENT_BY_ID.get(settlement)!;
    const helpers = Object.entries(st.helpers);
    const total = helpers.reduce((a, [, h]) => a + h.value, 0);
    for (const [id, h] of helpers) {
      const bonus = roundCrests(total * COMPLETION_BONUS * (h.value / Math.max(1, total)));
      this.game.economy.credit(id, bonus, 'Town project');
      const p = this.game.byAccount.get(id);
      if (p) this.game.notice(p, `${town.name} thanks you: ${formatCrests(bonus)} for your part in "${project.title}".`, 'money');
    }
    const names = helpers
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, 3)
      .map(([, h]) => h.name);
    this.game.broadcastChat(
      '',
      `${town.name} finished "${project.title}"!${names.length ? ` Thanks to ${names.join(', ')}.` : ''}`,
      'system',
    );
    st.index++;
    st.delivered = {};
    st.helpers = {};
    this.build(settlement, project);
    this.game.economy.grow(settlement, project.prosperity);
  }

  // ——— The new building ———

  private build(settlement: string, project: TownProject): Structure | null {
    const def = STRUCTURE_BY_ID.get(project.build.type);
    const g = this.game.world.settlements.find((s) => s.id === settlement);
    if (!def || !g) return null;
    // A wheel goes on the nearest stretch of river; failing that (or for anything else), near the square.
    const spot =
      this.findSpot(g.x, g.y, g.radius, def.size[0], def.size[1], project.build.near) ??
      this.findSpot(g.x, g.y, g.radius, def.size[0], def.size[1], 'square');
    if (!spot) {
      this.game.log(`town project ${project.id}: no room to build`);
      return null;
    }
    const w = this.game.world;
    for (const n of w.nodesNear(spot.x + def.size[0] / 2, spot.y + def.size[1] / 2, Math.max(...def.size) + 1)) {
      if (n.gone) continue;
      n.gone = true;
      this.game.nodeChanged(n);
    }
    const s = w.makeStructure(this.game.nextStructId++, def.id, spot.x, spot.y, 0, null, g.name);
    s.town = true;
    this.game.factory.initStructure(s);
    w.addStructure(s);
    this.game.structAdded(s);
    this.game.factory.structureChanged(s);
    return s;
  }

  private findSpot(
    cx: number,
    cy: number,
    r: number,
    w: number,
    h: number,
    near: TownProject['build']['near'],
  ): { x: number; y: number } | null {
    const world = this.game.world;
    const free = (x: number, y: number, test: (t: number) => boolean) => {
      for (let ty = y; ty < y + h; ty++)
        for (let tx = x; tx < x + w; tx++) if (!test(world.tile(tx, ty)) || world.claimAt(tx, ty)) return false;
      // A tile of space all round, so town buildings don't run into each other or anyone's factory.
      for (let ty = y - 1; ty <= y + h; ty++)
        for (let tx = x - 1; tx <= x + w; tx++) if (world.structAt(tx, ty) || world.floorStructAt(tx, ty)) return false;
      for (const p of this.game.players.values()) if (p.x > x - 1 && p.x < x + w + 1 && p.y > y - 1 && p.y < y + h + 1) return false;
      return true;
    };
    const ground = (t: number) => TILES[t].land && t !== Tile.Road && t !== Tile.Farmland && t !== Tile.Oil;
    const from = near === 'square' ? r + 2 : near === 'shore' ? r - 2 : 2;
    const to = near === 'river' ? 90 : r + 16;
    for (let d = from; d < to; d++) {
      const steps = Math.max(12, d * 8);
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = Math.round(cx + Math.cos(a) * d - w / 2);
        const y = Math.round(cy + Math.sin(a) * d - h / 2);
        if (near === 'river') {
          // A wheel sits on the river itself.
          if (free(x, y, (t) => TILES[t].flowing)) return { x, y };
          continue;
        }
        if (!free(x, y, ground)) continue;
        if (near === 'shore' && !world.touchesWater(x, y, w, h)) continue;
        return { x, y };
      }
    }
    return null;
  }

  // ——— Persistence ———

  save(): ProjectSave[] {
    return [...this.towns].map(([settlement, t]) => ({ settlement, index: t.index, delivered: t.delivered, helpers: t.helpers }));
  }

  load(list: ProjectSave[] | undefined): void {
    for (const t of list ?? []) {
      if (!SETTLEMENT_BY_ID.has(t.settlement)) continue;
      this.towns.set(t.settlement, { index: t.index, delivered: t.delivered ?? {}, helpers: t.helpers ?? {} });
    }
  }

  /** For tests and admins: finish the project under way. */
  finishNow(settlement: string): void {
    const project = this.current(settlement);
    if (project) this.complete(settlement, project);
  }

  projectById(id: string): TownProject | undefined {
    return PROJECT_BY_ID.get(id);
  }
}
