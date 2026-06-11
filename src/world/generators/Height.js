import { WORLD_HEIGHT, SEA_LEVEL } from '../../config.js';
import { Noise } from '../noise.js';

const smoothstep = (a, b, x) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

// The terrain heightfield — extracted into its own module (depends only on
// noise + config) so structure planning (villages) can query terrain shape
// without importing the whole chunk generator, and so it stays node-testable.
//
// A continuous heightfield — deliberately NOT keyed to the discrete biome, so
// there are no cliffs at biome borders. Shape comes from independent fields:
//   • domain-warped continental field -> organic coastlines, shelves, basins
//   • erosion field                    -> flat lowlands vs. rugged country
//   • rolling fBm hills (scaled by erosion, fading at the coast)
//   • mountain mask × ridged fBm       -> connected ridge lines that taper
//     smoothly into foothills instead of jumping up at a seam
//   • river field                      -> winding channels with soft banks
export function columnHeight(worldX, worldZ) {
  // Warp the sampling domain so large shapes swirl organically.
  const wx = worldX + Noise.warpX(worldX, worldZ) * 55;
  const wz = worldZ + Noise.warpZ(worldX, worldZ) * 55;

  const cont = Noise.continent(wx, wz) + 0.08;    // -1..1, biased slightly to land
  // Continental shelf: deep ocean floor -> coast -> inland plain. Smoothsteps
  // keep the shoreline gradient gentle (real beaches, no plunging cliffs).
  let h = lerp(SEA_LEVEL - 24, SEA_LEVEL - 4, smoothstep(-1.0, -0.18, cont));
  h = lerp(h, SEA_LEVEL + 5, smoothstep(-0.18, 0.12, cont));
  const land = smoothstep(-0.12, 0.1, cont);      // 0 at sea, 1 inland

  // Erosion: how rugged this region is (0 = plains/flats, 1 = hilly).
  const ero = (Noise.erosion(worldX, worldZ) + 1) / 2;

  // Rolling hills — bigger where erosion is high, muted near the coast.
  h += Noise.terrain(worldX, worldZ) * (2.5 + 13 * ero) * (0.25 + 0.75 * land);

  // Mountain ranges: a dedicated low-frequency mask picks where ranges live;
  // ridged fBm shapes connected crests. pow() keeps foothills gentle and lets
  // peaks spike, and the mask tapers everything smoothly to zero at the edges.
  const mMask = smoothstep(0.12, 0.55, Noise.mountain(wx, wz)) * land * (0.35 + 0.65 * ero);
  if (mMask > 0.004) {
    const ridge = Noise.ridge(worldX, worldZ);    // 0..1 crest lines
    h += mMask * (6 + Math.pow(ridge, 1.35) * 52);
  }

  // Rivers: carve wide winding channels with a bed a few blocks below sea level
  // so water actually fills them. Width breathes along the course, and banks
  // blend back into the terrain. Mountains pinch rivers off (no canyon slots).
  if (h > SEA_LEVEL - 1 && mMask < 0.45) {
    const RIVER_W = 0.07 + 0.05 * ((Noise.detail(worldX, worldZ, 0.0016) + 1) / 2);
    const rv = Math.abs(Noise.river(worldX, worldZ));
    if (rv < RIVER_W) {
      const t = rv / RIVER_W;       // 0 at the centre line, 1 at the bank
      const carve = (1 - t * t) * (1 - mMask / 0.45);
      const bed = SEA_LEVEL - 3;    // riverbed below sea level -> holds ~3 of water
      h -= carve * Math.max(0, h - bed);
    }
  }

  return Math.max(2, Math.min(WORLD_HEIGHT - 6, Math.floor(h)));
}
