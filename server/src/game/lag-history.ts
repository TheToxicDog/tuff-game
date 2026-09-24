// Position history for lag compensation. Clients render remote entities slightly in the past, so
// when a shot or swing is processed the server rewinds targets to where the shooter saw them.

import { MAX_LAG_COMPENSATION_SECONDS, SERVER_TICK_RATE } from '@tuff/shared';

const MAX_TICKS = Math.ceil(MAX_LAG_COMPENSATION_SECONDS * SERVER_TICK_RATE) + 2;

export class LagHistory {
  private readonly ticks: { tick: number; positions: Map<number, [number, number]> }[] = [];

  record(tick: number, positions: Map<number, [number, number]>): void {
    this.ticks.push({ tick, positions });
    while (this.ticks.length > MAX_TICKS) this.ticks.shift();
  }

  /** Oldest tick that can be rewound to. */
  get oldest(): number {
    return this.ticks[0]?.tick ?? 0;
  }

  /** Interpolated position of an entity at a fractional tick, or null if unknown. */
  positionAt(entity: number, tick: number): { x: number; y: number } | null {
    if (this.ticks.length === 0) return null;
    const newest = this.ticks[this.ticks.length - 1].tick;
    const t = Math.max(this.oldest, Math.min(newest, tick));
    const base = Math.floor(t);
    const frac = t - base;
    const a = this.ticks.find((s) => s.tick === base)?.positions.get(entity);
    const b = this.ticks.find((s) => s.tick === base + 1)?.positions.get(entity);
    if (a && b) return { x: a[0] + (b[0] - a[0]) * frac, y: a[1] + (b[1] - a[1]) * frac };
    if (a) return { x: a[0], y: a[1] };
    if (b) return { x: b[0], y: b[1] };
    return null;
  }
}
