// Generates the prototype neighborhood and writes it to data/maps/<id>.json.
//
//   npm run generate:map                 # default seed
//   npm run generate:map -- --seed 42    # different layout
//
// The output is the immutable base world. Regenerating it does not touch saved world deltas, but
// deltas refer to object ids, so regenerate before a server's first launch rather than after.

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CompiledWorld, generatePrototypeTown } from '@tuff/shared';
import { findDataDir, loadContent } from '../content/loader';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const seed = Number(arg('seed') ?? 1337);
const dataDir = findDataDir();
const content = loadContent(dataDir);
const started = performance.now();
const map = generatePrototypeTown(seed);

// Compile once to report counts and catch props that reference unknown definitions.
const world = new CompiledWorld(content.registry);
for (const b of map.buildings) world.addBuilding(b);
for (const p of map.props) world.addProp(p);
for (const f of map.fences) world.addFence(f);
const unknownProps = new Set<string>();
for (const p of [...map.props, ...map.buildings.flatMap((b) => b.props)]) {
  if (!content.registry.findProp(p.type)) unknownProps.add(p.type);
}
if (unknownProps.size > 0) {
  console.error(`Unknown prop types: ${[...unknownProps].join(', ')}`);
  process.exit(1);
}
const missingLoot = [...world.containers.values()].filter((c) => !content.lootTables.has(c.loot));
if (missingLoot.length > 0) {
  console.error(`Containers with unknown loot tables: ${[...new Set(missingLoot.map((c) => c.loot))].join(', ')}`);
  process.exit(1);
}

const outDir = join(dataDir, 'maps');
mkdirSync(outDir, { recursive: true });
const out = join(outDir, `${map.id}.json`);
const json = JSON.stringify(map);
writeFileSync(out, json);
console.log(
  `Generated "${map.name}" (seed ${seed}) in ${(performance.now() - started).toFixed(0)} ms → ${out}\n` +
    `  ${map.width}×${map.height} m, ${map.buildings.length} buildings, ${map.roads.length} roads, ` +
    `${map.props.length} outdoor props, ${map.fences.length} fences\n` +
    `  ${world.doors.size} doors, ${world.windows.size} windows, ${world.containers.size} containers, ` +
    `${world.collision.size} colliders, ${(json.length / 1024).toFixed(0)} KiB`,
);
