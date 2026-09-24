// Heads-up display (design plan §81): condition and stamina, status badges, clock, minimap, quick
// slots, weapon and ammo, interaction prompt, action progress, notices and the hurt vignette.
// The HUD stays small and readable; nothing here is interactive except the hint's close button.

import {
  bleedingLabel,
  energyLabel,
  ENCUMBRANCE,
  formatClock,
  healthLabel,
  hungerLabel,
  NO_SLOT,
  painLabel,
  reserveAmmo,
  stressLabel,
  thirstLabel,
  type StatusView,
} from '@tuff/shared';
import type { GameContext } from './context';
import { h, clear } from './dom';
import { iconImage } from './icons';
import { conditionLabel } from './items';
import type { MapMarker, MapView } from './map-view';

const HINT_KEY = 'tuff.hintDismissed';

interface SlotEl {
  root: HTMLElement;
  icon: HTMLElement;
  qty: HTMLElement;
  cond: HTMLElement;
  key: string;
}

export interface HudFrame {
  stamina: number;
  maxStamina: number;
  exhausted: boolean;
  reloading: boolean;
  worldMinutes: number;
}

export class Hud {
  readonly root: HTMLElement;
  private readonly healthLabelEl: HTMLElement;
  private readonly hpFill: HTMLElement;
  private readonly staminaMeter: HTMLElement;
  private readonly staminaFill: HTMLElement;
  private readonly badges: HTMLElement;
  private readonly clock: HTMLElement;
  private readonly minimap: HTMLCanvasElement;
  private readonly minimapCtx: CanvasRenderingContext2D;
  private readonly players: HTMLElement;
  private readonly slots: SlotEl[] = [];
  private readonly weaponName: HTMLElement;
  private readonly weaponAmmo: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly progress: HTMLElement;
  private readonly progressLabel: HTMLElement;
  private readonly progressFill: HTMLElement;
  private readonly notices: HTMLElement;
  private readonly vignette: HTMLElement;
  private readonly connection: HTMLElement;
  private readonly hint: HTMLElement;
  private readonly debug: HTMLElement;
  private readonly sleepOverlay: HTMLElement;
  private readonly sleepText: HTMLElement;
  private readonly sleepFill: HTMLElement;
  private readonly buildBadge: HTMLElement;
  private progressStart = 0;
  private progressDuration = 0;
  private hurtFlash = 0;
  private lastKeys = new Map<string, string>();
  private minimapTimer = 0;

  constructor(
    parent: HTMLElement,
    private readonly ctx: GameContext,
  ) {
    this.healthLabelEl = h('b', null, 'Healthy');
    this.hpFill = h('i', { style: 'width:100%' });
    this.staminaFill = h('i', { style: 'width:100%' });
    this.staminaMeter = h('div', { class: 'meter stamina' }, this.staminaFill);
    this.badges = h('div', { class: 'badges' });
    const status = h(
      'div',
      { class: 'hud-status' },
      h(
        'div',
        { class: 'health-bar' },
        h('div', { class: 'label' }, h('span', null, 'Condition'), this.healthLabelEl),
        h('div', { class: 'meter hp' }, this.hpFill),
        this.staminaMeter,
      ),
      this.badges,
    );
    this.clock = h('div', { class: 'clock' });
    this.minimap = h('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.minimap.width = Math.round(190 * dpr);
    this.minimap.height = Math.round(190 * dpr);
    this.minimapCtx = this.minimap.getContext('2d')!;
    this.players = h('div', { class: 'players-list' });
    const topRight = h('div', { class: 'hud-topright' }, this.clock, h('div', { class: 'minimap' }, this.minimap));

    const slotRow = h('div', { class: 'slots' });
    for (let i = 0; i < 5; i++) {
      const icon = h('span');
      const qty = h('span', { class: 'qty' });
      const cond = h('div', { class: 'cond hidden' }, h('i'));
      const root = h('div', { class: 'slot' }, h('span', { class: 'key' }, String(i + 1)), icon, qty, cond);
      slotRow.append(root);
      this.slots.push({ root, icon, qty, cond, key: '' });
    }
    this.weaponName = h('div', { class: 'name' }, 'Unarmed');
    this.weaponAmmo = h('div', { class: 'ammo hidden' });
    const bottom = h('div', { class: 'hud-bottom' }, slotRow, h('div', { class: 'weapon-panel' }, this.weaponName, this.weaponAmmo));

    this.prompt = h('div', { class: 'prompt hidden' });
    this.progressLabel = h('span');
    this.progressFill = h('i', { style: 'width:0%' });
    this.progress = h('div', { class: 'progress hidden' }, this.progressLabel, h('div', { class: 'meter' }, this.progressFill));
    this.notices = h('div', { class: 'notices', role: 'status' });
    this.vignette = h('div', { class: 'hurt-vignette' });
    this.connection = h('div', { class: 'connection-bad hidden' });
    this.debug = h('div', { class: 'debug-overlay hidden' });
    this.sleepText = h('div', { class: 'sleep-text' });
    this.sleepFill = h('i', { style: 'width:0%' });
    this.sleepOverlay = h(
      'div',
      { class: 'sleep-overlay hidden' },
      h(
        'div',
        { class: 'sleep-card' },
        h('div', { class: 'sleep-title' }, 'Asleep'),
        this.sleepText,
        h('div', { class: 'meter sleep-meter', title: 'Rest' }, this.sleepFill),
        h('div', { class: 'fine' }, 'Press E to wake up'),
      ),
    );
    this.buildBadge = h('div', { class: 'build-badge hidden' }, 'BUILD MODE');
    this.hint = h(
      'div',
      { class: 'hint interactive' },
      h('b', null, 'WASD'),
      ' move · ',
      h('b', null, 'Shift'),
      ' sprint · ',
      h('b', null, 'C'),
      ' crouch · ',
      h('b', null, 'Mouse'),
      ' aim & attack · ',
      h('b', null, 'Right click'),
      ' precision aim · ',
      h('b', null, 'Q / Space'),
      ' shove · ',
      h('b', null, 'E'),
      ' interact · ',
      h('b', null, 'R'),
      ' reload · ',
      h('b', null, '1–5'),
      ' quick slots · ',
      h('b', null, 'Tab'),
      ' inventory · ',
      h('b', null, 'H'),
      ' health · ',
      h('b', null, 'F'),
      ' flashlight · ',
      h('b', null, 'M'),
      ' map · ',
      h('b', null, 'Enter'),
      ' chat',
      h('div', { style: 'margin-top:6px' }, h('button', { class: 'link', on: { click: () => this.dismissHint() } }, 'Got it')),
    );
    try {
      if (localStorage.getItem(HINT_KEY)) this.hint.classList.add('hidden');
    } catch {
      // Storage unavailable: keep the hint.
    }
    this.root = h(
      'div',
      { class: 'hud' },
      this.sleepOverlay,
      this.buildBadge,
      this.vignette,
      status,
      topRight,
      this.players,
      bottom,
      this.prompt,
      this.progress,
      this.notices,
      this.hint,
      this.connection,
      this.debug,
    );
    parent.append(this.root);
  }

  dismissHint(): void {
    this.hint.classList.add('hidden');
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      // Ignore.
    }
  }

  showHint(): void {
    this.hint.classList.remove('hidden');
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  /** Only touch the DOM when a value actually changes. */
  private changed(key: string, value: string): boolean {
    if (this.lastKeys.get(key) === value) return false;
    this.lastKeys.set(key, value);
    return true;
  }

  frame(dt: number, f: HudFrame): void {
    const pct = `${Math.round((f.stamina / Math.max(0.01, f.maxStamina)) * 100)}`;
    if (this.changed('stamina', `${pct}${f.exhausted}`)) {
      this.staminaFill.style.width = `${Math.round(f.stamina * 100)}%`;
      this.staminaMeter.classList.toggle('exhausted', f.exhausted);
    }
    const clock = formatClock(f.worldMinutes);
    if (this.changed('clock', clock)) {
      const day = Math.floor(f.worldMinutes / 1440) + 1;
      clear(this.clock);
      this.clock.append(h('b', null, clock.split(' ').pop() ?? clock), ` · Day ${day}`);
    }
    if (this.progressDuration > 0) {
      const t = Math.min(1, (performance.now() - this.progressStart) / (this.progressDuration * 1000));
      this.progressFill.style.width = `${(t * 100).toFixed(1)}%`;
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    const health = this.ctx.status?.health ?? 100;
    const base = health < 60 ? (60 - health) / 90 : 0;
    const opacity = Math.min(0.95, base + this.hurtFlash).toFixed(2);
    if (this.changed('vignette', opacity)) this.vignette.style.opacity = opacity;
    this.updateWeapon(f.reloading);
  }

  private updateWeapon(reloading: boolean): void {
    const ctx = this.ctx;
    const inv = ctx.inventory;
    const slot = ctx.selectedSlot;
    const stack = slot !== NO_SLOT ? inv.slots[slot] : null;
    const def = stack ? ctx.content.findItem(stack.id) : undefined;
    let name = def?.name ?? 'Unarmed';
    let ammo = '';
    let empty = false;
    if (def?.firearm) {
      const reserve = reserveAmmo(ctx.content, inv, def.firearm.caliber);
      ammo = reloading ? 'reload' : `${ctx.magAmmo}|${reserve}`;
      empty = ctx.magAmmo === 0;
    } else if (def?.melee && stack?.cond !== undefined) {
      name = `${def.name} — ${conditionLabel(stack.cond)}`;
    }
    if (this.changed('weapon', `${name}#${ammo}#${empty}`)) {
      this.weaponName.textContent = name;
      this.weaponAmmo.classList.toggle('hidden', !def?.firearm);
      this.weaponAmmo.classList.toggle('empty', empty && !reloading);
      clear(this.weaponAmmo);
      if (def?.firearm) {
        if (reloading) this.weaponAmmo.append(h('small', null, 'Reloading…'));
        else {
          const [mag, reserve] = ammo.split('|');
          this.weaponAmmo.append(mag, h('small', null, ` / ${reserve}`));
        }
      }
    }
  }

  setInventory(): void {
    const ctx = this.ctx;
    for (let i = 0; i < 5; i++) {
      const el = this.slots[i];
      const stack = ctx.inventory.slots[i];
      const def = stack ? ctx.content.findItem(stack.id) : undefined;
      const key = stack ? `${stack.id}:${stack.qty}:${stack.cond?.toFixed(2)}:${i === ctx.selectedSlot}` : `none:${i === ctx.selectedSlot}`;
      el.root.classList.toggle('active', i === ctx.selectedSlot);
      if (el.key === key) continue;
      el.key = key;
      clear(el.icon);
      if (def) el.icon.append(iconImage(def, 44));
      el.qty.textContent = stack && stack.qty > 1 ? String(stack.qty) : '';
      el.root.title = def ? def.name : 'Empty';
      const cond = stack?.cond;
      el.cond.classList.toggle('hidden', cond === undefined || !def?.durability);
      if (cond !== undefined) (el.cond.firstChild as HTMLElement).style.width = `${Math.round(cond * 100)}%`;
    }
  }

  setBuildMode(on: boolean): void {
    this.buildBadge.classList.toggle('hidden', !on);
  }

  private setSleep(s: StatusView): void {
    const asleep = s.sleeping !== null;
    this.sleepOverlay.classList.toggle('hidden', !asleep);
    if (!asleep) return;
    const where = s.sleeping! >= 0.9 ? 'in a bed' : s.sleeping! >= 0.5 ? 'on something soft' : 'on the hard floor';
    const rest = energyLabel(s.needs.energy) ?? 'Resting';
    this.sleepText.textContent = `Sleeping ${where} · ${rest}${s.fastForward ? ' · everyone is asleep, the night passes quickly' : ''}`;
    this.sleepFill.style.width = `${Math.round(s.needs.energy)}%`;
  }

  setStatus(s: StatusView): void {
    this.setSleep(s);
    this.healthLabelEl.textContent = healthLabel(s.health);
    this.hpFill.style.width = `${Math.max(0, Math.min(100, s.health)).toFixed(1)}%`;
    const badges: [string, string][] = [];
    const bleed = bleedingLabel(s.bleeding);
    if (bleed) badges.push([bleed, 'danger']);
    const infected = s.wounds.some((w) => w.infection > 0.1);
    if (infected) badges.push(['Infected', 'danger']);
    const pain = painLabel(s.pain);
    if (pain) badges.push([pain, s.pain >= 65 ? 'danger' : 'warn']);
    const thirst = thirstLabel(s.needs.thirst);
    if (thirst) badges.push([thirst, s.needs.thirst < 20 ? 'danger' : 'warn']);
    const hunger = hungerLabel(s.needs.hunger);
    if (hunger) badges.push([hunger, s.needs.hunger < 20 ? 'danger' : 'warn']);
    const energy = energyLabel(s.needs.energy);
    if (energy) badges.push([energy, 'warn']);
    const stress = stressLabel(s.needs.stress);
    if (stress) badges.push([stress, 'warn']);
    if (s.wounds.some((w) => w.type === 'fracture' && !w.splinted)) badges.push(['Fracture', 'danger']);
    if (s.carried > ENCUMBRANCE.heavy) badges.push(['Overloaded', 'danger']);
    else if (s.carried > ENCUMBRANCE.comfortable) badges.push(['Heavy Load', 'warn']);
    if (s.weakness) badges.push(['Weakened', 'warn']);
    if (s.painkillers) badges.push(['Painkillers', 'good']);
    if (s.antibiotics) badges.push(['Antibiotics', 'good']);
    if (s.hasFlashlight && s.flashlightCharge < 0.15) badges.push(['Low Battery', 'warn']);
    const key = badges.map((b) => b.join(':')).join('|');
    if (!this.changed('badges', key)) return;
    clear(this.badges);
    for (const [text, level] of badges) this.badges.append(h('span', { class: `badge ${level}` }, text));
  }

  setPlayers(names: string[]): void {
    clear(this.players);
    this.players.classList.toggle('hidden', names.length <= 1);
    this.players.append(h('b', null, `Survivors online (${names.length})`));
    for (const n of names) this.players.append(h('div', null, n));
  }

  setPrompt(key: string | null, text = '', alt = ''): void {
    const value = key ? `${key}|${text}|${alt}` : '';
    if (!this.changed('prompt', value)) return;
    this.prompt.classList.toggle('hidden', !key);
    clear(this.prompt);
    if (!key) return;
    this.prompt.append(h('kbd', null, key), text);
    if (alt) this.prompt.append(h('span', { class: 'alt' }, alt));
  }

  startProgress(label: string, duration: number): void {
    this.progressLabel.textContent = label;
    this.progressStart = performance.now();
    this.progressDuration = duration;
    this.progressFill.style.width = '0%';
    this.progress.classList.remove('hidden');
  }

  endProgress(): void {
    this.progressDuration = 0;
    this.progress.classList.add('hidden');
  }

  get busy(): boolean {
    return this.progressDuration > 0;
  }

  notice(text: string, level: 'info' | 'good' | 'warn' = 'info'): void {
    // Collapse repeats instead of stacking the same message.
    const last = this.notices.lastElementChild as HTMLElement | null;
    if (last && last.dataset.text === text) {
      last.dataset.count = String(Number(last.dataset.count ?? '1') + 1);
      last.textContent = `${text} ×${last.dataset.count}`;
      return;
    }
    const el = h('div', { class: `notice ${level}`, data: { text } }, text);
    this.notices.append(el);
    while (this.notices.children.length > 4) this.notices.firstElementChild!.remove();
    window.setTimeout(() => {
      el.style.opacity = '0';
      window.setTimeout(() => el.remove(), 450);
    }, 3200);
  }

  hurt(amount: number): void {
    this.hurtFlash = Math.min(0.8, this.hurtFlash + amount);
  }

  setDebug(text: string | null): void {
    this.debug.classList.toggle('hidden', text === null);
    if (text !== null) this.debug.textContent = text;
  }

  setConnectionWarning(text: string | null): void {
    if (!this.changed('conn', text ?? '')) return;
    this.connection.classList.toggle('hidden', !text);
    this.connection.textContent = text ?? '';
  }

  updateMinimap(dt: number, map: MapView | null, x: number, y: number, aim: number, markers: MapMarker[]): void {
    this.minimapTimer -= dt;
    if (this.minimapTimer > 0 || !map) return;
    this.minimapTimer = 0.1;
    const ctx = this.minimapCtx;
    const scale = (this.minimap.width / 190) * 1.25;
    map.draw(ctx, x, y, scale, [...markers, { x, y, color: '#e8e4d0', angle: aim, self: true }], false);
  }
}
