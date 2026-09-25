// Panels driven by the server: trading with an NPC, containers, machines, shop stands, land
// claims, the contract board and the exchange.

import {
  ITEMS,
  ITEM_BY_ID,
  OVERCLOCK,
  QUALITY_NAMES,
  RECIPE_BY_ID,
  formatCrests,
  type BoardUi,
  type ClaimRole,
  type ClaimUi,
  type ContainerUi,
  type ExchangeUi,
  type MachineUi,
  type ShopUi,
  type TradeListing,
  type TradeUi,
  type UiState,
} from '@ironwild/shared';
import type { UiContext } from '../game/state';
import { fmtTime, h } from './dom';
import { iconImg } from './icons';
import { slotEl } from './slots';
import type { WindowDef } from './windows';

export function panelFor(ui: UiState, ctx: UiContext): WindowDef | null {
  switch (ui.kind) {
    case 'trade':
      return { title: () => titleOf(ui.name, `${ui.title} · ${ui.settlement}`), order: 2, width: 720, render: (b) => trade(b, ui, ctx) };
    case 'container':
      return { title: () => ui.title, order: 2, render: (b) => container(b, ui, ctx) };
    case 'machine':
      return { title: () => ui.title, order: 2, width: 470, render: (b) => machine(b, ui, ctx) };
    case 'shop':
      return { title: () => ui.title, order: 2, width: 470, render: (b) => shop(b, ui, ctx) };
    case 'claim':
      return { title: () => titleOf('Land Claim', `owned by ${ui.owner}`), order: 2, width: 380, render: (b) => claim(b, ui, ctx) };
    case 'board':
      return { title: () => titleOf('Contract Board', ui.settlement), order: 2, width: 560, render: (b) => board(b, ui, ctx) };
    case 'exchange':
      return { title: () => titleOf('Exchange', 'buy orders between players'), order: 2, width: 600, render: (b) => exchange(b, ui, ctx) };
    case 'station':
      return null;
  }
}

function titleOf(main: string, sub: string): HTMLElement {
  return h('span', null, main, ' ', h('span', { class: 'sub' }, sub));
}

function levelTag(level: number): HTMLElement {
  if (level < 0.7) return h('span', { class: 'level scarce' }, 'scarce');
  if (level > 1.4) return h('span', { class: 'level glut' }, 'saturated');
  return h('span', { class: 'level normal' }, 'normal');
}

function itemName(id: string, q?: number): string {
  const def = ITEM_BY_ID.get(id);
  const name = def?.name ?? id;
  return def?.quality && q !== undefined && q !== 1 ? `${QUALITY_NAMES[q]} ${name}` : name;
}

// ——— Trade ———

function trade(body: HTMLElement, ui: TradeUi, ctx: UiContext): void {
  const st = ctx.state;
  body.append(h('div', { class: 'npc-line' }, `“${ui.line}”`));
  const buyCol = h('div', null, h('div', { class: 'section-title' }, `${ui.name} sells`));
  if (ui.sells.length === 0) buyCol.append(h('div', { class: 'muted' }, 'Nothing for sale.'));
  for (const l of ui.sells) buyCol.append(listing(l, 'buy', ui, ctx, st.status.crests));
  const sellCol = h('div', null, h('div', { class: 'section-title' }, `${ui.name} buys from you`));
  if (ui.buys.length === 0) sellCol.append(h('div', { class: 'muted' }, `Nothing in your backpack interests ${ui.name}.`));
  for (const l of ui.buys) sellCol.append(listing(l, 'sell', ui, ctx, st.status.crests));
  body.append(h('div', { class: 'trade-cols' }, buyCol, sellCol));
  body.append(
    h(
      'div',
      { class: 'muted', style: 'font-size:12px;margin-top:8px' },
      'Each unit you sell lowers the price of the next — markets recover over the next day or so.',
    ),
  );
}

function listing(l: TradeListing, op: 'buy' | 'sell', ui: TradeUi, ctx: UiContext, crests: number): HTMLElement {
  const have = op === 'sell' ? countQ(ctx, l.item, l.q) : 0;
  const send = (n: number) => ctx.send({ t: 'trade', npc: ui.npc, op, item: l.item, n, ...(l.q !== undefined ? { q: l.q } : {}) });
  const buttons = h('div', { class: 'row' });
  if (op === 'buy') {
    const afford = Math.floor(crests / Math.max(0.01, l.price));
    buttons.append(
      h('button', { class: 'small', disabled: l.stock < 1 || afford < 1, onclick: () => send(1) }, '1'),
      h('button', { class: 'small', disabled: l.stock < 10 || afford < 10, onclick: () => send(10) }, '10'),
    );
  } else {
    buttons.append(
      h('button', { class: 'small', onclick: () => send(1) }, '1'),
      h('button', { class: 'small', disabled: have < 10, onclick: () => send(10) }, '10'),
      h('button', { class: 'small gold', onclick: () => send(have) }, `All ${have}`),
    );
  }
  return h(
    'div',
    { class: 'listing' },
    iconImg(l.item, 32),
    h(
      'div',
      { class: 'info' },
      h('div', { class: 'n' }, itemName(l.item, l.q)),
      h(
        'div',
        { class: 'p' },
        h('span', { class: 'crests' }, formatCrests(l.price)),
        op === 'buy' ? ` · ${l.stock} in stock` : '',
        levelTag(l.level),
      ),
    ),
    buttons,
  );
}

function countQ(ctx: UiContext, id: string, q?: number): number {
  let n = 0;
  for (const s of ctx.state.slots) if (s && s.id === id && (q === undefined || s.q === q)) n += s.n;
  return n;
}

// ——— Containers ———

function container(body: HTMLElement, ui: ContainerUi, ctx: UiContext): void {
  const grid = h('div', { class: 'slots' });
  ui.store.forEach((s, i) => grid.append(slotEl({ s: 'store', i }, s)));
  body.append(grid);
  const takeAll = () => {
    ui.store.forEach((s, i) => {
      if (s) ctx.send({ t: 'quick', from: { s: 'store', i } });
    });
  };
  body.append(h('div', { class: 'row', style: 'margin-top:8px' }, h('button', { class: 'small', onclick: takeAll }, 'Take all')));
}

// ——— Machines ———

const STATUS_WARN = new Set([
  'No power',
  'Overstressed',
  'No fuel',
  'Output full',
  'Needs water',
  'Gears jammed',
  'Wrong input',
  'No water',
  'No steam',
  'No pipe',
  'Pipes full',
  'Steam backed up',
  'Pipe it to a boiler',
  'No electricity',
  'No power pole nearby',
]);

const FLUID_BAR: Record<string, string> = { Water: '#4f8fd0', Steam: '#dfe6ea' };

function machine(body: HTMLElement, ui: MachineUi, ctx: UiContext): void {
  const cols: HTMLElement[] = [];
  if (ui.in.length > 0) {
    const inCol = h('div', { class: 'col' }, h('div', { class: 'label' }, 'Input'));
    const inSlots = h('div', { class: 'row' });
    ui.in.forEach((s, i) => inSlots.append(slotEl({ s: 'in', i }, s)));
    inCol.append(inSlots);
    cols.push(inCol);
  }
  if (ui.fuel) {
    const fuelCol = h('div', { class: 'col' }, h('div', { class: 'label' }, 'Fuel'));
    ui.fuel.forEach((s, i) => fuelCol.append(slotEl({ s: 'fuel', i }, s)));
    if (ui.fuelLeft !== undefined) fuelCol.append(h('div', { class: 'muted', style: 'font-size:11px' }, `${ui.fuelLeft} left`));
    cols.push(fuelCol);
  }
  if (ui.in.length > 0 || ui.out.length > 0) {
    cols.push(
      h(
        'div',
        { class: 'col' },
        h('div', { class: 'label' }, '→'),
        h('div', { class: 'progress' }, h('div', { style: `width:${Math.round(ui.progress * 100)}%` })),
      ),
    );
    const outCol = h('div', { class: 'col' }, h('div', { class: 'label' }, 'Output'));
    const outSlots = h('div', { class: 'row' });
    ui.out.forEach((s, i) => outSlots.append(slotEl({ s: 'out', i }, s)));
    outCol.append(outSlots);
    cols.push(outCol);
  }
  if (cols.length) body.append(h('div', { class: 'machine-grid' }, ...cols));
  for (const t of ui.tanks ?? []) {
    const pct = t.capacity > 0 ? Math.min(100, (t.amount / t.capacity) * 100) : 0;
    body.append(
      h('div', { class: 'muted', style: 'font-size:12px;margin-top:6px' }, `${t.fluid}: ${Math.round(t.amount)} / ${t.capacity}`),
      h('div', { class: 'stress' }, h('div', { style: `width:${pct}%;background:${FLUID_BAR[t.fluid] ?? '#8fd45a'}` })),
    );
  }
  if (ui.grid !== undefined) {
    const g = ui.grid;
    body.append(
      h(
        'div',
        { class: g && g.share >= 1 ? 'muted' : 'bad', style: 'font-size:12px;margin-top:6px' },
        !g
          ? 'No power pole within 3 tiles.'
          : `Grid: ${g.supply} power made, ${g.demand} used${g.share < 1 ? ` — running at ${Math.round(g.share * 100)}%` : ''}`,
      ),
    );
  }
  if (ui.rate)
    body.append(
      h(
        'div',
        { class: 'muted', style: 'font-size:12px;margin-top:6px' },
        `${ui.type === 'pump' ? 'Pumping' : 'Making'} ${ui.rate.perSec} ${ui.rate.fluid.toLowerCase()} a second`,
      ),
    );
  const statusCls = ui.status === 'Working' || ui.status === 'Running' ? 'working' : STATUS_WARN.has(ui.status) ? 'warn' : '';
  const info = h('div', { class: 'row', style: 'margin-top:10px' }, h('span', { class: `status ${statusCls}` }, ui.status));
  if (ui.rpm > 0 || ui.net) info.append(h('span', { class: 'spacer' }), h('span', { class: 'muted' }, `${ui.rpm} RPM`));
  body.append(info);
  if (ui.net) {
    const pct = ui.net.cap > 0 ? Math.min(100, (ui.net.load / ui.net.cap) * 100) : 100;
    const color = ui.net.stalled ? '#e8645a' : pct > 85 ? '#f0a13c' : '#8fd45a';
    body.append(
      h(
        'div',
        { class: 'muted', style: 'font-size:12px;margin-top:6px' },
        `Power network: ${ui.net.load.toFixed(1)} / ${ui.net.cap.toFixed(0)} stress${ui.net.stalled ? ' — overloaded!' : ''}${ui.net.conflict ? ' — gears locked (conflicting ratios)' : ''}`,
      ),
      h('div', { class: 'stress' }, h('div', { style: `width:${pct}%;background:${color}` })),
    );
  }
  if (ui.condition !== undefined || ui.oc !== undefined) {
    const row = h('div', { class: 'row', style: 'margin-top:10px;flex-wrap:wrap' });
    if (ui.perMin !== undefined) row.append(h('span', { class: 'muted' }, `${ui.perMin} made in the last minute`));
    if (ui.condition !== undefined) {
      const pct = Math.round(ui.condition * 100);
      row.append(h('span', { class: 'spacer' }), h('span', { class: pct < 60 ? 'bad' : 'muted' }, `Condition ${pct}%`));
      if (pct < 100)
        row.append(
          h(
            'button',
            { class: 'small', title: 'Costs 1 Iron Gear', onclick: () => ctx.send({ t: 'machine', id: ui.id, op: 'repair' }) },
            'Repair',
          ),
        );
    }
    body.append(row);
    if (ui.oc !== undefined) {
      const oc = h('div', { class: 'mode-buttons' });
      OVERCLOCK.forEach((o, i) =>
        oc.append(
          h(
            'button',
            {
              class: `small${i === ui.oc ? ' active' : ''}`,
              title: `${o.speed}× speed, ${o.cost}× ${ui.fuel ? 'fuel' : ui.grid !== undefined ? 'power' : 'stress'}`,
              onclick: () => ctx.send({ t: 'machine', id: ui.id, op: 'oc', level: i }),
            },
            o.label,
          ),
        ),
      );
      body.append(
        h('div', { class: 'section-title' }, 'Speed (overclock)'),
        oc,
        h(
          'div',
          { class: 'muted', style: 'font-size:12px;margin-top:3px' },
          `Faster machines need disproportionately more ${ui.fuel ? 'fuel' : ui.grid !== undefined ? 'power' : 'torque'}: 125% costs 1.6×, 150% costs 2.3×.`,
        ),
      );
    }
  }
  if (ui.modes?.length) {
    const modes = h('div', { class: 'mode-buttons', style: 'margin-top:10px' });
    for (const m of ui.modes)
      modes.append(
        h(
          'button',
          { class: `small${m === ui.mode ? ' active' : ''}`, onclick: () => ctx.send({ t: 'machine', id: ui.id, op: 'mode', mode: m }) },
          m.replace('_', ' '),
        ),
      );
    body.append(h('div', { class: 'section-title' }, 'Mode'), modes);
  }
  if (ui.filter !== undefined) {
    const held = ctx.state.held();
    body.append(
      h('div', { class: 'section-title' }, 'Filter'),
      h(
        'div',
        { class: 'row' },
        ui.filter ? iconImg(ui.filter, 28) : h('span', { class: 'muted' }, 'none'),
        ui.filter ? itemName(ui.filter) : '',
        h('span', { class: 'spacer' }),
        h(
          'button',
          { class: 'small', disabled: !held, onclick: () => ctx.send({ t: 'machine', id: ui.id, op: 'filter', item: held ?? null }) },
          'Use held item',
        ),
        h('button', { class: 'small', onclick: () => ctx.send({ t: 'machine', id: ui.id, op: 'filter', item: null }) }, 'Clear'),
      ),
      h(
        'div',
        { class: 'muted', style: 'font-size:12px;margin-top:4px' },
        'Matching items go straight on; everything else goes to the sides.',
      ),
    );
  }
  if (ui.recipes.length) {
    const list = h('div', { style: 'display:flex;flex-direction:column;gap:3px;font-size:12px' });
    for (const id of ui.recipes) {
      const r = RECIPE_BY_ID.get(id);
      if (!r) continue;
      const line = h('div', { class: 'row' });
      r.inputs.forEach((i, k) => {
        if (k) line.append('+');
        line.append(iconImg(i.item, 20), `${i.n} ${itemName(i.item)}`);
      });
      line.append(' → ');
      for (const o of r.outputs) line.append(iconImg(o.item, 20), `${Math.round(o.n * 100) / 100} ${itemName(o.item)}`);
      line.append(h('span', { class: 'muted' }, ` (${r.time}s)`));
      list.append(line);
    }
    body.append(h('div', { class: 'section-title' }, 'Recipes'), list);
  }
}

// ——— Shops ———

function shop(body: HTMLElement, ui: ShopUi, ctx: UiContext): void {
  if (ui.mine) {
    body.append(
      h(
        'div',
        { class: 'muted', style: 'margin-bottom:6px' },
        'Put stock in the slots and set a price for each item. Sales are paid to you even while you are offline.',
      ),
    );
    const grid = h('div', { class: 'slots', style: 'grid-template-columns: repeat(6, 52px)' });
    ui.store.forEach((s, i) => grid.append(slotEl({ s: 'store', i }, s)));
    body.append(grid);
    const kinds = new Map<string, { item: string; q?: number }>();
    for (const s of ui.store) if (s) kinds.set(`${s.id}:${s.q ?? ''}`, { item: s.id, q: s.q });
    const table = h('div', { style: 'margin-top:8px;display:flex;flex-direction:column;gap:4px' });
    for (const k of kinds.values()) {
      const current = ui.prices.find((p) => p.item === k.item && (p.q ?? null) === (k.q ?? null));
      const input = h('input', {
        type: 'number',
        min: '0.1',
        step: '0.1',
        value: current ? String(current.price) : '',
        style: 'width:90px',
        placeholder: 'price',
      });
      table.append(
        h(
          'div',
          { class: 'row' },
          iconImg(k.item, 26),
          h('span', { style: 'flex:1' }, itemName(k.item, k.q)),
          input,
          h(
            'button',
            {
              class: 'small',
              onclick: () =>
                ctx.send({
                  t: 'shop',
                  id: ui.id,
                  op: 'price',
                  item: k.item,
                  ...(k.q !== undefined ? { q: k.q } : {}),
                  price: Number(input.value) || null,
                }),
            },
            'Set',
          ),
        ),
      );
    }
    body.append(table);
    return;
  }
  const listed = ui.prices.filter((p) => ui.store.some((s) => s && s.id === p.item && (p.q === undefined || s.q === p.q)));
  if (listed.length === 0) body.append(h('div', { class: 'muted' }, 'Nothing for sale right now.'));
  for (const p of listed) {
    let stock = 0;
    for (const s of ui.store) if (s && s.id === p.item && (p.q === undefined || s.q === p.q)) stock += s.n;
    body.append(
      h(
        'div',
        { class: 'listing' },
        iconImg(p.item, 32),
        h(
          'div',
          { class: 'info' },
          h('div', { class: 'n' }, itemName(p.item, p.q)),
          h('div', { class: 'p' }, h('span', { class: 'crests' }, formatCrests(p.price)), ` · ${stock} available`),
        ),
        h(
          'button',
          {
            class: 'small',
            onclick: () => ctx.send({ t: 'shop', id: ui.id, op: 'buy', item: p.item, ...(p.q !== undefined ? { q: p.q } : {}), n: 1 }),
          },
          '1',
        ),
        h(
          'button',
          {
            class: 'small',
            disabled: stock < 10,
            onclick: () => ctx.send({ t: 'shop', id: ui.id, op: 'buy', item: p.item, ...(p.q !== undefined ? { q: p.q } : {}), n: 10 }),
          },
          '10',
        ),
      ),
    );
  }
}

// ——— Claims ———

function claim(body: HTMLElement, ui: ClaimUi, ctx: UiContext): void {
  body.append(
    h(
      'div',
      { class: 'muted' },
      `Protects ${ui.radius * 2 + 1}×${ui.radius * 2 + 1} tiles. Only people you list can build, use machines or open containers here.`,
    ),
  );
  body.append(h('div', { class: 'section-title' }, 'Members'));
  if (ui.members.length === 0) body.append(h('div', { class: 'muted' }, 'Nobody else yet.'));
  for (const m of ui.members) {
    body.append(
      h(
        'div',
        { class: 'row', style: 'margin-bottom:4px' },
        h('span', { style: 'flex:1' }, m.name),
        h('span', { class: 'pill' }, m.role),
        ui.mine
          ? h('button', { class: 'small red', onclick: () => ctx.send({ t: 'claim', id: ui.id, op: 'remove', name: m.name }) }, 'Remove')
          : null,
      ),
    );
  }
  if (!ui.mine) return;
  const name = h('input', { placeholder: 'player name', style: 'flex:1' });
  const role = h('select') as HTMLSelectElement;
  for (const r of ['worker', 'builder', 'manager', 'visitor'] as ClaimRole[]) role.append(h('option', { value: r }, r));
  body.append(
    h('div', { class: 'section-title' }, 'Add someone (they must be online)'),
    h(
      'div',
      { class: 'row' },
      name,
      role,
      h(
        'button',
        { class: 'small', onclick: () => ctx.send({ t: 'claim', id: ui.id, op: 'add', name: name.value, role: role.value as ClaimRole }) },
        'Add',
      ),
    ),
    h(
      'div',
      { class: 'muted', style: 'font-size:12px;margin-top:6px' },
      'Visitor: doors · Worker: machines & storage · Builder: build · Manager: everything',
    ),
  );
  if (ui.company) {
    const company = ui.company;
    body.append(
      h('div', { class: 'section-title' }, 'Company'),
      h(
        'div',
        { class: 'row' },
        h('span', { class: 'muted', style: 'flex:1' }, `Hand this land and everything of yours on it to ${company}.`),
        h(
          'button',
          {
            class: 'small gold',
            onclick: () =>
              confirm(`Give this land claim and your structures on it to ${company}? Officers will manage it.`) &&
              ctx.send({ t: 'company', op: 'transfer', claim: ui.id }),
          },
          'Hand over',
        ),
      ),
    );
  }
}

// ——— Contracts ———

function remaining(ctx: UiContext, minute: number): string {
  const left = minute - ctx.state.minutes;
  if (left <= 0) return 'expired';
  const hours = Math.floor(left / 60);
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${Math.floor(left % 60)}m`;
}

function board(body: HTMLElement, ui: BoardUi, ctx: UiContext): void {
  body.append(
    h(
      'div',
      { class: 'muted', style: 'margin-bottom:8px' },
      'Bulk orders from the town. Accept one, bring the goods here, and get paid — with a bonus if you are quick.',
    ),
  );
  for (const c of ui.contracts) {
    const have = ctx.state.count(c.item);
    body.append(
      h(
        'div',
        { class: 'listing', style: 'padding:8px' },
        iconImg(c.item, 36),
        h(
          'div',
          { class: 'info' },
          h('div', { class: 'n' }, `${c.n}× ${itemName(c.item)}`),
          h(
            'div',
            { class: 'p' },
            h('span', { class: 'crests' }, formatCrests(c.pay)),
            ` + ${formatCrests(c.bonus)} bonus if done within ${remaining(ctx, c.bonusBy)} · expires in ${remaining(ctx, c.deadline)}`,
          ),
          c.delivered > 0 ? h('div', { class: 'p good' }, `${c.delivered}/${c.n} delivered`) : null,
          c.taker && !c.mine ? h('div', { class: 'p muted' }, `Taken by ${c.taker}`) : null,
        ),
        c.mine
          ? h(
              'div',
              { class: 'row' },
              h(
                'button',
                { class: 'small gold', disabled: have === 0, onclick: () => ctx.send({ t: 'contract', op: 'deliver', id: c.id }) },
                `Deliver ${Math.min(have, c.n - c.delivered)}`,
              ),
              h('button', { class: 'small red', onclick: () => ctx.send({ t: 'contract', op: 'abandon', id: c.id }) }, 'Drop'),
            )
          : c.taker
            ? null
            : h('button', { class: 'small', onclick: () => ctx.send({ t: 'contract', op: 'accept', id: c.id }) }, 'Accept'),
      ),
    );
  }
}

// ——— Exchange ———

function exchange(body: HTMLElement, ui: ExchangeUi, ctx: UiContext): void {
  if (ui.pending.length) {
    body.append(h('div', { class: 'section-title' }, 'Waiting for you'));
    body.append(
      h('div', { class: 'row' }, ...ui.pending.map((p) => h('span', { class: 'row' }, iconImg(p.id, 24), `${p.n}× ${itemName(p.id)}`))),
    );
  }
  body.append(h('div', { class: 'section-title' }, 'Open buy orders'));
  if (ui.orders.length === 0) body.append(h('div', { class: 'muted' }, 'No orders yet. Post one below and let the miners come to you.'));
  for (const o of ui.orders) {
    const have = ctx.state.count(o.item);
    const left = o.n - o.filled;
    body.append(
      h(
        'div',
        { class: 'listing' },
        iconImg(o.item, 32),
        h(
          'div',
          { class: 'info' },
          h('div', { class: 'n' }, `${o.mine ? 'You are' : `${o.owner} is`} buying ${left}× ${itemName(o.item)}`),
          h('div', { class: 'p' }, h('span', { class: 'crests' }, `${formatCrests(o.price)} each`), ` · ${o.filled}/${o.n} filled`),
        ),
        o.mine
          ? h(
              'div',
              { class: 'row' },
              h('button', { class: 'small', onclick: () => ctx.send({ t: 'order', op: 'collect', id: o.id }) }, 'Collect'),
              h('button', { class: 'small red', onclick: () => ctx.send({ t: 'order', op: 'cancel', id: o.id }) }, 'Cancel'),
            )
          : h(
              'button',
              {
                class: 'small gold',
                disabled: have === 0 || left === 0,
                onclick: () => ctx.send({ t: 'order', op: 'fill', id: o.id, n: have }),
              },
              `Sell ${Math.min(have, left)}`,
            ),
      ),
    );
  }
  const select = h('select', { style: 'flex:1' }) as HTMLSelectElement;
  for (const it of [...ITEMS].sort((a, b) => a.name.localeCompare(b.name))) select.append(h('option', { value: it.id }, it.name));
  const qty = h('input', { type: 'number', min: '1', value: '100', style: 'width:80px' });
  const price = h('input', { type: 'number', min: '0.1', step: '0.1', value: '5', style: 'width:80px' });
  body.append(
    h('div', { class: 'section-title' }, 'Post a buy order (Crests are held in escrow)'),
    h(
      'div',
      { class: 'row' },
      select,
      qty,
      h('span', null, 'at ₡'),
      price,
      h(
        'button',
        {
          class: 'small gold',
          onclick: () => ctx.send({ t: 'order', op: 'post', item: select.value, n: Number(qty.value), price: Number(price.value) }),
        },
        'Post',
      ),
    ),
  );
}

export function contractsWindow(ctx: UiContext): WindowDef {
  return {
    title: () => 'Your Contracts',
    order: 3,
    width: 480,
    render: (body) => {
      const list = ctx.state.contracts;
      if (list.length === 0) body.append(h('div', { class: 'muted' }, 'You have no contracts. Visit a Contract Board in any settlement.'));
      for (const c of list) {
        body.append(
          h(
            'div',
            { class: 'listing', style: 'padding:8px' },
            iconImg(c.item, 36),
            h(
              'div',
              { class: 'info' },
              h('div', { class: 'n' }, `${c.n}× ${itemName(c.item)} → ${c.settlement}`),
              h(
                'div',
                { class: 'p' },
                h('span', { class: 'crests' }, formatCrests(c.pay)),
                ` + ${formatCrests(c.bonus)} bonus · ${c.delivered}/${c.n} delivered · ${ctx.state.count(c.item)} in your backpack`,
              ),
              h(
                'div',
                { class: 'p muted' },
                `Bonus until ${fmtTime(c.bonusBy)} (${remaining(ctx, c.bonusBy)}) · expires in ${remaining(ctx, c.deadline)}`,
              ),
            ),
          ),
        );
      }
    },
  };
}
