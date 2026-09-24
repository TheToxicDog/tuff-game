import { clamp01, lerp, smoothstep } from '../math/scalar';

export const MINUTES_PER_DAY = 24 * 60;

/** Default day length from the design plan: 15 real minutes per in-game day. */
export const DEFAULT_REAL_SECONDS_PER_DAY = 15 * 60;

export interface GameTime {
  /** Day number, starting at 1. */
  day: number;
  /** Hour of day, fractional (0 ≤ hour < 24). */
  hour: number;
  minute: number;
}

/**
 * The world clock. It stores total elapsed game minutes and only advances when the server
 * advances it — an empty server does not tick, so time pauses with it.
 */
export class WorldClock {
  constructor(
    public totalMinutes: number,
    public realSecondsPerDay = DEFAULT_REAL_SECONDS_PER_DAY,
  ) {}

  /** Game minutes that pass per real second. */
  get gameMinutesPerSecond(): number {
    return MINUTES_PER_DAY / this.realSecondsPerDay;
  }

  advance(realSeconds: number): void {
    this.totalMinutes += realSeconds * this.gameMinutesPerSecond;
  }

  get time(): GameTime {
    return gameTimeFromMinutes(this.totalMinutes);
  }
}

export function gameTimeFromMinutes(totalMinutes: number): GameTime {
  const day = Math.floor(totalMinutes / MINUTES_PER_DAY) + 1;
  const minuteOfDay = totalMinutes - (day - 1) * MINUTES_PER_DAY;
  const hour = minuteOfDay / 60;
  return { day, hour, minute: Math.floor(minuteOfDay % 60) };
}

export function formatClock(totalMinutes: number): string {
  const t = gameTimeFromMinutes(totalMinutes);
  const h = Math.floor(t.hour);
  return `${String(h).padStart(2, '0')}:${String(t.minute).padStart(2, '0')}`;
}

export type DayPhase = 'night' | 'dawn' | 'day' | 'dusk';

export function dayPhase(hour: number): DayPhase {
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 18) return 'day';
  if (hour >= 18 && hour < 20) return 'dusk';
  return 'night';
}

/**
 * Natural light level in [0, 1] for the given hour: dawn 05–07, daylight 07–18, dusk 18–20,
 * night 20–05. Even daylight is gloomy (overcast), so the maximum stays below 1.
 */
export function daylight(hour: number): number {
  const night = 0.06;
  const day = 0.92;
  if (hour >= 5 && hour < 7) return lerp(night, day, smoothstep(5, 7, hour));
  if (hour >= 7 && hour < 18) return day;
  if (hour >= 18 && hour < 20) return lerp(day, night, smoothstep(18, 20, hour));
  return night;
}

export interface AmbientLight {
  /** Overall brightness multiplier in [0, 1]. */
  level: number;
  r: number;
  g: number;
  b: number;
}

/** Ambient colour of natural light: cold blue at night, warm at dawn/dusk, grey overcast by day. */
export function ambientLight(hour: number): AmbientLight {
  const level = daylight(hour);
  let r = 0.86;
  let g = 0.88;
  let b = 0.92;
  if (hour >= 5 && hour < 7.5) {
    const warm = 1 - Math.abs(hour - 6.2) / 1.3;
    r += 0.12 * clamp01(warm);
    g += 0.02 * clamp01(warm);
    b -= 0.08 * clamp01(warm);
  } else if (hour >= 17.5 && hour < 20) {
    const warm = 1 - Math.abs(hour - 18.8) / 1.3;
    r += 0.16 * clamp01(warm);
    g += 0.01 * clamp01(warm);
    b -= 0.12 * clamp01(warm);
  }
  if (level < 0.3) {
    const nightness = 1 - level / 0.3;
    r = lerp(r, 0.55, nightness);
    g = lerp(g, 0.65, nightness);
    b = lerp(b, 1.0, nightness);
  }
  return { level, r: r * level, g: g * level, b: b * level };
}
