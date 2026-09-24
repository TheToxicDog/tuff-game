// Appearance derived from a seed: clothing, skin and hair colours for players and zombies, so
// every character looks a little different without per-character data.

import { Rng } from '@tuff/shared';

export interface Look {
  skin: number;
  hair: number;
  top: number;
  topDark: number;
  pants: number;
  shoes: number;
  bald: boolean;
  build: number;
  /** Zombie-only: amount of blood and tearing. */
  gore: number;
}

const SKIN = [0xe0b894, 0xc99a74, 0xa87652, 0x7d5436, 0x5b3b26, 0xf0cfb0];
const HAIR = [0x1e1a16, 0x3a2a1c, 0x5a4028, 0x8a6a3a, 0xb09060, 0x6a6a68, 0x2a2420];
const TOPS = [0x4a5a6a, 0x6a3a32, 0x3a4a34, 0x5a5448, 0x7a6a4a, 0x2e3440, 0x8a8478, 0x4a3a5a, 0x3a5a5a, 0x6a2a2a];
const PANTS = [0x2e3444, 0x3a3630, 0x4a4234, 0x262626, 0x3a4a5a, 0x5a5040];
const ZOMBIE_SKIN = [0x8a9474, 0x7a8468, 0x9a9a7a, 0x6e7a5e, 0x8e8672, 0xa0a08a];

function darken(c: number, f: number): number {
  const r = ((c >> 16) & 255) * f;
  const g = ((c >> 8) & 255) * f;
  const b = (c & 255) * f;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}

function desaturate(c: number, amount: number): number {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const l = r * 0.3 + g * 0.59 + b * 0.11;
  return (Math.round(r + (l - r) * amount) << 16) | (Math.round(g + (l - g) * amount) << 8) | Math.round(b + (l - b) * amount);
}

export function playerLook(seed: number): Look {
  const rng = new Rng(seed);
  const top = rng.pick(TOPS);
  return {
    skin: rng.pick(SKIN),
    hair: rng.pick(HAIR),
    top,
    topDark: darken(top, 0.7),
    pants: rng.pick(PANTS),
    shoes: rng.pick([0x1a1a1a, 0x3a2a1c, 0x5a5a58]),
    bald: rng.chance(0.12),
    build: rng.range(0.95, 1.08),
    gore: 0,
  };
}

export function zombieLook(seed: number): Look {
  const rng = new Rng(seed ^ 0x2a5b);
  const top = desaturate(darken(rng.pick(TOPS), rng.range(0.55, 0.8)), 0.45);
  return {
    skin: rng.pick(ZOMBIE_SKIN),
    hair: darken(rng.pick(HAIR), 0.8),
    top,
    topDark: darken(top, 0.65),
    pants: desaturate(darken(rng.pick(PANTS), 0.75), 0.4),
    shoes: rng.pick([0x1a1a1a, 0x2a2420, 0x3a3a38]),
    bald: rng.chance(0.25),
    build: rng.range(0.9, 1.15),
    gore: rng.range(0.2, 1),
  };
}

export { darken };
