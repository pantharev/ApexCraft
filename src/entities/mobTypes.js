// Mob definitions: stats, loot, collision box (hw = half-width, h = height in
// blocks), and a list of box parts for the placeholder model. Part pos is the
// box centre relative to the mob's feet; `leg: true` parts swing while walking
// and `arm: true` parts get a shoulder pivot driven by the mob's `gait`
// ('shamble' | 'run' | 'heavy' | 'raised' — see animateMob in MobModels).

const leg = (x, z, w, h, d, color) => ({ size: [w, h, d], pos: [x, h / 2, z], color, leg: true });

export const MOBS = {
  // ---- Passive ----
  pig: {
    category: 'passive', health: 10, speed: 1.6, hw: 0.45, h: 0.9,
    drops: [{ item: 'raw_porkchop', count: [1, 3] }],
    parts: [
      { size: [0.9, 0.55, 1.2], pos: [0, 0.55, 0], color: '#e8a0a0' },
      { size: [0.5, 0.5, 0.5], pos: [0, 0.6, 0.75], color: '#e8a0a0', head: true },
      { size: [0.25, 0.2, 0.12], pos: [0, 0.5, 1.0], color: '#d77f7f', head: true },
      leg(-0.28, 0.4, 0.22, 0.35, 0.22, '#d98f8f'), leg(0.28, 0.4, 0.22, 0.35, 0.22, '#d98f8f'),
      leg(-0.28, -0.4, 0.22, 0.35, 0.22, '#d98f8f'), leg(0.28, -0.4, 0.22, 0.35, 0.22, '#d98f8f'),
    ],
  },
  cow: {
    category: 'passive', health: 10, speed: 1.3, hw: 0.45, h: 1.3,
    drops: [{ item: 'raw_beef', count: [1, 3] }, { item: 'leather', count: [0, 2] }],
    parts: [
      { size: [0.95, 0.7, 1.3], pos: [0, 0.8, 0], color: '#5a4632' },
      { size: [0.55, 0.55, 0.55], pos: [0, 0.95, 0.85], color: '#46341f', head: true },
      leg(-0.3, 0.45, 0.25, 0.55, 0.25, '#4a3826'), leg(0.3, 0.45, 0.25, 0.55, 0.25, '#4a3826'),
      leg(-0.3, -0.45, 0.25, 0.55, 0.25, '#4a3826'), leg(0.3, -0.45, 0.25, 0.55, 0.25, '#4a3826'),
    ],
  },
  sheep: {
    category: 'passive', health: 8, speed: 1.3, hw: 0.45, h: 1.1,
    drops: [{ item: 'wool', count: [1, 1] }, { item: 'raw_mutton', count: [1, 2] }],
    parts: [
      { size: [1.0, 0.75, 1.15], pos: [0, 0.7, 0], color: '#eeeeee' },
      { size: [0.45, 0.45, 0.5], pos: [0, 0.78, 0.7], color: '#d9cab5', head: true },
      leg(-0.3, 0.35, 0.22, 0.45, 0.22, '#c8b9a0'), leg(0.3, 0.35, 0.22, 0.45, 0.22, '#c8b9a0'),
      leg(-0.3, -0.35, 0.22, 0.45, 0.22, '#c8b9a0'), leg(0.3, -0.35, 0.22, 0.45, 0.22, '#c8b9a0'),
    ],
  },
  chicken: {
    category: 'passive', health: 4, speed: 1.2, hw: 0.25, h: 0.7,
    drops: [{ item: 'raw_chicken', count: [1, 1] }, { item: 'feather', count: [0, 2] }],
    parts: [
      { size: [0.4, 0.4, 0.5], pos: [0, 0.35, 0], color: '#f0f0f0' },
      { size: [0.3, 0.3, 0.3], pos: [0, 0.6, 0.22], color: '#f0f0f0', head: true },
      { size: [0.12, 0.1, 0.14], pos: [0, 0.58, 0.42], color: '#e0a83a', head: true },
      leg(-0.12, 0, 0.08, 0.2, 0.08, '#e0a83a'), leg(0.12, 0, 0.08, 0.2, 0.08, '#e0a83a'),
    ],
  },

  // ---- Tamable ----
  // Wolves and cats spawn wild through the passive pool. Right-clicking one
  // while holding its `tameItem` rolls a tame chance; once owned they follow
  // their owner, can sit, and can be healed with `petFoods` (Game._petInteract
  // + Mob._petAI). Tamed individuals are exempt from despawn/caps in
  // MobManager, so `passive` here only governs the wild ones.
  wolf: {
    category: 'passive', health: 20, speed: 1.9, attack: 4, hw: 0.4, h: 0.85,
    tamable: true, tameItem: 'bone',
    petFoods: ['raw_porkchop', 'cooked_porkchop', 'raw_beef', 'cooked_beef',
      'raw_mutton', 'cooked_mutton', 'raw_chicken', 'cooked_chicken', 'rotten_flesh'],
    drops: [],
    parts: [
      { size: [0.5, 0.5, 0.9], pos: [0, 0.55, -0.1], color: '#b7b3ab' },               // body
      { size: [0.58, 0.55, 0.35], pos: [0, 0.58, 0.32], color: '#c9c5bd' },            // chest/mane
      { size: [0.42, 0.4, 0.4], pos: [0, 0.75, 0.68], color: '#c2beb6', head: true },  // head
      { size: [0.2, 0.18, 0.24], pos: [0, 0.66, 0.95], color: '#d8d4cc', head: true }, // snout
      { size: [0.1, 0.14, 0.08], pos: [-0.13, 1.0, 0.6], color: '#a5a19a', head: true }, // ears
      { size: [0.1, 0.14, 0.08], pos: [0.13, 1.0, 0.6], color: '#a5a19a', head: true },
      { size: [0.12, 0.12, 0.45], pos: [0, 0.68, -0.65], color: '#b7b3ab' },           // tail
      leg(-0.16, 0.28, 0.14, 0.42, 0.14, '#a5a19a'), leg(0.16, 0.28, 0.14, 0.42, 0.14, '#a5a19a'),
      leg(-0.16, -0.32, 0.14, 0.42, 0.14, '#a5a19a'), leg(0.16, -0.32, 0.14, 0.42, 0.14, '#a5a19a'),
    ],
  },
  cat: {
    category: 'passive', health: 12, speed: 2.2, hw: 0.3, h: 0.6,
    tamable: true, tameItem: 'raw_fish', petFoods: ['raw_fish', 'raw_chicken'],
    scaresCreepers: true,
    drops: [],
    parts: [
      { size: [0.32, 0.3, 0.75], pos: [0, 0.38, -0.05], color: '#d9964e' },             // body (ginger)
      { size: [0.3, 0.28, 0.28], pos: [0, 0.5, 0.48], color: '#e0a25c', head: true },   // head
      { size: [0.08, 0.1, 0.06], pos: [-0.09, 0.68, 0.42], color: '#c9853d', head: true }, // ears
      { size: [0.08, 0.1, 0.06], pos: [0.09, 0.68, 0.42], color: '#c9853d', head: true },
      { size: [0.12, 0.09, 0.08], pos: [0, 0.44, 0.65], color: '#f0e0d0', head: true }, // muzzle
      { size: [0.08, 0.08, 0.5], pos: [0, 0.45, -0.55], color: '#c9853d' },             // tail
      leg(-0.1, 0.22, 0.1, 0.25, 0.1, '#c9853d'), leg(0.1, 0.22, 0.1, 0.25, 0.1, '#c9853d'),
      leg(-0.1, -0.25, 0.1, 0.25, 0.1, '#c9853d'), leg(0.1, -0.25, 0.1, 0.25, 0.1, '#c9853d'),
    ],
  },
  black_cat: {
    category: 'passive', health: 12, speed: 2.2, hw: 0.3, h: 0.6,
    tamable: true, tameItem: 'raw_fish', petFoods: ['raw_fish', 'raw_chicken'],
    scaresCreepers: true,
    drops: [],
    parts: [
      { size: [0.32, 0.3, 0.75], pos: [0, 0.38, -0.05], color: '#232228' },             // body (black)
      { size: [0.3, 0.28, 0.28], pos: [0, 0.5, 0.48], color: '#2a2930', head: true },   // head
      { size: [0.08, 0.1, 0.06], pos: [-0.09, 0.68, 0.42], color: '#1a191f', head: true }, // ears
      { size: [0.08, 0.1, 0.06], pos: [0.09, 0.68, 0.42], color: '#1a191f', head: true },
      { size: [0.12, 0.09, 0.08], pos: [0, 0.44, 0.65], color: '#3d3b44', head: true }, // muzzle
      { size: [0.08, 0.08, 0.5], pos: [0, 0.45, -0.55], color: '#1a191f' },             // tail
      leg(-0.1, 0.22, 0.1, 0.25, 0.1, '#1a191f'), leg(0.1, 0.22, 0.1, 0.25, 0.1, '#1a191f'),
      leg(-0.1, -0.25, 0.1, 0.25, 0.1, '#1a191f'), leg(0.1, -0.25, 0.1, 0.25, 0.1, '#1a191f'),
    ],
  },

  villager: {
    // Own category: not in the random passive spawn pool — villagers spawn at
    // their village (MobManager) and stay leashed to it.
    category: 'villager', health: 20, speed: 1.0, hw: 0.35, h: 1.85,
    drops: [],
    parts: [
      leg(-0.11, 0, 0.2, 0.4, 0.2, '#4a3826'), leg(0.11, 0, 0.2, 0.4, 0.2, '#4a3826'),
      { size: [0.56, 0.9, 0.36], pos: [0, 0.84, 0], color: '#8a6d4a' },              // robe
      { size: [0.62, 0.2, 0.44], pos: [0, 1.16, 0.06], color: '#73593b' },           // crossed arms
      { size: [0.5, 0.52, 0.48], pos: [0, 1.56, 0], color: '#c8a17a', head: true },  // big head
      { size: [0.12, 0.26, 0.12], pos: [0, 1.46, 0.3], color: '#b58e67', head: true }, // the nose
      { size: [0.5, 0.1, 0.1], pos: [0, 1.74, 0.22], color: '#6d5639', head: true }, // unibrow
    ],
  },

  // Tycoon lumber worker: a villager cousin in overalls and a hard hat. Own
  // category keeps it out of every spawn pool — TycoonMode is its only
  // spawner. noHit: player clicks pass straight through (raycast skips it),
  // so a busy mill yard can't be griefed or misclicked.
  worker: {
    category: 'worker', health: 20, speed: 1.55, hw: 0.35, h: 1.8, noHit: true,
    gait: 'run',
    drops: [],
    parts: [
      leg(-0.11, 0, 0.2, 0.4, 0.2, '#2e4a6b'), leg(0.11, 0, 0.2, 0.4, 0.2, '#2e4a6b'),
      { size: [0.52, 0.5, 0.34], pos: [0, 0.64, 0], color: '#2e4a6b' },                // overalls
      { size: [0.54, 0.42, 0.36], pos: [0, 1.08, 0], color: '#c8b48a' },               // work shirt
      { size: [0.16, 0.6, 0.2], pos: [-0.36, 1.1, 0], color: '#c8b48a', arm: true },   // arms
      { size: [0.16, 0.6, 0.2], pos: [0.36, 1.1, 0], color: '#c8b48a', arm: true },
      { size: [0.46, 0.46, 0.44], pos: [0, 1.52, 0], color: '#c8a17a', head: true },   // head
      { size: [0.5, 0.14, 0.48], pos: [0, 1.78, 0], color: '#e8c83a', head: true },    // hard hat
      { size: [0.12, 0.22, 0.12], pos: [0, 1.44, 0.28], color: '#b58e67', head: true }, // the nose
    ],
  },

  // Village defender: ignores players, hunts hostiles, hits like a truck.
  iron_golem: {
    category: 'golem', health: 60, speed: 1.1, attack: 8, detect: 16, hw: 0.55, h: 2.4,
    drops: [{ item: 'iron_ingot', count: [1, 2] }],
    parts: [
      leg(-0.2, 0, 0.34, 0.85, 0.34, '#9a958c'), leg(0.2, 0, 0.34, 0.85, 0.34, '#9a958c'),
      { size: [0.95, 0.85, 0.5], pos: [0, 1.3, 0], color: '#c2bdb4' },               // broad torso
      { size: [0.26, 1.0, 0.26], pos: [-0.62, 1.25, 0], color: '#aaa49a' },          // long arms
      { size: [0.26, 1.0, 0.26], pos: [0.62, 1.25, 0], color: '#aaa49a' },
      { size: [0.45, 0.4, 0.42], pos: [0, 1.98, 0], color: '#c2bdb4', head: true },  // head
      { size: [0.1, 0.22, 0.1], pos: [0, 1.9, 0.26], color: '#8a857c', head: true }, // nose
    ],
  },

  // ---- Hostile ----
  zombie: {
    category: 'hostile', health: 20, speed: 1.5, attack: 3, detect: 18, burns: true, huntsVillagers: true, gait: 'shamble', hw: 0.4, h: 1.8,
    drops: [{ item: 'rotten_flesh', count: [0, 2] }],
    parts: [
      leg(-0.13, 0, 0.25, 0.75, 0.25, '#2a3d6b'), leg(0.13, 0, 0.25, 0.75, 0.25, '#2a3d6b'),
      { size: [0.5, 0.7, 0.28], pos: [0, 1.1, 0], color: '#4a7a3a' },
      { size: [0.22, 0.7, 0.22], pos: [-0.36, 1.1, 0], color: '#3b7a3b', arm: true },
      { size: [0.22, 0.7, 0.22], pos: [0.36, 1.1, 0], color: '#3b7a3b', arm: true },
      { size: [0.45, 0.45, 0.45], pos: [0, 1.72, 0], color: '#3b7a3b', head: true },
    ],
  },
  skeleton: {
    category: 'hostile', health: 20, speed: 1.4, attack: 3, detect: 20, burns: true, ranged: true, hw: 0.4, h: 1.8,
    drops: [{ item: 'bone', count: [0, 2] }, { item: 'arrow', count: [1, 3] }],
    parts: [
      leg(-0.12, 0, 0.16, 0.75, 0.16, '#d8d8d8'), leg(0.12, 0, 0.16, 0.75, 0.16, '#d8d8d8'),
      { size: [0.4, 0.7, 0.22], pos: [0, 1.1, 0], color: '#d0d0d0' },
      { size: [0.14, 0.7, 0.14], pos: [-0.32, 1.1, 0], color: '#d8d8d8' },
      { size: [0.14, 0.7, 0.14], pos: [0.32, 1.1, 0], color: '#d8d8d8' },
      { size: [0.42, 0.42, 0.42], pos: [0, 1.72, 0], color: '#e6e6e6', head: true },
    ],
  },
  creeper: {
    // Doesn't melee: closes in, hisses, swells, and detonates (see Mob.update).
    category: 'hostile', health: 20, speed: 1.6, attack: 0, detect: 16, burns: false, exploder: true, hw: 0.35, h: 1.6,
    drops: [{ item: 'gunpowder', count: [1, 2] }],
    parts: [
      leg(-0.16, 0, 0.26, 0.4, 0.3, '#3a7a36'), leg(0.16, 0, 0.26, 0.4, 0.3, '#3a7a36'),
      { size: [0.5, 0.8, 0.34], pos: [0, 0.8, 0], color: '#48a83e' },                // tall body
      { size: [0.48, 0.48, 0.48], pos: [0, 1.44, 0], color: '#48a83e', head: true }, // head
      { size: [0.1, 0.14, 0.02], pos: [-0.11, 1.5, 0.25], color: '#1a1a1a', head: true }, // eyes
      { size: [0.1, 0.14, 0.02], pos: [0.11, 1.5, 0.25], color: '#1a1a1a', head: true },
      { size: [0.14, 0.2, 0.02], pos: [0, 1.32, 0.25], color: '#1a1a1a', head: true },    // that mouth
    ],
  },
  spider: {
    category: 'hostile', health: 16, speed: 2.0, attack: 2, detect: 16, burns: false, climbs: true, hw: 0.7, h: 0.7,
    drops: [{ item: 'string', count: [0, 2] }],
    parts: [
      { size: [0.9, 0.5, 1.0], pos: [0, 0.45, -0.3], color: '#2b2b2b' },
      { size: [0.55, 0.45, 0.55], pos: [0, 0.45, 0.55], color: '#353535', head: true },
      leg(-0.7, 0.3, 0.7, 0.1, 0.12, '#1f1f1f'), leg(0.7, 0.3, 0.7, 0.1, 0.12, '#1f1f1f'),
      leg(-0.7, 0, 0.7, 0.1, 0.12, '#1f1f1f'), leg(0.7, 0, 0.7, 0.1, 0.12, '#1f1f1f'),
      leg(-0.7, -0.3, 0.7, 0.1, 0.12, '#1f1f1f'), leg(0.7, -0.3, 0.7, 0.1, 0.12, '#1f1f1f'),
    ],
  },

  // ---- Zombies arena specials ----
  // `arenaOnly: true` keeps these out of the survival HOSTILE spawn pool —
  // the Zombies wave director spawns them by name. Category stays 'hostile'
  // so the hunt-the-player AI applies.
  sprinter: {
    category: 'hostile', arenaOnly: true, health: 12, speed: 3.2, attack: 2, detect: 20, burns: false, gait: 'run', hw: 0.35, h: 1.7,
    drops: [{ item: 'rotten_flesh', count: [0, 1] }],
    parts: [ // gaunt runner: thin legs, hunched pale torso, red eyes
      leg(-0.11, 0, 0.18, 0.85, 0.18, '#3a3a44'), leg(0.11, 0, 0.18, 0.85, 0.18, '#3a3a44'),
      { size: [0.42, 0.6, 0.24], pos: [0, 1.15, 0.06], color: '#8a9a72' },
      { size: [0.16, 0.6, 0.16], pos: [-0.3, 1.1, 0.1], color: '#7d8d66', arm: true },
      { size: [0.16, 0.6, 0.16], pos: [0.3, 1.1, 0.1], color: '#7d8d66', arm: true },
      { size: [0.36, 0.36, 0.36], pos: [0, 1.55, 0.12], color: '#93a37b', head: true },
      { size: [0.1, 0.06, 0.02], pos: [-0.09, 1.6, 0.31], color: '#c23a2a', head: true },
      { size: [0.1, 0.06, 0.02], pos: [0.09, 1.6, 0.31], color: '#c23a2a', head: true },
    ],
  },
  brute: {
    category: 'hostile', arenaOnly: true, health: 80, speed: 1.0, attack: 8, detect: 20, burns: false, breaksBlocks: true, gait: 'heavy', hw: 0.6, h: 2.6,
    drops: [{ item: 'rotten_flesh', count: [1, 3] }],
    parts: [ // hulking mini-boss: slab torso, gorilla arms, sunken head
      leg(-0.24, 0, 0.4, 0.9, 0.4, '#4a4438'), leg(0.24, 0, 0.4, 0.9, 0.4, '#4a4438'),
      { size: [1.15, 1.0, 0.6], pos: [0, 1.45, 0], color: '#6b7a4a' },
      { size: [0.34, 1.1, 0.34], pos: [-0.78, 1.35, 0], color: '#5d6c40', arm: true },
      { size: [0.34, 1.1, 0.34], pos: [0.78, 1.35, 0], color: '#5d6c40', arm: true },
      { size: [0.5, 0.45, 0.48], pos: [0, 2.2, 0.08], color: '#77865a', head: true },
      { size: [0.3, 0.12, 0.04], pos: [0, 2.1, 0.32], color: '#2a2a22', head: true },
    ],
  },
  spitter: {
    category: 'hostile', arenaOnly: true, health: 18, speed: 1.3, attack: 4, detect: 24, burns: false, ranged: true, projectile: 'acid', gait: 'shamble', hw: 0.45, h: 1.6,
    drops: [{ item: 'rotten_flesh', count: [0, 2] }],
    parts: [ // bloated acid belly, hunched, glowing maw
      leg(-0.14, 0, 0.2, 0.55, 0.2, '#4c5a30'), leg(0.14, 0, 0.2, 0.55, 0.2, '#4c5a30'),
      { size: [0.7, 0.6, 0.55], pos: [0, 0.9, 0], color: '#7fb43a' },
      { size: [0.4, 0.4, 0.4], pos: [0, 1.4, 0.2], color: '#5f8a2a', head: true },
      { size: [0.2, 0.16, 0.1], pos: [0, 1.28, 0.44], color: '#b8e04a', head: true },
    ],
  },
  screamer: {
    category: 'hostile', arenaOnly: true, health: 25, speed: 1.2, attack: 1, detect: 24, burns: false, keepsDistance: true, gait: 'raised', hw: 0.4, h: 1.9,
    drops: [],
    parts: [ // tall bone-pale banshee, arms raised, huge black mouth
      leg(-0.12, 0, 0.2, 0.8, 0.2, '#8a8378'), leg(0.12, 0, 0.2, 0.8, 0.2, '#8a8378'),
      { size: [0.46, 0.75, 0.26], pos: [0, 1.18, 0], color: '#c9c2b8' },
      { size: [0.18, 0.7, 0.18], pos: [-0.34, 1.25, 0], color: '#b5aea2', arm: true },
      { size: [0.18, 0.7, 0.18], pos: [0.34, 1.25, 0], color: '#b5aea2', arm: true },
      { size: [0.44, 0.48, 0.44], pos: [0, 1.82, 0], color: '#d8d1c6', head: true },
      { size: [0.22, 0.28, 0.04], pos: [0, 1.76, 0.24], color: '#0d0d0d', head: true },
    ],
  },
  charger: {
    // Winds up, then rockets in a locked straight line (sidestep to dodge!).
    // A clean hit is full damage plus a huge shove; a wall stops it cold.
    category: 'hostile', arenaOnly: true, health: 45, speed: 1.4, attack: 6, detect: 24, burns: false, charges: true, gait: 'heavy', hw: 0.5, h: 2.0,
    drops: [{ item: 'rotten_flesh', count: [0, 2] }],
    parts: [ // lopsided bruiser: one massive club arm, one withered stub
      leg(-0.18, 0, 0.28, 0.7, 0.28, '#6a5a50'), leg(0.18, 0, 0.28, 0.7, 0.28, '#6a5a50'),
      { size: [0.8, 0.75, 0.5], pos: [0, 1.15, 0], color: '#9a7a6a' },
      { size: [0.12, 0.5, 0.12], pos: [-0.5, 1.25, 0], color: '#7a5f52', arm: true },
      { size: [0.46, 1.15, 0.46], pos: [0.62, 1.05, 0], color: '#8a6a5a', arm: true },
      { size: [0.34, 0.34, 0.34], pos: [-0.14, 1.72, 0.08], color: '#9a7a6a', head: true },
      { size: [0.08, 0.05, 0.02], pos: [-0.14, 1.76, 0.26], color: '#d8c24a', head: true },
    ],
  },
  tank: {
    // Every-10th-wave boss: a wall of meat that smashes fortifications and
    // hurls rocks at anyone out of punching range.
    category: 'hostile', arenaOnly: true, health: 250, speed: 1.9, attack: 10, detect: 28, burns: false, breaksBlocks: true, throwsRocks: true, gait: 'heavy', hw: 0.7, h: 2.8,
    drops: [{ item: 'rotten_flesh', count: [2, 5] }],
    parts: [ // top-heavy colossus: shoulder slab, ape arms, sunken little head
      leg(-0.3, 0, 0.42, 0.85, 0.42, '#5a5a56'), leg(0.3, 0, 0.42, 0.85, 0.42, '#5a5a56'),
      { size: [1.4, 1.15, 0.75], pos: [0, 1.45, 0], color: '#8a8a80' },
      { size: [1.65, 0.4, 0.8], pos: [0, 2.1, 0], color: '#94948a' },
      { size: [0.48, 1.35, 0.48], pos: [-1.0, 1.35, 0], color: '#7d7d74', arm: true },
      { size: [0.48, 1.35, 0.48], pos: [1.0, 1.35, 0], color: '#7d7d74', arm: true },
      { size: [0.42, 0.4, 0.4], pos: [0, 2.5, 0.16], color: '#8a8a80', head: true },
      { size: [0.26, 0.08, 0.03], pos: [0, 2.52, 0.37], color: '#2a2a26', head: true },
    ],
  },

  // ---- Cave ambient ----
  // Bats are harmless ambient creatures that flutter through dark underground
  // pockets. `category: 'ambient'` keeps them out of the surface passive
  // spawner (they spawn via the cave pass in MobManager), and `flies` swaps
  // gravity for a flapping bob in Mob physics. Their tiny box parts keep the
  // draw cost negligible.
  bat: {
    category: 'ambient', health: 6, speed: 3.5, hw: 0.25, h: 0.5, flies: true,
    drops: [],
    // Compact folded-wing silhouette: body, two small ear nubs, two wing panels.
    parts: [
      { size: [0.28, 0.22, 0.18], pos: [0, 0.22, 0], color: '#1a1a22' },           // body
      { size: [0.08, 0.10, 0.06], pos: [-0.09, 0.32, 0], color: '#2a2030' },       // left ear
      { size: [0.08, 0.10, 0.06], pos: [0.09, 0.32, 0], color: '#2a2030' },        // right ear
      { size: [0.32, 0.04, 0.14], pos: [-0.30, 0.20, 0], color: '#12121a', leg: true }, // left wing
      { size: [0.32, 0.04, 0.14], pos: [0.30, 0.20, 0], color: '#12121a', leg: true },  // right wing
    ],
  },
};

export const PASSIVE = Object.keys(MOBS).filter((k) => MOBS[k].category === 'passive');
// arenaOnly specials (Zombies mode) never enter the survival spawn pool.
export const HOSTILE = Object.keys(MOBS).filter((k) => MOBS[k].category === 'hostile' && !MOBS[k].arenaOnly);
// Cave-hostile pool: existing hostile types that work underground. Zombies and
// skeletons burn in daylight, but the burn check requires open sky, so a rock
// roof keeps them safe down here. Bats spawn through the same cave pass but as
// harmless ambience, outside this pool.
export const CAVE_HOSTILE = ['zombie', 'skeleton', 'creeper', 'spider'];
