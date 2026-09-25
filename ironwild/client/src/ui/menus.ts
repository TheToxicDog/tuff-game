// Client-side windows: the build menu (B), research (K), the map with market prices (M), help (H)
// and the smithing minigame.

import {
  ITEMS,
  ITEM_BY_ID,
  RECIPES,
  RESEARCH,
  RESEARCH_BY_ID,
  STATION_NAMES,
  STRUCTURE_BY_ID,
  formatCrests,
  type ItemDef,
} from '@ironwild/shared';
import type { UiContext } from '../game/state';
import { h } from './dom';
import { iconImg } from './icons';
import type { WindowDef } from './windows';

// ——— Build menu ———

const BUILD_GROUPS: { name: string; test: (d: ItemDef) => boolean }[] = [
  {
    name: 'Building',
    test: (d) =>
      ['wood_wall', 'stone_wall', 'wood_door', 'wood_floor', 'stone_floor', 'fence', 'pen_gate', 'torch', 'bed', 'land_claim'].includes(
        d.id,
      ),
  },
  {
    name: 'Stations & storage',
    test: (d) =>
      [
        'campfire',
        'workbench',
        'furnace',
        'anvil',
        'oven',
        'blast_furnace',
        'chest',
        'storage_crate',
        'shipping_crate',
        'shop_stand',
      ].includes(d.id),
  },
  {
    name: 'Power',
    test: (d) => ['water_wheel', 'windmill', 'hand_crank', 'steam_engine', 'shaft', 'gearbox', 'speed_gearbox'].includes(d.id),
  },
  { name: 'Machines', test: (d) => ['crusher', 'washer', 'press', 'millstone', 'saw', 'assembler'].includes(d.id) },
  { name: 'Logistics', test: (d) => ['conveyor', 'hopper', 'splitter', 'filter'].includes(d.id) },
  { name: 'Steam & fluids', test: (d) => ['pump', 'pipe', 'fluid_tank', 'boiler'].includes(d.id) },
  { name: 'Defenses', test: (d) => ['spike_trap', 'arrow_tower'].includes(d.id) },
];

export function buildWindow(ctx: UiContext): WindowDef {
  return {
    title: () => h('span', null, 'Build ', h('span', { class: 'sub' }, 'pick something to place · R rotates · right click cancels')),
    order: 1,
    width: 640,
    render: (body) => {
      const st = ctx.state;
      const near = ctx.nearStations();
      for (const group of BUILD_GROUPS) {
        body.append(h('div', { class: 'section-title' }, group.name));
        const grid = h('div', { class: 'build-items' });
        for (const def of ITEMS.filter((d) => d.place && group.test(d))) {
          const have = st.count(def.id);
          const recipe = RECIPES.find((r) => r.craft && r.outputs[0].item === def.id);
          const known = !!recipe && (!recipe.research || st.research.unlocked.includes(recipe.research));
          const stationOk = !!recipe && (recipe.station === 'hand' || near.has(recipe.station));
          const affordable = !!recipe && recipe.inputs.every((i) => st.count(i.item) >= i.n);
          const canCraft = known && stationOk && affordable && !recipe!.smith;
          const sdef = STRUCTURE_BY_ID.get(def.place!);
          const tip = [
            def.desc ?? '',
            recipe
              ? `Recipe (${STATION_NAMES[recipe.station] ?? recipe.station}): ${recipe.inputs.map((i) => `${i.n} ${ITEM_BY_ID.get(i.item)?.name}`).join(', ')}${recipe.research && !known ? ` — needs ${RESEARCH_BY_ID.get(recipe.research)?.name} research` : ''}`
              : 'Buy it from a trader.',
            sdef ? `Size ${sdef.size[0]}×${sdef.size[1]}` : '',
          ]
            .filter(Boolean)
            .join('\n');
          const el = h(
            'div',
            {
              class: `build-item${have > 0 || canCraft ? '' : ' unavailable'}`,
              title: tip,
              onclick: () => {
                if (have > 0) ctx.startPlacement(def.id);
                else if (canCraft) {
                  ctx.send({ t: 'craft', recipe: recipe!.id, n: 1 });
                  setTimeout(() => ctx.startPlacement(def.id), 150);
                } else
                  ctx.notice(
                    known
                      ? `You need the materials${stationOk ? '' : ` and a ${STATION_NAMES[recipe!.station]?.toLowerCase()}`} — or buy one.`
                      : `Buy a ${def.name} or research it first.`,
                    'bad',
                  );
              },
            },
            iconImg(def.id, 46),
            h('div', null, def.name),
            have > 0
              ? h('div', { class: 'have' }, `×${have}`)
              : canCraft
                ? h('div', { class: 'muted' }, 'craft')
                : h('div', { class: 'muted' }, formatCrests(def.value)),
          );
          grid.append(el);
        }
        body.append(grid);
      }
    },
  };
}

// ——— Research ———

export function researchWindow(ctx: UiContext): WindowDef {
  return {
    title: () => h('span', null, 'Research ', h('span', { class: 'kp' }, `${ctx.state.research.kp} knowledge`)),
    order: 1,
    width: 1040,
    render: (body) => {
      const st = ctx.state.research;
      body.append(
        h(
          'div',
          { class: 'muted', style: 'margin-bottom:8px' },
          'Earn knowledge by discovering new resources, crafting new things, selling in new towns, completing contracts and running machines.',
        ),
      );
      const grid = h('div', { class: 'research-grid' });
      const W = 165;
      const H = 124;
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('width', '1000');
      svg.setAttribute('height', '620');
      for (const n of RESEARCH) {
        for (const req of n.requires) {
          const r = RESEARCH_BY_ID.get(req)!;
          const line = document.createElementNS(svgNS, 'line');
          line.setAttribute('x1', String(r.col * W + 150));
          line.setAttribute('y1', String(r.row * H + 40));
          line.setAttribute('x2', String(n.col * W));
          line.setAttribute('y2', String(n.row * H + 40));
          line.setAttribute('stroke', st.unlocked.includes(req) ? '#8fd45a' : 'rgba(255,255,255,0.2)');
          line.setAttribute('stroke-width', '2');
          svg.append(line);
        }
      }
      grid.append(svg);
      for (const n of RESEARCH) {
        const done = st.unlocked.includes(n.id);
        const reqOk = n.requires.every((r) => st.unlocked.includes(r));
        const bpOk = !n.blueprint || st.blueprints.includes(n.blueprint);
        const available = !done && reqOk && bpOk;
        const el = h(
          'div',
          { class: `rnode ${done ? 'done' : available ? 'available' : 'locked'}`, style: `left:${n.col * W}px;top:${n.row * H}px` },
          h('div', { class: 't' }, n.name),
          h('div', { class: 'muted' }, n.desc),
          n.blueprint && !bpOk ? h('div', { class: 'bad', style: 'font-size:11px' }, `Needs ${ITEM_BY_ID.get(n.blueprint)?.name}`) : null,
          done
            ? h('div', { class: 'good', style: 'margin-top:4px' }, '✔ Researched')
            : h(
                'button',
                { class: 'small gold', disabled: !available || st.kp < n.cost, onclick: () => ctx.send({ t: 'research', node: n.id }) },
                `Research · ${n.cost}`,
              ),
        );
        grid.append(el);
      }
      body.append(grid);
    },
  };
}

// ——— Map ———

export function mapWindow(ctx: UiContext, tab: { value: 'map' | 'markets' }): WindowDef {
  return {
    title: () =>
      h(
        'span',
        { class: 'row' },
        'Map',
        h(
          'button',
          { class: `small${tab.value === 'map' ? ' gold' : ''}`, onclick: () => ((tab.value = 'map'), ctx.refresh('map')) },
          'Valley',
        ),
        h(
          'button',
          {
            class: `small${tab.value === 'markets' ? ' gold' : ''}`,
            onclick: () => {
              tab.value = 'markets';
              ctx.send({ t: 'markets' });
              ctx.refresh('map');
            },
          },
          'Market prices',
        ),
      ),
    order: 1,
    render: (body) => (tab.value === 'map' ? renderMap(body, ctx) : renderMarkets(body, ctx)),
  };
}

function renderMap(body: HTMLElement, ctx: UiContext): void {
  const size = Math.min(640, window.innerHeight - 240);
  const wrap = h('div', { class: 'map-wrap', style: `width:${size}px;height:${size}px` });
  const canvas = h('canvas', { width: size, height: size }) as HTMLCanvasElement;
  const c2 = canvas.getContext('2d')!;
  c2.imageSmoothingEnabled = true;
  c2.drawImage(ctx.terrainCanvas(), 0, 0, size, size);
  const scale = size / ctx.world.size;
  wrap.append(canvas);
  for (const s of ctx.world.settlements) {
    c2.fillStyle = 'rgba(255, 243, 201, 0.9)';
    c2.beginPath();
    c2.arc(s.x * scale, s.y * scale, 5, 0, Math.PI * 2);
    c2.fill();
    wrap.append(
      h('div', { class: `map-label ${s.kind === 'town' ? 'town' : ''}`, style: `left:${s.x * scale}px;top:${s.y * scale - 16}px` }, s.name),
    );
  }
  for (const l of ctx.world.landmarks) {
    c2.fillStyle = l.kind === 'bandit_camp' ? '#e8645a' : l.kind === 'wreck' ? '#8fd0f0' : '#b3ab94';
    c2.beginPath();
    c2.arc(l.x * scale, l.y * scale, 4, 0, Math.PI * 2);
    c2.fill();
    wrap.append(
      h(
        'div',
        {
          class: 'map-label',
          style: `left:${l.x * scale}px;top:${l.y * scale - 13}px;font-size:11px;color:${l.kind === 'bandit_camp' ? '#ffb0a8' : '#ddd'}`,
        },
        l.name,
      ),
    );
  }
  const px = ctx.state.playerX * scale;
  const py = ctx.state.playerY * scale;
  c2.fillStyle = '#f2c53d';
  c2.strokeStyle = '#000';
  c2.lineWidth = 2;
  c2.beginPath();
  c2.arc(px, py, 6, 0, Math.PI * 2);
  c2.fill();
  c2.stroke();
  wrap.append(h('div', { class: 'map-label', style: `left:${px}px;top:${py + 16}px;color:#f2c53d` }, 'You'));
  body.append(wrap);
}

function renderMarkets(body: HTMLElement, ctx: UiContext): void {
  const m = ctx.state.markets;
  if (!m) {
    body.append(h('div', { class: 'muted' }, 'Asking around…'));
    return;
  }
  body.append(
    h(
      'div',
      { class: 'muted', style: 'margin-bottom:6px' },
      'What traders pay (sell) and charge (buy) right now. Buy where it is cheap, sell where it is dear.',
    ),
  );
  // Town growth and market news.
  const towns = h('div', { class: 'towns' });
  for (const s of ctx.world.settlements) {
    const t = ctx.state.towns.get(s.id);
    if (!t) continue;
    const card = h(
      'div',
      { class: 'town-card' },
      h('div', { class: 'name' }, s.name, h('span', { class: 'sub' }, ` prosperity ${Math.round(t.prosperity).toLocaleString()}`)),
      t.next ? h('div', { class: 'muted' }, `Next stall: ${t.next.title} at ${t.next.at.toLocaleString()}`) : null,
    );
    for (const e of t.events ?? []) {
      const hours = Math.max(1, Math.round((e.ends - ctx.state.minutes) / 60));
      card.append(h('div', { class: 'news' }, h('b', null, e.title), ` — ${e.text} `, h('span', { class: 'muted' }, `(~${hours} h left)`)));
    }
    towns.append(card);
  }
  body.append(towns);
  const table = h('table', { class: 'market-table' });
  const head = h('tr', null, h('th', null, 'Item'));
  for (const s of m) head.append(h('th', { colspan: '2' }, s.settlement));
  table.append(head);
  const sub = h('tr', null, h('th'));
  for (let i = 0; i < m.length; i++) sub.append(h('th', null, 'pays'), h('th', null, 'sells'));
  table.append(sub);
  const ids = m[0]?.items.map((x) => x[0]) ?? [];
  ids.forEach((id, k) => {
    const row = h('tr', null, h('td', null, iconImg(id, 18), ITEM_BY_ID.get(id)?.name ?? id));
    const bids = m.map((s) => s.items[k][1]);
    const best = Math.max(...bids);
    for (const s of m) {
      const [, bid, ask] = s.items[k];
      row.append(
        h('td', { class: bid === best && bid > 0 ? 'good' : '' }, bid ? formatCrests(bid) : '—'),
        h('td', { class: 'muted' }, ask ? formatCrests(ask) : '—'),
      );
    }
    table.append(row);
  });
  body.append(table);
}

// ——— Factory overview (§59) ———

export function factoryWindow(ctx: UiContext): WindowDef {
  return {
    title: () => h('span', null, 'Your Factory ', h('span', { class: 'sub' }, 'updates every few seconds')),
    order: 1,
    width: 640,
    render: (body) => {
      const st = ctx.state.stats;
      if (!st) {
        body.append(h('div', { class: 'muted' }, 'Counting…'));
        return;
      }
      if (st.machines.length === 0) {
        body.append(
          h(
            'div',
            { class: 'muted' },
            'You do not own any machines yet. Build a furnace, or research Mechanical Power and put a water wheel on the river.',
          ),
        );
        return;
      }
      body.append(
        h(
          'div',
          { class: 'row', style: 'margin-bottom:8px' },
          h('span', { class: 'muted' }, 'Output value'),
          h('span', { class: 'crests', style: 'font-size:20px' }, `${formatCrests(st.valuePerMin)} / min`),
          h('span', { class: 'muted' }, '(at base prices)'),
        ),
      );
      const table = h('table', { class: 'table' });
      table.append(
        h(
          'tr',
          null,
          h('td', { class: 'muted' }, 'Machine'),
          h('td', { class: 'muted' }, 'Busy'),
          h('td', { class: 'muted' }, 'Making / min'),
          h('td', { class: 'muted' }, 'Value / min'),
          h('td', { class: 'muted' }, 'Problems'),
        ),
      );
      for (const m of st.machines) {
        const def = STRUCTURE_BY_ID.get(m.type);
        const made = h('div', { class: 'row', style: 'flex-wrap:wrap;gap:4px' });
        for (const [item, n] of m.perMin) made.append(h('span', { class: 'row', style: 'gap:2px' }, iconImg(item, 18), `${n}`));
        if (m.perMin.length === 0) made.append(h('span', { class: 'muted' }, '—'));
        const util = Math.round(m.util * 100);
        table.append(
          h(
            'tr',
            null,
            h('td', null, h('span', { class: 'row' }, iconImg(def?.item ?? m.type, 24), `${m.count}× ${def?.name ?? m.type}`)),
            h('td', { class: util > 80 ? 'good' : util < 30 ? 'bad' : '' }, `${util}%`),
            h('td', null, made),
            h('td', { class: 'crests' }, formatCrests(m.value)),
            h('td', { class: 'muted', style: 'font-size:12px' }, m.issues.map(([k, n]) => `${n} ${k.toLowerCase()}`).join(', ') || '—'),
          ),
        );
      }
      body.append(table);
      if (st.networks.length) {
        body.append(h('div', { class: 'section-title' }, 'Power networks'));
        for (const n of st.networks) {
          const pct = n.cap > 0 ? Math.min(100, (n.load / n.cap) * 100) : 100;
          body.append(
            h(
              'div',
              { class: 'row', style: 'font-size:13px' },
              h('span', { style: 'width:170px' }, `${n.rpm.toFixed(0)} RPM · ${n.load.toFixed(1)} / ${n.cap.toFixed(0)}`),
              h(
                'div',
                { class: 'stress', style: 'flex:1' },
                h('div', { style: `width:${pct}%;background:${n.stalled ? '#e8645a' : pct > 85 ? '#f0a13c' : '#8fd45a'}` }),
              ),
            ),
          );
        }
      }
      if (st.hints.length) {
        body.append(h('div', { class: 'section-title' }, 'Bottlenecks'));
        body.append(h('ul', { class: 'tips' }, ...st.hints.map((t) => h('li', null, t))));
      }
    },
  };
}

// ——— Help ———

export function helpWindow(): WindowDef {
  const keys: [string, string][] = [
    ['W A S D', 'Move'],
    ['Mouse', 'Aim'],
    ['Left click', 'Use tool / attack (hold to keep swinging; hold with a weapon for a heavy blow)'],
    ['Right click', 'Eat food · block with a weapon · till with a hoe · plant seeds'],
    ['Shift', 'Sprint'],
    ['Space', 'Dodge'],
    ['E', 'Interact: trade, open, operate (hold on a hand crank)'],
    ['F', 'Pick up (dropped items and bags)'],
    ['G', 'Pull a hand cart / mount a horse'],
    ['1 – 8', 'Hotbar'],
    ['Tab / I', 'Inventory & crafting'],
    ['B', 'Build'],
    ['R', 'Rotate while building'],
    ['Q', 'Drop the selected item'],
    ['K', 'Research'],
    ['J', 'Contracts'],
    ['O', 'Factory overview: output, bottlenecks, power'],
    ['M', 'Map & market prices'],
    ['Enter', 'Chat (/help for commands)'],
    ['Wheel', 'Zoom'],
  ];
  return {
    title: () => 'How to play',
    order: 1,
    width: 720,
    render: (body) => {
      const grid = h('div', { class: 'keys' });
      for (const [k, d] of keys) grid.append(h('kbd', null, k), h('span', null, d));
      body.append(grid);
      body.append(
        h('div', { class: 'section-title' }, 'Getting rich'),
        h(
          'ul',
          { class: 'tips' },
          h(
            'li',
            null,
            'Chop, mine and sell in Westhaven. Every settlement trader buys different things; the General Store buys anything, cheaply.',
          ),
          h(
            'li',
            null,
            'Selling lots of one thing to one merchant drops the price. Markets recover over a day or so — or carry goods to another town.',
          ),
          h(
            'li',
            null,
            'Stonehaven (east, highlands) sells ore and coal cheaply but pays well for food and timber. Greenfield (south) has cheap food and pays dearly for tools and machines.',
          ),
          h(
            'li',
            null,
            'Processing adds value: ore → ingots → plates → gears. A furnace turns 10 ore into 7 ingots; crushing and washing first gets you 10.',
          ),
          h(
            'li',
            null,
            'Research Mechanical Power, put a water wheel on the river and connect machines with shafts and gearboxes. Each machine needs torque — watch the stress bar.',
          ),
          h(
            'li',
            null,
            'Conveyors need rotation too: put a shaft end or gearbox next to them. Machines push their output onto a conveyor in front of them.',
          ),
          h('li', null, 'Shipping crates sell their contents automatically every dawn. Contracts pay well for bulk deliveries.'),
          h('li', null, 'Claim land to protect your factory. When you die you drop a quarter of your resources in a bag — go back for it!'),
        ),
      );
    },
  };
}

// ——— Smithing ———

export class Smithing {
  private recipe: string | null = null;
  private hits: number[] = [];
  private start = 0;
  private marker: HTMLElement | null = null;
  private feedback: HTMLElement | null = null;
  private raf = 0;

  constructor(private readonly ctx: UiContext) {}

  begin(recipe: string): WindowDef {
    this.recipe = recipe;
    this.hits = [];
    this.start = performance.now();
    return {
      title: () => h('span', null, 'Forging ', h('span', { class: 'sub' }, ITEM_BY_ID.get(this.outputOf())?.name ?? '')),
      order: 3,
      render: (body) => this.render(body),
      onClose: () => {
        cancelAnimationFrame(this.raf);
        this.recipe = null;
      },
    };
  }

  private outputOf(): string {
    return RECIPES.find((r) => r.id === this.recipe)?.outputs[0].item ?? '';
  }

  private render(body: HTMLElement): void {
    body.classList.add('smith');
    this.marker = h('div', { class: 'marker' });
    this.feedback = h('div', { class: 'smith-hits' });
    body.append(
      h(
        'div',
        { class: 'muted', style: 'margin-bottom:8px' },
        'Strike when the marker crosses the glowing centre — three blows. Better timing, better quality.',
      ),
      h('div', { class: 'smith-bar' }, this.marker),
      this.feedback,
      h(
        'div',
        { class: 'row', style: 'justify-content:center;margin-top:10px' },
        h('button', { class: 'gold', onclick: () => this.strike() }, 'Strike! (Space)'),
      ),
    );
    const loop = () => {
      if (!this.marker) return;
      this.marker.style.left = `${this.position() * 100}%`;
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
  }

  /** Marker position 0–1; it speeds up with every strike. */
  private position(): number {
    const t = (performance.now() - this.start) / 1000;
    const speed = 1.1 + this.hits.length * 0.35;
    return 0.5 + 0.5 * Math.sin(t * speed * Math.PI);
  }

  get active(): boolean {
    return this.recipe !== null;
  }

  strike(): void {
    if (!this.recipe || this.hits.length >= 3) return;
    const pos = this.position();
    const acc = Math.max(0, Math.min(1, 1 - Math.abs(pos - 0.5) * 2.6));
    this.hits.push(acc);
    this.ctx.sfx.play(acc > 0.4 ? 'anvil' : 'miss');
    if (this.feedback)
      this.feedback.append(
        h('span', { class: acc > 0.9 ? 'crests' : acc > 0.6 ? 'good' : 'bad' }, acc > 0.9 ? 'Perfect!' : acc > 0.6 ? 'Good' : 'Off'),
      );
    if (this.hits.length === 3) {
      const recipe = this.recipe;
      const hits = this.hits;
      setTimeout(() => {
        this.ctx.send({ t: 'smith', recipe, hits });
        this.ctx.close('smith');
      }, 350);
    }
  }
}
