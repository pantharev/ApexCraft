# ApexCraft

A voxel survival game in the browser — a Minecraft-style sandbox built with **React** and **Three.js**. Explore a procedurally generated world of biomes, oceans, and forests; mine and build; craft tools and smelt ores; survive hunger, drowning, and falls; and fend off mobs that hunt you after dark.

> Pre-alpha. Blocks and mobs use flat colors / simple box models (textures are on the roadmap), but the full gameplay loop is in place.

---

## Features

### World
- **Procedural terrain** from layered simplex noise, with a biome map driven by temperature + humidity (plains, desert, mountains, snowy, jungle, swamp).
- **Oceans, lakes & rivers** — a low-frequency *continental* field carves ocean basins and raises highlands; a *river* field carves winding channels; inland basins fill into lakes. Beaches and seabeds are sand.
- **Caves** carved with 3D noise, and **ore veins** (coal, iron, gold, redstone, lapis, diamond, emerald) placed by depth and rarity.
- **Trees** scattered only on grass, clumped by a *forest* noise field so you get dense woods and open plains both.
- **Day/night cycle** with a moving sun and moon (sunrise in the east, set in the west), shifting sky/fog color and light.

### Survival & combat
- **Health, hunger, and air** — hunger drains with activity, health regenerates when well-fed, and you starve at empty. Head underwater drains the air bar, then you drown.
- **Damage** from falls (scales with distance), drowning, and mob attacks. Death drops your inventory and shows a respawn screen.
- **Swimming** — buoyant water physics: plunge in, sink slowly, hold jump to swim up. Water cancels fall damage.
- **Mobs**
  - *Passive* (day): pig, cow, sheep, chicken — wander and flee when hit.
  - *Hostile* (night): zombie, skeleton, spider — chase and melee you. Spiders **climb walls**; zombies and skeletons **burn in daylight**.
  - Mobs drop loot (meats, leather, bone, string, feather, wool, …). Cook meat in a furnace for more nourishment.

### Building & items
- **Mining** with break-progress, tool-tier gating (wrong tier = no drop), and item-drop entities that you walk over to collect.
- **Inventory** — 36 slots + hotbar, drag/stack/split with a cursor, item tooltips.
- **Crafting** — 2×2 pocket grid plus a 3×3 crafting table (right-click a placed table). Shaped & shapeless recipes; shift-click to craft a full stack.
- **Smelting** — place a furnace, add fuel + input; smelt ores into ingots, sand into glass, and raw meat into cooked food.
- **Recipe book** — a "Recipes" tab in the inventory, crafting table, and furnace screens lists every recipe with its ingredients (have/need), and one-click crafts anything you have materials for (shift-click crafts all).

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

### Performance
- **Greedy meshing** merges coplanar block faces into large quads.
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

---

## Getting started

Requirements: **Node 18+**.

```bash
npm install
npm run dev      # start the dev server (http://localhost:5188)
npm run build    # production build to dist/
npm run preview  # preview the production build
```

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
└── ui/             # React HUD, inventory/crafting/furnace screens
```

Blocks, items, recipes, and smelting are **data-driven** (JSON), so adding content is mostly editing data plus a sprite later.

## Tech

React 18 · Three.js · Vite · simplex-noise. Rendering is raw Three.js managed imperatively inside a React shell (chosen for control over the render loop and meshing); React handles the HUD and menus.

## Roadmap

- More structures and biome variety; biome blending
- Web-worker chunk generation, LOD
- Ranged combat (skeleton arrows), more mobs

---

*Built iteratively, phase by phase. Not affiliated with Mojang or Minecraft.*
