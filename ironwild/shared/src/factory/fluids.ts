// Fluids (§19, the steam tier): mechanical pumps lift water into pipes, boilers burn fuel to turn
// it into steam, and steam engines turn steam into rotation. Connected pipes and tanks form a
// network that holds one fluid at a time; machines keep a small buffer of their own and connect
// through their faces — a boiler takes water on its back and sides and lets steam out of the front.

import { rotateDir } from '../constants';
import type { StructureDef } from '../content/structures';

export type Fluid = 'water' | 'steam' | 'crude';

export const FLUIDS: readonly Fluid[] = ['water', 'steam', 'crude'];
export const FLUID_NAMES: Record<Fluid, string> = { water: 'Water', steam: 'Steam', crude: 'Crude Oil' };
export const FLUID_COLORS: Record<Fluid, number> = { water: 0x4f8fd0, steam: 0xdfe6ea, crude: 0x3a2e2a };

/** Water a pump lifts per second at 16 RPM (it scales with speed). */
export const PUMP_RATE = 20;
/** Water a fired boiler turns into steam per second, and seconds of full boiling per fuel unit. */
export const BOIL_RATE = 20;
export const BOIL_SECONDS_PER_FUEL = 5;
/** Steam a running engine uses per second. */
export const ENGINE_STEAM = 10;
/** Crude oil a pumpjack lifts per second at 16 RPM. */
export const PUMPJACK_RATE = 12;

export type FluidRole = 'pipe' | 'tank' | 'pump' | 'boiler' | 'engine' | 'pumpjack' | 'refinery';

export interface FluidSpec {
  role: FluidRole;
  /** Pipes and tanks: what they add to their network. Machines: their own buffer, per fluid. */
  capacity: number;
}

export interface FluidFace {
  /** The fluid this face carries; null for pipes and tanks, which carry either. */
  fluid: Fluid | null;
  io: 'in' | 'out' | 'both';
}

/** What a structure does with fluid through its face in world direction `dir`, or null for none. */
export function fluidFace(def: StructureDef, rot: number, dir: number): FluidFace | null {
  const f = def.fluid;
  if (!f) return null;
  const front = rotateDir(0, rot);
  switch (f.role) {
    case 'pipe':
    case 'tank':
      return { fluid: null, io: 'both' };
    case 'pump':
      return { fluid: 'water', io: 'out' };
    case 'boiler':
      return dir === front ? { fluid: 'steam', io: 'out' } : { fluid: 'water', io: 'in' };
    case 'engine':
      // The front carries the drive shaft.
      return dir === front ? null : { fluid: 'steam', io: 'in' };
    case 'pumpjack':
      return { fluid: 'crude', io: 'out' };
    case 'refinery':
      // Products leave by the front.
      return dir === front ? null : { fluid: 'crude', io: 'in' };
  }
}

/** Whether two touching structures pass fluid: `a`'s face in direction `dir` meets `b`. */
export function fluidJoins(a: { def: StructureDef; rot: number }, b: { def: StructureDef; rot: number }, dir: number): boolean {
  const fa = fluidFace(a.def, a.rot, dir);
  const fb = fluidFace(b.def, b.rot, (dir + 2) & 3);
  if (!fa || !fb) return false;
  if (fa.fluid && fb.fluid && fa.fluid !== fb.fluid) return false;
  if (fa.io === 'both' || fb.io === 'both') return true;
  return fa.io !== fb.io;
}
