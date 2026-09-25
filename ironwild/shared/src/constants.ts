// World units are tiles: one tile is one unit. Everything that snaps to the building grid uses
// integer tile coordinates; free movement uses fractional ones.

export const PROTOCOL_VERSION = 1;

/** Server simulation rate. */
export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

/** Player input/movement steps per second, on both the client (prediction) and the server. */
export const INPUT_RATE = 30;
export const INPUT_DT = 1 / INPUT_RATE;

/** Side of a streaming chunk, in tiles. */
export const CHUNK = 32;
/** Chunks streamed in each direction around the player (5 × 5 window). */
export const VIEW_CHUNKS = 2;
/** Radius in tiles within which players, creatures and drops are replicated. */
export const ENTITY_VIEW = 48;

export const PLAYER_RADIUS = 0.42;
export const WALK_SPEED = 4.3;
export const SPRINT_MULT = 1.55;
export const DODGE_SPEED = 13;
export const DODGE_TIME = 0.18;
export const DODGE_COOLDOWN = 0.75;
export const DODGE_STAMINA = 22;

export const MAX_HEALTH = 100;
export const MAX_HUNGER = 100;
export const MAX_STAMINA = 100;

/** Reach for talking to NPCs, opening machines, picking things up. */
export const INTERACT_RANGE = 2.8;
/** Maximum distance from the player to a tile being built on. */
export const BUILD_RANGE = 8;

/** Real seconds per in-game day (default; servers can override). */
export const DEFAULT_DAY_SECONDS = 1200;

/** Machines are balanced around this speed: at 16 RPM they run at 100 %. */
export const BASE_RPM = 16;

/** Item quality tiers (§16). */
export const QUALITY_NAMES = ['Crude', 'Standard', 'Fine', 'Excellent', 'Masterwork'] as const;
export const QUALITY_PRICE = [0.6, 1, 1.4, 2, 3] as const;
export const STANDARD_QUALITY = 1;

/** Grid directions: 0 north (−y), 1 east (+x), 2 south (+y), 3 west (−x). */
export type Dir = 0 | 1 | 2 | 3;
export const DX = [0, 1, 0, -1] as const;
export const DY = [-1, 0, 1, 0] as const;
export const DIR_NAMES = ['north', 'east', 'south', 'west'] as const;

export const opposite = (d: number): Dir => ((d + 2) & 3) as Dir;
export const turnRight = (d: number): Dir => ((d + 1) & 3) as Dir;
export const turnLeft = (d: number): Dir => ((d + 3) & 3) as Dir;
export const rotateDir = (d: number, rot: number): Dir => ((d + rot) & 3) as Dir;
/** Angle of a grid direction in radians (0 = east, clockwise because +y is down). */
export const dirAngle = (d: number): number => [-Math.PI / 2, 0, Math.PI / 2, Math.PI][d & 3];
