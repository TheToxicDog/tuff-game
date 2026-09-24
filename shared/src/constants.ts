// Engine-wide constants shared by client and server. Gameplay tuning that server operators may
// want to change lives in data/config instead.

/** Universal asset scale from the design plan: 48 pixels ≈ 1 meter. */
export const PIXELS_PER_METER = 48;

/** Side length of a world chunk in meters. */
export const CHUNK_SIZE = 64;

/** Terrain material grid resolution (meters per cell). */
export const TERRAIN_CELL_SIZE = 1;
export const TERRAIN_CELLS_PER_CHUNK = CHUNK_SIZE / TERRAIN_CELL_SIZE;

/** Server simulation rate. */
export const SERVER_TICK_RATE = 20;
export const SERVER_TICK_SECONDS = 1 / SERVER_TICK_RATE;

/** Player input / movement prediction rate. Inputs are simulated in fixed steps of this length. */
export const INPUT_RATE = 60;
export const INPUT_STEP_SECONDS = 1 / INPUT_RATE;

/** How far behind the newest snapshot remote entities are rendered, in server ticks. */
export const INTERPOLATION_DELAY_TICKS = 2;

/** Maximum age of state the server will rewind to for lag compensation. */
export const MAX_LAG_COMPENSATION_SECONDS = 0.4;

/** Entities within this distance of a player are replicated to them. */
export const ENTITY_INTEREST_RADIUS = 72;

/** Chunks within this many chunks (Chebyshev distance) of the player are streamed. */
export const CHUNK_STREAM_RADIUS = 2;

export const PLAYER_RADIUS = 0.32;
export const ZOMBIE_RADIUS = 0.3;

/** Maximum distance at which a player can interact with a door, container or item. */
export const INTERACT_RANGE = 1.9;

export const PROTOCOL_VERSION = 1;
