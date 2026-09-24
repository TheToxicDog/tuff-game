import { describe, expect, it } from 'vitest';
import { World, defineComponent } from './world';

const Position = defineComponent<{ x: number; y: number }>('Position');
const Health = defineComponent<{ hp: number }>('Health');
const Tag = defineComponent<true>('Tag');

describe('World', () => {
  it('creates entities with unique, never-reused ids', () => {
    const w = new World();
    const a = w.create();
    const b = w.create();
    w.destroy(a);
    const c = w.create();
    expect(new Set([a, b, c]).size).toBe(3);
    expect(w.isAlive(a)).toBe(false);
    expect(w.entityCount).toBe(2);
  });

  it('stores and queries components', () => {
    const w = new World();
    const a = w.create();
    const b = w.create();
    const c = w.create();
    w.add(a, Position, { x: 1, y: 2 });
    w.add(b, Position, { x: 3, y: 4 });
    w.add(b, Health, { hp: 10 });
    w.add(c, Health, { hp: 5 });
    expect(w.query(Position).sort()).toEqual([a, b].sort());
    expect(w.query(Position, Health)).toEqual([b]);
    expect(w.get(a, Health)).toBeUndefined();
    expect(w.req(b, Health).hp).toBe(10);
    expect(() => w.req(a, Health)).toThrow();
  });

  it('removes components on destroy and notifies listeners', () => {
    const w = new World();
    const destroyed: number[] = [];
    w.onDestroy((e) => destroyed.push(e));
    const a = w.create();
    w.add(a, Position, { x: 0, y: 0 });
    w.add(a, Tag, true);
    w.destroy(a);
    expect(destroyed).toEqual([a]);
    expect(w.count(Position)).toBe(0);
    expect(w.query(Tag)).toEqual([]);
    expect(() => w.add(a, Tag, true)).toThrow();
  });

  it('keeps the sparse set consistent after swap-removal', () => {
    const w = new World();
    const ids = Array.from({ length: 50 }, () => w.create());
    ids.forEach((id, i) => w.add(id, Health, { hp: i }));
    for (let i = 0; i < 50; i += 3) w.remove(ids[i], Health);
    for (let i = 0; i < 50; i++) {
      const h = w.get(ids[i], Health);
      if (i % 3 === 0) expect(h).toBeUndefined();
      else expect(h?.hp).toBe(i);
    }
  });

  it('each() tolerates removing the visited entity', () => {
    const w = new World();
    const ids = Array.from({ length: 10 }, () => w.create());
    ids.forEach((id) => w.add(id, Tag, true));
    const seen: number[] = [];
    w.each(Tag, (e) => {
      seen.push(e);
      w.remove(e, Tag);
    });
    expect(seen.sort((a, b) => a - b)).toEqual(ids);
    expect(w.count(Tag)).toBe(0);
  });
});
