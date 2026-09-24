// Positional stereo audio (design plan §87). Sounds are panned by their horizontal offset from the
// listener, attenuated with distance and low-pass filtered when far away, so a distant gunshot
// sounds like one — and a zombie can be heard before it is seen.

import { SAMPLE_RATE, synthesizeAll, type SoundId } from './synth';

export interface PlayOptions {
  x?: number;
  y?: number;
  volume?: number;
  /** Maximum audible distance in meters. */
  range?: number;
  rate?: number;
  /** Random pitch variation (fraction). */
  jitter?: number;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ambience: GainNode | null = null;
  private buffers = new Map<SoundId, AudioBuffer[]>();
  private listenerX = 0;
  private listenerY = 0;
  private windSource: AudioBufferSourceNode | null = null;
  private active = 0;
  volume = 0.8;
  ambienceVolume = 0.5;

  /** Must be called from a user gesture (browsers block audio until then). */
  start(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const compressor = this.ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.ratio.value = 4;
    this.master.connect(compressor).connect(this.ctx.destination);
    this.sfx = this.ctx.createGain();
    this.sfx.connect(this.master);
    this.ambience = this.ctx.createGain();
    this.ambience.gain.value = this.ambienceVolume * 0.35;
    this.ambience.connect(this.master);
    for (const [id, variants] of synthesizeAll()) {
      this.buffers.set(
        id,
        variants.map((data) => {
          const buf = this.ctx!.createBuffer(1, data.length, SAMPLE_RATE);
          buf.copyToChannel(data as Float32Array<ArrayBuffer>, 0);
          return buf;
        }),
      );
    }
    this.startWind();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setAmbienceVolume(v: number): void {
    this.ambienceVolume = v;
    if (this.ambience) this.ambience.gain.value = v * 0.35;
  }

  setListener(x: number, y: number): void {
    this.listenerX = x;
    this.listenerY = y;
  }

  private startWind(): void {
    const buf = this.buffers.get('wind')?.[0];
    if (!this.ctx || !buf || !this.ambience) return;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    src.connect(lp).connect(this.ambience);
    src.start();
    this.windSource = src;
  }

  play(id: SoundId, opts: PlayOptions = {}): void {
    const ctx = this.ctx;
    if (!ctx || !this.sfx || ctx.state !== 'running') return;
    const variants = this.buffers.get(id);
    if (!variants || variants.length === 0) return;
    if (this.active > 48) return;
    let gainValue = opts.volume ?? 1;
    let pan = 0;
    let cutoff = 20000;
    if (opts.x !== undefined && opts.y !== undefined) {
      const dx = opts.x - this.listenerX;
      const dy = opts.y - this.listenerY;
      const d = Math.hypot(dx, dy);
      const range = opts.range ?? 40;
      if (d > range) return;
      const t = d / range;
      gainValue *= Math.pow(1 - t, 1.6) * (1 / (1 + d * 0.04));
      pan = Math.max(-1, Math.min(1, dx / 18));
      cutoff = 18000 * Math.pow(1 - t, 2) + 500;
    }
    if (gainValue < 0.005) return;
    const src = ctx.createBufferSource();
    src.buffer = variants[Math.floor(Math.random() * variants.length)];
    const jitter = opts.jitter ?? 0.06;
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() * 2 - 1) * jitter);
    const gain = ctx.createGain();
    gain.gain.value = gainValue;
    let node: AudioNode = src;
    if (cutoff < 16000) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = cutoff;
      node.connect(lp);
      node = lp;
    }
    node.connect(gain);
    if (ctx.createStereoPanner) {
      const panner = ctx.createStereoPanner();
      panner.pan.value = pan;
      gain.connect(panner).connect(this.sfx);
    } else {
      gain.connect(this.sfx);
    }
    this.active++;
    src.onended = () => {
      this.active--;
      src.disconnect();
    };
    src.start();
  }

  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }
}
