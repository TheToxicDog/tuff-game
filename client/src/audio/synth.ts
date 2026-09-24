// Procedural sound synthesis. There are no audio assets yet, so every sound is generated from
// noise, oscillators and envelopes into AudioBuffers once at startup.

import { Rng } from '@tuff/shared';

export type SoundId =
  | 'shot_pistol'
  | 'shot_revolver'
  | 'shot_shotgun'
  | 'shot_rifle'
  | 'shot_carbine'
  | 'dry_fire'
  | 'reload_start'
  | 'reload_end'
  | 'shell_insert'
  | 'equip'
  | 'swing'
  | 'hit_flesh'
  | 'hit_blunt'
  | 'shove'
  | 'zombie_groan'
  | 'zombie_alert'
  | 'zombie_attack'
  | 'zombie_death'
  | 'body_fall'
  | 'door_open'
  | 'door_close'
  | 'door_bang'
  | 'door_break'
  | 'door_locked'
  | 'window_break'
  | 'step_soft'
  | 'step_hard'
  | 'step_wood'
  | 'glass_step'
  | 'search'
  | 'eat'
  | 'drink'
  | 'bandage'
  | 'pickup'
  | 'player_hurt'
  | 'player_death'
  | 'ui_click'
  | 'ui_error'
  | 'wind'
  | 'hammer'
  | 'board_break'
  | 'sizzle'
  | 'fire';

const RATE = 44100;

interface Builder {
  data: Float32Array;
  rng: Rng;
}

function buffer(seconds: number, seed: number): Builder {
  return { data: new Float32Array(Math.ceil(seconds * RATE)), rng: new Rng(seed) };
}

/** Adds filtered noise with an exponential decay envelope. */
function noiseBurst(b: Builder, start: number, dur: number, amp: number, decay: number, lowpass: number, highpass = 0): void {
  const s0 = Math.floor(start * RATE);
  const n = Math.floor(dur * RATE);
  let lp = 0;
  let hpPrev = 0;
  let hpOut = 0;
  const a = Math.min(1, (2 * Math.PI * lowpass) / RATE);
  const hpA = highpass > 0 ? RATE / (RATE + 2 * Math.PI * highpass) : 0;
  for (let i = 0; i < n && s0 + i < b.data.length; i++) {
    const t = i / RATE;
    const white = b.rng.next() * 2 - 1;
    lp += a * (white - lp);
    let v = lp;
    if (highpass > 0) {
      hpOut = hpA * (hpOut + v - hpPrev);
      hpPrev = v;
      v = hpOut;
    }
    b.data[s0 + i] += v * amp * Math.exp(-t * decay);
  }
}

function tone(
  b: Builder,
  start: number,
  dur: number,
  freq: number,
  amp: number,
  decay: number,
  sweep = 0,
  shape: 'sine' | 'saw' | 'square' = 'sine',
  vibrato = 0,
): void {
  const s0 = Math.floor(start * RATE);
  const n = Math.floor(dur * RATE);
  let phase = 0;
  for (let i = 0; i < n && s0 + i < b.data.length; i++) {
    const t = i / RATE;
    const f = Math.max(10, freq + sweep * t + (vibrato ? Math.sin(t * 2 * Math.PI * 5.5) * vibrato : 0));
    phase += (2 * Math.PI * f) / RATE;
    let v: number;
    if (shape === 'sine') v = Math.sin(phase);
    else if (shape === 'saw') v = ((phase / Math.PI) % 2) - 1;
    else v = Math.sin(phase) > 0 ? 1 : -1;
    const attack = Math.min(1, t / 0.005);
    b.data[s0 + i] += v * amp * attack * Math.exp(-t * decay);
  }
}

function normalize(b: Builder, peak = 0.9): Float32Array {
  let max = 0;
  for (const v of b.data) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < b.data.length; i++) b.data[i] = (b.data[i] / max) * peak;
  // Short fade-out to avoid clicks.
  const fade = Math.min(b.data.length, 200);
  for (let i = 0; i < fade; i++) b.data[b.data.length - 1 - i] *= i / fade;
  return b.data;
}

function gunshot(seed: number, body: number, crack: number, tail: number, boom: number): Float32Array {
  const b = buffer(tail + 0.2, seed);
  noiseBurst(b, 0, 0.02, 1.0, 60, 9000);
  noiseBurst(b, 0, 0.12, crack, 30, 5000, 300);
  noiseBurst(b, 0, tail, body, 7, 1400);
  tone(b, 0, 0.25, boom, 0.9, 16, -120);
  noiseBurst(b, 0.04, tail, body * 0.3, 4, 600);
  return normalize(b, 0.95);
}

function groan(seed: number): Float32Array {
  const rng = new Rng(seed);
  const dur = rng.range(0.9, 1.6);
  const b = buffer(dur, seed);
  const base = rng.range(70, 110);
  tone(b, 0, dur, base, 0.5, 1.2, rng.range(-25, 15), 'saw', rng.range(3, 9));
  tone(b, 0, dur, base * 2.02, 0.2, 1.5, rng.range(-20, 20), 'saw', 4);
  noiseBurst(b, 0, dur, 0.25, 1.5, 700, 120);
  // Formant-ish amplitude wobble.
  for (let i = 0; i < b.data.length; i++) {
    const t = i / RATE;
    const env = Math.sin(Math.min(1, t / dur) * Math.PI);
    b.data[i] *= env * (0.7 + 0.3 * Math.sin(t * 2 * Math.PI * rng.range(2, 4)));
  }
  return normalize(b, 0.7);
}

function footstep(seed: number, lowpass: number, dur: number, knock: number): Float32Array {
  const b = buffer(dur + 0.05, seed);
  noiseBurst(b, 0, dur, 1, 40, lowpass, 80);
  if (knock) tone(b, 0, 0.05, knock, 0.4, 60);
  return normalize(b, 0.5);
}

export function synthesizeAll(): Map<SoundId, Float32Array[]> {
  const out = new Map<SoundId, Float32Array[]>();
  const add = (id: SoundId, ...variants: Float32Array[]) => out.set(id, variants);

  add('shot_pistol', gunshot(1, 0.8, 0.6, 0.45, 110), gunshot(2, 0.8, 0.6, 0.45, 115));
  add('shot_revolver', gunshot(3, 1.0, 0.5, 0.6, 90));
  add('shot_shotgun', gunshot(4, 1.2, 0.4, 0.9, 60), gunshot(5, 1.2, 0.4, 0.9, 65));
  add('shot_rifle', gunshot(6, 1.1, 0.9, 1.1, 70));
  add('shot_carbine', gunshot(7, 0.9, 0.9, 0.7, 95), gunshot(8, 0.9, 0.9, 0.7, 100));
  {
    const b = buffer(0.06, 10);
    noiseBurst(b, 0, 0.02, 1, 200, 7000, 2000);
    tone(b, 0, 0.03, 1800, 0.3, 150);
    add('dry_fire', normalize(b, 0.5));
  }
  {
    const b = buffer(0.25, 11);
    noiseBurst(b, 0, 0.03, 1, 120, 6000, 800);
    noiseBurst(b, 0.12, 0.04, 0.7, 100, 5000, 600);
    add('reload_start', normalize(b, 0.5));
  }
  {
    const b = buffer(0.3, 12);
    noiseBurst(b, 0, 0.03, 1, 120, 7000, 1000);
    tone(b, 0, 0.04, 900, 0.4, 90);
    noiseBurst(b, 0.14, 0.04, 1, 110, 6000, 900);
    add('reload_end', normalize(b, 0.55));
  }
  {
    const b = buffer(0.12, 13);
    noiseBurst(b, 0, 0.05, 1, 80, 4500, 500);
    tone(b, 0, 0.04, 650, 0.3, 80);
    add('shell_insert', normalize(b, 0.45));
  }
  {
    const b = buffer(0.2, 14);
    noiseBurst(b, 0, 0.08, 0.7, 60, 3000, 400);
    noiseBurst(b, 0.08, 0.05, 0.5, 90, 5000, 800);
    add('equip', normalize(b, 0.35));
  }
  {
    const b = buffer(0.25, 15);
    const s0 = 0;
    for (let i = 0; i < b.data.length; i++) {
      const t = i / RATE;
      const env = Math.sin(Math.min(1, t / 0.22) * Math.PI);
      b.data[s0 + i] = (b.rng.next() * 2 - 1) * env * 0.6;
    }
    // Sweep a crude low-pass to make a whoosh.
    let lp = 0;
    for (let i = 0; i < b.data.length; i++) {
      const t = i / RATE;
      const cutoff = 400 + 3000 * Math.sin(Math.min(1, t / 0.22) * Math.PI);
      const a = Math.min(1, (2 * Math.PI * cutoff) / RATE);
      lp += a * (b.data[i] - lp);
      b.data[i] = lp;
    }
    add('swing', normalize(b, 0.4));
  }
  {
    const b = buffer(0.3, 16);
    tone(b, 0, 0.18, 90, 1, 25, -40);
    noiseBurst(b, 0, 0.15, 0.8, 30, 1800, 100);
    noiseBurst(b, 0.02, 0.12, 0.3, 40, 900);
    add('hit_flesh', normalize(b, 0.8));
  }
  {
    const b = buffer(0.25, 17);
    tone(b, 0, 0.12, 140, 0.9, 30, -60);
    noiseBurst(b, 0, 0.1, 0.9, 45, 3000, 200);
    add('hit_blunt', normalize(b, 0.75));
  }
  {
    const b = buffer(0.25, 18);
    noiseBurst(b, 0, 0.15, 0.8, 25, 1200, 80);
    tone(b, 0, 0.1, 110, 0.5, 30);
    add('shove', normalize(b, 0.6));
  }
  add('zombie_groan', groan(20), groan(21), groan(22), groan(23), groan(24));
  {
    const variants: Float32Array[] = [];
    for (let v = 0; v < 2; v++) {
      const b = buffer(0.8, 30 + v);
      tone(b, 0, 0.8, 140 + v * 20, 0.6, 3, -60, 'saw', 12);
      noiseBurst(b, 0, 0.7, 0.5, 4, 1600, 200);
      variants.push(normalize(b, 0.8));
    }
    add('zombie_alert', ...variants);
  }
  {
    const b = buffer(0.5, 32);
    tone(b, 0, 0.5, 180, 0.6, 5, -80, 'saw', 15);
    noiseBurst(b, 0, 0.45, 0.7, 6, 2400, 300);
    add('zombie_attack', normalize(b, 0.8));
  }
  {
    const b = buffer(0.9, 33);
    tone(b, 0, 0.9, 110, 0.6, 3, -60, 'saw', 6);
    noiseBurst(b, 0, 0.8, 0.4, 3, 900, 100);
    add('zombie_death', normalize(b, 0.7));
  }
  {
    const b = buffer(0.5, 34);
    tone(b, 0, 0.3, 60, 1, 14, -20);
    noiseBurst(b, 0, 0.3, 0.8, 18, 800);
    add('body_fall', normalize(b, 0.7));
  }
  {
    const b = buffer(0.5, 35);
    tone(b, 0, 0.4, 420, 0.25, 6, 250, 'saw', 20);
    noiseBurst(b, 0, 0.35, 0.3, 8, 2500, 400);
    noiseBurst(b, 0.3, 0.05, 0.6, 60, 2000);
    add('door_open', normalize(b, 0.45));
  }
  {
    const b = buffer(0.35, 36);
    tone(b, 0, 0.2, 90, 1, 20, -30);
    noiseBurst(b, 0, 0.15, 1, 30, 1500, 60);
    add('door_close', normalize(b, 0.6));
  }
  {
    const b = buffer(0.4, 37);
    tone(b, 0, 0.3, 70, 1, 14, -20);
    noiseBurst(b, 0, 0.25, 1, 18, 1100, 50);
    noiseBurst(b, 0.01, 0.2, 0.4, 25, 3500, 800);
    add('door_bang', normalize(b, 0.85));
  }
  {
    const b = buffer(1.0, 38);
    tone(b, 0, 0.4, 60, 1, 10, -20);
    noiseBurst(b, 0, 0.6, 1, 8, 2500, 80);
    for (let i = 0; i < 14; i++) noiseBurst(b, b.rng.range(0.05, 0.6), 0.05, 0.4, 60, 3000, 300);
    add('door_break', normalize(b, 0.9));
  }
  {
    const b = buffer(0.3, 39);
    for (let i = 0; i < 4; i++) noiseBurst(b, i * 0.06, 0.04, 0.8, 90, 5000, 900);
    add('door_locked', normalize(b, 0.4));
  }
  {
    const b = buffer(1.0, 40);
    noiseBurst(b, 0, 0.08, 1, 40, 12000, 2000);
    for (let i = 0; i < 40; i++) {
      const t = b.rng.range(0.02, 0.8);
      tone(b, t, 0.05, b.rng.range(2500, 7000), 0.25, 80);
      noiseBurst(b, t, 0.03, 0.3, 120, 12000, 3000);
    }
    add('window_break', normalize(b, 0.9));
  }
  add('step_soft', footstep(41, 900, 0.07, 0), footstep(42, 800, 0.07, 0), footstep(43, 1000, 0.06, 0));
  add('step_hard', footstep(44, 3500, 0.05, 180), footstep(45, 3000, 0.05, 160), footstep(46, 3800, 0.05, 200));
  add('step_wood', footstep(47, 1800, 0.06, 130), footstep(48, 1600, 0.06, 120));
  {
    const b = buffer(0.2, 49);
    for (let i = 0; i < 6; i++) tone(b, b.rng.range(0, 0.08), 0.04, b.rng.range(3000, 6000), 0.2, 100);
    noiseBurst(b, 0, 0.06, 0.5, 60, 6000, 1500);
    add('glass_step', normalize(b, 0.4));
  }
  {
    const b = buffer(0.6, 50);
    for (let i = 0; i < 9; i++) noiseBurst(b, b.rng.range(0, 0.45), 0.08, b.rng.range(0.3, 0.8), 30, 3500, 300);
    add('search', normalize(b, 0.4));
  }
  {
    const b = buffer(0.5, 51);
    for (let i = 0; i < 4; i++) noiseBurst(b, i * 0.11, 0.06, 0.8, 50, 2500, 200);
    add('eat', normalize(b, 0.45));
  }
  {
    const b = buffer(0.6, 52);
    for (let i = 0; i < 3; i++) tone(b, i * 0.17, 0.12, 180 - i * 15, 0.7, 20, -120);
    add('drink', normalize(b, 0.45));
  }
  {
    const b = buffer(0.5, 53);
    noiseBurst(b, 0, 0.35, 0.8, 5, 6000, 1500);
    add('bandage', normalize(b, 0.4));
  }
  {
    const b = buffer(0.2, 54);
    noiseBurst(b, 0, 0.1, 0.6, 40, 2500, 300);
    tone(b, 0.02, 0.08, 520, 0.2, 50);
    add('pickup', normalize(b, 0.35));
  }
  {
    const b = buffer(0.5, 55);
    tone(b, 0, 0.35, 220, 0.6, 8, -140, 'saw', 20);
    noiseBurst(b, 0, 0.3, 0.6, 12, 2000, 200);
    add('player_hurt', normalize(b, 0.7));
  }
  {
    const b = buffer(1.6, 56);
    tone(b, 0, 1.4, 160, 0.6, 2, -90, 'saw', 8);
    noiseBurst(b, 0, 1.2, 0.3, 2, 900);
    add('player_death', normalize(b, 0.7));
  }
  {
    const b = buffer(0.05, 57);
    tone(b, 0, 0.04, 1200, 0.5, 80);
    add('ui_click', normalize(b, 0.25));
  }
  {
    const b = buffer(0.15, 58);
    tone(b, 0, 0.12, 180, 0.5, 20, 0, 'square');
    add('ui_error', normalize(b, 0.25));
  }
  {
    // Three hammer blows on wood.
    const b = buffer(0.9, 60);
    for (let i = 0; i < 3; i++) {
      tone(b, i * 0.27, 0.08, 320 + i * 12, 0.8, 45, -200);
      noiseBurst(b, i * 0.27, 0.07, 1, 55, 4200, 400);
    }
    add('hammer', normalize(b, 0.7));
  }
  {
    // Splintering plank.
    const b = buffer(0.7, 61);
    tone(b, 0, 0.18, 150, 0.8, 18, -80);
    noiseBurst(b, 0, 0.35, 1, 10, 3200, 150);
    for (let i = 0; i < 10; i++) noiseBurst(b, b.rng.range(0.02, 0.4), 0.04, 0.5, 70, 5000, 900);
    add('board_break', normalize(b, 0.85));
  }
  {
    // Frying: crackly high-passed noise.
    const b = buffer(1.4, 62);
    noiseBurst(b, 0, 1.4, 0.5, 1.2, 9000, 2500);
    for (let i = 0; i < 40; i++) noiseBurst(b, b.rng.range(0, 1.3), 0.01, b.rng.range(0.3, 0.9), 300, 12000, 3000);
    add('sizzle', normalize(b, 0.4));
  }
  {
    // A fire catching: whoosh and crackle.
    const b = buffer(1.2, 63);
    noiseBurst(b, 0, 0.6, 0.8, 4, 900, 60);
    for (let i = 0; i < 18; i++) noiseBurst(b, b.rng.range(0.1, 1.1), 0.015, b.rng.range(0.4, 1), 200, 7000, 1500);
    add('fire', normalize(b, 0.55));
  }
  {
    // Seamless-ish wind loop: brown noise with slow swells.
    const dur = 8;
    const b = buffer(dur, 59);
    let brown = 0;
    for (let i = 0; i < b.data.length; i++) {
      brown = (brown + (b.rng.next() * 2 - 1) * 0.02) * 0.998;
      const t = i / RATE;
      const swell = 0.6 + 0.4 * Math.sin((t / dur) * Math.PI * 2 * 2) * Math.sin((t / dur) * Math.PI * 2 * 3 + 1);
      b.data[i] = brown * swell;
    }
    // Crossfade the ends so the loop does not click.
    const fade = RATE / 2;
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      b.data[i] = b.data[i] * k + b.data[b.data.length - fade + i] * (1 - k);
    }
    add('wind', normalize(b, 0.6).subarray(0, b.data.length - fade));
  }
  return out;
}

export const SAMPLE_RATE = RATE;
