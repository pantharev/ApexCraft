import { liquidKind } from '../blocks/BlockRegistry.js';
import { Sound } from '../systems/Sound.js';

export const MAX_HEALTH = 20;
export const MAX_HUNGER = 20;
export const MAX_AIR = 10;

// Survival stats + the rules that change them over time: hunger drains with
// activity, health regenerates when well-fed and drains when starving, and the
// head being underwater depletes air then drowns the player.
export class Vitals {
  constructor(player, world) {
    this.player = player;
    this.world = world;
    this.onDeath = null;
    this.onDamage = null; // called when the player takes damage
    this.godMode = false; // creative mode: no damage, no hunger/air drain
    this.reset();
  }

  reset() {
    this.health = MAX_HEALTH;
    this.hunger = MAX_HUNGER;
    this.air = MAX_AIR;
    this.exhaustion = 0;
    this.regenTimer = 0;
    this.starveTimer = 0;
    this.drownTimer = 0;
    this.lavaTimer = 0;
    this.dead = false;
    this.submerged = false;
  }

  serialize() {
    return { health: this.health, hunger: this.hunger, air: this.air };
  }

  load(data) {
    if (!data) return;
    this.health = data.health ?? MAX_HEALTH;
    this.hunger = data.hunger ?? MAX_HUNGER;
    this.air = data.air ?? MAX_AIR;
  }

  damage(n) {
    if (this.godMode || this.dead || n <= 0) return;
    this.health = Math.max(0, this.health - n);
    if (this.onDamage) this.onDamage(n);
    if (this.health > 0) Sound.hurt(); // death sound handled separately
    if (this.health === 0) {
      this.dead = true;
      if (this.onDeath) this.onDeath();
    }
  }

  eat(food) {
    this.hunger = Math.min(MAX_HUNGER, this.hunger + food);
  }

  // Fall damage: 1 HP per block beyond a 3-block safe margin.
  applyFall(distance) {
    const dmg = Math.floor(distance - 3);
    if (dmg > 0) this.damage(dmg);
  }

  update(dt) {
    if (this.dead) return;
    // Creative: stats stay pinned full; no air/hunger/starve/regen logic.
    if (this.godMode) { this.submerged = false; return; }
    const p = this.player.pos;

    // Air: head submerged depletes the bubble bar, then drowns.
    const headBlock = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 1.6), Math.floor(p.z));
    this.submerged = liquidKind(headBlock) === 'water'; // sources and flowing cells alike
    if (this.submerged) {
      this.air -= dt;
      if (this.air <= 0) {
        this.air = 0;
        this.drownTimer += dt;
        if (this.drownTimer >= 1) { this.damage(1); this.drownTimer = 0; }
      }
    } else {
      this.air = Math.min(MAX_AIR, this.air + dt * 5);
      this.drownTimer = 0;
    }

    // Lava burns: standing in lava sears 3 HP every half second. (godMode
    // returned above, so creative players never reach this.)
    const bodyBlock = this.world.getBlock(Math.floor(p.x), Math.floor(p.y + 0.5), Math.floor(p.z));
    if (liquidKind(bodyBlock) === 'lava') {
      this.lavaTimer += dt;
      if (this.lavaTimer >= 0.5) { this.damage(3); this.lavaTimer = 0; }
    } else {
      this.lavaTimer = 0;
    }

    // Hunger: passive drain plus extra while moving on the ground.
    const speed = Math.hypot(this.player.vel.x, this.player.vel.z);
    this.exhaustion += dt * 0.05;
    if (speed > 0.1 && this.player.onGround && !this.player.flying) this.exhaustion += dt * 0.15;
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      this.hunger = Math.max(0, this.hunger - 1);
    }

    // Regenerate health when well-fed; that costs a little extra hunger.
    if (this.hunger >= 18 && this.health < MAX_HEALTH) {
      this.regenTimer += dt;
      if (this.regenTimer >= 1.5) {
        this.health = Math.min(MAX_HEALTH, this.health + 1);
        this.regenTimer = 0;
        this.exhaustion += 1.5;
      }
    } else {
      this.regenTimer = 0;
    }

    // Starve at zero hunger.
    if (this.hunger <= 0) {
      this.starveTimer += dt;
      if (this.starveTimer >= 2) { this.damage(1); this.starveTimer = 0; }
    } else {
      this.starveTimer = 0;
    }
  }
}
