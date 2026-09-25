// Building (§43–44): grid placement with rules per structure, picking structures back up with a
// hammer, doors, and land claims with Owner / Manager / Builder / Worker / Visitor permissions.

import {
  BUILD_RANGE,
  ITEM_BY_ID,
  PLAYER_RADIUS,
  STRUCTURE_BY_ID,
  TILES,
  Tile,
  rotatedSize,
  type ClaimRole,
  type ClaimUi,
  type ItemStack,
} from '@ironwild/shared';
import type { Game } from './game';
import type { Player } from './player';
import { structureSolid, type Structure } from './world';

const ROLE_RANK: Record<ClaimRole | 'owner', number> = { visitor: 1, worker: 2, builder: 3, manager: 4, owner: 5 };
const MAX_CLAIMS = 3;

export class BuildSystem {
  constructor(private readonly game: Game) {}

  // ——— Permissions ———

  /** The player's rank on the claim covering a tile (5 = owner, 0 = none); unclaimed land is 5. */
  rankAt(p: Player, tx: number, ty: number): number {
    const claim = this.game.world.claimAt(tx, ty);
    if (!claim) return 5;
    if (claim.owner === p.accountId) return 5;
    if (claim.owner && this.game.companies.sameCompany(p.accountId, claim.owner)) return 4;
    const m = claim.members?.find((m) => m.id === p.accountId);
    return m ? ROLE_RANK[m.role] : 0;
  }

  canBuildAt(p: Player, tx: number, ty: number): boolean {
    return this.rankAt(p, tx, ty) >= ROLE_RANK.builder;
  }

  canUse(p: Player, s: Structure): boolean {
    if (!s.owner || s.owner === p.accountId) return true;
    if (this.game.companies.sameCompany(p.accountId, s.owner)) return true;
    if (s.def.shop) return true;
    return this.rankAt(p, s.x, s.y) >= (s.def.door ? ROLE_RANK.visitor : ROLE_RANK.worker);
  }

  canRemove(p: Player, s: Structure): boolean {
    if (!s.owner || s.owner === p.accountId) return true;
    if (this.game.companies.sameCompany(p.accountId, s.owner)) return true;
    return this.rankAt(p, s.x, s.y) >= ROLE_RANK.manager;
  }

  // ——— Placement ———

  /** Returns an error message, or null if the structure can be placed. */
  validate(p: Player, type: string, x: number, y: number, rot: number): string | null {
    const def = STRUCTURE_BY_ID.get(type);
    if (!def) return 'That cannot be placed.';
    const w = this.game.world;
    const [fw, fh] = rotatedSize(def, rot);
    if (x < 0 || y < 0 || x + fw > w.size || y + fh > w.size) return 'Out of bounds.';
    const cx = x + fw / 2;
    const cy = y + fh / 2;
    if (Math.hypot(cx - p.x, cy - p.y) > BUILD_RANGE) return 'Too far away.';
    if (w.settlementAt(cx, cy, 3)) return 'You cannot build inside a settlement.';
    for (let ty = y; ty < y + fh; ty++) {
      for (let tx = x; tx < x + fw; tx++) {
        const t = w.tile(tx, ty);
        const info = TILES[t];
        switch (def.placement) {
          case 'land':
            if (!info.land) return 'This needs solid ground.';
            break;
          case 'water':
            if (!info.flowing) return 'Water wheels must be placed on a river.';
            break;
          case 'farmland':
            if (t !== Tile.Farmland) return 'This needs tilled farmland.';
            break;
          case 'any':
            if (t === Tile.DeepWater || t === Tile.Cliff || t === Tile.House || t === Tile.Plaza) return 'You cannot build here.';
            break;
        }
        if (def.layer === 'floor' ? w.floorStructAt(tx, ty) : w.structAt(tx, ty)) return 'Something is already there.';
        if (!this.canBuildAt(p, tx, ty)) return 'This land is claimed by someone else.';
      }
    }
    if (def.machine?.water && !w.touchesWater(x, y, fw, fh)) return `The ${def.name} must touch water.`;
    // Solid nodes block; soft ones (grass) are cleared.
    for (const n of w.nodesNear(cx, cy, Math.max(fw, fh))) {
      if (n.regrowAt > 0 || !n.def.solid) continue;
      if (circleHitsBox(n.x, n.y, n.def.radius, x, y, fw, fh)) return `A ${n.def.name.toLowerCase()} is in the way.`;
    }
    if (def.solid || def.door) {
      for (const other of this.game.players.values()) {
        if (!other.dead && circleHitsBox(other.x, other.y, PLAYER_RADIUS, x, y, fw, fh)) return 'Someone is standing there.';
      }
      for (const e of this.game.entities.values()) {
        if (e.kind === 'creature' && circleHitsBox(e.x, e.y, e.def.radius, x, y, fw, fh)) return 'An animal is in the way.';
      }
    }
    if (def.claimRadius) {
      const r = def.claimRadius;
      let mine = 0;
      for (const c of w.claims) {
        if (c.owner === p.accountId) mine++;
        if (Math.abs(c.x - x) <= r * 2 + 1 && Math.abs(c.y - y) <= r * 2 + 1 && c.owner !== p.accountId)
          return 'Too close to another claim.';
      }
      if (mine >= MAX_CLAIMS) return `You can own at most ${MAX_CLAIMS} land claims.`;
      if (w.settlementAt(cx, cy, r + 4)) return 'Too close to a settlement.';
    }
    return null;
  }

  place(p: Player, item: string, x: number, y: number, rot: number): void {
    if (typeof item !== 'string' || !Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(rot)) return;
    const def = ITEM_BY_ID.get(item);
    if (!def?.place) return;
    const slot = p.slots[p.sel]?.id === item ? p.sel : p.slots.findIndex((s) => s?.id === item);
    if (slot < 0) return;
    const r = ((rot % 4) + 4) % 4;
    const err = this.validate(p, def.place, x, y, r);
    if (err) {
      this.game.notice(p, err, 'bad');
      return;
    }
    const s = this.game.world.makeStructure(this.game.nextStructId++, def.place, x, y, r, p.accountId, p.name);
    const stack = p.slots[slot]!;
    stack.n -= 1;
    if (stack.n <= 0) p.slots[slot] = null;
    p.invDirty = true;
    // Clear soft and depleted nodes underneath for good.
    const w = this.game.world;
    for (const n of w.nodesNear(x + s.w / 2, y + s.h / 2, Math.max(s.w, s.h))) {
      if ((n.regrowAt > 0 || !n.def.solid) && circleHitsBox(n.x, n.y, n.def.radius, x, y, s.w, s.h)) {
        n.gone = true;
        this.game.nodeChanged(n);
      }
    }
    if (s.type === 'windmill') {
      const region = w.regions[y * w.size + x];
      s.rpm = region === 4 ? 16 : region === 3 ? 14 : 10;
    }
    this.game.factory.initStructure(s);
    w.addStructure(s);
    this.game.structAdded(s);
    this.game.factory.structureChanged(s);
    this.game.emit(['sfx', 'build', Math.round((x + 0.5) * 100), Math.round((y + 0.5) * 100)], x, y, { r: 20 });
    this.game.progression.onPlace(p, s.type);
  }

  rotate(p: Player, id: number): void {
    const s = this.game.world.structures.get(id);
    if (!s || !this.canRemove(p, s)) return;
    if (s.w !== s.h) return;
    if (Math.hypot(s.x + 0.5 - p.x, s.y + 0.5 - p.y) > BUILD_RANGE) return;
    const w = this.game.world;
    w.removeStructure(s);
    s.rot = (s.rot + 1) % 4;
    w.addStructure(s);
    this.game.structRemoved(s);
    this.game.structAdded(s);
    this.game.factory.structureChanged(s);
  }

  /** Hammer hit: pick a structure back up, contents and all. */
  hammer(p: Player, s: Structure): void {
    if (!this.canRemove(p, s)) {
      this.game.notice(p, `That belongs to ${s.ownerName}.`, 'bad');
      return;
    }
    if (s.crop) {
      this.game.farming.harvest(p, s);
      return;
    }
    const refund: ItemStack[] = [{ id: s.def.item, n: 1 }];
    refund.push(...this.game.factory.contents(s));
    this.remove(s);
    for (const r of refund) this.game.playerSystem.give(p, r, true);
    this.game.emit(['sfx', 'pickup', Math.round((s.x + 0.5) * 100), Math.round((s.y + 0.5) * 100)], s.x, s.y, { r: 16 });
  }

  remove(s: Structure): void {
    const w = this.game.world;
    w.removeStructure(s);
    this.game.structRemoved(s);
    this.game.factory.structureChanged(s);
    for (const p of this.game.players.values()) {
      if (p.uiTarget?.kind === 'struct' && p.uiTarget.id === s.id) this.game.playerSystem.closeUi(p);
      if (p.bed?.id === s.id) {
        p.bed = null;
        p.statusDirty = true;
      }
    }
  }

  toggleDoor(p: Player, s: Structure): void {
    if (!this.canUse(p, s)) {
      this.game.notice(p, `The door is locked. It belongs to ${s.ownerName}.`, 'bad');
      return;
    }
    if (s.open) {
      // Don't close on someone.
      for (const other of this.game.players.values()) if (circleHitsBox(other.x, other.y, PLAYER_RADIUS, s.x, s.y, 1, 1)) return;
      for (const e of this.game.entities.values())
        if (e.kind === 'creature' && circleHitsBox(e.x, e.y, e.def.radius, s.x, s.y, 1, 1)) return;
    }
    s.open = !s.open;
    this.game.structVisual(s);
    this.game.emit(['sfx', 'door', Math.round((s.x + 0.5) * 100), Math.round((s.y + 0.5) * 100)], s.x, s.y, { r: 16 });
  }

  isSolid(s: Structure): boolean {
    return structureSolid(s);
  }

  // ——— Claims ———

  claimUi(p: Player, s: Structure): ClaimUi {
    return {
      kind: 'claim',
      id: s.id,
      owner: s.ownerName,
      mine: s.owner === p.accountId || this.rankAt(p, s.x, s.y) >= ROLE_RANK.manager,
      members: (s.members ?? []).map((m) => ({ name: m.name, role: m.role })),
      radius: s.def.claimRadius ?? 0,
    };
  }

  claimMember(p: Player, id: number, op: 'add' | 'remove', name: string, role?: ClaimRole): void {
    const s = this.game.world.structures.get(id);
    if (!s?.def.claimRadius || typeof name !== 'string') return;
    if (s.owner !== p.accountId && this.rankAt(p, s.x, s.y) < ROLE_RANK.manager) return;
    s.members ??= [];
    if (op === 'remove') {
      s.members = s.members.filter((m) => m.name.toLowerCase() !== name.toLowerCase());
    } else {
      const target = this.game.playerByName(name);
      if (!target) {
        this.game.notice(p, `${name} is not online.`, 'bad');
        return;
      }
      if (target.accountId === s.owner) return;
      const r: ClaimRole = role && role in ROLE_RANK && role !== ('owner' as never) ? role : 'worker';
      s.members = s.members.filter((m) => m.id !== target.accountId);
      s.members.push({ id: target.accountId, name: target.name, role: r });
      this.game.notice(target, `${p.name} gave you ${r} access to their land.`, 'good');
    }
    this.game.playerSystem.refreshUi(p, true);
  }
}

export function circleHitsBox(cx: number, cy: number, r: number, x: number, y: number, w: number, h: number): boolean {
  const nx = Math.max(x, Math.min(cx, x + w));
  const ny = Math.max(y, Math.min(cy, y + h));
  return (cx - nx) * (cx - nx) + (cy - ny) * (cy - ny) < r * r;
}
