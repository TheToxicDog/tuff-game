import { describe, expect, it } from 'vitest';
import { ContentErrors, validateItems, validateReferences } from '@tuff/shared';
import { loadContent } from './loader';

describe('content data', () => {
  const content = loadContent();

  it('loads and validates every data file', () => {
    expect(content.bundle.items.length).toBeGreaterThanOrEqual(100);
    expect(content.lootTables.size).toBeGreaterThan(40);
    expect(content.bundle.zombies.map((z) => z.id)).toEqual(['slow_walker', 'walker', 'fast_walker', 'runner', 'sprinter']);
  });

  it('meets the first-playable weapon targets', () => {
    const melee = content.bundle.items.filter((i) => i.melee);
    const firearms = content.bundle.items.filter((i) => i.firearm);
    expect(melee.length).toBeGreaterThanOrEqual(6);
    expect(firearms.length).toBeGreaterThanOrEqual(4);
  });

  it('matches the default zombie speed distribution from the design plan', () => {
    const d = content.config.zombies.distribution;
    expect(d).toMatchObject({ slow_walker: 55, walker: 25, fast_walker: 12, runner: 6, sprinter: 2 });
  });

  it('reports broken references', () => {
    const errors = new ContentErrors();
    const items = validateItems(
      [{ id: 'gun', name: 'Gun', category: 'weapon', weight: 1, volume: 1, stackSize: 1, firearm: { caliber: 'nope' } }],
      'test.json',
      errors,
    );
    validateReferences(items, [{ id: 't', rolls: [1, 1], entries: [{ item: 'missing', weight: 1 }] }], [], null, [], errors);
    expect(errors.errors.some((e) => e.includes('caliber "nope"'))).toBe(true);
    expect(errors.errors.some((e) => e.includes('unknown item "missing"'))).toBe(true);
    expect(errors.errors.some((e) => e.includes('firearm.damage'))).toBe(true);
  });
});
