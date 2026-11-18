import * as THREE from 'three';
import { SHADOW_CASTER_LAYER } from '../core/World.js';

// The world's lights: a sky hemisphere plus one directional light that plays
// the sun by day and the moon by night. DayNight drives their colour,
// strength and direction; this owns the shadow map and keeps its box over
// the area in view. Shared by the Game and the menu flyover (core/Backdrop.js)
// so both are lit the same way.

export const SHADOW_MAP = 2048;  // sun/moon shadow map resolution
export const SHADOW_EXTENT = 64; // half-width of the shadowed box, in blocks
export const SHADOW_DIST = 160;  // how far back along its direction the light sits

export class SunRig {
  constructor(scene, camera) {
    this.camera = camera;
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x556677, 1.5);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
    scene.add(this.sun, this.sun.target);
    const shadow = this.sun.shadow;
    shadow.mapSize.set(SHADOW_MAP, SHADOW_MAP);
    shadow.camera.left = shadow.camera.bottom = -SHADOW_EXTENT;
    shadow.camera.right = shadow.camera.top = SHADOW_EXTENT;
    shadow.camera.near = 1;
    shadow.camera.far = SHADOW_DIST * 2;
    shadow.camera.updateProjectionMatrix();
    shadow.bias = -0.0004;
    shadow.normalBias = 0.03;
    // Chunk shadow casters live on their own layer (see World.js): hidden
    // from the camera's normal pass, shown only while the shadow map is
    // drawn. three builds the main draw list first and renders shadow maps
    // second, testing both against camera.layers — so the layer is switched
    // on as the sun's shadow pass begins and off at the top of each frame.
    scene.onBeforeRender = () => camera.layers.disable(SHADOW_CASTER_LAYER);
    const updateMatrices = shadow.updateMatrices.bind(shadow);
    shadow.updateMatrices = (light, viewport) => {
      camera.layers.enable(SHADOW_CASTER_LAYER);
      updateMatrices(light, viewport);
    };
    this._center = new THREE.Vector3();
    this._x = new THREE.Vector3();
    this._y = new THREE.Vector3();
  }

  // Point the light along `lightDir` (DayNight.lightDir) with its shadow box
  // parked a little ahead of `pos` in the direction the camera faces, snapped
  // to whole shadow texels so the shadows do not crawl as the view moves.
  aim(lightDir, pos) {
    const c = this._center;
    this.camera.getWorldDirection(c);
    // The raw horizontal part of the view direction: it shrinks as the view
    // tilts up or down, which eases the box back over `pos`.
    const ahead = SHADOW_EXTENT * 0.35;
    c.set(pos.x + c.x * ahead, pos.y, pos.z + c.z * ahead);
    // The shadow camera's own right/up axes (it looks down -lightDir with +Y up).
    const X = this._x.set(0, 1, 0).cross(lightDir).normalize();
    const Y = this._y.copy(lightDir).cross(X);
    const texel = (SHADOW_EXTENT * 2) / SHADOW_MAP;
    const sx = c.dot(X), sy = c.dot(Y);
    c.addScaledVector(X, Math.round(sx / texel) * texel - sx);
    c.addScaledVector(Y, Math.round(sy / texel) * texel - sy);
    this.sun.target.position.copy(c);
    this.sun.position.copy(c).addScaledVector(lightDir, SHADOW_DIST);
  }

  // Frees the shadow map.
  dispose() {
    this.sun.dispose();
  }
}
