// Tiny synthesized sound effects (no audio files): chops, clinks, coins, anvil rings.

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = true;
  volume = 0.5;
  listenerX = 0;
  listenerY = 0;

  start(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch {
      this.ctx = null;
    }
  }

  private gainAt(x?: number, y?: number): number {
    if (x === undefined || y === undefined) return 1;
    const d = Math.hypot(x - this.listenerX, y - this.listenerY);
    return Math.max(0, 1 - d / 26);
  }

  private tone(freq: number, dur: number, type: OscillatorType, gain: number, delay = 0, slide = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, filter: number, gain: number, type: BiquadFilterType = 'lowpass', delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = filter;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.02);
  }

  play(name: string, x?: number, y?: number): void {
    if (!this.enabled || !this.ctx || !this.master) return;
    const v = this.gainAt(x, y);
    if (v <= 0.02) return;
    switch (name) {
      case 'wood':
        this.burst(0.12, 900, 0.5 * v);
        this.tone(140, 0.08, 'triangle', 0.25 * v);
        break;
      case 'stone':
        this.burst(0.08, 3500, 0.35 * v, 'highpass');
        this.tone(900, 0.05, 'square', 0.06 * v);
        break;
      case 'plant':
        this.burst(0.1, 2500, 0.25 * v, 'bandpass');
        break;
      case 'dirt':
        this.burst(0.12, 600, 0.35 * v);
        break;
      case 'flesh':
        this.burst(0.09, 400, 0.5 * v);
        this.tone(90, 0.1, 'sine', 0.3 * v);
        break;
      case 'swing':
        this.burst(0.09, 1800, 0.12 * v, 'bandpass');
        break;
      case 'coins':
        this.tone(1320, 0.12, 'sine', 0.16, 0);
        this.tone(1760, 0.18, 'sine', 0.14, 0.07);
        this.tone(2640, 0.2, 'sine', 0.08, 0.13);
        break;
      case 'craft':
        this.tone(520, 0.06, 'triangle', 0.18);
        this.tone(780, 0.08, 'triangle', 0.14, 0.05);
        break;
      case 'build':
        this.tone(110, 0.14, 'triangle', 0.4 * v, 0, 0.6);
        this.burst(0.08, 700, 0.3 * v);
        break;
      case 'anvil':
        this.tone(1180, 0.5, 'sine', 0.2 * v);
        this.tone(2360, 0.35, 'sine', 0.08 * v);
        this.tone(3150, 0.25, 'sine', 0.05 * v);
        this.burst(0.05, 5000, 0.2 * v, 'highpass');
        break;
      case 'miss':
        this.tone(220, 0.15, 'triangle', 0.15, 0, 0.6);
        break;
      case 'pickup':
        this.tone(660, 0.07, 'sine', 0.12);
        this.tone(990, 0.08, 'sine', 0.1, 0.05);
        break;
      case 'eat':
        this.burst(0.06, 1200, 0.25);
        this.burst(0.06, 1000, 0.2, 'lowpass', 0.09);
        break;
      case 'door':
        this.tone(180, 0.2, 'sawtooth', 0.06 * v, 0, 1.4);
        break;
      case 'research':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, i * 0.08));
        break;
      case 'bow':
        this.tone(320, 0.18, 'triangle', 0.2 * v, 0, 0.5);
        break;
      case 'hurt':
        this.tone(160, 0.2, 'sawtooth', 0.15, 0, 0.5);
        break;
      case 'die':
        this.tone(200, 0.6, 'sawtooth', 0.15 * v, 0, 0.3);
        break;
      case 'notice':
        this.tone(880, 0.08, 'sine', 0.06);
        break;
    }
  }
}
