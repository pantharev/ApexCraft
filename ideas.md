# ApexCraft — Ideas & Roadmap

A running brainstorm of where the game could go. Roughly ordered: finish the
survival base first, then branch into the fun stuff (guns, magic, multiplayer,
mods). Notes call out how each idea fits the current architecture.

Legend: 🟢 small · 🟡 medium · 🔴 large/infra

---

## 1. Finish the Minecraft-style base

Get to a satisfying "vanilla" loop before piling on mods.

- 🟢 **More blocks/biomes**: planks variants, bricks, glass panes, stairs/slabs,
  flowers, mushrooms, ice, packed snow. Most are just `blocks.json` + a tile in
  `atlas.js`. Stairs/slabs need partial-block meshing (bigger).
- 🟡 **Biome variety & blending**: more surface decoration (tall grass, bushes,
  boulders), and smooth biome borders (the plan's "biome weights" idea).
- 🟡 **Structures**: villages, dungeons, ruined towers, ore-rich caves with
  chests. Reuse the `world/structures/` pattern (like `Tree.js`) + chest storage.
- 🟡 **Mobs**: more passives (wolf/tameable, horse/ride), more hostiles (creeper
  w/ explosion, enderman). Add a simple **breeding/farming** loop.
- 🟢 **Farming/food**: crops (wheat, carrots), tilled soil, bread, hunger depth.
- 🟡 **Bow & arrows**: first ranged weapon; introduces a **projectile system**
  (arrow entity w/ gravity + hit detection) that guns/spells reuse later.
- 🟡 **Bucket + fluids**: pick up/place water; simple flowing-water sim.
- 🟢 **Block lighting (proper)**: baked flood-fill light levels into chunk
  vertex colors — replaces the torch point-light cap (already pinned).
- 🟢 **Armor**: helmet/chest/legs/boots slots that reduce damage; render on the
  player model later.
- 🟢 **XP & enchanting**: orbs from mobs/mining, an enchant table that buffs tools/weapons.

---

## 2. Combat & weapons

The melee + mob-feedback foundation is in; build outward.

- 🟡 **Projectile framework** (do this first): a generic moving entity with
  velocity, gravity toggle, lifetime, and AABB/voxel hit tests. Powers arrows,
  bullets, thrown potions, and spell bolts. Lives well next to `ItemDrops`.
- 🔴 **Guns / firearms** (mod pack): pistol, rifle, shotgun, sniper.
  - Data-driven: `weapons.json` with `damage`, `fireRate`, `spread`, `ammo`,
    `reloadTime`, `range`, `projectileSpeed`, `pellets`.
  - Hitscan for fast bullets (raycast) or projectiles for slow ones.
  - Ammo as items + crafting (gunpowder from creepers, casings, etc.).
  - Recoil + muzzle flash (a brief light) + tracer + reload animation.
  - First-person gun view-models extend the existing held-item anchor.
- 🟡 **Melee depth**: attack cooldown bar, sweep/crit, knockback scaling,
  durability on tools/weapons (then repair/anvil).
- 🟡 **Explosives**: TNT, creeper blasts, grenades — carve block edits in a
  radius (reuse `world.setBlock`) + a shockwave + particle burst.

---

## 3. Magic — wands & spells

A second, distinct combat/utility tree. High "wow" factor, very moddable.

- 🟡 **Mana system**: a blue bar in the HUD (parallel to hunger), regenerating;
  spells cost mana. Add to `Vitals` or a new `Magic` system.
- 🔴 **Spell framework**: `spells.json` defining `cost`, `cooldown`, `type`
  (projectile / self / area / utility), and an `effect`. Effects compose from
  primitives: damage, heal, ignite, freeze, teleport, levitate, shield,
  light, place/break blocks.
  - **Wand items** with a bound spell (or a spell-slot wheel).
  - Reuses the projectile framework for bolts (fireball, frostbolt, lightning).
- 🟢 **Spell ideas**: Fireball (AoE + ignite), Frost (slow), Heal, Blink
  (short teleport along view ray — you already have voxel raycasting), Levitate,
  Magic Light (places a torch-like light), Mining Ray (break a line of blocks),
  Shield (temp damage absorb), Summon (spawn a friendly mob).
- 🟡 **Crafting/progression**: spellbooks, runes, mana crystals (new ore),
  enchanted wand tiers — slots cleanly into the existing recipe/recipe-book UI.
- 🟡 **Potions**: brewing stand block + `potions.json`; thrown potions use the
  projectile system; effects use a shared **status-effect** system (poison,
  regen, speed, strength) that armor/enchants/spells all share.

---

## 4. Multiplayer & servers 🔴

The biggest infra lift — worth designing for early even if built later.

- 🔴 **Networking model**: authoritative server + thin clients. Server owns the
  world (chunks, mobs, entities); clients send inputs and render snapshots.
- 🟡 **Transport**: WebSocket for state sync (rooms/lobbies), WebRTC data
  channels for low-latency P2P co-op as a lighter first step.
- 🟡 **State sync**: the **block-edit delta** model already used for saves maps
  almost directly to "broadcast edits to peers." Player/mob positions need
  interpolation + a tick rate.
- 🔴 **Dedicated server**: extract world-gen + simulation (currently in the
  browser) into a Node process; the `World`/`Furnaces`/`Chests`/`MobManager`
  systems are already framework-agnostic JS, which helps.
- 🟢 **Server browser / room codes**, player list, chat, name tags.
- 🟡 **Persistence**: move saves from IndexedDB (per-browser) to server-side
  storage so worlds are shared and survive.
- Co-op first (2–8 players), public servers later.

### Chosen stack: Node.js + Express + WebSocket (decided 2026-06)

Build the co-op server as a **Node.js + Express** app, with **`ws`** (or
Socket.IO) for the realtime channel. Express alone is just HTTP; the live game
traffic rides a WebSocket upgrade on the same server.

**Suggested shape** (`/server` package alongside the Vite app):
- `express` serves the built client (`dist/`) + a small REST surface
  (`POST /rooms` → room code, `GET /rooms/:code` → exists?).
- `ws` `WebSocketServer` handles the realtime loop: join/leave, input messages,
  and broadcast of state snapshots. One room = one in-memory world.
- **Reuse the existing JS sim directly** — `World`, `MobManager`, `Furnaces`,
  `Chests` are framework-agnostic and have no DOM/Three deps, so they can run
  in Node unchanged. The renderer (Three.js) stays client-only.
- **Authoritative tick**: server runs the world at a fixed tick (e.g. 20 Hz),
  applies player inputs, steps mobs/projectiles, and broadcasts deltas.
- **Wire format**: reuse the **block-edit delta** model from saves for world
  changes; send player/mob positions as compact snapshots and interpolate on
  the client. Start with JSON, switch to binary (typed arrays) later if needed.
- **Client**: add a thin `systems/Net.js` that, in multiplayer mode, replaces
  local simulation with "send input → receive snapshot." Single-player keeps
  running the sim locally (same code path, no server).
- **Deploy**: Vercel is serverless and **can't hold WebSocket connections**, so
  the realtime server needs a always-on host — Railway / Render / Fly.io / a
  small VPS. Keep the static client on Vercel, point it at the game server URL.

**Difficulty: 🔴 large — the single hardest feature on the roadmap.**
The infrastructure (Express + ws + rooms) is a weekend; the *game-networking*
is the hard part:
- **Refactor sim out of the render loop** — today `Game.js` ticks the world
  inside the browser RAF loop; multiplayer needs the sim runnable headless and
  driven by a server clock. Biggest structural change.
- **Authority & reconciliation** — server owns truth; client predicts movement
  and reconciles on snapshots (or accepts input lag). Mob/projectile sync,
  hit registration, and inventory/chest contention all need an authority owner.
- **Interpolation/prediction** for smooth remote players over real latency.
- **Edge cases**: chunk streaming per-player, join-in-progress world transfer,
  disconnect/reconnect, anti-desync.
- Realistic estimate: a **rough 2-player co-op prototype in ~1–2 weeks**
  (shared world, see each other move, shared block edits); a **robust 2–8
  player experience in ~1–2 months** of focused work. The save-delta system and
  framework-agnostic sim modules are the big head start that make it feasible.

Pragmatic first milestone: **2-player shared-world co-op over WebSocket** — host
runs the authoritative sim, one peer joins by room code, both see each other and
each other's block edits. Ship that, then scale up players and harden sync.

---

## 5. Modding / extensibility 🔴

You're already ~80% data-driven (blocks, items, recipes, smelting, mobs). Lean in.

- 🟡 **Content packs**: load extra `blocks/items/recipes/mobs/weapons/spells`
  JSON at runtime so a "mod" is a folder of JSON + textures (no code).
- 🟡 **Texture packs**: swap the procedural atlas for loaded PNG atlases; let
  packs override per-tile.
- 🔴 **Scripting hooks**: a sandboxed event API (`onBlockBreak`, `onUseItem`,
  `onTick`, `onMobDeath`) so mods can add behavior, not just content.
- 🟢 **In-game mod manager**: enable/disable packs from a menu.
- 🟢 **Creative mode + world settings**: infinite items, flight, no mobs,
  difficulty, world-gen tuning sliders — great for builders and modders.

---

## 6. World & exploration

- 🟡 **The Nether / other dimensions**: portals + a second world with its own
  seed/gen (the per-world seed system already exists).
- 🟢 **Maps & waypoints**, compass, coordinates toggle.
- 🟡 **Weather**: rain/snow particles, storms, lightning (ties into fire/magic).
- 🟡 **Boats/minecarts/rails**: rideable entities + a rail block network.
- 🟢 **Sleeping/beds**: set spawn + skip night (day/night cycle already there).

---

## 7. Tech / automation (Redstone-like)

- 🔴 **Redstone**: power wires, levers, pistons, doors. A signal-propagation
  pass over block edits each tick. Big but iconic.
- 🟡 **Hoppers/pipes**: item transport between chests/furnaces (storage + furnace
  systems already exist to connect).
- 🟡 **Automated farms/turrets** once redstone + projectiles exist.

---

## 8. UX & quality of life

- 🟢 **Sound & music**: footsteps, mining, mobs, ambient — a big immersion win,
  currently silent. Web Audio API.
- 🟢 **Particles**: block-break crumbs, hit sparks, magic, smoke (instanced).
- 🟢 **Settings menu**: render distance, FOV, sensitivity, volume, keybinds.
- 🟢 **Crosshair block-target tooltip**, hotbar item names, durability bars.
- 🟢 **Death/respawn improvements**: keep-inventory option, death coordinates.
- 🟢 **Mobile/touch controls** (if you want reach beyond desktop).

---

## 9. Graphics & polish

- 🟡 **Smooth lighting / ambient occlusion** in the mesher (darken vertices in
  block corners) — cheap, big visual upgrade.
- 🟡 **Better mob & player models** + simple skin textures; animations.
- 🟢 **Skybox/clouds/stars**, nicer water (animated, transparency, reflections).
- 🟡 **Shadows** (the sun is already a directional light — add a shadow map).
- 🟢 **Held-item & dropped-item textures** (currently flat-colored — pinned).

---

## 10. Performance & tech debt (enablers)

- 🟡 **Web-worker chunk generation** (from the original plan) — removes hitches;
  also a prerequisite for a clean client/server split.
- 🟢 **Instanced rendering** for item drops, particles, torches, mobs of a type.
- 🟢 **LOD** for distant chunks.
- 🟢 **Greedy-mesh + texture-array** path if draw calls climb with more block types.

---

## Landing page (needed)

A marketing/entry page in front of the game (separate route or static page).
- 🟢 **Hero**: title, tagline, a looping gameplay GIF/video, and a big **Play**
  button → launches the game (`/play`).
- 🟢 **Feature highlights**: biomes/oceans, mining & crafting, mobs & combat,
  day/night, multiple worlds, sound — with screenshots.
- 🟢 **"Built in the browser"** angle: no install, works on desktop & mobile.
- 🟢 **Controls cheatsheet** + a short "how to play" / first-5-minutes guide.
- 🟢 **Footer**: GitHub link, roadmap, devlog/changelog, contact.
- 🟡 Tech: could be a separate `index.html`/route in this Vite app (landing at
  `/`, game at `/play`), or a tiny separate site. Add OpenGraph/meta tags +
  favicon for nice link previews. SEO basics.
- 🟡 Later: account/login, save-to-cloud CTA, server list, mod showcase.

## Suggested sequencing

1. **Finish base**: bow/arrows → **projectile framework**, armor, proper block
   lighting, a few structures, sound + particles. (Makes it feel like a game.)
2. **Pick a headline mod**: **guns** *or* **magic/wands** — both ride the
   projectile + status-effect systems, so build those once, share them.
3. **Creative mode + content/texture packs** → cheap modding wins.
4. **Co-op multiplayer** (WebRTC, edit-delta sync) → then dedicated servers.
5. **Redstone/automation** as a long-tail depth project.

Cross-cutting building blocks worth doing early because everything reuses them:
**projectiles**, **status effects**, **a server-authoritative tick**, and
**runtime-loaded content packs**.
