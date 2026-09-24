// Sleep and crafting (design plan §21–22, §57–58).
//
// Sleep happens in real time — the world is shared, so nobody can skip the night alone. A sleeping
// survivor lies still, regains energy (fastest in a bed), heals faster and gets hungry more slowly.
// They wake when rested, hurt, starving or when a zombie comes close. When every survivor online
// is asleep, the world clock runs faster so a night passes in a couple of minutes.
//
// Cooking and crafting are recipes: ingredients, tools and sometimes a station (a stove or lit
// fire for cooking, a workbench for carpentry). The work is a timed action; ingredients are only
// consumed when it completes.

import {
  bleedRate,
  checkRecipe,
  GROUND_SLEEP_QUALITY,
  INTERACT_RANGE,
  planConsumption,
  sleepProblem,
  type ItemStack,
  type StationKind,
} from '@tuff/shared';
import { Player, Transform, Zombie, type PlayerComp } from './components';
import type { Game } from './game';
import { newUid } from './loot';

/** Default world clock multiplier while everyone online sleeps. */
const DEFAULT_FAST_FORWARD = 8;

export class SurvivalSystem {
  constructor(private readonly game: Game) {}

  // =============================================================================================
  // Sleep

  get fastForward(): number {
    return this.game.config.sleep?.fastForward ?? DEFAULT_FAST_FORWARD;
  }

  /** True when at least one survivor is online and all of them are asleep. */
  everyoneAsleep(): boolean {
    let any = false;
    for (const e of this.game.ecs.query(Player)) {
      const p = this.game.ecs.get(e, Player)!;
      if (!p.link?.connected) continue;
      if (!p.sleep) return false;
      any = true;
    }
    return any;
  }

  /** Starts sleeping in a bed or couch (`target`), or on the floor. */
  sleep(e: number, p: PlayerComp, target?: string): string | null {
    if (p.sleep) return null;
    if (p.action) return 'You are busy.';
    const game = this.game;
    const t = game.ecs.get(e, Transform)!;
    let quality = GROUND_SLEEP_QUALITY;
    let spot: string | null = null;
    let where = 'on the floor';
    if (target) {
      const bed = game.world.compiled.beds.get(target);
      if (!bed) return 'You cannot sleep there.';
      if (Math.hypot(bed.x - t.x, bed.y - t.y) > INTERACT_RANGE + bed.radius) return 'Too far away.';
      for (const other of game.ecs.query(Player)) {
        if (other !== e && game.ecs.get(other, Player)!.sleep?.spot === bed.id) return 'Someone is already sleeping there.';
      }
      quality = bed.quality;
      spot = bed.id;
      where = `in the ${bed.name.toLowerCase()}`;
    }
    const problem = sleepProblem(p.body, p.needs, game.minutes);
    if (problem) return problem;
    if (this.zombiesNear(t.x, t.y, 14, false)) return 'You cannot sleep with the dead this close.';
    p.sleep = { quality, spot, health: p.body.health, elapsed: 0 };
    p.flashlight = false;
    p.openContainer = null;
    p.refreshTimer = 0;
    game.notify(p, `You lie down ${where} and drift off…`, 'info');
    return null;
  }

  wake(p: PlayerComp, message: string | null, level: 'info' | 'good' | 'warn' = 'info'): void {
    if (!p.sleep) return;
    p.sleep = null;
    p.refreshTimer = 0;
    if (message) this.game.notify(p, message, level);
  }

  /** Per-tick sleep bookkeeping: wake-up conditions. */
  update(dt: number): void {
    const game = this.game;
    for (const e of game.ecs.query(Player, Transform)) {
      const p = game.ecs.get(e, Player)!;
      const s = p.sleep;
      if (!s) continue;
      s.elapsed += dt;
      const t = game.ecs.get(e, Transform)!;
      if (p.body.health > s.health) s.health = p.body.health;
      if (p.body.health < s.health - 1) this.wake(p, 'You wake with a start — you are hurt!', 'warn');
      else if (s.elapsed > 1 && this.zombiesNear(t.x, t.y, 9, true)) this.wake(p, 'Something wakes you. You are not alone.', 'warn');
      else if (bleedRate(p.body) > 0.05) this.wake(p, 'You wake up bleeding.', 'warn');
      else if (p.needs.hunger < 8 || p.needs.thirst < 8)
        this.wake(p, p.needs.thirst < 8 ? 'Thirst wakes you.' : 'Hunger wakes you.', 'warn');
      else if (p.needs.energy >= 99.5) this.wake(p, 'You wake up rested.', 'good');
    }
  }

  /**
   * Zombies close enough to matter: any within `radius`, or (when `hunting`) any within a third of
   * it plus those actively chasing, attacking or breaking in within `radius`.
   */
  private zombiesNear(x: number, y: number, radius: number, hunting: boolean): boolean {
    const game = this.game;
    for (const id of game.spatial.query(x, y, radius)) {
      const z = game.ecs.get(id, Zombie);
      const zt = game.ecs.get(id, Transform);
      if (!z || !zt || z.state === 'down') continue;
      const d = Math.hypot(zt.x - x, zt.y - y);
      if (d > radius) continue;
      if (!hunting) return true;
      if (d < radius / 3 || z.state === 'chase' || z.state === 'attack' || z.state === 'bang') return true;
    }
    return false;
  }

  // =============================================================================================
  // Crafting and cooking

  /** Station kinds within reach (fires count only while lit). */
  stationsNear(e: number): Set<StationKind> {
    const game = this.game;
    const out = new Set<StationKind>();
    const t = game.ecs.get(e, Transform);
    if (!t) return out;
    for (const st of game.world.compiled.stations.values()) {
      if (Math.abs(st.x - t.x) > 6 || Math.abs(st.y - t.y) > 6) continue;
      if (Math.hypot(st.x - t.x, st.y - t.y) > INTERACT_RANGE + st.radius) continue;
      if (st.fire && game.world.compiled.effectiveState(st.id).until <= game.minutes) continue;
      out.add(st.kind);
    }
    return out;
  }

  beginCraft(e: number, p: PlayerComp, recipeId: string): string | null {
    const game = this.game;
    const recipe = game.content.findRecipe(recipeId);
    if (!recipe) return 'Unknown recipe.';
    if (p.action) return 'You are busy.';
    const check = checkRecipe(game.content, p.inventory, recipe, this.stationsNear(e));
    if (!check.ok) return check.problem;
    const verb = recipe.category === 'cooking' ? 'Cooking' : 'Making';
    game.startAction(e, p, { kind: 'craft', label: `${verb} ${recipe.name}`, duration: recipe.time, target: '', recipe: recipe.id });
    if (recipe.station === 'heat') game.sound('sizzle', e, 0.5);
    else if (recipe.category === 'carpentry') game.sound('hammer', e, 0.5);
    return null;
  }

  finishCraft(e: number, p: PlayerComp, recipeId: string): string | null {
    const game = this.game;
    const recipe = game.content.findRecipe(recipeId);
    if (!recipe) return null;
    const check = checkRecipe(game.content, p.inventory, recipe, this.stationsNear(e));
    if (!check.ok) return check.problem;
    const plan = planConsumption(game.content, p.inventory, recipe.inputs);
    if (!plan) return 'You are missing something.';
    for (const { uid, qty } of plan) game.inventory.consumeUnits(p, uid, qty);
    const t = game.ecs.get(e, Transform);
    for (const out of recipe.outputs) {
      const def = game.content.findItem(out.item);
      if (!def) continue;
      let left = out.qty;
      while (left > 0) {
        const qty = Math.min(left, def.stackSize);
        left -= qty;
        const stack: ItemStack = { uid: newUid(), id: def.id, qty };
        if (def.durability) stack.cond = 1;
        if (!game.inventory.autoPlace(p, stack) && t) game.spawnGroundItem(t.x, t.y, stack);
      }
    }
    game.noise.emit(t?.x ?? 0, t?.y ?? 0, recipe.category === 'carpentry' ? 10 : 3, e);
    const made = recipe.outputs[0];
    const name = game.content.findItem(made.item)?.name ?? recipe.name;
    return `You make ${made.qty > 1 ? `${made.qty} × ` : ''}${name}.`;
  }
}
