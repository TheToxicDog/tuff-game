// Inventory and loot screen (design plan §24–28). Left: what the player carries (quick slots, worn
// bag, pockets, bag contents). Right: the floor and nearby containers/corpses as tabs. Items move
// by drag and drop, double click (quick transfer), the detail panel's buttons or a right-click
// context menu. Every change is a request; the server validates and answers with new state.

import {
  capacityOf,
  NO_SLOT,
  preferredSlot,
  QUICK_SLOT_NAMES,
  usageOf,
  inventoryWeight,
  ENCUMBRANCE,
  type InvLocation,
  type ItemDef,
  type ItemStack,
} from '@tuff/shared';
import type { GameContext } from './context';
import { clear, h } from './dom';
import { iconImage } from './icons';
import { categoryName, itemMeta, itemStats, kg, useVerb } from './items';

type SortMode = 'default' | 'name' | 'weight' | 'type';

interface Selection {
  uid: number;
  loc: InvLocation;
}

interface Action {
  label: string;
  run: () => void;
  primary?: boolean;
}

const DRAG_MIME = 'application/x-tuff-item';

function locKey(loc: InvLocation): string {
  switch (loc.kind) {
    case 'slot':
      return `slot:${loc.index}`;
    case 'container':
      return `container:${loc.id}`;
    default:
      return loc.kind;
  }
}

function isPlayerLoc(loc: InvLocation): boolean {
  return loc.kind === 'slot' || loc.kind === 'pockets' || loc.kind === 'backpack' || loc.kind === 'back';
}

/** The quick slot an item would sensibly go to, or null (food and junk do not belong there). */
function quickSlotFor(def: ItemDef, slots: readonly (ItemStack | null)[]): number | null {
  const free = (i: number) => (i >= 0 && !slots[i] ? i : null);
  const pref = preferredSlot(def);
  if (def.firearm || def.melee || def.light) {
    const any = slots.findIndex((s) => !s);
    return free(pref ?? -1) ?? (any >= 0 ? any : null);
  }
  if (def.medical) return free(3);
  if (def.category === 'tool') return free(4);
  return null;
}

export class InventoryScreen {
  readonly root: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly leftBody: HTMLElement;
  private readonly leftDetail: HTMLElement;
  private readonly leftFooter: HTMLElement;
  private readonly rightTabs: HTMLElement;
  private readonly rightBody: HTMLElement;
  private readonly rightDetail: HTMLElement;
  private readonly rightFooter: HTMLElement;
  private readonly weightEl: HTMLElement;
  private readonly search: HTMLInputElement;
  private readonly sortSelect: HTMLSelectElement;
  private menu: HTMLElement | null = null;
  isOpen = false;
  private selection: Selection | null = null;
  private filter = '';
  private sortMode: SortMode = 'default';
  /** 'floor' or a container / corpse id. */
  activeTab = 'floor';
  private pendingOpen: string | null = null;

  constructor(
    parent: HTMLElement,
    private readonly ctx: GameContext,
    private readonly onClose: () => void,
  ) {
    this.weightEl = h('span', { class: 'muted', style: 'font-size:12px' });
    this.search = h('input', {
      class: 'search',
      type: 'search',
      placeholder: 'Filter items…',
      style: 'width:180px;padding:6px 9px',
      on: {
        input: () => {
          this.filter = this.search.value.trim().toLowerCase();
          this.render();
        },
        keydown: (e) => {
          if (e.key === 'Escape') {
            this.search.blur();
            e.stopPropagation();
          }
        },
      },
    });
    this.sortSelect = h('select', {
      class: 'btn small',
      ariaLabel: 'Sort items',
      on: {
        change: () => {
          this.sortMode = this.sortSelect.value as SortMode;
          this.render();
        },
      },
    });
    for (const [v, label] of [
      ['default', 'Sort: Default'],
      ['name', 'Sort: Name'],
      ['weight', 'Sort: Weight'],
      ['type', 'Sort: Type'],
    ]) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      this.sortSelect.append(o);
    }
    const header = h(
      'div',
      { class: 'panel-header' },
      h('div', { class: 'row' }, h('span', { class: 'panel-title' }, 'Inventory'), this.weightEl),
      h(
        'div',
        { class: 'row' },
        this.search,
        this.sortSelect,
        h('button', { class: 'btn small', title: 'Close (Tab)', on: { click: () => this.close() } }, 'Close'),
      ),
    );
    this.leftBody = h('div', { class: 'inv-body' });
    this.leftDetail = h('div', { class: 'inv-detail' });
    this.leftFooter = h('div', { class: 'inv-footer' });
    const left = h(
      'div',
      { class: 'inv-col' },
      h('div', { class: 'tabs' }, h('span', { class: 'tab active' }, 'You')),
      this.leftBody,
      this.leftDetail,
      this.leftFooter,
    );
    this.rightTabs = h('div', { class: 'tabs', role: 'tablist' });
    this.rightBody = h('div', { class: 'inv-body' });
    this.rightDetail = h('div', { class: 'inv-detail' });
    this.rightFooter = h('div', { class: 'inv-footer' });
    const right = h('div', { class: 'inv-col' }, this.rightTabs, this.rightBody, this.rightDetail, this.rightFooter);
    this.panel = h('div', { class: 'panel inventory', role: 'dialog', ariaLabel: 'Inventory' }, header, left, right);
    this.root = h('div', { class: 'modal-backdrop hidden', on: { mousedown: (e) => e.target === this.root && this.close() } }, this.panel);
    this.panel.addEventListener('mousedown', () => this.closeMenu());
    this.panel.addEventListener('contextmenu', (e) => e.preventDefault());
    this.makeDropZone(this.rightBody, () => this.externalLoc());
    parent.append(this.root);
  }

  open(tab?: string): void {
    if (tab) this.activeTab = tab;
    else if (this.ctx.container) this.activeTab = this.ctx.container.id;
    if (!this.isOpen) {
      this.isOpen = true;
      this.root.classList.remove('hidden');
    }
    if (this.activeTab === 'floor') this.ctx.send({ t: 'open', target: 'floor' });
    this.render();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.closeMenu();
    this.root.classList.add('hidden');
    this.selection = null;
    this.pendingOpen = null;
    this.search.blur();
    this.ctx.send({ t: 'close' });
    this.activeTab = 'floor';
    this.onClose();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  /** Called when the server opened (or closed) a container. */
  containerChanged(): void {
    const c = this.ctx.container;
    // The server only opens what this client asked for (a tab click or E in the world): follow it.
    if (c) {
      this.pendingOpen = null;
      this.activeTab = c.id;
    }
    if (!c && this.activeTab !== 'floor' && this.pendingOpen !== this.activeTab) {
      this.activeTab = 'floor';
      if (this.isOpen) this.ctx.send({ t: 'open', target: 'floor' });
    }
    if (this.isOpen) this.render();
  }

  /** The player started opening a container from the world while the screen is open. */
  expect(id: string): void {
    if (!this.isOpen) return;
    this.pendingOpen = id;
    this.activeTab = id;
    this.render();
  }

  /** A timed search ended; if no container followed, it was interrupted. */
  searchEnded(): void {
    if (!this.pendingOpen) return;
    this.pendingOpen = null;
    this.render();
  }

  get showingFloor(): boolean {
    return this.isOpen && this.activeTab === 'floor';
  }

  private externalLoc(): InvLocation {
    return this.activeTab === 'floor' ? { kind: 'floor' } : { kind: 'container', id: this.activeTab };
  }

  // --- Rendering ------------------------------------------------------------------------------

  render(): void {
    if (!this.isOpen) return;
    const leftScroll = this.leftBody.scrollTop;
    const rightScroll = this.rightBody.scrollTop;
    this.validateSelection();
    this.renderLeft();
    this.renderRight();
    this.renderDetail();
    this.leftBody.scrollTop = leftScroll;
    this.rightBody.scrollTop = rightScroll;
  }

  private validateSelection(): void {
    const sel = this.selection;
    if (!sel) return;
    if (!this.stackAt(sel.uid, sel.loc)) this.selection = null;
  }

  private stackAt(uid: number, loc: InvLocation): ItemStack | null {
    const inv = this.ctx.inventory;
    switch (loc.kind) {
      case 'slot':
        return inv.slots[loc.index]?.uid === uid ? inv.slots[loc.index] : null;
      case 'pockets':
        return inv.pockets.find((s) => s.uid === uid) ?? null;
      case 'backpack':
        return inv.back?.contents?.find((s) => s.uid === uid) ?? null;
      case 'back':
        return inv.back?.uid === uid ? inv.back : null;
      case 'container':
        return this.ctx.container?.id === loc.id ? (this.ctx.container.items.find((s) => s.uid === uid) ?? null) : null;
      case 'floor':
        return this.ctx.floor.find((f) => f.stack.uid === uid)?.stack ?? null;
    }
  }

  private sorted(list: readonly ItemStack[]): ItemStack[] {
    const content = this.ctx.content;
    let out = list.filter((s) => {
      if (!this.filter) return true;
      const def = content.findItem(s.id);
      return !!def && (def.name.toLowerCase().includes(this.filter) || categoryName(def).toLowerCase().includes(this.filter));
    });
    const name = (s: ItemStack) => content.findItem(s.id)?.name ?? s.id;
    if (this.sortMode === 'name') out = out.sort((a, b) => name(a).localeCompare(name(b)));
    else if (this.sortMode === 'weight')
      out = out.sort((a, b) => (content.findItem(b.id)?.weight ?? 0) * b.qty - (content.findItem(a.id)?.weight ?? 0) * a.qty);
    else if (this.sortMode === 'type')
      out = out.sort(
        (a, b) =>
          (content.findItem(a.id)?.category ?? '').localeCompare(content.findItem(b.id)?.category ?? '') || name(a).localeCompare(name(b)),
      );
    return out;
  }

  private renderLeft(): void {
    const ctx = this.ctx;
    const inv = ctx.inventory;
    const content = ctx.content;
    const body = this.leftBody;
    clear(body);

    // Quick slots.
    body.append(h('div', { class: 'section-title' }, h('span', null, 'Quick slots'), h('span', { class: 'cap' }, 'Keys 1–5')));
    const strip = h('div', { class: 'slot-strip' });
    for (let i = 0; i < inv.slots.length; i++) {
      const stack = inv.slots[i];
      const def = stack ? content.findItem(stack.id) : undefined;
      const loc: InvLocation = { kind: 'slot', index: i };
      const cell = h(
        'div',
        {
          class: `slot-cell${stack ? ' filled' : ''}${i === ctx.selectedSlot ? ' active' : ''}${this.isSelected(stack, loc) ? ' selected' : ''}`,
          title: def ? `${def.name} — ${QUICK_SLOT_NAMES[i]}` : `${QUICK_SLOT_NAMES[i]} (empty)`,
          tabIndex: 0,
        },
        h('span', { class: 'slot-name' }, `${i + 1}`),
        def ? iconImage(def, 34) : h('span', null, QUICK_SLOT_NAMES[i]),
        stack && stack.qty > 1 ? h('span', { class: 'qty' }, `×${stack.qty}`) : null,
      );
      if (stack) this.bindItem(cell, stack, loc);
      this.makeDropZone(cell, () => loc);
      strip.append(cell);
    }
    body.append(strip);

    // Worn bag.
    const back = inv.back;
    const backDef = back ? content.findItem(back.id) : undefined;
    body.append(h('div', { class: 'section-title' }, h('span', null, 'Back')));
    if (back && backDef) {
      const row = this.itemRow(back, backDef, { kind: 'back' }, 'WORN');
      body.append(row);
    } else {
      const empty = h('div', { class: 'empty-note drop-slot' }, 'No bag — find a backpack to carry more.');
      this.makeDropZone(empty, () => ({ kind: 'back' }));
      body.append(empty);
    }

    // Pockets.
    this.section(body, 'Pockets', { kind: 'pockets' }, inv.pockets);
    // Bag contents.
    if (back && backDef) this.section(body, backDef.name, { kind: 'backpack' }, back.contents ?? []);

    const weight = inventoryWeight(content, inv);
    this.weightEl.textContent = `Carrying ${kg(weight)}${weight > ENCUMBRANCE.heavy ? ' — overloaded' : weight > ENCUMBRANCE.comfortable ? ' — heavy' : ''}`;
    clear(this.leftFooter);
    this.leftFooter.append(h('span', { class: 'fine' }, 'Drag items between lists, double-click to move, right-click for more.'));
  }

  private section(body: HTMLElement, title: string, loc: InvLocation, items: readonly ItemStack[]): void {
    const ctx = this.ctx;
    const cap = capacityOf(ctx.content, ctx.inventory, loc);
    const usage = usageOf(ctx.content, items);
    const over = cap ? usage.volume > cap.volume + 1e-6 : false;
    const title_ = h(
      'div',
      { class: 'section-title' },
      h('span', null, title),
      cap ? h('span', { class: `cap${over ? ' over' : ''}` }, `${usage.volume.toFixed(1)} / ${cap.volume} L · ${kg(usage.weight)}`) : null,
    );
    const zone = h('div', { class: 'drop-list' });
    zone.append(title_);
    if (cap)
      zone.append(
        h('div', { class: 'cap-bar' }, h('i', { style: `width:${Math.min(100, (usage.volume / cap.volume) * 100).toFixed(1)}%` })),
      );
    const list = this.sorted(items);
    if (list.length === 0) zone.append(h('div', { class: 'empty-note' }, this.filter && items.length > 0 ? 'No matches.' : 'Empty'));
    for (const s of list) {
      const def = ctx.content.findItem(s.id);
      if (def) zone.append(this.itemRow(s, def, loc));
    }
    this.makeDropZone(zone, () => loc);
    body.append(zone);
  }

  private renderRight(): void {
    const ctx = this.ctx;
    clear(this.rightTabs);
    const targets = ctx.nearbyTargets();
    const tabs: { id: string; name: string }[] = [{ id: 'floor', name: 'Floor' }, ...targets];
    const open = ctx.container;
    if (open && !tabs.some((t) => t.id === open.id)) tabs.push({ id: open.id, name: open.name });
    if (this.activeTab !== 'floor' && !tabs.some((t) => t.id === this.activeTab)) this.activeTab = 'floor';
    for (const t of tabs) {
      const btn = h(
        'button',
        {
          class: `tab${t.id === this.activeTab ? ' active' : ''}`,
          role: 'tab',
          on: { click: () => this.selectTab(t.id) },
        },
        t.name,
      );
      this.rightTabs.append(btn);
    }

    const body = this.rightBody;
    clear(body);
    clear(this.rightFooter);
    const tab = this.activeTab;
    if (tab === 'floor') {
      const items = ctx.floor.map((f) => f.stack);
      body.append(h('div', { class: 'section-title' }, h('span', null, 'On the ground'), h('span', { class: 'cap' }, 'Within reach')));
      const list = this.sorted(items);
      if (list.length === 0) body.append(h('div', { class: 'empty-note' }, 'Nothing here. Drag items here to drop them.'));
      for (const s of list) {
        const def = ctx.content.findItem(s.id);
        if (def) body.append(this.itemRow(s, def, { kind: 'floor' }));
      }
      this.rightFooter.append(
        h(
          'button',
          { class: 'btn small primary', disabled: items.length === 0, on: { click: () => ctx.send({ t: 'takeAll', container: 'floor' }) } },
          'Take all',
        ),
      );
      return;
    }
    if (open && open.id === tab) {
      const usage = usageOf(ctx.content, open.items);
      body.append(
        h(
          'div',
          { class: 'section-title' },
          h('span', null, open.name),
          open.volume > 0 ? h('span', { class: 'cap' }, `${usage.volume.toFixed(1)} / ${open.volume} L`) : null,
        ),
      );
      const list = this.sorted(open.items);
      if (list.length === 0) body.append(h('div', { class: 'empty-note' }, open.items.length > 0 ? 'No matches.' : 'Empty.'));
      for (const s of list) {
        const def = ctx.content.findItem(s.id);
        if (def) body.append(this.itemRow(s, def, { kind: 'container', id: open.id }));
      }
      this.rightFooter.append(
        h(
          'button',
          {
            class: 'btn small primary',
            disabled: open.items.length === 0,
            on: { click: () => ctx.send({ t: 'takeAll', container: open.id }) },
          },
          'Take all',
        ),
      );
      return;
    }
    const name = tabs.find((t) => t.id === tab)?.name ?? 'Container';
    body.append(
      h(
        'div',
        { class: 'empty-note' },
        this.pendingOpen === tab ? `Searching the ${name.toLowerCase()}…` : `The ${name.toLowerCase()} has not been opened.`,
      ),
    );
    if (this.pendingOpen !== tab) {
      body.append(
        h(
          'div',
          { class: 'row', style: 'justify-content:center' },
          h('button', { class: 'btn small', on: { click: () => this.selectTab(tab) } }, 'Search'),
        ),
      );
    }
  }

  private selectTab(id: string): void {
    this.activeTab = id;
    this.selection = this.selection && isPlayerLoc(this.selection.loc) ? this.selection : null;
    if (id === 'floor') {
      this.ctx.send({ t: 'open', target: 'floor' });
    } else if (this.ctx.container?.id !== id) {
      this.pendingOpen = id;
      this.ctx.send({ t: 'open', target: id });
    }
    this.ctx.ui('ui_click');
    this.render();
  }

  private isSelected(stack: ItemStack | null, loc: InvLocation): boolean {
    return !!stack && !!this.selection && this.selection.uid === stack.uid && locKey(this.selection.loc) === locKey(loc);
  }

  private itemRow(s: ItemStack, def: ItemDef, loc: InvLocation, tag?: string): HTMLElement {
    const ctx = this.ctx;
    const held = loc.kind === 'slot' && loc.index === ctx.selectedSlot;
    const magAmmo = held && def.firearm ? ctx.magAmmo : undefined;
    const row = h(
      'div',
      { class: `item-row${this.isSelected(s, loc) ? ' selected' : ''}`, tabIndex: 0 },
      iconImage(def, 34),
      h(
        'div',
        { style: 'min-width:0' },
        h('div', { class: 'name' }, def.name),
        h('div', { class: 'meta' }, itemMeta(ctx.content, def, s, magAmmo)),
      ),
      h('div', { class: 'right' }, tag ? h('span', { class: 'equipped' }, tag) : null, s.qty > 1 ? `×${s.qty}` : null),
    );
    this.bindItem(row, s, loc);
    return row;
  }

  private bindItem(el: HTMLElement, s: ItemStack, loc: InvLocation): void {
    el.draggable = true;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      this.selection = { uid: s.uid, loc };
      this.render();
    });
    el.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      this.quickMove(s, loc);
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.quickMove(s, loc);
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.selection = { uid: s.uid, loc };
      this.render();
      this.showMenu(e.clientX, e.clientY, this.actionsFor(s, loc));
    });
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer?.setData(DRAG_MIME, JSON.stringify({ uid: s.uid, loc }));
      e.dataTransfer!.effectAllowed = 'move';
      this.closeMenu();
    });
  }

  private makeDropZone(el: HTMLElement, loc: () => InvLocation): void {
    el.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes(DRAG_MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      el.classList.add('drop-target');
    });
    el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
    el.addEventListener('drop', (e) => {
      el.classList.remove('drop-target');
      const raw = e.dataTransfer?.getData(DRAG_MIME);
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      try {
        const data = JSON.parse(raw) as { uid: number; loc: InvLocation };
        const to = loc();
        if (locKey(to) === locKey(data.loc)) return;
        this.ctx.send({ t: 'move', uid: data.uid, from: data.loc, to });
        this.ctx.ui('pickup');
      } catch {
        // Ignore malformed drags.
      }
    });
  }

  /** Double-click behaviour: take into the inventory, or put away into the open container / floor. */
  private quickMove(s: ItemStack, loc: InvLocation): void {
    const ctx = this.ctx;
    if (!isPlayerLoc(loc)) {
      ctx.take(s, loc);
      return;
    }
    const def = ctx.content.findItem(s.id);
    if (loc.kind !== 'slot' && def && (def.firearm || def.melee)) {
      ctx.send({ t: 'use', uid: s.uid });
      return;
    }
    const to = this.externalLoc();
    if (to.kind === 'container' && ctx.container?.id !== to.id) return;
    ctx.send({ t: 'move', uid: s.uid, from: loc, to });
    ctx.ui('pickup');
  }

  private actionsFor(s: ItemStack, loc: InvLocation): Action[] {
    const ctx = this.ctx;
    const def = ctx.content.findItem(s.id);
    if (!def) return [];
    const inv = ctx.inventory;
    const actions: Action[] = [];
    const move = (to: InvLocation, qty?: number) => {
      ctx.send({ t: 'move', uid: s.uid, from: loc, to, qty });
      ctx.ui('pickup');
    };
    if (!isPlayerLoc(loc)) {
      actions.push({ label: 'Take', primary: true, run: () => ctx.take(s, loc) });
      if (s.qty > 1) actions.push({ label: 'Take one', run: () => move(inv.back ? { kind: 'backpack' } : { kind: 'pockets' }, 1) });
      if (def.container && !inv.back) actions.push({ label: 'Wear', run: () => move({ kind: 'back' }) });
      const slot = quickSlotFor(def, inv.slots);
      if (slot !== null) actions.push({ label: `To quick slot ${slot + 1}`, run: () => move({ kind: 'slot', index: slot }) });
      return actions;
    }
    const verb = useVerb(def);
    if (loc.kind === 'slot') {
      const selected = loc.index === ctx.selectedSlot;
      actions.push({ label: selected ? 'Put away' : 'Hold', primary: true, run: () => ctx.selectSlot(selected ? NO_SLOT : loc.index) });
      if (verb && !def.firearm && !def.melee && !def.container)
        actions.push({ label: verb, run: () => ctx.send({ t: 'use', uid: s.uid }) });
    } else if (verb && !(loc.kind === 'back' && def.container)) {
      actions.push({ label: verb, primary: true, run: () => ctx.send({ t: 'use', uid: s.uid }) });
    }
    if (def.firearm && ((loc.kind === 'slot' && loc.index === ctx.selectedSlot ? ctx.magAmmo : s.ammo) ?? 0) > 0) {
      actions.push({ label: 'Unload', run: () => ctx.send({ t: 'unload', uid: s.uid }) });
    }
    if (loc.kind !== 'slot' && loc.kind !== 'back') {
      const slot = quickSlotFor(def, inv.slots);
      if (slot !== null) actions.push({ label: `To quick slot ${slot + 1}`, run: () => move({ kind: 'slot', index: slot }) });
    }
    if (loc.kind !== 'back') {
      if (inv.back && loc.kind !== 'backpack') actions.push({ label: 'To bag', run: () => move({ kind: 'backpack' }) });
      if (loc.kind !== 'pockets') actions.push({ label: 'To pockets', run: () => move({ kind: 'pockets' }) });
    }
    const open = ctx.container;
    if (open && this.activeTab === open.id)
      actions.push({ label: `Put in ${open.name.toLowerCase()}`, run: () => move({ kind: 'container', id: open.id }) });
    if (s.qty > 1) actions.push({ label: 'Drop one', run: () => ctx.send({ t: 'drop', uid: s.uid, qty: 1 }) });
    actions.push({ label: s.qty > 1 ? 'Drop all' : 'Drop', run: () => ctx.send({ t: 'drop', uid: s.uid }) });
    return actions;
  }

  private renderDetail(): void {
    clear(this.leftDetail);
    clear(this.rightDetail);
    const sel = this.selection;
    if (!sel) return;
    const s = this.stackAt(sel.uid, sel.loc);
    const def = s ? this.ctx.content.findItem(s.id) : undefined;
    if (!s || !def) return;
    const target = isPlayerLoc(sel.loc) ? this.leftDetail : this.rightDetail;
    const stats = h('div', { class: 'stats' });
    for (const st of itemStats(def)) stats.append(h('span', null, `${st.label}: `, h('b', null, st.value)));
    const actions = h('div', { class: 'actions' });
    for (const a of this.actionsFor(s, sel.loc)) {
      actions.append(h('button', { class: `btn small${a.primary ? ' primary' : ''}`, on: { click: () => a.run() } }, a.label));
    }
    target.append(
      h(
        'div',
        { class: 'detail' },
        h('h4', null, def.name, s.qty > 1 ? h('span', { class: 'muted' }, ` ×${s.qty}`) : null),
        def.description ? h('p', null, def.description) : null,
        stats,
        actions,
      ),
    );
  }

  private showMenu(x: number, y: number, actions: Action[]): void {
    this.closeMenu();
    if (actions.length === 0) return;
    const menu = h('div', { class: 'context-menu', role: 'menu' });
    for (const a of actions) {
      menu.append(
        h(
          'button',
          {
            role: 'menuitem',
            on: {
              click: () => {
                a.run();
                this.closeMenu();
              },
            },
          },
          a.label,
        ),
      );
    }
    menu.style.left = `${Math.min(x, window.innerWidth - 180)}px`;
    menu.style.top = `${Math.min(y, window.innerHeight - 40 - actions.length * 32)}px`;
    menu.addEventListener('mousedown', (e) => e.stopPropagation());
    this.root.append(menu);
    this.menu = menu;
  }

  private closeMenu(): void {
    this.menu?.remove();
    this.menu = null;
  }
}
