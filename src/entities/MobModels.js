import * as THREE from 'three';
import { MOBS } from './mobTypes.js';
import { SKINS } from './mobSkins.js';
import { mulberry32 } from '../world/noise.js';

// Builds mob models from the box-part lists in mobTypes.js.
//
// Every mob type gets one small generated texture sheet ("skin"): each box
// part is unwrapped onto it at PX texels per block — the same pixel scale as
// the block tiles, so mobs and world read as one piece of pixel art — filled
// with the part's colour, then detailed by the type's painter in mobSkins.js
// (faces, fur patterns, clothes, hooves…). A second sheet, the glow map,
// carries a faint copy of the skin (so mobs stay readable in the dark) plus
// any pixels the painter marked as glowing at full strength: eyes that shine
// at night.
//
// A model is a handful of meshes sharing ONE material: the rigid body, the
// head, and each limb / tail / wing that animates on its own pivot.

const PX = 16;        // texels per block
const SHEET_W = 128;  // skin sheet width; height grows to fit
const FILL = 0.16;    // strength of the faint self-lit copy in the glow map

// The six faces of a part. `w`/`h` pick which box dimensions (0=x, 1=y, 2=z)
// span the face's image; `corners` are the image's top-left, top-right,
// bottom-right, bottom-left as seen from OUTSIDE the box, in units of the
// half-extents. Mobs face +z, so 'left' (+x) is the mob's own left.
const FACES = {
  front:  { n: [0, 0, 1],  w: 0, h: 1, corners: [[-1, 1, 1], [1, 1, 1], [1, -1, 1], [-1, -1, 1]] },
  back:   { n: [0, 0, -1], w: 0, h: 1, corners: [[1, 1, -1], [-1, 1, -1], [-1, -1, -1], [1, -1, -1]] },
  left:   { n: [1, 0, 0],  w: 2, h: 1, corners: [[1, 1, 1], [1, 1, -1], [1, -1, -1], [1, -1, 1]] },
  right:  { n: [-1, 0, 0], w: 2, h: 1, corners: [[-1, 1, -1], [-1, 1, 1], [-1, -1, 1], [-1, -1, -1]] },
  top:    { n: [0, 1, 0],  w: 0, h: 2, corners: [[-1, 1, -1], [1, 1, -1], [1, 1, 1], [-1, 1, 1]] },
  bottom: { n: [0, -1, 0], w: 0, h: 2, corners: [[-1, -1, 1], [1, -1, 1], [1, -1, -1], [-1, -1, -1]] },
};
const FACE_NAMES = Object.keys(FACES);
// Baked face shading, on top of the real lighting: tops a touch brighter,
// undersides clearly darker.
const FACE_SHADE = { front: 1, back: 0.94, left: 0.97, right: 0.97, top: 1.06, bottom: 0.76 };

const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const clamp = (v) => Math.max(0, Math.min(255, v | 0));

// One face of one part on the skin sheet, as handed to the painters. Origin
// is the face's top-left as seen from outside; x runs right, y runs down.
class Face {
  constructor(sheet, x, y, w, h, frontAtLeft) {
    this.sheet = sheet;
    this.x0 = x; this.y0 = y;
    this.w = w; this.h = h;
    this._frontAtLeft = frontAtLeft;
  }

  // Paint one pixel (silently clipped to the face). `glow` makes it shine in
  // the dark at full strength.
  px(x, y, hex, glow = false) {
    x |= 0; y |= 0;
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return this;
    const s = this.sheet;
    s.ctx.fillStyle = hex;
    s.ctx.fillRect(this.x0 + x, this.y0 + y, 1, 1);
    s.glow[(this.y0 + y) * SHEET_W + this.x0 + x] = glow ? 1 : 0;
    return this;
  }

  rect(x, y, w, h, hex, glow = false) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.px(x + i, y + j, hex, glow);
    return this;
  }

  // The x coordinate `i` pixels in from the edge nearest the mob's front —
  // lets one painter serve both side faces of a part.
  fromFront(i) { return this._frontAtLeft ? i : this.w - 1 - i; }

  // Speckle: `count` single pixels of `hex` at seeded random spots.
  speckle(count, hex) {
    const r = this.sheet.rng;
    for (let i = 0; i < count; i++) this.px(r() * this.w, r() * this.h, hex);
    return this;
  }

  // Irregular blotches (cow patches, moss, grime): `count` blobs of ~`size`.
  blotches(count, size, hex) {
    const r = this.sheet.rng;
    for (let i = 0; i < count; i++) {
      const cx = r() * this.w, cy = r() * this.h;
      const rx = size * (0.6 + r() * 0.8), ry = size * (0.6 + r() * 0.8);
      for (let y = Math.floor(cy - ry); y <= cy + ry; y++) {
        for (let x = Math.floor(cx - rx); x <= cx + rx; x++) {
          const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
          if (d < 1 - r() * 0.35) this.px(x, y, hex);
        }
      }
    }
    return this;
  }
}

// A no-op stand-in, so painters can address parts a mob doesn't have.
const NO_FACE = new Proxy({}, { get: (_, k) => (k === 'w' || k === 'h' ? 0 : () => NO_FACE) });

const skins = new Map(); // type -> { map, glow, rects, width, height }

function buildSkin(type) {
  const def = MOBS[type];
  // Lay every part's six faces out on shelves.
  const rects = [];
  let x = 1, y = 1, shelf = 0;
  def.parts.forEach((part, i) => {
    const dims = part.size.map((s) => Math.max(1, Math.round(s * PX)));
    rects[i] = {};
    for (const name of FACE_NAMES) {
      const f = FACES[name];
      const w = dims[f.w], h = dims[f.h];
      if (x + w + 1 > SHEET_W) { x = 1; y += shelf + 1; shelf = 0; }
      rects[i][name] = { x, y, w, h };
      x += w + 1;
      shelf = Math.max(shelf, h);
    }
  });
  const height = Math.ceil((y + shelf + 1) / 4) * 4;

  const canvas = document.createElement('canvas');
  canvas.width = SHEET_W; canvas.height = height;
  const ctx = canvas.getContext('2d');
  // Seeded per type, so a mob looks the same every session.
  let seed = 0x51ed;
  for (let i = 0; i < type.length; i++) seed = (seed * 31 + type.charCodeAt(i)) | 0;
  const sheet = { ctx, rng: mulberry32(seed), glow: new Uint8Array(SHEET_W * height) };

  // Base coat: the part's colour with a soft mottle (warm when lighter, cool
  // when darker, like the block tiles) and the per-face shade.
  const faces = new Map(); // part id / index -> { front, back, … }
  def.parts.forEach((part, i) => {
    const [r, g, b] = rgb(part.color);
    const set = {};
    for (const name of FACE_NAMES) {
      const q = rects[i][name];
      const img = ctx.createImageData(q.w, q.h);
      const shade = FACE_SHADE[name];
      for (let p = 0; p < q.w * q.h; p++) {
        const d = (sheet.rng() - 0.5) * 16;
        img.data[p * 4] = clamp((r + d * 1.12) * shade);
        img.data[p * 4 + 1] = clamp((g + d) * shade);
        img.data[p * 4 + 2] = clamp((b + d * 0.88) * shade);
        img.data[p * 4 + 3] = 255;
      }
      ctx.putImageData(img, q.x, q.y);
      set[name] = new Face(sheet, q.x, q.y, q.w, q.h, name === 'left');
    }
    faces.set(i, set);
    if (part.id) faces.set(part.id, set);
  });

  // Details.
  const painter = {
    rng: sheet.rng,
    face: (id, side) => faces.get(id)?.[side] || NO_FACE,
    // Run fn(face, side) on a part's two flanks.
    sides: (id, fn) => { for (const s of ['left', 'right']) fn(painter.face(id, s), s); },
    // …or on all four of its upright faces.
    around: (id, fn) => { for (const s of ['front', 'back', 'left', 'right']) fn(painter.face(id, s), s); },
  };
  if (SKINS[type]) SKINS[type](painter);

  // Glow map: a faint copy of the skin everywhere, full strength where the
  // painter asked for glow.
  const src = ctx.getImageData(0, 0, SHEET_W, height);
  const glowCanvas = document.createElement('canvas');
  glowCanvas.width = SHEET_W; glowCanvas.height = height;
  const gctx = glowCanvas.getContext('2d');
  const out = gctx.createImageData(SHEET_W, height);
  for (let p = 0; p < SHEET_W * height; p++) {
    const k = sheet.glow[p] ? 1 : FILL;
    out.data[p * 4] = src.data[p * 4] * k;
    out.data[p * 4 + 1] = src.data[p * 4 + 1] * k;
    out.data[p * 4 + 2] = src.data[p * 4 + 2] * k;
    out.data[p * 4 + 3] = 255;
  }
  gctx.putImageData(out, 0, 0);

  const tex = (c) => {
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  return { map: tex(canvas), glow: tex(glowCanvas), rects, height };
}

function skinFor(type) {
  let s = skins.get(type);
  if (!s) { s = buildSkin(type); skins.set(type, s); }
  return s;
}

// Geometry for a set of parts, positioned relative to `pivot`, with UVs into
// the type's skin sheet.
function partsGeometry(def, skin, indices, pivot) {
  const positions = [], normals = [], uvs = [], index = [];
  for (const i of indices) {
    const part = def.parts[i];
    const half = part.size.map((s) => s / 2);
    for (const name of FACE_NAMES) {
      const f = FACES[name];
      const q = skin.rects[i][name];
      // Pulled in a hair from the rect's edge so nearest-filtering can never
      // pick up the unpainted gutter between faces.
      const e = 0.02;
      const u0 = (q.x + e) / SHEET_W, u1 = (q.x + q.w - e) / SHEET_W;
      const v0 = 1 - (q.y + e) / skin.height, v1 = 1 - (q.y + q.h - e) / skin.height;
      const uv = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
      const base = positions.length / 3;
      for (let c = 0; c < 4; c++) {
        const k = f.corners[c];
        positions.push(
          part.pos[0] + k[0] * half[0] - pivot[0],
          part.pos[1] + k[1] * half[1] - pivot[1],
          part.pos[2] + k[2] * half[2] - pivot[2]
        );
        normals.push(f.n[0], f.n[1], f.n[2]);
        uvs.push(uv[c][0], uv[c][1]);
      }
      // Corners run TL, TR, BR, BL; (TL, BL, BR) + (TL, BR, TR) is
      // counter-clockwise from outside.
      index.push(base, base + 3, base + 2, base, base + 2, base + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(index);
  return geo;
}

// Where a moving part hinges, unless the part names its own `pivot`.
function defaultPivot(part) {
  const [x, y, z] = part.pos;
  const [, h, d] = part.size;
  if (part.tail === 'back') return [x, y, z + d / 2]; // the end that meets the body
  return [x, y + h / 2, z];                           // legs, arms, wings, hanging tails: the top
}

// Builds the model for a mob type. Returns a Group with:
//   userData.legs  — leg meshes (hinged at the hip) that swing while walking
//   userData.arms  — arm meshes (hinged at the shoulder) driven by the gait
//   userData.head  — one mesh of every `head: true` part, pivoted at the first
//                    of them, so the mob can look around
//   userData.tails / userData.wings — extras animated by animateMob
// Every mesh shares one material, so a hurt flash or death fade set through
// any of them covers the whole mob.
export function buildMobModel(type) {
  const def = MOBS[type];
  const skin = skinFor(type);
  const group = new THREE.Group();
  const material = new THREE.MeshLambertMaterial({
    map: skin.map, emissive: 0xffffff, emissiveMap: skin.glow, emissiveIntensity: 1,
  });
  material.userData.glow = skin.glow;

  const mesh = (indices, pivot) => {
    const m = new THREE.Mesh(partsGeometry(def, skin, indices, pivot), material);
    m.position.set(pivot[0], pivot[1], pivot[2]);
    m.castShadow = true;
    m.receiveShadow = true;
    return m;
  };

  const body = [], headParts = [];
  const legs = [], arms = [], tails = [], wings = [];
  def.parts.forEach((part, i) => {
    if (part.head) { headParts.push(i); return; }
    const list = part.leg ? legs : part.arm ? arms : part.tail ? tails : part.wing ? wings : null;
    if (!list) { body.push(i); return; }
    const m = mesh([i], part.pivot || defaultPivot(part));
    // How animateMob swings it: which axis, around what resting pose, and
    // (optionally) a phase and amplitude of its own.
    const rest = part.rest || [0, 0, 0];
    m.rotation.set(rest[0], rest[1], rest[2]);
    m.userData = {
      axis: part.axis || 'x', rest: { x: rest[0], y: rest[1], z: rest[2] },
      phase: part.phase, amp: part.amp, hang: part.tail === 'hang', side: Math.sign(part.pos[0]) || 1,
    };
    group.add(m);
    list.push(m);
  });

  if (body.length) group.add(mesh(body, [0, 0, 0]));
  let head = null;
  if (headParts.length) {
    head = mesh(headParts, def.parts[headParts[0]].pos);
    group.add(head);
  }

  group.userData.legs = legs;
  group.userData.arms = arms;
  group.userData.head = head;
  group.userData.tails = tails;
  group.userData.wings = wings;
  return group;
}

// Hurt flash: the whole mob glows red for a moment, then goes back to its
// glow map. Swapping the emissive texture for a plain white one (rather than
// dropping it) keeps the same shader program — no recompile hitch mid-fight.
const WHITE = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1);
WHITE.needsUpdate = true;

export function flashMob(parts, on) {
  for (const p of parts) {
    const m = p.material;
    if (!m || !m.userData.glow) continue;
    m.emissiveMap = on ? WHITE : m.userData.glow;
    m.emissive.setHex(on ? 0xff3030 : 0xffffff);
    m.emissiveIntensity = on ? 0.85 : 1;
  }
}

// Shared walk/idle body animation, used by both the authoritative Mob and the
// guest-side GhostMobs so multiplayer mirrors move identically. `m` needs:
// group, legs, arms, walkPhase, def (and optionally attackTimer). Legs swing
// for every mob; tails wag and wings flap where a model has them; mobs with a
// `gait` also get arm poses, a walking bob, torso sway, and (shamblers) the
// occasional head twitch. Bob/sway are ADDED on top of group.position/
// rotation, so the caller must sync the group to the mob's position each
// frame BEFORE calling this. Never runs on dead mobs (the death tip-over owns
// group.rotation.z).
export function animateMob(m, dt, moving) {
  const gait = m.def.gait;
  const arms = m.arms || [];
  if (moving) m.walkPhase += dt * (gait === 'heavy' ? 5.5 : gait === 'run' ? 12 : 8);
  m.idleT = (m.idleT || 0) + dt;
  const t = m.walkPhase;

  // Each leg swings on its own axis around its resting pose (most legs: x
  // around straight down; spider legs sweep around y from a splayed rest).
  const legAmp = gait === 'heavy' ? 0.7 : gait === 'run' ? 0.95 : 0.5;
  for (let i = 0; i < m.legs.length; i++) {
    const l = m.legs[i];
    const u = l.userData;
    const axis = u.axis || 'x';
    const rest = u.rest ? u.rest[axis] : 0;
    if (moving) l.rotation[axis] = rest + Math.sin(t + (u.phase ?? i * Math.PI)) * legAmp * (u.amp ?? 1);
    else l.rotation[axis] += (rest - l.rotation[axis]) * 0.2;
  }

  const extras = m.group.userData;
  // Tails: a slow idle sway that quickens on the move, and a proper wag for a
  // tamed pet. Hanging tails (cows) swing side to side; the rest wag around y.
  const tails = extras.tails;
  if (tails && tails.length) {
    const rate = m.owner ? 9 : moving ? 5 : 1.6;
    const reach = m.owner ? 0.5 : moving ? 0.3 : 0.16;
    for (let i = 0; i < tails.length; i++) {
      const tail = tails[i];
      const u = tail.userData;
      const axis = u.hang ? 'z' : 'y';
      tail.rotation[axis] = u.rest[axis] + Math.sin(m.idleT * rate + i) * reach * (u.amp ?? 1);
    }
  }
  // Wings: tucked at rest, a flutter while running, a full flap in the air.
  const wings = extras.wings;
  if (wings && wings.length) {
    const lift = m.def.flies || m.onGround === false ? 1 : moving ? 0.25 : 0;
    m._flap = (m._flap || 0) + (lift - (m._flap || 0)) * Math.min(1, dt * 10);
    const beat = m._flap * (0.7 + 0.55 * Math.sin(m.idleT * 26));
    for (const w of wings) w.rotation.z = w.userData.rest.z + w.userData.side * beat;
  }

  if (!gait) return; // plain mobs (pigs, bats, villagers…): no arm poses or body english

  // Arms ease toward a per-gait target pose, so transitions look organic.
  const k = Math.min(1, dt * 10);
  for (let i = 0; i < arms.length; i++) {
    const a = arms[i];
    const s = i % 2 ? 1 : -1; // splay direction alternates per arm
    let rx, rz;
    if (m.attackTimer > 0) {
      // Overhead slam: raised behind the head, whipping down through the hit.
      const p = Math.max(0, m.attackTimer) / 0.25;
      rx = -0.5 - p * 1.9;
      rz = s * 0.12;
    } else if (gait === 'shamble') {
      // Classic zombie reach: both arms out level, drifting independently.
      rx = -1.35 + Math.sin(m.idleT * 1.7 + i * 2.4) * 0.12 + (moving ? Math.sin(t * 0.5 + i) * 0.1 : 0);
      rz = s * 0.06;
    } else if (gait === 'run') {
      rx = moving ? Math.sin(t + (i + 1) * Math.PI) * 0.95 : -0.25;
      rz = s * 0.05;
    } else if (gait === 'raised') {
      // Banshee wail: arms overhead, swaying.
      rx = -2.7 + Math.sin(m.idleT * 2.2 + i * 1.3) * 0.15;
      rz = s * 0.35 + Math.sin(m.idleT * 2.8 + i) * 0.1;
    } else { // heavy
      rx = moving ? Math.sin(t + (i + 1) * Math.PI) * 0.4 - 0.25
        : -0.15 + Math.sin(m.idleT * 1.4 + i * 2) * 0.05;
      rz = s * 0.1;
    }
    a.rotation.x += (rx - a.rotation.x) * k;
    a.rotation.z += (rz - a.rotation.z) * k;
  }

  // Body english: step bob + torso sway while moving, a breath at rest.
  const g = m.group;
  if (moving) {
    g.position.y += Math.abs(Math.sin(t)) * (gait === 'heavy' ? 0.06 : gait === 'run' ? 0.05 : 0.035);
    g.rotation.z = Math.sin(t * 0.5) * (gait === 'heavy' ? 0.085 : gait === 'shamble' ? 0.06 : 0.02);
    g.rotation.x = gait === 'run' ? 0.18 : gait === 'shamble' ? 0.08 : 0.05;
  } else {
    g.position.y += Math.sin(m.idleT * 1.8) * 0.012;
    g.rotation.z *= 0.85;
    g.rotation.x *= 0.85;
  }

  // Shamblers snap their head sideways every few seconds, then let it settle.
  // Uses head rotation.z only — the look-at logic owns x and y.
  const head = g.userData.head;
  if (gait === 'shamble' && head) {
    m._twitchT = (m._twitchT ?? 1 + Math.random() * 4) - dt;
    if (m._twitchT <= 0) {
      m._twitchT = 2.5 + Math.random() * 4.5;
      m._twitchV = (Math.random() < 0.5 ? 1 : -1) * (0.35 + Math.random() * 0.25);
    }
    if (m._twitchV) {
      m._twitchV *= Math.exp(-dt * 4);
      if (Math.abs(m._twitchV) < 0.02) m._twitchV = 0;
    }
    head.rotation.z += ((m._twitchV || 0) - head.rotation.z) * Math.min(1, dt * 14);
  }
}
