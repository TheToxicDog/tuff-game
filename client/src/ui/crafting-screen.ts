// Crafting and cooking (design plan §57–58): every recipe with what it needs, what you have and
// whether you are at the right station. Cooking needs a heat source (a gas stove or a lit fire);
// carpentry recipes need a workbench. Everything is validated again by the server.

import { checkRecipe, STATION_NAMES, type RecipeDef, type StationKind } from '@tuff/shared';
import type { GameContext } from './context';
import { clear, h } from './dom';
import { iconImage } from './icons';

type Category = 'all' | RecipeDef['category'];

const CATEGORIES: [Category, string][] = [
  ['all', 'All'],
  ['cooking', 'Cooking'],
  ['medical', 'Medical'],
  ['carpentry', 'Carpentry'],
  ['survival', 'Survival'],
];

export class CraftingScreen {
  readonly root: HTMLElement;
  private readonly body: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly stationLine: HTMLElement;
  private readonly onlyReady: HTMLInputElement;
  private category: Category = 'all';
  private lastKey = '';
  isOpen = false;

  constructor(
    parent: HTMLElement,
    private readonly ctx: GameContext,
    private readonly onClose: () => void,
  ) {
    this.body = h('div', { class: 'craft-list' });
    this.tabs = h('div', { class: 'tabs' });
    this.stationLine = h('div', { class: 'craft-stations' });
    this.onlyReady = h('input', { type: 'checkbox' });
    this.onlyReady.addEventListener('change', () => this.render(true));
    for (const [id, label] of CATEGORIES) {
      this.tabs.append(
        h(
          'button',
          {
            class: 'tab',
            data: { cat: id },
            on: {
              click: () => {
                this.category = id;
                this.render(true);
              },
            },
          },
          label,
        ),
      );
    }
    const panel = h(
      'div',
      { class: 'panel crafting', role: 'dialog', ariaLabel: 'Crafting' },
      h(
        'div',
        { class: 'panel-header' },
        h('span', { class: 'panel-title' }, 'Crafting & Cooking'),
        h(
          'div',
          { class: 'row' },
          h('label', { class: 'row fine' }, this.onlyReady, 'Only what I can make'),
          h('button', { class: 'btn small', title: 'Close (K)', on: { click: () => this.close() } }, 'Close'),
        ),
      ),
      this.stationLine,
      this.tabs,
      this.body,
    );
    this.root = h('div', { class: 'modal-backdrop hidden', on: { mousedown: (e) => e.target === this.root && this.close() } }, panel);
    parent.append(this.root);
  }

  open(category?: Category): void {
    if (category) this.category = category;
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.render(true);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.onClose();
  }

  /** Re-renders when the inventory or nearby stations changed. */
  render(force = false): void {
    if (!this.isOpen) return;
    const ctx = this.ctx;
    const stations = ctx.stationsNearby();
    const key = `${JSON.stringify(ctx.inventory)}|${[...stations].join()}|${this.category}|${this.onlyReady.checked}|${ctx.busy}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    for (const tab of this.tabs.children)
      (tab as HTMLElement).classList.toggle('active', (tab as HTMLElement).dataset.cat === this.category);
    clear(this.stationLine);
    for (const kind of ['heat', 'workbench'] as StationKind[]) {
      const here = stations.has(kind);
      this.stationLine.append(
        h('span', { class: `badge ${here ? 'good' : ''}` }, `${here ? '✓' : '·'} ${kind === 'heat' ? 'Heat source' : 'Workbench'}`),
      );
    }
    this.stationLine.append(h('span', { class: 'fine' }, 'Stand next to a stove, a lit campfire or a workbench to use it.'));
    clear(this.body);
    const recipes = ctx.content.recipes.filter((r) => this.category === 'all' || r.category === this.category);
    const rows = recipes
      .map((r) => ({ r, check: checkRecipe(ctx.content, ctx.inventory, r, stations) }))
      .filter(({ check }) => !this.onlyReady.checked || check.ok)
      .sort((a, b) => Number(b.check.ok) - Number(a.check.ok) || a.r.name.localeCompare(b.r.name));
    if (rows.length === 0) this.body.append(h('div', { class: 'empty-note' }, 'Nothing to make right now.'));
    for (const { r, check } of rows) {
      const out = ctx.content.findItem(r.outputs[0].item);
      const reqs = h('div', { class: 'craft-reqs' });
      for (const i of check.inputs) reqs.append(h('span', { class: `req ${i.ok ? 'ok' : 'missing'}` }, `${i.label} ${i.have}/${i.need}`));
      for (const t of check.tools) reqs.append(h('span', { class: `req tool ${t.ok ? 'ok' : 'missing'}` }, t.label));
      if (r.station) reqs.append(h('span', { class: `req station ${check.station ? 'ok' : 'missing'}` }, `at ${STATION_NAMES[r.station]}`));
      const verb = r.category === 'cooking' ? 'Cook' : 'Make';
      const button = h(
        'button',
        {
          class: `btn small ${check.ok ? 'primary' : ''}`,
          title: check.problem ?? `${verb} ${r.name} (${r.time}s)`,
          disabled: !check.ok || ctx.busy,
          on: {
            click: () => {
              ctx.send({ t: 'craft', recipe: r.id });
              ctx.ui('ui_click');
              this.close();
            },
          },
        },
        verb,
      );
      const outputs = r.outputs.map((o) => `${o.qty > 1 ? `${o.qty}× ` : ''}${ctx.content.findItem(o.item)?.name ?? o.item}`).join(', ');
      this.body.append(
        h(
          'div',
          { class: `craft-row${check.ok ? '' : ' unavailable'}` },
          h('div', { class: 'craft-icon' }, out ? iconImage(out, 40) : null),
          h(
            'div',
            { class: 'craft-main' },
            h('div', { class: 'craft-name' }, r.name, h('span', { class: 'fine' }, ` → ${outputs} · ${r.time}s`)),
            r.description ? h('div', { class: 'fine' }, r.description) : null,
            reqs,
          ),
          button,
        ),
      );
    }
  }
}
