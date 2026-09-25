// Motor vehicles (§36, late game): a truck hauls a big load quickly, fastest on roads, and burns fuel
// oil as it goes. When the tank runs dry it refills itself from fuel oil carried in the bed.

/** Slots in a motor truck's bed (a wagon has 48). */
export const TRUCK_SLOTS = 64;
/** Speed multiplier while driving (a horse is 1.75), and the extra on paved tiles. */
export const TRUCK_SPEED = 1.9;
export const TRUCK_PAVED = 1.35;
/** Tiles driven on one fuel oil, and how many the tank holds. */
export const TRUCK_TILES_PER_FUEL = 90;
export const TRUCK_TANK = 6;
