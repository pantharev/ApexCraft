import { WORLD_HEIGHT, SEA_LEVEL } from '../../config.js';
import { Noise } from '../noise.js';

// The shape of the land for generator version 2 (see noise.js on versions;
// version 1 is Height.js and must not change).
//
// Version 1 was one smooth heightfield: hills everywhere, a mountain where a
// mask said so. Here the land is built from distinct landforms, each from its
// own field, the way Minecraft's is:
//   • a continental profile — deep ocean, shelf, a coast with real beaches,
//     lowlands, interior highlands;
//   • erosion — flat country against rugged country, which scales the hills;
//   • plateau country — highlands that step up in flat benches with cliffs
//     between them;
//   • mountain ranges — ridged crests with sharp detail on top, tapering into
//     foothills, squashed gently under the world's ceiling instead of clipped;
//   • rivers — a channel at sea level in a valley it has cut wider than
//     itself, narrowing to a gorge in the ranges;
//   • climate shaping — swamps settle to the waterline, deserts ripple into
//     dunes.
// Terrain2.js turns this into blocks, and adds ledges and overhangs where it
// is steep.

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smoothstep = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// A curve through [x, y] points, straight between them and flat beyond.
function curve(points, x) {
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) {
      const p = points[i - 1], q = points[i];
      return p[1] + ((q[1] - p[1]) * (x - p[0])) / (q[0] - p[0]);
    }
  }
  return points[points.length - 1][1];
}

// Height relative to sea level against continentalness: abyss, slope, shelf,
// a long shallow run through the waterline (the beach), then land that keeps
// rising slowly inland.
const SHELF = [
  [-1.0, -30], [-0.6, -27], [-0.32, -14], [-0.15, -6], [-0.05, -2],
  [0.03, 1.6], [0.12, 4.5], [0.3, 9], [0.6, 16], [1.0, 22],
];

const CEILING = WORLD_HEIGHT - 8; // the highest a peak is squashed toward
const SQUASH_FROM = 100;          // heights above this are compressed

// Everything Terrain2 wants to know about a column. `out` is filled and
// returned (pass the same object to avoid allocating one per column).
//   h      height of the surface, unrounded
//   mtn    0..1, how much this is mountain range
//   plat   0..1, how much this is plateau country
//   rug    0..1, how rugged the region is
//   temp, humid  climate, -1..1
export function landform(x, z, out) {
  // Warp the sampling domain so large shapes swirl organically.
  const wx = x + Noise.warpX(x, z) * 55;
  const wz = z + Noise.warpZ(x, z) * 55;

  const cont = Noise.continent(wx, wz) + 0.08; // biased slightly to land
  const land = smoothstep(-0.06, 0.12, cont);  // 0 at sea, 1 inland
  const rug = (Noise.erosion(x, z) + 1) / 2;
  const temp = Noise.temperature(x, z), humid = Noise.humidity(x, z);
  let h = SEA_LEVEL + curve(SHELF, cont);

  // Hills: a broad swell everywhere inland, finer relief where it is rugged.
  h += Noise.terrain(x, z, 3, 0.0032) * 6 * land;
  h += Noise.terrain(x, z) * (2 + 18 * rug * Math.sqrt(rug)) * (0.2 + 0.8 * land);

  // Plateau country: lift the land, then pull it onto flat benches a few
  // blocks apart. The riser between two benches is a cliff; a little noise
  // on where the steps fall makes the cliff lines wander.
  const plat = smoothstep(0.0, 0.36, Noise.plateau(wx, wz)) * land;
  if (plat > 0.01) {
    h += plat * 14;
    const STEP = 7, base = SEA_LEVEL + 5;
    const t = (h - base) / STEP + Noise.detail(x, z, 0.018) * 0.22;
    if (t > 0) {
      const f = Math.floor(t);
      h = lerp(h, base + (f + smoothstep(0.43, 0.57, t - f)) * STEP, plat * 0.92);
    }
  }

  // Mountain ranges: a low-frequency mask picks where they live, ridged noise
  // shapes connected crests, and a finer ridged field roughens the crests
  // themselves. pow() keeps the foothills gentle and lets the peaks spike.
  const mtn = smoothstep(0.02, 0.46, Noise.mountain(wx, wz)) * land * (0.45 + 0.55 * rug);
  if (mtn > 0.004) {
    const ridge = Noise.ridge(x, z); // 0..1 crest lines
    h += mtn * (7 + Math.pow(ridge, 1.5) * 56);
    h += mtn * ridge * (Noise.jag(x, z) - 0.35) * 9;
  }

  // Swamp: wet temperate lowland settles to the waterline, so it breaks up
  // into pools and hummocks.
  const temperate = smoothstep(-0.46, -0.34, temp) * (1 - smoothstep(0.24, 0.36, temp));
  const swamp = temperate * smoothstep(0.04, 0.26, humid) * (1 - smoothstep(SEA_LEVEL + 3, SEA_LEVEL + 9, h))
    * land * (1 - mtn);
  if (swamp > 0.01) h = lerp(h, SEA_LEVEL + 0.55 + Noise.detail(x, z, 0.06) * 1.4, swamp * 0.85);

  // Desert: long dunes, all running one way.
  const desert = smoothstep(0.26, 0.4, temp) * smoothstep(0.06, -0.08, humid) * land * (1 - mtn);
  if (desert > 0.01) h += desert * (1 - 2 * Math.abs(Noise.detail(x, z * 0.35, 0.034))) * 2.6;

  // Rivers. The channel is the centre band of the river field; around it the
  // land is drawn down into a valley several times wider, so a river has
  // banks and a floodplain instead of being a slot in a hillside. High in the
  // ranges both narrow, to a gorge and then to nothing.
  if (h > SEA_LEVEL - 1) {
    const reach = 1 - smoothstep(0.4, 0.8, mtn);
    if (reach > 0) {
      // (The river field is read at a coarser scale than version 1 read it:
      // fewer rivers, further apart.)
      const width = (0.034 + 0.026 * ((Noise.detail(x, z, 0.0016) + 1) / 2)) * (0.45 + 0.55 * reach);
      const rv = Math.abs(Noise.river(x * 0.62, z * 0.62));
      const valley = smoothstep(width * 4, width, rv) * reach;
      if (valley > 0) {
        const floor = SEA_LEVEL + 1.5 + (h - SEA_LEVEL) * 0.22;
        if (h > floor) h = lerp(h, floor, valley * 0.8);
        if (rv < width) {
          const t = rv / width; // 0 at the centre line, 1 at the bank
          h -= (1 - t * t) * reach * Math.max(0, h - (SEA_LEVEL - 3)); // bed below sea level: it holds water
        }
      }
    }
  }

  // Peaks are squashed toward the ceiling, not cut off flat at it.
  if (h > SQUASH_FROM) {
    const room = CEILING - SQUASH_FROM;
    h = SQUASH_FROM + room * (1 - Math.exp(-(h - SQUASH_FROM) / room));
  }
  if (h < 2) h = 2;

  out.h = h;
  out.mtn = mtn;
  out.plat = plat;
  out.rug = rug;
  out.temp = temp;
  out.humid = humid;
  return out;
}

const scratch = { h: 0, mtn: 0, plat: 0, rug: 0, temp: 0, humid: 0 };

// The surface height of a column (the block the ground's top face belongs to).
// Where the ground is steep Terrain2 moves the real surface a few blocks
// either way; everywhere else this is exact.
export function heightV2(x, z) {
  return Math.floor(landform(x, z, scratch).h);
}
