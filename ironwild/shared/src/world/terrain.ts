// Terrain tiles and regions.

export const Tile = {
  DeepWater: 0,
  Water: 1,
  Sand: 2,
  Grass: 3,
  Forest: 4,
  Plains: 5,
  Highland: 6,
  Mountain: 7,
  Cliff: 8,
  Snow: 9,
  Marsh: 10,
  Desert: 11,
  Road: 12,
  Farmland: 13,
  Plaza: 14,
  Bridge: 15,
  House: 16,
} as const;
export type Tile = (typeof Tile)[keyof typeof Tile];

export interface TileInfo {
  name: string;
  walk: boolean;
  /** Movement speed multiplier. */
  speed: number;
  /** Ordinary ground: most structures can be built here. */
  land: boolean;
  /** Counts as water for water wheels (flowing) and washers (any water). */
  water: boolean;
  flowing: boolean;
  /** Base colour for rendering and the map. */
  color: number;
}

export const TILES: readonly TileInfo[] = [
  { name: 'Deep Water', walk: false, speed: 0, land: false, water: true, flowing: false, color: 0x3f6f9e },
  { name: 'River', walk: true, speed: 0.5, land: false, water: true, flowing: true, color: 0x5b93c7 },
  { name: 'Sand', walk: true, speed: 0.95, land: true, water: false, flowing: false, color: 0xe3d49b },
  { name: 'Grass', walk: true, speed: 1, land: true, water: false, flowing: false, color: 0x8fbf5a },
  { name: 'Forest', walk: true, speed: 0.95, land: true, water: false, flowing: false, color: 0x5f9447 },
  { name: 'Plains', walk: true, speed: 1, land: true, water: false, flowing: false, color: 0xb9c96a },
  { name: 'Highland', walk: true, speed: 1, land: true, water: false, flowing: false, color: 0x98a877 },
  { name: 'Mountain', walk: true, speed: 0.9, land: true, water: false, flowing: false, color: 0x9a978f },
  { name: 'Cliff', walk: false, speed: 0, land: false, water: false, flowing: false, color: 0x6e6a64 },
  { name: 'Snow', walk: true, speed: 0.85, land: true, water: false, flowing: false, color: 0xeef2f5 },
  { name: 'Marsh', walk: true, speed: 0.75, land: true, water: false, flowing: false, color: 0x6f8f62 },
  { name: 'Desert', walk: true, speed: 0.9, land: true, water: false, flowing: false, color: 0xe6c883 },
  { name: 'Road', walk: true, speed: 1.2, land: true, water: false, flowing: false, color: 0xc2a57a },
  { name: 'Farmland', walk: true, speed: 0.9, land: true, water: false, flowing: false, color: 0x8a6440 },
  { name: 'Plaza', walk: true, speed: 1.15, land: false, water: false, flowing: false, color: 0xcfc2a8 },
  { name: 'Bridge', walk: true, speed: 1.15, land: false, water: false, flowing: false, color: 0xa0784c },
  { name: 'House', walk: false, speed: 0, land: false, water: false, flowing: false, color: 0x9c6b4a },
];

export const Region = {
  Ocean: 0,
  Meadows: 1,
  Forest: 2,
  Highlands: 3,
  Mountains: 4,
  Plains: 5,
  Marsh: 6,
  Desert: 7,
} as const;
export type Region = (typeof Region)[keyof typeof Region];

export const REGION_NAMES = ['Coast', 'Meadows', 'Forest', 'Highlands', 'Mountains', 'Fertile Plains', 'Marshlands', 'Desert'] as const;

export const tileWalkable = (t: number): boolean => TILES[t]?.walk ?? false;

/** Run-length encodes a tile array as [value, count, value, count, …] (counts up to 255). */
export function encodeTiles(tiles: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < tiles.length) {
    const v = tiles[i];
    let n = 1;
    while (i + n < tiles.length && tiles[i + n] === v && n < 255) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

export function decodeTiles(rle: readonly number[], size: number): Uint8Array {
  const tiles = new Uint8Array(size);
  let o = 0;
  for (let i = 0; i + 1 < rle.length; i += 2) {
    tiles.fill(rle[i], o, o + rle[i + 1]);
    o += rle[i + 1];
  }
  return tiles;
}
