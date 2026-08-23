import * as THREE from "three";

/**
 * Procedural audio: master → {music, sfx, ui} buses → limiter. Positional voices pan/attenuate by
 * distance from the listener (the camera). Everything is synthesized; there are no audio files.
 */

type Bus = "music" | "sfx" | "ui";
export type Caption = { text: string; kind: "sfx" | "voice" };

const MAX_ONESHOTS = 24;

export class Audio {
  ctx: AudioContext;
  private buses: Record<Bus, GainNode>;
  private master: GainNode;
  private listenerPos = new THREE.Vector3();
  private listenerFwd = new THREE.Vector3(0, 0, -1);
  private active = 0;
  engine: EngineVoice;
  music: Music;
  radio: Radio;
  onCaption: ((c: Caption) => void) | null = null;
  private wind: { gain: GainNode; filter: BiquadFilterNode } | null = null;
  private roll: { gain: GainNode; filter: BiquadFilterNode } | null = null;

  constructor(volumes: { master: number; music: number; sfx: number; ui: number }) {
    this.ctx = new AudioContext();
    const limiter = this.ctx.createDynamicsCompressor();
    limiter.threshold.value = -6; limiter.knee.value = 4; limiter.ratio.value = 12; limiter.attack.value = 0.003; limiter.release.value = 0.15;
    this.master = this.ctx.createGain();
    this.master.connect(limiter).connect(this.ctx.destination);
    this.buses = { music: this.ctx.createGain(), sfx: this.ctx.createGain(), ui: this.ctx.createGain() };
    for (const b of Object.values(this.buses)) b.connect(this.master);
    this.setVolumes(volumes);
    this.engine = new EngineVoice(this.ctx, this.buses.sfx);
    this.music = new Music(this.ctx, this.buses.music);
    this.radio = new Radio(this);
    this.buildAmbience();
  }

  setVolumes(v: { master: number; music: number; sfx: number; ui: number }) {
    this.master.gain.value = v.master;
    this.buses.music.gain.value = v.music * 0.6;
    this.buses.sfx.gain.value = v.sfx;
    this.buses.ui.gain.value = v.ui;
  }
  suspend() { void this.ctx.suspend(); }
  resume() { void this.ctx.resume(); }
  dispose() { this.music.stop(); void this.ctx.close(); }

  setListener(pos: THREE.Vector3, fwd: THREE.Vector3) { this.listenerPos.copy(pos); this.listenerFwd.copy(fwd); }

  /** Stereo pan + distance gain for a world position. */
  spatial(pos: THREE.Vector3, maxDist = 400): { pan: number; gain: number } {
    const rel = pos.clone().sub(this.listenerPos);
    const d = rel.length();
    const right = new THREE.Vector3(-this.listenerFwd.z, 0, this.listenerFwd.x);
    const pan = THREE.MathUtils.clamp(rel.dot(right) / Math.max(d, 1), -1, 1) * 0.8;
    const gain = THREE.MathUtils.clamp(1 - d / maxDist, 0, 1) ** 1.6;
    return { pan, gain };
  }

  private out(bus: Bus, vol: number, pan = 0): GainNode {
    const g = this.ctx.createGain(); g.gain.value = vol;
    if (pan !== 0 && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner(); p.pan.value = pan; g.connect(p).connect(this.buses[bus]);
    } else g.connect(this.buses[bus]);
    return g;
  }

  private take() { if (this.active >= MAX_ONESHOTS) return false; this.active++; return true; }
  private release(after: number) { setTimeout(() => { this.active--; }, after * 1000); }

  /** Pitch-swept oscillator one-shot. */
  tone(o: { type?: OscillatorType; f0: number; f1?: number; dur: number; vol: number; bus?: Bus; pan?: number; lp?: number; delay?: number }) {
    if (!this.take()) return;
    const t = this.ctx.currentTime + (o.delay ?? 0);
    const osc = this.ctx.createOscillator(); osc.type = o.type ?? "sine";
    osc.frequency.setValueAtTime(o.f0, t);
    if (o.f1) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t + o.dur * 0.8);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, t + 0.01); env.gain.exponentialRampToValueAtTime(0.001, t + o.dur);
    let node: AudioNode = osc.connect(env);
    if (o.lp) { const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = o.lp; node = node.connect(f); }
    node.connect(this.out(o.bus ?? "sfx", o.vol, o.pan ?? 0));
    osc.start(t); osc.stop(t + o.dur + 0.05);
    this.release(o.dur + (o.delay ?? 0));
  }

  /** Filtered noise burst with a decaying envelope. */
  noise(o: { dur: number; vol: number; lp?: number; hp?: number; bp?: number; q?: number; bus?: Bus; pan?: number; attack?: number; delay?: number }) {
    if (!this.take()) return;
    const t = this.ctx.currentTime + (o.delay ?? 0);
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * o.dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    let node: AudioNode = src;
    if (o.bp) { const f = this.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = o.bp; f.Q.value = o.q ?? 1; node = node.connect(f); }
    if (o.lp) { const f = this.ctx.createBiquadFilter(); f.type = "lowpass"; f.frequency.value = o.lp; node = node.connect(f); }
    if (o.hp) { const f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = o.hp; node = node.connect(f); }
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(0.0001, t); env.gain.exponentialRampToValueAtTime(1, t + (o.attack ?? 0.005)); env.gain.exponentialRampToValueAtTime(0.001, t + o.dur);
    node.connect(env).connect(this.out(o.bus ?? "sfx", o.vol, o.pan ?? 0));
    src.start(t); src.stop(t + o.dur + 0.02);
    this.release(o.dur + (o.delay ?? 0));
  }

  private caption(text: string, kind: Caption["kind"] = "sfx") { this.onCaption?.({ text, kind }); }

  // ---------- foley ----------
  chomp(kind: "fighter" | "escort" | "bomber" | "boss", combo: number) {
    const v = 0.6 + Math.random() * 0.2, pitch = 0.9 + Math.random() * 0.25;
    this.tone({ type: "square", f0: 1800 * pitch, f1: 300, dur: 0.05, vol: 0.25 }); // transient click
    if (kind === "bomber" || kind === "boss") {
      this.noise({ dur: 0.7, vol: v, bp: 700 * pitch, q: 0.6 }); this.noise({ dur: 0.5, vol: 0.5, lp: 300, delay: 0.05 });
      this.tone({ type: "sawtooth", f0: 110 * pitch, f1: 28, dur: 0.7, vol: 0.55 });
      if (kind === "boss") { this.noise({ dur: 1.4, vol: 0.5, bp: 2400, q: 0.3, attack: 0.2 }); this.noise({ dur: 2.0, vol: 0.4, hp: 4000, attack: 0.4, delay: 0.3 }); }
      this.caption(kind === "boss" ? "[fabric tearing — hiss]" : "[metallic CRUNCH]");
    } else {
      this.noise({ dur: 0.35, vol: v, bp: 1100 * pitch, q: 0.8 });
      this.tone({ type: "sine", f0: 170 * pitch, f1: 40, dur: 0.4, vol: 0.6 });
      this.caption("[CHOMP]");
    }
    // gulp + swallow
    this.tone({ type: "sine", f0: 90, f1: 220, dur: 0.25, vol: 0.3, delay: 0.25 });
    this.tone({ type: "triangle", f0: 260, f1: 120, dur: 0.2, vol: 0.2, delay: 0.45 });
    if (combo >= 3) setTimeout(() => this.burp(), 650);
  }
  burp() {
    const f = 70 + Math.random() * 30, dur = 0.45 + Math.random() * 0.3;
    this.tone({ type: "sawtooth", f0: f, f1: f * 0.7, dur, vol: 0.4, lp: 600 });
    this.noise({ dur, vol: 0.25, lp: 350 });
    this.caption("[BURP]");
  }
  bite() { this.noise({ dur: 0.25, vol: 0.4, bp: 1400, q: 1.2 }); this.tone({ type: "square", f0: 320, f1: 120, dur: 0.2, vol: 0.2 }); this.caption("[bite]"); }
  ow(pos: THREE.Vector3) { const s = this.spatial(pos); this.tone({ type: "square", f0: 700, f1: 1100, dur: 0.18, vol: 0.25 * s.gain, pan: s.pan, lp: 2000 }); this.caption("[enemy: OW!]", "voice"); }
  yelp(pos: THREE.Vector3) { const s = this.spatial(pos); this.tone({ type: "square", f0: 900, f1: 1500, dur: 0.14, vol: 0.18 * s.gain, pan: s.pan }); }
  lunge() { this.tone({ type: "triangle", f0: 200, f1: 900, dur: 0.3, vol: 0.25 }); this.noise({ dur: 0.3, vol: 0.2, hp: 2000 }); }
  thud(vol = 0.3) { this.noise({ dur: 0.3, vol, lp: 300 }); this.tone({ type: "sine", f0: 80, f1: 30, dur: 0.3, vol: vol * 0.8 }); }
  screech() { this.noise({ dur: 0.6, vol: 0.35, bp: 2600, q: 4 }); this.caption("[tyres screech]"); }
  splash(pos: THREE.Vector3) { const s = this.spatial(pos, 200); this.noise({ dur: 0.8, vol: 0.5 * s.gain, pan: s.pan, hp: 1500, attack: 0.03 }); this.caption("[splash]"); }
  crash(pos: THREE.Vector3) {
    const s = this.spatial(pos, 500);
    this.noise({ dur: 1.0, vol: 0.7 * s.gain, pan: s.pan, lp: 600, attack: 0.01 });
    this.tone({ type: "sine", f0: 70, f1: 25, dur: 0.8, vol: 0.6 * s.gain, pan: s.pan });
    this.noise({ dur: 0.5, vol: 0.3 * s.gain, pan: s.pan, bp: 3000, q: 0.5, delay: 0.1 });
    this.caption("[distant explosion]");
  }
  spark(pos: THREE.Vector3) { const s = this.spatial(pos, 80); this.noise({ dur: 0.12, vol: 0.3 * s.gain, pan: s.pan, hp: 5000 }); }
  gearClunk() { this.noise({ dur: 0.12, vol: 0.35, lp: 500 }); this.tone({ type: "square", f0: 120, f1: 80, dur: 0.12, vol: 0.2 }); this.caption("[gear clunk]"); }
  sputter() { this.noise({ dur: 0.08, vol: 0.3, lp: 500 }); this.tone({ type: "square", f0: 90, f1: 60, dur: 0.08, vol: 0.2 }); }
  heart() { this.tone({ type: "sine", f0: 70, f1: 45, dur: 0.18, vol: 0.5 }); }
  feathers(pos: THREE.Vector3) { const s = this.spatial(pos, 150); this.noise({ dur: 0.3, vol: 0.3 * s.gain, pan: s.pan, bp: 2200, q: 0.7 }); this.tone({ type: "square", f0: 1400, f1: 2200, dur: 0.1, vol: 0.1 * s.gain, pan: s.pan }); this.caption("[squawk]"); }

  // ---------- UI ----------
  hover() { this.tone({ type: "sine", f0: 900, f1: 1200, dur: 0.06, vol: 0.12, bus: "ui" }); }
  confirm() { this.tone({ type: "square", f0: 600, f1: 1200, dur: 0.12, vol: 0.15, bus: "ui", lp: 3000 }); this.tone({ type: "sine", f0: 1200, dur: 0.2, vol: 0.1, bus: "ui", delay: 0.08 }); }
  back() { this.tone({ type: "square", f0: 700, f1: 400, dur: 0.12, vol: 0.12, bus: "ui", lp: 2500 }); }
  tick() { this.tone({ type: "sine", f0: 700, dur: 0.1, vol: 0.25, bus: "ui" }); }
  go() { this.tone({ type: "sine", f0: 900, f1: 1300, dur: 0.4, vol: 0.3, bus: "ui" }); }
  fanfare() { [523, 659, 784, 1047].forEach((f, i) => this.tone({ type: "square", f0: f, dur: 0.25, vol: 0.15, bus: "ui", lp: 2500, delay: i * 0.09 })); this.caption("[objective fanfare]"); }
  horn() { this.tone({ type: "sawtooth", f0: 220, f1: 330, dur: 0.6, vol: 0.25, bus: "ui", lp: 1200 }); this.tone({ type: "sawtooth", f0: 330, f1: 440, dur: 0.6, vol: 0.2, bus: "ui", lp: 1200, delay: 0.3 }); this.caption("[wave horn]"); }
  medal() { [784, 988, 1175, 1568].forEach((f, i) => this.tone({ type: "triangle", f0: f, dur: 0.5, vol: 0.18, bus: "ui", delay: i * 0.12 })); }
  frenzy() { this.tone({ type: "sawtooth", f0: 200, f1: 800, dur: 0.5, vol: 0.3 }); this.tone({ type: "sawtooth", f0: 300, f1: 1200, dur: 0.7, vol: 0.25 }); this.noise({ dur: 0.6, vol: 0.2, hp: 2000 }); this.caption("[FEEDING FRENZY]"); }

  // ---------- continuous ambience ----------
  private buildAmbience() {
    const mk = (lp: number) => {
      const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * 2, this.ctx.sampleRate);
      const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource(); src.buffer = buf; src.loop = true;
      const filter = this.ctx.createBiquadFilter(); filter.type = "lowpass"; filter.frequency.value = lp;
      const gain = this.ctx.createGain(); gain.gain.value = 0;
      src.connect(filter).connect(gain).connect(this.buses.sfx); src.start();
      return { gain, filter };
    };
    this.wind = mk(800);
    this.roll = mk(200);
  }
  /** speed 0..1, bank 0..1, ground: null (airborne) | "runway" | "grass" | "water" */
  setFlight(speed: number, bank: number, ground: null | "runway" | "grass" | "water", stall: number) {
    if (!this.wind || !this.roll) return;
    const t = this.ctx.currentTime;
    this.wind.gain.gain.setTargetAtTime(Math.min(0.5, speed * speed * 0.45 + bank * 0.15 + stall * 0.3), t, 0.1);
    this.wind.filter.frequency.setTargetAtTime(400 + speed * 2500 + stall * 300, t, 0.1);
    const rolling = ground !== null && speed > 0.02;
    this.roll.gain.gain.setTargetAtTime(rolling ? (ground === "runway" ? 0.18 : 0.35) * Math.min(1, speed * 3) : 0, t, 0.08);
    this.roll.filter.frequency.setTargetAtTime(ground === "grass" ? 140 : ground === "water" ? 900 : 220, t, 0.1);
  }
}

/** Layered radial engine: RPM thump + harmonic saw + exhaust noise + LFO wobble, with boost whine. */
export class EngineVoice {
  private thump: OscillatorNode; private saw: OscillatorNode; private whine: OscillatorNode; private lfo: OscillatorNode;
  private thumpG: GainNode; private sawG: GainNode; private noiseG: GainNode; private whineG: GainNode;
  private noiseF: BiquadFilterNode; private sawF: BiquadFilterNode;
  private out: GainNode;
  private coughT = 0;

  constructor(private ctx: AudioContext, bus: GainNode) {
    this.out = ctx.createGain(); this.out.gain.value = 0; this.out.connect(bus);
    this.thump = ctx.createOscillator(); this.thump.type = "sine"; this.thumpG = ctx.createGain(); this.thump.connect(this.thumpG).connect(this.out);
    this.saw = ctx.createOscillator(); this.saw.type = "sawtooth"; this.sawF = ctx.createBiquadFilter(); this.sawF.type = "lowpass"; this.sawG = ctx.createGain();
    this.saw.connect(this.sawF).connect(this.sawG).connect(this.out);
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate); const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    this.noiseF = ctx.createBiquadFilter(); this.noiseF.type = "bandpass"; this.noiseF.Q.value = 0.7; this.noiseG = ctx.createGain();
    src.connect(this.noiseF).connect(this.noiseG).connect(this.out); src.start();
    this.whine = ctx.createOscillator(); this.whine.type = "triangle"; this.whineG = ctx.createGain(); this.whineG.gain.value = 0; this.whine.connect(this.whineG).connect(this.out);
    this.lfo = ctx.createOscillator(); this.lfo.frequency.value = 6; const lfoG = ctx.createGain(); lfoG.gain.value = 4; this.lfo.connect(lfoG).connect(this.saw.frequency);
    this.thump.start(); this.saw.start(); this.whine.start(); this.lfo.start();
  }

  /** rpm 0..1 (speed-ish), load 0..1 (throttle), boost 0..1, starving: cough layer */
  set(rpm: number, load: number, boost: number, starving: boolean, dt: number, sputter: () => void) {
    const t = this.ctx.currentTime;
    const hz = 18 + rpm * 42; // thump rate
    this.thump.frequency.setTargetAtTime(hz, t, 0.08);
    this.thumpG.gain.setTargetAtTime(0.25 + load * 0.15, t, 0.08);
    this.saw.frequency.setTargetAtTime(hz * 4, t, 0.08);
    this.sawF.frequency.setTargetAtTime(250 + load * 900 + boost * 800, t, 0.1);
    this.sawG.gain.setTargetAtTime(0.08 + load * 0.1, t, 0.08);
    this.noiseF.frequency.setTargetAtTime(300 + rpm * 700, t, 0.1);
    this.noiseG.gain.setTargetAtTime(0.04 + load * 0.12, t, 0.08);
    this.whine.frequency.setTargetAtTime(900 + rpm * 1400, t, 0.1);
    this.whineG.gain.setTargetAtTime(boost * 0.07 + (load > 0.8 ? 0.015 : 0), t, 0.15);
    this.lfo.frequency.setTargetAtTime(starving ? 2.5 : 6 + rpm * 4, t, 0.2);
    this.out.gain.setTargetAtTime(0.28 + load * 0.25, t, 0.1);
    if (starving) { this.coughT += dt; if (this.coughT > 0.45 + Math.random() * 0.3) { this.coughT = 0; sputter(); } }
  }
  silence() { this.out.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3); }
}

/** Positional engine drone for an enemy, with Doppler from radial velocity. */
export class EnemyVoice {
  private osc: OscillatorNode; private osc2: OscillatorNode; private gain: GainNode; private pan: StereoPannerNode | null; private filter: BiquadFilterNode;
  constructor(private ctx: AudioContext, bus: GainNode, private kind: "fighter" | "bomber" | "escort") {
    this.osc = ctx.createOscillator(); this.osc.type = kind === "bomber" ? "sawtooth" : "square";
    this.osc2 = ctx.createOscillator(); this.osc2.type = "sawtooth";
    this.filter = ctx.createBiquadFilter(); this.filter.type = "lowpass"; this.filter.frequency.value = kind === "bomber" ? 500 : 900;
    this.gain = ctx.createGain(); this.gain.gain.value = 0;
    this.pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const mix = ctx.createGain(); mix.gain.value = 0.5;
    this.osc.connect(mix); this.osc2.connect(mix); mix.connect(this.filter).connect(this.gain);
    if (this.pan) this.gain.connect(this.pan).connect(bus); else this.gain.connect(bus);
    this.osc.start(); this.osc2.start();
  }
  update(spatial: { pan: number; gain: number }, radialVel: number, scared: boolean) {
    const t = this.ctx.currentTime;
    const base = this.kind === "bomber" ? 55 : this.kind === "escort" ? 95 : 120;
    const doppler = 1 + THREE.MathUtils.clamp(-radialVel / 340, -0.25, 0.25) * 3;
    this.osc.frequency.setTargetAtTime(base * doppler * (scared ? 1.15 : 1), t, 0.08);
    this.osc2.frequency.setTargetAtTime(base * doppler * (this.kind === "escort" ? 1.51 : 2.02), t, 0.08);
    this.gain.gain.setTargetAtTime(spatial.gain * 0.12, t, 0.1);
    if (this.pan) this.pan.pan.setTargetAtTime(spatial.pan, t, 0.1);
  }
  dispose() { this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05); setTimeout(() => { this.osc.stop(); this.osc2.stop(); }, 200); }
}

// ---------- music ----------
type Mode = "off" | "title" | "play" | "boss";
const SCALE_MAJ = [0, 2, 4, 5, 7, 9, 11], SCALE_MIN = [0, 2, 3, 5, 7, 8, 10];
const midi = (n: number) => 440 * Math.pow(2, (n - 69) / 12);

/** Beat-synced procedural swing. Intensity 0..3 adds layers; mode switches key/tempo. */
export class Music {
  private mode: Mode = "off";
  intensity = 0;
  private bpm = 132;
  private nextNote = 0;
  private step = 0; // 8th notes
  private timer = 0;
  private out: GainNode;
  private pending: Array<() => void> = [];
  private bar = 0;

  constructor(private ctx: AudioContext, bus: GainNode) { this.out = ctx.createGain(); this.out.connect(bus); }

  play(mode: Mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.bpm = mode === "title" ? 108 : mode === "boss" ? 150 : 132;
    if (mode === "off") { this.stop(); return; }
    if (!this.timer) { this.nextNote = this.ctx.currentTime + 0.05; this.step = 0; this.timer = window.setInterval(() => this.schedule(), 80); }
  }
  stop() { if (this.timer) { clearInterval(this.timer); this.timer = 0; } this.mode = "off"; }
  /** Run fn on the next 8th note (for beat-synced stabs). */
  onNextEighth(fn: () => void) { this.pending.push(fn); }
  sting(good: boolean) {
    const root = 60; const notes = good ? [0, 4, 7, 12] : [0, 3, 6, 0];
    notes.forEach((n, i) => this.voice("square", midi(root + n), this.ctx.currentTime + i * 0.13, 0.5, 0.14, 1800));
  }

  private schedule() {
    const swing = 0.62; // shuffle: long-short 8ths
    const beat = 60 / this.bpm;
    while (this.nextNote < this.ctx.currentTime + 0.2) {
      this.tick(this.step, this.nextNote);
      const isLong = this.step % 2 === 0;
      this.nextNote += beat * (isLong ? swing : 1 - swing);
      this.step++;
      if (this.step % 16 === 0) this.bar++;
    }
  }

  private voice(type: OscillatorType, f: number, t: number, dur: number, vol: number, lp = 4000, f1?: number) {
    const o = this.ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    const fl = this.ctx.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = lp;
    o.connect(g).connect(fl).connect(this.out); o.start(t); o.stop(t + dur + 0.02);
  }
  private hat(t: number, vol: number, open = false) {
    const dur = open ? 0.25 : 0.05;
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * dur), this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource(); s.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "highpass"; f.frequency.value = open ? 5000 : 7000;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f).connect(g).connect(this.out); s.start(t);
  }
  private brush(t: number, vol: number) {
    const buf = this.ctx.createBuffer(1, Math.ceil(this.ctx.sampleRate * 0.12), this.ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = this.ctx.createBufferSource(); s.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 0.8;
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    s.connect(f).connect(g).connect(this.out); s.start(t);
  }

  private tick(step: number, t: number) {
    const minor = this.mode === "boss";
    const scale = minor ? SCALE_MIN : SCALE_MAJ;
    const root = this.mode === "title" ? 53 : minor ? 50 : 55; // F / D / G
    const chordProg = this.mode === "title" ? [0, 5, 3, 4] : minor ? [0, 0, 5, 6] : [0, 3, 4, 0]; // scale degrees per bar
    const deg = chordProg[this.bar % 4];
    const chord = [0, 2, 4].map((i) => root + scale[(deg + i) % 7] + 12 * Math.floor((deg + i) / 7));
    const s16 = step % 16, beatIdx = Math.floor(s16 / 2), off = s16 % 2;
    const level = this.mode === "title" ? 1 : this.intensity;

    // pending beat-synced stabs
    for (const fn of this.pending.splice(0)) fn();

    // walking bass on quarters (all levels)
    if (off === 0) {
      const walk = [0, 2, 4, 5][beatIdx % 4];
      const n = root - 12 + scale[(deg + walk) % 7];
      this.voice("triangle", midi(n), t, 0.32, 0.35, 900);
    }
    // brushed hats: swing 8ths
    this.hat(t, off === 0 ? 0.08 : 0.05);
    // snare brush on 2 and 4 (level ≥ 1)
    if (level >= 1 && off === 0 && (beatIdx === 1 || beatIdx === 3)) this.brush(t, 0.22);
    // comping chords on the "and" of 2 and 4 (level ≥ 1), title: soft pad
    if ((level >= 1 && off === 1 && (beatIdx === 1 || beatIdx === 3)) || (this.mode === "title" && s16 === 0)) {
      for (const n of chord) this.voice(this.mode === "title" ? "sine" : "square", midi(n), t, this.mode === "title" ? 1.6 : 0.18, this.mode === "title" ? 0.08 : 0.07, 1400);
    }
    // muted trumpet stabs (level ≥ 2): syncopated riff
    if (level >= 2 && [3, 6, 10, 11].includes(s16)) {
      const n = chord[(s16 * 7) % 3] + 12;
      this.voice("sawtooth", midi(n), t, 0.16, 0.12, 2200, midi(n) * 0.97);
    }
    // frenzy/boss lead (level ≥ 3): fast arpeggio on every 8th
    if (level >= 3) {
      const n = chord[s16 % 3] + 24 - (s16 % 4 === 3 ? 12 : 0);
      this.voice("square", midi(n), t, 0.1, 0.09, 3000);
      if (s16 % 4 === 0) this.hat(t, 0.12, true);
    }
    // boss: tom hits on 1 and the "and" of 3
    if (minor && (s16 === 0 || s16 === 5)) this.voice("sine", 110, t, 0.35, 0.45, 600, 60);
  }
}

/** "Pilot gibberish": pitched blips shaped by the subtitle's syllables, plus the subtitle itself. */
export class Radio {
  private busy = 0;
  constructor(private audio: Audio) {}
  say(who: "you" | "tower" | "enemy", text: string, onSubtitle: (who: string, text: string) => void) {
    const now = performance.now();
    if (now < this.busy) return;
    const syll = Math.max(2, Math.min(12, Math.round(text.replace(/[^a-z]/gi, "").length / 2.6)));
    const base = who === "you" ? 220 : who === "tower" ? 170 : 330;
    let t = 0;
    for (let i = 0; i < syll; i++) {
      const f = base * (0.85 + Math.random() * 0.5) * (i === syll - 1 ? (text.endsWith("?") ? 1.3 : 0.8) : 1);
      this.audio.tone({ type: "square", f0: f, f1: f * (0.9 + Math.random() * 0.2), dur: 0.07 + Math.random() * 0.05, vol: 0.09, lp: 1800, delay: t, bus: "ui" });
      t += 0.1 + Math.random() * 0.05;
    }
    // radio squelch on/off
    this.audio.noise({ dur: 0.04, vol: 0.08, hp: 3000, bus: "ui" });
    this.audio.noise({ dur: 0.04, vol: 0.08, hp: 3000, bus: "ui", delay: t });
    this.busy = now + t * 1000 + 400;
    onSubtitle(who, text);
  }
}
