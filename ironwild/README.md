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
| Factory overview / company             | O / C                         |
| Standings: ambitions and leaders       | L                             |
| Drop selected (Ctrl: whole stack)      | Q                             |
| Chat (`/help` for commands) / help     | Enter / H                     |
| Zoom                                   | Mouse wheel                   |

## What you can do

- **Gather** from 24 kinds of resource nodes across a 512 × 512 island: meadows, forest, highlands,
  mountains, fertile plains, marshes and desert. Nodes deplete and regrow; better tools gather more
  and reach richer deposits.
- **Trade** with 20 NPC professions in four settlements — Westhaven (the river town), Stonehaven
  (mining village), Greenfield (farming village) and Port Meridian, the harbour on the south coast,
  where ships bring spices, silk and tea to carry inland and an export agent pays top Crest for
  gears, plates and machines. Prices follow each town's stock: sell too much
  of one thing and the price falls, then recovers over a day or so. Ore is cheap in Stonehaven, food
  is cheap in Greenfield, tools are dear there — trade routes emerge. Trade makes a settlement
  prosper, and prosperous villages open new stalls (a lumber merchant, butcher, engineer, …).
  Market news — an iron shortage, a harvest festival, a timber glut — moves a town's prices for a
  day or so.
- **Craft** by hand, at a workbench or by a campfire, and **forge** at an anvil with a timing
  minigame that decides quality (Crude → Masterwork, worth 0.6× to 3×).
- **Build** walls, doors, floors, fences, beds, chests and land claims (with Manager / Builder /
  Worker / Visitor permissions).
- **Power machines** with water wheels, windmills, hand cranks and steam engines. Rotation travels
  through shafts and gearboxes; speed gearboxes double speed (and stress). Every network has a
  stress capacity — overload it and everything stalls.
- **Electrify**: generators on a rotation network feed power poles, which string cables to each
  other; electric motors turn power back into rotation anywhere on the grid, lamps light the
  night, lathes turn springs, valves and precision gears, and packagers crate goods for export.
  A steam turbine (research Power Plants) makes 2,000 power straight from one boiler's steam.
- **Strike oil**: a pumpjack over a tar seep in the desert pipes crude to a refinery for fuel oil,
  lubricant (which keeps machines from wearing) or plastic for circuit boards.
- **Raise steam**: a mechanical pump on the river bank lifts water into pipes; a coal-fired boiler
  turns it into steam; pipe the steam to engines (32 RPM, 256 torque each). Pipes show what they
  carry and how full they are; tanks buffer a network.
- **Automate**: crushers, ore washers, presses (plates, gears, rods, wire), millstones, saws,
  assemblers, furnaces, ovens and blast furnaces; conveyors (straight and curved), splitters,
  filters, hoppers, storage and shipping crates. Crushing and washing before smelting turns 10 ore
  into 10 ingots instead of 7. Stand a mechanical drill (research Deep Mining) over an ore vein,
  a coal seam or a rock and turn it: it mines without end and pushes out what it digs. A
  storehouse holds 72 stacks; a lubricator beside your machines keeps them oiled so they never
  wear.
- **Run the factory**: the overview (O) shows output and value per minute, utilization, problems
  and bottleneck hints. Overclock machines to 125 % or 150 % for disproportionately more stress or
  fuel; machines wear slowly and an iron gear repairs them.
- **Earn** from contracts (bulk orders with early-delivery bonuses), shipping crates that sell at
  dawn, shop stands for other players, and buy orders on the Exchange.
- **Research** 18 topics with knowledge earned by discovering, crafting, trading, completing
  contracts and running machines; some need blueprints found on bandits or sold by engineers.
- **Survive** hunger, wolves, boars, bears and a bandit camp. Dying drops a quarter of your
  resources in a bag — go back for it.
- **Defend** what you build: a wealthy claim occasionally draws a bandit raid (announced a little
  in advance). Raiders smash through walls, doors and fences, rob chests and crates, wreck machines,
  and run off with the loot — kill them to get it back. Spike traps and arrow towers (loaded with
  arrows by hand or conveyor) help; damaged walls mend after the raid.
- **Fish** rivers, Mirror Lake and the sea with a rod: cast, wait for the float to dip, click.
  Each water has its own fish; now and then you pull up a boot, salvage or a lost purse. Salvage
  the ruins, the old mine and shipwrecks on the beaches for scrap, parts and the odd treasure.
- **Farm** (till, plant wheat, carrots, potatoes, cotton), keep chickens, sheep and cows, pull a hand
  cart, ride a horse and hitch a wagon to it.
- **Lay rails**: minecarts run along them on their own, stop at stations to load from a chest (or
  a machine's output) and unload into a crate, a machine or a conveyor, and turn back at the end
  of the line; E flips a junction's switch or a station's mode, G reverses a cart.
- **Found a company** (C): pool a treasury, hand your land and factories to it, make trusted
  partners officers; company shop stands and shipping crates pay the treasury.
- **Build up the towns**: each settlement's contract board has a town project — a mill wheel, a
  warehouse, a clock tower, a lighthouse. Deliver the goods for a little over market; finish it and
  the building goes up in town, the town grows and its markets deepen.
- **Make a name** (L): climb the wealth ladder from Homesteader (₡5,000) to Industrialist
  (₡10,000,000) — your title shows under your name — and chase the endgame feats: a ₡100,000 day,
  a steelworks, a freight network, a power company, a trade baron's hold on one town, and machines
  that add ₡100,000 of value in a day. The standings rank everyone by worth, the day's takings and
  prestige, and show who sells the most in each town.
- **Raise a monument** (research Grand Works): a Stone Obelisk, a Grand Fountain (rest by it to
  get your wind back), a Statue of Industry and a Beacon of Progress that lights up the valley at
  night. They cost a fortune in bricks, gold, steel, gears and circuits, stand for good once
  raised, show on every map, and trade wealth for prestige.

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
`/give`, `/tp`, `/time`, `/crests`, `/kp`, `/spawn`, `/raid`, `/event`, `/project` (finish the nearest
town's project), `/research all`, `/heal` and `/save`.

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
