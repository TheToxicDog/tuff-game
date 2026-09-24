// Zombie behaviour (design plan §12–15): mixed speeds, sight that depends on distance, light,
// movement and obstacles, investigation of noises, chasing with pathfinding, telegraphed attacks,
// banging on doors and windows, stagger and knockdown.

import { angleDelta, approachAngle, Block, daylight, PLAYER_RADIUS, ZOMBIE_RADIUS, ZombieAnim } from '@tuff/shared';
import { Player, Transform, Zombie, type Transform as TransformT, type ZombieComp } from './components';
import type { Game } from './game';
import { NAV_CELL } from './navigation';

const FOV_HALF = (75 * Math.PI) / 180;
const ATTACK_REACH = ZOMBIE_RADIUS + PLAYER_RADIUS + 0.55;
const PATH_BUDGET_PER_TICK = 6;

export function zombieAnim(z: ZombieComp): number {
  switch (z.state) {
    case 'idle':
      return ZombieAnim.Idle;
    case 'wander':
    case 'investigate':
      return ZombieAnim.Walk;
    case 'chase':
      return ZombieAnim.Chase;
    case 'attack':
      return ZombieAnim.Attack;
    case 'stagger':
      return ZombieAnim.Stagger;
    case 'down':
      return ZombieAnim.Down;
    case 'rise':
      return ZombieAnim.Rise;
    case 'bang':
      return ZombieAnim.Bang;
  }
}

/** True while a zombie is actively engaged with its target. */
function isEngaged(z: ZombieComp): boolean {
  return z.state === 'chase' || z.state === 'attack' || z.state === 'stagger';
}

export class ZombieSystem {
  private readonly pathQueue: number[] = [];
  private readonly neighbours: number[] = [];

  constructor(private readonly game: Game) {}

  update(dt: number): void {
    const { ecs } = this.game;
    const light = daylight(this.game.hour);
    for (const e of ecs.query(Zombie, Transform)) {
      const z = ecs.get(e, Zombie)!;
      const t = ecs.get(e, Transform)!;
      z.attackCooldown = Math.max(0, z.attackCooldown - dt);
      z.repathTimer -= dt;
      z.interest *= Math.exp(-dt / 12);
      this.perceive(e, z, t, dt, light);
      this.think(e, z, t, dt);
      this.move(e, z, t, dt);
    }
    // Pathfinding budget: a few searches per tick, oldest requests first.
    for (let i = 0; i < PATH_BUDGET_PER_TICK && this.pathQueue.length > 0; i++) {
      const e = this.pathQueue.shift()!;
      const z = ecs.get(e, Zombie);
      const t = ecs.get(e, Transform);
      if (!z || !t) continue;
      z.pathPending = false;
      const goal = this.goalOf(z);
      if (!goal) continue;
      z.path = this.game.nav.findPath(t.x, t.y, goal.x, goal.y);
      z.pathIndex = 0;
      z.repathTimer = z.state === 'chase' ? 1.2 : 4;
    }
  }

  // --- Perception ----------------------------------------------------------------------------

  private perceive(e: number, z: ZombieComp, t: TransformT, dt: number, light: number): void {
    if (z.state === 'down' || z.state === 'rise') return;
    if (z.state === 'chase') z.lostTimer += dt;
    z.perceptionTimer -= dt;
    if (z.perceptionTimer > 0) return;
    const interval = 0.25 + this.game.rng.next() * 0.15;
    z.perceptionTimer = interval;
    const { ecs } = this.game;
    const maxRange = z.arch.sightRange * 1.3;
    let bestId = 0;
    let bestRate = 0;
    for (const id of this.game.spatial.query(t.x, t.y, maxRange)) {
      const p = ecs.get(id, Player);
      const pt = ecs.get(id, Transform);
      if (!p || !pt || p.body.health <= 0) continue;
      const dx = pt.x - t.x;
      const dy = pt.y - t.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const lightLevel = Math.max(light, p.flashlight ? 0.85 : 0);
      let range = z.arch.sightRange * (0.3 + 0.7 * lightLevel);
      if (p.sim.crouching) range *= 0.6;
      const speed = Math.hypot(p.sim.vx, p.sim.vy);
      if (speed < 0.3) range *= 0.8;
      if (p.sim.sprinting) range *= 1.2;
      const tracking = z.target === id && isEngaged(z);
      if (tracking) range *= 1.4;
      if (d > range) continue;
      const close = d < 2.2;
      if (!close && !tracking && Math.abs(angleDelta(t.angle, Math.atan2(dy, dx))) > FOV_HALF) continue;
      if (!this.game.world.compiled.collision.lineOfSight(t.x, t.y, pt.x, pt.y, Block.Sight)) continue;
      let rate = 3 * Math.pow(1 - d / range, 1.4) * (p.sim.sprinting ? 1.6 : 1) * (p.sim.crouching ? 0.5 : 1);
      if (close) rate += 10;
      if (tracking) rate += 20;
      if (rate > bestRate) {
        bestRate = rate;
        bestId = id;
      }
    }
    if (!bestId) {
      z.awareness = Math.max(0, z.awareness - interval * 0.5);
      return;
    }
    const target = ecs.get(bestId, Transform)!;
    if (z.target === bestId && isEngaged(z)) {
      // Already after this player (chasing, mid-attack or staggered): just keep tracking.
      z.lostTimer = 0;
      z.goalX = target.x;
      z.goalY = target.y;
      return;
    }
    if (z.awarenessTarget !== bestId) {
      z.awarenessTarget = bestId;
      z.awareness = 0;
    }
    z.awareness += bestRate * interval;
    if (z.awareness >= 1) this.startChase(e, z, bestId);
    else if (z.state === 'idle' || z.state === 'wander') {
      // Something caught its eye: turn and shuffle toward it.
      z.goalX = target.x;
      z.goalY = target.y;
      z.state = 'investigate';
      z.stateTimer = 6;
      z.interest = Math.max(z.interest, 5);
    }
  }

  startChase(e: number, z: ZombieComp, target: number): void {
    // Never interrupt a fall or an attack that is already winding up.
    if (z.state === 'down' || z.state === 'rise' || (z.state === 'attack' && z.target === target)) return;
    const t = this.game.ecs.get(target, Transform);
    if (!t) return;
    const wasChasing = z.state === 'chase';
    z.state = 'chase';
    z.target = target;
    z.lostTimer = 0;
    z.goalX = t.x;
    z.goalY = t.y;
    z.path = null;
    z.awareness = 1;
    if (!wasChasing && this.game.rng.chance(0.6)) {
      const zt = this.game.ecs.get(e, Transform)!;
      this.game.soundAt('zombie_alert', zt.x, zt.y, 0.9, e);
      this.game.noise.emit(zt.x, zt.y, 10, e);
    }
  }

  // --- Decisions -----------------------------------------------------------------------------

  private think(e: number, z: ZombieComp, t: TransformT, dt: number): void {
    const game = this.game;
    switch (z.state) {
      case 'down':
        z.stateTimer -= dt;
        if (z.stateTimer <= 0) {
          z.state = 'rise';
          z.stateTimer = 0.9;
        }
        return;
      case 'rise':
      case 'stagger':
        z.stateTimer -= dt;
        if (z.stateTimer <= 0) z.state = z.target && game.ecs.isAlive(z.target) ? 'chase' : 'investigate';
        return;
      case 'attack': {
        z.stateTimer -= dt;
        const target = game.ecs.get(z.target, Transform);
        if (target) t.angle = approachAngle(t.angle, Math.atan2(target.y - t.y, target.x - t.x), 4 * dt);
        if (z.stateTimer <= 0) {
          this.resolveAttack(e, z, t);
          z.attackCooldown = z.arch.attackCooldown * this.game.rng.range(0.85, 1.15);
          z.state = 'chase';
        }
        return;
      }
      case 'bang':
        this.bang(e, z, t, dt);
        return;
      case 'chase': {
        const p = game.ecs.get(z.target, Player);
        const pt = game.ecs.get(z.target, Transform);
        if (!p || !pt || p.body.health <= 0) {
          z.target = 0;
          z.state = 'investigate';
          z.stateTimer = 10;
          return;
        }
        if (z.lostTimer > 7) {
          z.state = 'investigate';
          z.stateTimer = 12;
          z.interest = 15;
          z.target = 0;
          return;
        }
        const d = Math.hypot(pt.x - t.x, pt.y - t.y);
        if (d <= ATTACK_REACH && z.attackCooldown <= 0 && game.world.compiled.collision.lineOfSight(t.x, t.y, pt.x, pt.y, Block.Player)) {
          z.state = 'attack';
          z.stateTimer = z.arch.attackWindup;
          game.soundAt('zombie_attack', t.x, t.y, 0.8, e);
          return;
        }
        this.groan(e, z, t, dt, 3, 7);
        return;
      }
      case 'investigate': {
        z.stateTimer -= dt;
        this.groan(e, z, t, dt, 6, 14);
        if (Math.hypot(z.goalX - t.x, z.goalY - t.y) < 1.4 || z.stateTimer <= 0) {
          z.state = 'idle';
          z.stateTimer = game.rng.range(3, 9);
          z.path = null;
        }
        return;
      }
      case 'wander':
        z.stateTimer -= dt;
        if (Math.hypot(z.goalX - t.x, z.goalY - t.y) < 0.8 || z.stateTimer <= 0) {
          z.state = 'idle';
          z.stateTimer = game.rng.range(4, 12);
        }
        return;
      case 'idle':
        z.stateTimer -= dt;
        if (game.rng.chance(dt * 0.15)) t.angle += game.rng.range(-1, 1);
        if (z.stateTimer <= 0) {
          for (let i = 0; i < 6; i++) {
            const a = game.rng.range(0, Math.PI * 2);
            const r = game.rng.range(2, 7);
            const gx = t.x + Math.cos(a) * r;
            const gy = t.y + Math.sin(a) * r;
            if (game.nav.walkable(gx, gy) && game.world.inBounds(gx, gy, 3)) {
              z.goalX = gx;
              z.goalY = gy;
              z.state = 'wander';
              z.stateTimer = 12;
              z.path = null;
              break;
            }
          }
          if (z.state === 'idle') z.stateTimer = game.rng.range(3, 8);
        }
        return;
    }
  }

  private groan(e: number, z: ZombieComp, t: TransformT, dt: number, min: number, max: number): void {
    z.groanTimer -= dt;
    if (z.groanTimer > 0) return;
    z.groanTimer = this.game.rng.range(min, max);
    this.game.soundAt('zombie_groan', t.x, t.y, 0.7, e);
    // Groaning zombies draw nearby zombies along — hordes form this way.
    this.game.noise.emit(t.x, t.y, z.state === 'chase' ? 11 : 6, e);
  }

  private resolveAttack(e: number, z: ZombieComp, t: TransformT): void {
    const game = this.game;
    const pt = game.ecs.get(z.target, Transform);
    const p = game.ecs.get(z.target, Player);
    if (!pt || !p || p.body.health <= 0) return;
    const dx = pt.x - t.x;
    const dy = pt.y - t.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    // Players who back off or sidestep during the wind-up avoid the hit.
    if (d > ATTACK_REACH + 0.25) return;
    if (Math.abs(angleDelta(t.angle, Math.atan2(dy, dx))) > (70 * Math.PI) / 180) return;
    if (!game.world.compiled.collision.lineOfSight(t.x, t.y, pt.x, pt.y, Block.Player)) return;
    game.combat.zombieHitsPlayer(e, z, z.target);
  }

  private bang(e: number, z: ZombieComp, t: TransformT, dt: number): void {
    const game = this.game;
    const id = z.bangTarget;
    const obj = id ? game.world.compiled.object(id) : undefined;
    z.stateTimer -= dt;
    if (!id || !obj || obj.kind === 'container') {
      z.state = 'investigate';
      return;
    }
    const s = game.world.compiled.effectiveState(id);
    const passable = obj.kind === 'door' ? s.open || s.broken : s.broken;
    if (passable || z.stateTimer <= 0 || Math.hypot(obj.x - t.x, obj.y - t.y) > 2.2) {
      z.bangTarget = null;
      z.state = z.target && game.ecs.isAlive(z.target) ? 'chase' : 'investigate';
      z.stateTimer = 10;
      z.path = null;
      return;
    }
    t.angle = approachAngle(t.angle, Math.atan2(obj.y - t.y, obj.x - t.x), 5 * dt);
    if (z.attackCooldown <= 0) {
      z.attackCooldown = z.arch.attackCooldown * game.rng.range(1.0, 1.4);
      const damage = game.rng.range(5, 10) * (0.7 + z.arch.stability);
      game.damageObject(id, damage, e, obj.kind === 'door' ? 'door_bang' : 'window_break');
    }
  }

  // --- Movement ------------------------------------------------------------------------------

  private goalOf(z: ZombieComp): { x: number; y: number } | null {
    if (z.state === 'chase') {
      const pt = this.game.ecs.get(z.target, Transform);
      return pt ? { x: pt.x, y: pt.y } : null;
    }
    if (z.state === 'investigate' || z.state === 'wander') return { x: z.goalX, y: z.goalY };
    return null;
  }

  private desiredSpeed(z: ZombieComp): number {
    switch (z.state) {
      case 'chase':
        return z.chaseSpeed;
      case 'investigate':
        return Math.min(z.chaseSpeed, z.walkSpeed * 1.35);
      case 'wander':
        return z.walkSpeed * 0.7;
      default:
        return 0;
    }
  }

  private requestPath(e: number, z: ZombieComp): void {
    if (z.pathPending) return;
    z.pathPending = true;
    this.pathQueue.push(e);
  }

  private move(e: number, z: ZombieComp, t: TransformT, dt: number): void {
    const game = this.game;
    const collision = game.world.compiled.collision;
    const speed = this.desiredSpeed(z);
    let dirX = 0;
    let dirY = 0;
    const goal = speed > 0 ? this.goalOf(z) : null;
    if (goal) {
      let wx = goal.x;
      let wy = goal.y;
      const direct = Math.hypot(goal.x - t.x, goal.y - t.y) < 1.2 || collision.lineOfSight(t.x, t.y, goal.x, goal.y, Block.Zombie);
      if (direct) {
        z.path = null;
      } else {
        if (!z.path || z.repathTimer <= 0) this.requestPath(e, z);
        if (z.path && z.pathIndex * 2 < z.path.length) {
          wx = z.path[z.pathIndex * 2];
          wy = z.path[z.pathIndex * 2 + 1];
          if (Math.hypot(wx - t.x, wy - t.y) < 0.55) {
            z.pathIndex++;
            if (z.pathIndex * 2 < z.path.length) {
              wx = z.path[z.pathIndex * 2];
              wy = z.path[z.pathIndex * 2 + 1];
            }
          }
        }
      }
      const dx = wx - t.x;
      const dy = wy - t.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > 0.05) {
        dirX = dx / d;
        dirY = dy / d;
      }
    }

    // Separation from neighbours keeps crowds from collapsing into one blob.
    this.neighbours.length = 0;
    game.spatial.query(t.x, t.y, 1.0, this.neighbours);
    let sepX = 0;
    let sepY = 0;
    for (const id of this.neighbours) {
      if (id === e) continue;
      const nz = game.ecs.get(id, Zombie);
      const nt = game.ecs.get(id, Transform);
      if (!nz || !nt) continue;
      const dx = t.x - nt.x;
      const dy = t.y - nt.y;
      const d2 = dx * dx + dy * dy;
      if (d2 > 0.8 * 0.8 || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      sepX += (dx / d) * (0.8 - d);
      sepY += (dy / d) * (0.8 - d);
    }

    const targetVx = dirX * speed + sepX * 2;
    const targetVy = dirY * speed + sepY * 2;
    const accel = (4 + z.chaseSpeed * 2) * dt;
    const dvx = targetVx - z.vx;
    const dvy = targetVy - z.vy;
    const dv = Math.hypot(dvx, dvy);
    if (dv <= accel) {
      z.vx = targetVx;
      z.vy = targetVy;
    } else {
      z.vx += (dvx / dv) * accel;
      z.vy += (dvy / dv) * accel;
    }
    const knockDecay = Math.exp(-7 * dt);
    const frozen = z.state === 'down' || z.state === 'rise';
    const moveX = (frozen ? 0 : z.vx) + z.knockX;
    const moveY = (frozen ? 0 : z.vy) + z.knockY;
    z.knockX *= knockDecay;
    z.knockY *= knockDecay;

    const nx = t.x + moveX * dt;
    const ny = t.y + moveY * dt;
    const resolved = collision.resolveCircle(nx, ny, ZOMBIE_RADIUS, Block.Zombie);
    let fx = resolved.x;
    let fy = resolved.y;
    // Zombies do not walk through players; players are pushed out on their own side.
    for (const id of this.neighbours) {
      if (!game.ecs.has(id, Player)) continue;
      const pt = game.ecs.get(id, Transform)!;
      const dx = fx - pt.x;
      const dy = fy - pt.y;
      const min = ZOMBIE_RADIUS + PLAYER_RADIUS;
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min && d2 > 1e-8) {
        const d = Math.sqrt(d2);
        fx = pt.x + (dx / d) * min;
        fy = pt.y + (dy / d) * min;
      }
    }
    if (fx !== resolved.x || fy !== resolved.y) {
      const again = collision.resolveCircle(fx, fy, ZOMBIE_RADIUS, Block.Zombie);
      fx = again.x;
      fy = again.y;
    }
    if (game.world.inBounds(fx, fy, 0.5)) {
      t.x = fx;
      t.y = fy;
    }
    game.spatial.set(e, t.x, t.y);

    // Face the direction of travel (or the target while chasing up close).
    if (!frozen && z.state !== 'attack' && z.state !== 'bang') {
      const turn = (3 + z.chaseSpeed) * dt;
      if (z.state === 'chase') {
        const pt = game.ecs.get(z.target, Transform);
        if (pt && Math.hypot(pt.x - t.x, pt.y - t.y) < 3) t.angle = approachAngle(t.angle, Math.atan2(pt.y - t.y, pt.x - t.x), turn);
        else if (Math.hypot(z.vx, z.vy) > 0.1) t.angle = approachAngle(t.angle, Math.atan2(z.vy, z.vx), turn);
      } else if (Math.hypot(z.vx, z.vy) > 0.1) {
        t.angle = approachAngle(t.angle, Math.atan2(z.vy, z.vx), turn);
      }
    }

    // Stuck detection: bang on doors and windows in the way, otherwise re-plan.
    if (speed > 0) {
      z.stuckTimer += dt;
      if (resolved.blocker?.objectId && (z.state === 'chase' || z.state === 'investigate')) {
        const oid = resolved.blocker.objectId;
        const obj = game.world.compiled.object(oid);
        if (obj && obj.kind !== 'container' && z.stuckTimer > 0.5) {
          const moved = Math.hypot(t.x - z.progressX, t.y - z.progressY);
          if (moved < 0.35) {
            z.state = 'bang';
            z.bangTarget = oid;
            z.stateTimer = 30;
            z.stuckTimer = 0;
            z.progressX = t.x;
            z.progressY = t.y;
            return;
          }
        }
      }
      if (z.stuckTimer > 1.2) {
        const moved = Math.hypot(t.x - z.progressX, t.y - z.progressY);
        if (moved < 0.3) {
          z.path = null;
          z.repathTimer = 0;
          if (z.state === 'wander') z.stateTimer = 0;
          // Nudge sideways to slide off corners.
          z.knockX += -dirY * 0.8 * (game.rng.chance(0.5) ? 1 : -1);
          z.knockY += dirX * 0.8 * (game.rng.chance(0.5) ? 1 : -1);
        }
        z.stuckTimer = 0;
        z.progressX = t.x;
        z.progressY = t.y;
      }
    } else {
      z.stuckTimer = 0;
      z.progressX = t.x;
      z.progressY = t.y;
    }
  }
}

export { NAV_CELL };
