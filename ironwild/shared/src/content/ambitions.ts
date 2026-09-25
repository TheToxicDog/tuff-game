// Ambitions (§47–50, §63): long goals past the guided start. The wealth ladder follows the arc
// from gatherer to industrial empire, and the highest rung reached is the title shown under your
// name; the feats are the endgame — building something absurdly efficient. Each is worth prestige.

export type AmbitionKind =
  /** Net worth: Crests, what you carry and everything you own, with its contents. */
  | 'worth'
  /** Money taken in during one game day (sales, contracts, shops, shipping). */
  | 'day_income'
  /** Value your machines add to what they process in one game day (outputs minus inputs). */
  | 'day_added'
  /** Machine output of one item, all time. */
  | 'made'
  /** Value of goods delivered to town projects. */
  | 'projects'
  /** Items delivered by rail (unloaded at stations). */
  | 'freight'
  /** Sold in one settlement, all time (the best settlement counts). */
  | 'town_sales'
  /** Masterworks forged. */
  | 'masterwork'
  /** Supply of the biggest grid you have generators on. */
  | 'grid'
  /** Monuments raised. */
  | 'monument';

export interface Ambition {
  id: string;
  title: string;
  desc: string;
  kind: AmbitionKind;
  n: number;
  item?: string;
  prestige: number;
  /** A rung of the wealth ladder: the highest one reached is your title. */
  rank?: boolean;
}

export const AMBITIONS: readonly Ambition[] = [
  {
    id: 'homesteader',
    title: 'Homesteader',
    desc: 'Be worth ₡5,000 — the gathering days are behind you.',
    kind: 'worth',
    n: 5_000,
    prestige: 1,
    rank: true,
  },
  { id: 'craftsman', title: 'Craftsman', desc: 'Be worth ₡25,000.', kind: 'worth', n: 25_000, prestige: 2, rank: true },
  { id: 'workshop_owner', title: 'Workshop Owner', desc: 'Be worth ₡100,000.', kind: 'worth', n: 100_000, prestige: 3, rank: true },
  { id: 'factory_owner', title: 'Factory Owner', desc: 'Be worth ₡1,000,000.', kind: 'worth', n: 1_000_000, prestige: 5, rank: true },
  {
    id: 'industrialist',
    title: 'Industrialist',
    desc: 'Be worth ₡10,000,000 — an industrial empire.',
    kind: 'worth',
    n: 10_000_000,
    prestige: 10,
    rank: true,
  },
  { id: 'master_smith', title: 'Master Smith', desc: 'Forge a Masterwork at the anvil.', kind: 'masterwork', n: 1, prestige: 2 },
  {
    id: 'city_supplier',
    title: 'City Supplier',
    desc: 'Deliver ₡50,000 of goods to town projects.',
    kind: 'projects',
    n: 50_000,
    prestige: 3,
  },
  {
    id: 'steelworks',
    title: 'Steelworks',
    desc: 'Have your blast furnaces turn out 1,000 steel ingots.',
    kind: 'made',
    item: 'steel_ingot',
    n: 1_000,
    prestige: 3,
  },
  { id: 'freight_network', title: 'Freight Network', desc: 'Deliver 10,000 items by rail.', kind: 'freight', n: 10_000, prestige: 3 },
  { id: 'power_company', title: 'Power Company', desc: 'Run a power grid supplying 1,000 power.', kind: 'grid', n: 1_000, prestige: 3 },
  { id: 'monument_builder', title: 'Monument Builder', desc: 'Raise a monument.', kind: 'monument', n: 1, prestige: 2 },
  { id: 'big_day', title: 'A ₡100,000 Day', desc: 'Take in ₡100,000 in a single day.', kind: 'day_income', n: 100_000, prestige: 4 },
  {
    id: 'trade_baron',
    title: 'Trade Baron',
    desc: 'Sell ₡250,000 of goods in a single town.',
    kind: 'town_sales',
    n: 250_000,
    prestige: 4,
  },
  {
    id: 'absurdly_efficient',
    title: 'Absurdly Efficient',
    desc: 'Have your machines add ₡100,000 of value to what they process in a single day.',
    kind: 'day_added',
    n: 100_000,
    prestige: 6,
  },
];

export const AMBITION_BY_ID: ReadonlyMap<string, Ambition> = new Map(AMBITIONS.map((a) => [a.id, a]));

/** The title for a set of finished ambitions: the highest wealth rung. */
export function rankTitle(done: Iterable<string>): string | null {
  const set = new Set(done);
  let title: string | null = null;
  for (const a of AMBITIONS) if (a.rank && set.has(a.id)) title = a.title;
  return title;
}
