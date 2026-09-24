import { describe, expect, it } from 'vitest';
import { ContentRegistry } from '../../content/registry';
import type { PropDef } from '../../content/types';
import {
  BIOMES,
  biomeGridSize,
  buildingBounds,
  chunkKey,
  encodeBiomes,
  MAP_FORMAT_VERSION,
  terrainIndex,
  type Biome,
  type MapData,
} from '../map';
import { validateMap } from '../validate-map';
import { applyEdit, ELEMENT_COLLECTIONS, generateArea, regenerateInterior, type LayerSelection } from './area';

const ALL: LayerSelection = { terrain: true, roads: true, parcels: true, nature: true };
/** Content that knows exactly the given prop types (the real definitions are checked in server tests). */
function contentFor(types: Iterable<string>): ContentRegistry {
  const props = [...new Set(types)].map((id) => ({ id, name: id }) as PropDef);
  return new ContentRegistry({ hash: 't', items: [], zombies: [], props });
}

function propTypes(map: MapData): string[] {
  return [...map.props.map((p) => p.type), ...map.buildings.flatMap((b) => b.props.map((p) => p.type))];
}

function blankMap(size = 256): MapData {
  return {
    format: MAP_FORMAT_VERSION,
    id: 'test',
    name: 'Test',
    width: size,
    height: size,
    seed: 1,
    terrain: { fill: terrainIndex('grass'), chunks: {} },
    roads: [],
    buildings: [],
    props: [],
    fences: [],
    zones: [],
    spawns: [{ x: 10, y: 10 }],
  };
}

/** Paints `biome` on every cell whose centre passes `where`, and 'none' elsewhere. */
function paint(map: MapData, biome: Biome, where: (x: number, y: number) => boolean = () => true): void {
  const { cols, rows } = biomeGridSize(map);
  const cells = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) cells[cy * cols + cx] = where(cx * 16 + 8, cy * 16 + 8) ? BIOMES.indexOf(biome) : 0;
  }
  map.biomes = encodeBiomes(cells);
}

const whole = (map: MapData) => ({ x: 0, y: 0, w: map.width, h: map.height });

function allIds(map: MapData): string[] {
  return ELEMENT_COLLECTIONS.flatMap((c) => (map[c] as { id: string }[]).map((e) => e.id));
}

describe('area generation', () => {
  it('generates tagged content only where a biome is painted', () => {
    const map = blankMap();
    paint(map, 'suburb', (x) => x < 128);
    const edit = generateArea(map, { seed: 7, area: whole(map), layers: ALL, replace: false });
    expect(edit.add.buildings.length).toBeGreaterThan(0);
    expect(edit.add.roads.length).toBeGreaterThan(0);
    for (const b of edit.add.buildings) {
      expect(b.gen).toBe('parcels');
      expect(b.x).toBeLessThan(150);
    }
    for (const r of edit.add.roads) expect(r.gen).toBeDefined();
    applyEdit(map, edit);
    const ids = allIds(map);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validateMap(map, contentFor(propTypes(map)))).toEqual([]);
  });

  it('regenerating keeps locked and hand-made elements and avoids them', () => {
    const map = blankMap();
    paint(map, 'suburb');
    applyEdit(map, generateArea(map, { seed: 1, area: whole(map), layers: ALL, replace: false }));
    expect(map.buildings.length).toBeGreaterThan(2);
    const locked = map.buildings[0];
    const manual = map.buildings[1];
    locked.locked = true;
    manual.manual = true;
    delete manual.gen;
    const others = map.buildings.slice(2).map((b) => b.id);

    const edit = generateArea(map, { seed: 2, area: whole(map), layers: ALL, replace: true });
    expect(edit.remove.buildings).not.toContain(locked.id);
    expect(edit.remove.buildings).not.toContain(manual.id);
    expect(edit.remove.buildings).toEqual(expect.arrayContaining(others));
    applyEdit(map, edit);

    expect(map.buildings.find((b) => b.id === locked.id)).toBeDefined();
    expect(map.buildings.find((b) => b.id === manual.id)).toBeDefined();
    const ids = allIds(map);
    expect(new Set(ids).size).toBe(ids.length);
    // New buildings do not overlap the kept ones.
    for (const kept of [locked, manual].map(buildingBounds)) {
      for (const b of map.buildings) {
        if (b.id === locked.id || b.id === manual.id) continue;
        const o = buildingBounds(b);
        const overlap = o.minX < kept.maxX - 0.5 && o.maxX > kept.minX + 0.5 && o.minY < kept.maxY - 0.5 && o.maxY > kept.minY + 0.5;
        expect(overlap, `${b.id} overlaps a kept building`).toBe(false);
      }
    }
  });

  it('leaves content alone where no biome is painted', () => {
    const map = blankMap();
    paint(map, 'suburb');
    applyEdit(map, generateArea(map, { seed: 3, area: whole(map), layers: ALL, replace: false }));
    delete map.biomes;
    const edit = generateArea(map, { seed: 4, area: whole(map), layers: ALL, replace: true });
    for (const c of ELEMENT_COLLECTIONS) {
      expect(edit.remove[c]).toEqual([]);
      expect(edit.add[c]).toEqual([]);
    }
    expect(edit.terrain).toEqual({});
  });

  it('never repaints locked terrain chunks', () => {
    const map = blankMap(128);
    paint(map, 'forest');
    map.terrainLocked = [chunkKey(0, 0)];
    const edit = generateArea(map, {
      seed: 5,
      area: whole(map),
      layers: { terrain: true, roads: false, parcels: false, nature: false },
      replace: false,
    });
    expect(Object.keys(edit.terrain)).not.toContain(chunkKey(0, 0));
    expect(Object.keys(edit.terrain).length).toBeGreaterThan(0);
  });
});

describe('interior regeneration', () => {
  it('keeps the footprint and gives the building a fresh id', () => {
    const map = blankMap();
    paint(map, 'suburb');
    applyEdit(map, generateArea(map, { seed: 6, area: whole(map), layers: ALL, replace: false }));
    const house = map.buildings.find((b) => b.type === 'house');
    expect(house).toBeDefined();
    const once = regenerateInterior(house!, 11);
    expect(once.id).toBe(`${house!.id}~${(11).toString(36)}`);
    expect([once.x, once.y, once.rot]).toEqual([house!.x, house!.y, house!.rot]);
    expect(once.gen).toBe(house!.gen);
    const twice = regenerateInterior(once, 12);
    expect(twice.id).toBe(`${house!.id}~${(12).toString(36)}`);
    for (const d of twice.doors) expect(d.id.startsWith(twice.id)).toBe(true);
  });
});

describe('map validation', () => {
  it('rejects malformed maps', () => {
    const map = blankMap();
    const content = contentFor(['tree_oak']);
    expect(validateMap(map, content)).toEqual([]);
    expect(validateMap({ ...map, id: 'Bad Id!' }, content)).toContain('Map id must be 1–40 characters of a–z, 0–9, _ or -.');
    expect(validateMap({ ...map, spawns: [] }, content)).toContain('The map needs at least one spawn point.');
    const dup = { ...map, props: [0, 1].map(() => ({ id: 'p1', type: 'tree_oak', x: 5, y: 5, rot: 0 })) };
    expect(validateMap(dup, content).some((m) => m.includes('duplicate id "p1"'))).toBe(true);
    const unknown = { ...map, props: [{ id: 'p1', type: 'nope', x: 5, y: 5, rot: 0 }] };
    expect(validateMap(unknown, content).some((m) => m.includes('unknown prop type'))).toBe(true);
  });
});
