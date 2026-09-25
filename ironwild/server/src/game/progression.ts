// Progression without levels (§50–51): knowledge from discovery, crafting, contracts and running
// machines; the research tree; and a guided first fifteen minutes (§9).

import { ITEM_BY_ID, KNOWLEDGE, RESEARCH_BY_ID, countItem, formatCrests } from '@ironwild/shared';
import type { Game } from './game';
import type { Player } from './player';

interface TutorialStep {
  title: string;
  text: string;
  /** State check run every second; events can also complete steps. */
  check?: (p: Player, game: Game) => boolean;
  progress?: (p: Player, game: Game) => string;
  event?: string;
}

const have = (p: Player, id: string) => countItem(p.slots, id);

const STEPS: TutorialStep[] = [
  {
    title: 'Chop a tree',
    text: 'Hold left click on a tree with your axe (slot 1). Wood is the first thing everything is made of.',
    check: (p) => have(p, 'wood') >= 10,
    progress: (p) => `${Math.min(10, have(p, 'wood'))}/10 wood`,
  },
  {
    title: 'Mine some stone',
    text: 'Switch to your pickaxe (2) and break rocks.',
    check: (p) => have(p, 'stone') >= 10,
    progress: (p) => `${Math.min(10, have(p, 'stone'))}/10 stone`,
  },
  {
    title: 'Find iron',
    text: 'Iron veins are grey rocks with rusty flecks. Look east of Westhaven, towards the highlands.',
    check: (p) => have(p, 'iron_ore') >= 5,
    progress: (p) => `${Math.min(5, have(p, 'iron_ore'))}/5 iron ore`,
  },
  {
    title: 'Sell in Westhaven',
    text: 'Walk into town and press E on a merchant. The Blacksmith buys ore, the Lumber Merchant buys wood.',
    event: 'sell',
  },
  {
    title: 'Earn ₡150',
    text: 'Keep gathering and selling. Prices drop if you flood one merchant — spread your sales around.',
    check: (p) => p.stats.earned >= 150,
    progress: (p) => `${formatCrests(p.stats.earned)} / ₡150 earned`,
  },
  {
    title: 'Get an iron pickaxe',
    text: 'The Tool Dealer sells one. Iron tools mine twice as fast and can break richer deposits.',
    check: (p) => have(p, 'iron_pickaxe') > 0,
  },
  {
    title: 'Smelt an iron ingot',
    text: 'Craft a Workbench (Tab → Hand), then a Furnace at the workbench. Place it (B), put in iron ore and coal or wood.',
    check: (p) => have(p, 'iron_ingot') > 0,
  },
  {
    title: 'Sell an ingot',
    text: 'Processed goods sell for more than raw ore. Compare the price!',
    event: 'sell_ingot',
  },
  {
    title: 'Research Smithing',
    text: 'You earn knowledge by discovering, crafting and trading. Press K to open research.',
    check: (p) => p.unlocked.has('smithing'),
  },
  {
    title: 'Research Mechanical Power',
    text: 'Water wheels, shafts and gearboxes: machines that work while you do not.',
    check: (p) => p.unlocked.has('mechanics'),
  },
  {
    title: 'Build a water wheel',
    text: 'Place it on the river. Buy one from the Engineer if you cannot build it yet.',
    event: 'place_water_wheel',
  },
  {
    title: 'Power a machine',
    text: 'Connect a machine to your wheel with shafts (or a gearbox). Watch the stress: 100 torque is the limit.',
    check: (p, game) => {
      for (const s of game.world.structures.values()) {
        if (s.owner === p.accountId && s.def.machine?.powered && s.machine?.active) return true;
      }
      return false;
    },
  },
];

export class Progression {
  constructor(private readonly game: Game) {}

  addKnowledge(p: Player, amount: number, quiet = false): void {
    if (amount <= 0) return;
    const before = Math.floor(p.kp);
    p.kp += amount;
    if (quiet && Math.floor(p.kp) === before) return;
    p.researchDirty = true;
    p.statusDirty = true;
  }

  discover(p: Player, item: string): void {
    if (p.discovered.has(item)) return;
    p.discovered.add(item);
    const def = ITEM_BY_ID.get(item);
    if (!def) return;
    this.addKnowledge(p, KNOWLEDGE.discoverItem);
    this.game.notice(p, `Discovered ${def.name} (+${KNOWLEDGE.discoverItem} knowledge)`, 'good');
  }

  research(p: Player, id: string): void {
    const node = RESEARCH_BY_ID.get(id);
    if (!node || p.unlocked.has(id)) return;
    if (!node.requires.every((r) => p.unlocked.has(r))) {
      this.game.notice(p, 'Research the earlier topics first.', 'bad');
      return;
    }
    if (node.blueprint && !p.blueprints.has(node.blueprint)) {
      this.game.notice(p, `You need to study the ${ITEM_BY_ID.get(node.blueprint)?.name} first.`, 'bad');
      return;
    }
    if (p.kp < node.cost) {
      this.game.notice(p, `You need ${node.cost} knowledge.`, 'bad');
      return;
    }
    p.kp -= node.cost;
    p.unlocked.add(id);
    p.researchDirty = p.statusDirty = true;
    this.game.notice(p, `Researched ${node.name}!`, 'good');
    this.game.emit(['sfx', 'research', Math.round(p.x * 100), Math.round(p.y * 100)], p.x, p.y, { only: p.id });
  }

  // ——— Hooks ———

  onGather(_p: Player, _item: string, _n: number): void {}

  onCraft(p: Player, item: string, _n: number): void {
    if (!p.crafted.has(item)) {
      p.crafted.add(item);
      this.addKnowledge(p, KNOWLEDGE.firstCraft);
    }
  }

  onSell(p: Player, settlement: string, item: string, _n: number, _value: number): void {
    if (!p.soldAt.has(settlement)) {
      p.soldAt.add(settlement);
      this.addKnowledge(p, KNOWLEDGE.firstSettlementSale);
    }
    this.event(p, 'sell');
    if (item === 'iron_ingot') this.event(p, 'sell_ingot');
  }

  onBuy(_p: Player, _item: string, _n: number): void {}

  onPlace(p: Player, type: string): void {
    this.event(p, `place_${type}`);
  }

  onKill(_p: Player, _creature: string): void {}

  onContract(p: Player): void {
    this.event(p, 'contract');
  }

  onCrank(_p: Player): void {}

  // ——— Tutorial ———

  private event(p: Player, name: string): void {
    const step = STEPS[p.tutorial];
    if (step?.event === name) this.advance(p);
  }

  private advance(p: Player): void {
    const step = STEPS[p.tutorial];
    p.tutorial++;
    p.tutorialDirty = true;
    this.addKnowledge(p, KNOWLEDGE.tutorialStep);
    if (step) this.game.notice(p, `✔ ${step.title}`, 'good');
    if (p.tutorial === STEPS.length) {
      p.crests += 100;
      p.statusDirty = true;
      this.game.notice(p, 'Guide complete! +₡100. Everything can become a business — now go build one.', 'money');
    }
  }

  stepSecond(): void {
    for (const p of this.game.players.values()) {
      const step = STEPS[p.tutorial];
      if (!step) continue;
      if (step.check?.(p, this.game)) this.advance(p);
      else if (step.progress && this.game.tick % 40 === 0) p.tutorialDirty = true;
    }
  }

  sendTutorial(p: Player): void {
    const step = STEPS[p.tutorial];
    if (!step) {
      p.session.send({ t: 'tutorial', step: p.tutorial, title: '', text: '', done: true });
      return;
    }
    p.session.send({
      t: 'tutorial',
      step: p.tutorial,
      title: step.title,
      text: step.text,
      progress: step.progress?.(p, this.game),
      done: false,
    });
  }
}
