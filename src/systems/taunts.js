// Prop Hunt taunts. Alive hiders trigger these during the seek phase: an emoji
// floats above their head, a sound plays, and they earn style points. Points
// scale with risk — a louder taunt alerts seekers from farther away, and the
// exploding llama lingers 5s before a (cosmetic) blast. Add a taunt by dropping
// one entry here; the HUD, keybinds, and net all read from this table.
//
// Fields: id, label, emoji, points, duration (seconds the icon floats),
// alert (radius within which seekers are drawn to you; 999 = whole arena),
// explode (cosmetic blast when the icon expires), sound (Sound method name),
// color ([r,g,b] 0..1 for the particle puff).

export const TAUNTS = [
  { id: 'laugh', label: 'Laugh',           emoji: '😂', points: 10,  duration: 2, alert: 6,   explode: false, sound: 'laugh', color: [1, 0.85, 0.2] },
  { id: 'angry', label: 'Angry',           emoji: '😠', points: 25,  duration: 3, alert: 12,  explode: false, sound: 'angry', color: [1, 0.3, 0.2] },
  { id: 'llama', label: 'Exploding Llama', emoji: '🦙', points: 100, duration: 5, alert: 999, explode: true,  sound: 'llama', color: [0.7, 0.9, 0.5] },
];

export const tauntById = Object.fromEntries(TAUNTS.map((t) => [t.id, t]));
