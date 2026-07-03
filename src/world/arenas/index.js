import { getBlockId } from '../../blocks/BlockRegistry.js';
import * as town from './maps/town.js';
import * as castle from './maps/castle.js';

// Prop Hunt arena map registry. A map is a module exporting { id, name, desc,
// half, baseSurface, propBlocks, botSpots, generate(chunk), seekerSpawn(i),
// hiderSpawns(n), lobbySpawn() } — see maps/town.js for the reference shape.
// The active map is chosen at world creation (like the seed and mode) and set
// by Game before any chunk generates.

export { FLOOR_Y } from './lib.js';

const DEFAULT_MAP = 'town';

export const MAPS = { [town.id]: town, [castle.id]: castle };
export const MAP_LIST = [town, castle]; // menu order

let active = MAPS[DEFAULT_MAP];

// Select the map before world construction; unknown ids fall back to the default.
export function setActiveMap(mapId) { active = MAPS[mapId] || MAPS[DEFAULT_MAP]; }
export function activeMap() { return active; }

// Stamp the active map into a generating chunk (called from TerrainGen).
export function generateArena(chunk) { active.generate(chunk); }

// Disguise palette of the active map, as block ids (resolved at call time so a
// new Game always sees its own map's palette, never a stale module constant).
export function propIds() { return active.propBlocks.map(getBlockId).filter(Boolean); }

// Spawn helpers used by the HideSeek round logic.
export function seekerSpawn(i = 0) { return active.seekerSpawn(i); }
export function hiderSpawns(n) { return active.hiderSpawns(n); }
export function lobbySpawn() { return active.lobbySpawn(); }
