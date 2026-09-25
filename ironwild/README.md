# IRONWILD

A top-down multiplayer gathering, trading and factory-building sandbox that runs in the browser.
It starts like MooMoo.io — chop a tree, mine a rock, sell it in town, buy a better pickaxe — and
slowly opens up into a production game: water wheels turning shafts, gearboxes trading speed for
torque, crushers and presses fed by conveyors carrying individual items, and a regional economy
whose prices move with supply and demand.

> **Everything can become a business.**

The full design is in [`docs/DESIGN.md`](docs/DESIGN.md), what is done and what comes next in
[`docs/ROADMAP.md`](docs/ROADMAP.md), and how it works in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
IRONWILD lives next to Tuff (the zombie game) in this repository and shares none of its code at
runtime.

## Play it

Requirements: Node.js 22.12 or newer.

```sh
npm install
npm run ironwild:dev
```

That starts the game server on port 7780 and the Vite dev server on <http://localhost:5180>. Open
it, create an account and you are in Westhaven. A second browser window (or a private one) with
another account plays alongside you.

Saves go to `./.data/ironwild` as JSON; delete the folder to reset the world.

### Production

```sh
npm run ironwild:build   # client → ironwild/client/dist, server → ironwild/server/dist/main.js
npm run ironwild:start   # serves the game and the client on http://localhost:7780
```

### Controls

| Action                                 | Keys                          |
| -------------------------------------- | ----------------------------- |
| Move / sprint / dodge                  | W A S D / Shift / Space       |
| Aim / use tool or attack               | Mouse / left click (hold)     |
| Heavy blow                             | Hold left click with a weapon |
| Eat, block, till, plant                | Right click                   |
| Interact (hold on a hand crank)        | E                             |
| Pick up / pull a cart, ride a horse    | F / G                         |
| Hotbar                                 | 1 – 8                         |
| Inventory & crafting                   | Tab or I                      |
| Build / rotate while building / cancel | B / R / right click           |
| Research / contracts / map & prices    | K / J / M                     |
| Drop selected (Ctrl: whole stack)      | Q                             |
| Chat (`/help` for commands) / help     | Enter / H                     |
| Zoom                                   | Mouse wheel                   |

## What you can do

- **Gather** from 24 kinds of resource nodes across a 512 × 512 island: meadows, forest, highlands,
  mountains, fertile plains, marshes and desert. Nodes deplete and regrow; better tools gather more
  and reach richer deposits.
- **Trade** with 17 NPC professions in three settlements — Westhaven (the river town), Stonehaven
  (mining village) and Greenfield (farming village). Prices follow each town's stock: sell too much
  of one thing and the price falls, then recovers over a day or so. Ore is cheap in Stonehaven, food
  is cheap in Greenfield, tools are dear there — trade routes emerge.
- **Craft** by hand, at a workbench or by a campfire, and **forge** at an anvil with a timing
  minigame that decides quality (Crude → Masterwork, worth 0.6× to 3×).
- **Build** walls, doors, floors, fences, beds, chests and land claims (with Manager / Builder /
  Worker / Visitor permissions).
- **Power machines** with water wheels, windmills, hand cranks and steam engines. Rotation travels
  through shafts and gearboxes; speed gearboxes double speed (and stress). Every network has a
  stress capacity — overload it and everything stalls.
- **Automate**: crushers, ore washers, presses (plates, gears, rods, wire), millstones, saws,
  assemblers, furnaces, ovens and blast furnaces; conveyors (straight and curved), splitters,
  filters, hoppers, storage and shipping crates. Crushing and washing before smelting turns 10 ore
  into 10 ingots instead of 7.
- **Earn** from contracts (bulk orders with early-delivery bonuses), shipping crates that sell at
  dawn, shop stands for other players, and buy orders on the Exchange.
- **Research** 17 topics with knowledge earned by discovering, crafting, trading, completing
  contracts and running machines; some need blueprints found on bandits or sold by engineers.
- **Survive** hunger, wolves, boars, bears and a bandit camp. Dying drops a quarter of your
  resources in a bag — go back for it.
- **Farm** (till, plant wheat, carrots, potatoes, cotton), keep chickens, sheep and cows, pull a hand
  cart, ride a horse, and found a **company** with a shared treasury.

## Running a server

Environment variables:

| Variable                  | Meaning                                                |
| ------------------------- | ------------------------------------------------------ |
| `PORT`, `HOST`            | Listen address (default `0.0.0.0:7780`)                |
| `IRONWILD_SAVE_DIR`       | Save directory (default `./.data/ironwild`)            |
| `IRONWILD_STORAGE=memory` | Keep nothing on disk                                   |
| `IRONWILD_CLIENT_DIR`     | Built client to serve (default `ironwild/client/dist`) |
| `IRONWILD_ADMINS`         | Comma-separated usernames with admin commands          |
| `IRONWILD_TRUST_PROXY`    | `1` to honour `X-Forwarded-For` behind a proxy         |
| `IRONWILD_ORIGINS`        | Allowed WebSocket origins (default: any)               |
| `IRONWILD_NAME`, `_MOTD`  | Server name and message of the day                     |
| `IRONWILD_PVP`            | `1` enables PvP outside settlements                    |
| `IRONWILD_MAX_PLAYERS`    | Player cap (default 30)                                |
| `IRONWILD_DAY_SECONDS`    | Real seconds per game day (default 1200)               |
| `IRONWILD_SEED`           | World seed                                             |

Everyone can use `/who`, `/pay`, `/c` (company chat), `/company …` and `/stuck`. Admins also get
`/give`, `/tp`, `/time`, `/crests`, `/kp`, `/spawn`, `/research all`, `/heal` and `/save`.

## Development

```sh
npm test                  # includes IRONWILD's shared and server tests
npm run ironwild:typecheck
npm run ironwild:load-test  # 20 bots against an in-process server
npm run format
```

```
ironwild/
  shared/   Content tables, world generation, movement, the kinetic solver, belt geometry,
            pricing, inventory rules and the network protocol.
  server/   Authoritative server: sessions, persistence, the tick loop and every game system.
  client/   PixiJS renderer, prediction, input and the DOM UI.
  docs/     Design, architecture and roadmap.
```
