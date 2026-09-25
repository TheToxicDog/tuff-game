# IRONWILD — Architecture

How the pieces fit together. Section numbers (§) refer to [`DESIGN.md`](DESIGN.md).

```
 Browser (ironwild/client)                        Node.js (ironwild/server)
 ┌───────────────────────────────┐   WebSocket   ┌──────────────────────────────────────┐
 │ Input → 30 Hz input steps     │ ──── JSON ───▶│ ClientSession (limits, parsing)      │
 │ Prediction (stepMovement)     │               │ Game.step() at 20 Hz:                │
 │ ClientWorld (terrain, chunks) │               │   players · combat · creatures       │
 │ EntityStore (interpolation)   │ ◀─ snapshots ─│   factory (power, machines, belts)   │
 │ Renderers (PixiJS)            │ ◀─ chunks, ───│   farming · economy · progression    │
 │ DOM UI                        │   keyframes   │   replication per client             │
 └───────────────────────────────┘               │ Storage: JSON files or memory        │
                                                 └──────────────────────────────────────┘
          ironwild/shared: content, world generation, movement, kinetics, belts, pricing, protocol
```

The server is authoritative for everything. Clients send inputs and requests; the server validates
them and answers with state.

## Shared (`ironwild/shared`)

- **Content** (`content/*.ts`) — items with base values and market tags, resource nodes, structures
  (footprints, placement rules, kinetic ports, machine specs), recipes (instant crafts, anvil
  recipes, timed machine recipes with fractional yields), research, creatures, settlements and
  professions, crops. Content is plain TypeScript data, type-checked and validated by tests.
- **World generation** (`world/gen.ts`) — the island from a seed: warped Voronoi regions, coast,
  a river and a creek, a marsh lake, settlements with plazas, houses and market stalls, roads with
  bridges, landmarks (bandit camp, ruins, mine) and ~6,500 resource nodes, with starter iron, copper
  and coal placed near Westhaven (§9). The server generates it; clients receive the terrain
  run-length encoded in the welcome message.
- **Movement** (`sim/movement.ts`) — walking, sprinting, dodging, stamina and collision against solid
  tiles and circles. It only uses arithmetic and `Math.sqrt`, so the server and every browser get
  bit-identical results; the client predicts with exactly the code the server runs.
- **Kinetics** (`factory/kinetics.ts`) — the power solver (§20–22). Transmitting blocks (sources,
  shafts, gearboxes) expose ports on faces; a port connects to the neighbour's port facing it.
  A breadth-first walk assigns every gear group a speed ratio relative to the first block; gearboxes
  with two groups (speed gearboxes) multiply the ratio. Loops whose ratios contradict lock the
  network. Machines and conveyor groups attach to the first port facing them. The network's base
  speed is the slowest source's nominal speed over its ratio; capacity is Σ torque × speed/16 and
  load is Σ stress × speed/16 (Create-style stress units), so running a machine twice as fast costs
  twice the stress. Load above capacity stalls the whole network.
- **Belts** (`factory/belts.ts`) — the path of an item across a conveyor tile: from the edge it
  entered through to the tile's front edge, straight or around a quarter circle.
- **Pricing** (`economy/pricing.ts`) — a settlement's price for an item is base value × regional
  factor × (target stock / stock)^0.6, clamped. Selling adds to stock one unit at a time (each unit
  lowers the next unit's price); stock recovers towards the target with a half-life of half a game
  day (§12–14).
- **Protocol** (`protocol.ts`) — every message type.

## Server (`ironwild/server`)

`bootstrap.ts` wires storage, `AuthService` (scrypt passwords, hashed session tokens, rate limits —
shared design with Tuff), the `Game` and the HTTP/WebSocket server. `Game` owns the world and runs
the systems in a fixed order each 50 ms tick:

| System           | Responsibility                                                                                                          |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `players.ts`     | Input budget and movement, hunger and healing, death and bags, inventory moves, interaction, UIs, carts and horses      |
| `combat.ts`      | Swings (quick, heavy, bows), hits on creatures and players, gathering from nodes, drops and auto-pickup                 |
| `creatures.ts`   | Region populations and spawning away from players; wander/flee/chase/attack AI with telegraphed wind-ups; farm animals  |
| `crafting.ts`    | Crafting at stations; anvil smithing with quality from the minigame score                                               |
| `building.ts`    | Placement rules, hammer pick-up, doors, land claims and permissions                                                     |
| `factory.ts`     | Power recomputation, machine processing, conveyors, splitters, filters, hoppers, overclocking, wear, factory stats      |
| `farming.ts`     | Tilling, crops, harvests, animal products                                                                               |
| `rails.ts`       | Minecarts on rails: following track, junction switches, stations that load and unload, turning at line ends             |
| `fluids.ts`      | Pipe and tank networks (one fluid each), pumps, boilers and steam engines, network summaries for clients                |
| `fishing.ts`     | Casting, bites and catches per kind of water                                                                            |
| `raids.ts`       | Raids on wealthy claims (raider AI: bash, rob, sabotage, flee), structure damage and mending, spike traps, arrow towers |
| `economy.ts`     | Markets, NPC trade, contracts, shipping crates, the Exchange, shop stands                                               |
| `progression.ts` | Knowledge, research, discoveries and the guided first fifteen minutes                                                   |
| `companies.ts`   | Companies and their treasuries                                                                                          |
| `replication.ts` | What each client sees                                                                                                   |

### Factories

- **Power** is recomputed only when a kinetic structure or conveyor changes (or a source switches
  on or off — a crank being turned, an engine running out of coal). The solver's speeds are stored
  on structures and pushed to clients that can see them.
- **Machines** hold input, fuel and output slots. Each tick a machine picks a recipe its inputs
  satisfy (and its mode allows), checks output room and fuel, and advances progress by
  `dt × (rpm / 16) / recipeTime`. Fractional yields accumulate (10 ore → 7 ingots). Output is pushed
  out of the machine's front face into whatever is there.
- **Conveyors** hold items with a progress 0–1 across the tile, at least a quarter tile apart. Belts
  are processed downstream first (a reverse topological order recomputed when belts change), so a
  freed spot is filled the same tick. Splitters and filters choose each item's exit when it enters.
  Anything with an inventory can receive items: belts, machine inputs (never through the output
  face), hoppers, crates, shops.
- **Replication of items.** Instead of streaming positions every tick, the server sends a keyframe
  when an item's motion changes — it enters a tile, stops or starts: `{item, tile, entry side, exit
side, progress, speed, tick}`. Clients render each item at the interpolated server tick by
  advancing progress at that speed from the latest keyframe, clamped to the next keyframe if it has
  already arrived. A straight run of belt costs one message per item per tile.

### Replication

- The full terrain (and region map) is sent once in the welcome message, run-length encoded.
- Nodes, structures and belt items stream by 32 × 32 chunks in a 5 × 5 window around the player.
  Changes (node depleted, structure placed/removed/changed, power speeds, tiles tilled) go only to
  clients that have the chunk.
- Entities within 48 tiles are in every 20 Hz snapshot as compact tuples; appearance changes (held
  item, name) resend the spawn record. Events (swings, hits, wiggles, popups, damage, sounds) travel
  in the snapshot to players in range.
- The snapshot includes the player's exact movement state and the last input sequence processed,
  for reconciliation.

### Persistence

The world is regenerated from its seed; only differences are saved, as one JSON document: changed
nodes, tilled tiles, every structure with its contents (machine slots, belt items, crates, claims,
shop prices), market stocks, contracts, buy orders, bags, drops, carts, farm animals and companies.
Characters are saved separately. Saves happen every 60 seconds, on disconnect and on shutdown.
`FileStorage` writes atomically (temp file + rename); `MemoryStorage` serves tests.

## Client (`ironwild/client`)

- **Game loop** (`game/client-game.ts`) — each frame: keyboard shortcuts, fixed 30 Hz input steps
  (predicted locally with the shared movement code and sent to the server), the server clock
  estimate, entity interpolation 2.3 ticks in the past, camera, renderers, overlay and HUD.
- **Prediction** (`game/prediction.ts`) — on each snapshot the client rewinds to the server state,
  replays unacknowledged inputs and hides any small difference with a decaying offset.
- **Rendering** (`render/`) — PixiJS 8 on WebGL, 64 world pixels per tile. Layers from bottom to top:
  terrain (one 2048² texture at 4 px per tile with linear filtering for soft region blends), chunked
  decoration, floors, low structures (conveyors, shafts), belt items, nodes, solid structures, drops,
  entities, canopies (trees, windmill sails, roofs), effects; then a night tint and additive lights.
  Chunked layers are culled per chunk.
- **Structures** (`render/structures.ts`) — each type has a drawing function producing a static part
  and per-frame animations driven by the structure's real speed: gears (shared geometry) rotate at
  their group's RPM with alternating direction so neighbours mesh, shafts scroll a barber-pole
  texture, water-wheel paddles cycle, windmill sails turn, presses stamp once per quarter turn,
  belts scroll a chevron texture at their speed (curved belts animate marks around the arc).
  Structure item icons are rendered from these drawings.
- **UI** (`ui/`) — plain DOM over the canvas: HUD, windows (inventory and crafting, build, research,
  map and market prices, contracts, help), server-driven panels (trade, containers, machines, shops,
  claims, contract board, exchange), drag-and-drop slots, chat, the smithing minigame, login and
  death screens. Item icons are painted on canvases.
- **Audio** (`audio/sfx.ts`) — synthesized sound effects with distance falloff.
