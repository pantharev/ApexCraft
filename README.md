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
- **Procedural terrain built from landforms**: a *continental* profile gives deep ocean, shelf, beaches, lowlands and interior highlands; an *erosion* field separates flat country from rugged; **plateau country** steps up in benches with cliffs between them; **mountain ranges** rise in ridged crests with jagged detail on top; and rivers run in valleys they have cut wider than themselves, narrowing to gorges in the ranges. Steep ground breaks into **ledges and overhangs**, and is bare rock where you could not walk up it.
- **Worlds never change under you**: terrain is not saved, so each world keeps the generator version it was created with (it rides in the seed). New worlds get the newest terrain; old worlds stay exactly as they were.
- **Biomes** from temperature + humidity (plains, desert, mountains, snowy, jungle, swamp) with organically dithered borders; the land has a say too — it gets colder with height, swamps settle at the waterline, deserts ripple into dunes — and **altitude takes over up high**: bare rock above the treeline, wandering snowlines on the peaks. Jungle spots grow tall two-tier trees.
- **Oceans, lakes & rivers** — winding river channels whose width breathes along the course; varied sea floors (sand banks, gravel runs, clay pockets); beaches at the shore.
- **A real underground**: winding **spaghetti tunnels** (two intersecting 3D fields) that surface as cave entrances, big **cheese caverns** at depth, rare **landmark caverns** (huge chambers worth the trek), and **rifts** — deep ravines that split the land open 15–40 blocks down. Enclosed caves are **genuinely dark** (skylight fades a few blocks past the entrance), lit only by your torches, **lava**, and clusters of bioluminescent **glow mushrooms** that ring underground water pools. **Ore veins** (coal, iron, gold, redstone, lapis, diamond, emerald) are placed by depth and rarity and **bias toward exposed cavern walls**, so caving beats blind strip-mining.
- **Surface flora**: tall-grass meadows that thicken with humidity, rare **flower fields** of poppies and dandelions (pick + replant them), and **cacti** columns in the deserts.
- **Villages** (about one per ~800 blocks of travel): a walled cobblestone **well** at the centre, 4–7 plank-and-log **houses** with real openable doors facing the well, glass windows, beds inside, gravel **paths**, and the odd crafting table or chest — all generated deterministically across chunk borders. **Villagers** in brown robes wander between the houses, watch you walk by — and **run home at nightfall**.
- **Trees** scattered only on grass, clumped by a *forest* noise field so you get dense woods and open plains both.
- **A 20-minute day**: ten minutes of daylight, a 50-second sunset, a night of 8 minutes 20 seconds, and a 50-second dawn. Monsters wait for full dark and the undead burn only once the sun is actually up; a bed skips the night from mid-dusk on. The HUD clock names the part of the day you are in.
- **Day/night cycle** with a moving sun and moon (sunrise in the east, set in the west), a **wheeling star dome** at night, glowing halos around the sun/moon, and **orange dawn/dusk skies** with warm horizon light.

### Game modes
- **Survival** (default) — the full loop: mobs, mining, hunger, fall/drown damage, and gathering resources to craft.
- **Creative** — pick it when creating a world: an **infinite palette of every block** (placing never depletes), **no mobs**, **no damage or hunger**, **instant block breaking**, and you **start flying**. Build freely. The mode is fixed per world and shown with a badge on the title screen (and a **CREATIVE** indicator in-game).

### Survival & combat
- **Health, hunger, and air** — hunger drains with activity, health regenerates when well-fed, and you starve at empty. Head underwater drains the air bar, then you drown.
- **Damage** from falls (scales with distance), drowning, and mob attacks — hits **knock you back** away from the attacker (arrows shove you along their flight). Death drops your inventory and shows a respawn screen.
- **Swimming** — buoyant water physics: plunge in, sink slowly, hold jump to swim up. Water cancels fall damage.
- **Mobs**
  - *Passive* (day): pig, cow, sheep, chicken — wander, **graze**, watch you walk by (heads track), and flee when hit.
  - *Hostile* (night): zombie & spider chase and melee (spiders **climb walls**); **skeletons keep their distance and shoot arrows**; **creepers** close in, hiss, swell… and **explode**. Zombies and skeletons **burn in daylight**. Bodies turn smoothly, keep eye contact while hunting, and **slump over and fade** when slain.
  - *Cave dwellers*: the same hostiles spawn in the **dark underground at any hour**, so caving is dangerous even at noon — and harmless **bats** flit through the gloom.
  - **Village sieges**: zombies hunt villagers at night; villagers flee in a panic; each village fields an **iron golem** that batters any monster on sight (and drops iron when it falls).
  - Craft a **bow** + arrows for your own ranged attacks.
  - Mobs drop loot (meats, leather, bone, string, feather, wool, …). Cook meat in a furnace for more nourishment.

### Building & items
- **Mining** with staged **crack textures** as the block breaks, tool-tier gating (wrong tier = no drop), and item-drop entities that you walk over to collect.
- **Inventory** — 36 slots + hotbar, drag/stack/split with a cursor, item tooltips.
- **Crafting** — 2×2 pocket grid plus a 3×3 crafting table (right-click a placed table). Shaped & shapeless recipes; shift-click to craft a full stack.
- **Doors, stairs & beds** — craft **doors** (right-click to swing them open/shut), **stairs** that orient to face you when placed (and that you **walk up** without jumping), and **beds**: right-click one at night for a short sleep fade that skips straight to sunrise.
- **TNT** — craft it from gunpowder + sand, place it, right-click to light the fuse… and stand back. Chain reactions included.
- **More to build with** — wool, sandstone (and natural sandstone under deserts), mossy cobblestone, **slabs** (half-steps you walk up), **ladders** you can climb, glass panes, fences, pumpkins, melons, and hay bales.
- **♟️ Chess table** — craft one (wool + planks), place it, right-click to sit down at a full **lichess-style board** floating over the game world. Complete rules (castling, en passant, promotion, mate detection — perft-verified engine). In multiplayer the first two players get the seats and everyone else **spectates live**; solo it's a hotseat board. Games persist with your save.
- **Smelting** — place a furnace, add fuel + input; smelt ores into ingots, sand into glass, and raw meat into cooked food.
- **Recipe book** — a "Recipes" tab in the inventory, crafting table, and furnace screens lists every recipe with its ingredients (have/need), and one-click crafts anything you have materials for (shift-click crafts all).

### Multiplayer (co-op)
- **Host any of your worlds** from the title screen and share the 5-letter
  **room code**; up to 8 friends can join your world live.
- **Shared world**: block breaking/placing syncs instantly for everyone, and
  late joiners receive the full edited world. The host's save persists all
  changes.
- **See each other**: painted player avatars with name tags — each wearing
  the character that player picked — that walk, swing their arms, look where
  their player is looking, and carry whatever that player is holding;
  everyone's arrows fly for all to see (no friendly fire).
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
- **A living title screen**: the menus sit in front of the game itself — a slow flight over freshly generated terrain, with the sun crossing the sky and a short starry night. A different place every visit, and no video file behind it.
- **Caves worth exploring** (new worlds): tunnels that pinch to a crawl and open into galleries, great caverns with pillars of rock left standing, lush caves hung with glowing vines over moss and mushrooms, dripstone caves full of stalagmites and stalactites, still underground lakes, and lava lakes far below that light the rock around them — all over a floor of dark deepslate.
- **Living water**: a surface that swells and drifts in pixel art, mirrors the sky toward the horizon, glitters under the sun and moon, foams along the shore and runs pale and clear where it is shallow. The ground under it darkens with depth and has light rippling across it, waterfalls fall in streaks, and from below the surface is a bright window ringed by a dark mirror.
- **Real-time sun and moon shadows**: terrain, trees (dappled through the leaves), mobs, players, and dropped items all cast and catch them. A **Graphics: High / Low** switch in the pause menu turns shadows off on slower machines (Low is the default on touch devices).
- **Filmic lighting and atmosphere**: tone-mapped rendering, a gradient sky with drifting voxel clouds, warm low-sun light and cool moonlight, distance haze that dissolves the world's edge into the horizon, dense blue murk under water, and eyes that adjust to the dark underground.
- **Procedural pixel-art textures** drawn on canvas at load (zero asset files): bladed grass with ragged turf edges, pebbly dirt, voronoi cobblestone/gravel, growth-ring logs, nugget ores with bright facets, wind-rippled sand, grainy planks — shaded with warm highlights and cool shadows.
- **No tiling quilt**: in the world, every block of soil, rock, and foliage is turned a random way and shaded slightly differently, with soft large-scale variation on top, so wide surfaces look natural rather than stamped.
- **Painted mobs**: every creature wears a generated pixel-art skin at the same scale as the blocks — faces, patched hides, wool, striped fur, torn clothes, ribs — and hostile eyes glow in the dark. Tails wag, wings flap, and spiders scuttle on eight splayed legs.
- **Pick your character**: six to choose from on the world list — Man, Woman, Santa, Ms. Santa, Nurse and Engineer — each painted in the game's own pixel art, hats and beards included. It is who you are in every world, and who your friends see in multiplayer.
- **A body of your own**: in first person you cast your own shadow, arms and held item included; press **C** to step the camera out behind your character, and again to turn it round and see your face.
- **Per-vertex ambient occlusion** baked into the greedy mesher — soft contact shadows in every corner and crevice (with the classic diagonal-flip fix for smooth interpolation).
- **Climate-tinted foliage**: grass tops and leaves blend per-vertex from lush deep green (wet) to dry yellow-brown (hot+dry) across the map.
- **Block-break particles** colored from the broken block's texture, and animated star/dusk skies.

### Performance
- **Greedy meshing** merges coplanar block faces into large quads (AO patterns are part of the merge key, so shading stays exact).
- **One texture array for the whole world**: every block tile is a layer of a single array texture, so each chunk's solid terrain draws in one call (cut-outs in a second) instead of one per block type.
- **Chunk streaming in web workers**: terrain is generated and meshed on other cores while the game keeps running, so exploring does not stutter; an LRU cache preserves edits on revisit.
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
| **C** | Cycle the camera: first person → behind you → facing you |
| **M** | Mute / unmute sound |
| **Esc** | Close UI / open pause menu (Resume, Save, Quit) |

Pick or create a world on the title screen, then click the game to lock the mouse and play.

**On touch devices** the game shows on-screen controls: a left **joystick** to move; **touch the world** to look (drag), **place** a block (quick tap), or **mine** (press & hold); a **Jump** button (and **Down** while flying); and **Cam** (first / third person), **Fly**, **Bag** (inventory), and **☰** (pause). A **FLYING** badge shows when flight is on. Tap a hotbar slot to select it. In inventory screens: **tap** to move a stack, **drag** to carry it (it follows your finger), **hold** to split.

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
├── core/           # Game loop, World/chunk manager, chunk workers, greedy mesher, Chunk
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
- Level-of-detail terrain for longer view distances
- Ranged combat (skeleton arrows), more mobs
- Multiplayer polish: synced chests/furnaces/item drops, in-game chat,
  client-side prediction

---

*Built iteratively, phase by phase. Not affiliated with Mojang or Minecraft.*
