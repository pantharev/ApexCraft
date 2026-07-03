# ApexCraft — TODOs

Working task list (near-term, actionable). Bigger-picture brainstorm lives in
`ideas.md`. Check items off as they ship.

## Landing page
- [x] **In-app landing screen** — hero + Play CTA before the world menu
  (`ui/Landing.jsx`, landing→menu→playing). Shipped (PR #6).
- [ ] **Standalone designed landing** — build the nicer, externally-designed
  landing on a NEW branch when the design is ready. Can replace `Landing.jsx`'s
  contents or front it as a separate page; its Play button calls the same flow
  (→ world menu).

## Accounts & sharing
- [ ] **Google auth + cloud saves** — sign in with Google; store worlds in a
  hosted DB so saves sync across devices (instead of per-browser IndexedDB).
  - Needs a backend/service: Firebase (Auth + Firestore) or Supabase (Auth +
    Postgres) are the quickest fits for a static Vite app on Vercel.
  - Reuse the existing save shape (`Game.serialize()` → `{ edits, player,
    inventory, vitals, furnaces, chests, time, seed }`); just swap the storage
    layer (`systems/Storage.js`) for cloud read/write, keeping IndexedDB as an
    offline/guest fallback.
- [ ] **Share worlds with others** — export/import a world, and/or share via a
  link/code.
  - Easy first step: export a world to a `.json` file and import it (works with
    the current save format, no backend).
  - Better: once cloud saves exist, generate a share link that copies a
    read-only snapshot of a world into the recipient's account.
  - (Real-time co-op is a separate, larger effort — see `ideas.md` §Multiplayer.)

## Multiplayer (Node.js + Express + Socket.IO)
- [x] **Real-time co-op v1** (feature/multiplayer) — Express + Socket.IO room
  server (`server/`, `npm run server`); host-authoritative: hosting client
  simulates mobs, guests render ghosts. Host any world from the title screen,
  join by 5-letter room code (up to 8 players). Synced: block edits (late
  joiners get full world), player avatars + name tags, mob snapshots @10Hz,
  projectiles, day/night clock, host migration. Server protocol tests in
  `server/test.js` (in CI).
- [ ] **Multiplayer polish** — sync chest/furnace contents + item drops;
  in-game chat; client-side prediction/reconciliation; deploy server
  (Railway/Render/Fly.io — Vercel can't hold WebSockets) + set
  `VITE_GAME_SERVER` on the Vercel build.

## World generation fixes
- [x] **Terrain noise looks bad — mountains too "wally"/cliffy.** Fixed in
  feature/visual-overhaul: one continuous domain-warped heightfield (continent
  + erosion + ridged-fBm mountain ranges with a smooth mask), measured ~0%
  cliff steps ≥5 blocks across seeds; biome borders dithered; altitude-driven
  rock/snow lines. Note: changes terrain for existing seeds (old worlds'
  edits replay onto different ground).
- [ ] ~~(superseded by the fix above)~~ Original notes:
  - Current cause (in `world/generators/TerrainGen.js` + `world/biomes/BiomeMap.js`):
    height = per-biome `base + pow(noise, exponent) * amp` **plus** `continent *
    22`. Mountains use `amp 30, exponent 1.35`; the `pow` + large per-biome amp +
    additive continent term create steep walls, and biome borders jump because
    each biome has a different `base`/`amp` (discontinuous heightfield).
  - Ideas to try:
    - Build **one continuous heightfield** (multi-octave fBm) and use biomes to
      modulate it smoothly, instead of each biome computing its own base+amp.
    - **Blend biome params** across borders (smoothstep by distance) so height
      doesn't step at seams.
    - Lower the exponent / reduce amplitude; add more, lower-amplitude octaves
      for gentler, rolling shapes.
    - **Domain warping** for more natural ridgelines instead of blocky walls.
    - Clamp max slope (erosion-like smoothing pass) so cliffs become hills.
  - Goal: rolling, climbable mountains; smooth biome transitions; no vertical
    walls except intentional cliffs.

## Prop Hunt arena maps
- [x] **Map framework + Little Town** (PR #36) — map registry in
  `src/world/arenas/` (each map: `{ id, name, desc, half, baseSurface,
  propBlocks, botSpots, generate(chunk), seekerSpawn, hiderSpawns,
  lobbySpawn }`), picked at world creation, saved + synced to guests.
  Old procedural box arena retired. New maps = one module in
  `src/world/arenas/maps/` + registry entry in `index.js`; copy town.js's
  seed-cached-layout + per-chunk-stamping idiom.
- [ ] **Castle Dracul map** (`half=44`, base grass) — separate PR.
  - Crenellated 2-thick stone curtain wall h≈9 (~30% deterministic mossy
    weathering via `cellHash`), stone_slab wall-walk, ladders up at midpoints.
  - Four hollow 7×7 corner towers h≈15, ladder to top, glass_pane arrow slits.
  - South gatehouse: 4×4 arch, fence portcullis with walk-through gaps, torch
    pairs won't light (gen-time) — use recessed, fence-guarded **lava trenches**
    flanking the entry for light (lum 15, no light-pool slot needed).
  - Keep/great hall (~21×13, stone/andesite, h=8): fence-leg + oak_slab dining
    table, oak_stairs chairs, wool throne on a dais, kitchen (2 furnaces,
    crafting table, chests, hay sacks).
  - Courtyard = seeker pen (patchy stone/mossy paving, mossy well, stable
    lean-to with hay, smithy lean-to).
  - West graveyard: dirt mounds, stone_slab headstones, poppies, pumpkin patch,
    2–3 dead trees (bare oak_log).
  - **Crypt** carved below floor (~15×9, y 58–62): ladder shaft from a 3×3
    mausoleum, slab coffins, chests, ~5 glow mushrooms via `chunk.lights`
    (near-dark; uses the separate 6-slot glow pool).
  - propBlocks: mossy_cobblestone, chest, furnace, hay_bale, crafting_table,
    pumpkin. Bots can't climb/descend → botSpots stay on the main floor
    (courtyard/keep/gate/graveyard); crypt + parapets are human territory.
- [ ] **The Playroom (giant room) map** (`half=40`, base oak_planks
  floorboards, ~7× furniture scale) — separate PR.
  - Enclosed shell: h≈26 walls (sandstone wainscot, wool wallpaper), plank
    **ceiling** with 2-wide glass skylight strips (daylight carries the room).
    Roofed ⇒ relies on the map `lobbySpawn()` (already framework-supported).
  - Giant table: 3×3 oak_log legs h=10, 22×16 plank top at +11, ladder up a
    leg; fruit bowl (stone + melons/pumpkins), chess_table pair on top.
  - Two chairs (9×9 seat h=6, backrest to h=15, under-chair crawl space),
    bookshelf 24w×22h×4d ("books" = runs of wool/hay/melon/pumpkin/chest with
    hide gaps, side ladder), giant bed (18×11 wool mattress, snow pillows,
    2-high under-bed crawl space), fireplace (stone chimney, fence-guarded
    lava firebox, slab mantel), toy corner (block cubes, sandstone toy castle,
    glow-mushroom night lights), 20×14 wool rug at origin = seeker pen.
  - propBlocks: wool, melon, pumpkin, hay_bale, chest, crafting_table,
    chess_table. Hider spawns + prop scatter floor-heavy (bots stay on the
    floor); tabletops/shelves/mantel reachable by ladder during hide time.
- [ ] **Maybe later**: Harbor Cove (water basin, plank ships, wool sails,
  cargo chests) · Hedge Garden (oak_leaves maze, glass greenhouse, pumpkin
  patch) · lobby HUD map badge · multiplayer bots (bots are still solo/host
  only — socket-less, not broadcast to guests).

## Known issues
- [ ] **Mobile inventory drag-and-drop still buggy.** Touch drag-and-drop was
  added (PR #8) but isn't fully reliable yet — needs another pass (e.g.,
  tap-vs-drag disambiguation, dropping onto the right slot, the held item
  following the finger consistently, long-press to split). Revisit.

## Notes
- `ideas.md` and this file are docs for planning — not yet committed to the repo.

[x] - water and lava should behave like liquid

[x] -  change log should be active with dates for new features/fixes done in a page visible for the user.
[] - allow comments/testimonials

[] - create a roadmap page for expected updates.

[] - new prop hunt map
[] - capture the flag game mode with weapons & bows

[] - possible gun mods and game modes
