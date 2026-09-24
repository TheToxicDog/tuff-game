// Procedural commercial interiors: grocery store (design plan §32–33), gas station, hardware store
// and police station. Each generator lays out rooms, walls, doors, windows and loot containers.

import type { Rng } from '../../math/rng';
import { BuildingBuilder, EXTERIOR_WALL } from './building';

const HALF = EXTERIOR_WALL / 2;

export interface GroceryOptions {
  width?: number;
  depth?: number;
  /** Number of aisle rows. */
  aisles?: number;
  /** 0..1 — lower stock turns more shelves into picked-over ones. */
  stock?: number;
  name?: string;
}

const AISLE_DEPARTMENTS = [
  'grocery_canned',
  'grocery_dry',
  'grocery_snacks',
  'grocery_drinks',
  'grocery_household',
  'grocery_canned',
  'grocery_dry',
  'grocery_pharmacy',
];

export function generateGrocery(id: string, rng: Rng, opts: GroceryOptions = {}): BuildingBuilder {
  const w = opts.width ?? 46;
  const h = opts.depth ?? 32;
  const aisles = opts.aisles ?? 6;
  const b = new BuildingBuilder(
    id,
    'grocery',
    w,
    h,
    { material: 'concrete', color: '#a6a39a' },
    { style: 'flat', color: '#5a5a58', axis: 'x' },
    opts.name ?? 'Pine Valley Market',
  );
  b.exteriorWalls('concrete');
  const backD = 8;

  // Back-of-house rooms.
  const stockW = Math.round(w * 0.52);
  const breakW = 8;
  const officeW = 7;
  const restW = w - stockW - breakW - officeW;
  const stock = b.room('stockroom', 0, 0, stockW, backD, 'concrete', 'Stock Room');
  const breakroom = b.room('breakroom', stockW, 0, breakW, backD, 'linoleum', 'Break Room');
  const office = b.room('office', stockW + breakW, 0, officeW, backD, 'carpet', 'Manager Office');
  const rest = b.room('bathroom', stockW + breakW + officeW, 0, restW, backD, 'tile', 'Restroom');
  const sales = b.room('sales', 0, backD, w, h - backD, 'linoleum', 'Sales Floor');

  b.wall(0, backD, w, backD, 'concrete', 0.2);
  b.wall(stockW, 0, stockW, backD, 'drywall');
  b.wall(stockW + breakW, 0, stockW + breakW, backD, 'drywall');
  b.wall(stockW + breakW + officeW, 0, stockW + breakW + officeW, backD, 'drywall');

  // Doors.
  b.door(stockW * 0.45, backD, 'h', 'wood', rng, { w: 1.8, open: rng.chance(0.5) });
  b.door(stockW + breakW / 2, backD, 'h', 'wood', rng, { open: rng.chance(0.5) });
  b.door(stockW + breakW + officeW / 2, backD, 'h', 'wood', rng, { locked: rng.chance(0.4) });
  b.door(stockW + breakW + officeW + restW / 2, backD, 'h', 'wood', rng, { open: rng.chance(0.6), w: 0.8 });
  b.door(stockW * 0.3, HALF, 'h', 'garage', rng, { w: 3, locked: true, swing: 1 });
  b.door(stockW * 0.75, HALF, 'h', 'metal', rng, { locked: rng.chance(0.7), swing: 1 });
  const entranceA = w * 0.26;
  const entranceB = w * 0.74;
  b.door(entranceA, h - HALF, 'h', 'glass', rng, { w: 1.8, open: rng.chance(0.3), swing: -1 });
  b.door(entranceB, h - HALF, 'h', 'glass', rng, { w: 1.8, locked: rng.chance(0.5), swing: -1 });

  // Storefront glazing between and around the entrances.
  for (let x = 2.5; x < w - 2; x += 3.2) {
    if (Math.abs(x - entranceA) < 2.4 || Math.abs(x - entranceB) < 2.4) continue;
    b.window(x, h - HALF, 'h', 'storefront', 2.6);
  }
  b.window(HALF, backD + 4, 'v', 'industrial', 1.2);
  b.window(w - HALF, backD + 4, 'v', 'industrial', 1.2);

  // Walkways kept clear: entrance approaches and the front cross aisle.
  b.reserve(0.3, h - 6.5, w - 0.6, 2.6);
  b.reserve(entranceA - 1.5, h - 4, 3, 4);
  b.reserve(entranceB - 1.5, h - 4, 3, 4);

  // Checkout lanes between the entrances.
  const lanes = 4;
  const laneStart = w * 0.36;
  const laneSpacing = (w * 0.28) / (lanes - 1);
  for (let i = 0; i < lanes; i++) {
    const x = laneStart + i * laneSpacing;
    b.prop('checkout', x, h - 3.1, Math.PI / 2, { size: { w: 2.6, h: 0.8 } });
    b.prop('cash_register', x, h - 2.2, 0);
  }

  // Aisles: pairs of shelf runs with a cross aisle in the middle.
  const floorTop = backD + 3.2;
  const floorBottom = h - 7.5;
  const runLen = (floorBottom - floorTop - 2.4) / 2;
  const aisleStart = 9;
  const aisleSpan = w - 18;
  const stock01 = opts.stock ?? 1;
  for (let i = 0; i < aisles; i++) {
    const x = aisleStart + (aisleSpan * i) / (aisles - 1);
    const dept = AISLE_DEPARTMENTS[i % AISLE_DEPARTMENTS.length];
    for (let s = 0; s < 2; s++) {
      const y = floorTop + runLen / 2 + s * (runLen + 2.4);
      const loot = stock01 < 1 && rng.chance(1 - stock01) ? 'trash_can' : s === 1 && dept === 'grocery_canned' ? 'grocery_snacks' : dept;
      b.prop('store_shelf', x, y, Math.PI / 2, { w: runLen, h: 1.0, loot, size: { w: runLen, h: 1.0 } });
    }
  }

  // Produce section along the left wall near the front.
  for (let y = floorTop + 1; y < floorBottom - 1; y += 3) {
    b.prop('produce_bin', 3.2, y, Math.PI / 2, { size: { w: 1.6, h: 1.1 } });
  }
  // Refrigerated displays along the back wall of the sales floor.
  for (let x = 7; x < w - 8; x += 3.3) {
    b.prop('cooler_display', x, backD + 0.62, 0, {
      size: { w: 3.0, h: 0.85 },
      loot: rng.chance(0.3) ? 'grocery_drinks' : 'grocery_cooler',
    });
  }
  // Freezers and the pharmacy corner along the right wall.
  b.prop('freezer_chest', w - 1.7, floorTop + 2, Math.PI / 2, { size: { w: 2.0, h: 0.9 } });
  b.prop('freezer_chest', w - 1.7, floorTop + 4.6, Math.PI / 2, { size: { w: 2.0, h: 0.9 } });
  b.prop('wall_shelf', w - HALF - 0.35, floorBottom - 2.5, Math.PI / 2, { size: { w: 3.0, h: 0.6 }, loot: 'grocery_pharmacy' });
  b.prop('store_counter', w - 4.2, floorBottom - 2.5, Math.PI / 2, { size: { w: 2.4, h: 0.8 }, loot: 'grocery_pharmacy' });
  // Shopping carts by the entrance.
  for (let i = 0; i < 3; i++) b.prop('shopping_cart', entranceA + 2.2 + i * 0.25, h - 5.4 + i * 0.12, 0.1 * i);

  // Stock room: racks along the walls, boxes and pallets.
  b.againstWall(stock, 'w', 'storage_rack', { w: 2.6, h: 0.9 }, rng, { tall: true, along: stock.h / 2 });
  for (let x = 6; x < stockW - 3; x += 3.4) {
    if (rng.chance(0.8)) b.prop('storage_rack', x + 1.3, 1.0 + HALF, 0, { size: { w: 2.6, h: 0.9 } });
  }
  for (let i = 0; i < 3; i++) b.inRoom(stock, rng.chance(0.6) ? 'boxes' : 'pallet', { w: 1.2, h: 1.0 }, rng, { margin: 1.4 });

  // Break room.
  b.againstWall(breakroom, 'n', 'locker', { w: 0.5, h: 0.5 }, rng, { tall: true, along: 0.8 });
  b.againstWall(breakroom, 'n', 'locker', { w: 0.5, h: 0.5 }, rng, { tall: true, along: 1.4 });
  b.againstWall(breakroom, 'n', 'locker', { w: 0.5, h: 0.5 }, rng, { tall: true, along: 2.0 });
  b.againstWall(breakroom, 'e', 'vending_machine', { w: 0.95, h: 0.8 }, rng, { tall: true });
  const table = b.inRoom(breakroom, 'dining_table', { w: 1.4, h: 0.85 }, rng, { rot: 0, margin: 1.2 });
  if (table) {
    b.prop('chair', table.x - 0.4, table.y + 0.65, 0);
    b.prop('chair', table.x + 0.4, table.y - 0.65, Math.PI);
  }
  b.againstWall(breakroom, 'w', 'fridge', { w: 0.82, h: 0.74 }, rng, { tall: true });

  // Manager office.
  b.againstWall(office, 'n', 'desk', { w: 1.3, h: 0.65 }, rng, { loot: 'store_office' });
  b.againstWall(office, 'e', 'filing_cabinet', { w: 0.5, h: 0.62 }, rng, { tall: true });
  if (rng.chance(0.3)) b.againstWall(office, 'w', 'gun_safe', { w: 0.75, h: 0.65 }, rng, { tall: true, loot: 'store_office' });

  // Restroom.
  b.againstWall(rest, 'n', 'toilet', { w: 0.45, h: 0.7 }, rng);
  b.againstWall(rest, 'e', 'bathroom_cabinet', { w: 0.8, h: 0.5 }, rng);

  void sales;
  return b;
}

export function generateGasStation(id: string, rng: Rng): BuildingBuilder {
  const w = 14;
  const h = 10;
  const b = new BuildingBuilder(
    id,
    'gas_station',
    w,
    h,
    { material: 'brick', color: '#9a8a78' },
    { style: 'flat', color: '#6a6660', axis: 'x' },
    'Gas-N-Go',
  );
  b.exteriorWalls('brick');
  const backD = 3.6;
  const storage = b.room('storage', 0, 0, 9, backD, 'concrete', 'Storage');
  const rest = b.room('bathroom', 9, 0, w - 9, backD, 'tile', 'Restroom');
  const sales = b.room('sales', 0, backD, w, h - backD, 'linoleum', 'Store');
  b.wall(0, backD, w, backD, 'drywall');
  b.wall(9, 0, 9, backD, 'drywall');

  b.door(4.6, h - HALF, 'h', 'glass', rng, { w: 1.4, locked: rng.chance(0.4), swing: -1 });
  b.door(6.5, backD, 'h', 'wood', rng, { open: rng.chance(0.4) });
  b.door(11.5, backD, 'h', 'wood', rng, { w: 0.8, open: rng.chance(0.5) });
  b.door(3, HALF, 'h', 'metal', rng, { locked: true, swing: 1 });
  b.window(8.4, h - HALF, 'h', 'storefront', 2.4);
  b.window(11.4, h - HALF, 'h', 'storefront', 2.4);
  b.window(1.6, h - HALF, 'h', 'storefront', 1.8);
  b.window(w - HALF, backD + 3.2, 'v', 'storefront', 1.8);
  b.reserve(3.2, h - 2.4, 2.8, 2.4);

  b.prop('store_counter', 1.35, backD + 3.1, -Math.PI / 2, { size: { w: 2.4, h: 0.8 }, loot: 'gas_counter' });
  b.prop('cash_register', 1.35, backD + 2.6, -Math.PI / 2);
  b.prop('store_shelf', 7.5, backD + 3.4, Math.PI / 2, { w: 3.2, h: 1.0, size: { w: 3.2, h: 1.0 }, loot: 'gas_shelf' });
  b.prop('store_shelf', 10.6, backD + 3.4, Math.PI / 2, { w: 3.2, h: 1.0, size: { w: 3.2, h: 1.0 }, loot: 'gas_shelf' });
  b.prop('cooler_display', w - HALF - 0.45, backD + 2.2, Math.PI / 2, { size: { w: 3.0, h: 0.85 }, loot: 'gas_cooler' });
  b.againstWall(storage, 'w', 'storage_rack', { w: 2.6, h: 0.9 }, rng, { tall: true, loot: 'gas_backroom' });
  b.againstWall(storage, 'n', 'boxes', { w: 1.1, h: 1.0 }, rng, { loot: 'gas_backroom' });
  b.againstWall(rest, 'n', 'toilet', { w: 0.45, h: 0.7 }, rng);
  b.againstWall(rest, 'e', 'bathroom_cabinet', { w: 0.8, h: 0.5 }, rng);
  void sales;
  return b;
}

export function generateHardwareStore(id: string, rng: Rng): BuildingBuilder {
  const w = 28;
  const h = 22;
  const b = new BuildingBuilder(
    id,
    'hardware',
    w,
    h,
    { material: 'metal', color: '#7a8478' },
    { style: 'flat', color: '#4e5450', axis: 'x' },
    'Miller Hardware',
  );
  b.exteriorWalls('concrete');
  const backD = 6;
  const storage = b.room('storage', 0, 0, 20, backD, 'concrete', 'Warehouse');
  const office = b.room('office', 20, 0, w - 20, backD, 'carpet', 'Office');
  const sales = b.room('sales', 0, backD, w, h - backD, 'concrete', 'Sales Floor');
  b.wall(0, backD, w, backD, 'concrete', 0.2);
  b.wall(20, 0, 20, backD, 'drywall');

  b.door(6, h - HALF, 'h', 'glass', rng, { w: 1.8, locked: rng.chance(0.5), swing: -1 });
  b.door(10, backD, 'h', 'wood', rng, { w: 1.6, open: rng.chance(0.5) });
  b.door(24, backD, 'h', 'wood', rng, { locked: rng.chance(0.4) });
  b.door(4, HALF, 'h', 'metal', rng, { locked: true, swing: 1 });
  b.door(14, HALF, 'h', 'garage', rng, { w: 3, locked: true, swing: 1 });
  b.window(11, h - HALF, 'h', 'storefront', 2.6);
  b.window(14.5, h - HALF, 'h', 'storefront', 2.6);
  b.window(18, h - HALF, 'h', 'storefront', 2.6);
  b.window(21.5, h - HALF, 'h', 'storefront', 2.6);
  b.window(2.2, h - HALF, 'h', 'storefront', 2.2);
  b.reserve(4, h - 5, 4, 5);

  b.prop('store_counter', 13, h - 3.4, 0, { size: { w: 2.4, h: 0.8 }, loot: 'store_counter' });
  b.prop('cash_register', 13, h - 3.4, 0);
  const rows = [backD + 3.4, backD + 7.0, backD + 10.6];
  rows.forEach((y, i) => {
    b.prop('hardware_rack', 13.5, y, 0, { w: 9, h: 0.9, size: { w: 9, h: 0.9 }, loot: i === 1 ? 'hardware_supplies' : 'hardware_tools' });
  });
  b.prop('lumber_rack', w - HALF - 0.65, backD + 6.5, Math.PI / 2, { w: 8, h: 1.2, size: { w: 8, h: 1.2 } });
  b.prop('wall_shelf', HALF + 0.35, backD + 6, -Math.PI / 2, { w: 6, h: 0.6, size: { w: 6, h: 0.6 }, loot: 'hardware_supplies' });

  for (let x = 2; x < 18; x += 3.4) {
    if (rng.chance(0.8)) b.prop('storage_rack', x + 1.3, 1.0 + HALF, 0, { size: { w: 2.6, h: 0.9 }, loot: 'hardware_supplies' });
  }
  b.inRoom(storage, 'pallet', { w: 1.2, h: 1.0 }, rng, { margin: 1.4 });
  b.inRoom(storage, 'boxes', { w: 1.1, h: 1.0 }, rng, { margin: 1.4, loot: 'hardware_supplies' });
  b.againstWall(office, 'n', 'desk', { w: 1.3, h: 0.65 }, rng, { loot: 'store_office' });
  b.againstWall(office, 'e', 'filing_cabinet', { w: 0.5, h: 0.62 }, rng, { tall: true });
  void sales;
  return b;
}

export function generatePoliceStation(id: string, rng: Rng): BuildingBuilder {
  const w = 32;
  const h = 24;
  const b = new BuildingBuilder(
    id,
    'police',
    w,
    h,
    { material: 'brick', color: '#7a5a4a' },
    { style: 'flat', color: '#4a4a4c', axis: 'x' },
    'Police Department',
  );
  b.exteriorWalls('brick');
  const hallY = 13;
  const frontY = 16;

  const lockers = b.room('lockers', 0, 0, 8, hallY, 'tile', 'Locker Room');
  const armory = b.room('armory', 8, 0, 6, 6.5, 'concrete', 'Armory');
  const evidence = b.room('storage', 8, 6.5, 6, hallY - 6.5, 'concrete', 'Evidence Room');
  const cells = b.room('cells', 14, 0, 12, hallY, 'concrete', 'Holding Cells');
  const rest = b.room('bathroom', 26, 0, 6, 5.5, 'tile', 'Restroom');
  const breakroom = b.room('breakroom', 26, 5.5, 6, hallY - 5.5, 'linoleum', 'Break Room');
  const hall = b.room('hallway', 0, hallY, w, frontY - hallY, 'linoleum', 'Corridor');
  const offices = b.room('office', 0, frontY, 10, h - frontY, 'carpet', 'Offices');
  const lobby = b.room('lobby', 10, frontY, 12, h - frontY, 'checker', 'Lobby');
  const bullpen = b.room('office', 22, frontY, 10, h - frontY, 'carpet', 'Bullpen');

  // Walls.
  b.wall(0, hallY, w, hallY, 'concrete', 0.2);
  b.wall(0, frontY, w, frontY, 'drywall');
  b.wall(8, 0, 8, hallY, 'concrete', 0.2);
  b.wall(14, 0, 14, hallY, 'concrete', 0.2);
  b.wall(8, 6.5, 14, 6.5, 'concrete', 0.2);
  b.wall(26, 0, 26, hallY, 'concrete', 0.2);
  b.wall(26, 5.5, w, 5.5, 'drywall');
  b.wall(10, frontY, 10, h, 'drywall');
  b.wall(22, frontY, 22, h, 'drywall');
  // Three cells along the back of the cell block.
  const cellD = 5;
  b.wall(14, cellD, 26, cellD, 'concrete', 0.2);
  b.wall(18, 0, 18, cellD, 'concrete', 0.2);
  b.wall(22, 0, 22, cellD, 'concrete', 0.2);

  // Doors.
  b.door(16, h - HALF, 'h', 'glass', rng, { w: 1.8, open: rng.chance(0.3), swing: -1 });
  b.door(16, frontY, 'h', 'wood', rng, { w: 1.2, open: true });
  b.door(5, frontY, 'h', 'wood', rng, { open: rng.chance(0.5) });
  b.door(27, frontY, 'h', 'wood', rng, { open: rng.chance(0.5) });
  b.door(4, hallY, 'h', 'wood', rng, { open: rng.chance(0.5) });
  b.door(11, hallY, 'h', 'metal', rng, { locked: rng.chance(0.5) });
  b.door(11, 6.5, 'h', 'metal', rng, { locked: true });
  b.door(20, hallY, 'h', 'metal', rng, { open: rng.chance(0.5) });
  b.door(29, hallY, 'h', 'wood', rng, { open: rng.chance(0.5) });
  b.door(29, 5.5, 'h', 'wood', rng, { w: 0.8, open: rng.chance(0.6) });
  for (const cx of [16, 20, 24]) b.door(cx, cellD, 'h', 'cell', rng, { w: 1.0, open: rng.chance(0.5) });
  b.door(3, HALF, 'h', 'metal', rng, { locked: true, swing: 1 });

  // Windows.
  b.windowsAlong('s', 0, 10, 2, 'residential');
  b.windowsAlong('s', 22, w, 2, 'residential');
  b.window(12.5, h - HALF, 'h', 'residential', 1.2);
  b.window(19.5, h - HALF, 'h', 'residential', 1.2);
  b.windowsAlong('w', frontY, h, 1, 'residential');
  b.windowsAlong('e', frontY, h, 1, 'residential');
  b.windowsAlong('e', 5.5, hallY, 1, 'residential', 1.0);

  // Lobby.
  b.prop('store_counter', 16, frontY + 2.4, Math.PI, { size: { w: 2.4, h: 0.8 }, loot: 'police_desk' });
  b.againstWall(lobby, 'w', 'bench', { w: 1.8, h: 0.6 }, rng);
  b.againstWall(lobby, 'e', 'bench', { w: 1.8, h: 0.6 }, rng);
  b.againstWall(lobby, 's', 'plant_pot', { w: 0.45, h: 0.45 }, rng);
  b.againstWall(lobby, 'e', 'water_cooler', { w: 0.45, h: 0.45 }, rng);

  // Offices and bullpen.
  for (const room of [offices, bullpen]) {
    for (let i = 0; i < 3; i++) {
      const desk = b.inRoom(room, 'desk', { w: 1.3, h: 0.65 }, rng, { rot: 0, margin: 0.9, loot: 'police_desk' });
      if (desk) b.prop('chair', desk.x, desk.y - 0.6, Math.PI);
    }
    b.againstWall(room, 'n', 'filing_cabinet', { w: 0.5, h: 0.62 }, rng, { tall: true });
  }

  // Locker room.
  for (let i = 0; i < 5; i++) {
    b.againstWall(lockers, 'w', 'locker', { w: 0.5, h: 0.5 }, rng, { tall: true, loot: 'police_locker', along: 1.2 + i * 0.55 });
  }
  b.inRoom(lockers, 'bench', { w: 1.8, h: 0.6 }, rng, { rot: Math.PI / 2, margin: 1.2 });

  // Armory and evidence.
  b.againstWall(armory, 'n', 'weapon_locker', { w: 1.1, h: 0.55 }, rng, { tall: true, along: 1.5 });
  b.againstWall(armory, 'n', 'weapon_locker', { w: 1.1, h: 0.55 }, rng, { tall: true, along: 4.2 });
  b.againstWall(armory, 'w', 'gun_safe', { w: 0.75, h: 0.65 }, rng, { tall: true, loot: 'weapon_locker' });
  b.againstWall(evidence, 'e', 'evidence_shelf', { w: 1.8, h: 0.5 }, rng, { tall: true });
  b.againstWall(evidence, 'w', 'evidence_shelf', { w: 1.8, h: 0.5 }, rng, { tall: true });

  // Cells.
  for (const cx of [14, 18, 22]) {
    b.prop('cell_bunk', cx + 0.75, 2.6, 0, { size: { w: 0.8, h: 1.9 } });
    b.prop('toilet', cx + 3.2, 0.7, 0, { size: { w: 0.45, h: 0.7 } });
  }
  b.againstWall(cells, 's', 'bench', { w: 1.8, h: 0.6 }, rng);

  // Break room and restroom.
  b.againstWall(breakroom, 'e', 'vending_machine', { w: 0.95, h: 0.8 }, rng, { tall: true });
  b.againstWall(breakroom, 'n', 'kitchen_counter', { w: 1.8, h: 0.62 }, rng, { loot: 'kitchen_cabinet' });
  b.againstWall(breakroom, 'w', 'fridge', { w: 0.82, h: 0.74 }, rng, { tall: true });
  b.againstWall(rest, 'n', 'toilet', { w: 0.45, h: 0.7 }, rng);
  b.againstWall(rest, 'e', 'bathroom_cabinet', { w: 0.8, h: 0.5 }, rng);
  void hall;
  return b;
}
