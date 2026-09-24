# Roadmap and status

Phases follow [`DESIGN.md` §90](DESIGN.md#90-development-roadmap). ✅ done · 🟡 partly done · ⬜ not started.

## First playable milestone (§91) — ✅

| Requirement                                                | Status                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| 2–4 multiplayer players                                    | ✅ up to 10 (load-tested with 10 bot clients, ~2.5 ms of a 50 ms tick)    |
| 1 neighborhood                                             | ✅ Pine Valley, 640 × 640 m                                               |
| 10–15 enterable buildings                                  | ✅ 24 (14 houses, 5 sheds, cabin, grocery, gas station, hardware, police) |
| Grocery store, gas station, police station, hardware store | ✅                                                                        |
| 100+ item definitions                                      | ✅ 146                                                                    |
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

### Phase 3 — Map system 🟡

Done: chunked map format, terrain materials, roads, buildings with interiors, zones, streaming,
roof and interior visibility. Missing: the browser map editor (`/editor`, §33–47) and a biome
system beyond zone kinds.

### Phase 4 — Procedural tools 🟡

Done in code: house, shed and cabin layouts with furnished rooms, the four commercial building
generators, terrain painting, Poisson-disc prop scattering and a town assembler
(`npm run generate:map`). Missing: editor integration, parcel and road generators driven from the
editor, generation locking and regeneration of unlocked regions.

### Phase 5 — Survival 🟡

Done: hunger, thirst, energy, stress, pain; wounds with bleeding, contamination and infection;
dressings, disinfection, stitches, splints, painkillers, antibiotics; eating and drinking with
tool requirements (can openers). Missing: sleep, cooking, food spoilage.

### Phase 6 — Persistence 🟡

Done: world deltas for containers, dropped items, doors and windows (including destruction),
corpses, dormant zombies and zone populations; characters; batched saves to PostgreSQL or files.
Missing: player construction (waits for Phase 7).

### Phase 7 — Fortification ⬜

Barricades, furniture movement, construction, storage permissions.

### Phases 8–12 ⬜

Vehicles, farming, animals, the full first map, and mobile controls. The input layer already
separates physical controls from actions, so a touch source can be added without touching
gameplay code.

## Next steps

1. **Playtest and tune** the first milestone loop with real players: zombie density and speeds,
   loot abundance, bleeding and damage numbers, day length.
2. **Fortification basics**: barricading doors and windows with planks and nails (the items and
   the door/window damage model already exist).
3. **Map editor** (Phase 3): place and edit roads, buildings and props in the browser, save to the
   map format the server already loads.
4. **Sleep and cooking** to round out survival.
5. **Skills** (§61) once the core loop feels right.
