import { getBlock } from '../blocks/BlockRegistry.js';

// All sound is synthesized at runtime with the Web Audio API — no audio files.
// Sounds are short noise bursts (for impacts/footsteps) and oscillator tones
// (for blips/voices) shaped with quick envelopes. Material categories give
// digging/footsteps a distinct character per block type.

const CAT = {
  stone:  { freq: 1600, q: 1,   type: 'lowpass',  g: 0.5 },
  wood:   { freq: 900,  q: 2,   type: 'bandpass', g: 0.45 },
  dirt:   { freq: 600,  q: 1,   type: 'lowpass',  g: 0.4 },
  grass:  { freq: 1300, q: 1,   type: 'lowpass',  g: 0.35 },
  sand:   { freq: 2000, q: 0.8, type: 'highpass', g: 0.35 },
  gravel: { freq: 2600, q: 0.9, type: 'highpass', g: 0.45 },
  glass:  { freq: 3200, q: 1,   type: 'highpass', g: 0.55 },
  snow:   { freq: 1500, q: 1,   type: 'lowpass',  g: 0.28 },
  default:{ freq: 1000, q: 1,   type: 'lowpass',  g: 0.4 },
};

export function soundCategory(id) {
  const b = getBlock(id);
  const n = b && b.name;
  if (!n) return 'default';
  if (n.endsWith('_ore') || ['stone', 'cobblestone', 'andesite', 'bedrock', 'furnace'].includes(n)) return 'stone';
  if (['oak_log', 'oak_planks', 'crafting_table', 'chest', 'cactus', 'torch'].includes(n)) return 'wood';
  if (['dirt', 'grass', 'clay'].includes(n)) return 'dirt';
  if (n === 'sand') return 'sand';
  if (n === 'gravel') return 'gravel';
  if (n === 'glass') return 'glass';
  if (n === 'oak_leaves') return 'grass';
  if (n === 'snow') return 'snow';
  return 'default';
}

const jit = (x) => x * (0.9 + Math.random() * 0.2);

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.enabled = true;
  }

  _ensure() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.enabled ? 0.5 : 0;
    this.master.connect(this.ctx.destination);
  }

  // Call from a user gesture (pointer lock / click) to satisfy autoplay rules.
  resume() {
    this._ensure();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggle() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.value = this.enabled ? 0.5 : 0;
    return this.enabled;
  }

  _ready() {
    this._ensure();
    return this.enabled && this.ctx && this.ctx.state === 'running';
  }

  _envGain(peak, dur, t) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    return g;
  }

  _noise(dur) {
    const sr = this.ctx.sampleRate;
    const len = Math.max(1, Math.floor(sr * dur));
    const buf = this.ctx.createBuffer(1, len, sr);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  // Filtered noise burst (impacts, footsteps, whooshes).
  burst(freq, q, type, peak, dur, when = 0) {
    if (!this._ready()) return;
    const t = this.ctx.currentTime + when;
    const src = this._noise(dur);
    const filt = this.ctx.createBiquadFilter();
    filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const g = this._envGain(peak, dur, t);
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // Oscillator tone, optionally sliding in pitch (blips, voices).
  tone(freq, dur, type, peak, slideTo = null, when = 0) {
    if (!this._ready()) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = this._envGain(peak, dur, t);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // --- Named gameplay sounds ---
  dig(cat, vol = 1) {
    const c = CAT[cat] || CAT.default;
    this.burst(jit(c.freq), c.q, c.type, c.g * 0.5 * vol, 0.12);
    this.tone(jit(90), 0.07, 'sine', 0.16 * vol, 60);
    if (cat === 'glass') { this.tone(jit(2600), 0.12, 'triangle', 0.18 * vol); this.tone(jit(3300), 0.1, 'triangle', 0.12 * vol, null, 0.03); }
  }

  step(cat) {
    const c = CAT[cat] || CAT.default;
    this.burst(jit(c.freq * 0.8), c.q, c.type, c.g * 0.16, 0.07);
  }

  place(cat, vol = 1) {
    const c = CAT[cat] || CAT.default;
    this.burst(jit(c.freq * 0.7), c.q, c.type, c.g * 0.4 * vol, 0.1);
    this.tone(jit(70), 0.06, 'sine', 0.14 * vol, 50);
  }

  land(cat) {
    const c = CAT[cat] || CAT.default;
    this.burst(jit(c.freq * 0.6), c.q, c.type, c.g * 0.4, 0.1);
    this.tone(70, 0.08, 'sine', 0.18, 45);
  }

  jump() { this.tone(300, 0.09, 'sine', 0.1, 430); }

  pickup() {
    this.tone(720, 0.07, 'triangle', 0.16, null);
    this.tone(980, 0.08, 'triangle', 0.14, null, 0.05);
  }

  eat() {
    for (let i = 0; i < 3; i++) this.burst(jit(850), 2, 'bandpass', 0.22, 0.06, i * 0.09);
  }

  craft() {
    this.tone(520, 0.07, 'triangle', 0.18);
    this.tone(780, 0.09, 'triangle', 0.16, null, 0.06);
  }

  container() {
    this.burst(520, 2, 'bandpass', 0.22, 0.12);
    this.tone(300, 0.1, 'sine', 0.1, 240);
  }

  swing() { this.burst(1900, 0.6, 'highpass', 0.12, 0.1); }

  shoot() { // bow twang
    this.tone(420, 0.14, 'triangle', 0.18, 150);
    this.burst(1400, 0.7, 'highpass', 0.08, 0.08);
  }

  arrowHit() { this.burst(1600, 1, 'bandpass', 0.12, 0.06); }

  // Door creak: a slow saw sweep — rising to open, falling to close.
  door(opening) {
    this.tone(opening ? 160 : 240, 0.16, 'sawtooth', 0.14, opening ? 260 : 130);
    this.burst(900, 1.2, 'bandpass', 0.1, 0.07, 0.05);
  }

  // TNT/creeper fuse: a long thin hiss.
  fuse() { this.burst(3200, 0.8, 'highpass', 0.5, 0.07); }

  // The big one: deep thump + rumbling noise tail.
  explode() {
    this.tone(70, 0.5, 'sine', 0.5, 28);
    this.burst(180, 1.4, 'lowpass', 0.6, 0.45);
    this.burst(900, 1.2, 'bandpass', 0.35, 0.2, 0.04);
  }

  hurt() {
    this.tone(260, 0.18, 'sawtooth', 0.28, 120);
    this.burst(400, 1, 'lowpass', 0.18, 0.12);
  }

  death() {
    this.tone(240, 0.5, 'sawtooth', 0.3, 70);
    this.burst(500, 1, 'lowpass', 0.2, 0.4);
  }

  mobHurt(vol = 1) {
    this.tone(jit(180), 0.15, 'square', 0.26 * vol, 110);
    this.burst(600, 1, 'bandpass', 0.18 * vol, 0.1);
  }

  mobDeath(vol = 1) {
    this.tone(jit(160), 0.4, 'sawtooth', 0.3 * vol, 70);
    this.burst(500, 1, 'lowpass', 0.22 * vol, 0.35);
  }

  splash() {
    this.burst(900, 0.7, 'bandpass', 0.3, 0.25);
    this.burst(2400, 0.8, 'highpass', 0.15, 0.18, 0.02);
  }

  // Softer, gentler stroke for ongoing swimming.
  swim() {
    this.burst(jit(700), 0.7, 'bandpass', 0.13, 0.18);
    this.burst(jit(1900), 0.8, 'highpass', 0.07, 0.12, 0.02);
  }

  // ---- Cave ambience one-shots (triggered by Music.js while underground) ----

  // Water droplet: a bright falling blip, then its fainter cave echo.
  drip() {
    this.tone(jit(1500), 0.06, 'sine', 0.14, 640);
    this.tone(jit(950), 0.09, 'sine', 0.07, 480, 0.22);
    this.tone(jit(900), 0.09, 'sine', 0.04, 460, 0.45);
  }

  // Low airy draft moving through the tunnels: slow-swelling filtered noise
  // (burst()'s 5 ms attack is too abrupt for wind, so shape the envelope here).
  caveWind() {
    if (!this._ready()) return;
    const t = this.ctx.currentTime;
    const dur = 2.6;
    const src = this._noise(dur);
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 340; filt.Q.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.13, t + dur * 0.45); // slow swell in
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);      // sigh back out
    src.connect(filt); filt.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  // Distant earth groan: a deep sine sag under a soft low noise wash.
  rumble() {
    this.tone(52, 2.4, 'sine', 0.13, 30);
    this.burst(140, 0.8, 'lowpass', 0.1, 1.8, 0.15);
  }

  // ---- Prop Hunt taunts ----

  // Cackle: four quick rising triangle blips.
  laugh() {
    for (let i = 0; i < 4; i++) {
      this.tone(jit(520 + i * 45), 0.08, 'triangle', 0.2, 720 + i * 45, i * 0.11);
    }
  }

  // Grumble: harsh descending sawtooth + a low growl.
  angry() {
    this.tone(jit(240), 0.3, 'sawtooth', 0.28, 90);
    this.burst(500, 1.2, 'lowpass', 0.2, 0.25, 0.02);
  }

  // Llama call: two nasal, slightly detuned square tones sliding up.
  llama() {
    this.tone(jit(300), 0.18, 'square', 0.24, 520);
    this.tone(jit(360), 0.16, 'square', 0.18, 620, 0.12);
  }
}

export const Sound = new SoundEngine();
