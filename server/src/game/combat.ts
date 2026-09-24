// Combat resolution (design plan §7–11): lag-compensated hitscan firearms with pellets,
// penetration and headshots, melee arcs with multi-target hits and knockdowns, shoves that
// interrupt attacks, and zombie attacks that inflict wounds on body parts.

import {
  angleDelta,
  Block,
  HitFlags,
  HitKind,
  IMPACT_FLESH,
  IMPACT_MATERIALS,
  IMPACT_NONE,
  inflictWound,
  NetEventType,
  PLAYER_RADIUS,
  randomBodyPart,
  rayCircle,
  SHOVE,
  SHOVE_ITEM,
  ZOMBIE_RADIUS,
  type MeleeDef,
  type PlayerInput,
  type PlayerSimState,
  type ShotPellet,
  type WeaponProfile,
  type WoundType,
} from '@tuff/shared';
import { Body, Player, Transform, Zombie, type PlayerComp, type ZombieComp } from './components';
import type { Game } from './game';

interface Target {
  id: number;
  x: number;
  y: number;
  radius: number;
  zombie: ZombieComp | undefined;
  player: PlayerComp | undefined;
}

export class Combat {
  constructor(private readonly game: Game) {}

  /** Entities that bullets and swings can hit, rewound to what the attacker saw. */
  private targetsNear(attacker: number, x: number, y: number, radius: number, viewTick: number): Target[] {
    const { ecs, lag } = this.game;
    const out: Target[] = [];
    for (const id of this.game.spatial.query(x, y, radius + 2)) {
      if (id === attacker) continue;
      const zombie = ecs.get(id, Zombie);
      const player = ecs.get(id, Player);
      if (!zombie && !(player && this.game.config.pvp && player.body.health > 0)) continue;
      const t = ecs.get(id, Transform)!;
      const past = lag.positionAt(id, viewTick) ?? t;
      out.push({ id, x: past.x, y: past.y, radius: ecs.get(id, Body)?.radius ?? ZOMBIE_RADIUS, zombie, player });
    }
    return out;
  }

  fire(shooter: number, p: PlayerComp, s: PlayerSimState, weapon: WeaponProfile, angles: number[], input: PlayerInput): void {
    const firearm = weapon.firearm!;
    const game = this.game;
    const collision = game.world.compiled.collision;
    const muzzle = 0.45;
    const ox = s.x + Math.cos(s.aim) * muzzle;
    const oy = s.y + Math.sin(s.aim) * muzzle;
    const range = firearm.range;
    const cond = this.heldCondition(p);
    const candidates = this.targetsNear(
      shooter,
      s.x + Math.cos(s.aim) * range * 0.5,
      s.y + Math.sin(s.aim) * range * 0.5,
      range * 0.55 + 4,
      input.viewTick,
    );
    const pellets: ShotPellet[] = [];
    const brokenWindows = new Set<string>();
    for (const angle of angles) {
      const dx = Math.cos(angle);
      const dy = Math.sin(angle);
      // Static geometry: glass is shot through (and shattered); anything else stops the round.
      let stopDist = range;
      let impact = IMPACT_NONE;
      const glass: { id: string; distance: number }[] = [];
      for (const hit of collision.raycastAll(ox, oy, dx, dy, range, Block.Bullet)) {
        const oid = hit.collider.objectId;
        if (oid && game.world.compiled.windows.has(oid)) {
          glass.push({ id: oid, distance: hit.distance });
          continue;
        }
        stopDist = hit.distance;
        impact = 2 + Math.max(0, IMPACT_MATERIALS.indexOf(hit.collider.material as (typeof IMPACT_MATERIALS)[number]));
        break;
      }
      // Bodies along the ray, nearest first.
      const hits: { target: Target; t: number; perp: number }[] = [];
      for (const target of candidates) {
        const t = rayCircle(ox, oy, dx, dy, target.x, target.y, target.radius);
        if (t === null || t > stopDist) continue;
        const cx = target.x - ox;
        const cy = target.y - oy;
        const perp = Math.abs(cx * dy - cy * dx);
        hits.push({ target, t, perp });
      }
      hits.sort((a, b) => a.t - b.t);
      let damage = firearm.damage * (0.75 + 0.25 * cond);
      let penetrated = 0;
      let lastHit = stopDist;
      for (const h of hits) {
        if (penetrated >= firearm.penetration) break;
        const falloff = h.t > range * 0.6 ? 1 - ((h.t - range * 0.6) / (range * 0.4)) * 0.5 : 1;
        // Top-down headshots: rounds passing close to the centre of the silhouette hit the head.
        const headshot = h.perp < h.target.radius * 0.38;
        const mult = headshot ? (firearm.headshotMultiplier ?? 2) : 1;
        this.damageTarget(
          h.target,
          damage * falloff * mult,
          dx,
          dy,
          firearm.knockback,
          HitKind.Bullet,
          shooter,
          headshot ? HitFlags.Headshot : 0,
          ox + dx * h.t,
          oy + dy * h.t,
        );
        penetrated++;
        damage *= 0.65;
        lastHit = h.t;
      }
      // A round that spent all its penetration stops in the last body; otherwise it carries on.
      const stoppedInBody = penetrated >= firearm.penetration;
      const endDist = stoppedInBody ? lastHit : stopDist;
      for (const g of glass) if (g.distance < endDist) brokenWindows.add(g.id);
      pellets.push({ angle, distance: endDist, impact: stoppedInBody ? IMPACT_FLESH : impact });
    }
    for (const id of brokenWindows) game.damageObject(id, 999, shooter, 'window_break');
    game.noise.emit(s.x, s.y, firearm.noise, shooter);
    game.event(
      { type: NetEventType.Shot, shooter, item: game.content.itemIndex(weapon.itemId!) + 1, x: ox, y: oy, pellets },
      s.x,
      s.y,
      260,
    );
    this.wearHeld(p, 1);
  }

  melee(
    attacker: number,
    p: PlayerComp,
    s: PlayerSimState,
    weapon: WeaponProfile,
    angle: number,
    input: PlayerInput,
    shove: boolean,
  ): void {
    const def: MeleeDef = shove ? SHOVE : weapon.melee!;
    const game = this.game;
    const collision = game.world.compiled.collision;
    const exhausted = s.exhausted;
    const cond = shove || !weapon.itemId ? 1 : this.heldCondition(p);
    const halfArc = ((def.arc / 2) * Math.PI) / 180;
    const targets = this.targetsNear(attacker, s.x, s.y, def.reach + 1, input.viewTick)
      .map((t) => ({ t, d: Math.hypot(t.x - s.x, t.y - s.y) - t.radius }))
      .filter(({ t, d }) => d <= def.reach && Math.abs(angleDelta(angle, Math.atan2(t.y - s.y, t.x - s.x))) <= halfArc)
      .filter(({ t }) => collision.lineOfSight(s.x, s.y, t.x, t.y, Block.Bullet))
      .sort((a, b) => a.d - b.d)
      .slice(0, def.maxTargets);
    for (const { t } of targets) {
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      const len = Math.hypot(dx, dy) || 1;
      let damage = def.damage * (exhausted ? 0.7 : 1) * (0.7 + 0.3 * cond);
      if (!shove && t.zombie?.state === 'down') damage *= 2;
      const knockback = def.knockback * (exhausted ? 0.55 : 1);
      const kind = shove ? HitKind.Shove : def.damageType === 'sharp' ? HitKind.Sharp : HitKind.Blunt;
      let flags = 0;
      if (t.zombie) {
        const knockChance = def.knockdown * (1 - t.zombie.arch.stability * 0.6) * (exhausted ? 0.45 : 1);
        if (game.rng.chance(knockChance)) flags |= HitFlags.Knockdown;
      }
      this.damageTarget(
        t,
        damage,
        dx / len,
        dy / len,
        knockback,
        kind,
        attacker,
        flags,
        t.x - (dx / len) * t.radius,
        t.y - (dy / len) * t.radius,
        shove ? 0.6 : 0.35,
      );
    }
    // Swinging at a door or window damages it.
    if (targets.length === 0 && !shove) {
      const hit = collision.raycast(s.x, s.y, Math.cos(angle), Math.sin(angle), def.reach + 0.2, Block.Player);
      const oid = hit?.collider.objectId;
      if (oid) {
        const obj = game.world.compiled.object(oid);
        if (obj?.kind === 'door') game.damageObject(oid, def.damage * (def.structureDamage ?? 1), attacker, 'door_bang');
        else if (obj?.kind === 'window') game.damageObject(oid, 999, attacker, 'window_break');
      }
    }
    game.noise.emit(s.x, s.y, targets.length > 0 ? def.noise : def.noise * 0.3, attacker);
    const item = shove ? SHOVE_ITEM : weapon.itemId ? game.content.itemIndex(weapon.itemId) + 1 : 0;
    game.event({ type: NetEventType.Melee, attacker, item, angle, hits: targets.length }, s.x, s.y, 60);
    if (!shove && weapon.itemId && targets.length > 0) this.wearHeld(p, targets.length);
  }

  private damageTarget(
    t: Target,
    damage: number,
    dirX: number,
    dirY: number,
    knockback: number,
    kind: number,
    attacker: number,
    flags: number,
    hx: number,
    hy: number,
    stagger = 0.3,
  ): void {
    if (t.zombie) this.damageZombie(t.id, t.zombie, damage, dirX, dirY, knockback, kind, attacker, flags, hx, hy, stagger);
    else if (t.player) this.damagePlayerPvp(t.id, t.player, damage, dirX, dirY, kind, attacker, hx, hy);
  }

  damageZombie(
    id: number,
    z: ZombieComp,
    damage: number,
    dirX: number,
    dirY: number,
    knockback: number,
    kind: number,
    attacker: number,
    flags: number,
    hx: number,
    hy: number,
    stagger: number,
  ): void {
    const game = this.game;
    z.hp -= damage;
    z.knockX += dirX * knockback;
    z.knockY += dirY * knockback;
    const dir = Math.atan2(dirY, dirX);
    if (z.hp <= 0) {
      game.event(
        { type: NetEventType.Hit, target: id, x: hx, y: hy, dir, kind, flags: flags | HitFlags.Kill, source: attacker },
        hx,
        hy,
        80,
      );
      game.killZombie(id, attacker, dir);
      return;
    }
    if (flags & HitFlags.Knockdown) {
      z.state = 'down';
      z.stateTimer = game.rng.range(1.6, 2.8);
      z.path = null;
    } else if (kind === HitKind.Shove || damage > z.maxHp * 0.18) {
      if (z.state !== 'down' && z.state !== 'rise') {
        z.state = 'stagger';
        z.stateTimer = stagger * game.rng.range(0.8, 1.2);
      }
    }
    // Being hurt makes a zombie fight back.
    if (game.ecs.has(attacker, Player) && z.state !== 'down') {
      z.target = attacker;
      z.lostTimer = 0;
      if (z.state !== 'stagger') game.zombies.startChase(id, z, attacker);
    }
    game.event({ type: NetEventType.Hit, target: id, x: hx, y: hy, dir, kind, flags, source: attacker }, hx, hy, 80);
  }

  private damagePlayerPvp(
    id: number,
    p: PlayerComp,
    damage: number,
    dirX: number,
    dirY: number,
    kind: number,
    attacker: number,
    hx: number,
    hy: number,
  ): void {
    const game = this.game;
    const type: WoundType =
      kind === HitKind.Bullet ? 'gunshot' : kind === HitKind.Sharp ? 'cut' : kind === HitKind.Shove ? 'bruise' : 'bruise';
    const scale = kind === HitKind.Bullet ? damage / 30 : damage / 25;
    inflictWound(p.body, randomBodyPart(game.rng), type, game.rng, Math.max(0.3, scale));
    p.statusDirty = true;
    game.event(
      { type: NetEventType.Hit, target: id, x: hx, y: hy, dir: Math.atan2(dirY, dirX), kind, flags: 0, source: attacker },
      hx,
      hy,
      80,
    );
    game.soundAt('player_hurt', hx, hy, 0.8, id);
    if (p.body.health <= 0) game.killPlayer(id, `Killed by ${game.ecs.get(attacker, Player)?.name ?? 'another survivor'}`);
  }

  zombieHitsPlayer(zombie: number, z: ZombieComp, target: number): void {
    const game = this.game;
    const p = game.ecs.get(target, Player);
    const pt = game.ecs.get(target, Transform);
    const zt = game.ecs.get(zombie, Transform);
    if (!p || !pt || !zt) return;
    // Surrounded or exhausted survivors are more likely to be bitten.
    let nearby = 0;
    for (const id of game.spatial.query(pt.x, pt.y, 1.6)) if (game.ecs.has(id, Zombie)) nearby++;
    const biteChance = 0.16 + (nearby >= 3 ? 0.12 : 0) + (p.sim.exhausted ? 0.1 : 0);
    const r = game.rng.next();
    const type: WoundType = r < biteChance ? 'bite' : r < biteChance + 0.3 ? 'cut' : r < 0.93 ? 'scratch' : 'bruise';
    const part = randomBodyPart(game.rng);
    inflictWound(p.body, part, type, game.rng, z.damageScale);
    p.statusDirty = true;
    const dir = Math.atan2(pt.y - zt.y, pt.x - zt.x);
    game.event(
      {
        type: NetEventType.Hit,
        target,
        x: pt.x,
        y: pt.y,
        dir,
        kind: type === 'bite' ? HitKind.Bite : type === 'bruise' ? HitKind.Blunt : HitKind.Scratch,
        flags: 0,
        source: zombie,
      },
      pt.x,
      pt.y,
      80,
    );
    game.soundAt('player_hurt', pt.x, pt.y, 0.9, target);
    if (p.body.health <= 0) game.killPlayer(target, type === 'bite' ? 'Bitten to death' : 'Torn apart by the dead');
  }

  private heldCondition(p: PlayerComp): number {
    const held = p.inventory.slots[p.sim.slot];
    return held?.cond ?? 1;
  }

  /** Degrades the held weapon; melee weapons break at zero condition. */
  private wearHeld(p: PlayerComp, uses: number): void {
    const held = p.inventory.slots[p.sim.slot];
    if (!held) return;
    const def = this.game.content.findItem(held.id);
    if (!def?.durability) return;
    held.cond = Math.max(0, (held.cond ?? 1) - uses / def.durability);
    if (def.firearm) held.cond = Math.max(0.05, held.cond);
    else if (held.cond <= 0) {
      p.inventory.slots[p.sim.slot] = null;
      this.game.notify(p, `Your ${def.name.toLowerCase()} breaks!`, 'warn');
    }
    p.inventoryDirty = true;
  }
}

export { PLAYER_RADIUS };
