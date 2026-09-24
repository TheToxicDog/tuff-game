# Foundational Game Design Plan

> This is the design north star for the project. Implementation status against this plan is
> tracked in [`ROADMAP.md`](./ROADMAP.md); the technical architecture that realises it is described
> in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## 1. Game Vision

The game is a grim, illustrated, completely top-down multiplayer zombie survival sandbox that runs
directly in a web browser.

The core fantasy is not simply killing zombies. It is:

> Enter a ruined world with almost nothing, scavenge what remains, survive increasingly dangerous
> expeditions, establish a safe location, and gradually turn a dead city back into somewhere people
> could actually live.

The game combines:

- Fast and responsive top-down shooting.
- Deep container-based scavenging.
- Hundreds of ordinary and specialized items.
- Detailed wounds and medical treatment.
- Food, thirst, exhaustion and survival needs.
- Farming.
- Simple animal husbandry.
- Fortification.
- Construction.
- Vehicles.
- Electricity and utilities later.
- Multiplayer cooperation.
- Optional PvP.
- A persistent shared world.
- A handcrafted map enhanced by procedural-generation tools.
- A browser-based map editor.
- Procedurally generated building interiors where appropriate.
- Long-term rebuilding as the natural endgame.

The intended player count is approximately 1–10 concurrent players on one persistent public world.

There are no human NPC survivors in the initial design.

## 2. Core Design Pillars

### Pillar A — Scavenging must feel physical

Loot should come from logical places.

- Medicine comes from bathrooms, pharmacies and clinics.
- Tools come from garages, sheds and hardware stores.
- Food comes from kitchens, grocery stores and restaurants.

Weapons may be hidden:

- Under beds.
- Inside closets.
- In safes.
- In gun cases.
- In vehicles.
- Behind counters.
- In police stations.
- In rare gun stores.

Players should learn where things are likely to exist.

### Pillar B — Combat should be satisfying but dangerous

This is not Project Zomboid combat. Combat should be considerably faster. The player should feel
capable. Mouse aim should feel immediate.

Weapons should have satisfying impact, recoil, muzzle flash, sound, blood effects, knockback and hit
reactions.

However, ammunition, noise, wounds and zombie numbers prevent combat from becoming trivial.

### Pillar C — Almost every system should interact with other systems

Example: a player fires a rifle. That:

- Kills a zombie.
- Generates noise.
- Attracts nearby zombies.
- Potentially attracts zombies from neighboring streets.
- Uses ammunition.
- Degrades the weapon slightly.
- May break nearby windows.
- Could trigger another player's attention.
- Might force the player to retreat.
- Creates bodies that remain temporarily in the environment.

Systems should create stories.

### Pillar D — Survival develops from desperation into civilization

The progression fantasy should look roughly like:

```
Survive tonight
  ↓
Find reliable supplies
  ↓
Establish shelter
  ↓
Fortify shelter
  ↓
Grow food
  ↓
Acquire vehicles
  ↓
Establish infrastructure
  ↓
Raise animals
  ↓
Secure an entire neighborhood
  ↓
Transform part of the city into a functioning settlement
```

There is no mandatory final boss. The world itself is the objective.

## 3. Camera and Perspective

The game uses a true overhead perspective. There is no isometric projection. Buildings, characters
and vehicles are viewed directly from above.

### Mouse-directed camera

The player is not permanently centered. The camera shifts toward the direction the mouse is
pointing. Example — player aims right:

```
┌───────────────────────────────────────┐
│                                       │
│          PLAYER                       │
│             ● ----------------->      │
│                     more view         │
│                     distance          │
│                                       │
└───────────────────────────────────────┘
```

Recommended camera behavior:

- Player normally sits around 40–45% from the opposite edge of the screen.
- Camera can offset about 15–25% of screen width toward aim direction.
- Camera uses smooth interpolation.
- Sudden cursor movements do not instantly jerk the camera.
- Camera re-centers gradually when aim direction becomes neutral.
- Camera movement becomes slightly tighter indoors.

Recommended implementation:

```
targetCamera = playerPosition + normalizedAimDirection * lookAheadDistance
cameraPosition = lerp(cameraPosition, targetCamera, cameraSmoothness)
```

Players should also have mouse-wheel zoom. Recommended zoom range: **0.75× – 1.50×**. Competitive
visibility must remain controlled so players cannot zoom impossibly far out.

## 4. Desktop Controls

| Input       | Action                   |
| ----------- | ------------------------ |
| WASD        | Movement                 |
| Mouse       | Aim                      |
| Left Click  | Fire / melee attack      |
| Right Click | Precision aim            |
| E           | Interact                 |
| R           | Reload                   |
| Shift       | Sprint                   |
| Ctrl        | Crouch                   |
| Tab         | Inventory                |
| F           | Flashlight               |
| 1–5         | Quick slots              |
| Q           | Quick melee / shove      |
| G           | Context throwable        |
| M           | Map                      |
| B           | Build/Fortification mode |
| Escape      | Menu                     |

Everything should use an abstract input-action system. Code should understand `Move`, `Aim`,
`Attack`, `PrecisionAim`, `Interact`, `Reload`, `Sprint`, `Crouch`, `QuickMelee`, `UseItem`,
`Inventory` rather than `KeyboardKeyW` or `MouseButton0`. That is essential because mobile controls
will eventually map into the exact same actions.

## 5. Mobile Control Design

Mobile should not simply be the desktop controls with virtual buttons pasted over the screen. It
needs a purpose-built control system. Mobile development happens after the desktop version is stable,
but the input architecture must support it from day one.

### 5.1 Core mobile layout

**Left thumb** controls movement. Use a dynamic virtual joystick. It appears wherever the player
initially places their thumb within the lower-left movement region. Advantages: the player does not
need to find a tiny fixed joystick, it is comfortable on different phone sizes, and it reduces thumb
stretching.

**Right thumb**: the right half of the screen controls aim direction. Touch and drag to aim toward
the drag direction. The player should be able to aim without touching a tiny joystick precisely. The
right-side aiming region can behave like a large invisible analog stick.

### 5.2 Shooting

A dedicated fire button should sit underneath or slightly inward from the right thumb's resting
position.

- Tap: fire one shot.
- Hold: automatic fire for automatic weapons.
- Drag while holding: continue aiming.

This allows simultaneous move + aim + shoot, which is essential.

### 5.3 Mobile screen layout

```
┌───────────────────────────────────────────┐
│ Health                             Minimap│
│                                           │
│                                           │
│      MOVEMENT                AIM REGION   │
│                                           │
│                               [MELEE]     │
│                          [RELOAD] [FIRE]  │
│             [INTERACT]                    │
│  inventory                   quick slots  │
└───────────────────────────────────────────┘
```

Avoid placing 15 permanent buttons on screen. Most actions should be contextual, radial, temporary or
gesture-based.

### 5.4 Context-sensitive interaction

Instead of separate buttons for open, close, loot, enter vehicle, pick up, harvest and climb, use one
Interact button. The action displayed changes according to context: `OPEN DOOR`, `SEARCH CABINET`,
`ENTER VEHICLE`, `HARVEST`, `CLIMB WINDOW`, `PICK UP`.

Holding the button opens additional actions. Tap door: open. Hold door: Open / Close / Lock /
Barricade / Examine.

### 5.5 Contextual action wheel

Long-pressing an object can open a radial action menu. Example firearm:

```
            Reload
Inspect              Unload
       [PISTOL]
Repair               Drop
          Equip
```

This prevents menus from becoming cumbersome on touchscreens.

### 5.6 Mobile aiming assistance

Mobile needs mild assistance without becoming auto-aim. When the aim direction passes close to an
enemy: slightly reduce aim sensitivity, gently bias toward the target, never rotate the player's aim
dramatically. Call this **Aim Friction** rather than hard lock-on. Strength should be adjustable: Off,
Low, Medium, High.

### 5.7 Precision aiming

Holding an Aim button changes right-stick sensitivity, weapon spread, camera look-ahead and movement
speed. This helps players make accurate long-range shots.

### 5.8 Mobile looting

Containers should open with a simplified two-column interface:

```
BACKPACK                  CABINET
Water                     Beans
Knife                     Pasta
Bandage                   Salt
Ammo                      Cooking Oil
```

Important mobile features: tap item → transfer; hold item → inspect; swipe item → quick transfer;
TAKE ALL button; SORT button; search field for large containers. Drag-and-drop optional, but never
required.

### 5.9 Mobile quick slots

Use five slots maximum: `[Primary] [Secondary] [Melee] [Medical] [Utility]`. Swipe horizontally
across the weapon area to switch weapons.

### 5.10 Mobile sprinting

Avoid requiring another constant button press. Push the movement joystick beyond approximately 85%
radius to sprint; normal stick movement walks/jogs. Players can disable this and use a dedicated
sprint button if preferred.

### 5.11 Mobile haptics

Use optional, subtle haptic feedback for firing, taking damage, empty magazine, successful reload,
melee impact and vehicle collisions.

### 5.12 Mobile HUD customization

Players should eventually be able to move buttons, resize buttons, alter opacity, change joystick
size and swap left/right handed layout. This is important for polished mobile controls.

## 6. Character Movement

Movement should feel relatively responsive. Suggested speeds:

| Mode   | Speed   |
| ------ | ------- |
| Walk   | 2.3 m/s |
| Jog    | 3.6 m/s |
| Sprint | 5.5 m/s |
| Crouch | 1.5 m/s |

Encumbrance modifies these. Extremely heavy backpacks make sprinting difficult. Movement should have
slight acceleration but remain responsive. Avoid excessive inertia.

## 7. Combat Philosophy

- **Responsive** — weapons react immediately.
- **Readable** — the player can understand hits and misses.
- **Dangerous** — one mistake against several zombies can become serious.
- **Resource-driven** — using firearms consumes valuable ammunition and generates noise.

## 8. Firearms

Weapon stats: damage, fire rate, magazine capacity, reload speed, spread, aim speed, recoil, noise
radius, penetration, durability, weight, ammo type, handling.

Suggested categories: handguns, revolvers, shotguns, bolt-action rifles, semi-automatic rifles,
sporting rifles, rare military-style rifles, rare SMGs, extremely rare specialty weapons.

Weapon distribution should reflect a civilian-world approach rather than a military apocalypse.

## 9. Firearm Distribution

These values should be configuration data. Default balancing target:

**Residential houses** — approximately 30–35% of houses contain some firearm. Most are handguns,
revolvers and shotguns. Rifles should be less common. A house firearm should often have limited
ammunition, e.g. `Handgun, Magazine: 7/15, Loose ammunition: 13 rounds` — not 300 rounds sitting
beside every pistol.

**Gun stores** are deliberately rare: no guarantee in small towns, occasionally one near medium towns,
1–2 in the large city. They contain substantial ammunition, firearms, accessories, gun cleaning
supplies and magazines, but should be dangerous locations. Possible defenses: reinforced doors,
locked storage, alarm systems, large nearby zombie concentrations, damaged entrances, difficult
back-room access. A gun store should feel like an expedition.

## 10. Melee Combat

Melee remains viable. Weapon characteristics: damage, reach, swing duration, recovery duration,
stamina consumption, knockback, durability, noise, sharp/blunt classification.

Example weapons: baseball bat, hammer, kitchen knife, machete, crowbar, hatchet, fire axe, shovel,
pipe, wrench, improvised spear.

## 11. Shoving

Every player can shove. Shoving costs stamina, creates small knockback, can interrupt attacks, can
knock zombies over, and becomes weaker when exhausted. This becomes an important emergency tool.

## 12. Zombie Archetypes

Zombies use mixed movement speeds. Do not visibly label them with RPG classes. They should feel like
natural variation. Suggested distribution (server-configurable):

| Archetype      | Share |
| -------------- | ----- |
| Slow walkers   | 55%   |
| Walkers        | 25%   |
| Fast walkers   | 12%   |
| Runners        | 6%    |
| Rare sprinters | 2%    |

## 13. Zombie Perception

**Sight** is affected by distance, player movement, obstacles and light.

**Sound**: every noisy action produces a sound event. Example relative noise (tuning units, not
meters):

| Source          | Noise |
| --------------- | ----- |
| Footsteps       | 4     |
| Opening door    | 7     |
| Breaking window | 25    |
| Melee hit       | 12    |
| Suppressed gun  | 35    |
| Handgun         | 80    |
| Shotgun         | 130   |
| Rifle           | 150   |
| Car horn        | 250   |
| Alarm           | 350   |

## 14. Zombie Investigation

Zombies should not instantly know exactly where the player is. Sound creates a sound source,
position, intensity and timestamp. Nearby zombies investigate the approximate location. This allows
distraction, thrown objects, alarms and deliberate noise traps.

## 15. Horde Formation

Zombies can indirectly create hordes. A gunshot attracts six zombies. Those zombies break glass, hit
doors, groan and move through streets. Their movement produces additional disturbance. Other zombies
then investigate. A seemingly small fight can escalate naturally.

## 16. Zombie Spawning

Never obviously spawn zombies immediately beside players. The world tracks zombie population by zone,
e.g. Downtown target 1,900; Suburb 450; Small town 220; Forest 30. Spawn points activate outside
player visibility. Cleared areas should remain noticeably safer for a while.

## 17. Health Model

There is one overall health condition, but injuries occur on individual body locations: head, torso,
left arm, right arm, left hand, right hand, left leg, right leg, left foot, right foot.

## 18. Wound Types

Scratches, cuts, deep cuts, punctures, bites, burns, fractures, bruises, gunshot wounds, bleeding and
wound infection.

Zombie bites do not automatically cause zombie infection. They are serious physical wounds.

## 19. Bite Mechanics

A zombie bite can cause substantial damage, bleed heavily, damage clothing, become infected like a
normal wound, create pain and temporarily impair the body part. The player treats it medically.

```
Zombie Bite — Left Forearm
Bleeding: Moderate
Pain: Severe
Contamination: High
Healing: Poor
```

Treatment might include: clean wound, disinfect, apply sterile dressing, replace dressing
periodically, take antibiotics if bacterial infection develops, rest. This produces detailed medical
gameplay without making every bite a hidden death timer.

## 20. Medical Items

- **Cleaning**: clean water, alcohol wipes, antiseptic, peroxide.
- **Dressings**: ripped cloth, bandages, sterile gauze, compression bandages.
- **Treatment**: painkillers, antibiotics, anti-inflammatory medication, splints, sutures, medical
  tape.
- **Advanced**: trauma kits, surgical supplies, blood bags later if desired.

## 21. Healing

Wounds heal gradually. Healing speed is influenced by wound severity, treatment, sleep, nutrition,
hydration and wound cleanliness. Repeatedly ignoring injuries should create consequences.

## 22. Survival Needs

Initial survival systems: health, hunger, thirst, energy, stamina, pain, stress. Temperature can be
added later when weather mechanics become relevant.

Avoid showing exact 0–100 numbers everywhere. Prefer descriptive states: Peckish / Hungry / Starving;
Thirsty / Very Thirsty / Dehydrated; Tired / Exhausted; Minor Pain / Severe Pain. Exact values can
exist internally.

## 23. Inventory Philosophy

Inventory combines weight and container capacity. Players have pockets, clothing storage, equipped
containers, a backpack and hands.

## 24. Backpack System

Backpacks define maximum weight, internal volume, quick access slots, movement penalty and (later)
water resistance. Examples: School Backpack, Hiking Backpack, Military-style Backpack, Duffel Bag,
Tool Bag, Medical Bag.

## 25. External Containers

Players can use garbage bags, plastic grocery bags, crates, baskets, toolboxes, coolers, shopping
carts and vehicle trunks. A shopping cart should legitimately become useful early-game transportation
for loot.

## 26. Loot Interface

```
PLAYER                         LOCATION
Pockets                        Kitchen Cabinet
Backpack                       Counter
Equipped                       Refrigerator
Hands                          Floor
```

Nearby containers appear as tabs. Players should not need to close the entire inventory window to
inspect another cupboard.

## 27. Loot Search Time

Opening a container reveals it quickly. Searching complicated storage can take slightly longer:

| Container      | Time    |
| -------------- | ------- |
| Kitchen drawer | 0.2 sec |
| Cabinet        | 0.3 sec |
| Closet         | 0.6 sec |
| Large dumpster | 1.0 sec |
| Vehicle trunk  | 0.4 sec |

Avoid excessive timers. The game should remain fast.

## 28. Item Architecture

Every item is defined using data:

```json
{
  "id": "canned_beans",
  "name": "Canned Beans",
  "category": "food",
  "weight": 0.42,
  "volume": 0.5,
  "stackSize": 6,
  "condition": 1,
  "tags": ["food", "canned"],
  "nutrition": {
    "calories": 380
  }
}
```

No individual JavaScript file should be required for every item.

## 29. Item Categories

The final system should support thousands of definitions. Core categories: food, drinks, medicine,
hygiene, weapons, ammunition, weapon accessories, tools, construction supplies, farming supplies,
seeds, clothing, backpacks, containers, electronics, batteries, vehicle parts, fuel, books, maps,
cooking equipment, animal supplies, fishing equipment, crafting materials, junk, collectibles.

## 30. Item Production Targets

| Stage       | Items   |
| ----------- | ------- |
| Prototype   | 100–150 |
| Early Alpha | 250–350 |
| Beta        | 500–700 |
| Mature game | 1,000+  |

The architecture should comfortably support several thousand.

## 31. Procedural Loot

Buildings contain logical loot zones. Example house: kitchen, bathroom, bedroom, garage, living room,
utility closet.

- Kitchen loot: food, utensils, cooking tools, cleaning supplies, containers.
- Garage: tools, fuel cans, hardware, automotive supplies, rare weapons.

This makes exploration intuitive.

## 32. Grocery Stores

Grocery stores should be one of the most detailed procedural interiors. Possible departments:
entrance, checkout, produce, bakery, dry goods, canned food, drinks, frozen food, meat, household
goods, pharmacy, employee area, stock room, loading dock, manager office, bathrooms. Each department
gets distinct loot pools.

## 33. Grocery Store Procedural Generation

The building footprint can be handcrafted. The editor then generates aisle placement, shelf layout,
checkout lanes, coolers, freezers, storage racks, decorations and loot containers.

Generator settings: store size, number of aisles, stock level, damage level, loot depletion, zombie
density, power state, alarm state.

The designer can generate the store and then manually change anything.

## 34. World Philosophy

The world is handcrafted at the macro level and procedurally assisted at the micro level. This gives
much better results than trying to generate an infinite world.

The main region should include: big city, suburbs, several small towns, plains, agricultural areas,
forest, lakes or rivers, industrial areas, highways, backroads, rural properties.

## 35. Road Philosophy

Following major roads should generally lead players between civilization:

```
BIG CITY
   │  Highway
SUBURBS
   │  State Road
SMALL TOWN
   │  Country Road
ANOTHER TOWN
```

Players who remain near roads continue discovering gas stations, houses, stores, farms, businesses
and towns. Players who deliberately leave the road encounter forests, fields, cabins, hunting areas,
isolated farms, hidden locations and wilderness.

## 36. Recommended Initial World Scale

Start around 4 km × 4 km (≈16 km²), but architect the map format so additional regions can be
attached later.

Suggested composition: 1 large city, 2–3 small towns, 1 major suburb, several rural communities,
large forest regions, large plains/farmland region, industrial district, highway network, multiple
secondary roads. A 4×4 km map is already extremely large when every building is enterable.

## 37. World Chunks

Internally divide the map into **64 m × 64 m** chunks. Chunks contain references to terrain,
structures, objects, containers, zombies, player structures, vehicles and modifications. Only nearby
chunks receive high-frequency simulation.

## 38. Map Editor

The map editor should be a major development tool, not an afterthought. It should run using the same
rendering engine as the game. Recommended route: `/editor`, restricted to developers/admins.

## 39. Map Editor Modes

- **Terrain Mode** — paint grass, dirt, mud, pavement, sand, farmland, forest floor, water.
- **Biome Mode** — paint biome regions: City, Suburb, Small Town, Forest, Plains, Farmland,
  Industrial, Wilderness. Biome data influences generation.
- **Road Mode** — create roads using editable splines. The editor creates pavement, road edges, lane
  markings, sidewalks and intersections. Road properties: width, lane count, surface, sidewalks,
  streetlights, speed classification.

## 40. Parcel Generator

Roads can automatically produce building lots. The designer can regenerate individual lots.

```
ROAD
─────────────────────────────
| house | house | store |
─────────────────────────────
```

## 41. Building Mode

Place or generate houses, stores, offices, warehouses, garages, farms, hospitals, police stations,
restaurants and schools. Buildings have editable footprints.

## 42. Interior Editor

Buildings contain floors and rooms. Editor tools: wall, door, window, floor, room, furniture, loot
container, spawn zone, lighting, decoration.

## 43. Procedural Interior Generator

For compatible buildings, select **Generate Interior**. The system uses building type, building
dimensions, entrance locations, window locations and room requirements to create an interior. Then
the designer can edit it manually. This is particularly valuable for houses, apartments, grocery
stores, offices and warehouses.

## 44. Generator Locking

Every procedural element needs a lock feature. Designer generates a town, likes the road, grocery
store and five houses, locks them, then presses **Regenerate Unlocked** — only the remaining content
changes. This makes procedural generation useful to actual designers.

## 45. Selection-Based Regeneration

Designer can select an area and choose Generate, Regenerate, Clear, Scatter or Smooth.

## 46. Natural Generation System

Biomes define procedural rules.

- **Forest**: tree density high, bush density medium, rocks low, buildings rare, roads rare, cabins
  very rare, wildlife high.
- **Plains**: tree density low, grass high, farms medium, roads low, wildlife medium.
- **Big City**: road density extreme, buildings extreme, zombie population extreme, loot density
  high, vehicle density high.

## 47. Prop Scattering

Editor should support procedural scattering: select an area, choose trees, bushes, debris, cars,
trash, rocks, grass or street furniture, then configure density, scale variance, rotation variance,
minimum spacing and allowed terrain. Use Poisson-disc style placement so objects don't look randomly
clumped unnaturally.

## 48. Map Editor Layers

Terrain, Road, Buildings, Walls, Furniture, Decoration, Containers, Spawn Zones, Zombie Zones, Loot
Zones, Navigation, Lighting, Player Construction. Layers can be hidden or locked.

## 49. Editor Playtest

One button — **PLAY FROM HERE** — launches the game immediately at the cursor position. Escape
returns to the editor. Fast iteration is extremely valuable.

## 50. World Persistence

The base world remains immutable. The database stores differences.

```
Base:               Door 104 exists
World modification: Door 104 destroyed
```

This drastically reduces world save size.

## 51. Time

15 real minutes = 1 full in-game day, so 1 real minute = 1.6 game hours. A possible cycle:

| Period   | Hours       |
| -------- | ----------- |
| Dawn     | 05:00–07:00 |
| Daylight | 07:00–18:00 |
| Dusk     | 18:00–20:00 |
| Night    | 20:00–05:00 |

## 52. Empty Server Behavior

When zero players are connected, simulation pauses completely: no crop growth, hunger decay, zombie
movement, animal breeding, fuel consumption, food spoilage or day/night progress. When the first
player reconnects, simulation resumes exactly where it stopped.

## 53. Lighting

Even without weather, day/night should substantially alter atmosphere.

- **Day**: gloomy, desaturated, cloudy-looking ambient lighting.
- **Night**: extremely limited visibility; strong artificial light importance — flashlights,
  headlights, interior lighting.

Night should create meaningful risk.

## 54. Base Fortification

Primary base gameplay is modifying existing structures. Players can lock doors, barricade windows,
board doors, move furniture, install storage, place lights, build fences, build gates and repair
damaged walls. Existing buildings should usually be better than constructing from nothing.

## 55. Free Construction

Players can still build wood floors, walls, window walls, door frames, doors, fences, gates, storage,
animal pens, farm plots, simple roofs and workbenches. Full construction exists, but isn't the
primary early-game strategy.

## 56. Construction Integrity

Construction should remain simple initially. Structures require materials, a tool, a skill
requirement and build time. Example — Wood Wall: 8 planks, 20 nails, Hammer, Carpentry 2.

## 57. Crafting

Crafting follows a survival-game technology tree. Major categories: survival, medical, cooking,
construction, weapons, tools, farming, animal care, electrical, vehicle, storage. Recipes can require
skill, a known recipe, a workstation, a tool and materials.

## 58. Recipe Discovery

Recipes can come from default knowledge, skill progression, magazines, books and experimentation.
Not everything should require finding a random magazine.

## 59. Farming

Initial crops: potato, carrot, tomato, corn, beans, lettuce, cabbage, onion, strawberry. Crop
variables: growth, water, health, disease, yield. Since weather isn't implemented initially, watering
is manual.

## 60. Farming Gameplay

Prepare soil → plant seed → water → maintain → harvest → cook / preserve / replant. Different crops
have different growth times.

## 61. Animals

Initial domestic animals: chicken, goat, pig, cow. Animals need food, water and an enclosure.

| Animal  | Outputs    |
| ------- | ---------- |
| Chicken | Eggs, meat |
| Goat    | Milk, meat |
| Cow     | Milk, meat |
| Pig     | Meat       |

## 62. Breeding

Keep genetics simple. Animal data: species, sex, age, health, hunger, thirst, pregnancy. If
compatible adult animals have suitable living conditions, breeding becomes possible. No detailed
genetic simulation initially.

## 63. Wildlife

Initial wildlife: deer, rabbits, birds, fish. Wildlife creates optional alternate food sources.

## 64. Vehicles

Vehicle mechanics should be considerably simpler than Project Zomboid. Vehicle properties: fuel,
overall condition, engine condition, tire condition, storage, battery. Do not simulate 50 individual
car components initially.

## 65. Vehicle Actions

Players can enter, drive, refuel, repair, store items, change tires, replace batteries and siphon
fuel. Vehicle noise attracts zombies.

## 66. Vehicle Types

Initial roster: compact car, sedan, SUV, pickup, van, box truck, motorcycle later. Vehicles have
different acceleration, speed, durability, noise and cargo capacity.

## 67. Character Skills

Skills improve through relevant gameplay. Suggested initial skills: Firearms, Melee, Fitness,
Strength, Medicine, Carpentry, Cooking, Farming, Mechanics, Electrical, Foraging, Fishing, Animal
Handling. Avoid one universal RPG level.

## 68. Skill Progression

Doing an action grants relevant experience: repair vehicle → Mechanics XP; treat wound → Medicine XP;
harvest crop → Farming XP; build wall → Carpentry XP.

## 69. Death

Default death rules: player dies → body remains → carried inventory remains on body → player
respawns.

Suggested default penalty: lose currently carried equipment; lose a portion of recently earned skill
XP; temporary post-respawn weakness. Base ownership and stored property remain.

Suggested XP penalty: 10% of progress toward the next level, not 10% of the player's entire lifetime
skill progression. This makes death meaningful without destroying weeks of progress.

All death rules should be server configurable.

## 70. Multiplayer Architecture

The game uses an authoritative server.

```
Browser
   │  WebSocket
   ▼
Game Server
   ├─ Player simulation
   ├─ Zombie simulation
   ├─ Combat
   ├─ Inventory
   ├─ World
   ├─ Vehicles
   ├─ Farming
   └─ Persistence
        │
        ▼
     Database
```

Clients send intentions ("I am attempting to fire"). The server determines: does the weapon exist?
Is it equipped? Does it have ammunition? Where is the player aiming? What was hit?

## 71. Server Target

Initial target: 1 persistent server, 10 concurrent players. The architecture should comfortably
tolerate around 20–30 players without requiring a rewrite.

## 72. PvP

Server configuration: PvP ON / OFF. Potential later options: faction PvP, safe zones, friendly fire.
Initial implementation only requires the main toggle.

## 73. Authentication

Because this is a persistent public world, usernames alone are insufficient — someone could
impersonate another player. Recommended minimal system: username, password, persistent account ID.
The character and owned structures reference the account ID rather than the username, so display
names can later change without corrupting ownership.

## 74. Interest Management

The server should never send every entity to every player. A player receives their current chunk,
surrounding chunks and important long-range events. A chicken four kilometers away is irrelevant — do
not replicate it.

## 75. Simulation Levels

- **Nearby**: full simulation.
- **Moderately far away**: reduced simulation.
- **Very far away**: statistical state only — e.g. `Zone: North Industrial, Zombie population: 318`
  rather than simulating 318 individual zombies every server tick.

## 76. Server Tick Rate

Server simulation 20 Hz, network snapshots 10–20 Hz, client rendering 60+ FPS. Interpolate remote
player movement client-side.

## 77. Browser Technology

- Client: TypeScript, rendered with **PixiJS** (chosen over Phaser because the game is likely to
  become system-heavy and highly customized).
- Server: Node.js + TypeScript.
- Networking: WebSockets.
- Database: PostgreSQL. Optional later: Redis.
- Asset delivery: static HTTP/CDN.

## 78. Game Architecture

```
game/
├── client/   camera/ input/ rendering/ audio/ ui/ networking/ editor/
├── server/   simulation/ networking/ world/ persistence/ authentication/
├── shared/   ecs/ items/ world/ combat/ network/
└── data/     items/ weapons/ recipes/ buildings/ zombies/ vehicles/ crops/ animals/ loot/
```

## 79. Entity Component System

Use an ECS-style architecture.

- **Player**: Transform, Velocity, Health, Inventory, Equipment, Skills, Needs, PlayerControl,
  NetworkOwnership.
- **Zombie**: Transform, Velocity, Health, ZombieAI, Vision, Hearing, Combat.
- **Animal**: Transform, AnimalAI, Health, Needs, Breeding.
- **Vehicle**: Transform, VehiclePhysics, Fuel, Condition, Inventory, Seats.

## 80. Rendering

The world is visually illustrated, not obviously tile-based. Internally a grid may still be used for
collision, building coordinates, navigation and placement. But the player should see irregular
pavement, curved roads, natural grass edges, shadows, overlapping props and decals. Avoid making
everything look like square tiles.

## 81. Art Direction

Illustrated grim realism. Not photorealistic, not cartoonish, not pixel art. Visual characteristics:
muted saturation, dirty greens, gray concrete, faded paint, gloomy ambient lighting, strong dark
interiors, illustrated texture work, readable silhouettes. Blood can provide occasional strong color
contrast.

## 82. Master Graphics Production List

- **Terrain**: short grass, long grass, dead grass, forest grass, dirt, dry dirt, mud, gravel,
  asphalt, cracked asphalt, concrete, sidewalk, farm soil, tilled soil, sand, riverbank, shallow
  water, deep water, railroad gravel, industrial concrete, parking lot asphalt.
- **Terrain decals**: dirt patches, mud patches, oil stains, tire marks, cracks, potholes, blood
  stains, trash, leaves, grass tufts, weeds, drain covers, road repairs, paint markings.
- **Roads**: two-lane road, four-lane road, highway, country road, dirt road, driveway, parking lot,
  crosswalk, intersection, highway divider, curb, sidewalk, guardrail, road signs, street signs,
  traffic lights, streetlights, stop signs.
- **Natural environment**: oak, pine, birch, dead and fallen trees, saplings, large and small bushes,
  berry bushes, flowers, rocks, large rocks, logs, tree stumps, mushrooms, reeds, water plants.
- **Building exteriors**: brick, concrete, wood siding, vinyl siding, metal siding, industrial metal
  wall, glass storefront, garage wall, warehouse wall, wooden / chain-link / privacy fences, concrete
  barrier.
- **Roofs**: asphalt shingle, metal, flat commercial, industrial, damaged, roof vents, HVAC units,
  chimneys, satellite dishes, solar panels later.
- **Windows**: residential, commercial, large storefront, industrial; broken, boarded and cracked
  versions; curtains; blinds.
- **Doors**: interior wooden, exterior house, glass commercial, metal security, garage, warehouse,
  barn, sliding; broken and barricaded variants.
- **House furniture**: bed, nightstand, wardrobe, dresser, couch, chair, recliner, coffee table,
  dining table, bookshelf, desk, television, lamp, rug, kitchen counter, sink, oven, refrigerator,
  microwave, dishwasher, toilet, shower, bathtub, bathroom cabinet.
- **Garage objects**: workbench, toolbox, tool chest, shelving, lawn mower, fuel can, tires, car
  jack, storage boxes, ladder, paint cans.
- **Grocery store**: checkout register, checkout conveyor, shopping cart, shopping basket, aisle
  shelf, endcap, produce shelf, produce crate, refrigerator, freezer, meat counter, bakery display,
  pharmacy shelf, pallet, storage rack, employee locker, loading dock, manager desk, store signage,
  price signs, posters, shopping bags.
- **Pharmacy**: medicine shelf, prescription counter, locked medication cabinet, pharmacy register,
  waiting chair, medical refrigerator.
- **Police station**: front desk, office desk, locker, evidence shelf, weapon locker, holding cell,
  security door, filing cabinet.
- **Hospital / clinic**: hospital bed, examination table, medical cabinet, IV stand, wheelchair,
  gurney, medicine cart, waiting room furniture, operating equipment later.
- **Hardware store**: tool rack, lumber rack, shelf, paint display, hardware bins, generator display,
  chainsaw shelf.
- **Restaurant**: table, booth, commercial stove, prep counter, walk-in freezer, refrigerator, fryer,
  sink, food shelves.
- **Industrial**: pallets, crates, industrial shelving, forklift, barrels, machinery, pipes,
  electrical cabinets, shipping containers.
- **Farm**: barn, shed, silo, animal trough, hay bale, tractor, fence, gate, feed storage, chicken
  coop.
- **Player construction**: wood floor, wood wall, door frame, window frame, wooden door, fence,
  gate, barricade, storage chest, rain collector later, farm plot, animal pen, workbench.
- **Characters**: base male and female bodies, skin tones, hair styles, facial hair, underwear
  layers. Clothing: t-shirt, long-sleeve shirt, hoodie, jacket, rain jacket, jeans, cargo pants,
  shorts, work pants, boots, sneakers, gloves, hats, helmets, police, medical and work clothing.
  Animations: idle, walk, jog, sprint, crouch, melee, shove, pistol aim, rifle aim, shotgun aim,
  reload, interact, injured movement, death. Because the game is top-down and aim direction is
  continuous, equipment should rotate independently where practical instead of requiring dozens of
  directional sprite sheets.
- **Zombies**: male, female, large, thin and damaged bodies; civilian, office, worker, police,
  medical, athletic and rural clothing; bloody, torn, missing-limb (later) and exposed-wound damage
  variants. Animations: idle, shuffle, walk, run, sprint, attack, stumble, fall, rise, death.
- **Weapon world sprites**: pistols, revolvers, shotguns, rifles, SMGs, baseball bat, crowbar,
  hammer, hatchet, fire axe, knife, machete, shovel, pipe, wrench, spear.
- **Ammunition graphics**: loose rounds, ammunition boxes, magazines, shotgun shell boxes, magazines
  by weapon class.
- **Item icons**: eventually every major item needs an inventory icon (food, drinks, canned goods,
  medicine, tools, weapons, ammunition, crafting materials, clothing, books, electronics, seeds,
  animal supplies, vehicle supplies).
- **Vehicles**: top-down compact, sedan, SUV, pickup, van, box truck — each with normal, damaged,
  heavily damaged, doors open, hood open and trunk open states.
- **Farming**: growth stages for every crop — seed, sprout, young, growing, mature, harvestable,
  dead.
- **Animals**: chicken, goat, pig, cow (idle, walk, eat, drink, death); wildlife: deer, rabbit, bird.
- **Effects**: muzzle flash, bullet tracer, bullet impact, dirt impact, concrete impact, wood
  splinter, glass break, blood spray, blood pool, smoke, fire, dust, footprints later, shell casing,
  vehicle exhaust, healing effect indicators.
- **Lighting**: flashlight cone, vehicle headlights, streetlight, interior lamp, lantern, campfire,
  emergency lighting, muzzle illumination.
- **UI**: inventory panel, container panel, health panel, body diagram, crafting panel, map, minimap,
  quick slots, weapon HUD, ammo display, health status icons, hunger, thirst, fatigue and pain icons,
  interaction prompt, radial menu, building menu, vehicle HUD, multiplayer player list, chat, death
  screen.
- **Map editor art**: biome icons, building icons, road tool icons, selection handles, spawn
  markers, zombie zone overlays, loot zone overlays, navigation overlay, collision overlay.

## 83. Asset Scale Standard

Choose one universal world scale: **48 pixels ≈ 1 meter**. A human might occupy roughly 30–36 px
width and 75–90 px total illustrated body length. Actual rendered size can scale with zoom. Keeping
one universal scale prevents inconsistent assets.

## 84. Roof Handling

When the player is outside, the roof is visible. When the player enters, the roof fades from 100% to
0–15% opacity over 150–250 ms. Adjacent unexplored rooms may remain darker.

## 85. Interior Visibility

Walls should fade when they block the player character. Never allow the top-down perspective to hide
enemies simply because a decorative wall overlaps them.

## 86. Fog of War

The player remembers explored terrain. Map states: Unknown, Explored, Currently Visible. Buildings
discovered previously remain visible on the map. Individual zombies do not.

## 87. Audio

Audio is a gameplay system. Important sounds: footsteps, distant gunshots, doors, glass, zombies,
animals, vehicle engines, alarms, generators, gunshots, melee impacts. Use positional stereo audio.
Players should occasionally hear a zombie before seeing it.

## 88. Music

Music should be sparse. Atmosphere should primarily come from wind, distant environmental noise,
creaking buildings, animals, zombies, electrical hum and (eventually) rain. Music appears selectively.

## 89. Endgame

There is no traditional ending. The natural endgame becomes: turn surviving into living. Players may
eventually establish a secure neighborhood, food production, livestock, a vehicle fleet, workshops,
electricity, a stocked clinic and a fortified perimeter. A formerly dangerous section of the city can
gradually become a functioning settlement. That transformation should be visible.

## 90. Development Roadmap

- **Phase 0 — Technical Foundation**: TypeScript monorepo, PixiJS renderer, ECS, input abstraction,
  WebSocket communication, authentication, PostgreSQL, chunk streaming. _Success condition: two
  browser windows can connect and move synchronized characters through the same world._
- **Phase 1 — Movement and Combat**: camera, mouse look-ahead, collisions, zombies, melee, firearms,
  ammunition, hit detection, health, death. _Success condition: fighting zombies is genuinely
  enjoyable before any complicated survival mechanics exist._
- **Phase 2 — Inventory and Loot**: items, backpacks, containers, transfer UI, item spawning, loot
  tables, grocery store prototype. _Success condition: players can enter a grocery store, search
  shelves, load a backpack and bring items home. This is the first true vertical slice._
- **Phase 3 — Map System**: chunks, terrain, roads, buildings, interiors, biome system, editor.
  _Success condition: designer can create a town entirely through the browser editor._
- **Phase 4 — Procedural Tools**: road generator, parcel generator, building generation, interior
  generation, prop scattering, biome generation, generation locking. _Success condition: designer can
  generate a neighborhood, modify it manually and save it permanently._
- **Phase 5 — Survival**: hunger, thirst, fatigue, wounds, medical treatment, healing, food, cooking.
- **Phase 6 — Persistence**: persistent containers, dropped items, destroyed structures, player
  construction, corpses, world delta storage.
- **Phase 7 — Fortification**: barricades, furniture movement, construction, storage, base
  permissions.
- **Phase 8 — Vehicles**: driving, fuel, storage, simple repairs, vehicle–zombie collisions, vehicle
  persistence.
- **Phase 9 — Farming**: crops, watering, harvest, seeds, cooking integration.
- **Phase 10 — Animals**: livestock, hunger, water, breeding, products, wildlife.
- **Phase 11 — World Expansion**: the complete first map — city, towns, forests, plains, farms,
  industrial zone.
- **Phase 12 — Mobile**: only after desktop gameplay is polished — mobile HUD, virtual movement,
  touch aiming, aim friction, responsive UI, touch inventory, HUD customization. Because controls
  already use abstract actions, mobile support does not require rewriting the game.

## 91. First Playable Milestone

Do not try to implement farming, vehicles and animals before proving the core. The first genuinely
playable build should contain:

- 2–4 multiplayer players
- 1 neighborhood
- 10–15 enterable buildings
- 1 grocery store, 1 gas station, 1 police station, 1 hardware store
- 100+ item definitions
- 6 melee weapons, 4 firearms
- mixed zombie speeds
- inventory, backpacks
- health, wounds, death
- persistent loot

The player must be able to:

```
Spawn → Find backpack → Enter house → Loot weapon → Fight zombies → Become injured
→ Treat wound → Visit grocery store → Collect supplies → Return to shelter → Store supplies
```

If that 20–30 minute gameplay loop is compelling, the foundation works.

## 92. Development Rule

Every major feature must pass three questions:

1. **Does it create decisions?** If not, it probably doesn't need to exist.
2. **Does it interact with existing systems?** Prefer systems that influence several others.
3. **Is it readable?** Deep simulation is good. Confusing simulation is not.

## 93. Features Explicitly Deferred

These should not distract early development: human NPC survivors, complex factions, seasonal cycle,
detailed weather, zombie infection from bites, complex vehicle mechanics, animal genetics, MMO-scale
networking, huge player counts, full electricity simulation, full plumbing simulation, multi-story
procedural cities until basic interiors work reliably. They can be added later without changing the
fundamental design.

## 94. Current Design Identity

> A fast, completely top-down browser survival game where up to roughly ten players share a
> persistent handcrafted world, scavenge deeply simulated locations, fight mixed-speed zombies,
> manage realistic wounds and resources, fortify buildings, farm, raise animals and gradually
> reclaim a ruined region.

Its distinctive combination is: Project Zomboid-style scavenging depth + much faster twin-stick-style
combat + a handcrafted world with procedural authoring tools + browser-native multiplayer +
long-term settlement restoration. That should remain the project's design north star.
