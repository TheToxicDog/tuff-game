// The heads-up display: Crests and knowledge, menu buttons, minimap and clock, the current
// objective, health / food / stamina, the hotbar, buffs, the interaction prompt, notices and the
// hover card.

import { MAX_STAMINA, REGION_NAMES, formatCrests } from '@ironwild/shared';
import type { UiContext } from '../game/state';
import { fmtTime, h } from './dom';
import { slotEl } from './slots';

const BUFF_NAMES: Record<string, string> = { strength: '💪 Strength', stamina: '🌾 Stamina', regen: '❤ Regeneration' };

export class Hud {
  private readonly money = h('div', { class: 'panel money' });
  private readonly minimap = h('canvas', { width: 178, height: 178 }) as HTMLCanvasElement;
  private readonly clock = h('div', { class: 'clock' });
  private readonly objective = h('div', { class: 'panel objective', style: 'display:none' });
  private readonly contracts = h('div', { class: 'panel contracts-hud', style: 'display:none' });
  private readonly bars = h('div', { class: 'bars' });
  private readonly hpBar = bar('hp');
  private readonly hungerBar = bar('hunger');
  private readonly staminaBar = bar('stamina');
  private readonly hotbar = h('div', { class: 'panel hotbar' });
  private readonly buffs = h('div', { class: 'buffs' });
  readonly prompt = h('div', { class: 'panel prompt', style: 'display:none' });
  private readonly notices = h('div', { class: 'notices' });
  readonly hover = h('div', { class: 'panel hover-info', style: 'display:none' });
  private lastMinimap = 0;

  constructor(
    ui: HTMLElement,
    private readonly ctx: UiContext,
    buttons: { label: string; key: string; action: () => void }[],
  ) {
    const menu = h('div', { class: 'menu-buttons' });
    for (const b of buttons)
      menu.append(h('button', { onclick: b.action, title: `${b.label} (${b.key})` }, b.label, h('kbd', null, b.key)));
    ui.append(
      h('div', { class: 'hud-top-right' }, this.money, menu),
      h('div', { class: 'hud-top-left' }, h('div', { class: 'panel minimap' }, this.minimap, this.clock), this.objective, this.contracts),
      this.bars,
      this.hotbar,
      this.buffs,
      this.prompt,
      this.notices,
      this.hover,
    );
    this.bars.append(this.hpBar.el, this.hungerBar.el, this.staminaBar.el);
  }

  renderStatus(): void {
    const s = this.ctx.state.status;
    this.money.replaceChildren(
      h('span', { class: 'crests' }, formatCrests(s.crests)),
      h('span', { class: 'kp', title: 'Knowledge' }, `✦ ${Math.floor(s.kp)}`),
    );
    this.hpBar.set(s.hp, 100, `${Math.ceil(s.hp)}`);
    this.hungerBar.set(s.hunger, 100, s.hunger < 20 ? 'Hungry!' : `${Math.ceil(s.hunger)}`);
    this.buffs.replaceChildren(...s.buffs.map((b) => h('div', { class: 'panel' }, `${BUFF_NAMES[b.id] ?? b.id} ${b.left}s`)));
  }

  renderStamina(stamina: number): void {
    this.staminaBar.set(stamina, MAX_STAMINA, '');
  }

  renderHotbar(): void {
    const st = this.ctx.state;
    this.hotbar.replaceChildren();
    for (let i = 0; i < Math.min(8, st.cap); i++)
      this.hotbar.append(slotEl({ s: 'inv', i }, st.slots[i] ?? null, { key: String(i + 1), selected: i === st.sel }));
  }

  renderObjective(): void {
    const t = this.ctx.state.tutorial;
    if (!t || t.done) {
      this.objective.style.display = 'none';
      return;
    }
    this.objective.style.display = 'block';
    this.objective.replaceChildren(h('div', { class: 'title' }, `Goal: ${t.title}`), h('div', null, t.text));
    if (t.progress) this.objective.append(h('div', { class: 'obj-progress' }, t.progress));
  }

  renderContracts(): void {
    const list = this.ctx.state.contracts;
    if (list.length === 0) {
      this.contracts.style.display = 'none';
      return;
    }
    this.contracts.style.display = 'block';
    this.contracts.replaceChildren(
      h('div', { class: 'title', style: 'font-family:var(--heading);color:var(--gold)' }, 'Contracts (J)'),
      ...list.map((c) => h('div', { class: 'c' }, `${c.delivered}/${c.n} ${c.item.replace(/_/g, ' ')} → ${c.settlement}`)),
    );
  }

  notice(text: string, kind: 'info' | 'good' | 'bad' | 'money' = 'info'): void {
    const el = h('div', { class: `panel notice ${kind}` }, text);
    this.notices.prepend(el);
    while (this.notices.children.length > 6) this.notices.lastElementChild?.remove();
    setTimeout(() => (el.style.opacity = '0'), 5200);
    setTimeout(() => el.remove(), 5900);
  }

  /** Redraws the minimap around the player (a few times a second). */
  update(now: number, x: number, y: number, angle: number, minutes: number): void {
    if (now - this.lastMinimap < 250) return;
    this.lastMinimap = now;
    const w = this.ctx.world;
    const region = w.settlementAt(x, y)?.name ?? REGION_NAMES[regionAt(w, x, y)] ?? '';
    const day = Math.floor(minutes / 1440) + 1;
    this.clock.replaceChildren(h('span', null, `Day ${day} · ${fmtTime(minutes)}`), h('span', null, region));
    const c = this.minimap.getContext('2d')!;
    const span = 110;
    const src = this.ctx.terrainCanvas();
    const px = 4;
    c.imageSmoothingEnabled = true;
    c.fillStyle = '#3f6f9e';
    c.fillRect(0, 0, 178, 178);
    c.drawImage(src, (x - span / 2) * px, (y - span / 2) * px, span * px, span * px, 0, 0, 178, 178);
    const s = 178 / span;
    for (const t of w.settlements) {
      const sx = (t.x - x + span / 2) * s;
      const sy = (t.y - y + span / 2) * s;
      if (sx < -20 || sy < -20 || sx > 198 || sy > 198) continue;
      c.fillStyle = 'rgba(255,243,201,0.95)';
      c.beginPath();
      c.arc(sx, sy, 4, 0, Math.PI * 2);
      c.fill();
      c.font = '11px Hammersmith One, sans-serif';
      c.fillStyle = '#fff';
      c.strokeStyle = '#000';
      c.lineWidth = 3;
      c.strokeText(t.name, sx + 6, sy + 4);
      c.fillText(t.name, sx + 6, sy + 4);
    }
    // Owned structures as dots.
    c.fillStyle = 'rgba(242,197,61,0.8)';
    for (const st of w.structs.values()) {
      const sx = (st.x + 0.5 - x + span / 2) * s;
      const sy = (st.y + 0.5 - y + span / 2) * s;
      if (sx >= 0 && sy >= 0 && sx <= 178 && sy <= 178) c.fillRect(sx - 1, sy - 1, 2, 2);
    }
    c.save();
    c.translate(89, 89);
    c.rotate(angle);
    c.fillStyle = '#f2c53d';
    c.strokeStyle = '#000';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(8, 0);
    c.lineTo(-5, -5);
    c.lineTo(-2, 0);
    c.lineTo(-5, 5);
    c.closePath();
    c.fill();
    c.stroke();
    c.restore();
  }
}

function regionAt(w: UiContext['world'], x: number, y: number): number {
  return w.region(x, y);
}

function bar(kind: string): { el: HTMLElement; set: (v: number, max: number, text: string) => void } {
  const fill = h('div');
  const label = h('span');
  const el = h('div', { class: `bar ${kind}` }, fill, label);
  return {
    el,
    set: (v, max, text) => {
      fill.style.width = `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
      label.textContent = text;
    },
  };
}
