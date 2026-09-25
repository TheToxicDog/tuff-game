// Player simulation: inputs and movement, attacks, hunger and healing, death and respawning,
// inventory operations and opening things (NPCs, machines, containers, bags, carts).

import {
  CREATURE_BY_ID,
  HORSE_SPEED,
  INPUT_DT,
  INPUT_RATE,
  HAND_CART_SLOTS,
  INTERACT_RANGE,
  MINECART_SLOTS,
  WAGON_SLOTS,
  ITEM_BY_ID,
  InputFlags,
  MAX_HEALTH,
  MAX_HUNGER,
  PLAYER_RADIUS,
  TRUCK_PAVED,
  TRUCK_SLOTS,
  TRUCK_SPEED,
  TRUCK_TANK,
  TRUCK_TILES_PER_FUEL,
  addStack,
  keptOnDeath,
  moveBetween,
  roomFor,
  stepMovement,
  type InputTuple,
  type ItemStack,
  type SectionName,
  type Slots,
  type SlotRef,
  type UiState,
} from '@ironwild/shared';
import type { Bag, Cart, Drop } from './entities';
import type { Game } from './game';
import type { Player } from './player';

const MAX_QUEUED_INPUTS = 40;

/** How full a truck's tank is, in whole percent. */
function tankPct(truck: Cart): number {
  return Math.round(((truck.fuel ?? 0) / (TRUCK_TANK * TRUCK_TILES_PER_FUEL)) * 100);
}
const HUNGER_PER_DAY = 65;

export class PlayerSystem {
  private readonly lastUi = new Map<number, string>();

  constructor(private readonly game: Game) {}

  joined(p: Player): void {
    p.invDirty = p.statusDirty = p.researchDirty = p.tutorialDirty = true;
    if (p.dead) p.session.send({ t: 'dead', by: 'your wounds', crests: 0, items: 0 });
    this.game.economy.sendContracts(p);
    this.game.economy.sendTowns(p);
    this.game.companies.sendInfo(p);
  }

  left(p: Player): void {
    this.closeUi(p);
    this.releaseCart(p);
    this.dismount(p);
    if (p.crankId) this.game.factory.crank(p, p.crankId, false);
  }

  receiveInputs(p: Player, inputs: unknown): void {
    if (!Array.isArray(inputs)) return;
    for (const raw of inputs.slice(0, 8)) {
      if (!Array.isArray(raw) || raw.length !== 5 || !raw.every((v) => typeof v === 'number' && Number.isFinite(v))) continue;
      const input = raw as InputTuple;
      if (input[0] <= p.lastSeq) continue;
      p.inputs.push(input);
    }
    if (p.inputs.length > MAX_QUEUED_INPUTS) p.inputs.splice(0, p.inputs.length - MAX_QUEUED_INPUTS);
  }

  step(dt: number): void {
    const now = Date.now();
    for (const p of this.game.players.values()) {
      p.inputBudget = Math.min(8, p.inputBudget + dt * INPUT_RATE);
      if (p.dead) {
        p.inputs.length = 0;
        continue;
      }
      this.updateMods(p);
      while (p.inputs.length > 0 && p.inputBudget >= 1) {
        const input = p.inputs.shift()!;
        p.inputBudget -= 1;
        this.applyInput(p, input, now);
      }
      this.survival(p, dt, now);
      if (p.hurtT > 0) p.hurtT -= dt;
      if (this.game.tick % 4 === 0) this.refreshUi(p);
      this.sync(p);
    }
  }

  private updateMods(p: Player): void {
    let speed = 1;
    if (p.mounted) speed *= HORSE_SPEED;
    if (p.driving) speed *= TRUCK_SPEED;
    if (p.pulling) speed *= 0.85;
    p.mods.speed = speed;
    p.mods.staminaRegen = p.buffs.has('stamina') ? 1.6 : 1;
    if (p.driving) p.mods.paved = TRUCK_PAVED;
    else delete p.mods.paved;
  }

  private applyInput(p: Player, input: InputTuple, now: number): void {
    const [seq, flags, mx, my, angle] = input;
    p.lastSeq = seq;
    p.prevFlags = p.flags;
    p.flags = flags;
    p.angle = Math.max(-4000, Math.min(4000, angle)) / 1000;
    const slow = (flags & InputFlags.Slow) !== 0;
    stepMovement(
      p.move,
      { mx, my, sprint: (flags & InputFlags.Sprint) !== 0, dodge: (flags & InputFlags.Dodge) !== 0, slow },
      INPUT_DT,
      this.game.world,
      p.mods,
    );
    this.game.combat.playerActions(p, INPUT_DT, now);
    if (p.pulling) this.dragCart(p);
    if (p.mounted) {
      const horse = this.game.entities.get(p.mounted);
      if (horse && horse.kind === 'creature') {
        // The horse faces where it goes; the rider looks where they aim.
        if (Math.hypot(p.x - horse.x, p.y - horse.y) > 0.01) horse.angle = Math.atan2(p.y - horse.y, p.x - horse.x);
        horse.x = p.x;
        horse.y = p.y;
      }
    }
    if (p.driving) this.driveTruck(p);
  }

  private survival(p: Player, dt: number, now: number): void {
    const hungerRate = HUNGER_PER_DAY / this.game.dayLength;
    p.hunger = Math.max(0, p.hunger - hungerRate * dt * (p.flags & InputFlags.Sprint ? 1.5 : 1));
    if (p.hunger <= 0) {
      if (now - p.lastHunger > 2000) {
        p.lastHunger = now;
        this.damage(p, 2, 'starvation', 0);
      }
    } else if (p.hunger > 25 && now - p.lastDamageAt > 6000 && p.hp < MAX_HEALTH) {
      p.hp = Math.min(MAX_HEALTH, p.hp + (p.buffs.has('regen') ? 2.5 : 1.1) * dt);
    }
    for (const [id, left] of p.buffs) {
      const next = left - dt;
      if (next <= 0) {
        p.buffs.delete(id);
        p.statusDirty = true;
      } else p.buffs.set(id, next);
    }
    if (this.game.tick % 10 === 0) p.statusDirty = true;
    p.stats.seconds += dt;
  }

  private sync(p: Player): void {
    if (p.invDirty) {
      p.invDirty = false;
      p.session.send({ t: 'inv', slots: p.slots, sel: p.sel, cap: p.cap });
    }
    if (p.statusDirty) {
      p.statusDirty = false;
      p.clampStats();
      const skills: Record<string, number> = {};
      for (const k of Object.keys(p.skills)) skills[k] = p.skill(k as never);
      p.session.send({
        t: 'status',
        hp: Math.round(p.hp * 10) / 10,
        hunger: Math.round(p.hunger * 10) / 10,
        crests: Math.round(p.crests * 10) / 10,
        kp: Math.floor(p.kp * 10) / 10,
        buffs: [...p.buffs].map(([id, left]) => ({ id, left: Math.round(left) })),
        skills,
        bed: !!p.bed,
        company: p.company ? this.game.companies.name(p.company) : undefined,
      });
    }
    if (p.researchDirty) {
      p.researchDirty = false;
      p.session.send({ t: 'research', kp: Math.floor(p.kp * 10) / 10, unlocked: [...p.unlocked], blueprints: [...p.blueprints] });
    }
    if (p.tutorialDirty) {
      p.tutorialDirty = false;
      this.game.progression.sendTutorial(p);
    }
  }

  // ——— Health ———

  damage(p: Player, amount: number, by: string, fromX: number, fromY = 0): void {
    if (p.dead || amount <= 0) return;
    if (p.move.dodgeT > 0 && by !== 'starvation') return;
    const held = p.heldItem();
    const blocking = (p.flags & InputFlags.Secondary) !== 0 && held?.tool && ['sword', 'club', 'spear', 'axe'].includes(held.tool.kind);
    if (blocking && fromX !== 0) {
      const toward = Math.atan2(fromY - p.y, fromX - p.x);
      let d = Math.abs(toward - p.angle) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      if (d < Math.PI / 2.2) {
        amount *= 0.35;
        p.move.stamina = Math.max(0, p.move.stamina - amount * 1.5);
      }
    }
    p.hp -= amount;
    p.lastDamageAt = Date.now();
    p.hurtT = 0.25;
    p.statusDirty = true;
    this.game.emit(['dmg', p.id, Math.round(amount), 0], p.x, p.y);
    if (p.hp <= 0) this.kill(p, by);
  }

  kill(p: Player, by: string): void {
    if (p.dead) return;
    p.dead = true;
    p.hp = 0;
    this.closeUi(p);
    this.releaseCart(p);
    this.dismount(p);
    p.stats.deaths++;
    // §39: drop a quarter of carried resources and lose a tenth of carried Crests.
    const lostCrests = Math.floor(p.crests * 0.1 * 10) / 10;
    p.crests -= lostCrests;
    const bagSlots: Slots = [];
    let items = 0;
    for (let i = 0; i < p.slots.length; i++) {
      const s = p.slots[i];
      if (!s) continue;
      const def = ITEM_BY_ID.get(s.id);
      if (!def || keptOnDeath(def)) continue;
      const exact = s.n * 0.25;
      const n = Math.floor(exact) + (Math.random() < exact - Math.floor(exact) ? 1 : 0);
      if (n <= 0) continue;
      bagSlots.push({ ...s, n });
      items += n;
      s.n -= n;
      if (s.n <= 0) p.slots[i] = null;
    }
    if (bagSlots.length > 0) {
      const bag: Bag = {
        kind: 'bag',
        id: this.game.newEntityId(),
        x: p.x,
        y: p.y,
        slots: bagSlots,
        owner: p.accountId,
        ownerName: p.name,
        expires: Date.now() + 15 * 60 * 1000,
      };
      this.game.addEntity(bag);
    }
    p.invDirty = p.statusDirty = true;
    this.game.emit(['die', p.id], p.x, p.y);
    p.session.send({ t: 'dead', by, crests: lostCrests, items });
    this.game.broadcastChat('', `${p.name} was killed by ${by}.`, 'system');
  }

  respawn(p: Player): void {
    if (!p.dead) return;
    const w = this.game.world;
    let x = w.gen.spawn.x + Math.random() * 4 - 2;
    let y = w.gen.spawn.y + Math.random() * 2 - 1;
    if (p.bed) {
      const bed = w.structures.get(p.bed.id);
      if (bed && bed.def.bed && bed.owner === p.accountId) {
        x = bed.x + 0.5;
        y = bed.y + 0.5;
      } else {
        p.bed = null;
        this.game.notice(p, 'Your bed is gone. You wake up in Westhaven.', 'bad');
      }
    }
    p.dead = false;
    p.hp = 70;
    p.hunger = Math.max(p.hunger, 45);
    p.move.x = x;
    p.move.y = y;
    p.move.vx = p.move.vy = 0;
    p.move.stamina = 100;
    p.inputs.length = 0;
    p.statusDirty = p.invDirty = true;
    p.session.send({ t: 'alive' });
  }

  heal(p: Player, amount: number): void {
    p.hp = Math.min(MAX_HEALTH, p.hp + amount);
    p.statusDirty = true;
  }

  // ——— Inventory ———

  /** Gives items to a player; whatever does not fit is dropped at their feet. */
  give(p: Player, stack: ItemStack, quiet = false): void {
    const left = addStack(p.slots, stack);
    if (left > 0) {
      this.spawnDrop(p.x, p.y, { ...stack, n: left });
      if (!quiet) this.game.notice(p, 'Your backpack is full — some items fell on the ground.', 'bad');
    }
    p.invDirty = true;
    this.game.progression.discover(p, stack.id);
  }

  spawnDrop(x: number, y: number, stack: ItemStack): void {
    const drop: Drop = {
      kind: 'drop',
      id: this.game.newEntityId(),
      x: x + (Math.random() - 0.5) * 0.8,
      y: y + (Math.random() - 0.5) * 0.8,
      stack,
      expires: Date.now() + 10 * 60 * 1000,
    };
    this.game.addEntity(drop);
  }

  selectSlot(p: Player, slot: number): void {
    if (!Number.isInteger(slot) || slot < 0 || slot >= Math.min(8, p.cap)) return;
    p.sel = slot;
    p.chargeT = p.drawT = 0;
    p.invDirty = true;
  }

  /** Live slot array behind a UI section name. */
  section(p: Player, name: SectionName): Slots | null {
    if (name === 'inv') return p.slots;
    const t = p.uiTarget;
    if (!t) return null;
    if (t.kind === 'struct') {
      const s = this.game.world.structures.get(t.id as number);
      if (!s) return null;
      if (name === 'store') return s.store ?? null;
      if (!s.machine) return null;
      if (name === 'in') return s.machine.in;
      if (name === 'fuel') return s.machine.fuel;
      if (name === 'out') return s.machine.out;
      return null;
    }
    if (t.kind === 'entity' && name === 'store') {
      const e = this.game.entities.get(t.id as number);
      if (e && (e.kind === 'bag' || e.kind === 'cart')) return e.slots;
    }
    return null;
  }

  private sectionAllowed(p: Player, ref: SlotRef, incoming: ItemStack | null): boolean {
    if (ref.s === 'inv') return true;
    const t = p.uiTarget;
    if (!t) return false;
    if (t.kind === 'struct') {
      const s = this.game.world.structures.get(t.id as number);
      if (!s) return false;
      if (s.def.shop && s.owner !== p.accountId) return false;
      if (ref.s === 'out' && incoming) return false;
      // Arrow towers take arrows, lubricators lubricant.
      if (s.def.only && incoming && ref.s === 'store' && incoming.id !== s.def.only) return false;
      if (s.machine && incoming && (ref.s === 'in' || ref.s === 'fuel')) return this.game.factory.accepts(s, ref.s, incoming.id);
      return true;
    }
    if (t.kind === 'entity') {
      const e = this.game.entities.get(t.id as number);
      if (e?.kind === 'bag' && incoming) return false;
      return true;
    }
    return false;
  }

  moveItems(p: Player, from: SlotRef, to: SlotRef, n?: number): void {
    if (!from || !to || typeof from.i !== 'number' || typeof to.i !== 'number') return;
    const a = this.section(p, from.s);
    const b = this.section(p, to.s);
    if (!a || !b || from.i < 0 || from.i >= a.length || to.i < 0 || to.i >= b.length) return;
    const src = a[from.i];
    if (!src) return;
    if (!this.sectionAllowed(p, from, null) || !this.sectionAllowed(p, to, src)) return;
    // A swap also moves the destination stack into the source section.
    const dst = b[to.i];
    if (dst && dst.id !== src.id && !this.sectionAllowed(p, from, dst)) return;
    if (moveBetween(a, from.i, b, to.i, n === undefined ? undefined : Math.floor(n))) this.afterMove(p, from, to);
  }

  /** Shift-click: moves a stack between the inventory and the open container. */
  quickMove(p: Player, from: SlotRef): void {
    if (!from || typeof from.i !== 'number') return;
    const a = this.section(p, from.s);
    if (!a || from.i < 0 || from.i >= a.length || !a[from.i]) return;
    const src = a[from.i]!;
    let targets: SectionName[];
    if (from.s === 'inv') {
      const ui = p.ui;
      if (!ui) return;
      if (ui.kind === 'machine') {
        targets = [];
        const s = this.game.world.structures.get(ui.id);
        if (s && this.game.factory.accepts(s, 'fuel', src.id)) targets.push('fuel');
        if (s && this.game.factory.accepts(s, 'in', src.id)) targets.push('in');
      } else targets = ['store'];
    } else targets = ['inv'];
    for (const t of targets) {
      const b = this.section(p, t);
      if (!b || !this.sectionAllowed(p, { s: t, i: 0 }, src) || !this.sectionAllowed(p, from, null)) continue;
      const left = addStack(b, src);
      const moved = src.n - left;
      if (moved <= 0) continue;
      src.n = left;
      if (src.n <= 0) a[from.i] = null;
      this.afterMove(p, from, { s: t, i: 0 });
      return;
    }
  }

  private afterMove(p: Player, from: SlotRef, to: SlotRef): void {
    p.invDirty = true;
    if (from.s !== 'inv' || to.s !== 'inv') {
      const t = p.uiTarget;
      if (t?.kind === 'struct') {
        const s = this.game.world.structures.get(t.id as number);
        if (s) this.game.factory.contentsChanged(s);
      }
      if (t?.kind === 'entity') {
        const e = this.game.entities.get(t.id as number);
        if (e?.kind === 'bag' && e.slots.every((s) => !s)) {
          this.game.removeEntity(e.id);
          this.closeUi(p);
        }
      }
      this.refreshUi(p, true);
    }
    const moved = to.s === 'inv' ? p.slots[to.i] : null;
    if (moved) this.game.progression.discover(p, moved.id);
  }

  dropItem(p: Player, slot: number, n?: number): void {
    const s = p.slots[slot];
    if (!s) return;
    const count = Math.max(1, Math.min(s.n, Math.floor(n ?? s.n)));
    s.n -= count;
    if (s.n <= 0) p.slots[slot] = null;
    const d = 1.1;
    this.spawnDrop(p.x + Math.cos(p.angle) * d, p.y + Math.sin(p.angle) * d, { ...s, n: count });
    p.invDirty = true;
  }

  pickup(p: Player): void {
    let best: Drop | Bag | null = null;
    let bestD = 2.2;
    for (const e of this.game.entities.values()) {
      if (e.kind !== 'drop' && e.kind !== 'bag') continue;
      const d = Math.hypot(e.x - p.x, e.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    if (!best) return;
    if (best.kind === 'drop') {
      const room = roomFor(p.slots, best.stack);
      if (room <= 0) {
        this.game.notice(p, 'Your backpack is full.', 'bad');
        return;
      }
      addStack(p.slots, { ...best.stack, n: room });
      this.game.progression.discover(p, best.stack.id);
      best.stack.n -= room;
      if (best.stack.n <= 0) this.game.removeEntity(best.id);
      p.invDirty = true;
      this.game.emit(['sfx', 'pickup', Math.round(p.x * 100), Math.round(p.y * 100)], p.x, p.y, { only: p.id });
      return;
    }
    // Bag: take everything that fits.
    let took = 0;
    for (let i = 0; i < best.slots.length; i++) {
      const s = best.slots[i];
      if (!s) continue;
      const room = roomFor(p.slots, s);
      if (room <= 0) continue;
      addStack(p.slots, { ...s, n: room });
      took += room;
      s.n -= room;
      if (s.n <= 0) best.slots[i] = null;
    }
    if (best.slots.every((s) => !s)) this.game.removeEntity(best.id);
    if (took > 0) {
      p.invDirty = true;
      this.game.notice(p, best.owner === p.accountId ? 'You recovered your bag.' : `You looted ${best.ownerName}'s bag.`, 'good');
    } else this.game.notice(p, 'Your backpack is full.', 'bad');
  }

  useItem(p: Player, slot: number, x?: number, y?: number): void {
    const s = p.slots[slot];
    if (!s) return;
    const def = ITEM_BY_ID.get(s.id);
    if (!def) return;
    const consume = () => {
      s.n -= 1;
      if (s.n <= 0) p.slots[slot] = null;
      p.invDirty = true;
    };
    if (def.backpack) {
      if (def.backpack <= p.cap) {
        this.game.notice(p, 'Your backpack is already at least that big.', 'bad');
        return;
      }
      consume();
      while (p.slots.length < def.backpack) p.slots.push(null);
      p.cap = def.backpack;
      p.invDirty = true;
      this.game.notice(p, `Backpack upgraded: ${def.backpack} slots.`, 'good');
      return;
    }
    if (def.teaches) {
      if (p.blueprints.has(def.id)) {
        this.game.notice(p, 'You already know this blueprint.', 'info');
        return;
      }
      consume();
      p.blueprints.add(def.id);
      p.researchDirty = true;
      this.game.progression.addKnowledge(p, 10);
      this.game.notice(p, `You studied the ${def.name}.`, 'good');
      return;
    }
    if (def.food) {
      this.eat(p, slot);
      return;
    }
    if (typeof x !== 'number' || typeof y !== 'number' || !Number.isFinite(x) || !Number.isFinite(y)) return;
    if (Math.hypot(x - p.x, y - p.y) > INTERACT_RANGE + 1.5) return;
    if (def.tool?.kind === 'hoe') {
      this.game.farming.till(p, Math.floor(x), Math.floor(y));
      return;
    }
    if (def.plant) {
      if (this.game.farming.plant(p, Math.floor(x), Math.floor(y), def.plant)) consume();
      return;
    }
    if (def.animal) {
      if (this.game.creatures.spawnFarmAnimal(p, def.animal, x, y)) consume();
      return;
    }
    if (def.vehicle) {
      const type = def.vehicle === 'cart' ? 'hand' : def.vehicle;
      const cart: Cart = {
        kind: 'cart',
        type,
        id: this.game.newEntityId(),
        x,
        y,
        angle: p.angle,
        slots: Array.from(
          {
            length:
              type === 'truck' ? TRUCK_SLOTS : type === 'wagon' ? WAGON_SLOTS : type === 'minecart' ? MINECART_SLOTS : HAND_CART_SLOTS,
          },
          () => null,
        ),
        owner: p.accountId,
        ownerName: p.name,
        puller: 0,
        // A new truck comes with an empty tank.
        ...(type === 'truck' ? { fuel: 0 } : {}),
      };
      if (type === 'minecart') {
        if (!this.game.rails.place(p, cart, x, y)) {
          this.game.notice(p, 'Put a minecart on a rail.', 'bad');
          return;
        }
      } else if (this.game.world.solidAt(Math.floor(x), Math.floor(y))) return;
      this.game.addEntity(cart);
      consume();
    }
  }

  eat(p: Player, slot: number): void {
    const s = p.slots[slot];
    const def = s ? ITEM_BY_ID.get(s.id) : undefined;
    if (!s || !def?.food || p.eatCd > 0) return;
    if (p.hunger >= MAX_HUNGER - 1 && !def.food.heal) {
      this.game.notice(p, "You're full.", 'info');
      return;
    }
    p.eatCd = 0.6;
    s.n -= 1;
    if (s.n <= 0) p.slots[slot] = null;
    p.hunger = Math.min(MAX_HUNGER, p.hunger + def.food.hunger);
    if (def.food.heal) p.hp = Math.min(MAX_HEALTH, p.hp + def.food.heal);
    if (def.food.buff) p.buffs.set(def.food.buff, def.food.buffSeconds ?? 60);
    p.invDirty = p.statusDirty = true;
    this.game.emit(['sfx', 'eat', Math.round(p.x * 100), Math.round(p.y * 100)], p.x, p.y, { r: 12 });
  }

  // ——— Interaction ———

  interact(p: Player, kind: string, id: string | number, op?: 'grab'): void {
    if (kind === 'npc' && typeof id === 'string') {
      const npc = this.game.economy.npc(id);
      if (!npc || Math.hypot(npc.x - p.x, npc.y - p.y) > INTERACT_RANGE + 1) return;
      if (!this.game.economy.isOpen(id)) {
        this.game.notice(p, 'This stall opens when the settlement grows — trade here to help it prosper.', 'info');
        return;
      }
      this.openUi(p, { kind: 'npc', id });
      return;
    }
    if (kind === 'struct' && typeof id === 'number') {
      const s = this.game.world.structures.get(id);
      if (!s) return;
      const nx = Math.max(s.x, Math.min(p.x, s.x + s.w));
      const ny = Math.max(s.y, Math.min(p.y, s.y + s.h));
      // As far as the client offers the prompt (INTERACT_RANGE + 0.6), and a little more for prediction.
      if (Math.hypot(nx - p.x, ny - p.y) > INTERACT_RANGE + 0.8) return;
      if (s.def.door) {
        this.game.building.toggleDoor(p, s);
        return;
      }
      if (s.def.bed) {
        if (s.owner !== p.accountId) {
          this.game.notice(p, 'That is not your bed.', 'bad');
          return;
        }
        p.bed = { id: s.id, x: s.x, y: s.y };
        p.statusDirty = true;
        this.game.notice(p, 'You will wake up here if you die.', 'good');
        return;
      }
      if (s.crop) {
        this.game.farming.harvest(p, s);
        return;
      }
      if (!this.game.building.canUse(p, s)) {
        this.game.notice(p, `That belongs to ${s.ownerName}.`, 'bad');
        return;
      }
      if (s.def.kinetic?.role === 'shaft' || s.def.logistics === 'conveyor') return;
      if (s.def.rail) {
        this.game.rails.interact(p, s);
        return;
      }
      this.openUi(p, { kind: 'struct', id });
      return;
    }
    if (kind === 'entity' && typeof id === 'number') {
      const e = this.game.entities.get(id);
      // Measured like the client's prompt (to a creature's edge), with a little slack for things on the move.
      const edge = e?.kind === 'creature' ? e.def.radius : 0;
      if (!e || Math.hypot(e.x - p.x, e.y - p.y) - edge > INTERACT_RANGE + 1) return;
      if (e.kind === 'bag') {
        this.openUi(p, { kind: 'entity', id });
        return;
      }
      if (e.kind === 'cart') {
        if (e.owner && e.owner !== p.accountId && !this.game.companies.sameCompany(p.accountId, e.owner)) {
          this.game.notice(p, `That cart belongs to ${e.ownerName}.`, 'bad');
          return;
        }
        if (op === 'grab') {
          if (e.type === 'minecart') {
            this.game.rails.reverse(e);
            return;
          }
          if (e.type === 'truck') {
            this.drive(p, e);
            return;
          }
          if (p.driving) return;
          if (p.pulling === e.id) this.releaseCart(p);
          else if (e.type === 'wagon' && !p.mounted)
            this.game.notice(p, 'Wagons are pulled by a horse: ride up to it and press G.', 'info');
          else if (!e.puller && (e.type === 'wagon' || !p.mounted)) {
            this.releaseCart(p);
            e.puller = p.id;
            p.pulling = e.id;
            this.game.notice(
              p,
              e.type === 'wagon' ? 'Wagon hitched. Press G to unhitch.' : 'Pulling the cart. Press G again to let go.',
              'info',
            );
          }
          return;
        }
        if (e.type === 'truck' && p.slots[p.sel]?.id === 'fuel_oil' && this.fillTank(p, e)) return;
        this.openUi(p, { kind: 'entity', id });
        return;
      }
      if (e.kind === 'creature') {
        if (op === 'grab' && e.def.id === 'horse') {
          this.mount(p, e.id);
          return;
        }
        this.game.farming.collect(p, e);
      }
    }
  }

  openUi(p: Player, target: NonNullable<Player['uiTarget']>): void {
    p.uiTarget = target;
    this.lastUi.delete(p.id);
    this.refreshUi(p, true);
  }

  closeUi(p: Player): void {
    if (!p.uiTarget) return;
    p.uiTarget = null;
    p.ui = null;
    this.lastUi.delete(p.id);
    p.session.send({ t: 'uiclose' });
  }

  buildUi(p: Player): UiState | null {
    const t = p.uiTarget;
    if (!t) return null;
    if (t.kind === 'npc') return this.game.economy.npcUi(p, t.id as string);
    if (t.kind === 'struct') {
      const s = this.game.world.structures.get(t.id as number);
      if (!s) return null;
      const nx = Math.max(s.x, Math.min(p.x, s.x + s.w));
      const ny = Math.max(s.y, Math.min(p.y, s.y + s.h));
      if (Math.hypot(nx - p.x, ny - p.y) > INTERACT_RANGE + 2) return null;
      if (s.def.claimRadius) return this.game.building.claimUi(p, s);
      if (s.def.guardHouse) return this.game.guards.ui(p, s);
      if (s.def.shop) return this.game.economy.shopUi(p, s);
      if (s.machine) return this.game.factory.machineUi(p, s);
      if (s.def.logistics === 'filter') return this.game.factory.machineUi(p, s);
      if (s.store) return { kind: 'container', id: s.id, title: s.def.name, store: s.store };
      if (s.def.station) return { kind: 'station', id: s.id, station: s.def.station };
      return null;
    }
    const e = this.game.entities.get(t.id as number);
    if (!e || Math.hypot(e.x - p.x, e.y - p.y) > INTERACT_RANGE + 2) return null;
    if (e.kind === 'bag') return { kind: 'container', id: e.id, title: `${e.ownerName}'s bag`, store: e.slots, entity: true };
    if (e.kind === 'cart') {
      const what = e.type === 'truck' ? 'motor truck' : e.type === 'wagon' ? 'wagon' : e.type === 'minecart' ? 'minecart' : 'hand cart';
      const tank = e.type === 'truck' ? ` — tank ${tankPct(e)} %` : '';
      return { kind: 'container', id: e.id, title: `${e.ownerName}'s ${what}${tank}`, store: e.slots, entity: true };
    }
    return null;
  }

  refreshUi(p: Player, force = false): void {
    if (!p.uiTarget) return;
    const ui = this.buildUi(p);
    if (!ui) {
      this.closeUi(p);
      return;
    }
    p.ui = ui;
    const json = JSON.stringify({ t: 'ui', ui });
    if (!force && this.lastUi.get(p.id) === json) return;
    this.lastUi.set(p.id, json);
    p.session.sendRaw(json);
  }

  // ——— Carts and horses ———

  private dragCart(p: Player): void {
    const cart = this.game.entities.get(p.pulling);
    if (!cart || cart.kind !== 'cart') {
      p.pulling = 0;
      return;
    }
    const dx = cart.x - p.x;
    const dy = cart.y - p.y;
    const d = Math.hypot(dx, dy);
    const rope = cart.type === 'wagon' ? 2.3 : 1.5;
    if (d > rope) {
      cart.x = p.x + (dx / d) * rope;
      cart.y = p.y + (dy / d) * rope;
    }
    cart.angle = Math.atan2(p.y - cart.y, p.x - cart.x);
    if (d > 6) this.releaseCart(p);
  }

  releaseCart(p: Player): void {
    if (!p.pulling) return;
    const cart = this.game.entities.get(p.pulling);
    if (cart && cart.kind === 'cart') cart.puller = 0;
    p.pulling = 0;
  }

  private mount(p: Player, horseId: number): void {
    if (p.mounted) {
      this.dismount(p);
      return;
    }
    const horse = this.game.entities.get(horseId);
    if (!horse || horse.kind !== 'creature' || horse.rider) return;
    if (horse.owner && horse.owner !== p.accountId && !this.game.companies.sameCompany(p.accountId, horse.owner)) {
      this.game.notice(p, `That horse belongs to ${horse.ownerName}.`, 'bad');
      return;
    }
    this.releaseCart(p);
    horse.rider = p.id;
    p.mounted = horse.id;
    p.move.x = horse.x;
    p.move.y = horse.y;
    this.game.notice(p, 'Riding. Press G to dismount.', 'info');
  }

  dismount(p: Player): void {
    if (p.driving) this.leaveTruck(p);
    if (!p.mounted) return;
    const hitched = p.pulling ? this.game.entities.get(p.pulling) : undefined;
    if (hitched?.kind === 'cart' && hitched.type === 'wagon') this.releaseCart(p);
    const horse = this.game.entities.get(p.mounted);
    if (horse && horse.kind === 'creature') {
      horse.rider = undefined;
      horse.homeX = horse.x;
      horse.homeY = horse.y;
      horse.state = 'idle';
      horse.timer = 20;
    }
    p.mounted = 0;
  }

  // ——— Motor trucks (§36) ———

  private drive(p: Player, truck: Cart): void {
    if (p.driving === truck.id) {
      this.leaveTruck(p);
      return;
    }
    if (truck.driver) {
      this.game.notice(p, 'Someone is already driving it.', 'bad');
      return;
    }
    if (p.dead || p.driving) return;
    if ((truck.fuel ?? 0) <= 0 && !this.refuelFromBed(truck)) {
      this.game.notice(p, 'The tank is empty. Hold fuel oil and press E on the truck to fill it.', 'bad');
      return;
    }
    this.releaseCart(p);
    this.dismount(p);
    truck.driver = p.id;
    p.driving = truck.id;
    p.move.x = truck.x;
    p.move.y = truck.y;
    p.move.vx = p.move.vy = 0;
    this.game.notice(p, 'Driving: fastest on roads. Press G to get out.', 'info');
  }

  leaveTruck(p: Player, why?: string): void {
    const truck = this.game.entities.get(p.driving);
    p.driving = 0;
    if (truck?.kind === 'cart') {
      truck.driver = 0;
      // Step down beside the cab, on whichever side is clear.
      for (const side of [-1, 1]) {
        const x = truck.x + Math.cos(truck.angle + (side * Math.PI) / 2) * 0.95;
        const y = truck.y + Math.sin(truck.angle + (side * Math.PI) / 2) * 0.95;
        if (this.game.world.solidAt(Math.floor(x), Math.floor(y))) continue;
        p.move.x = x;
        p.move.y = y;
        break;
      }
    }
    if (why) this.game.notice(p, why, 'bad');
  }

  /** Moves the truck with its driver and burns fuel for the distance covered. */
  private driveTruck(p: Player): void {
    const truck = this.game.entities.get(p.driving);
    if (!truck || truck.kind !== 'cart' || truck.type !== 'truck') {
      p.driving = 0;
      return;
    }
    const d = Math.hypot(p.x - truck.x, p.y - truck.y);
    if (d > 0.01) truck.angle = Math.atan2(p.y - truck.y, p.x - truck.x);
    truck.x = p.x;
    truck.y = p.y;
    truck.fuel = (truck.fuel ?? 0) - d;
    if (truck.fuel <= 0 && !this.refuelFromBed(truck)) {
      truck.fuel = 0;
      this.leaveTruck(p, 'The truck ran out of fuel oil. Hold fuel oil and press E on it to fill the tank.');
    }
  }

  /** Tops up an empty tank with one fuel oil carried in the truck's bed. */
  private refuelFromBed(truck: Cart): boolean {
    const i = truck.slots.findIndex((x) => x?.id === 'fuel_oil');
    if (i < 0) return false;
    const stack = truck.slots[i]!;
    stack.n -= 1;
    if (stack.n <= 0) truck.slots[i] = null;
    truck.fuel = (truck.fuel ?? 0) + TRUCK_TILES_PER_FUEL;
    return true;
  }

  /** Pours held fuel oil into the tank; false (so E opens the bed instead) when it is already full. */
  private fillTank(p: Player, truck: Cart): boolean {
    const held = p.slots[p.sel];
    if (!held || held.id !== 'fuel_oil') return false;
    const room = Math.floor((TRUCK_TANK * TRUCK_TILES_PER_FUEL - (truck.fuel ?? 0)) / TRUCK_TILES_PER_FUEL);
    if (room <= 0) return false;
    const n = Math.min(room, held.n);
    held.n -= n;
    if (held.n <= 0) p.slots[p.sel] = null;
    truck.fuel = (truck.fuel ?? 0) + n * TRUCK_TILES_PER_FUEL;
    p.invDirty = true;
    this.game.notice(p, `Poured ${n} fuel oil into the tank (${tankPct(truck)} %).`, 'good');
    this.game.emit(['sfx', 'pickup', Math.round(truck.x * 100), Math.round(truck.y * 100)], truck.x, truck.y, { r: 12 });
    return true;
  }

  /** Radius used for hits against players. */
  radius(): number {
    return PLAYER_RADIUS;
  }

  isFarmAnimal(type: string): boolean {
    return CREATURE_BY_ID.get(type)?.temperament === 'farm';
  }
}
