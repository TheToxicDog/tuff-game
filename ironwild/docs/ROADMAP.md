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

| #   | Phase                          | Status | Notes                                                                                                                                                        |
| --- | ------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Movement, gathering, inventory | ✅     | Predicted movement, sprint, dodge; 24 node types with tool tiers and regrowth; slot inventory with backpacks up to 40 slots, drag and drop, quality stacks.  |
| 2   | Town and NPC economy           | ✅     | 17 professions, each buying and selling different goods; General Stores buy anything cheaply (§47).                                                          |
| 3   | Crafting and blacksmithing     | ✅     | Hand, workbench and campfire crafting; anvil smithing minigame with Crude → Masterwork quality (§16–17).                                                     |
| 4   | Building                       | ✅     | Grid placement with ghost preview, walls, doors, floors, fences, beds, chests, land claims with five permission levels (§43–44).                             |
| 5   | Mechanical power               | ✅     | Kinetic networks with RPM, torque/stress, gear ratios, stalls and locked gears (§20–22). Everything visibly turns.                                           |
| 6   | Conveyors and automation       | ✅     | Individual items on conveyors (straight and curved), splitters, filters, hoppers, crates; machines push output forward (§23–24).                             |
| 7   | Dynamic supply and demand      | ✅     | Stock-based prices with recovery, regional factors, contracts, a market report on the map. Trading grows settlement prosperity, which deepens markets.       |
| 8   | Multiplayer trading            | ✅     | Shop stands (paid while offline), buy orders with escrow on the Exchange, `/pay` (§33–34).                                                                   |
| 9   | Agriculture and animals        | ✅     | Tilling, four crops, chickens/sheep/cows producing eggs/wool/milk, pens with gates.                                                                          |
| 10  | Vehicles and logistics         | 🟡     | Hand carts (24 slots) and horses; shipping crates sell automatically at dawn (§35). Missing: wagons, trucks, rail, depots.                                   |
| 11  | Steam technology               | 🟡     | Steam engines (coal + water, 32 RPM, 256 torque) and blast furnaces for steel. Missing: boilers, pumps and pipes.                                            |
| 12  | Industrial technology          | 🟡     | Assemblers make bearings, gearbox units and industrial pumps. Missing: electricity, motors, machine tools, packaging.                                        |
| 13  | Company systems                | 🟡     | Companies with a treasury; members share access to each other's land, carts and animals. Missing: company-owned property and shops, officer roles in the UI. |
| 14  | Expanded world economy         | ⬜     | More settlements (Port Meridian), oil, market events, town growth unlocking new traders (§54).                                                               |

## Next up

- Factory statistics: production, revenue and profit per minute, utilization and bottleneck hints
  for a whole network (§59).
- Overclocking machines (faster, less efficient) and gentle maintenance (§60–61).
- Occasional bandit raids on wealthy, undefended factories; walls and gates that can be damaged
  (§42).
- Town development: prosperity unlocking new traders and buildings in villages (§54).
- Fishing, salvage quests and economic quests beyond contracts (§11, §53).
- Tier 3–4 technology, wagons and rail, prestige projects (§19, §36, §64).
