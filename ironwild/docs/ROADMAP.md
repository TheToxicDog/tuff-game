# IRONWILD — Roadmap and status

Phases follow [`DESIGN.md` §67](DESIGN.md#6567-prototype-vertical-slice-development-order).
✅ done · 🟡 partly done · ⬜ not started.

## Prototype (§65) — ✅

The core test is playable: mine iron and sell it to the Westhaven blacksmith; or smelt it in a
furnace and sell ingots for more; or put a water wheel on the river, connect a crusher, washer and
press with shafts, gearboxes and conveyors, and sell gears for considerably more.

## Vertical slice (§66) — ✅

| Requirement                                         | Status                                                                |
| --------------------------------------------------- | --------------------------------------------------------------------- |
| 1 major town, 2 villages                            | ✅ Westhaven, Stonehaven (mining), Greenfield (farming)               |
| Forest, plains, mountain, mine, river, farmland     | ✅ plus highlands, marshes, desert, a lake, ruins and Deepcut Mine    |
| Bandit camp                                         | ✅ bandits guard it (and a couple more at the mine)                   |
| Wood, stone, coal, iron, copper, wheat, food, steel | ✅ plus silver, gold, gems, clay, sand, salt, cotton, animal products |
| Water wheel, windmill, shaft, gearbox               | ✅ plus hand crank, speed gearbox and steam engine                    |
| Crusher, millstone, press, furnace                  | ✅ plus ore washer, saw, oven, blast furnace, assembler               |
| Conveyor, hopper, splitter, storage                 | ✅ plus filters, shipping crates, shop stands                         |

## Phases

| #   | Phase                          | Status | Notes                                                                                                                                                         |
| --- | ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Movement, gathering, inventory | ✅     | Predicted movement, sprint, dodge; 24 node types with tool tiers and regrowth; slot inventory with backpacks up to 40 slots, drag and drop, quality stacks.   |
| 2   | Town and NPC economy           | ✅     | 17 professions, each buying and selling different goods; General Stores buy anything cheaply (§47).                                                           |
| 3   | Crafting and blacksmithing     | ✅     | Hand, workbench and campfire crafting; anvil smithing minigame with Crude → Masterwork quality (§16–17).                                                      |
| 4   | Building                       | ✅     | Grid placement with ghost preview, walls, doors, floors, fences, beds, chests, land claims with five permission levels (§43–44).                              |
| 5   | Mechanical power               | ✅     | Kinetic networks with RPM, torque/stress, gear ratios, stalls and locked gears (§20–22). Everything visibly turns.                                            |
| 6   | Conveyors and automation       | ✅     | Individual items on conveyors (straight and curved), splitters, filters, hoppers, crates; machines push output forward (§23–24).                              |
| 7   | Dynamic supply and demand      | ✅     | Stock-based prices with recovery, regional factors, contracts, a market report on the map. Trading grows settlement prosperity, which deepens markets.        |
| 8   | Multiplayer trading            | ✅     | Shop stands (paid while offline), buy orders with escrow on the Exchange, `/pay` (§33–34).                                                                    |
| 9   | Agriculture and animals        | ✅     | Tilling, four crops, chickens/sheep/cows producing eggs/wool/milk, pens with gates.                                                                           |
| 10  | Vehicles and logistics         | ✅     | Hand carts, horse wagons (48 slots), railways: minecarts that run on their own, stations that load and unload, junction switches; shipping crates (§35–36).   |
| 11  | Steam technology               | ✅     | Pumps lift river water into pipes, coal-fired boilers make steam, steam engines turn it into 32 RPM / 256 torque; tanks buffer; blast furnaces for steel.     |
| 12  | Industrial technology          | ✅     | Generators, power poles and wires, electric motors and lamps; lathes turn springs, valves and precision gears; packagers crate goods; assemblers.             |
| 13  | Company systems                | ✅     | Companies own land handed to them and everything on it; owner / officer / member roles; company shops and shipping pay the treasury, with a day's ledger (C). |
| 14  | Expanded world economy         | ✅     | Port Meridian with imports and exports; oil (pumpjacks, refineries: fuel oil, lubricant, plastic, circuit boards); town growth; market events; town projects. |

## Also done

- Factory overview (O): output, value per minute, utilization, problems and bottleneck hints (§59).
- Overclocking to 125 % / 150 % for 1.6× / 2.3× the stress or fuel; gentle wear repaired with an
  iron gear (§60–61).
- Bandit raids on wealthy claims while their owner is around: announced, they bash through walls,
  rob storage, sabotage machines and flee with loot; spike traps and arrow towers; damaged
  structures mend afterwards (§42).
- Fishing in rivers, the lake and the sea, with salvage and lost purses (§11).
- Market events (§14): iron and coal shortages, festivals, bad harvests, building booms, bandit
  scares, gluts — announced as market news and shown on the market report.
- Shipwrecks on the beaches to salvage for hardwood, rope, scrap and the odd treasure (§11).
- Steam (§19): mechanical pumps, pipes that join into networks holding one fluid, fluid tanks,
  boilers (water in at the back and sides, steam out the front) and steam engines that run on piped
  steam. One pump feeds one boiler; one boiler feeds two engines.
- Oil (§25–27): black seeps in the desert (the Tar Flats); pumpjacks stood over them pipe crude oil
  to electric refineries making fuel oil (a long-burning fuel), lubricant (repairs a machine and
  stops its wear for a day) or plastic, which assemblers turn into circuit boards.
- Electricity (§19): generators (100 power from 64 stress at 16 RPM) feed grids of poles that wire
  themselves together within 9 tiles; devices use a pole within 3. Electric motors (48 torque for
  100 power — power back to rotation loses a quarter), lamps, lathes (springs, valves, precision
  gears) and packagers (crates of ten, worth more than loose). Short grids share power out evenly.
- Railways (§36): rails join their neighbours (straight, curves, junctions with a switch); minecarts
  run by themselves, stop at stations to load from or unload into what stands beside the platform,
  and turn back at the end of the line. Horse wagons carry 48 slots.
- Companies (§46): claims (and everything on them) can be handed to a company; members use and
  build on company land, officers pick up, price and manage; company shop stands and shipping
  crates pay into the treasury; the Company window (C) shows members, property and a day's income.
- Port Meridian (§14): a harbour town with a pier and a moored ship; a fishmonger, an importer
  (spices, silk, tea, steel, glass) and an export agent who pays best for finished goods.
- Ambitions and standings (§47–50, §63): a wealth ladder (Homesteader ₡5,000 → Craftsman →
  Workshop Owner → Factory Owner ₡1,000,000 → Industrialist ₡10,000,000; the highest rung is your
  title) and endgame feats — a ₡100,000 day, machines adding ₡100,000 of value in a day, 1,000 steel,
  10,000 items by rail, a 1,000-power grid, ₡250,000 sold in one town, ₡50,000 to town projects, a
  Masterwork. Worth counts Crests, what you carry and everything you own with its contents; a
  company's achievements count for its members. Standings (L) rank players and companies.
- Storehouses and lubricators (§23, §61): a 3×3 storehouse holds 72 stacks, takes conveyors on
  any side and feeds hoppers and rail stations; a lubricator keeps every machine beside it oiled —
  one Lubricant each per game day — so they never wear ("maintenance, later automated"). Arrow
  towers and lubricators only accept their one item, from conveyors or by hand. Every container
  now shows how full it is as it fills.
- Power plants (§64): research Power Plants; a 3×2 steam turbine takes one boiler's steam (20/s)
  through its back and sides and makes 2,000 power for the poles in reach — more than engines and
  generators get from the same steam, and no shafts, at the price of steel, gearbox units,
  bearings, precision gears, wire and valves. Short of steam, it runs at part load.
- Mechanical drills (§62, "big mines tap near-unlimited deposits with machinery"): research Deep
  Mining; a 2×2 drill stood over an ore vein, coal seam or rock (up to tier 2) takes its place and
  mines it without end — one pickaxe load every 3 s at 16 RPM for 48 stress — pushing ore and
  spoil out of its front. Take it away and the vein is back.
- Monuments (§64), the late money sinks: research Grand Works, then a Stone Obelisk (₡8,400 of
  bricks, gold and cut rubies), a Grand Fountain (rest by it to get your wind back and heal), a
  Statue of Industry (₡19,650 of steel, precision gears and gold) and a Beacon of Progress
  (₡26,200; with 40 power it lights up the valley at night). They stand for good once raised,
  appear on every map, and give prestige instead of counting as wealth.
- Motor trucks (§36, "late game: truck"): research Motor Vehicles after Petroleum; a truck (steel,
  gearbox units, bearings, springs, glass, a circuit board) carries 64 slots, drives at 1.9× walking
  pace and 1.35× more on roads, plazas, bridges and floors, but neither sprints nor dodges. It burns
  a fuel oil every 90 tiles from a six-can tank — hold fuel oil and press E on it to fill up — and
  refills itself from fuel oil in its bed; dry, it stops and you climb out. Riders and drivers now
  show their horse or truck under them, facing the way they travel.
- Town projects (§53): every settlement works through a list — Westhaven's mill wheel, warehouse
  and clock tower; Stonehaven's mine lift and food store; Greenfield's granary and windmill; Port
  Meridian's lighthouse and bonded warehouse. Anyone delivers the goods at the contract board for a
  little over market; when the last good is in, the building appears in town, the town prospers
  (and may open new stalls), some markets deepen, and the helpers share a bonus.

## Next up

- Salvage quests in ruins and wrecks, and economic quests beyond contracts (§11, §53).
- Hired guards (§42).
