# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

ApexCraft is a browser voxel survival game (Minecraft-style) built with React + Three.js + Vite. Pre-alpha. All textures and audio are generated procedurally in code — there are no binary asset files.

for new features, create a new branch feature/feature_name. Then create a PR using gh cli, with a good name & description.

## Commands

```bash
npm install
npm run dev      # Vite dev server on http://localhost:5188 (strictPort)
npm run build    # production build to dist/
npm run preview  # preview the production build
npm run server   # multiplayer server on :3001 (Express + Socket.IO) — optional
```

There is no lint step and no test runner/framework. The two test suites are plain Node scripts (this is exactly what CI runs, see `.github/workflows/ci.yml`):

```bash
node server/test.js             # multiplayer protocol integration test (spins up the server on :3199)
node src/chess/engineTest.js    # chess move-gen perft + bot legality/mate/speed
node src/world/arenas/arenaTest.js # arena map structural checks (not in CI — run it when touching src/world/arenas)
```

They print `ok -` / `FAIL -` lines. There is no way to run a single case — edit the script to narrow it.

CI = `npm run build` + the two scripts above. There is no automated test for the voxel engine itself; verify gameplay changes by running `npm run dev`. **Do not auto-start the dev server** — the user controls it (ask first).

## Architecture

### The React/Three.js boundary
React owns only the menus and HUD overlays. The 3D engine is raw Three.js driven imperatively — React never re-renders the game.

- `src/App.jsx` — the shell. Manages app phase (`landing` → `menu` → `playing`), world selection, and multiplayer host/join. On entering a world it constructs one `Game` and calls `game.start()`; on leaving it calls `game.dispose()`.
- `src/core/Game.js` — the god object. Owns the renderer, scene, camera, the `requestAnimationFrame` loop (`_loop`), and every subsystem (world, player, inventory, vitals, mobs, day/night, projectiles, explosions, chess, furnaces/chests, multiplayer wiring). **Almost all cross-system glue lives here** via callback wiring set up in the constructor.
- Game → React communication is one-directional through `onX` callback fields that `App.jsx` assigns after construction (`game.onStats`, `onScreenChange`, `onDead`, `onSleep`, `onToast`, …). The loop pushes a stats snapshot to `onStats` every frame; React `setState`s from these. **Never drive the render loop from React state.**

### Game modes
A world's `mode` is fixed at creation: `survival` (default), `creative`, `hideseek` (Prop Hunt), or `zombies` (co-op wave defense). `Game.js` sets boolean flags (`this.creative/hideseek/zombies`) in the constructor and branches on them throughout — check all four modes when touching input, vitals, spawning, or the day/night clock.

- The two match modes replace procedural terrain with **fixed arena maps** from `src/world/arenas/` (`MAPS`: town, castle, playroom, bastion; selected via `setActiveMap`). Arenas emit unbreakable shells (`hardness < 0`) plus interactive blocks (wall-buys, mystery box).
- `src/systems/HideSeek.js` + `HideSeekBots.js` and `src/systems/ZombiesMode.js` are **host-authoritative round state machines**: the host runs the FSM and mob waves; guests send intents and mirror synced `match` state. Mode UIs live in `src/ui/HideSeekUI.jsx` / `ZombiesUI.jsx`.
- Zombies guns are data-driven via a `gun` field on items (`items.json`); magazine state lives in `Game.guns` (client-local, never synced). Mob wave scaling uses per-instance multipliers on `Mob` (`speedMul`/`attackMul`) — **never mutate the shared `def` from `mobTypes.js`**.

### Chunked voxel world
- `src/config.js` — all world tuning constants (`CHUNK_SIZE=16`, `WORLD_HEIGHT=128`, `SEA_LEVEL=62`, load/unload radii, LRU cache size).
- `src/core/World.js` — chunk manager. Per-frame `update(playerX, playerZ, budget)` generates/meshes chunks nearest-first within `LOAD_RADIUS` (budgeted to avoid frame hitches) and unloads beyond `UNLOAD_RADIUS` into an LRU `cache` (preserves edits, skips regen on revisit). `getBlock`/`setBlock` work in global voxel coordinates across chunk boundaries.
- **Edits map is the source of truth for player changes.** `World.edits` (`"cx,cz"` → `Map(localIndex → blockId)`) is what gets saved, synced over the network, and replayed onto freshly generated terrain. Terrain itself is never saved — it is deterministic from the seed, so saves only store edits + player/inventory/vitals/time. This same chunk-keyed edit form is shared by the save system (`World.serializeEdits`) and the netcode (`Net.encodeEdit`).
- `src/core/ChunkMesher.js` — greedy mesher. Merges coplanar faces into large quads; the per-face ambient-occlusion pattern is packed into the merge mask key so AO stays exact across merged quads. Non-cube blocks (plants, doors, beds, fences, ladders, panes, slabs, stairs) are in the `SPECIAL` set and drawn by a separate pass, not greedy-meshed. Geometry groups index into a shared per-tile material array; water/lava use their own materials.
- `src/world/` — generation. `noise.js` holds ~18 independently-seeded simplex fields (terrain, climate, caves, rivers, mountains, rifts…); call `reseed(seed)` before constructing a `Game` (App.jsx does this). `generators/TerrainGen.js` is the entry point and calls into `biomes/`, `generators/` (caves, ores), and `structures/` (trees, villages).
- `src/systems/Liquids.js` — tick-based water/lava flow. Flow levels are their own block ids; the sim is edge-triggered (only edits/neighbor changes queue ticks) and host-authoritative — flow results propagate as ordinary block edits.
- `src/systems/TorchLights.js` — dynamic light manager. Three.js point lights are a **hard-capped pool** (10 warm torch + 6 cool glow = 16), assigned to the nearest sources within a scan radius each frame; beyond that, torches/glow flora render but cast no light. Don't add per-source `PointLight`s elsewhere — route new emitters through this pool.

### Data-driven content
Blocks, items, recipes, smelting, and mobs are defined in JSON / small JS tables, loaded into registries that are the single source of truth. Adding content is usually a 1–3 file edit with no engine change — **`docs/MODDING.md` is the authoritative how-to; read it before adding a block/item/recipe/mob.**

- `src/blocks/blocks.json` + `BlockRegistry.js` — indexed by numeric `id` (used hot in the mesher). `Blocks.<NAME>` and `getBlockId(name)` resolve names.
- `src/items/items.json` + `ItemRegistry.js` — items referenced by string name everywhere (drops, recipes, inventory). An item with `placeBlock` is placeable; `food`/`toolType` make it edible/a tool.
- `src/crafting/` — `recipes.json` (shaped/shapeless; grid size decides inventory-2×2 vs table-3×3) and `smelting.json`, run by `CraftingEngine.js` / `Smelting.js`.
- `src/entities/mobTypes.js` — mob stats + box-part models; spawning is automatic via `systems/MobManager.js`.
- `src/textures/atlas.js` + `icons.js` + `cracks.js` — procedural canvas textures; a new block needs a `DRAW.*` routine and a `FACE_TILES` entry.
- Audio is procedural too: `src/systems/Sound.js` (effects, Web Audio) and `Music.js` + `tracks.js` (Tone.js soundtrack composed in code, rotated by day/night/cave context).

### Multiplayer (host-authoritative)
- `server/index.js` — Express + Socket.IO **relay only**. Manages rooms (5-letter codes), accumulates per-room block edits so late joiners get the full world (seed + edits), and relays player state / mobs / projectiles / chess / explosions. Serves `dist/` if built, so one deploy hosts both. Picks a new host on disconnect (host migration).
- `src/net/Net.js` — client connection. **The host client simulates mobs and the world clock**; guests render "ghost" mirrors (`net/GhostMobs.js`) and report hits back to the host. `net.applying` guards against echoing remote edits back out. `isOrigin` = hosted from a local save → only that client persists the world.
- In `Game.js`, the loop branches on `this.net && !this.net.isHost` (guest) vs host/single-player throughout — e.g. `_mobApi()` returns ghost mobs for guests, real mobs otherwise. Keep this distinction in mind when touching simulation code.

### Persistence
`src/systems/Storage.js` saves to IndexedDB. `Game.serialize()` bundles seed + edits + player + vitals + inventory + furnaces + chests + chess + time. Autosaves every 15s, on tab close, and via the pause menu. A world's `mode` and seed are fixed at creation.

## Conventions
- ES modules throughout, `.js`/`.jsx`, Node ≥ 20, `"type": "module"`.
- No CSS files — all styling is inline style objects in JSX.
- Dev-only affordances (T cycle day/night, V teleport to village, G speed boost, `window.__apex` handle) are gated on `this.dev` = running on localhost.
- When adding a whole new subsystem, wire it into `Game.js`: construct it in the constructor, tick it in `_loop`, and add it to `serialize()` if it must persist.
- **After every merged PR, update both changelogs**: add a compact technical entry (key decisions, file pointers, gotchas) to `changelog.md` — it is the handoff document between machines and Claude Code instances, read it at the start of a session to catch up — and prepend a short player-facing `{ date, title, body }` entry to the `CHANGELOG` array in `src/ui/Changelog.jsx` (feeds the in-game "What's New" page).
