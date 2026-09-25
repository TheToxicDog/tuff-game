# IRONWILD — Design

> The design north star. What is built so far is tracked in [`ROADMAP.md`](ROADMAP.md); how it is
> built is in [`ARCHITECTURE.md`](ARCHITECTURE.md). Section numbers (§) are referenced from code and
> other docs.

The game begins almost like MooMoo.io with a real economy, then gradually reveals a much deeper
production game. A brand-new player understands "chop tree, mine rock, sell stuff, buy better gear"
within minutes; an experienced player can spend hours optimizing gear ratios, conveyor throughput,
furnace layouts, supply contracts and profit per minute.

## 1. Core concept

IRONWILD is a top-down multiplayer arcade survival, trading, crafting and factory-building sandbox.

> Start with a crude axe and backpack. Gather whatever you can find. Sell it in town. Buy better
> tools. Learn trades. Refine raw materials. Build machines. Automate production. Eventually operate
> an industrial complex that earns more money than manual labor ever could.

It combines MooMoo.io-style immediate gathering and combat, Minecraft-style exploration and
building, Create-style mechanical automation, NPC trading, a simulated regional economy, farming,
mining, blacksmithing, merchant gameplay, crafting, factory design, logistics, multiplayer
cooperation, PvE danger, optional PvP, base building and large-scale industrial progression.

## 2. Design pillars

- **Immediate.** Within 30 seconds a new player understands how to move, gather, craft, sell and
  improve themselves.
- **Economic.** Almost everything has economic value. A rock can be sold raw, crushed, sorted,
  smelted, alloyed, forged, machined or assembled into something significantly more valuable.
- **Systemic.** Players are not told exactly how to make money; they discover opportunities.
- **Progressive automation.** Manual work is useful; automation eventually outperforms it.
- **Arcade survival.** Survival creates pressure but does not constantly annoy.
- **Player freedom.** A rich player can buy almost anything another player might manufacture.

## 3. Camera and controls

True top-down perspective. Characters rotate toward the cursor; combat is responsive rather than
simulation-heavy.

| Key   | Action           |
| ----- | ---------------- |
| WASD  | Move             |
| Mouse | Aim              |
| LMB   | Use tool/attack  |
| RMB   | Secondary action |
| E     | Interact         |
| F     | Pick up          |
| Shift | Sprint           |
| 1–8   | Hotbar           |
| Tab   | Inventory        |
| B     | Building         |
| M     | Map              |

## 4. World structure

Regions: **Meadows** (safe start: trees, stone, berries, animals), **Forest** (timber, hardwood,
herbs, mushrooms, game), **Highlands** (iron, coal, copper, stone, silver), **Fertile Plains**
(wheat, vegetables, livestock), **Marshlands** (clay, peat, medicinal plants), **Desert** (silica,
salt, rare minerals, oil later), **Mountains** (rare metals, gems, very rich deposits).

## 5–6. Settlements and NPC professions

Settlement sizes: outpost, village, town, city, industrial city — larger ones provide more services
and more demand. NPCs are not generic shopkeepers: farmer, miner, lumber merchant, blacksmith,
carpenter, butcher, baker, engineer, machinist, merchant, jeweler, builder, doctor, stable keeper,
tool dealer, industrial supplier. Each profession buys and sells different goods.

## 7. Currency

**Crests (₡)** — account currency, not inventory items. "I'll give you 84 Crests for the lot."

## 8–9. Starting economy and the first fifteen minutes

A new character has ₡25, a stone axe, a stone pickaxe, a small backpack and basic clothes. Starting
prices (placeholders): wood log ₡2, stone ₡1, berries ₡2, raw hide ₡6, iron ore ₡8, copper ore ₡7,
coal ₡5.

The first fifteen minutes: chop trees, mine surface stone, find iron, kill or avoid wildlife, visit
town, sell materials, earn about ₡150, buy an iron pickaxe and a larger backpack, and discover that
processed materials sell for considerably more.

## 10. The economic ladder

RESOURCE → PROCESS → REFINE → MANUFACTURE → ASSEMBLE → DISTRIBUTE. Every stage can add value:
iron ore ₡8 → washed ore ₡11 → ingot ₡19 → plate ₡27 → steel gear ₡55 → gearbox ₡140 → industrial
pump ₡410.

## 11. Ways to make money

Gathering (safe, low margins), mining (riskier, better returns), farming (reliable recurring
income), ranching (eggs, milk, wool, meat, hides), hunting, fishing, blacksmithing (ore → ingot →
tool/weapon/component; craftsmanship raises value), gem cutting (rough ₡180 → cut ₡310 → flawless
₡480), merchant trading (buy cheap, carry, sell dear — coal ₡4 in a mining town, ₡9 in the capital),
salvaging ruins and wrecks, and above all manufacturing.

## 12–14. Dynamic NPC economy, supply and demand, recovery

Every settlement tracks supply, demand, local production, population, consumption and stockpile. A
mining town has cheap iron and expensive food; a farming town the reverse. Each good has a base
value, current supply and demand, and a price floor and ceiling. Selling 1,000 iron bars into a tiny
village lowers the price — you cannot infinitely dump one product on one merchant. Demand recovers
as NPC businesses consume stock.

## 15. Contracts

Settlements periodically issue bulk contracts — "Wanted: 300 iron ingots, 100 coal. Payment ₡9,500.
Bonus ₡1,500 if delivered within 2 days." Factories are perfect for fulfilling these.

## 16. Quality

Crude, Standard, Fine, Excellent, Masterwork — quality changes the price. A skilled smith with good
equipment makes masterwork goods; automation gives consistent quality.

## 17–18. Manual processing

Physical and satisfying but arcade-paced: a sword takes 20–40 seconds, not fifteen minutes. Manual
methods: cheap infrastructure, high involvement, decent margins, poor scalability — the incentive
to automate.

## 19. Factory progression

- **Tier 0 — Hand production:** workbench, campfire, basic furnace, anvil.
- **Tier 1 — Mechanical power:** water wheel, windmill, shaft, gear, gearbox, mechanical press,
  millstone, saw.
- **Tier 2 — Steam:** boiler, steam engine, large furnace, powered crusher and press, conveyor,
  pump.
- **Tier 3 — Industrial power:** industrial engine, generator, electric motor, advanced smelter,
  machine tools, assembly systems, automated packaging.
- **Tier 4 — Mass production:** automated mine, industrial refinery, advanced foundry, robotic
  assembly, freight loading, warehouses.

## 20–22. Mechanical power

No invisible wires: power physically travels from sources through shafts and gearboxes to machines.
Devices use rotation speed and torque demand. A water wheel gives 16 RPM and 100 torque; a crusher
needs 40, a press 30, conveyors 10: 80/100 works; add a crusher (120/100) and the system stalls.
Gearboxes trade speed for torque — visually understandable rather than engineering-precise.

## 23–24. Logistics and the iron chain

Items physically move: conveyor, chute, hopper, pipe, filter, splitter, merger, crate, warehouse,
loader. Watching the factory run should itself be satisfying. The improved iron chain (crusher →
washer → blast furnace) yields more metal per ore — manual 10 ore → 7 ingots, industrial 10 → 10.
Automation is not merely faster, it is more resource-efficient.

## 25–27. Steel, copper, oil

Steel (iron + coal/coke in a blast furnace) is the first industrial threshold: advanced tools,
machinery, engines, factory parts, vehicles. Copper feeds wiring, motors, generators, electronics.
Oil (later) splits into fuel, lubricant, plastic and chemical feedstock.

## 28–31. Components, the factory economy, vertical integration

Factories increasingly make components (gear, bearing, shaft, plate, pipe, spring, wire, motor,
gearbox, pump, valve, circuit) that combine into products. Profit = revenue − raw materials − fuel
− maintenance − transport; a badly designed factory can lose money. Owning the whole chain (mine →
rail → processing → steel mill → component and machine factories → market) is the true economic
endgame.

## 32–35. Buying, player markets, buy orders, automated selling

Factories are never mandatory: a rich adventurer can buy weapons, tools, food, materials and
machines. Players run shop stands supplied from attached storage, post buy orders ("Buying 2,000
iron ore at ₡7") that others fill, and later connect warehouses to depots that sell automatically at
market price, minus transport.

## 36–37. Transportation and inventory

Backpack → hand cart → horse → wagon → truck and rail: from carrying twenty ore to transporting
thousands. Inventory is slots, stack sizes and backpack capacity — arcade readability over realism.

## 38–39. Survival and death

Health, hunger and stamina; hunger drains slowly and food gives temporary bonuses. On death: drop
part of carried resources (25 %), keep equipment, lose a little money (10 %), respawn at bed or
town, and recover the bag.

## 40–42. Combat, threats and factory defense

MooMoo-like: quick and charged attacks, dodge, blocking, critical hits; melee (sword, axe, spear,
mace, hammer) and ranged (bow, crossbow). Wolves, bears, boars; bandits attacking travelers, mines,
settlements and factories; dangerous regions guarding rare resources. Wealthy factories attract
occasional raids; players build walls, gates, towers, traps and later guards.

## 43–46. Building, property, multiplayer, companies

Grid-assisted placement (precise snapping for factories). Land claims define building permission,
machine ownership, storage and factory access, with Owner / Manager / Builder / Worker / Visitor
permissions. Servers of 10–30 players cooperate, trade, build, fight and specialize. Companies share
a treasury, land, factories, warehouses and shops.

## 47–50. Economy rules and progression

NPCs guarantee every useful item has some buyer; players create better opportunities. Factories are
the best scalable income but never instant unlimited money — they need capital, knowledge, layout,
resources, logistics and demand. Typical arc: gatherer (₡0–500) → miner/farmer/hunter (₡5,000) →
craftsman/trader (₡25,000) → workshop owner (₡100,000) → factory owner (₡1,000,000+) → industrial
empire. No character levels; progression is equipment, knowledge, property, money, machinery and
capacity, with activity skills (mining, smithing, farming, engineering, trading, combat).

## 51–54. Research, blueprints, quests, town growth

Engineering research spends knowledge earned by crafting, discovering, contracts and running
machines: basic mechanics → mechanical power → precision engineering → steam → industrial production
→ electricity → automation. Some machines need blueprints (engineers, quests, abandoned factories,
merchants, research). Quests stay economic ("Deliver 100 stone", "Repair the town's water wheel").
Supplying a village grows it: larger market, a blacksmith appears, a warehouse is built.

## 55–57. Regional specialization and example factories

Stonehaven (mining: exports iron, coal, steel; needs food and wood), Greenfield (agriculture: exports
grain and livestock; needs machines and tools), Port Meridian (trade: imports luxuries, needs
everything). Bread goes from grow → mill → bake by hand to silo → mill → mixer → oven → packager →
warehouse; tools go from mine to crusher, washer, blast furnace, caster, press, machining, assembly
and packaging — every step physically present.

## 58–62. Bottlenecks, statistics, overclocking, maintenance, regrowth

Every machine has input, processing and output rates and a power requirement; bottlenecks are the
optimization game. Factory UI diagnoses (production/min, revenue/expense/profit per minute,
utilization, power, bottlenecks) but never fixes. Overclocking trades efficiency for speed.
Maintenance is gentle (slow efficiency loss; repair, lubricate, replace; later automated). Resource
nodes regrow; big mines tap near-unlimited deposits with machinery.

## 63–64. Endgame and prestige projects

The endgame is building something absurdly efficient: a ₡100,000/day factory, a fully automated
steelworks, supplying a city, a freight network, controlling regional trade. Late money sinks:
railways, power plants, an industrial port, monuments, mega factories.

## 65–67. Prototype, vertical slice, development order

Prototype: one biome, one town, one merchant; wood, stone, coal, iron, copper; three tools, a
furnace, a crusher, a water wheel, shafts, gears, conveyor, press. Core test: mine iron and sell it,
or smelt it and sell ingots for more, or automate processing into gears and sell those for
considerably more — if all three feel satisfying, the economy works.

Vertical slice: a major town, two villages, forest, plains, mountain, mine, river, farmland, a bandit
camp; wood, stone, coal, iron, copper, wheat, food, steel, basic machines; water wheel, windmill,
shaft, gearbox, crusher, millstone, press, furnace, conveyor, hopper, splitter, storage.

Development order: (1) movement, gathering, inventory; (2) town and NPC economy; (3) crafting and
blacksmithing; (4) building; (5) mechanical power; (6) conveyors and automation; (7) dynamic supply
and demand; (8) multiplayer trading; (9) agriculture and animals; (10) vehicles and logistics; (11)
steam; (12) industrial technology; (13) companies; (14) expanded world economy.

## 68–70. The heart of the game

Every major resource has at least three choices: **sell it** (money now), **process it** (more
money), **use it** (advance your infrastructure). With 500 iron ore you could sell for ₡4,000, smelt
for ₡7,000, make components for ₡14,000 — or build another production line, earn nothing today, and
double production forever. That decision is the heart of the game.

IRONWILD begins as "chop tree, mine ore, kill wolf, sell resources" and becomes "I bought cheap
copper in Stonehaven, shipped it to my river factory, turned it into motors with steel from my own
mine, filled a city contract for 500 pumps and built another assembly line with the profits" — so
gradually that the player barely notices how complex their world has become.

**Everything can become a business.**

The feature to protect most aggressively is **physical factories**: shafts turning, gears meshing,
conveyors carrying individual products, furnaces feeding presses, crates filling. If those systems
are tactile and visible rather than menus saying "+50 steel/min", the factory endgame becomes
something players want to build.
