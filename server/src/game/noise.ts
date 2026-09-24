// Sound as a gameplay system (design plan §13–15). Every noisy action emits a noise event with a
// position and intensity; zombies within earshot investigate the approximate location. Zombies
// that are chasing or banging groan and bang themselves, which pulls in more zombies: hordes form
// from a single gunshot.

import { Block } from '@tuff/shared';
import { Transform, Zombie } from './components';
import type { Game } from './game';

/** Meters of hearing radius per unit of noise intensity. */
export const NOISE_TO_METERS = 0.6;

export interface Noise {
  x: number;
  y: number;
  intensity: number;
  source: number;
}

export class NoiseSystem {
  private queue: Noise[] = [];

  constructor(private readonly game: Game) {}

  emit(x: number, y: number, intensity: number, source = 0): void {
    if (intensity <= 0) return;
    this.queue.push({ x, y, intensity, source });
  }

  /** Delivers queued noises to zombies. */
  process(): void {
    const noises = this.queue;
    this.queue = [];
    const { ecs, rng } = this.game;
    for (const n of noises) {
      const radius = n.intensity * NOISE_TO_METERS;
      for (const id of this.game.spatial.query(n.x, n.y, radius)) {
        if (id === n.source) continue;
        const z = ecs.get(id, Zombie);
        const t = ecs.get(id, Transform);
        if (!z || !t) continue;
        const d = Math.hypot(t.x - n.x, t.y - n.y);
        let effective = radius * z.arch.hearing;
        if (d > effective) continue;
        // Walls muffle sound.
        if (d > 3 && !this.game.world.compiled.collision.lineOfSight(t.x, t.y, n.x, n.y, Block.Sight)) {
          effective *= 0.6;
          if (d > effective) continue;
        }
        const strength = n.intensity * (1 - d / effective);
        if (z.state === 'chase' && z.lostTimer < 2) continue;
        if (z.state === 'down' || z.state === 'rise') continue;
        if (strength <= z.interest) continue;
        // Zombies hear the approximate location, not the exact spot.
        const spread = Math.min(8, d * 0.12);
        z.goalX = n.x + rng.gaussian() * spread;
        z.goalY = n.y + rng.gaussian() * spread;
        z.interest = strength;
        z.path = null;
        z.pathPending = false;
        if (z.state !== 'attack' && z.state !== 'stagger' && z.state !== 'bang') {
          z.state = 'investigate';
          z.stateTimer = 20;
        }
      }
    }
  }
}
