// The music library: every track is hand-composed note data, synthesized live
// by Music.js through Tone.js — no audio files, same rule as the textures.
//
// Notation: patterns are strings on a fixed step grid (default half a beat).
//   "E4"        note on this step (duration = one step unless extended)
//   "-"         extend the previous note by one step
//   "."         rest for one step
//   "|"         barline, ignored (readability only)
//   "C4+E4+G4"  chord
// Accompaniment (pads, bass bounces, arpeggios) is generated from chord lists
// by the helpers below so only melodies are written out by hand.
//
// Event shape: { b: beat, n: note|[notes], d: beats, v: velocity }.

function seq(start, pattern, { step = 0.5, vel = 0.8 } = {}) {
  const events = [];
  let b = start;
  let last = null;
  for (const tok of pattern.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    if (tok === '.') { b += step; last = null; continue; }
    if (tok === '-') { if (last) last.d += step; b += step; continue; }
    const n = tok.includes('+') ? tok.split('+') : tok;
    last = { b, n, d: step * 0.98, v: vel };
    events.push(last);
    b += step;
  }
  return events;
}

// Sustained chords, one per `beats` (pads). Chords are "C3 E3 G3" strings.
function pads(start, chords, beats = 4, vel = 0.5) {
  return chords.map((c, i) => ({ b: start + i * beats, n: c.split(' '), d: beats * 0.98, v: vel }));
}

// Root–octave bass bounce, eighth notes, one root per bar of `beats`.
function bounce(start, roots, beats = 4, vel = 0.62) {
  const out = [];
  for (let i = 0; i < roots.length; i++) {
    const r = roots[i];
    const up = r.replace(/\d/, (d) => +d + 1);
    for (let k = 0; k < beats; k++) {
      out.push({ b: start + i * beats + k, n: r, d: 0.45, v: vel });
      out.push({ b: start + i * beats + k + 0.5, n: up, d: 0.4, v: vel * 0.8 });
    }
  }
  return out;
}

// Slow half-note roots (calm tracks).
function bassSlow(start, roots, beats = 4, vel = 0.55) {
  const out = [];
  for (let i = 0; i < roots.length; i++) {
    out.push({ b: start + i * beats, n: roots[i], d: beats / 2, v: vel });
    out.push({ b: start + i * beats + beats / 2, n: roots[i], d: beats / 2 - 0.1, v: vel * 0.75 });
  }
  return out;
}

// Eighth-note arpeggio cycling up-down through each chord's tones.
function arp(start, chords, beats = 4, vel = 0.5, step = 0.5) {
  const out = [];
  for (let i = 0; i < chords.length; i++) {
    const tones = chords[i].split(' ');
    const cycle = [...tones, ...tones.slice(1, -1).reverse()];
    for (let k = 0; k < beats / step; k++) {
      out.push({ b: start + i * beats + k * step, n: cycle[k % cycle.length], d: step * 0.9, v: vel });
    }
  }
  return out;
}

// Percussion rows for the disc tracks: "x" hits, "." rests.
function drums(start, pattern, step = 0.5, vel = 0.5) {
  const out = [];
  let b = start;
  for (const tok of pattern.split(/\s+/)) {
    if (!tok || tok === '|') continue;
    if (tok === 'x') out.push({ b, n: 'C2', d: 0.1, v: vel });
    b += step;
  }
  return out;
}

const rep = (s, n) => Array(n).fill(s).join(' ');

// ---------------------------------------------------------------------------
// Tracks
// ---------------------------------------------------------------------------

const TRACKS = [];

// --- Sunfields — bright, bouncy overworld exploration (the "upbeat" one) ----
{
  // A: C G Am F ×2 (with F C turnaround) · B: Am F C G ×2 — 24 bars @ 120.
  const A1 = ['C', 'G', 'A', 'F', 'C', 'G', 'F', 'C'];
  const B = ['A', 'F', 'C', 'G', 'A', 'F', 'G', 'G'];
  const padA = ['C3 E3 G3', 'G3 B3 D4', 'A3 C4 E4', 'F3 A3 C4', 'C3 E3 G3', 'G3 B3 D4', 'F3 A3 C4', 'C3 E3 G3'];
  const padB = ['A3 C4 E4', 'F3 A3 C4', 'C4 E4 G4', 'G3 B3 D4', 'A3 C4 E4', 'F3 A3 C4', 'G3 B3 D4', 'G3 B3 D4'];
  const melodyA = `
    E4 - G4 - A4 - C5 - | B4 - G4 - - - . . | A4 - C5 - E5 - D5 - | C5 - A4 - - - . .
    E4 - G4 - A4 - C5 - | D5 - B4 - G4 - - - | A4 - B4 - C5 - D5 - | E5 - - - C5 - - -`;
  const melodyB = `
    E5 - C5 - A4 - C5 - | A4 - C5 - F5 - E5 - | E5 - G5 - E5 - C5 - | D5 - B4 - G4 - . .
    A4 - C5 - E5 - C5 - | F5 - E5 - C5 - A4 - | G4 - A4 - B4 - D5 - | C5 - - - - - - -`;
  TRACKS.push({
    id: 'sunfields', name: 'Sunfields', context: 'day', bpm: 120, beats: 96,
    parts: [
      { synth: 'pluck', vol: 0.9, events: [...seq(0, melodyA), ...seq(32, melodyB), ...seq(64, melodyA)] },
      { synth: 'pad', vol: 0.55, events: [...pads(0, padA), ...pads(32, padB), ...pads(64, padA)] },
      { synth: 'bass', vol: 0.8, events: [
        ...bounce(0, A1.map((r) => r + '2')),
        ...bounce(32, B.map((r) => r + '2')),
        ...bounce(64, A1.map((r) => r + '2'))] },
    ],
  });
}

// --- Wanderlight — gentle piano-ish wandering (calm day) --------------------
{
  // Cmaj7 Fmaj7 Am7 G ×2 · Fmaj7 Em7 Dm7 G — 16 bars @ 88.
  const prog = ['C3 E3 G3 B3', 'F3 A3 C4 E4', 'A3 C4 E4 G4', 'G3 B3 D4 F4'];
  const prog2 = ['F3 A3 C4 E4', 'E3 G3 B3 D4', 'D3 F3 A3 C4', 'G3 B3 D4'];
  const melody = `
    . . E5 - G5 - - - | . . A5 - G5 - E5 - | . . C5 - E5 - G5 - | D5 - - - - - . .
    . . A4 - C5 - E5 - | . . G4 - B4 - D5 - | F5 - E5 - C5 - A4 - | G4 - - - - - - -`;
  TRACKS.push({
    id: 'wanderlight', name: 'Wanderlight', context: 'day', bpm: 88, beats: 64,
    parts: [
      { synth: 'bell', vol: 0.55, events: seq(0, melody, { vel: 0.6 }) },
      { synth: 'pluck', vol: 0.5, events: [...arp(0, prog, 4, 0.42), ...arp(16, prog, 4, 0.42), ...arp(32, prog2, 4, 0.42), ...arp(48, prog, 4, 0.38)] },
      { synth: 'bass', vol: 0.6, events: bassSlow(0, ['C2', 'F2', 'A2', 'G2', 'C2', 'F2', 'A2', 'G2', 'F2', 'E2', 'D2', 'G2', 'C2', 'F2', 'A2', 'G2']) },
    ],
  });
}

// --- Moonveil — hushed night sky ---------------------------------------------
{
  // Am F C G, twice around, everything soft and slow — 16 bars @ 70.
  const prog = ['A2 E3 A3 C4', 'F2 C3 F3 A3', 'C3 G3 C4 E4', 'G2 D3 G3 B3'];
  const bells = `
    E5 - - - . . . . | . . C5 - - - . . | . . . . G4 - B4 - | A4 - - - - - . .
    C5 - - - . . . . | . . A4 - - - . . | E5 - D5 - B4 - - - | A4 - - - - - - -`;
  TRACKS.push({
    id: 'moonveil', name: 'Moonveil', context: 'night', bpm: 70, beats: 64,
    parts: [
      { synth: 'bell', vol: 0.42, events: seq(0, bells, { vel: 0.5 }) },
      { synth: 'pad', vol: 0.5, events: [...pads(0, prog, 4, 0.42), ...pads(16, prog, 4, 0.42), ...pads(32, prog, 4, 0.4), ...pads(48, prog, 4, 0.36)] },
      { synth: 'bass', vol: 0.5, events: bassSlow(0, ['A1', 'F2', 'C2', 'G1', 'A1', 'F2', 'C2', 'G1', 'A1', 'F2', 'C2', 'G1', 'A1', 'F2', 'C2', 'G1'], 4, 0.4) },
    ],
  });
}

// --- Hollow — deep cave drone (dark, spacious) -------------------------------
{
  // D minor drones with a far-off bell motif — 16 bars @ 56.
  const bells = `
    . . . . . . . . | D5 - - - F5 - - - | E5 - - - - - . . | . . . . . . . .
    . . C5 - - - . . | D5 - - - - - - - | . . . . A4 - - - | . . . . . . . .`;
  TRACKS.push({
    id: 'hollow', name: 'Hollow', context: 'cave', bpm: 56, beats: 64,
    parts: [
      { synth: 'bell', vol: 0.4, events: seq(0, bells, { vel: 0.45 }) },
      { synth: 'pad', vol: 0.55, events: pads(0, ['D2 A2 D3', 'D2 A2 D3', 'C2 G2 C3', 'D2 A2 D3', 'F2 C3 F3', 'D2 A2 D3', 'A1 E2 A2', 'D2 A2 D3'], 8, 0.4) },
    ],
  });
}

// --- Deepglow — glittering crystal cavern -------------------------------------
{
  // E minor pentatonic sparkle over slow pads — 16 bars @ 72.
  const prog = ['E3 G3 B3', 'C3 G3 E4', 'G3 B3 D4', 'D3 A3 F#4'];
  const glitter = `
    E5 . B4 . G5 . E5 . | . . B4 . D5 . . . | G4 . B4 . E5 . D5 . | . . . . B4 . . .
    E5 . G5 . B5 . G5 . | E5 . D5 . B4 . . . | A4 . B4 . D5 . E5 . | E5 - - - . . . .`;
  TRACKS.push({
    id: 'deepglow', name: 'Deepglow', context: 'cave', bpm: 72, beats: 64,
    parts: [
      { synth: 'bell', vol: 0.45, events: seq(0, glitter, { vel: 0.42 }) },
      { synth: 'pad', vol: 0.5, events: [...pads(0, prog, 8, 0.36), ...pads(32, prog, 8, 0.33)] },
    ],
  });
}

// --- Sunburst — chiptune banger (disc exclusive) -----------------------------
{
  // Driving square-lead chiptune — 16 bars @ 132.
  const leadA = `
    G4 G4 A4 G4 E4 . C4 . | G4 G4 A4 G4 E5 - D5 . | C5 C5 D5 C5 A4 . G4 . | A4 B4 C5 D5 E5 - - .
    G4 G4 A4 G4 E4 . C4 . | G4 G4 A4 G4 E5 - D5 . | C5 D5 E5 G5 A5 . G5 . | E5 - C5 - G4 - - .`;
  const leadB = `
    E5 . E5 D5 C5 . A4 . | C5 . C5 D5 E5 - - . | D5 . D5 C5 B4 . G4 . | B4 C5 D5 B4 G4 - - .
    E5 . E5 D5 C5 . A4 . | C5 . C5 D5 E5 - G5 . | A5 G5 E5 D5 C5 . D5 . | C5 - - - - - - .`;
  const bassRoots = ['C2', 'C2', 'F2', 'G2', 'C2', 'C2', 'F2', 'G2', 'A1', 'F2', 'G2', 'G2', 'A1', 'F2', 'G2', 'C2'];
  TRACKS.push({
    id: 'sunburst', name: 'Sunburst', context: 'disc', bpm: 132, beats: 128,
    parts: [
      { synth: 'square', vol: 0.5, events: [...seq(0, leadA, { vel: 0.5 }), ...seq(32, leadB, { vel: 0.5 }), ...seq(64, leadA, { vel: 0.5 }), ...seq(96, leadB, { vel: 0.52 })] },
      { synth: 'tri', vol: 0.75, events: bounce(0, [...bassRoots, ...bassRoots], 4, 0.6) },
      { synth: 'kick', vol: 0.85, events: drums(0, rep('x . . . x . . .', 32)) },
      { synth: 'hat', vol: 0.32, events: drums(0, rep('. . x . . . x .', 32), 0.5, 0.32) },
    ],
  });
}

// --- Voyage — heroic setting-out theme (disc exclusive) ----------------------
{
  // G major, wide and adventurous — 16 bars @ 104.
  const lead = `
    D4 - G4 - B4 - D5 - | B4 - A4 - - - . . | E4 - G4 - B4 - C5 - | B4 - G4 - - - . .
    D4 - G4 - B4 - D5 - | E5 - D5 - B4 - G4 - | A4 - B4 - C5 - A4 - | G4 - - - - - - -
    B4 - D5 - G5 - F#5 - | E5 - C5 - - - . . | A4 - C5 - E5 - D5 - | B4 - G4 - - - . .
    B4 - D5 - G5 - E5 - | D5 - B4 - G4 - E4 - | A4 - - - B4 - A4 - | G4 - - - - - - -`;
  const padProg = ['G3 B3 D4', 'D3 F#3 A3', 'E3 G3 B3', 'C3 E3 G3'];
  const padProg2 = ['G3 B3 D4', 'C3 E3 G3', 'A3 C4 E4', 'D3 F#3 A3'];
  TRACKS.push({
    id: 'voyage', name: 'Voyage', context: 'disc', bpm: 104, beats: 128,
    parts: [
      { synth: 'tri', vol: 0.8, events: [...seq(0, lead, { vel: 0.62 }), ...seq(64, lead, { vel: 0.66 })] },
      { synth: 'pad', vol: 0.5, events: [
        ...pads(0, padProg), ...pads(16, padProg2), ...pads(32, padProg), ...pads(48, padProg2),
        ...pads(64, padProg), ...pads(80, padProg2), ...pads(96, padProg), ...pads(112, padProg2)] },
      { synth: 'bass', vol: 0.7, events: bounce(0, ['G2', 'D2', 'E2', 'C2', 'G2', 'C2', 'A2', 'D2', 'G2', 'D2', 'E2', 'C2', 'G2', 'C2', 'A2', 'D2', 'G2', 'D2', 'E2', 'C2', 'G2', 'C2', 'A2', 'D2', 'G2', 'D2', 'E2', 'C2', 'G2', 'C2', 'A2', 'D2'], 4, 0.55) },
    ],
  });
}

export { TRACKS };
export const trackById = (id) => TRACKS.find((t) => t.id === id) || null;
// Every track is collectible on a disc; ambient rotation uses the context tags.
export const DISC_TRACKS = TRACKS.map((t) => t.id);
