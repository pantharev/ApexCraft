import * as THREE from 'three';
import { mulberry32 } from '../world/noise.js';

// The visible sky: a gradient dome and a drifting voxel-style cloud layer.
// Both are driven by DayNight (which owns the palette); this file only builds
// the meshes and exposes their uniforms.
//
// Colour handling: uniforms hold linear working-space colours (THREE.Color
// does the sRGB -> linear conversion on construction) and both shaders end in
// <colorspace_fragment>, so their output lands in the same display space as
// scene.fog's colour. That is what lets fogged terrain dissolve seamlessly
// into the dome's horizon band. Neither is tone-mapped — same as fog, which
// three applies after tone mapping.

export const SKY_RADIUS = 400; // distance of the sun/moon discs from the camera

export class SkyDome {
  constructor() {
    this.uniforms = {
      uZenith: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uGlowDir: { value: new THREE.Vector3(0, 1, 0) },
      uGlow: { value: new THREE.Color() },
      uGlowAmt: { value: 0 },
      // Underwater: the whole dome collapses to the water murk colour so open
      // ocean reads as murk instead of a bright sky seen through the fog.
      uMurk: { value: new THREE.Color() },
      uMurkAmt: { value: 0 },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGlowDir;
        uniform vec3 uGlow;
        uniform float uGlowAmt;
        uniform vec3 uMurk;
        uniform float uMurkAmt;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          // Horizon haze -> zenith. Everything at or below the horizon is the
          // pure horizon colour, which is also the fog colour.
          float h = max(d.y, 0.0);
          vec3 col = mix(uHorizon, uZenith, 1.0 - exp(-h * 3.4));
          // Scattering glow around the sun/moon, faded out at the horizon line
          // so the band the fog blends into stays one flat colour.
          float s = max(dot(d, uGlowDir), 0.0);
          float above = smoothstep(-0.03, 0.14, d.y);
          col += uGlow * (pow(s, 5.0) * 0.32 + pow(s, 48.0) * 0.5) * uGlowAmt * above;
          col = mix(col, uMurk, uMurkAmt);
          gl_FragColor = vec4(col, 1.0);
          #include <colorspace_fragment>
          // A little noise breaks up 8-bit banding in the gradient.
          float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
          gl_FragColor.rgb += (n - 0.5) / 255.0;
        }`,
      side: THREE.BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS * 1.1, 32, 16), material);
    this.mesh.frustumCulled = false; // follows the camera; always in view
    this.mesh.renderOrder = -1000;   // first thing drawn, behind everything
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

const CLOUD_TEX = 64;   // texels per repeat
const CLOUD_CELL = 9;   // world units per texel (one cloud "block")
const CLOUD_Y = 172;    // above WORLD_HEIGHT (128), so mountains never poke through

// Coverage map: thresholded, wrapped value noise -> blocky cloud cells.
// R = per-cell brightness, A = coverage (0 or 255). Nearest-filtered, so the
// edges stay square like the rest of the world.
function cloudTexture() {
  const N = CLOUD_TEX;
  const rng = mulberry32(0xc10d5);
  const lattice = (cells) => {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = rng();
    return (x, y) => {
      const fx = (x / N) * cells, fy = (y / N) * cells;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = fx - ix, ty = fy - iy;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i, j) => g[(((j % cells) + cells) % cells) * cells + (((i % cells) + cells) % cells)];
      const a = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * sx;
      const b = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * sx;
      return a + (b - a) * sy;
    };
  };
  const big = lattice(5), small = lattice(11);
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const n = big(x, y) * 0.68 + small(x, y) * 0.32;
      const i = (y * N + x) * 4;
      const shade = 226 + Math.floor(rng() * 29);
      data[i] = data[i + 1] = data[i + 2] = shade;
      data[i + 3] = n > 0.57 ? 255 : 0;
    }
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

export class Clouds {
  constructor() {
    this.texture = cloudTexture();
    this.uniforms = {
      uMap: { value: this.texture },
      uOffset: { value: new THREE.Vector2() }, // wind drift, world units
      uColor: { value: new THREE.Color() },
      uOpacity: { value: 0.9 },
      uCam: { value: new THREE.Vector3() },
      uRepeat: { value: CLOUD_TEX * CLOUD_CELL },
    };
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */`
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */`
        uniform sampler2D uMap;
        uniform vec2 uOffset;
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform vec3 uCam;
        uniform float uRepeat;
        varying vec3 vWorld;
        void main() {
          // Sampled in world space, so the layer stays put (and drifts with
          // the wind) while the plane itself rides along with the camera.
          vec4 t = texture2D(uMap, (vWorld.xz + uOffset) / uRepeat);
          if (t.a < 0.5) discard;
          // Dissolve toward the horizon instead of ending at a hard edge.
          float fade = 1.0 - smoothstep(240.0, 640.0, distance(vWorld.xz, uCam.xz));
          gl_FragColor = vec4(uColor * t.r, uOpacity * fade);
          #include <colorspace_fragment>
        }`,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    const geo = new THREE.PlaneGeometry(1400, 1400);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2; // after water (renderOrder 1), so clouds seen from above cover it
    this._t = 0;
  }

  // Ride along with the camera and drift with the wind.
  update(dt, cam) {
    this._t += dt;
    this.mesh.position.set(cam.x, CLOUD_Y, cam.z);
    this.uniforms.uCam.value.copy(cam);
    this.uniforms.uOffset.value.set(this._t * 1.6, this._t * 0.55);
  }

  dispose() {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
  }
}
