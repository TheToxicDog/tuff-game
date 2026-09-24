// Health model: one overall health value, with wounds on individual body parts.
// Bleeding is simulated in real seconds (it has to be readable during a fight); healing, infection
// and needs run on game time.

import { clamp } from '../math/scalar';
import type { Rng } from '../math/rng';
import type { Treatment } from '../content/types';

export const BODY_PARTS = [
  'head',
  'torso',
  'leftArm',
  'rightArm',
  'leftHand',
  'rightHand',
  'leftLeg',
  'rightLeg',
  'leftFoot',
  'rightFoot',
] as const;
export type BodyPart = (typeof BODY_PARTS)[number];

export const BODY_PART_NAMES: Record<BodyPart, string> = {
  head: 'Head',
  torso: 'Torso',
  leftArm: 'Left Arm',
  rightArm: 'Right Arm',
  leftHand: 'Left Hand',
  rightHand: 'Right Hand',
  leftLeg: 'Left Leg',
  rightLeg: 'Right Leg',
  leftFoot: 'Left Foot',
  rightFoot: 'Right Foot',
};

export const WOUND_TYPES = ['scratch', 'cut', 'deep_cut', 'puncture', 'bite', 'bruise', 'gunshot', 'fracture', 'burn'] as const;
export type WoundType = (typeof WOUND_TYPES)[number];

interface WoundTemplate {
  name: string;
  bleed: [number, number];
  /** Bleeding reduction per real second from natural clotting. */
  clot: number;
  pain: number;
  contamination: number;
  /** Game minutes to heal fully when properly treated. */
  healMinutes: number;
  damage: [number, number];
}

export const WOUND_TEMPLATES: Record<WoundType, WoundTemplate> = {
  scratch: { name: 'Scratch', bleed: [0.05, 0.14], clot: 0.004, pain: 8, contamination: 0.25, healMinutes: 10 * 60, damage: [3, 6] },
  cut: { name: 'Laceration', bleed: [0.18, 0.32], clot: 0.0014, pain: 18, contamination: 0.2, healMinutes: 30 * 60, damage: [6, 11] },
  deep_cut: {
    name: 'Deep Laceration',
    bleed: [0.4, 0.6],
    clot: 0.0005,
    pain: 32,
    contamination: 0.3,
    healMinutes: 60 * 60,
    damage: [11, 17],
  },
  puncture: { name: 'Puncture', bleed: [0.25, 0.45], clot: 0.0008, pain: 26, contamination: 0.4, healMinutes: 40 * 60, damage: [8, 14] },
  bite: { name: 'Bite', bleed: [0.35, 0.6], clot: 0.0004, pain: 42, contamination: 0.85, healMinutes: 80 * 60, damage: [12, 19] },
  bruise: { name: 'Bruise', bleed: [0, 0], clot: 0, pain: 10, contamination: 0, healMinutes: 12 * 60, damage: [2, 5] },
  gunshot: {
    name: 'Gunshot Wound',
    bleed: [0.5, 0.8],
    clot: 0.0003,
    pain: 55,
    contamination: 0.45,
    healMinutes: 110 * 60,
    damage: [18, 32],
  },
  fracture: { name: 'Fracture', bleed: [0, 0], clot: 0, pain: 60, contamination: 0, healMinutes: 200 * 60, damage: [8, 14] },
  burn: { name: 'Burn', bleed: [0, 0], clot: 0, pain: 38, contamination: 0.3, healMinutes: 60 * 60, damage: [5, 12] },
};

export interface Wound {
  id: number;
  part: BodyPart;
  type: WoundType;
  /** Remaining severity 0..1; the wound is gone at 0. */
  severity: number;
  /** Bleeding rate 0..1 (health per real second before dressings). */
  bleeding: number;
  /** Dressing quality 0..1 (0 = no dressing). */
  bandage: number;
  /** Dressing dirtiness 0..1; dirty dressings raise contamination. */
  dirty: number;
  disinfected: boolean;
  /** Chance-weighted risk that the wound becomes infected. */
  contamination: number;
  /** Infection progress 0..1. */
  infection: number;
  sutured: boolean;
  splinted: boolean;
  /** Game minutes since the wound was inflicted. */
  age: number;
}

export interface BodyState {
  health: number;
  wounds: Wound[];
  painkillerUntil: number;
  antibioticsUntil: number;
  nextWoundId: number;
}

export interface NeedsState {
  /** 100 = full, 0 = starving. */
  hunger: number;
  /** 100 = hydrated, 0 = dehydrated. */
  thirst: number;
  /** 100 = rested, 0 = collapsing. */
  energy: number;
  /** 0 = calm, 100 = panicking. */
  stress: number;
}

export const MAX_HEALTH = 100;

export function createBody(): BodyState {
  return { health: MAX_HEALTH, wounds: [], painkillerUntil: 0, antibioticsUntil: 0, nextWoundId: 1 };
}

export function createNeeds(): NeedsState {
  return { hunger: 85, thirst: 85, energy: 90, stress: 10 };
}

/** Weighted body part selection for melee attacks from the front. */
const HIT_WEIGHTS: [BodyPart, number][] = [
  ['head', 5],
  ['torso', 24],
  ['leftArm', 15],
  ['rightArm', 15],
  ['leftHand', 8],
  ['rightHand', 8],
  ['leftLeg', 9],
  ['rightLeg', 9],
  ['leftFoot', 3.5],
  ['rightFoot', 3.5],
];

export function randomBodyPart(rng: Rng): BodyPart {
  return rng.weighted(HIT_WEIGHTS, ([, w]) => w)[0];
}

/** Adds a wound and applies its immediate damage. Returns the wound. */
export function inflictWound(body: BodyState, part: BodyPart, type: WoundType, rng: Rng, damageScale = 1): Wound {
  const t = WOUND_TEMPLATES[type];
  const wound: Wound = {
    id: body.nextWoundId++,
    part,
    type,
    severity: 1,
    bleeding: rng.range(t.bleed[0], t.bleed[1]),
    bandage: 0,
    dirty: 0,
    disinfected: false,
    contamination: clamp(t.contamination * rng.range(0.7, 1.2), 0, 1),
    infection: 0,
    sutured: false,
    splinted: false,
    age: 0,
  };
  body.wounds.push(wound);
  body.health = Math.max(0, body.health - rng.range(t.damage[0], t.damage[1]) * damageScale);
  return wound;
}

export function woundPain(w: Wound): number {
  const t = WOUND_TEMPLATES[w.type];
  let pain = t.pain * (0.35 + 0.65 * w.severity);
  if (w.splinted) pain *= 0.5;
  if (w.bandage > 0) pain *= 0.85;
  pain += w.infection * 30;
  return pain;
}

/** Total pain 0..100, after painkillers. */
export function totalPain(body: BodyState, now: number): number {
  let pain = 0;
  for (const w of body.wounds) pain += woundPain(w);
  if (now < body.painkillerUntil) pain -= 45;
  return clamp(pain, 0, 100);
}

/** Effective health lost per real second from bleeding. */
export function bleedRate(body: BodyState): number {
  let rate = 0;
  for (const w of body.wounds) rate += w.bleeding * (1 - w.bandage * 0.92);
  return rate;
}

export interface BodyModifiers {
  /** Movement multiplier from leg injuries and pain. */
  speed: number;
  /** Extra weapon spread in degrees. */
  aimSway: number;
  /** Stamina regeneration multiplier. */
  staminaRegen: number;
  canSprint: boolean;
}

export function bodyModifiers(body: BodyState, needs: NeedsState, now: number): BodyModifiers {
  const pain = totalPain(body, now);
  let speed = 1;
  let aimSway = pain / 28;
  let staminaRegen = 1;
  let canSprint = true;
  for (const w of body.wounds) {
    const legs = w.part === 'leftLeg' || w.part === 'rightLeg' || w.part === 'leftFoot' || w.part === 'rightFoot';
    const arms = w.part === 'leftArm' || w.part === 'rightArm' || w.part === 'leftHand' || w.part === 'rightHand';
    if (legs) {
      speed -= w.type === 'fracture' ? (w.splinted ? 0.25 : 0.45) : 0.06 * w.severity;
      if (w.type === 'fracture' && !w.splinted) canSprint = false;
    }
    if (arms) aimSway += w.type === 'fracture' ? (w.splinted ? 2 : 4) : 0.6 * w.severity;
  }
  if (pain > 60) speed -= 0.08;
  if (needs.thirst < 20) staminaRegen *= 0.6;
  if (needs.hunger < 15) staminaRegen *= 0.75;
  if (needs.energy < 20) {
    staminaRegen *= 0.6;
    aimSway += 1.5;
  }
  if (needs.energy < 8) {
    // Running on nothing: legs drag and sprinting is out of the question.
    speed -= 0.12;
    canSprint = false;
  }
  if (body.health < 25) {
    speed -= 0.1;
    canSprint = canSprint && body.health > 12;
  }
  return { speed: clamp(speed, 0.35, 1), aimSway, staminaRegen, canSprint };
}

/** Per-real-second update: bleeding and clotting. Returns health lost this step. */
export function updateBleeding(body: BodyState, dtReal: number): number {
  let lost = 0;
  for (const w of body.wounds) {
    if (w.bleeding <= 0) continue;
    const t = WOUND_TEMPLATES[w.type];
    lost += w.bleeding * (1 - w.bandage * 0.92) * dtReal;
    const clot = t.clot * (w.bandage > 0 ? 3 + w.bandage * 4 : 1) * (w.sutured ? 4 : 1);
    w.bleeding = Math.max(0, w.bleeding - clot * dtReal);
    if (w.bandage > 0) w.dirty = Math.min(1, w.dirty + w.bleeding * 0.004 * dtReal);
  }
  body.health = Math.max(0, body.health - lost);
  return lost;
}

/** Sleep quality of the bare ground; beds are 1, couches 0.7 (see props.json). */
export const GROUND_SLEEP_QUALITY = 0.25;

/** Energy regained per game hour asleep at a given sleep quality. */
export function sleepEnergyRate(quality: number): number {
  return 6 + 9 * quality;
}

/** Why the player cannot fall asleep right now, or null (design plan §21–22). */
export function sleepProblem(body: BodyState, needs: NeedsState, now: number): string | null {
  if (needs.energy > 75) return 'You are not tired enough to sleep.';
  if (bleedRate(body) > 0.05) return 'You cannot sleep while you are bleeding.';
  if (totalPain(body, now) > 60) return 'You are in too much pain to sleep.';
  if (needs.stress > 70) return 'You are too on edge to sleep.';
  if (needs.hunger < 10) return 'You are too hungry to sleep.';
  if (needs.thirst < 10) return 'You are too thirsty to sleep.';
  return null;
}

/**
 * Game-time update: healing, infection, dressing wear, needs and their consequences.
 * `rng` is used for infection onset. `sleep` is the quality of the current sleep (null when
 * awake): sleeping restores energy, slows hunger and thirst and speeds up healing.
 */
export function updateBodyGameTime(
  body: BodyState,
  needs: NeedsState,
  dtMinutes: number,
  now: number,
  rng: Rng,
  sleep: number | null = null,
): void {
  const hours = dtMinutes / 60;
  const asleep = sleep !== null;
  needs.hunger = clamp(needs.hunger - hours * (100 / 44) * (asleep ? 0.6 : 1), 0, 100);
  needs.thirst = clamp(needs.thirst - hours * (100 / 30) * (asleep ? 0.6 : 1), 0, 100);
  needs.energy = clamp(needs.energy + hours * (asleep ? sleepEnergyRate(sleep) : -100 / 40), 0, 100);

  const wellFed = needs.hunger > 45 && needs.thirst > 45;
  const onAntibiotics = now < body.antibioticsUntil;

  for (const w of body.wounds) {
    const t = WOUND_TEMPLATES[w.type];
    w.age += dtMinutes;
    // Dressings get dirty over roughly 12 game hours and then contaminate the wound.
    if (w.bandage > 0) w.dirty = Math.min(1, w.dirty + hours / 12);
    if (w.dirty > 0.75) w.contamination = Math.min(1, w.contamination + hours * 0.05);

    // Infection onset: untreated contamination has a chance per game hour to turn into infection.
    if (w.infection <= 0 && !w.disinfected && w.contamination > 0.05 && w.age > 90) {
      if (rng.chance(w.contamination * 0.12 * hours)) w.infection = 0.02;
    }
    if (w.infection > 0) {
      if (onAntibiotics) w.infection = Math.max(0, w.infection - hours * 0.15);
      else w.infection = Math.min(1, w.infection + hours * 0.04 * (w.disinfected ? 0.5 : 1));
    }

    // Healing.
    let rate = 0.25;
    if (w.bandage > 0) rate = 0.6 + 0.4 * w.bandage * (1 - w.dirty * 0.5);
    if (w.disinfected) rate *= 1.15;
    if ((w.type === 'deep_cut' || w.type === 'gunshot' || w.type === 'bite') && !w.sutured) rate *= 0.6;
    if (w.type === 'fracture' && !w.splinted) rate *= 0.3;
    if (wellFed) rate *= 1.2;
    if (needs.hunger < 15 || needs.thirst < 15) rate *= 0.4;
    if (asleep) rate *= 1 + 0.6 * sleep;
    if (w.infection > 0.1) rate = 0;
    if (w.bleeding > 0.05) rate *= 0.3;
    w.severity = Math.max(0, w.severity - (rate * dtMinutes) / t.healMinutes);
  }
  body.wounds = body.wounds.filter((w) => w.severity > 0);

  // Consequences.
  let delta = 0;
  if (needs.hunger < 8) delta -= 1.5 * hours;
  if (needs.thirst < 8) delta -= 3 * hours;
  for (const w of body.wounds) if (w.infection > 0.3) delta -= w.infection * 2 * hours;
  const bleeding = body.wounds.some((w) => w.bleeding > 0.02);
  if (delta === 0 && !bleeding && wellFed && body.health < MAX_HEALTH) {
    delta += (asleep ? 3 + 2 * sleep : needs.energy > 25 ? 3 : 1.5) * hours;
  }
  body.health = clamp(body.health + delta, 0, MAX_HEALTH);

  const pain = totalPain(body, now);
  const stressTarget = clamp(
    pain * 0.6 + (needs.hunger < 25 ? 15 : 0) + (needs.thirst < 25 ? 15 : 0) + (needs.energy < 10 ? 10 : 0) - (asleep ? 12 * sleep : 0),
    0,
    100,
  );
  needs.stress += (stressTarget - needs.stress) * Math.min(1, hours * 0.5);
}

export interface TreatmentResult {
  ok: boolean;
  message: string;
}

/**
 * Applies a medical treatment. When `woundId` is omitted, the most urgent eligible wound is chosen.
 */
export function applyTreatment(
  body: BodyState,
  treatment: Treatment,
  quality: number,
  now: number,
  durationMinutes: number,
  woundId?: number,
): TreatmentResult {
  if (treatment === 'painkiller') {
    body.painkillerUntil = Math.max(body.painkillerUntil, now) + durationMinutes;
    return { ok: true, message: 'The pain dulls.' };
  }
  if (treatment === 'antibiotic') {
    body.antibioticsUntil = Math.max(body.antibioticsUntil, now) + durationMinutes;
    return { ok: true, message: 'You take the antibiotics.' };
  }
  const eligible = body.wounds.filter((w) => {
    if (woundId !== undefined && w.id !== woundId) return false;
    switch (treatment) {
      case 'bandage':
        return w.type !== 'bruise' && w.type !== 'fracture' && (w.bandage === 0 || w.dirty > 0.4 || quality > w.bandage);
      case 'disinfect':
        return !w.disinfected && w.contamination > 0;
      case 'suture':
        return !w.sutured && (w.type === 'deep_cut' || w.type === 'cut' || w.type === 'gunshot' || w.type === 'bite');
      case 'splint':
        return !w.splinted && w.type === 'fracture';
      default:
        return false;
    }
  });
  if (eligible.length === 0) {
    const noun: Record<string, string> = {
      bandage: 'nothing that needs a dressing',
      disinfect: 'no wound that needs cleaning',
      suture: 'no wound that needs stitches',
      splint: 'no fracture to splint',
    };
    return { ok: false, message: `You have ${noun[treatment] ?? 'nothing to treat'}.` };
  }
  // Most urgent first: bleeding, then contamination, then severity.
  eligible.sort((a, b) => b.bleeding - a.bleeding || b.contamination - a.contamination || b.severity - a.severity);
  const w = eligible[0];
  const where = BODY_PART_NAMES[w.part].toLowerCase();
  switch (treatment) {
    case 'bandage':
      w.bandage = quality;
      w.dirty = 0;
      return { ok: true, message: `You dress the ${WOUND_TEMPLATES[w.type].name.toLowerCase()} on your ${where}.` };
    case 'disinfect':
      w.disinfected = true;
      w.contamination = Math.max(0, w.contamination - 0.6 * quality);
      if (w.infection > 0) w.infection = Math.max(0, w.infection - 0.1 * quality);
      return { ok: true, message: `You clean the wound on your ${where}.` };
    case 'suture':
      w.sutured = true;
      w.bleeding *= 0.25;
      return { ok: true, message: `You stitch the wound on your ${where}.` };
    case 'splint':
      w.splinted = true;
      return { ok: true, message: `You splint your ${where}.` };
  }
  return { ok: false, message: 'Nothing happens.' };
}

// ---------------------------------------------------------------------------------------------
// Descriptive states (the UI avoids raw 0–100 numbers)

export function healthLabel(health: number): string {
  if (health >= 85) return 'Healthy';
  if (health >= 60) return 'Injured';
  if (health >= 35) return 'Badly Injured';
  if (health >= 15) return 'Critical';
  return 'Dying';
}

export function hungerLabel(hunger: number): string | null {
  if (hunger >= 70) return null;
  if (hunger >= 45) return 'Peckish';
  if (hunger >= 20) return 'Hungry';
  return 'Starving';
}

export function thirstLabel(thirst: number): string | null {
  if (thirst >= 70) return null;
  if (thirst >= 45) return 'Thirsty';
  if (thirst >= 20) return 'Very Thirsty';
  return 'Dehydrated';
}

export function energyLabel(energy: number): string | null {
  if (energy >= 45) return null;
  if (energy >= 20) return 'Tired';
  return 'Exhausted';
}

export function painLabel(pain: number): string | null {
  if (pain < 12) return null;
  if (pain < 35) return 'Minor Pain';
  if (pain < 65) return 'Pain';
  return 'Severe Pain';
}

export function stressLabel(stress: number): string | null {
  if (stress < 35) return null;
  if (stress < 65) return 'Anxious';
  return 'Panicked';
}

export function bleedingLabel(rate: number): string | null {
  if (rate < 0.02) return null;
  if (rate < 0.2) return 'Bleeding';
  if (rate < 0.5) return 'Bleeding Heavily';
  return 'Hemorrhaging';
}

export function woundSummary(w: Wound): { bleeding: string; contamination: string; healing: string } {
  const bleed = w.bleeding * (1 - w.bandage * 0.92);
  return {
    bleeding: bleed < 0.02 ? 'None' : bleed < 0.15 ? 'Light' : bleed < 0.35 ? 'Moderate' : 'Heavy',
    contamination: w.infection > 0.05 ? 'Infected' : w.contamination < 0.15 ? 'Low' : w.contamination < 0.5 ? 'Moderate' : 'High',
    healing: w.infection > 0.1 ? 'Stalled' : w.bandage > 0 && w.dirty < 0.75 ? (w.severity < 0.3 ? 'Nearly healed' : 'Good') : 'Poor',
  };
}
