# Roadmap and status

Phases follow [`DESIGN.md` §90](DESIGN.md#90-development-roadmap). ✅ done · 🟡 partly done · ⬜ not started.

## First playable milestone (§91) — ✅

| Requirement                                                | Status                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| 2–4 multiplayer players                                    | ✅ up to 10 (load-tested with 10 bot clients, ~2.5 ms of a 50 ms tick)    |
| 1 neighborhood                                             | ✅ Pine Valley, 640 × 640 m                                               |
| 10–15 enterable buildings                                  | ✅ 24 (14 houses, 5 sheds, cabin, grocery, gas station, hardware, police) |
| Grocery store, gas station, police station, hardware store | ✅                                                                        |
| 100+ item definitions                                      | ✅ 196                                                                    |
| 6 melee weapons, 4 firearms                                | ✅ 13 melee, 5 firearms                                                   |
| Mixed zombie speeds                                        | ✅ 5 archetypes, 55/25/12/6/2 %                                           |
| Inventory, backpacks                                       | ✅ quick slots, pockets, 8 bag types, drag and drop                       |
| Health, wounds, death                                      | ✅ per-body-part wounds, treatment, infection, death with a lootable body |
| Persistent loot                                            | ✅ containers, dropped items, corpses, doors and windows persist          |

The loop _spawn → find a backpack → enter a house → loot a weapon → fight → get hurt → treat the
wound → visit the grocery store → return to shelter → store supplies_ is playable end to end.

## Phases

### Phase 0 — Technical foundation ✅

TypeScript monorepo, PixiJS renderer, ECS, abstract input actions, WebSocket protocol (binary
inputs/snapshots, JSON messages), accounts and sessions, PostgreSQL with migrations, chunk
streaming. Success condition — two browser windows move synchronised characters through the same
world — is covered by an automated integration test and was verified in real browsers.

### Phase 1 — Movement and combat ✅

Mouse-directed camera with zoom, walking/jogging/sprinting/crouching with stamina, collisions,
client prediction, hip fire and precision aim, recoil and bloom, reloading, 5 firearms, 13 melee
weapons, shoving, lag-compensated hit detection, penetration and headshots, zombie perception,
hearing, investigation, hordes, pathfinding, door banging, telegraphed attacks, knockdowns,
health and death.

### Phase 2 — Inventory and loot ✅

Data-driven items, backpacks and bags, world containers with search times, loot tables with
logical placement, the grocery store, transfer UI with drag and drop, take all, sorting and
filtering, floor items.

### Phase 3 — Map system ✅

Chunked map format, terrain materials, roads, buildings with interiors, zones, streaming, roof and
interior visibility, a biome layer (16 m cells), and the browser map editor at `/editor` (§33–47):
terrain and biome painting, road and fence polylines, buildings with interior editing, props,
zombie zones and spawns, selection with move/rotate/delete, undo/redo, layer visibility and
locking, map templates, saving through an admin-only API, publishing to the live server (players
reconnect automatically) and "play from here".

### Phase 4 — Procedural tools ✅

House, shed and cabin layouts with furnished rooms, the four commercial building generators,
terrain painting, Poisson-disc prop scattering and the town assembler (`npm run generate:map`).
From the editor: biome-driven terrain, street grids, parcels with buildings and driveways, and
nature over the whole map or a selected area; prop scattering, terrain smoothing and interior
regeneration. Generated elements are tagged with their generator layer; hand-placed or hand-edited
elements and anything locked (elements, areas or terrain chunks) are kept when regenerating.

### Phase 5 — Survival 🟡

Done: hunger, thirst, energy, stress, pain; wounds with bleeding, contamination and infection;
dressings, disinfection, stitches, splints, painkillers, antibiotics; eating and drinking with
tool requirements (can openers); sleep in beds, couches or on the floor with rest quality and a
fast-forwarded clock while everyone sleeps; cooking at stoves and campfires, and crafting (18
recipes). Missing: food spoilage.

### Phase 6 — Persistence ✅

World deltas for containers, dropped items, doors and windows (including destruction and
barricades), moved furniture, player structures and trust lists, corpses, dormant zombies and zone
populations; characters; batched saves to PostgreSQL or files.

### Phase 7 — Fortification ✅

Barricading doors and windows with planks and nails (boards block zombies and, from two boards,
sight and bullets), picking up and placing furniture, building wooden walls, doors, barricades,
fences, gates, floors, crates, workbenches and campfires with a snapped, rotatable placement
ghost, repairing and dismantling, zombies breaking structures down, and storage permissions
(locked crates, `/trust`, griefing rules).

### Phases 8–12 ⬜

Vehicles, farming, animals, the full first map, and mobile controls. The input layer already
separates physical controls from actions, so a touch source can be added without touching
gameplay code.

## Next steps

1. **Playtest and tune** with real players: zombie density and speeds, loot abundance, bleeding
   and damage numbers, day length, build times and material costs, sleep rates.
2. **Build a larger map** with the editor and the area generators (Phase 11).
3. **Food spoilage** to finish survival.
4. **Skills** (§61) once the core loop feels right.
5. **Vehicles** (Phase 8).
