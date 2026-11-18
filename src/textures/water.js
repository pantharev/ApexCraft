import * as THREE from 'three';
import { SEA_LEVEL, WATER_DROP } from '../config.js';

// Water: the material chunk meshes draw their water with, and what the terrain
// shader does to ground that lies under it. Like the block textures it is all
// generated — the surface is a few lines of noise evaluated on the texel grid
// (16 to a block), so it moves, but it moves as pixel art.
//
// The mesher supplies two things (core/ChunkMesher.js): a `depth` attribute on
// water vertices — 0 at the shore, 1 in deep water — and a "wet" mark on
// terrain faces that look into water.

// One set of uniforms drives every material that takes part. tickWater() keeps
// them current; the materials hold these same objects, so nothing else has to
// be told.
export const WATER = {
  time: { value: 0 },
  level: { value: SEA_LEVEL + 1 - WATER_DROP }, // world height of the sea's surface
  skyLow: { value: new THREE.Color('#b6d4f0') },  // what the surface mirrors toward the horizon...
  skyHigh: { value: new THREE.Color('#3a7bd5') }, // ...and overhead
  sunDir: { value: new THREE.Vector3(0, 1, 0) },  // toward the sun or moon
  sunColor: { value: new THREE.Color(0, 0, 0) },  // colour and strength of its glitter
  caustics: { value: 0 },                         // strength of the light playing on the bed
  dim: { value: 1 },                              // the water's own colour, turned down at night
  shallow: { value: new THREE.Color('#42b3cf') },
  deep: { value: new THREE.Color('#12418c') },
};

// Advance the water and match it to the sky. Called once a frame by whoever
// owns the scene (Game, Backdrop).
export function tickWater(dt, dayNight) {
  WATER.time.value = (WATER.time.value + dt) % 3600; // wrapped so the shader's floats stay precise
  const sky = dayNight.sky.uniforms;
  WATER.skyLow.value.copy(sky.uHorizon.value);
  WATER.skyHigh.value.copy(sky.uZenith.value);
  WATER.sunDir.value.copy(dayNight.lightDir);
  const light = dayNight.sun;
  WATER.sunColor.value.copy(light.color).multiplyScalar(Math.min(1, light.intensity / 2.5));
  // The night light is kept bright so the game stays playable, which makes
  // lit water glow; pull its own colour down as the day fades.
  WATER.dim.value = 0.62 + 0.38 * dayNight.dayAmt;
  // Sunlight only: the moon is too faint to focus into patterns.
  WATER.caustics.value = dayNight.dayAmt * Math.min(1, light.intensity / 2.5);
}

// Hash and value noise shared by the water and terrain shaders.
export const GLSL_NOISE = /* glsl */`
float tileHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33);
  return fract((p.x + p.y) * p.z);
}
float tileNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = tileHash(vec3(i, 7.0)), b = tileHash(vec3(i + vec2(1.0, 0.0), 7.0));
  float c = tileHash(vec3(i + vec2(0.0, 1.0), 7.0)), d = tileHash(vec3(i + vec2(1.0, 1.0), 7.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}`;

// --- Ground under water (spliced into the terrain shader by atlas.js) -----------
// Expects, in scope: tileWet (0/1), sampledDiffuseColor, vTilePos, vTileN, vColor.
export const WET_PARS = /* glsl */`
uniform float waterTime;
uniform float waterLevel;
uniform float waterCaustics;`;

export const WET_GROUND = /* glsl */`
  if (tileWet > 0.5) {
    // Water takes the light on its way down: the deeper the ground, the
    // darker and bluer it is. (Depth is measured from sea level; a pond up a
    // hill just reads as shallow.)
    float wetDepth = clamp((waterLevel - vTilePos.y) / 9.0, 0.0, 1.0);
    sampledDiffuseColor.rgb *= mix(vec3(0.92, 0.98, 1.0), vec3(0.3, 0.55, 0.72), wetDepth);
    // The ripples above bend sunlight into bright lines that wander over
    // upward faces: where two drifting noise fields cross.
    vec2 wetP = floor(vTilePos.xz * 16.0 + 0.001) / 16.0;
    float wetA = tileNoise(wetP * 0.85 + vec2(waterTime * 0.23, waterTime * 0.14));
    float wetB = tileNoise(wetP * 0.85 + vec2(-waterTime * 0.19, waterTime * 0.21) + 19.3);
    float wetLines = smoothstep(0.07, 0.0, abs(wetA - wetB));
    sampledDiffuseColor.rgb += wetLines * waterCaustics * (1.0 - wetDepth * 0.8) * max(vTileN.y, 0.0) * vColor.r * 0.45;
  }`;

// --- The surface ----------------------------------------------------------------
const SURFACE_VERTEX_PARS = /* glsl */`
attribute float depth;
varying float vWaterDepth;
varying vec3 vWaterPos;
varying vec3 vWaterN;`;

const SURFACE_FRAGMENT_PARS = /* glsl */`
uniform float waterTime;
uniform vec3 waterSkyLow;
uniform vec3 waterSkyHigh;
uniform vec3 waterSunDir;
uniform vec3 waterSunColor;
uniform vec3 waterShallow;
uniform vec3 waterDeep;
uniform float waterDim;
varying float vWaterDepth;
varying vec3 vWaterPos;
varying vec3 vWaterN;
${GLSL_NOISE}
// Height of the swell: a slow broad layer and a quicker fine one, drifting
// across each other. Both are stretched along x, so their crests are long
// wavelets running one way rather than round blobs.
float waterSwell(vec2 p) {
  return tileNoise(vec2(p.x * 0.2, p.y * 0.62) + vec2(waterTime * 0.05, waterTime * 0.11)) * 0.6
       + tileNoise(vec2(p.x * 0.55, p.y * 1.7) + vec2(-waterTime * 0.07, waterTime * 0.21) + 31.7) * 0.4;
}`;

// Replaces three's <map_fragment>: the water's own colour and opacity. Left in
// main()'s scope on purpose — SURFACE_LIGHT below reads these.
const SURFACE_COLOR = /* glsl */`
  float waterFlat = step(0.5, abs(vWaterN.y)); // a horizontal face...
  float waterTop = step(0.5, vWaterN.y);       // ...and specifically the surface, facing up
  // Sampled on the texel grid so the motion stays pixel art. Side faces — a
  // waterfall — run the same pattern downward, turned so its long wavelets
  // become falling streaks.
  vec2 waterP = mix(vec2(vWaterPos.y * 0.6 + waterTime * 2.2, vWaterPos.x + vWaterPos.z), vWaterPos.xz, waterFlat);
  waterP = floor(waterP * 16.0 + 0.001) / 16.0;
  float waterH = waterSwell(waterP);
  vec2 waterSlope = vec2(waterSwell(waterP + vec2(0.0625, 0.0)), waterSwell(waterP + vec2(0.0, 0.0625))) - waterH;
  vec3 waterNormal = normalize(vec3(-waterSlope.x * 3.5, 1.0, -waterSlope.y * 3.5));
  float waterDeepness = clamp(vWaterDepth, 0.0, 1.0);
  vec3 waterColor = mix(waterShallow, waterDeep, waterDeepness) * (0.9 + 0.2 * waterH) * waterDim;
  // Pale lines along the crests of the swell, so the surface reads as moving
  // water from straight above too (where there is little sky to mirror).
  float waterCrest = smoothstep(0.6, 0.66, waterH) - smoothstep(0.66, 0.74, waterH);
  waterColor += waterCrest * 0.05 * (1.0 + waterDeepness);
  // Falling water: stronger light and dark, and white where it runs fastest.
  float waterFall = (1.0 - waterFlat) * smoothstep(0.52, 0.8, waterH);
  waterColor = mix(waterColor * (1.0 - 0.25 * (1.0 - waterFlat)), vec3(0.86, 0.94, 1.0), waterFall * 0.55);
  // Foam where the water meets the shore; its edge creeps in and out with the swell.
  float waterFoam = waterTop * smoothstep(0.3, 0.12, waterDeepness + (waterH - 0.5) * 0.3);
  waterColor = mix(waterColor, vec3(0.9, 0.96, 1.0), waterFoam * 0.7);
  diffuseColor.rgb = waterColor;
  diffuseColor.a = max(mix(0.6, 0.9, waterDeepness), waterFoam * 0.85);`;

// Goes in just before three's <opaque_fragment>, after the diffuse lighting:
// what the surface mirrors.
const SURFACE_LIGHT = /* glsl */`
  {
    vec3 waterV = normalize(cameraPosition - vWaterPos);
    // How much open sky is over this water (the mesher's skylight, in the
    // vertex colour): a pool in a cave has nothing to mirror.
    float waterSky = clamp(vColor.r * 1.5 - 0.25, 0.0, 1.0);
    // Which side of the face the eye is on. (Not gl_FrontFacing: three draws a
    // double-sided transparent mesh in two passes and flips the winding for
    // the back one, so there every fragment claims to be front-facing.)
    if (dot(waterV, vWaterN) > 0.0) {
      vec3 waterFace = mix(vWaterN, waterNormal, waterTop);
      // The lower the eye, the more sky and the less bottom you see.
      float waterFresnel = pow(1.0 - clamp(dot(waterV, waterFace), 0.0, 1.0), 4.0);
      vec3 waterR = reflect(-waterV, waterFace);
      vec3 waterMirror = mix(waterSkyLow, waterSkyHigh, clamp(waterR.y * 1.3, 0.0, 1.0)) * waterSky;
      float waterShine = waterFresnel * 0.7 * (1.0 - waterFoam);
      outgoingLight = mix(outgoingLight, waterMirror, waterShine);
      // Glitter toward the sun or moon, only where its light actually lands.
      vec3 waterDirect = reflectedLight.directDiffuse;
      float waterLit = clamp(max(waterDirect.r, max(waterDirect.g, waterDirect.b)) * 60.0, 0.0, 1.0);
      // (A hard threshold on a tight highlight: a scatter of small sparkles,
      // one texel each, rather than a soft glow.)
      float waterGlint = smoothstep(0.45, 0.8, pow(max(dot(waterR, waterSunDir), 0.0), 260.0)) * waterTop * waterLit;
      outgoingLight += waterSunColor * waterGlint * 1.6;
      diffuseColor.a = clamp(mix(diffuseColor.a, 0.97, waterShine) + waterGlint, 0.0, 1.0);
    } else {
      // From underneath. Straight up, the sky shows through a bright window
      // that the swell breaks into moving bands of light; out toward the
      // edges the surface turns into a mirror of the dark water below.
      float waterWindow = smoothstep(0.5, 0.82, abs(waterV.y));
      float waterBand = smoothstep(0.38, 0.72, waterH);
      vec3 waterAbove = mix(waterSkyLow, waterSkyHigh, 0.35) * waterSky * (0.55 + 0.9 * waterBand);
      outgoingLight = mix(waterDeep * (0.25 + 0.2 * waterSky), waterAbove, waterWindow);
      diffuseColor.a = mix(0.92, 0.55 + 0.25 * waterBand, waterWindow);
    }
  }`;

function surfaceMaterial() {
  const m = new THREE.MeshLambertMaterial({
    vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.waterTime = WATER.time;
    shader.uniforms.waterSkyLow = WATER.skyLow;
    shader.uniforms.waterSkyHigh = WATER.skyHigh;
    shader.uniforms.waterSunDir = WATER.sunDir;
    shader.uniforms.waterSunColor = WATER.sunColor;
    shader.uniforms.waterShallow = WATER.shallow;
    shader.uniforms.waterDeep = WATER.deep;
    shader.uniforms.waterDim = WATER.dim;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${SURFACE_VERTEX_PARS}`)
      .replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvWaterDepth = depth;\nvWaterPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWaterN = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${SURFACE_FRAGMENT_PARS}`)
      .replace('#include <map_fragment>', SURFACE_COLOR)
      .replace('#include <opaque_fragment>', `${SURFACE_LIGHT}\n#include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'water-surface';
  return m;
}

// What chunk meshes draw their water with.
export const WATER_SURFACE = surfaceMaterial();
