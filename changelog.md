# ApexCraft changelog — developer & agent handoff notes

Purpose: transfer working context between machines and Claude Code instances.
One compact entry per merged PR, newest first: what shipped, the key technical
decisions, file pointers, and gotchas a fresh session needs. **Keep this
updated with every merged PR** (and mirror a short player-facing entry in the
`CHANGELOG` array in `src/ui/Changelog.jsx` — that one feeds the in-game
"What's New" page).

---

## 2026-07-19 — Tycoon mode (Millside)

Fifth game mode: a Roblox-style lumber tycoon on a fixed arena map. New
`src/world/arenas/maps/millside.js` (half=46 — **hard constraint**: every
chunk must stay within `LOAD_RADIUS` (8) of a player anywhere in the map,
because host-simulated workers in unloaded chunks would fall; a bedrock-core
leaf hedge seals the rim). Four quadrant plots by sign-mirroring one master
layout; each has a 2×2 step-on claim pad (`tycoon_claim`, block id 72), a
shop wall with three interactive purchase pads (`tycoon_pad_worker/mill/
house`, ids 69-71, wallbuy pattern: `hardness:-1, interactive`, dispatched
by name prefix in `Game.onUseBlock` → `TycoonMode.usePad`), a grove, a
starter mill, and a straight flat work route (steering is straight-line
only — keep routes clear). `arenaTest.js` covers all of it per plot.

`src/systems/TycoonMode.js` is a ZombiesMode-shaped authoritative manager on
the shared match/matchState channel (`_matchMode()` gained it — that alone
wires intents/state/left/migration). State = 4 plot records `{owner,
ownerName, money, mill, house, workers}`; **claiming is step-on** (authority
sweeps player positions against pad footprints — no net event, no races).
Key decisions: (1) **upgrades are prefab stamps applied as ordinary world
edits** (`millStamp`/`houseStamp` exported by the map; applied in a
`beginEditBatch` — synced to guests and persisted via `World.edits` with
zero extra code; every tier air-clears its volume first so cumulative
replay leaves the newest tier); (2) **persistence keys plots by player
NAME** (`serialize().tycoon`; pids are session-scoped; rejoin/reload rebind
by name — pets precedent; solo load falls back to first claimed plot);
(3) **workers are never saved as mobs** — the per-plot count is the truth
and an authority census respawns deficits (waits for the mill chunk via
`isSolid`), which self-heals load, host migration, and void falls;
(4) owner offline ⇒ plot paused (workers idle, no accrual, plot reserved).

Worker mob: `category:'worker'` (no spawn pool), `noHit:true` (**both**
raycasts — MobManager + GhostMobs — skip it, clicks pass through), FSM in
`Mob._workerAI` (toSource → chopping 2s → toMill → delivering 1.5s →
`workData.onDeliver()` credits the plot; 30s stuck-teleport failsafe), carry
log = group-child mesh mirrored to guests via new snapshot field `c` (mesh
owns its material — dispose paths in MobManager removal + GhostMobs).

Mode wiring gotcha: hide & seek's `Interaction.locked` kills the whole
right-click, so tycoon uses a new narrower `Interaction.noEdit` (blocks
mining + the place/bucket/spawn/eat tail; door/interactive USE still works).
God mode, empty kit, day-locked (`t=0.30, frozen`, `net.onTime` ignored),
`autoSpawn` off. Server change: one line ('tycoon' in the mode whitelist).
Economy constants at the top of TycoonMode.js (worker cycle ~21s; costs
$25→$1200 workers, $50/$300/$1500 mill, $100/$600/$2500 house). Dev: KeyP
grants $500 on localhost. HUD `src/ui/TycoonUI.jsx` is display-only (money
card + floater, tier line, next-cost hints) — all purchases are in-world.

## 2026-07-17 — Creative mob spawner items

One `spawn_<type>` item per `MOBS` entry (14, incl. wolf/cat pets and the
`black_cat` variant — a full tamable mob type, per-user dedication to Claudia
Claude) in `src/items/items.json` with a `spawnMob` data field; `drawSpawnEgg`
in `icons.js` (speckled egg tinted with the mob's body colour). Cats' creeper
aura is now the data flag `scaresCreepers` (both cat types), and pet toast
labels go through `petLabel()` in Game.js ('black_cat' → 'Black Cat'). They appear at
the end of the creative palette automatically (non-placeable items section).
Right-click flow: new `Interaction.onSpawnMob` branch in `_rightClick`
(between bucket and block placement) passes `target.place` — the same free
cell block placement fills; `Game` handler is **creative-gated** and either
spawns via new `MobManager.spawnAt` (host/SP) or sends the new `spawnMob`
relay (guest → host, host re-checks creative). **Creative now ticks the mob
simulation**: new `MobManager.autoSpawn` flag (false in creative) gates the
three ambient spawn timers *and* distance-despawn, so only spawner-item mobs
exist and they don't vanish behind you (void kill at y<-10 still applies).
Snapshot streaming in creative only while mobs exist (`_mobsWereLive` sends
one trailing empty snapshot to clear guests' ghosts). Pets now also
load/persist in creative worlds, and tame/feed skip item consumption in
creative (matching bucket/placement conventions). Spawned mobs (other than
tamed pets) still aren't saved — a creative zoo lasts the session only.
Creative players are already immune to spawned hostiles via `vitals.godMode`.

## 2026-07-17 — Pets: tamable wolves & cats

Two new `category: 'passive'` mobs in `src/entities/mobTypes.js` with data
fields the engine reads: `tamable`, `tameItem` (wolf: `bone`, cat: new
`raw_fish` item — 20% chance when bucket-scooping a water source), `petFoods`.
Right-click flow: new `Interaction.onUseMob` hook fires before block targeting
(pet reach 3.5 < block reach 6); `Game._petInteract` is the authoritative
handler (tame roll 1/3, feed heals `food×2`, else sit/stay toggle).
`Mob._petAI` (branch between flee and hostile-chase) does sit / combat-assist /
follow with hysteresis (start 4, stop 2.5, run >10, teleport >20 via a
floor-scan ring). **Pid convention: pet `owner` is `'self'` for host/SP,
guest socket id otherwise** — matches the MobManager players list
(`{id:'self'}`, Game.js loop). Wolf assist picks mobs (never players/pets)
that within 8 s hurt the owner (`_hurtPid`, stamped in the manager's
attackPlayer wrapper) or were hit by them (`lastHitBy`/`lastHitAt`, stamped in
Game melee, Projectiles arrow hits, and `onMobHit` — the server's `mobHit`
relay now stamps `from`). Tamed pets skip wild caps/despawn (`MobManager`),
never flee, never hit players. Persistence: `serialize().pets` (only mobs that
persist), loaded post-pregen host/SP only; guest pets load orphaned+sitting and
**rebind by player name** on join (spoofable; accepted). MP: snapshot gains
`o/s/n` fields for owned/orphaned mobs; `GhostMobs` mirrors owner/sitting/tag
(`nameTag` now exported from `RemotePlayers.js` with `{y, scale}` opts); guest
intents go over a new `petAction` relay (`Net.sendPetAction`, host validates
against real mob state — guest inventory is client-trusted like `mobHit`).
Gotchas: pets are lost on host migration (mobs don't transfer; origin's
autosave keeps them); skeleton *arrows* don't set revenge marks (melee only);
cats scare creepers within 8 blocks (defuse + rout).

Merge note (pets × zombies): melee/arrow/guest-hit attribution now shares the
zombies kill-attribution stamps (`_selfPid()` / projectile `owner` / mobHit
`from`) with an added `lastHitAt` timestamp; since `_selfPid()` is the socket
id online while pet `owner` is `'self'` for the host, the wolf-assist matcher
canonicalises via `ctx.selfPid`. The sitting pose *replaces* `animateMob` for
the frame (the gait would relax the fold); `MobManager.autoSpawn` (added for
zombies waves) also gates pet-exempt despawn.

## 2026-07-15 — Charger + Tank specials, shared gait/animation system

Two more L4D-style specials plus a body-animation pass for all zombie-type
mobs, mirrored on multiplayer ghosts. Zero new net messages.

- **Shared animation** (`MobModels.js animateMob(m, dt, moving)`): called by
  both `Mob.update` and `GhostMobs.update` AFTER the group is synced to the
  mob position (bob/sway are ADDED on top). Driven by a new `gait` field on
  mob defs (`shamble` | `run` | `heavy` | `raised`) and `arm: true` parts,
  which get shoulder pivots exactly like legs (`userData.arms`). Gaits set
  arm poses (zombie reach, run pump, heavy swing, banshee overhead), walk
  bob, torso sway (`group.rotation.z` — safe: the death tip-over only touches
  it on dead mobs, and animateMob never runs on them), forward lean
  (`rotation.x`), and a head twitch for shamblers (head `rotation.z` only;
  the look-at logic owns x/y). `m.attackTimer > 0` = overhead arm slam —
  Mob's lunge block now decrements attackTimer even with `_lungeDir == null`
  (tank rock throws set it for the heave alone; without that fix the arms
  stick raised forever). Mobs without a gait (passives, villagers, bats,
  skeleton) keep the plain leg swing.
- **Charger** (`charges: true`, w7+ at 10% weight): per-instance FSM `_ch`
  (stalk → windup 0.7 s with `Sound.angry()` + tremble → charge 1.3 s at
  `speed*3.4` along a LOCKED direction → stun). Wall contact during a charge
  is intercepted in Mob's wall-handling block BEFORE the auto-hop (1.4 s
  daze). A hit = full damage + **power-16 knockback**; point-blank in stalk
  it swipes at half damage so it's never helpless.
- **Knockback power plumbing, no net changes**: `ctx.attackPlayer(dmg,
  fromPos, power)` → MobManager → Game `attackPlayer(dmg, id, kdir, power)`.
  Local: `player.knockback(x, z, power || 7)`. Remote: power is encoded as
  the **kdir vector magnitude** (ordinary melee sends raw position diffs,
  length < 2), decoded in `onHitPlayer` as `max(7, hypot(kx, kz))`.
- **Tank** (`throwsRocks` + `breaksBlocks`, guaranteed on every 10th wave,
  REPLACING that wave's brute): 250 hp base (specials get half wave HP
  inflation → ~420 at w10), speed 1.9, attack 10, hw 0.7 (fits the gates,
  smashes what doesn't). At range 7–26 it hurls a `rock` projectile every
  4 s at 0.6× attack (new `Projectiles.mats/scales` entry, speed 15 in
  Game's shoot ctx, arcs under the standard projectile gravity; guests get
  it via the existing sendProjectile kind pass-through). KILL_POINTS:
  charger 40, tank 250.
- GOTCHA: `def` is shared — all charger/tank state (`_ch`, `_rockCd`) is
  per-instance, same rule as speedMul/attackMul.

## 2026-07-12 — Zombies fun pass: L4D specials, wave scaling, tighter Bastion

Feedback-driven ("not fun enough"): variety, pressure, and pace. Same
host-authoritative model — all new AI/scaling runs only on the authority;
guests mirror via the existing mob snapshots (`GhostMobs` builds any type
from `MOBS[s.t]`, zero netcode changes for new mob types).

- **Per-instance mob multipliers** (`Mob.js`): speed is now
  `def.speed * (speedMul||1) * (auraSpeedMul||1)`; melee + ranged damage
  `def.attack * (attackMul||1)`. Set by `ZombiesMode._directWave` at spawn —
  **never mutate `def`** (shared objects). Wave formulas in `ZombiesMode.js`:
  `speedMulWave` 1.5x@w1 → 1.0x@w6 (regular mobs only, specials exempt),
  `dmgMulWave` 1+0.1/wave capped 2.5x, specials get half the `healthMul`
  inflation.
- **Four arena-only specials** (`mobTypes.js`, flag `arenaOnly: true` filters
  them out of the survival `HOSTILE` pool — category stays 'hostile' because
  aggro/no-flee key off it): `sprinter` (3.2 speed, 12 hp, w2+),
  `brute` (80 hp, attack 8, `breaksBlocks`, guaranteed on every 5th wave),
  `spitter` (`ranged` + `projectile:'acid'`, w5+), `screamer`
  (`keepsDistance` — new mid-range AI branch in Mob.js; 1@w6, 2@w10+).
- **Brute block-breaking** (Mob.js wall-handling block): while wall-blocked
  and chasing, breaks ONE block in front of its face every 1.5 s via
  `world.setBlock(...,0)` — particles + `net.sendEdit` free via `World.onEdit`.
  Skips `getBlock(id).hardness < 0` (bedrock shell, wall-buys, mystery box —
  same unbreakable rule as Interaction).
- **Screamer aura**: recomputed every frame in `_directWave`'s tracked sweep —
  live non-screamer wave mobs within 12 blocks of a live screamer get
  `auraSpeedMul = 1.5`, else 1. Dies with the screamer by construction.
- **Spitter acid**: mob `shoot` ctx (Game.js) takes a trailing `kind`; acid
  flies at 14 (visible arc) with `onHit → Game._acidSplash` — a
  `DamageZones.spawn(..., hurtPlayer=true)` pool (r2, 3 dps, 4 s) + a `zone`
  net message with `hp:1`. **DamageZones extension**: `hurtPlayer` pools tick
  the LOCAL player on every client (`update(dt, mobs, playerCtx)`) — same
  trust model as guest-simulated arrows; mob damage stays authority-only.
  GOTCHA: mob→player projectiles never fire `onHit` on a direct player hit
  (Projectiles.js) — pools only appear on ground impact, by design.
- **KILL_POINTS**: sprinter 15, spitter 25, screamer 30, brute 100. Wave
  composition is now a weight table in `pickType`; guaranteed brutes/screamers
  are spliced into the front half of the LIFO spawn queue (arrive mid/late wave).
- **Bastion tightened** (`bastion.js`): `half` 48→36, shell `WALL_IN/OUT`
  46/48→32/34 (gates now 30 from keep center), `MID_R` 28→22, **outer ruin
  ring deleted** (no room in the 10-block annulus). Everything else
  (wall-buys, gates, roof, box) is constant-derived and moved automatically.
  `arenaTest.js` literals swept to match + outer-wall section removed; both
  seeds pass.
- **Dev QoL**: N (localhost) skips the current Zombies phase
  (`ZombiesMode.devSkip`: build→wave, wave→cleared); Mystery Box rolls
  exclude guns you own (falls back to full pool = refill when you own all).
- **PR 2 planned, not shipped**: revive mechanics (L4D downed state) +
  leaderboard mockup (highest wave/kills/points, local until Supabase auth).

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
- **Wall-buys (CoD style), not menu buys**: guns live on physical
  `wallbuy_m14/ak74u/galil` blocks (ids 66–68, unbreakable, interactive,
  chalk-outline tiles via `wallbuyBase`/`chalkGun` in atlas.js), stamped by
  `bastion.js emitWallBuys` — M14 on the keep's north wall (starter), AK-74u
  on the south wall, Galil out on the curtain wall by the east gate
  (risk-priced). Right-click → `Game` onUseBlock → `ZombiesMode.buyWall(gun)`:
  first purchase = the gun; owned = its ammo at ~half price (`ammoFor`
  entries: 30/75/125). SHOP entries carry `wall: true` — hidden from the B
  menu (`SHOP.filter(!s.wall)` in ZombiesUI) and **purchasable mid-wave**
  (menu entries stay build-only). GOTCHA: the phase rule lives in BOTH
  `buy()` and the host's `handleIntent` buy branch — they must stay
  identical or guest wall-buys silently stop decrementing points.
- **Mystery Box**: `box` entry (95⭐, weights in `BOX_WEIGHTS`, ray_gun 0.15
  and box-exclusive), usable mid-wave too. `buy()` grant logic extracted to
  `_grant`/`_grantGun` — grants must stay client-local (host `handleIntent`
  only decrements points). Rebuy/dupe = full refill. Ray Gun ammo = respin.
- **Concentric curtain walls** (`bastion.js emitRuinRing`, shared by both
  rings): ruined stone rings at `MID_R=28` (5-wide gates, 1–2 breaches/side,
  corner watchtowers with keep-facing ladders — the #42 ladders-end-LEVEL
  rule) and `OUTER_R=38` (3-wide gates, 2–3 wider breaches/side, sagP 0.3, no
  towers — the derelict first line). The square is now keep → inner court →
  middle court → outer field. Breach spans (layout() `breaches`/
  `outerBreaches`) crumble to 1-high rubble — **deliberately hop-able so the
  direct-steering mob AI keeps flowing** (mobs also wall-slide via per-axis
  collision, so gapped rings work without pathfinding); intact spans carry a
  slab parapet. Ordinary masonry — players repair it, creepers breach it.
  Scatter avoids both ring lines. arenaTest asserts gates/towers/ladders
  exactly and intact-vs-rubble ratios statistically per ring.
- **Roof + full enclosure**: the bedrock shell now rises to `ROOF_LEVEL =
  FY+16` and `emitRoof` spans the interior with plank beams on an 8-grid over
  a **glass-majority skylight — the Playroom rule: glass keeps per-column
  skylight alive; a solid roof would drop the whole arena to cave darkness**
  (skylight has no horizontal bleed). The shell caps its own 3-wide top ring
  (`WALL_TOP = ROOF_LEVEL`) so there's no sky slot around the roof rim. Note:
  the roofed arena makes `surfaceHeight`-based cave detection kick in — cave
  ambience/music inside the fortress is accepted as thematic.
- **Castle interior, not outdoors**: `groundPass` paves the ENTIRE interior
  (r < WALL_IN) in patchwork flagstone (stone/mossy/andesite by cellHash;
  gravel lanes kept, now full crosses). Both curtain rings carry a **slab
  gallery roof** (`GALLERY_Y = FY+7`, 3-wide band r±1 in `emitRuinRing`),
  torn open over every breach span (side/off recomputed per band cell —
  corners resolve by the larger axis). Parapet walkers clear the gallery
  (slab stand 4.5 + 1.8 < 7); gates and mid towers are covered. arenaTest
  asserts flagstone samples, lane gravel, covered gates, and that gallery
  holes exactly match rubble columns.
- **Enclosed keep**: `KEEP_WALL_TOP` raised FY+2 → FY+6 with pane arrow-slit
  windows (every 4th column at FY+4, visual only — panes are solid), arched
  2-high entries (wall continues above the doorway), and its own roof at
  `KEEP_ROOF = FY+7`: plank beams on a 4-grid over glass, masonry rim over
  the wall ring, slab eaves overhanging at r=KEEP_R+1. Merlons/top torches
  removed (roofed). Archer platforms keep exactly enough headroom (deck
  FY+4, stand FY+5, head < roof at FY+7 — asserted in arenaTest). Side
  effect: spiders can no longer climb INTO the keep — creepers remain the
  anti-turtle counter for a sealed keep.
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
