import { FLOOR_Y, ARENA_HALF, PROP_BLOCKS } from './ArenaGen.js';

// Arena constants + spawn helpers shared by the HideSeek round logic.
// (A hand-authored arena loaded from a serialized-edits blob can be added here
// later as an alternative to the procedural generator — see plan M2.)

export { FLOOR_Y, ARENA_HALF, PROP_BLOCKS };

// Players stand one block above the floor.
const SPAWN_Y = FLOOR_Y + 1;

// Seekers start penned at the centre while hiders disperse.
export function seekerSpawn(i = 0) {
  const a = (i / 4) * Math.PI * 2;
  return { x: Math.cos(a) * 1.5 + 0.5, y: SPAWN_Y, z: Math.sin(a) * 1.5 + 0.5 };
}

// Hiders spread around a ring near the arena edge.
export function hiderSpawns(n) {
  const out = [];
  const R = ARENA_HALF - 8;
  for (let i = 0; i < n; i++) {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    out.push({ x: Math.cos(a) * R + 0.5, y: SPAWN_Y, z: Math.sin(a) * R + 0.5 });
  }
  return out;
}
