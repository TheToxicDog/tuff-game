// Estimates the server's tick clock from snapshot arrival times. Remote entities are rendered a
// little in the past (interpolation delay) so there are always two snapshots to blend between.

import { INTERPOLATION_DELAY_TICKS, SERVER_TICK_SECONDS } from '@tuff/shared';

const TICK_MS = SERVER_TICK_SECONDS * 1000;

export class ServerClock {
  /** serverTimeMs - localTimeMs */
  private offset = 0;
  private initialized = false;
  /** Smoothed arrival jitter in ms, used to widen the interpolation buffer on bad connections. */
  jitter = 10;
  latestTick = 0;

  onSnapshot(tick: number, receivedAt: number): void {
    this.latestTick = Math.max(this.latestTick, tick);
    const sample = tick * TICK_MS - receivedAt;
    if (!this.initialized) {
      this.offset = sample;
      this.initialized = true;
      return;
    }
    const diff = sample - this.offset;
    this.jitter = this.jitter * 0.95 + Math.abs(diff) * 0.05;
    if (Math.abs(diff) > 500) this.offset = sample;
    // Early packets mean our estimate lags behind: catch up quickly. Late packets are usually
    // jitter: drift down slowly.
    else this.offset += diff > 0 ? diff * 0.25 : diff * 0.02;
  }

  /** Current estimated server tick (fractional). */
  tickNow(now = performance.now()): number {
    return (now + this.offset) / TICK_MS;
  }

  /** Tick at which remote entities should be rendered. */
  renderTick(now = performance.now()): number {
    const delay = INTERPOLATION_DELAY_TICKS + Math.min(3, this.jitter / TICK_MS);
    return this.tickNow(now) - delay;
  }
}
