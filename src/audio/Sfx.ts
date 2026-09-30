import type * as THREE from 'three';
import { CONFIG, type WeaponStats } from '../config';
import type { EventBus } from '../core/EventBus';
import type { GameEvents } from '../core/events';
import type { Actor } from '../entities/Actor';

const A = CONFIG.audio;
const MAX_VOICES = 40;

type Pos = THREE.Vector3 | null;

/**
 * Every sound is synthesised on the fly with Web Audio (noise bursts,
 * filtered envelopes, oscillators). Positional sounds use PannerNodes and
 * get muffled with distance; the local player's own sounds are not panned.
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private voices = 0;
  private volume: number;

  constructor(events: EventBus<GameEvents>, private readonly local: () => Actor | null, volume: number) {
    this.volume = volume;
    events.on('shot', (e) => this.gunshot(e.weapon, e.shooter));
    events.on('impact', (e) => this.impact(e.point, e.surface));
    events.on('damage', (e) => {
      const me = this.local();
      if (e.attacker === me && e.victim !== me && e.source !== 'bomb') {
        if (e.zone === 'head') this.dink();
        else this.tone(1300, 0.05, 0.12, 'triangle');
      }
      if (e.victim === me) this.hurt();
      else if (e.source !== 'bomb') this.thud(e.victim.pos, 0.5);
    });
    events.on('kill', (e) => {
      if (e.killer === this.local() && e.victim !== e.killer) {
        this.tone(880, 0.08, 0.14, 'sine');
        this.tone(1320, 0.12, 0.12, 'sine', 0.07);
      }
    });
    events.on('reload', (e) => this.reload(e.actor, e.actor.weapon.stats.reloadTime));
    events.on('dryFire', (e) => this.click(this.posOf(e.actor), 2400, 0.25));
    events.on('weaponSwitch', (e) => {
      if (e.actor === this.local()) this.click(null, 1600, 0.25);
    });
    events.on('scope', (e) => {
      if (e.actor === this.local()) this.click(null, e.scoped ? 900 : 700, 0.3);
    });
    events.on('melee', (e) => this.swish(this.posOf(e.actor)));
    events.on('footstep', (e) => this.footstep(e.actor));
    events.on('land', (e) => this.thud(this.posOf(e.actor), Math.min(1, e.speed / 8) * 0.6));
    events.on('bombBeep', (e) => this.beep(e.pos, 1450 + e.urgency * 250));
    events.on('plantStart', (e) => this.keypad(this.posOf(e.actor)));
    events.on('defuseStart', (e) => this.keypad(this.posOf(e.actor), 0.6));
    events.on('bombPlanted', () => {
      this.tone(620, 0.25, 0.25, 'square');
      this.tone(470, 0.35, 0.25, 'square', 0.28);
    });
    events.on('bombDefused', () => this.chord([523, 659, 784], 0.6, 0.18));
    events.on('bombExploded', (e) => this.explosion(e.pos));
    events.on('roundPhase', (e) => {
      if (e.phase === 'live') this.tone(740, 0.12, 0.16, 'square');
    });
    events.on('roundEnd', (e) => {
      const me = this.local();
      if (!me) return;
      if (e.winner === me.team) this.chord([523, 659, 784, 1046], 0.9, 0.12, 0.25);
      else this.chord([440, 523, 622], 0.9, 0.12, 0.25);
    });
    events.on('purchase', (e) => {
      if (e.actor === this.local()) this.tone(1500, 0.05, 0.12, 'triangle');
    });
    events.on('bombPickup', (e) => {
      if (e.actor === this.local()) this.tone(990, 0.08, 0.15, 'triangle');
    });
  }

  /** must be called from a user gesture (browser autoplay policy) */
  unlock(): void {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -10;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setVolume(v: number): void {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
  }

  /** place the listener at the camera */
  updateListener(camera: THREE.Camera, fwd: THREE.Vector3): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    const p = camera.position;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(p.x, t);
      l.positionY.setValueAtTime(p.y, t);
      l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(fwd.x, t);
      l.forwardY.setValueAtTime(fwd.y, t);
      l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      const legacy = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(a: number, b: number, c: number, d: number, e: number, f: number): void };
      legacy.setPosition(p.x, p.y, p.z);
      legacy.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
    this.listenerPos.x = p.x;
    this.listenerPos.y = p.y;
    this.listenerPos.z = p.z;
  }

  private readonly listenerPos = { x: 0, y: 0, z: 0 };

  // ─── building blocks ─────────────────────────────────────────────

  private posOf(a: Actor): Pos {
    return a === this.local() ? null : a.pos;
  }

  /** output chain: optional panner + distance muffling → master. Returns the input node or null if culled. */
  private out(pos: Pos, gain: number, maxDist: number = A.maxDistance): { input: GainNode } | null {
    const ctx = this.ctx;
    if (!ctx || !this.master) return null;
    if ((this.voices >= MAX_VOICES && pos) || this.voices >= MAX_VOICES * 2) return null;
    let dist = 0;
    if (pos) {
      const L = this.listenerPos;
      dist = Math.hypot(pos.x - L.x, pos.y + 1 - L.y, pos.z - L.z);
      if (dist > maxDist) return null;
    }
    const input = ctx.createGain();
    input.gain.value = gain;
    let node: AudioNode = input;
    if (pos) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 18000 / (1 + dist / 12);
      const pan = ctx.createPanner();
      pan.panningModel = 'equalpower';
      pan.distanceModel = 'inverse';
      pan.refDistance = A.refDistance;
      pan.maxDistance = maxDist;
      pan.rolloffFactor = 1.1;
      pan.positionX.value = pos.x;
      pan.positionY.value = pos.y + 1.2;
      pan.positionZ.value = pos.z;
      node.connect(lp);
      lp.connect(pan);
      node = pan;
    }
    node.connect(this.master);
    this.voices++;
    return { input };
  }

  private release(seconds: number): void {
    window.setTimeout(() => {
      this.voices = Math.max(0, this.voices - 1);
    }, seconds * 1000 + 50);
  }

  /** filtered noise burst with exponential decay */
  private noiseBurst(
    pos: Pos, gain: number, decay: number, type: BiquadFilterType, freq: number, q = 0.7,
    delay = 0, freqEnd?: number, attack = 0.002,
  ): void {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return;
    const o = this.out(pos, 1);
    if (!o) return;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + decay);
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    src.connect(f).connect(env).connect(o.input);
    src.start(t, Math.random() * 0.5);
    src.stop(t + decay + 0.05);
    this.release(delay + decay);
  }

  private osc(pos: Pos, type: OscillatorType, f0: number, f1: number, gain: number, decay: number, delay = 0): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = this.out(pos, 1);
    if (!o) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + decay);
    osc.connect(env).connect(o.input);
    osc.start(t);
    osc.stop(t + decay + 0.05);
    this.release(delay + decay);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType, delay = 0): void {
    this.osc(null, type, freq, freq, gain, dur, delay);
  }

  private chord(freqs: number[], dur: number, gain: number, spread = 0): void {
    freqs.forEach((f, i) => this.tone(f, dur, gain, 'triangle', i * spread * 0.25));
  }

  // ─── game sounds ─────────────────────────────────────────────────

  private gunshot(w: WeaponStats, shooter: Actor): void {
    const pos = this.posOf(shooter);
    switch (w.sound) {
      case 'pistol':
        this.noiseBurst(pos, 0.9, 0.14, 'bandpass', 1900, 0.9);
        this.osc(pos, 'sine', 170, 55, 0.7, 0.09);
        this.noiseBurst(pos, 0.25, 0.35, 'lowpass', 900, 0.5, 0.02);
        break;
      case 'rifle':
        this.noiseBurst(pos, 1.0, 0.16, 'lowpass', 3200, 0.8);
        this.noiseBurst(pos, 0.5, 0.04, 'highpass', 4000, 0.7);
        this.osc(pos, 'sine', 120, 45, 0.9, 0.12);
        this.noiseBurst(pos, 0.25, 0.45, 'lowpass', 700, 0.5, 0.03);
        break;
      case 'sniper':
        this.noiseBurst(pos, 1.2, 0.3, 'lowpass', 2600, 0.9);
        this.noiseBurst(pos, 0.6, 0.05, 'highpass', 3500, 0.7);
        this.osc(pos, 'sine', 90, 30, 1.2, 0.3);
        this.noiseBurst(pos, 0.4, 1.1, 'lowpass', 500, 0.5, 0.05);
        // bolt cycle
        this.click(pos, 1100, 0.3, 0.55);
        this.click(pos, 1500, 0.3, 0.8);
        break;
      case 'knife':
        break;
    }
  }

  private impact(p: THREE.Vector3, surface: string): void {
    if (surface === 'metal') {
      this.osc(p, 'sine', 2600 + Math.random() * 900, 1800, 0.18, 0.18);
      this.noiseBurst(p, 0.25, 0.05, 'highpass', 3000);
    } else if (surface === 'crate') {
      this.noiseBurst(p, 0.4, 0.07, 'bandpass', 700, 1.2);
    } else {
      this.noiseBurst(p, 0.35, 0.06, 'bandpass', 1400, 1);
    }
  }

  private dink(): void {
    this.osc(null, 'sine', 2300, 2250, 0.25, 0.25);
    this.osc(null, 'sine', 3450, 3400, 0.12, 0.2);
  }

  private hurt(): void {
    this.noiseBurst(null, 0.6, 0.12, 'lowpass', 500);
    this.osc(null, 'sine', 90, 50, 0.4, 0.15);
  }

  private thud(pos: Pos, gain: number): void {
    if (gain <= 0.02) return;
    this.noiseBurst(pos, gain, 0.09, 'lowpass', 380);
  }

  private click(pos: Pos, freq: number, gain: number, delay = 0): void {
    this.noiseBurst(pos, gain, 0.03, 'bandpass', freq, 3, delay);
  }

  private swish(pos: Pos): void {
    this.noiseBurst(pos, 0.35, 0.18, 'bandpass', 700, 2, 0, 3200, 0.05);
  }

  private footstep(a: Actor): void {
    const pos = this.posOf(a);
    const own = pos === null;
    this.noiseBurst(pos, own ? 0.18 : 0.5, 0.07, 'lowpass', 700 + Math.random() * 300, 0.8);
    this.noiseBurst(pos, own ? 0.06 : 0.18, 0.03, 'highpass', 3000, 0.7, 0.015);
  }

  private reload(a: Actor, time: number): void {
    const pos = this.posOf(a);
    const g = pos ? 0.5 : 0.35;
    this.click(pos, 1200, g, time * 0.25);
    this.click(pos, 900, g, time * 0.3);
    this.click(pos, 1700, g, time * 0.7);
    this.click(pos, 2200, g, time * 0.9);
  }

  private beep(pos: THREE.Vector3, freq: number): void {
    this.osc(pos, 'sine', freq, freq, 0.35, 0.09);
  }

  private keypad(pos: Pos, gain = 0.3): void {
    for (let i = 0; i < 5; i++) this.osc(pos, 'square', 1200 + (i % 3) * 180, 1200 + (i % 3) * 180, gain * 0.4, 0.05, i * 0.22);
  }

  private explosion(pos: THREE.Vector3): void {
    // audible across the whole map: not panned, attenuated by hand
    const L = this.listenerPos;
    const d = Math.hypot(pos.x - L.x, pos.z - L.z);
    const k = Math.max(0.25, 1 - d / 140);
    this.noiseBurst(null, 1.6 * k, 2.2, 'lowpass', 2500 * k, 0.7, 0, 120, 0.01);
    this.osc(null, 'sine', 70, 25, 1.5 * k, 1.6);
    this.noiseBurst(null, 0.8 * k * k, 0.3, 'highpass', 1800, 0.6);
  }
}
