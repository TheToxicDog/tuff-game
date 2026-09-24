import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ContentErrors,
  ContentRegistry,
  furnitureItems,
  validateConstructions,
  validateCraftingReferences,
  validateItems,
  validateLootTables,
  validateProps,
  validateRecipes,
  validateReferences,
  validateServerConfig,
  validateZombies,
  type ConstructionDef,
  type ContentBundle,
  type ItemDef,
  type LootTableDef,
  type PropDef,
  type RecipeDef,
  type ServerConfig,
  type ZombieArchetypeDef,
} from '@tuff/shared';

export interface LoadedContent {
  registry: ContentRegistry;
  bundle: ContentBundle;
  lootTables: Map<string, LootTableDef>;
  config: ServerConfig;
  dataDir: string;
}

/** Locates the repository's data directory from either the source tree or the bundled build. */
export function findDataDir(): string {
  if (process.env.TUFF_DATA_DIR) return resolve(process.env.TUFF_DATA_DIR);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'data');
    if (existsSync(join(candidate, 'items'))) return candidate;
    dir = dirname(dir);
  }
  return resolve('data');
}

function readJsonFiles(dir: string): { file: string; data: unknown }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => {
      const path = join(dir, f);
      if (!statSync(path).isFile()) return null;
      try {
        return { file: path, data: JSON.parse(readFileSync(path, 'utf8')) as unknown };
      } catch (err) {
        throw new Error(`Invalid JSON in ${path}: ${(err as Error).message}`);
      }
    })
    .filter((x): x is { file: string; data: unknown } => x !== null);
}

function applyEnvOverrides(config: ServerConfig): ServerConfig {
  const env = process.env;
  if (env.TUFF_SERVER_NAME) config.name = env.TUFF_SERVER_NAME;
  if (env.TUFF_PVP) config.pvp = env.TUFF_PVP === 'true' || env.TUFF_PVP === '1';
  if (env.TUFF_MAX_PLAYERS) config.maxPlayers = Math.max(1, Number(env.TUFF_MAX_PLAYERS) || config.maxPlayers);
  if (env.TUFF_MAP) config.map = env.TUFF_MAP;
  if (env.TUFF_DAY_SECONDS) config.realSecondsPerDay = Math.max(60, Number(env.TUFF_DAY_SECONDS) || config.realSecondsPerDay);
  return config;
}

export function loadContent(dataDir = findDataDir(), configPath?: string): LoadedContent {
  const errors = new ContentErrors();
  const items: ItemDef[] = [];
  for (const { file, data } of readJsonFiles(join(dataDir, 'items'))) items.push(...validateItems(data, file, errors));
  const lootTables: LootTableDef[] = [];
  for (const { file, data } of readJsonFiles(join(dataDir, 'loot'))) lootTables.push(...validateLootTables(data, file, errors));
  const zombies: ZombieArchetypeDef[] = [];
  for (const { file, data } of readJsonFiles(join(dataDir, 'zombies'))) zombies.push(...validateZombies(data, file, errors));
  const props: PropDef[] = [];
  for (const { file, data } of readJsonFiles(join(dataDir, 'world'))) props.push(...validateProps(data, file, errors));
  // Every movable prop can be carried as an item.
  items.push(...furnitureItems(props));
  const recipes: RecipeDef[] = [];
  for (const { file, data } of readJsonFiles(join(dataDir, 'recipes'))) recipes.push(...validateRecipes(data, file, errors));
  const constructions: ConstructionDef[] = [];
  for (const { file, data } of readJsonFiles(join(dataDir, 'construction')))
    constructions.push(...validateConstructions(data, file, errors));

  const cfgFile = configPath ?? process.env.TUFF_CONFIG ?? join(dataDir, 'config', 'server.json');
  let config: ServerConfig | null = null;
  if (existsSync(cfgFile)) {
    config = validateServerConfig(JSON.parse(readFileSync(cfgFile, 'utf8')), cfgFile, errors);
  } else {
    errors.add(`Missing server config at ${cfgFile}`);
  }
  validateReferences(items, lootTables, props, config, zombies, errors);
  validateCraftingReferences(items, { recipes, constructions }, errors);
  if (items.length === 0) errors.add('No items were loaded');
  if (zombies.length === 0) errors.add('No zombie archetypes were loaded');
  errors.throwIfAny();

  const hash = createHash('sha256').update(JSON.stringify({ items, zombies, props, recipes, constructions })).digest('hex').slice(0, 16);
  const bundle: ContentBundle = { hash, items, zombies, props, recipes, constructions };
  return {
    registry: new ContentRegistry(bundle),
    bundle,
    lootTables: new Map(lootTables.map((t) => [t.id, t])),
    config: applyEnvOverrides(config!),
    dataDir,
  };
}
