# Tuff

A grim, top-down multiplayer zombie survival sandbox that runs in the browser. Scavenge houses and
stores, fight zombies up close, treat your wounds and bring supplies back to a shelter — in a
persistent world shared by up to ten players.

The full vision is in [`docs/DESIGN.md`](docs/DESIGN.md). This repository implements the **first
playable milestone** (design plan §91) — one neighborhood, fast combat, logical looting, wounds and
treatment, and a persistent world — plus sleep and cooking, barricades and building, and an
in-browser map editor with procedural generation and generation locking.

## What you can do today

- **Explore Pine Valley**: a 640 × 640 m generated town with 24 buildings (houses with furnished
  rooms, sheds, a cabin, Pine Valley Market, Gas-N-Go, Miller Hardware and the police department),
  roads, sidewalks, yards, fences and woods.
- **Fight**: twin-stick style aiming with a camera that leans toward the mouse, precision aim
  (right click), hip fire, recoil and bloom; 5 firearms with realistic, scarce ammunition; 13 melee
  weapons with arcs, wind-up and knockdowns; shoving to create space. Shots are lag-compensated.
- **Face mixed zombies**: slow walkers, walkers, fast walkers, runners and rare sprinters (55/25/12/6/2 %).
  They see (field of view, light, crouching), hear (gunshots, doors, breaking glass), investigate,
  groan to pull others along into hordes, path through doorways and bang on doors and windows.
- **Scavenge**: 196 data-driven items, 68 loot tables and 465 searchable containers. Loot is logical
  (bathroom cabinets hold medicine, kitchens hold food), searches take time and are remembered, and
  looted containers stay looted for everyone.
- **Manage an inventory**: five quick slots, pockets and backpacks with volume and weight limits,
  encumbrance, drag and drop, context actions, take all, filtering and sorting.
- **Survive**: per-body-part wounds (scratches, lacerations, bites, gunshots, fractures …), bleeding,
  pain, infection, dressings, disinfection, stitches, splints, painkillers and antibiotics; hunger,
  thirst, fatigue and stress.
- **Sleep and cook**: sleep in a bed, on a couch or on the floor (better furniture rests you
  faster); time runs faster while everyone online is asleep. Cook 12 recipes on a stove or a lit
  campfire with a pot or a frying pan; rip cloth, make splints, salvage furniture for planks and
  nails, and make spears and nailed clubs at a workbench.
- **Fortify and build**: nail planks over doors and windows, carry furniture to block doorways, and
  build wooden walls, doors, barricades, fences, gates, floors, storage crates, workbenches and
  campfires. Structures persist, can be repaired, dismantled or broken down by zombies, and crates
  can be locked to you and the players you `/trust`.
- **Die for real**: your body keeps your gear where you fell; you respawn as a new, weakened
  survivor.
- **Play together**: accounts and sessions, chat, a shared persistent world, a 15-minute day/night
  cycle with real darkness and flashlights, and a world that pauses while the server is empty.

## Quick start

Requirements: Node.js 22.12 or newer.

```sh
npm install
npm run dev
```

This starts the game server on port 7777 (restarting on changes) and the Vite dev server on
<http://localhost:5173>. Open it, create an account and you are in. Open a second browser window
(or a private window) with another account to play together.

Without `DATABASE_URL`, the world is saved as JSON files in `./.data`. Delete that folder to reset
the world.

### Controls

| Action                               | Keys                                  |
| ------------------------------------ | ------------------------------------- |
| Move / sprint / crouch               | W A S D / Shift / C (toggle) or Ctrl  |
| Aim / attack / precise aim           | Mouse / left click / hold right click |
| Shove                                | Q or Space                            |
| Reload                               | R                                     |
| Interact / action menu (hold)        | E / hold E                            |
| Quick slots                          | 1 – 5 (press again to lower)          |
| Inventory / health / map             | Tab or I / H / M                      |
| Flashlight / use held item           | F / G                                 |
| Build mode (R rotates, click places) | B                                     |
| Crafting and cooking                 | K                                     |
| Chat / menu                          | Enter or T / Esc                      |
| Zoom                                 | Mouse wheel, + / −                    |
| Debug overlay                        | F3                                    |

## Running a server

```sh
npm run build   # client → client/dist, server → server/dist/main.js
npm start       # serves the game and the client on http://localhost:7777
```

Or with Docker and PostgreSQL:

```sh
TUFF_ADMINS=yourname docker compose up --build
```

### Configuration

Gameplay settings live in [`data/config/server.json`](data/config/server.json) (player cap, PvP,
day length, zombie distribution, loot abundance, death rules, starting items). Environment
variables:

| Variable                                                               | Meaning                                                              |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `PORT`, `HOST`                                                         | Listen address (default `0.0.0.0:7777`)                              |
| `DATABASE_URL`                                                         | PostgreSQL connection string; without it saves go to `TUFF_SAVE_DIR` |
| `TUFF_SAVE_DIR`                                                        | Directory for JSON saves (default `./.data`)                         |
| `TUFF_CLIENT_DIR`                                                      | Built client to serve (default `client/dist`)                        |
| `TUFF_ADMINS`                                                          | Comma-separated usernames with admin rights                          |
| `TUFF_TRUST_PROXY`                                                     | `1` to honour `X-Forwarded-For` behind a reverse proxy               |
| `TUFF_ORIGINS`                                                         | Comma-separated allowed WebSocket origins (default: any)             |
| `TUFF_SERVER_NAME`, `TUFF_PVP`, `TUFF_MAX_PLAYERS`, `TUFF_DAY_SECONDS` | Override `server.json`                                               |

`server.json` also takes optional `sleep.fastForward` (clock multiplier while everyone is asleep,
default 8) and `building.griefing` / `building.maxPerPlayer` (whether players can damage other
players' structures — defaults to the PvP setting — and a per-account cap, default 400).

Admins can use chat commands: `/tp x y`, `/time hour`, `/give item [qty]`, `/heal`,
`/zombies n`, `/clear [radius]`, `/save`, `/kit build|cook` and `/help`. Everyone can use `/who`,
and `/trust name`, `/untrust name` and `/trusted` to share their locked storage.

### Map editor

Admins open the editor at `/editor` (for example <http://localhost:7777/editor>). It draws the map
with the game's own renderer and has tools for terrain, biomes, roads, fences, buildings (with
interior editing and regeneration), props, zombie zones and spawn points, full undo/redo and a
layer panel with visibility and lock toggles.

The **Generate** tool (X) runs the procedural generators over the whole map or a dragged area:
paint biomes (suburb, town, city, forest, farmland …) first, then generate terrain, a street grid,
parcels with buildings and nature. Everything the generators create is tagged; **Regenerate
unlocked** replaces only generated content that is not locked, so anything placed or edited by hand
and anything you lock (per element, per area or per terrain chunk) is kept.

**Save** writes `data/maps/<id>.json` on the server; **Publish** rebuilds the live world from it
and connected players reconnect automatically; **Play from here** does both and drops you into the
game where the editor was looking, with a way back from the Esc menu.

## Development

```sh
npm test               # unit + integration tests (real HTTP/WebSocket bot clients)
npm run typecheck      # shared, server and client
npm run validate:data  # checks every item, loot table, prop and zombie definition
npm run load-test      # 10 bots against an in-process server; reports tick time and bandwidth
npm run generate:map   # regenerates data/maps/prototype.json from the procedural generator
npm run format         # Prettier
```

Set `TEST_DATABASE_URL` to also run the storage tests against PostgreSQL.

### Project layout

```
shared/   Simulation code used by both sides: math, ECS, binary protocol, collision, movement and
          weapons (stepPlayer), body/wounds, inventory and crafting rules, structures, map format,
          map validation and procedural generators (including area generation and locking).
server/   Authoritative Node.js server: HTTP + WebSocket, auth, persistence (PostgreSQL / files /
          memory), game loop, zombies, combat, loot, sleep, crafting, building, editor API,
          replication.
client/   Browser client: PixiJS rendering, lighting and line of sight, prediction, input, audio, UI,
          and the map editor (client/src/editor, loaded only on /editor).
data/     Content as JSON: items, loot tables, props, recipes, constructions, zombie archetypes,
          server config, maps.
docs/     Design plan, architecture notes and roadmap.
```

Content is data: adding an item, a loot table, a recipe, a buildable structure or a piece of
furniture needs no code — edit the JSON in `data/` and run `npm run validate:data`.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how the pieces fit together and
[`docs/ROADMAP.md`](docs/ROADMAP.md) for what is done and what comes next.
