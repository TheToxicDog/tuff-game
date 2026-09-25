// The inventory (Tab) with crafting: recipes by hand, at a workbench, at an anvil (smithing
// minigame) or by a campfire. Locked recipes show which research unlocks them.

import { ITEM_BY_ID, RESEARCH_BY_ID, STATION_NAMES, craftRecipes, type Recipe } from '@ironwild/shared';
import type { UiContext } from '../game/state';
import { h } from './dom';
import { iconImg } from './icons';
import { slotEl } from './slots';
import type { WindowDef } from './windows';

const TABS = ['hand', 'workbench', 'anvil', 'cooking'] as const;

export class InventoryWindow {
  tab: (typeof TABS)[number] = 'hand';
  /** Set when opened from a station so its tab is shown. */
  forced: string | null = null;

  constructor(private readonly ctx: UiContext) {}

  def(): WindowDef {
    return {
      title: () =>
        h(
          'span',
          null,
          'Inventory ',
          h('span', { class: 'sub' }, `${this.ctx.state.slots.filter((s) => s).length}/${this.ctx.state.cap} slots`),
        ),
      order: 1,
      render: (body) => this.render(body),
    };
  }

  private render(body: HTMLElement): void {
    const st = this.ctx.state;
    const grid = h('div', { class: 'slots' });
    for (let i = 0; i < st.cap; i++) {
      grid.append(slotEl({ s: 'inv', i }, st.slots[i] ?? null, { key: i < 8 ? String(i + 1) : undefined, selected: i === st.sel }));
    }
    body.append(grid);
    body.append(
      h(
        'div',
        { class: 'muted', style: 'font-size:12px;margin-top:6px' },
        'Drag to move · right-drag to split · shift-click to move to the open container · drag onto the ground to drop',
      ),
    );

    // Skill levels (0–20).
    const skills = Object.entries(st.status.skills)
      .filter(([, lvl]) => lvl > 0)
      .sort((a, b) => b[1] - a[1]);
    if (skills.length)
      body.append(
        h(
          'div',
          { class: 'skills' },
          ...skills.map(([name, lvl]) =>
            h('span', { class: 'pill', title: `${name} level ${lvl}` }, `${name[0].toUpperCase()}${name.slice(1)} ${lvl}`),
          ),
        ),
      );

    // Crafting.
    const near = this.ctx.nearStations();
    if (this.forced && TABS.includes(this.forced as never)) {
      this.tab = this.forced as never;
      this.forced = null;
    }
    body.append(h('div', { class: 'section-title' }, 'Crafting'));
    const tabs = h('div', { class: 'craft-tabs' });
    for (const t of TABS) {
      const available = t === 'hand' || near.has(t);
      const label = t === 'hand' ? 'Hand' : STATION_NAMES[t];
      tabs.append(
        h(
          'button',
          {
            class: t === this.tab ? 'active' : '',
            title: available ? '' : `Stand near a ${label.toLowerCase()} to use these recipes`,
            onclick: () => {
              this.tab = t;
              this.ctx.refresh('inventory');
            },
          },
          label,
          available ? '' : ' ·',
        ),
      );
    }
    body.append(tabs);
    const list = h('div', { class: 'recipes' });
    const stationOk = this.tab === 'hand' || near.has(this.tab);
    if (!stationOk) list.append(h('div', { class: 'muted' }, `Stand next to a ${STATION_NAMES[this.tab].toLowerCase()} to craft these.`));
    const recipes = craftRecipes(this.tab);
    const known = (r: Recipe) => !r.research || st.research.unlocked.includes(r.research);
    recipes.sort((a, b) => Number(known(b)) - Number(known(a)));
    for (const r of recipes) list.append(this.recipeRow(r, stationOk, known(r)));
    body.append(list);
  }

  private recipeRow(r: Recipe, stationOk: boolean, known: boolean): HTMLElement {
    const st = this.ctx.state;
    const out = r.outputs[0];
    const def = ITEM_BY_ID.get(out.item)!;
    const inputs = h('div', { class: 'inputs' });
    let can = known && stationOk;
    for (const i of r.inputs) {
      const have = st.count(i.item);
      if (have < i.n) can = false;
      inputs.append(
        h('span', { class: have < i.n ? 'missing' : '' }, iconImg(i.item, 18), `${i.n} ${ITEM_BY_ID.get(i.item)?.name ?? i.item}`),
      );
    }
    const actions = h('div', { class: 'row' });
    if (!known) {
      actions.append(h('span', { class: 'pill' }, `Research: ${RESEARCH_BY_ID.get(r.research!)?.name}`));
    } else if (r.smith) {
      actions.append(h('button', { class: 'small gold', disabled: !can, onclick: () => this.ctx.startSmith(r.id) }, 'Forge'));
    } else {
      actions.append(
        h('button', { class: 'small', disabled: !can, onclick: () => this.ctx.send({ t: 'craft', recipe: r.id, n: 1 }) }, 'Craft'),
      );
      if (def.stack > 1)
        actions.append(
          h('button', { class: 'small', disabled: !can, onclick: () => this.ctx.send({ t: 'craft', recipe: r.id, n: 5 }) }, '×5'),
        );
    }
    return h(
      'div',
      { class: `recipe${known ? '' : ' locked'}` },
      h('img', { class: 'out', src: iconImg(out.item).src }),
      h('div', { style: 'flex:1;min-width:0' }, h('div', { class: 'name' }, `${def.name}${out.n > 1 ? ` ×${out.n}` : ''}`), inputs),
      actions,
    );
  }
}
