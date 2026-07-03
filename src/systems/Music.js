import * as Tone from 'tone';
import { TRACKS, trackById } from './tracks.js';
import { Sound } from './Sound.js';

// Context-aware music player. Synthesizes the hand-composed tracks from
// tracks.js live through Tone.js — no audio files. Behaviour mirrors
// Minecraft's: music plays occasionally with long silent gaps, the track pool
// follows where you are (surface day / night / deep caves), and a jukebox
// with a disc overrides the ambient rotation (with distance falloff).
//
// One Music instance per Game; dispose() tears the whole signal chain down.

const MUSIC_VOL = 0.4;          // master music level (under the SFX bed)
const GAP_MIN = 40, GAP_MAX = 100; // silence between ambient tracks (s)
const SWITCH_GAP = 4;           // short gap when the context changes mid-gap
const CTX_STABLE = 3;           // context must hold this long before reacting
const DISC_NEAR = 6, DISC_FAR = 28; // jukebox falloff range (blocks)

// Cave one-shot ambience cadence (s).
const AMB_MIN = 9, AMB_MAX = 22;

export class Music {
  constructor() {
    this.enabled = true;
    this.unlocked = false;
    this.built = false;
    this.context = 'day';       // 'day' | 'night' | 'cave'
    this._ctxT = 0;             // time the reported context has been stable
    this.state = 'gap';         // 'gap' | 'playing' | 'fading'
    this.gapT = 6 + Math.random() * 10; // first song arrives quickly
    this.fadeT = 0;
    this.current = null;        // { track, disc: bool, pos: {x,y,z}|null }
    this.queued = null;         // track forced to play after the current gap
    this.parts = [];
    this.lastAmbient = null;    // avoid back-to-back repeats
    this._ambT = AMB_MIN;       // cave ambience one-shot timer
    this.onTrack = null;        // (displayName|null, isDisc) — HUD toast hook

    // Autoplay policy: Tone's context can only start from a user gesture.
    this._unlock = async () => {
      window.removeEventListener('pointerdown', this._unlock);
      window.removeEventListener('keydown', this._unlock);
      try { await Tone.start(); this.unlocked = true; } catch (_) { /* retry on next gesture */ }
    };
    window.addEventListener('pointerdown', this._unlock);
    window.addEventListener('keydown', this._unlock);
  }

  // Build the signal chain + synth presets once, after the context unlocks.
  _build() {
    this.master = new Tone.Gain(MUSIC_VOL).toDestination();
    this.duck = new Tone.Gain(1).connect(this.master); // per-track fades / disc falloff
    this.reverb = new Tone.Reverb({ decay: 5, wet: 0.3 }).connect(this.duck);
    this.delay = new Tone.FeedbackDelay('8n.', 0.3);
    this.delay.wet.value = 0.22;
    this.delay.connect(this.reverb);

    const poly = (Type, opts) => new Tone.PolySynth(Type, opts);
    this.synths = {
      // Soft plucked lead — the main overworld voice.
      pluck: poly(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.005, decay: 0.3, sustain: 0.25, release: 0.6 },
      }).connect(this.reverb),
      // Glassy FM bells — night sparkle and cave echoes (through the delay).
      bell: poly(Tone.FMSynth, {
        harmonicity: 3.01, modulationIndex: 12,
        envelope: { attack: 0.002, decay: 0.8, sustain: 0, release: 1.4 },
        modulation: { type: 'sine' },
        modulationEnvelope: { attack: 0.002, decay: 0.4, sustain: 0, release: 0.4 },
      }).connect(this.delay),
      // Slow swelling pad.
      pad: poly(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 1.2, decay: 0.5, sustain: 0.8, release: 2.5 },
      }).connect(this.reverb),
      // Round bass.
      bass: poly(Tone.Synth, {
        oscillator: { type: 'sine' },
        envelope: { attack: 0.01, decay: 0.25, sustain: 0.4, release: 0.3 },
      }).connect(this.duck),
      // Chiptune voices for the discs.
      square: poly(Tone.Synth, {
        oscillator: { type: 'square' }, volume: -8,
        envelope: { attack: 0.004, decay: 0.12, sustain: 0.3, release: 0.12 },
      }).connect(this.duck),
      tri: poly(Tone.Synth, {
        oscillator: { type: 'triangle' },
        envelope: { attack: 0.005, decay: 0.15, sustain: 0.4, release: 0.15 },
      }).connect(this.duck),
      kick: new Tone.MembraneSynth({ octaves: 6, pitchDecay: 0.04 }).connect(this.duck),
      hat: new Tone.NoiseSynth({
        noise: { type: 'white' },
        envelope: { attack: 0.001, decay: 0.04, sustain: 0 },
      }).connect(this.duck),
    };
    this.built = true;
  }

  // ---- Playback core --------------------------------------------------------

  _start(track, { disc = false, pos = null } = {}) {
    this._hardStop();
    const t = Tone.getTransport();
    const spb = 60 / track.bpm; // seconds per beat
    for (const part of track.parts) {
      const synth = this.synths[part.synth];
      if (!synth) continue;
      const vol = part.vol ?? 1;
      const events = part.events.map((ev) => [ev.b * spb, ev]);
      const p = new Tone.Part((time, ev) => {
        const vel = Math.min(1, ev.v * vol);
        if (part.synth === 'hat') synth.triggerAttackRelease(ev.d * spb, time, vel);
        else synth.triggerAttackRelease(ev.n, ev.d * spb, time, vel);
      }, events);
      p.start(0);
      this.parts.push(p);
    }
    this.duck.gain.cancelScheduledValues(Tone.now());
    this.duck.gain.value = disc ? this._discGain(pos) : 1;
    t.scheduleOnce(() => this._onTrackEnd(), track.beats * spb + 2.5);
    t.start('+0.05');
    this.current = { track, disc, pos };
    this.state = 'playing';
    if (!disc) this.lastAmbient = track.id;
    if (this.onTrack) this.onTrack(track.name, disc);
  }

  _onTrackEnd() {
    this._hardStop();
    this.state = 'gap';
    this.gapT = GAP_MIN + Math.random() * (GAP_MAX - GAP_MIN);
  }

  // Immediate teardown of the transport schedule (no fade).
  _hardStop() {
    const t = Tone.getTransport();
    t.stop();
    t.cancel();
    for (const p of this.parts) p.dispose();
    this.parts = [];
    for (const s of Object.values(this.synths || {})) s.releaseAll?.();
    this.current = null;
  }

  // Fade the playing track out, then fall into a gap.
  _fadeOut(sec = 1.5, nextGap = SWITCH_GAP) {
    if (!this.current) return;
    this.duck.gain.cancelScheduledValues(Tone.now());
    this.duck.gain.rampTo(0.0001, sec);
    this.state = 'fading';
    this.fadeT = sec;
    this._afterGap = nextGap;
  }

  _pickAmbient() {
    const pool = TRACKS.filter((t) => t.context === this.context);
    if (pool.length === 0) return null;
    const fresh = pool.filter((t) => t.id !== this.lastAmbient);
    const from = fresh.length ? fresh : pool;
    return from[Math.floor(Math.random() * from.length)];
  }

  _discGain(pos) {
    if (!pos || !this._playerPos) return 1;
    const dx = pos.x + 0.5 - this._playerPos.x;
    const dy = pos.y + 0.5 - this._playerPos.y;
    const dz = pos.z + 0.5 - this._playerPos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d <= DISC_NEAR) return 1;
    if (d >= DISC_FAR) return 0.0001;
    return 1 - (d - DISC_NEAR) / (DISC_FAR - DISC_NEAR);
  }

  // ---- Public API -----------------------------------------------------------

  // Insert a disc: overrides whatever ambient music is up.
  playDisc(trackId, pos) {
    const track = trackById(trackId);
    if (!track) return;
    if (!this.unlocked) return;
    if (!this.built) this._build();
    this._start(track, { disc: true, pos });
  }

  // Stop the disc (ejected / jukebox broken). Ambient rotation resumes later.
  stopDisc() {
    if (!this.current?.disc) return;
    this._fadeOut(0.4, GAP_MIN * 0.5);
  }

  get discPlaying() {
    return this.current?.disc ? this.current.track.id : null;
  }

  // Called every frame from the game loop.
  // ctx: { context: 'day'|'night'|'cave', playerPos: Vector3 }
  update(dt, ctx) {
    if (!this.enabled || !this.unlocked) return;
    if (!this.built) this._build();
    this._playerPos = ctx.playerPos;

    // Track how long the reported context has been stable so a two-second
    // cave peek doesn't yank the surface song away.
    if (ctx.context === this.context) this._ctxT += dt;
    else { this.context = ctx.context; this._ctxT = 0; }

    if (this.state === 'playing' && this.current) {
      if (this.current.disc) {
        // Jukebox falloff follows the player around.
        this.duck.gain.rampTo(this._discGain(this.current.pos), 0.2);
      } else if (this.current.track.context !== this.context && this._ctxT >= CTX_STABLE) {
        this._fadeOut(2, SWITCH_GAP);
      }
    } else if (this.state === 'fading') {
      this.fadeT -= dt;
      if (this.fadeT <= 0) {
        this._hardStop();
        this.state = 'gap';
        this.gapT = this._afterGap ?? SWITCH_GAP;
      }
    } else if (this.state === 'gap') {
      this.gapT -= dt;
      if (this.gapT <= 0 && this._ctxT >= CTX_STABLE) {
        const track = this._pickAmbient();
        if (track) this._start(track);
        else this.gapT = 15; // no track for this context — check again later
      }
    }

    // Cave ambience one-shots ride alongside the music (through Sound, not Tone).
    if (this.context === 'cave') {
      this._ambT -= dt;
      if (this._ambT <= 0) {
        this._ambT = AMB_MIN + Math.random() * (AMB_MAX - AMB_MIN);
        const roll = Math.random();
        if (roll < 0.5) Sound.drip();
        else if (roll < 0.8) Sound.caveWind();
        else Sound.rumble();
      }
    }
  }

  toggle() {
    this.enabled = !this.enabled;
    if (!this.enabled && this.built) this._hardStop();
    if (!this.enabled) this.state = 'gap';
    this.gapT = 2;
    return this.enabled;
  }

  dispose() {
    window.removeEventListener('pointerdown', this._unlock);
    window.removeEventListener('keydown', this._unlock);
    if (!this.built) return;
    this._hardStop();
    for (const s of Object.values(this.synths)) s.dispose();
    this.delay.dispose();
    this.reverb.dispose();
    this.duck.dispose();
    this.master.dispose();
    this.built = false;
  }
}
