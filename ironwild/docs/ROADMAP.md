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
| 14  | Expanded world economy         | 🟡     | Port Meridian with imports and exports; town growth opens new stalls (§54); market events move a town's prices for a day. Missing: oil, more towns.          |

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
- Port Meridian (§14): a harbour town with a pier and a moored ship; a fishmonger, an importer
  (spices, silk, tea, steel, glass) and an export agent who pays best for finished goods.

## Next up

- Salvage quests in ruins and wrecks, and economic quests beyond contracts (§11, §53).
- Boilers, pumps and pipes; wagons, depots and rail (§19, §36).
- Tier 3–4 technology and prestige projects (§64).
