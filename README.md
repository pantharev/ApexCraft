# ApexCraft

A voxel survival game in the browser — a Minecraft-style sandbox built with **React** and **Three.js**. Explore a procedurally generated world of biomes, oceans, and forests; mine and build; craft tools and smelt ores; survive hunger, drowning, and falls; and fend off mobs that hunt you after dark.

> Pre-alpha. All textures and sounds are procedurally generated in code (no asset files) — pixel-art block tiles, ambient-occlusion shading, synthesized audio — and the full gameplay loop is in place.

---

## 📜 Licensing & Commercial Use

ApexCraft uses a **dual-licensing / open-core model**:

### 1. The open-source core (this repository)
All code in this repository is licensed under the **[MIT License](LICENSE)**.
- **For developers:** you are free to fork, modify, extend, and use it in your
  own projects — **including commercial, closed-source games**.
- **The rule:** include the original copyright notice and a copy of the MIT
  License in any distribution or derivative work.

### 2. The premium version (proprietary)
We develop and may sell a premium/official build of ApexCraft (e.g. hosted
multiplayer, advanced graphics, exclusive content).
- Those premium extensions are maintained in a **separate, closed-source**
  project and governed by their own proprietary license/EULA (not part of this
  repository).
- Forking this repository does **not** grant any rights to the proprietary
  premium code, commercial assets, or the ApexCraft name/branding.

### 3. Contributing to the core
Community contributions are welcome! Because the same core powers the premium
build, contributors agree to our **[Contributor License Agreement (CLA)](CLA.md)**
when opening a pull request.
- By contributing, you grant us the right to include your improvements in
  **both** the open-source repository **and** commercial versions. You retain
  the copyright to your original work.

See [LICENSE](LICENSE) and [CLA.md](CLA.md) for full details.

---

## Features

### World
- **Procedural terrain** from a continuous, domain-warped heightfield: a *continental* field shapes organic coastlines and ocean shelves, an *erosion* field separates flat lowlands from rugged country, and **ridged-fBm mountain ranges** rise where a dedicated range mask says so — rolling, climbable, no cliff walls at biome borders.
- **Biomes** from temperature + humidity (plains, desert, mountains, snowy, jungle, swamp) with organically dithered borders; **altitude takes over up high** — bare rock above the treeline, wandering snowlines on the peaks. Jungle spots grow tall two-tier trees.
- **Oceans, lakes & rivers** — winding river channels whose width breathes along the course; varied sea floors (sand banks, gravel runs, clay pockets); beaches at the shore.
- **Caves** carved with 3D noise, and **ore veins** (coal, iron, gold, redstone, lapis, diamond, emerald) placed by depth and rarity.
- **Trees** scattered only on grass, clumped by a *forest* noise field so you get dense woods and open plains both.
- **Day/night cycle** with a moving sun and moon (sunrise in the east, set in the west), a **wheeling star dome** at night, glowing halos around the sun/moon, and **orange dawn/dusk skies** with warm horizon light.

### Survival & combat
- **Health, hunger, and air** — hunger drains with activity, health regenerates when well-fed, and you starve at empty. Head underwater drains the air bar, then you drown.
- **Damage** from falls (scales with distance), drowning, and mob attacks — hits **knock you back** away from the attacker (arrows shove you along their flight). Death drops your inventory and shows a respawn screen.
- **Swimming** — buoyant water physics: plunge in, sink slowly, hold jump to swim up. Water cancels fall damage.
- **Mobs**
  - *Passive* (day): pig, cow, sheep, chicken — wander, **graze**, watch you walk by (heads track), and flee when hit.
  - *Hostile* (night): zombie & spider chase and melee (spiders **climb walls**); **skeletons keep their distance and shoot arrows** at you. Zombies and skeletons **burn in daylight**. Bodies turn smoothly, keep eye contact while hunting, and **slump over and fade** when slain.
  - Craft a **bow** + arrows for your own ranged attacks.
  - Mobs drop loot (meats, leather, bone, string, feather, wool, …). Cook meat in a furnace for more nourishment.

### Building & items
- **Mining** with break-progress, tool-tier gating (wrong tier = no drop), and item-drop entities that you walk over to collect.
- **Inventory** — 36 slots + hotbar, drag/stack/split with a cursor, item tooltips.
- **Crafting** — 2×2 pocket grid plus a 3×3 crafting table (right-click a placed table). Shaped & shapeless recipes; shift-click to craft a full stack.
- **Smelting** — place a furnace, add fuel + input; smelt ores into ingots, sand into glass, and raw meat into cooked food.
- **Recipe book** — a "Recipes" tab in the inventory, crafting table, and furnace screens lists every recipe with its ingredients (have/need), and one-click crafts anything you have materials for (shift-click crafts all).

### Multiplayer (co-op)
- **Host any of your worlds** from the title screen and share the 5-letter
  **room code**; up to 8 friends can join your world live.
- **Shared world**: block breaking/placing syncs instantly for everyone, and
  late joiners receive the full edited world. The host's save persists all
  changes.
- **See each other**: blocky player avatars with name tags, smoothly
  interpolated; everyone's arrows fly for all to see (no friendly fire).
- **One simulation**: the host runs the mobs — they hunt whichever player is
  nearest, and everyone can fight them. If the host leaves, another player
  takes over automatically.
- Runs on a small **Node.js + Express + Socket.IO** server (`npm run server`,
  see [Getting started](#getting-started)). *Current limits: chest/furnace
  contents and item drops are per-player, not synced.*

### Worlds & persistence
- **Multiple worlds** — a title screen lists your saved worlds (create/play/
  delete); each world has its own random seed, so terrain differs per world.
- **Saving** to IndexedDB: auto-saves every 15s and on tab close, plus a manual
  **Save** in the pause menu (press **Esc**). Because terrain is deterministic
  from the seed, only your block edits, player, inventory, vitals, furnaces, and
  the time of day are stored — saves stay small and reloads drop you right back
  where you left off.

### Sound
- **Fully synthesized audio** (Web Audio API, no sound files): material-aware
  digging/footstep/place sounds (stone/wood/dirt/sand/gravel/glass/...), item
  pickup, eating, crafting, container open, combat swings, mob hurt/death (with
  distance falloff), player hurt/death, jump/land. Press **M** to mute.

### Graphics
- **Procedural pixel-art textures** drawn on canvas at load (zero asset files): voronoi cobblestone/gravel, growth-ring logs, crystal ores with bright facets, wind-rippled sand, grainy planks.
- **Per-vertex ambient occlusion** baked into the greedy mesher — soft contact shadows in every corner and crevice (with the classic diagonal-flip fix for smooth interpolation).
- **Climate-tinted foliage**: grass tops and leaves blend per-vertex from lush deep green (wet) to dry yellow-brown (hot+dry) across the map.
- **Block-break particles** colored from the broken block's texture, a gently **drifting water surface**, and animated star/dusk skies.

### Performance
- **Greedy meshing** merges coplanar block faces into large quads (AO patterns are part of the merge key, so shading stays exact).
- **Chunk streaming** around the player with an LRU cache that preserves edits on revisit.
- **Frustum culling** of off-screen chunks.

---

## Controls

| Input | Action |
|---|---|
| **W A S D** | Move |
| **Mouse** | Look |
| **Space** | Jump / swim up / fly up |
| **Shift** | Descend (flying) |
| **Left-click** | Mine block / attack mob |
| **Right-click** | Place block / use (table, furnace) / eat held food |
| **1–9 / Scroll** | Select hotbar slot |
| **E** | Open/close inventory |
| **F** | Toggle fly |
| **M** | Mute / unmute sound |
| **Esc** | Close UI / open pause menu (Resume, Save, Quit) |

Pick or create a world on the title screen, then click the game to lock the mouse and play.

**On touch devices** the game shows on-screen controls: a left **joystick** to move; **touch the world** to look (drag), **place** a block (quick tap), or **mine** (press & hold); a **Jump** button (and **Down** while flying); and **Fly**, **Bag** (inventory), and **☰** (pause). A **FLYING** badge shows when flight is on. Tap a hotbar slot to select it.

---

## Getting started

Requirements: **Node 18+**.

```bash
npm install
npm run dev      # start the dev server (http://localhost:5188)
npm run build    # production build to dist/
npm run preview  # preview the production build
npm run server   # multiplayer server (http://localhost:3001) — optional
```

**Multiplayer:** run `npm run server` alongside `npm run dev`, then use
**Host** / **Join** on the title screen (on localhost the client finds the
server on port 3001 automatically). To play over the internet, deploy the
server to an always-on host (Railway/Render/Fly.io — Vercel can't hold
WebSocket connections) and set `VITE_GAME_SERVER=https://your-server` when
building the client; the server also serves `dist/` itself, so a single
deploy can host both the game and its multiplayer.

> **Note:** mouse-look uses the Pointer Lock API. If "Click to play" doesn't grab the mouse, open the game in a normal browser tab (not an embedded preview pane), which may block pointer lock.

---

## Project structure

```
src/
├── core/           # Game loop, World/chunk manager, greedy mesher, Chunk
├── world/
│   ├── noise.js          # seeded simplex fields (terrain, climate, caves, rivers…)
│   ├── biomes/           # temperature+humidity -> biome
│   ├── generators/       # terrain, caves, ores
│   └── structures/       # trees
├── blocks/         # block registry + blocks.json
├── items/          # item registry + items.json
├── crafting/       # recipes + crafting engine + smelting
├── player/         # player physics, inventory, mining/placing, vitals, item drops
├── entities/       # mob types, models, and AI
├── systems/        # day/night cycle, mob spawning/management
├── net/            # multiplayer client: connection, remote avatars, ghost mobs
└── ui/             # React HUD, inventory/crafting/furnace screens

server/             # multiplayer server (Express + Socket.IO rooms/relay)
```

Blocks, items, recipes, and smelting are **data-driven** (JSON), so adding content is mostly editing data plus a sprite later.

## Tech

React 18 · Three.js · Vite · simplex-noise. Rendering is raw Three.js managed imperatively inside a React shell (chosen for control over the render loop and meshing); React handles the HUD and menus.

## Contributing

Contributions are welcome! ApexCraft is **data-driven**, so adding a block,
item, recipe, or mob is usually a small JSON/JS edit — see
**[docs/MODDING.md](docs/MODDING.md)**. Start with the
[Contributing guide](CONTRIBUTING.md) and look for **`good first issue`**
labels. Be sure to read the [Code of Conduct](CODE_OF_CONDUCT.md).

## Security

Found a vulnerability? **Please don't open a public issue** — report it
privately as described in **[SECURITY.md](SECURITY.md)** (GitHub's "Report a
vulnerability" tab or email) so it can be fixed before disclosure.

## License

MIT for the open-source core — see **[Licensing & Commercial Use](#-licensing--commercial-use)** above, and [LICENSE](LICENSE) / [CLA.md](CLA.md).

## Roadmap

- More structures and biome variety; biome blending
- Web-worker chunk generation, LOD
- Ranged combat (skeleton arrows), more mobs
- Multiplayer polish: synced chests/furnaces/item drops, in-game chat,
  client-side prediction

---

*Built iteratively, phase by phase. Not affiliated with Mojang or Minecraft.*
