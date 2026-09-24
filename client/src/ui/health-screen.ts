// Health panel (design plan §17–21): body diagram coloured by wound state, needs, and every wound
// with its bleeding, contamination and healing state plus the treatments the player can apply
// with what they carry.

import {
  BODY_PART_NAMES,
  bleedingLabel,
  energyLabel,
  forEachStack,
  healthLabel,
  hungerLabel,
  painLabel,
  stressLabel,
  thirstLabel,
  WOUND_TEMPLATES,
  woundSummary,
  type BodyPart,
  type ItemDef,
  type ItemStack,
  type Treatment,
  type Wound,
} from '@tuff/shared';
import type { GameContext } from './context';
import { clear, h } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Body diagram shapes in a 100 × 200 view box (front view, character's left on the right). */
const PARTS: { part: BodyPart; shape: 'circle' | 'rect'; a: number[] }[] = [
  { part: 'head', shape: 'circle', a: [50, 20, 14] },
  { part: 'torso', shape: 'rect', a: [33, 37, 34, 58] },
  { part: 'rightArm', shape: 'rect', a: [18, 39, 13, 48] },
  { part: 'leftArm', shape: 'rect', a: [69, 39, 13, 48] },
  { part: 'rightHand', shape: 'rect', a: [18, 89, 13, 14] },
  { part: 'leftHand', shape: 'rect', a: [69, 89, 13, 14] },
  { part: 'rightLeg', shape: 'rect', a: [34, 97, 15, 70] },
  { part: 'leftLeg', shape: 'rect', a: [51, 97, 15, 70] },
  { part: 'rightFoot', shape: 'rect', a: [31, 169, 18, 12] },
  { part: 'leftFoot', shape: 'rect', a: [51, 169, 18, 12] },
];

interface MedItem {
  stack: ItemStack;
  def: ItemDef;
}

function treatmentFor(w: Wound, t: Treatment): boolean {
  switch (t) {
    case 'bandage':
      return w.type !== 'bruise' && w.type !== 'fracture';
    case 'disinfect':
      return !w.disinfected && w.contamination > 0;
    case 'suture':
      return !w.sutured && (w.type === 'deep_cut' || w.type === 'cut' || w.type === 'gunshot' || w.type === 'bite');
    case 'splint':
      return !w.splinted && w.type === 'fracture';
    default:
      return false;
  }
}

export class HealthScreen {
  readonly root: HTMLElement;
  private readonly diagram: HTMLElement;
  private readonly details: HTMLElement;
  isOpen = false;
  private selectedPart: BodyPart | null = null;

  constructor(
    parent: HTMLElement,
    private readonly ctx: GameContext,
    private readonly onClose: () => void,
  ) {
    this.diagram = h('div', { class: 'body-diagram' });
    this.details = h('div');
    const panel = h(
      'div',
      { class: 'panel health-panel', role: 'dialog', ariaLabel: 'Health' },
      h(
        'div',
        { class: 'panel-header' },
        h('span', { class: 'panel-title' }, 'Health'),
        h('button', { class: 'btn small', on: { click: () => this.close() } }, 'Close'),
      ),
      h('div', { class: 'health-body' }, this.diagram, this.details),
    );
    this.root = h('div', { class: 'modal-backdrop hidden', on: { mousedown: (e) => e.target === this.root && this.close() } }, panel);
    parent.append(this.root);
  }

  open(): void {
    this.isOpen = true;
    this.root.classList.remove('hidden');
    this.render();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.add('hidden');
    this.onClose();
  }

  toggle(): void {
    if (this.isOpen) this.close();
    else this.open();
  }

  private medicalItems(): MedItem[] {
    const out: MedItem[] = [];
    forEachStack(this.ctx.inventory, (stack) => {
      const def = this.ctx.content.findItem(stack.id);
      if (def?.medical) out.push({ stack, def });
    });
    return out;
  }

  render(): void {
    if (!this.isOpen) return;
    const status = this.ctx.status;
    clear(this.diagram);
    clear(this.details);
    if (!status) {
      this.details.append(h('div', { class: 'empty-note' }, 'No data yet.'));
      return;
    }
    // Diagram.
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 190');
    for (const p of PARTS) {
      const wounds = status.wounds.filter((w) => w.part === p.part);
      const el = document.createElementNS(SVG_NS, p.shape === 'circle' ? 'circle' : 'rect');
      if (p.shape === 'circle') {
        el.setAttribute('cx', String(p.a[0]));
        el.setAttribute('cy', String(p.a[1]));
        el.setAttribute('r', String(p.a[2]));
      } else {
        el.setAttribute('x', String(p.a[0]));
        el.setAttribute('y', String(p.a[1]));
        el.setAttribute('width', String(p.a[2]));
        el.setAttribute('height', String(p.a[3]));
        el.setAttribute('rx', '4');
      }
      const classes = ['part'];
      if (wounds.length > 0) classes.push('hurt');
      if (wounds.some((w) => w.bleeding * (1 - w.bandage * 0.92) > 0.02)) classes.push('bleeding');
      if (wounds.some((w) => w.infection > 0.1)) classes.push('infected');
      if (wounds.length > 0 && wounds.every((w) => w.bandage > 0 || w.type === 'bruise')) classes.push('treated');
      if (this.selectedPart === p.part) classes.push('selected');
      el.setAttribute('class', classes.join(' '));
      const title = document.createElementNS(SVG_NS, 'title');
      title.textContent = `${BODY_PART_NAMES[p.part]}${wounds.length ? ` — ${wounds.map((w) => WOUND_TEMPLATES[w.type].name).join(', ')}` : ''}`;
      el.append(title);
      el.addEventListener('click', () => {
        this.selectedPart = this.selectedPart === p.part ? null : p.part;
        this.render();
      });
      svg.append(el);
    }
    this.diagram.append(svg, h('div', { class: 'fine', style: 'text-align:center;margin-top:6px' }, 'Click a body part to filter.'));

    // Summary.
    const n = status.needs;
    const need = (label: string, value: string | null, fallback: string) =>
      h('div', { class: 'need' }, label, h('span', { class: 'v' }, value ?? fallback));
    this.details.append(
      h(
        'div',
        { class: 'needs-grid' },
        need('Condition', healthLabel(status.health), ''),
        need('Pain', painLabel(status.pain), 'None'),
        need('Bleeding', bleedingLabel(status.bleeding), 'None'),
        need('Stress', stressLabel(n.stress), 'Calm'),
        need('Hunger', hungerLabel(n.hunger), 'Fed'),
        need('Thirst', thirstLabel(n.thirst), 'Hydrated'),
        need('Energy', energyLabel(n.energy), 'Rested'),
        need(
          'Medicine',
          status.painkillers || status.antibiotics
            ? [status.painkillers ? 'Painkillers' : '', status.antibiotics ? 'Antibiotics' : ''].filter(Boolean).join(', ')
            : null,
          'None',
        ),
      ),
    );

    const meds = this.medicalItems();
    // Medicines that are not applied to a wound.
    const systemic = meds.filter((m) => m.def.medical!.treatments.some((t) => t === 'painkiller' || t === 'antibiotic'));
    if (systemic.length > 0) {
      const row = h('div', { class: 'row', style: 'flex-wrap:wrap;margin-bottom:10px' });
      for (const m of systemic) {
        row.append(h('button', { class: 'btn small', on: { click: () => this.use(m.stack.uid) } }, `Take ${m.def.name}`));
      }
      this.details.append(row);
    }

    const wounds = status.wounds.filter((w) => !this.selectedPart || w.part === this.selectedPart);
    this.details.append(
      h(
        'div',
        { class: 'section-title' },
        h('span', null, this.selectedPart ? `Wounds — ${BODY_PART_NAMES[this.selectedPart]}` : 'Wounds'),
        h('span', { class: 'cap' }, `${wounds.length}`),
      ),
    );
    if (wounds.length === 0) {
      this.details.append(h('div', { class: 'empty-note' }, this.selectedPart ? 'No wounds here.' : 'No wounds. Keep it that way.'));
      return;
    }
    const order = [...wounds].sort((a, b) => b.bleeding - a.bleeding || b.severity - a.severity);
    for (const w of order) this.details.append(this.woundCard(w, meds));
  }

  private woundCard(w: Wound, meds: MedItem[]): HTMLElement {
    const sum = woundSummary(w);
    const dressing =
      w.bandage > 0 ? (w.dirty > 0.6 ? 'Dirty dressing' : w.bandage > 0.7 ? 'Sterile dressing' : 'Makeshift dressing') : 'Undressed';
    const extras: string[] = [];
    if (w.disinfected) extras.push('Disinfected');
    if (w.sutured) extras.push('Stitched');
    if (w.splinted) extras.push('Splinted');
    const actions = h('div', { class: 'row', style: 'flex-wrap:wrap;margin-top:6px' });
    for (const m of meds) {
      const treatments = m.def.medical!.treatments.filter((t) => treatmentFor(w, t));
      if (treatments.length === 0) continue;
      const label = treatments.includes('bandage')
        ? w.bandage > 0
          ? 'Re-dress'
          : 'Dress'
        : treatments.includes('disinfect')
          ? 'Clean'
          : treatments.includes('suture')
            ? 'Stitch'
            : 'Splint';
      actions.append(h('button', { class: 'btn small', on: { click: () => this.use(m.stack.uid, w.id) } }, `${label} with ${m.def.name}`));
    }
    if (actions.childElementCount === 0)
      actions.append(
        h('span', { class: 'fine' }, w.type === 'bruise' ? 'It will heal on its own.' : 'You have nothing to treat this with.'),
      );
    return h(
      'div',
      { class: 'wound' },
      h('h5', null, `${WOUND_TEMPLATES[w.type].name} — ${BODY_PART_NAMES[w.part]}`),
      h(
        'div',
        { class: 'grid' },
        h('span', null, 'Bleeding: ', h('b', null, sum.bleeding)),
        h('span', null, 'Contamination: ', h('b', null, sum.contamination)),
        h('span', null, 'Dressing: ', h('b', null, dressing)),
        h('span', null, 'Healing: ', h('b', null, sum.healing)),
        extras.length ? h('span', null, 'Care: ', h('b', null, extras.join(', '))) : null,
      ),
      actions,
    );
  }

  private use(uid: number, woundId?: number): void {
    this.ctx.send({ t: 'use', uid, woundId });
    this.ctx.ui('ui_click');
  }
}
