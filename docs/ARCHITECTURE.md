# Architecture

How the pieces fit together. Section numbers (§) refer to [`DESIGN.md`](DESIGN.md).

## Overview

```
 Browser (client/)                              Node.js (server/)
 ┌──────────────────────────────┐   WebSocket   ┌────────────────────────────────────┐
 │ input → ActionState          │  binary: 60 Hz│ ClientSession (rate limits, parsing) │
 │   → PlayerInput (quantised)  │ ─────inputs──▶│   → Game.receiveInputs             │
 │ Prediction (stepPlayer)      │               │ Game.step() at 20 Hz:              │
 │ EntityStore (interpolation)  │ ◀──snapshots──│   players (stepPlayer) · zombies    │
 │ ClientWorld (chunks, objects)│ binary: 20 Hz │   noise · spawner · expiry          │
 │ Renderer (PixiJS layers)     │               │   replicate() per client           │
 │ UI (DOM)                     │ ◀─JSON msgs──▶│ JSON: chunks, inventory, status,   │
 └──────────────────────────────┘               │ containers, chat, notices          │
                                                │ Storage: PostgreSQL / files / memory│
                                                └────────────────────────────────────┘
                      shared/: protocol, stepPlayer, collision, body, inventory, map format
```

The server is authoritative for everything. Clients send inputs and requests; the server
validates them and answers with state.

## Shared simulation (`shared/`)

- **`sim/player.ts` — `stepPlayer`** is the single definition of how a player moves, sprints,
  crouches, aims, shoots, swings, shoves and reloads. The server runs it for every input it
  receives; the client runs the identical code to predict its own character. Weapon spread is
  derived from a hash of the entity id and input sequence number, so both sides agree on where
  every pellet goes.
- **`world/collision.ts`** — circles and oriented boxes in a 4 m uniform grid, with block flags
  (player, zombie, sight, bullet) and material tags for impacts. Raycasts use grid traversal.
- **`world/compile.ts` — `CompiledWorld`** turns map elements into colliders and interactive
  objects (doors, windows, containers) and tracks their runtime state as deltas over the map
  defaults. The client compiles the same elements from streamed chunks, so prediction collides
  with exactly what the server collides with. It also tracks barricade boards (a door or window
  with boards blocks movement; two or more also block sight and bullets), picked-up furniture,
  sleep spots, crafting stations and player structures, which compile like building parts.
- **`world/structures.ts`** — footprints, grid/rotation snapping and placement rules for player
  construction, shared so the client's placement ghost agrees with the server.
- **`items/crafting.ts`** — recipe and construction requirements (ingredients by item or tag,
  tools, stations) and which inventory stacks a recipe consumes.
- **`network/protocol.ts`** — binary codecs for inputs and snapshots and the JSON message types.
- **`sim/body.ts`**, **`items/inventory.ts`** — wounds, bleeding, infection, treatments, needs;
  inventory model, capacities and encumbrance. Used by the server to simulate and by the client to
  display (capacity bars, treatment buttons).
- **`ecs/world.ts`** — a small sparse-set ECS used by the server for players, zombies, corpses
  and ground items (§78).

## Networking (§75–77)

- **Tick rates.** The server simulates at 20 Hz. Clients step their input at a fixed 60 Hz and
  send the steps in batches. The server consumes inputs through a per-player budget, so a client
  cannot move faster than real time.
- **Snapshots.** Every tick each client gets one binary snapshot: its own authoritative
  `PlayerSimState` plus the sequence number of the last input processed, events near it (shots,
  swings, hits, sounds), and entity spawns, delta updates (only changed fields) and despawns
  relative to what that client already knows. WebSockets are reliable and ordered, so deltas
  against the per-client known state are safe.
- **Interest management.** Entities are replicated within 72 m of the player; events have their
  own audible/visible radius. Map chunks (64 × 64 m) stream in a 5 × 5 window around the player
  and are dropped when far away.
- **Prediction and reconciliation.** The client applies each input immediately. When a snapshot
  arrives it rewinds to the server state, replays the unacknowledged inputs and hides any
  difference with a decaying visual offset. Movement corrections are rare because both sides run
  the same deterministic code on the same quantised inputs (see `client/src/game/prediction.test.ts`).
- **Interpolation.** Other players and zombies are rendered about two ticks in the past (plus
  measured jitter), blending between snapshots.
- **Lag compensation.** Each input carries the server tick the client was looking at. Hitscan
  shots and melee swings are resolved against zombie positions rewound to that tick (up to 400 ms).

## Server (`server/`)

- **`bootstrap.ts`** builds the HTTP server (auth API, status, static client, `/ws` upgrade), the
  `Game` and the `AuthService`. `main.ts` reads environment variables and handles shutdown saves.
- **Authentication.** scrypt password hashes, random session tokens stored only as SHA-256 hashes
  (30-day expiry), constant-time failure paths, per-IP and per-account rate limits. One connection
  per account; the newest login wins.
- **`game/players.ts`** consumes inputs through `stepPlayer`, wiring its hooks to combat, noise
  and inventory; advances timed actions (search, eat, treat), bleeding, needs, flashlight battery
  and map exploration; sends a compact status when it changes.
- **`game/zombies.ts`** — perception (field of view, light level, crouching, flashlights,
  awareness build-up), investigation of noises, chasing with A* paths from `navigation.ts`,
  telegraphed attacks, staggers and knockdowns, and banging on doors and windows that block the
  way. `noise.ts` turns noisy actions into investigation targets; walls muffle sound, and groaning
  zombies attract others, which is how hordes form (§13–15).
- **`game/spawner.ts`** — zone populations. Zombies in chunks nobody is near are stored as
  dormant records and cost nothing; they become entities when a player approaches. Killed zombies
  lower the zone's population, which slowly recovers only where no player is watching (§16).
- **`game/combat.ts`** — pellets, penetration, falloff, top-down headshots, glass that shatters,
  melee arcs with multiple targets, shoves, zombie hits that inflict wounds on body parts.
- **`game/loot.ts` + `inventory.ts`** — containers roll loot from their tables the first time
  anyone opens them (so the world is not generated up front) and remember their contents; every
  inventory move is validated for range, capacity and weight.
- **`game/survival.ts`** — sleep (bed quality sets the energy recovery rate, sleeping players
  are harder for zombies to notice, damage wakes you, and the clock fast-forwards while every
  online player sleeps) and timed crafting/cooking next to the required station.
- **`game/building.ts`** — barricading, construction, repair, dismantling, furniture pickup and
  storage permissions (owner, `/trust` list, admins, and whether others may damage structures).
  Zombies path around structures, bang on them when they block the way, and `navigation.ts`
  rebuilds affected portals when structures appear or disappear.
- **Editor API (`networking/http.ts`).** Admin-only endpoints list, load, validate and save maps
  under `data/maps/` and publish one: `bootstrap.ts` stops the running `Game` with close code
  4002 (clients reconnect on their own), builds a new one from the published map and keeps the
  saved world deltas, populating only zones that are new.
- **Empty server pause (§52).** With nobody online the tick loop still runs, but the world clock,
  needs, zombies and spawning do not advance.

## Persistence (§51)

The base map is static data. Everything that changes is stored as a delta:

| What                      | Stored as                                              |
| ------------------------- | ------------------------------------------------------ |
| Doors, windows            | open / locked / broken / hit points / barricade boards |
| Furniture                 | picked up (removed from the map)                       |
| Player structures         | kind, position, rotation, owner, hit points, lock      |
| Trust lists               | whose locked storage each player may open              |
| Containers                | contents once rolled, "searched" flag                  |
| Corpses, dropped items    | persistent entities with expiry times                  |
| Zombies away from players | dormant records per chunk                              |
| Zones                     | remaining population and respawn timers                |
| Buildings                 | building-level loot decisions (e.g. the house handgun) |
| Characters                | position, body, needs, inventory, stats, explored map  |

Changes are collected in memory and written in batches every 30 seconds and on shutdown. The
PostgreSQL backend (migrations, batched `unnest` upserts) is used in production; a JSON file
backend makes local development zero-setup, and an in-memory backend serves tests.

## Map and content (§32–50, §29–31)

- **Maps** (`data/maps/*.json`) contain terrain (a 1 m material grid, run-length encoded per
  chunk), road splines, buildings (rooms, walls, doors, windows, furniture, roof), props, fences,
  zones and spawn points. `shared/src/world/gen/` holds the procedural generators — house, shed and
  cabin layouts, the grocery store, gas station, hardware store and police station, terrain
  painting and Poisson-disc scattering — and `generatePrototypeTown()` assembles Pine Valley.
  `npm run generate:map` writes it to disk.
- **Biomes and generation locking.** An optional biome grid (16 m cells) tells the area
  generators (`gen/area.ts`) what to build: ground materials, street grids, parcels with
  buildings, trees and undergrowth. Every generated element records the generator layer that made
  it (`gen`); elements placed or edited by hand are marked `manual`, and any element can be
  `locked`, as can terrain chunks (`terrainLocked`). Regenerating an area replaces only generated,
  unlocked elements on painted biomes and treats everything it keeps as an obstacle.
  `validate-map.ts` checks maps coming from the editor before they are saved.
- **Content** (`data/items`, `data/loot`, `data/world/props.json`, `data/recipes`,
  `data/construction`, `data/zombies`) is validated at startup and by `npm run validate:data`. Clients receive the item, prop and zombie definitions in
  the welcome message; items travel over the network as indices into that list.

## Client (`client/`)

- **Rendering (§79–86)** — PixiJS 8 on WebGL, world units in meters (48 px per meter at zoom 1).
  Layers from bottom to top: terrain (one shader quad that blends neighbouring materials with
  noise), roads, ground props, building floors, decals (blood, bullet marks), low furniture and
  props, items, corpses, characters, walls/doors/windows, tall furniture, particles, tree
  canopies (fade when you walk under them), roofs (fade out when you enter the building) and
  muzzle flashes/tracers. All textures are painted procedurally at startup.
- **Line of sight and light** — a visibility polygon is cast from the player each frame; walls,
  closed doors, tall furniture and wooden fences block it. A half-resolution light map is filled
  with the time-of-day ambient light inside the polygon (and on roofs seen from above), dim
  "remembered" light outside it, plus additive flashlight cones and muzzle flashes; it is
  multiplied over the scene. Entities outside the polygon fade out.
- **Input (§4–5)** — keyboard and mouse write into an abstract `ActionState`; gameplay code only
  reads actions, so touch or gamepad input can be added as another source.
- **Audio (§87)** — all sounds are synthesised at startup (gunshots, zombies, doors, footsteps by
  surface) and played with distance attenuation, low-pass filtering and stereo panning.
- **UI** — plain DOM over the canvas: HUD, inventory/loot, health, map, chat, menus, the hold-E
  action menu, crafting screen and build panel.
- **Map editor (`src/editor/`, §33–47)** — loaded only on `/editor`. It streams the edited map
  into the same `ClientWorld` and renderers the game uses, so what you see is what players see.
  Every change goes through a `Transaction` that records before/after states, which makes
  undo/redo exact even for regenerating the whole map; after each change only the affected
  chunks are re-streamed.
