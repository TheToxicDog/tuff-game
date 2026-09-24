// Build mode palette (design plan §4 "B — Build/Fortification mode", §55–56): everything you can
// construct, with its materials and tools, plus any furniture you are carrying. Pick an entry,
// then place it in the world with the mouse.

import { checkMaterials, FURNITURE_STRUCTURE, tagName, type ConstructionDef } from '@tuff/shared';
import type { GameContext } from './context';
import { clear, h } from './dom';

export interface BuildChoice {
  type: string;
  prop?: string;
  name: string;
}

const CATEGORY_NAMES: Record<ConstructionDef['category'], string> = {
  walls: 'Walls',
  fences: 'Fences',
  floors: 'Floors',
  storage: 'Storage',
  utility: 'Utility',
};

export class BuildPanel {
  readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly hint: HTMLElement;
  private lastKey = '';
  choices: BuildChoice[] = [];
  selected: BuildChoice | null = null;

  constructor(
    parent: HTMLElement,
    private readonly ctx: GameContext,
    private readonly onSelect: (choice: BuildChoice | null) => void,
  ) {
    this.list = h('div', { class: 'build-list' });
    this.hint = h(
      'div',
      { class: 'build-hint' },
      h('b', null, 'Left click'),
      ' place · ',
      h('b', null, 'R'),
      ' rotate · ',
      h('b', null, '1–9'),
      ' pick · ',
      h('b', null, 'B'),
      ' / ',
      h('b', null, 'right click'),
      ' exit · barricade doors and windows by holding ',
      h('b', null, 'E'),
      ' on them',
    );
    this.root = h('div', { class: 'build-panel panel hidden' }, h('div', { class: 'panel-title' }, 'Build'), this.list, this.hint);
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(): void {
    this.root.classList.remove('hidden');
    this.render(true);
  }

  close(): void {
    this.root.classList.add('hidden');
    this.select(null);
  }

  select(choice: BuildChoice | null): void {
    this.selected = choice;
    this.onSelect(choice);
    this.render(true);
  }

  pick(index: number): void {
    const c = this.choices[index];
    if (c) this.select(c);
  }

  render(force = false): void {
    if (!this.isOpen) return;
    const ctx = this.ctx;
    const key = `${JSON.stringify(ctx.inventory)}|${this.selected?.type}|${this.selected?.prop}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;
    clear(this.list);
    this.choices = [];
    // Carried furniture first: it is what you most likely want to put down.
    for (const s of ctx.inventory.slots) {
      const def = s ? ctx.content.findItem(s.id) : undefined;
      if (!def?.furniture) continue;
      const choice = { type: FURNITURE_STRUCTURE, prop: def.furniture, name: def.name };
      this.card(choice, 'Carried furniture', [h('span', { class: 'req ok' }, 'In your hands')], true);
    }
    let lastCategory = '';
    for (const con of ctx.content.constructions) {
      const check = checkMaterials(ctx.content, ctx.inventory, con.materials, con.tools);
      const reqs = [
        ...check.inputs.map((i) => h('span', { class: `req ${i.ok ? 'ok' : 'missing'}` }, `${i.label} ${i.have}/${i.need}`)),
        ...con.tools.map((t, i) => h('span', { class: `req tool ${check.tools[i]?.ok ? 'ok' : 'missing'}` }, tagName(t))),
      ];
      const category = CATEGORY_NAMES[con.category];
      this.card({ type: con.id, name: con.name }, category !== lastCategory ? category : '', reqs, check.ok, con.description);
      lastCategory = category;
    }
  }

  private card(choice: BuildChoice, heading: string, reqs: HTMLElement[], ok: boolean, description?: string): void {
    const index = this.choices.length;
    this.choices.push(choice);
    if (heading) this.list.append(h('div', { class: 'section-title' }, h('span', null, heading)));
    const selected = this.selected?.type === choice.type && this.selected?.prop === choice.prop;
    this.list.append(
      h(
        'button',
        {
          class: `build-card${selected ? ' selected' : ''}${ok ? '' : ' unavailable'}`,
          title: description ?? choice.name,
          on: { click: () => this.select(choice) },
        },
        index < 9 ? h('kbd', null, String(index + 1)) : null,
        h('span', { class: 'name' }, choice.name),
        h('span', { class: 'craft-reqs' }, ...reqs),
      ),
    );
  }
}
