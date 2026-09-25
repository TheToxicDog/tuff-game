// Electricity (§19, the industrial tier): generators turn rotation into power, power poles within
// reach of each other join into a grid, and devices near a pole draw from it — electric motors turn
// power back into rotation anywhere on the grid, lathes and packagers work, lamps light the night.
// When a grid is asked for more than it makes, everything on it runs at the same reduced share.

// A generator makes 100 power from 64 stress at 16 RPM; a motor turns 100 power into 48 torque. So
// power turned back into rotation loses a quarter — no perpetual motion.
/** Poles join when this close (tiles, centre to centre); devices use a pole this close. */
export const POLE_RANGE = 9;
export const DEVICE_RANGE = 3.2;

export type ElectricRole = 'generator' | 'pole' | 'motor' | 'machine' | 'lamp';

export interface ElectricSpec {
  role: ElectricRole;
  /** Generators: output at 16 RPM. Everything else: what it draws while running. */
  power: number;
}
