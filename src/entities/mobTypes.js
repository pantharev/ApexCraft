// Mob definitions: stats, loot, collision box (hw = half-width, h = height in
// blocks), and a list of box parts for the placeholder model. Part pos is the
// box centre relative to the mob's feet; `leg: true` parts swing while walking.

const leg = (x, z, w, h, d, color) => ({ size: [w, h, d], pos: [x, h / 2, z], color, leg: true });

export const MOBS = {
  // ---- Passive ----
  pig: {
    category: 'passive', health: 10, speed: 1.6, hw: 0.45, h: 0.9,
    drops: [{ item: 'raw_porkchop', count: [1, 3] }],
    parts: [
      { size: [0.9, 0.55, 1.2], pos: [0, 0.55, 0], color: '#e8a0a0' },
      { size: [0.5, 0.5, 0.5], pos: [0, 0.6, 0.75], color: '#e8a0a0' },
      { size: [0.25, 0.2, 0.12], pos: [0, 0.5, 1.0], color: '#d77f7f' },
      leg(-0.28, 0.4, 0.22, 0.35, 0.22, '#d98f8f'), leg(0.28, 0.4, 0.22, 0.35, 0.22, '#d98f8f'),
      leg(-0.28, -0.4, 0.22, 0.35, 0.22, '#d98f8f'), leg(0.28, -0.4, 0.22, 0.35, 0.22, '#d98f8f'),
    ],
  },
  cow: {
    category: 'passive', health: 10, speed: 1.3, hw: 0.45, h: 1.3,
    drops: [{ item: 'raw_beef', count: [1, 3] }, { item: 'leather', count: [0, 2] }],
    parts: [
      { size: [0.95, 0.7, 1.3], pos: [0, 0.8, 0], color: '#5a4632' },
      { size: [0.55, 0.55, 0.55], pos: [0, 0.95, 0.85], color: '#46341f' },
      leg(-0.3, 0.45, 0.25, 0.55, 0.25, '#4a3826'), leg(0.3, 0.45, 0.25, 0.55, 0.25, '#4a3826'),
      leg(-0.3, -0.45, 0.25, 0.55, 0.25, '#4a3826'), leg(0.3, -0.45, 0.25, 0.55, 0.25, '#4a3826'),
    ],
  },
  sheep: {
    category: 'passive', health: 8, speed: 1.3, hw: 0.45, h: 1.1,
    drops: [{ item: 'wool', count: [1, 1] }, { item: 'raw_mutton', count: [1, 2] }],
    parts: [
      { size: [1.0, 0.75, 1.15], pos: [0, 0.7, 0], color: '#eeeeee' },
      { size: [0.45, 0.45, 0.5], pos: [0, 0.78, 0.7], color: '#d9cab5' },
      leg(-0.3, 0.35, 0.22, 0.45, 0.22, '#c8b9a0'), leg(0.3, 0.35, 0.22, 0.45, 0.22, '#c8b9a0'),
      leg(-0.3, -0.35, 0.22, 0.45, 0.22, '#c8b9a0'), leg(0.3, -0.35, 0.22, 0.45, 0.22, '#c8b9a0'),
    ],
  },
  chicken: {
    category: 'passive', health: 4, speed: 1.2, hw: 0.25, h: 0.7,
    drops: [{ item: 'raw_chicken', count: [1, 1] }, { item: 'feather', count: [0, 2] }],
    parts: [
      { size: [0.4, 0.4, 0.5], pos: [0, 0.35, 0], color: '#f0f0f0' },
      { size: [0.3, 0.3, 0.3], pos: [0, 0.6, 0.22], color: '#f0f0f0' },
      { size: [0.12, 0.1, 0.14], pos: [0, 0.58, 0.42], color: '#e0a83a' },
      leg(-0.12, 0, 0.08, 0.2, 0.08, '#e0a83a'), leg(0.12, 0, 0.08, 0.2, 0.08, '#e0a83a'),
    ],
  },

  // ---- Hostile ----
  zombie: {
    category: 'hostile', health: 20, speed: 1.5, attack: 3, detect: 18, burns: true, hw: 0.4, h: 1.8,
    drops: [{ item: 'rotten_flesh', count: [0, 2] }],
    parts: [
      leg(-0.13, 0, 0.25, 0.75, 0.25, '#2a3d6b'), leg(0.13, 0, 0.25, 0.75, 0.25, '#2a3d6b'),
      { size: [0.5, 0.7, 0.28], pos: [0, 1.1, 0], color: '#4a7a3a' },
      { size: [0.22, 0.7, 0.22], pos: [-0.36, 1.1, 0], color: '#3b7a3b' },
      { size: [0.22, 0.7, 0.22], pos: [0.36, 1.1, 0], color: '#3b7a3b' },
      { size: [0.45, 0.45, 0.45], pos: [0, 1.72, 0], color: '#3b7a3b' },
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
      { size: [0.42, 0.42, 0.42], pos: [0, 1.72, 0], color: '#e6e6e6' },
    ],
  },
  spider: {
    category: 'hostile', health: 16, speed: 2.0, attack: 2, detect: 16, burns: false, climbs: true, hw: 0.7, h: 0.7,
    drops: [{ item: 'string', count: [0, 2] }],
    parts: [
      { size: [0.9, 0.5, 1.0], pos: [0, 0.45, -0.3], color: '#2b2b2b' },
      { size: [0.55, 0.45, 0.55], pos: [0, 0.45, 0.55], color: '#353535' },
      leg(-0.7, 0.3, 0.7, 0.1, 0.12, '#1f1f1f'), leg(0.7, 0.3, 0.7, 0.1, 0.12, '#1f1f1f'),
      leg(-0.7, 0, 0.7, 0.1, 0.12, '#1f1f1f'), leg(0.7, 0, 0.7, 0.1, 0.12, '#1f1f1f'),
      leg(-0.7, -0.3, 0.7, 0.1, 0.12, '#1f1f1f'), leg(0.7, -0.3, 0.7, 0.1, 0.12, '#1f1f1f'),
    ],
  },
};

export const PASSIVE = Object.keys(MOBS).filter((k) => MOBS[k].category === 'passive');
export const HOSTILE = Object.keys(MOBS).filter((k) => MOBS[k].category === 'hostile');
