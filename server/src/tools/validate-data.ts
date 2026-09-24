// Validates every content file in /data and prints a summary. Exits non-zero on errors.
import { loadContent } from '../content/loader';

try {
  const content = loadContent();
  const items = content.bundle.items;
  const byCategory = new Map<string, number>();
  for (const item of items) byCategory.set(item.category, (byCategory.get(item.category) ?? 0) + 1);
  console.log(`Content OK (hash ${content.bundle.hash})`);
  console.log(`  ${items.length} items: ${[...byCategory].map(([k, v]) => `${k} ${v}`).join(', ')}`);
  console.log(
    `  ${content.lootTables.size} loot tables, ${content.bundle.props.length} props, ${content.bundle.zombies.length} zombie archetypes`,
  );
  console.log(`  ${content.bundle.recipes.length} recipes, ${content.bundle.constructions.length} constructions`);
} catch (err) {
  console.error((err as Error).message);
  process.exit(1);
}
