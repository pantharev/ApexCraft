# Contributing to ApexCraft

Thanks for your interest in contributing! ApexCraft is a browser voxel
survival game built with React + Three.js, and it's designed to be easy to
extend.

## Quick start

```bash
git clone https://github.com/pantharev/ApexCraft.git
cd ApexCraft
npm install
npm run dev      # http://localhost:5188
npm run build    # production build (CI runs this on every PR)
```

Requirements: **Node 18+**.

## Ground rules

- **License & CLA.** Contributions are accepted under the [MIT License](LICENSE).
  By opening a pull request you agree to the [Contributor License Agreement](CLA.md) —
  please include the line `I have read and agree to the ApexCraft CLA.` in your
  first PR description.
- Be respectful — see the [Code of Conduct](CODE_OF_CONDUCT.md).
- Keep PRs focused; one feature/fix per PR.
- `npm run build` must pass (CI enforces it).

## How to contribute

1. Find or open an issue. Look for **`good first issue`** / **`help wanted`**
   labels to get started.
2. Fork, branch (`feature/your-thing`), and make your change.
3. Run `npm run build` locally.
4. Open a PR describing **what** changed and **why**; link the issue.

## Adding content (the easy part)

ApexCraft is **data-driven** — most content is JSON + a small texture function,
no engine changes needed. See **[docs/MODDING.md](docs/MODDING.md)** for
step-by-step guides to add a **block**, **item**, **recipe**, **smelting
recipe**, or **mob**.

## Project layout

```
src/
├── core/       # Game loop, World/chunk manager, greedy mesher, Chunk
├── world/      # noise, biomes, terrain/cave/ore generators, structures
├── blocks/     # block registry + blocks.json
├── items/      # item registry + items.json
├── crafting/   # recipes.json, smelting.json, engines
├── player/     # physics, inventory, mining/placing, vitals, drops, slots
├── entities/   # mob types, models, AI
├── systems/    # day/night, mobs, projectiles, torch lights, sound, storage
├── textures/   # procedural texture atlas + item icons
└── ui/         # React HUD, menus, inventory/crafting/furnace/chest, touch
```

Rendering is raw Three.js managed imperatively inside a React shell (chosen for
render-loop/meshing control); React handles the HUD and menus.

## Code style

- Plain modern JS (ES modules), 2-space indent, semicolons.
- Prefer small, readable functions with a short comment on the "why".
- No required linter yet; match the surrounding style.

## Reporting bugs / ideas

Use the issue templates. For the current direction, see the open issues and
the **Roadmap** in the [README](README.md).
