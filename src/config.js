// Global tuning constants for world size and generation.

export const CHUNK_SIZE = 16; // blocks per chunk on X and Z
export const WORLD_HEIGHT = 128; // vertical block count (y: 0..WORLD_HEIGHT-1)
export const SEA_LEVEL = 62;

// How many chunks (radius) to keep loaded around the player.
export const LOAD_RADIUS = 8;
export const UNLOAD_RADIUS = 11;

// Max unloaded chunks whose block data is cached (LRU) so revisits skip
// regeneration and preserve player edits.
export const CHUNK_CACHE_MAX = 256;

export const WORLD_SEED = 1337;
