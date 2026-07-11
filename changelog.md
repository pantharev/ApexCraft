# ApexCraft changelog — developer & agent handoff notes

Purpose: transfer working context between machines and Claude Code instances.
One compact entry per merged PR, newest first: what shipped, the key technical
decisions, file pointers, and gotchas a fresh session needs. **Keep this
updated with every merged PR** (and mirror a short player-facing entry in the
`CHANGELOG` array in `src/ui/Changelog.jsx` — that one feeds the in-game
"What's New" page).

---

## 2026-07-11 — #47 Zombies guns: M14, AK-74u, Galil + Mystery Box Ray Gun

Stacked on #46. Guns are **data-driven** via a new `gun` field on items
(`src/items/items.json`): `{auto, dmg, rpm, mag, reserve, speed, spread,
reload, boom?}` — flows through `getItem()` untouched and keys every branch
(HeldItem viewmodel, onAttack, HUD). Zombies-only by acquisition (shop/box
grants), no recipes.

Mechanisms & gotchas:
- **Magazine state** lives in `Game.guns = {name: {mag, reserve}}` — client-
  local (never synced; the network only sees points), persisted in
  `Game.serialize()`. `_shootGun` auto-inits state on first fire, so a gun
  obtained by any means works.
- **Full-auto**: `Interaction.attackHeld` mirrors the raw primary-button state
  (set in `primaryDown` before the one-shot `onAttack`, cleared in
  `primaryUp`); the Game loop polls it with a `60/rpm` cooldown. Touch: holding
  with a gun sets `attackHeld` instead of `breaking` (`Interaction.startMining`).
  The `onAttack` gun/bow branch now early-returns when `vitals.dead` so
  zombies-mode spectators can't shoot (interaction.locked does NOT gate
  onAttack — hide & seek relies on that).
- **Reload**: `_startReload`/`_reloading` ticked in `_loop`; `_syncHeld`'s
  name-change branch cancels it on weapon swap. R is bound in `_bindZombies`
  (safe: the taunt wheel binds R only under hideseek).
- **Ray Gun splash** reuses the exploding-arrow path, refactored into
  `Game._splashImpact(pos, r)` (entity-only boom + `by` attribution +
  broadcast). Tracers are new `bullet`/`ray` entries in `Projectiles.mats` +
  a `scales` map — peers get them via the existing cosmetic `sendProjectile
  {kind}`. **Zero new net messages in this PR.**
- **Shop/Mystery Box**: `SHOP` gained gun entries + `box` (95⭐, weights in
  `BOX_WEIGHTS`, ray_gun 0.15 and box-exclusive) + `gunammo` (refills the HELD
  gun; refuses without one). `buy()` grant logic extracted to
  `_grant`/`_grantGun` — grants must stay client-local (host `handleIntent`
  only decrements points). Rebuy/dupe = full refill.
- **`mystery_box` block** (id 65, `hardness: -1` unbreakable, `luminance: 6`,
  interactive): tiles in atlas.js (`mystery_box_top/_side`), placed in the
  bastion supply corner at (4, FY+1, −10), used via `interaction.onUseBlock`
  → `Game._useMysteryBox()` → `zombiesMode.buy('box')` with refusal toasts.
  arenaTest.js asserts its placement.
- **Recoil**: decaying `Game._recoil` impulse composed into `_animateHeld`'s
  rest-ease branch (kicks `heldAnchor` rotation.x/position.z). Gun viewmodels
  are box-built in `HeldItem.js buildGunModel` (fresh geometry per build —
  Game disposes on swap; materials shared).
- Ammo HUD rides a `gunAmmo` field in the 60 Hz `onStats` snapshot (tiny),
  rendered in App.jsx bottom-right; match HUD stays on `onMatch`.
- **Ops note**: `git push` hung via the Windows credential manager this
  session; pushing with `git -c credential.helper= -c
  "credential.helper=!gh auth git-credential" push …` works (gh CLI is
  authed). Both `-c` flags are required — the empty one clears the hanging
  default helper first.

## 2026-07-10 — #46 Zombies gamemode: co-op wave defense

Fourth world mode `'zombies'` riding the exact hideseek plumbing (whitelists in
`Game` ctor / `server/index.js` / `Menus.jsx` picker; arena registry map;
generic `match`/`matchState` channel — a room has one mode, so sharing is safe;
`Game._matchMode()` picks the active manager). `src/systems/ZombiesMode.js` is
the host/solo-authoritative FSM (`lobby → build → wave → … → gameover`) AND the
wave director: trickle-spawns (live cap 12) from a queue at
`activeMap().zombieGates()` via `MobManager._spawn`, spiders w4+/skeletons
w6+/creepers w8+, per-wave HP mult, kill scoring by sweeping tracked mobs'
`dead` flags. Host migration mid-wave folds back to a build phase (old host's
mobs died with it).

Key mechanisms & gotchas:
- **`mob.lastHitBy`** is the kill-attribution seam — stamped in melee
  (`Game.onAttack`), `Projectiles` mob-hit (`opts.owner`), `Explosions.boom`
  (`ctx.by`), `DamageZones` (`owner`), and `net.onMobHit` (server now tags
  `mobHit.from`; `boom` passes optional `by`). Ids: `'self'` solo, socket id online.
- **`MobManager.autoSpawn = false`** (zombies): kills ambient spawn timers AND
  far-despawn (gate mobs must survive being >70 blocks from a huddled team).
  `mob.detectOverride` (Mob.js one-liner) lets wave mobs aggro arena-wide —
  never mutate the shared `def`.
- **Special ammo**: `Game.AMMO` table + X-cycle (`_cycleAmmo`, bound in
  `_bindScreens`, all modes). Exploding arrows call `boom(r=1.7,
  applyEdits=false)` — entity damage only, defenses never take collateral;
  the host's `onBoom` replay already damages mobs for guest-fired booms
  (`_boomCtx().mobs` is real there), so no new mob-damage netcode was needed.
  Venom arrows spawn `src/systems/DamageZones.js` pools (0.5 s tick, mobs only,
  no players) synced by a one-shot `zone` message — registered in the usual
  THREE places (Net send, Net listener, server relay); the server stamps
  `owner` itself so clients can't spoof credit.
- **Night lock** (`dayNight.t=0.78, frozen`, set on every client; `onTime`
  ignored in zombies) is what keeps `burns:true` zombies alive — no mob changes.
- Shop (`SHOP` in ZombiesMode, `ZombiesShop` in `src/ui/ZombiesUI.jsx`,
  `openScreen === 'shop'`, B key): optimistic buys — buyer grants itself
  immediately, authority decrements points floored at 0 (same trust level as
  edits/booms). Never grant via item drops (not net-synced).
- Death: `Game._zombiesDeath` (no scatter, no `onDead` overlay, free-fly
  spectate, `interaction.locked`); revives are client-local in
  `ZombiesMode._applyLocal` on build/wave-entry transitions (host never touches
  guest vitals). Dead players are filtered out of the mob-targeting `players`
  array in `_loop`.
- Gen-mode token renamed **`'hideseek'` → `'arena'`** in `TerrainGen`
  (playroom/castle/town regression-checked by build + arena tests).
- `src/world/arenas/maps/bastion.js` (`half=48`): bedrock shell + 4 gate
  tunnels (only way in), buildable stone keep, ladders face-adjacent to their
  pillar (mesher rule). **`arenaTest.js` is now committed** (the #42/#44
  harness): `npx esbuild src/world/arenas/arenaTest.js --bundle --format=esm
  --outfile=… && node …` — 62 assertions × 2 seeds.
- server/test.js grew zombies-mode round-trip, `zone`, `mobHit.from`,
  `boom.by` coverage (33 passing).
- Known v1 gaps (by design): zombies don't break player blocks (creepers are
  the anti-turtle), wave state isn't saved (reload → lobby), balance constants
  live at the top of ZombiesMode.js for tuning.

## 2026-07-03 — #44 Prop Hunt arena: The Playroom

`src/world/arenas/maps/playroom.js` — third arena: mouse-scale players in a
giant bedroom (`half=40`, oak_planks base, fully enclosed shell h≈26). Giant
table with hatch-ladder up a leg, walkable bookshelf (boards + seed-varied
"book" runs of prop blocks), bed with exactly-2-high under-bed crawl,
fireplace (sealed lava firebox + mantel), toy corner (3 glow night-lights on
`chunk.lights`), 20×14 wool rug = seeker pen. **Spec deviation (noted in
todos.md): ceiling is plank beams over a ~68%-glass skylight roof** — skylight
is per-column with no horizontal bleed, so a plank-major ceiling would put the
floor at cave darkness (0.15). Seeded toy/prop scatter explicitly avoids all
spawn/waypoint cells. Roofed map ⇒ relies on `lobbySpawn()` (framework
handles it). Verified by the headless arena harness (below): 70 assertions ×
2 seeds; local machine was out of commit memory, so the production build was
verified by GitHub CI.

## 2026-07-03 — #43 What's New changelog page

`src/ui/Changelog.jsx` — player-facing changelog reached via a button on the
landing screen (`Landing.jsx` holds a `showLog` state; no App.jsx changes).
Entries are a plain data array at the top of the file — prepend one
`{ date, title, body }` object per shipped feature.

## 2026-07-03 — #42 Prop Hunt arena: Castle Dracul (+ ladder engine rule)

`src/world/arenas/maps/castle.js` — second arena (`half=44`): crenellated
curtain wall with slab wall-walk + midpoint ladders, four hollow towers with
roof-hatch ladders, gatehouse with fence portcullis + static lava trenches,
keep/great hall, graveyard, and a crypt at y59–61 reached by a mausoleum
ladder shaft (5 glow mushrooms on `chunk.lights`). Parapets/tower-tops/crypt
are human territory — bots can't climb. Seeker spawns use a golden-angle
spiral (the town map's `/4` overlap flaw is still unfixed there).

**Engine rule that outlives the map (user preference, Minecraft parity):
ladders must end LEVEL with the floor they serve — never one block above.**
`Player.js` `climbAt` samples feet (+0.1) as well as mid-body (+0.6); climb
momentum then carries the player ~1.13 blocks past the last ladder block, so
the top-out is the engine's job, not the map's.

**Headless arena-map test harness** (reusable; lived in the session
scratchpad, described in PR #42/#44): esbuild-bundle an entry exporting the
map module + `Chunk` + `reseed` + BlockRegistry helpers (plain Node can't
import the JSON modules), generate all chunks onto the flat arena base in
Node, then assert structure, ladder continuity/level, spawn standability, and
disguise-block coverage across ≥2 seeds.

## 2026-07-03 — #41 Procedural music, cave ambience, jukebox + discs

All music is note data in `src/systems/tracks.js` (compact pattern DSL +
chord/bass/arp generators) synthesized live by `src/systems/Music.js` through
**Tone.js** (new dep, ~70 KB gzip). Seven tracks: sunfields/wanderlight (day),
moonveil (night), hollow/deepglow (cave), sunburst/voyage (disc-only).
Minecraft-style rotation: 40–100 s gaps; context (day/night/cave) computed in
`Game._loop` at ~2 Hz (`surf - p.y >= 8 && p.y < SEA_LEVEL + 2` → cave) with a
3 s stability window; Tone unlocks on first gesture; one Music per Game,
disposed on world exit. Cave ambience one-shots (drip/caveWind/rumble) stayed
in raw-Web-Audio `Sound.js`. Jukebox block id 64 (`interactive`), disc items
carry `disc: "<trackId>"`; `Game.jukeboxes` Map("x,y,z"→item) serialized like
chests (local-only in MP); disc gain falls off 6→28 blocks. Disc recipes:
diamond + themed material. **M key now toggles Sound AND Music together.**

## 2026-07-03 — #40 Flowing liquids + buckets

`src/systems/Liquids.js` — edge-triggered, tick-based flow sim (no block ever
ticks until an edit touches it or a neighbour; still oceans cost nothing).
Woken via `World.onEdit` → `liquids.touch`. Falls first (full-strength
column), else spreads 4-way one level weaker: water 7 blocks / 0.25 s ticks,
lava 3 / 0.75 s. Flow levels are **separate block ids** (water_flow_7..1 =
54–60, lava_flow_3..1 = 61–63, with `liquidType`/`flowLevel`/`liquidHeight`
in blocks.json) so flow state rides the existing edits map — saves, net sync,
and late-join dumps need no new protocol. Only the authority simulates
(`liquids.enabled = !net || net.isHost`); guests clear their queue. Unfed flow
decays one level per tick; water↔lava contact → stone. Mesher: `FLOW` map +
`pushLiquidBox` in the special pass (partial heights; full when fed from
above). New `liquidKind(id)`/`isLiquid(id)` registry helpers — Player swim +
Vitals drown/burn use them. Buckets: items with `bucket: "empty"|"water"|
"lava"`, liquid-aware `raycastVoxel(..., hitLiquid)`, only still sources
scoopable, `onBucket` swaps inventory (creative bottomless). Known limits: no
infinite-water rule; sim queue isn't persisted (frozen mid-flow after reload
until the next nearby edit).

## 2026-07-02/03 — #37/#38/#39 review fixes for PRs #30–#36

#37 five critical bugs; #38 perf (batched explosion net-sync, CaveGen/
TorchLights/mob-snapshot pruning); #39 gameplay (Prop Hunt tag LoS + host
validation, bot collision, camera clamp, disguise validation, roster cleanup;
cave mobs: sky-gated burning, no liquid spawns, flying bats). A polish-tier
backlog from that review is still open — see "Known backlog" below.

## 2026-07-02 — #36 Prop Hunt arena map registry + Little Town

`src/world/arenas/` — map registry (contract: `{ id, name, desc, half,
baseSurface, propBlocks, botSpots, generate(chunk), seekerSpawn(i),
hiderSpawns(n), lobbySpawn() }`), map picked at world creation and synced like
seed/mode. `lib.js`: `FLOOR_Y = 64`, `put`/`fillBox`/`chunkOutside`/
`cellHash`. Maps are pure functions of the seed, stamped per-chunk like
villages. Gotchas: gen-time torches never light (edit-driven `world.torches`)
— gen light = glow mushrooms pushed to `chunk.lights` (pool has only 6 glow
slots); there is **no plain 'cobblestone' block**; `spawnAtSurface()` scans
top-down so roofed maps need `lobbySpawn()`.

## 2026-07-01 — #34/#35 Prop Hunt mode + taunts

Third world `mode: 'hideseek'` riding the existing mode plumbing. Round FSM in
`src/systems/HideSeek.js`, host/solo-authoritative, netcode modeled on chess
(`match`/`matchState`); timers stored as remaining-seconds, host re-broadcasts
at 1 Hz. Disguises via `RemotePlayers.setDisguise`. **Bots are solo-only**
(`HideSeekBots`, constructed only when `!net`). Taunts + style score (#35).
Keyboard-driven round control (pointer-lock blocks UI clicks).

## 2026-06-19..30 — #30–#33

#30 creative mode (mode fixed at world creation; infinite blocks, flight, no
mobs/damage). #31 gen-time cave water/lava pools. #32 cave overhaul: real
darkness (skylight system in the mesher: per-column roof, 6-block fade to
0.15 floor), cave-hostile spawns, glow flora, depth-biased ores, landmark
caverns. #33 Mega TNT + creative palette + a mobile drag fix.

## Earlier (#1–#29, June 2026)

World persistence + multiple worlds (#1), recipe book (#2), torches/chests
(#3), synthesized sound (#4), mobile controls (#5–#8), terrain smoothing
(#9), projectiles/bows (#10), OSS scaffolding + CI (#21), **multiplayer**
(#22: Socket.IO relay rooms, host-authoritative mobs/clock, host migration),
visual overhaul + AO (#23), 3D item models (#24), caves/rifts (#25), villages
(#26/#27), chess tables + bots (#29).

---

## Known backlog (validated, unshipped)

From the 2026-07-02 code audit (see PR #37–#39 review + session notes):

- **Host migration silently disables saving** — `onBecomeHost` never sets
  `_canPersist`; edits after the origin host leaves are lost. High priority.
- `onStats` pushes to React at 60 Hz (whole HUD re-renders every frame; also
  the main aggravator of the mobile drag-and-drop bug). Throttle to ~8 Hz.
- `World.getBlock` allocates a `"cx,cz"` string per voxel query (hot in every
  collision test); mesher has heavy per-quad allocation churn + a spread-push
  `RangeError` risk in `assembleGrouped`; all gen/meshing is main-thread.
- Autosave re-serializes the whole world every 15 s even when nothing changed.
- Mobs ignore fluids entirely (no drowning/lava damage/buoyancy).
- Chest/furnace/jukebox contents are not net-synced; no item-drop sync/chat.
- Town map seeker spawns overlap on 17+ rosters (`/4` flaw; castle/playroom
  use golden-angle spirals).
- Creative polish tier: eating consumes food, instant-break fires every
  frame, palette re-renders on mousemove (details in the #30–#36 review).
- HUD `underwater` flag uses a Y-heuristic instead of `vitals.submerged`.

## Current state (2026-07-03)

Pre-alpha MVP being demoed to a potential client. Three Prop Hunt maps
(town / castle / playroom), flowing liquids, full procedural soundtrack +
music discs, changelog page on the landing screen. Deploys: Vercel builds
previews per PR; CI = `npm run build` + `server/test.js` + `chess/engineTest.js`.
Next map candidates (parked): Harbor Cove, Hedge Garden — specs in todos.md.
