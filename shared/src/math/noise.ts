import { Rng } from './rng';

const GRADIENTS: readonly [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

/**
 * Seeded 2D gradient (Perlin) noise with optional periodicity, so it can be used both for world
 * generation and for seamless tiling textures. Output is roughly in [-1, 1].
 */
export class Noise2D {
  private readonly perm = new Uint8Array(512);

  constructor(seed: number) {
    const rng = new Rng(seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    rng.shuffle(p);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  noise(x: number, y: number, periodX = 256, periodY = 256): number {
    const xf = Math.floor(x);
    const yf = Math.floor(y);
    const x0 = mod(xf, periodX);
    const y0 = mod(yf, periodY);
    const x1 = mod(x0 + 1, periodX);
    const y1 = mod(y0 + 1, periodY);
    const dx = x - xf;
    const dy = y - yf;
    const p = this.perm;
    const g00 = GRADIENTS[p[p[x0 & 255] + (y0 & 255)] & 7];
    const g10 = GRADIENTS[p[p[x1 & 255] + (y0 & 255)] & 7];
    const g01 = GRADIENTS[p[p[x0 & 255] + (y1 & 255)] & 7];
    const g11 = GRADIENTS[p[p[x1 & 255] + (y1 & 255)] & 7];
    const n00 = g00[0] * dx + g00[1] * dy;
    const n10 = g10[0] * (dx - 1) + g10[1] * dy;
    const n01 = g01[0] * dx + g01[1] * (dy - 1);
    const n11 = g11[0] * (dx - 1) + g11[1] * (dy - 1);
    const u = fade(dx);
    const v = fade(dy);
    const nx0 = n00 + (n10 - n00) * u;
    const nx1 = n01 + (n11 - n01) * u;
    return (nx0 + (nx1 - nx0) * v) * 1.41;
  }

  /** Fractal Brownian motion. With integer periods the result tiles seamlessly. */
  fbm(x: number, y: number, octaves = 4, periodX = 256, periodY = 256): number {
    let sum = 0;
    let amplitude = 1;
    let frequency = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum +=
        amplitude * this.noise(x * frequency, y * frequency, periodX * frequency, periodY * frequency);
      norm += amplitude;
      amplitude *= 0.5;
      frequency *= 2;
    }
    return sum / norm;
  }
}
