// Rails (§36): track pieces join their neighbours automatically; minecarts run along them on their
// own, stop at stations to load or unload, and turn back at the end of the line. At a junction a
// cart goes straight on unless the switch (set with E) sends it another way.

import { opposite } from '../constants';

/** Minecart speed in tiles per second, and the most it waits at a station with nothing to move. */
export const CART_SPEED = 4;
export const STATION_IDLE = 1.5;
/** Slots in a minecart, a wagon and a hand cart. */
export const MINECART_SLOTS = 16;
export const WAGON_SLOTS = 48;
export const HAND_CART_SLOTS = 24;

export type StationMode = 'load' | 'unload' | 'pass';
export const STATION_MODES: readonly StationMode[] = ['load', 'unload', 'pass'];

/** Directions (0 N, 1 E, 2 S, 3 W) toward neighbouring rail tiles. */
export function railLinks(isRail: (dir: number) => boolean): number[] {
  const out: number[] = [];
  for (let d = 0; d < 4; d++) if (isRail(d)) out.push(d);
  return out;
}

/** How a rail tile is drawn: two opposite links are straight, two adjacent ones a curve. */
export function railShape(links: number[]): { kind: 'straight' | 'curve' | 'junction'; dirs: number[] } {
  if (links.length === 0) return { kind: 'straight', dirs: [1, 3] };
  if (links.length === 1) return { kind: 'straight', dirs: [links[0], opposite(links[0])] };
  if (links.length === 2) return { kind: links[0] === opposite(links[1]) ? 'straight' : 'curve', dirs: links };
  return { kind: 'junction', dirs: links };
}

/**
 * Where a cart entering a tile through side `entry` leaves it: the switch if it points somewhere
 * valid, else straight on, else the only other way; a dead end runs to the far edge and back.
 */
export function railExit(links: number[], entry: number, sw?: number): number {
  const ways = links.filter((d) => d !== entry);
  if (ways.length === 0) return opposite(entry);
  if (sw !== undefined && ways.includes(sw)) return sw;
  if (ways.includes(opposite(entry))) return opposite(entry);
  return ways[0];
}

/** Length of a cart's path across a tile (straight across, or a quarter circle). */
export const railLength = (entry: number, exit: number): number => (entry === opposite(exit) || entry === exit ? 1 : Math.PI / 4);
