// Crops grown on tilled farmland (§11 Farming).

export interface CropDef {
  id: string;
  name: string;
  /** Real seconds from planting to ripe. */
  grow: number;
  yields: { item: string; min: number; max: number }[];
  color: number;
}

export const CROPS: readonly CropDef[] = [
  {
    id: 'wheat',
    name: 'Wheat',
    grow: 240,
    yields: [
      { item: 'wheat', min: 2, max: 4 },
      { item: 'wheat_seeds', min: 1, max: 2 },
    ],
    color: 0xe0b84c,
  },
  { id: 'carrot', name: 'Carrots', grow: 200, yields: [{ item: 'carrot', min: 2, max: 4 }], color: 0xf08a24 },
  { id: 'potato', name: 'Potatoes', grow: 220, yields: [{ item: 'potato', min: 2, max: 4 }], color: 0xc9a06a },
  {
    id: 'cotton',
    name: 'Cotton',
    grow: 300,
    yields: [
      { item: 'cotton', min: 2, max: 3 },
      { item: 'cotton_seeds', min: 1, max: 2 },
    ],
    color: 0xfafafa,
  },
];

export const CROP_BY_ID: ReadonlyMap<string, CropDef> = new Map(CROPS.map((c) => [c.id, c]));
export const CROP_STAGES = 4;
