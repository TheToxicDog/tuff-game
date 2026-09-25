// Inventory slots with drag and drop, shift-click quick moves, right-click to take half, and item
// tooltips. Drag state is kept by slot reference so windows can re-render mid-drag.

import { ITEM_BY_ID, QUALITY_NAMES, STRUCTURE_BY_ID, formatCrests, type ItemStack, type SlotRef } from '@ironwild/shared';
import { h } from './dom';
import { iconImg, iconUrl } from './icons';

export interface SlotHandlers {
  move(from: SlotRef, to: SlotRef, n?: number): void;
  quick(from: SlotRef): void;
  /** Dropped outside any slot (onto the world). */
  dropOut(from: SlotRef): void;
  click?(ref: SlotRef, stack: ItemStack | null): void;
}

let handlers: SlotHandlers | null = null;
let drag: { from: SlotRef; stack: ItemStack; half: boolean; img: HTMLImageElement } | null = null;
let tooltipEl: HTMLDivElement | null = null;

export function initSlots(h0: SlotHandlers): void {
  handlers = h0;
  tooltipEl = h('div', { class: 'tooltip panel', style: 'display:none' });
  document.getElementById('ui')!.append(tooltipEl);
  window.addEventListener('pointermove', (e) => {
    if (drag) {
      drag.img.style.left = `${e.clientX - 23}px`;
      drag.img.style.top = `${e.clientY - 23}px`;
    }
    if (tooltipEl && tooltipEl.style.display !== 'none') positionTooltip(e.clientX, e.clientY);
  });
  window.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const target = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.slot') as HTMLElement | null;
    const d = drag;
    drag = null;
    d.img.remove();
    document.querySelectorAll('.slot.drop-target').forEach((el) => el.classList.remove('drop-target'));
    if (target?.dataset.s) {
      const to: SlotRef = { s: target.dataset.s as SlotRef['s'], i: Number(target.dataset.i) };
      if (to.s === d.from.s && to.i === d.from.i) return;
      handlers?.move(d.from, to, d.half ? Math.ceil(d.stack.n / 2) : undefined);
      return;
    }
    const overUi = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest('.window, .hotbar, .panel');
    if (!overUi) handlers?.dropOut(d.from);
  });
}

export function slotEl(
  ref: SlotRef,
  stack: ItemStack | null,
  opts: { key?: string; selected?: boolean; locked?: boolean } = {},
): HTMLDivElement {
  const q = stack?.q;
  const cls = ['slot'];
  if (opts.selected) cls.push('selected');
  if (opts.locked) cls.push('locked');
  if (q !== undefined && q !== 1) cls.push(`q${q}`);
  const el = h('div', { class: cls.join(' '), 'data-s': ref.s, 'data-i': ref.i });
  if (opts.key) el.append(h('span', { class: 'key' }, opts.key));
  if (stack) {
    el.append(iconImg(stack.id));
    if (stack.n > 1) el.append(h('span', { class: 'count' }, stack.n));
  }
  el.addEventListener('pointerdown', (e) => {
    if (!stack || opts.locked) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.shiftKey && e.button === 0) {
      handlers?.quick(ref);
      return;
    }
    if (e.button !== 0 && e.button !== 2) return;
    const img = document.createElement('img');
    img.src = iconUrl(stack.id);
    img.className = 'dragging';
    img.style.left = `${e.clientX - 23}px`;
    img.style.top = `${e.clientY - 23}px`;
    document.body.append(img);
    drag = { from: ref, stack, half: e.button === 2, img };
    hideTooltip();
  });
  el.addEventListener('pointerenter', (e) => {
    if (drag) el.classList.add('drop-target');
    else if (stack) showTooltip(stack, e.clientX, e.clientY);
  });
  el.addEventListener('pointerleave', () => {
    el.classList.remove('drop-target');
    hideTooltip();
  });
  el.addEventListener('click', () => handlers?.click?.(ref, stack));
  return el;
}

export function itemTooltipHtml(stack: ItemStack): HTMLElement {
  const def = ITEM_BY_ID.get(stack.id);
  const wrap = h('div');
  if (!def) return wrap;
  const qName = def.quality && stack.q !== undefined ? QUALITY_NAMES[stack.q] : null;
  wrap.append(h('b', null, def.name));
  if (qName) wrap.append(' ', h('span', { class: `q ${stack.q === 4 ? 'crests' : stack.q === 0 ? 'muted' : 'good'}` }, qName));
  wrap.append(h('div', { class: 'muted' }, `${def.category} · base ${formatCrests(def.value)}`));
  const t = def.tool;
  if (t) {
    const bits = [`${t.damage} damage`, `${t.rate.toFixed(1)} swings/s`];
    if (t.kind === 'axe' || t.kind === 'pickaxe') bits.unshift(`${t.power}× gathering`, `tier ${t.tier}`);
    wrap.append(h('div', null, bits.join(' · ')));
  }
  if (def.food)
    wrap.append(
      h(
        'div',
        { class: 'good' },
        `+${def.food.hunger} food${def.food.heal ? `, +${def.food.heal} health` : ''}${def.food.buff ? `, ${def.food.buff} buff` : ''} (right click)`,
      ),
    );
  if (def.fuel) wrap.append(h('div', { class: 'muted' }, `Fuel: ${def.fuel} smelts`));
  if (def.place) {
    const s = STRUCTURE_BY_ID.get(def.place);
    if (s?.kinetic?.stress) wrap.append(h('div', null, `Needs ${s.kinetic.stress} torque at 16 RPM`));
    if (s?.kinetic?.torque) wrap.append(h('div', null, `Provides ${s.kinetic.torque} torque at ${s.kinetic.rpm} RPM`));
  }
  if (def.desc) wrap.append(h('div', { style: 'margin-top:3px' }, def.desc));
  if (def.place) wrap.append(h('div', { class: 'muted', style: 'margin-top:3px' }, 'Select it and click to place (R rotates).'));
  return wrap;
}

function showTooltip(stack: ItemStack, x: number, y: number): void {
  if (!tooltipEl) return;
  tooltipEl.replaceChildren(itemTooltipHtml(stack));
  tooltipEl.style.display = 'block';
  positionTooltip(x, y);
}

export function showTextTooltip(el: HTMLElement, x: number, y: number): void {
  if (!tooltipEl) return;
  tooltipEl.replaceChildren(el);
  tooltipEl.style.display = 'block';
  positionTooltip(x, y);
}

function positionTooltip(x: number, y: number): void {
  if (!tooltipEl) return;
  const w = tooltipEl.offsetWidth;
  const hgt = tooltipEl.offsetHeight;
  tooltipEl.style.left = `${Math.min(window.innerWidth - w - 8, x + 16)}px`;
  tooltipEl.style.top = `${Math.max(8, Math.min(window.innerHeight - hgt - 8, y + 16))}px`;
}

export function hideTooltip(): void {
  if (tooltipEl) tooltipEl.style.display = 'none';
}

export function isDragging(): boolean {
  return drag !== null;
}
