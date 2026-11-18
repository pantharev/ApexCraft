# Modding / Extending ApexCraft

ApexCraft is **data-driven**: blocks, items, recipes, smelting, and mobs are
defined in JSON / small JS tables. Most additions are 1–3 file edits with no
engine changes. This guide shows the common ones.

After any change: `npm run dev` to test, `npm run build` to verify.

---

## Add a block

1. **`src/blocks/blocks.json`** — add an entry with a new unique `id`
   (next integer) and `name`:
   ```json
   { "id": 27, "name": "mossy_stone", "solid": true, "hardness": 1.6,
     "requiresTool": "pickaxe", "minToolTier": 1,
     "drops": [{ "item": "mossy_stone", "count": [1, 1] }] }
   ```
   Useful fields: `solid`, `transparent`, `hardness` (−1 = unbreakable),
   `requiresTool` (`pickaxe`/`axe`/`shovel`), `minToolTier`, `preferredTool`,
   `interactive` (right-click opens a screen), `luminance`, `drops`.

2. **`src/textures/atlas.js`** — draw a 16×16 tile and map the block's faces:
   - add a `DRAW.mossy_stone = (c, r) => { ... }` routine (use the existing
     helpers `paint`, `valueNoise`, `voronoi`, `setPx`; `wrap`/`pick` keep
     details tileable);
   - add to `FACE_TILES`: `mossy_stone: t('mossy_stone')` (or
     `{ top, side, bottom }` for different faces);
   - natural tiles: add the tile name to `DRIFT` (per-block brightness
     variation in the world) or, if the tile has no "up" — soil, rock,
     foliage — to `ROTATE` (each block is also turned a random way, which
     hides the tiling). Leave built or directional tiles (planks, bricks,
     anything with a top edge) out of both.

3. (Optional) make it placeable: add a matching **item** (below) with
   `"placeBlock": "mossy_stone"`.

That's it — terrain meshing, mining, drops, and lighting pick it up
automatically.

---

## Add an item

**`src/items/items.json`**:
```json
{ "name": "ruby", "display": "Ruby", "color": "#e0244a", "maxStack": 64 }
```
Fields: `display`, `color` (used for the icon fallback), `maxStack`,
`placeBlock` (makes it a placeable block item), `food` (hunger restored),
`toolType` + `tier` + `miningSpeed` + `attackDamage` (makes it a tool/weapon).

Item icons are generated in `src/textures/icons.js`. Block items reuse their
block tile automatically; tools/food/materials get a procedural icon. Add a
custom drawing there if you want a specific look.

---

## Add a crafting recipe

**`src/crafting/recipes.json`** — shaped (pattern + key) or shapeless
(ingredients):
```json
{ "id": "ruby_pickaxe", "type": "shaped",
  "pattern": ["RRR", " S ", " S "],
  "key": { "R": "ruby", "S": "stick" },
  "result": { "item": "ruby_pickaxe", "count": 1 } }
```
- A recipe's grid size determines where it can be crafted: 2×2 in the
  inventory, 3×3 needs a crafting table (the recipe book enforces this).
- Shapeless: omit `pattern`, add `"ingredients": ["oak_log"]`.

---

## Add a smelting recipe

**`src/crafting/smelting.json`** — add to `recipes` (input → output) and,
optionally, a `fuels` entry:
```json
{ "input": "ruby_ore_chunk", "output": "ruby", "count": 1 }
```

---

## Add a mob

1. **`src/entities/mobTypes.js`** — add an entry under `MOBS`:
   ```js
   frog: {
     category: 'passive',           // or 'hostile'
     health: 6, speed: 1.5, hw: 0.35, h: 0.6,
     drops: [{ item: 'string', count: [0, 1] }],
     parts: [
       { id: 'body', size: [0.5, 0.3, 0.6], pos: [0, 0.3, 0], color: '#4f9a3a' },
       { id: 'head', size: [0.4, 0.25, 0.3], pos: [0, 0.4, 0.4], color: '#5aa844', head: true },
       // …legs with `leg: true`
     ],
   }
   ```
   Hostile options: `attack`, `detect`, `burns` (daylight), `climbs` (walls),
   `ranged` (shoots — see skeleton).

   Models are boxes (`parts`): `size` and `pos` (the box centre, measured
   from the feet) in blocks, with the mob facing +z. Flags make a part move:
   `head: true` (turns to look), `leg: true` (swings while walking),
   `arm: true` (posed by the mob's `gait`), `tail: 'back' | 'hang'` (wags),
   `wing: true` (flaps). The comment at the top of the file lists them all.
   The skin is painted at 16 pixels per block, so sizes on a 1/16 grid
   (0.0625) give the cleanest result.

2. (Optional) **`src/entities/mobSkins.js`** — paint the details. Without a
   painter the mob still gets a mottled coat in its part colours; a painter
   adds the face and markings, addressing parts by their `id`:
   ```js
   frog(p) {
     const face = p.face('head', 'front');
     eyes(face, 1, 1, '#141414', { white: '#ffffff' });
     p.face('body', 'top').blotches(3, 2, '#3a7a2c');   // darker spots
   },
   ```
   Pass `true` as the last argument of `px`/`rect` (or `{ glow: true }` to
   `eyes`) to make those pixels shine in the dark.

3. Spawning is automatic: passive mobs spawn on grass by day, hostile at
   night (see `src/systems/MobManager.js` for caps / distances).

---

## Bigger systems

- **Terrain/biomes:** `src/world/generators/TerrainGen.js`,
  `src/world/biomes/BiomeMap.js`, noise fields in `src/world/noise.js`.
  **Existing worlds must not change.** Terrain is regenerated from the seed
  every time, so if what a seed generates changes, everything a player built
  ends up buried or in mid-air. Each world keeps the generator *version* it
  was created with (it is stored in the top bits of the seed — see the notes
  at the top of `noise.js`). To change generation: add a version, branch on
  `getGen()`, leave the older branches alone, and bump `GEN_LATEST`. The
  fingerprints in `src/core/chunkTest.js` fail if an existing version moves.
  World generation runs in web workers (`src/core/chunkWorker.js`), so this
  code — and anything it imports, structures and arena maps included — must
  not touch the DOM, three.js or the running game. A chunk may depend only on
  the seed, the generation mode and the active arena map. `src/core/chunkTest.js`
  runs it under plain Node and fails if that rule is broken.
- **Structures** (like trees): `src/world/structures/` — called from
  `TerrainGen`.
- **Projectiles** (arrows; reusable for guns/spells):
  `src/systems/Projectiles.js`.
- **Sound:** add a synth method in `src/systems/Sound.js` and call it.

If you add a whole new system, wire it into `src/core/Game.js` (construct it,
tick it in the loop, and serialize it in `serialize()` if it needs saving).

Questions? Open an issue. Have fun building!
