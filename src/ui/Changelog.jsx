import React from 'react';

// "What's New" page reachable from the landing screen: a short, player-facing
// paragraph per merged PR, newest first. Append new entries at the top when a
// feature ships — keep each summary to a couple of sentences.

const CHANGELOG = [
  {
    date: 'July 17, 2026',
    title: 'Pets: tame wolves and cats!',
    body: 'Wolves and cats now roam the wild. Win a wolf over with skeleton bones and it will follow you anywhere — teleporting to catch up — and leap to your defense against anything that hurts you (or anything you pick a fight with). Cats are tamed with raw fish, sometimes caught while scooping water with a bucket, and creepers are terrified of them. Right-click your pet to have it sit and guard the base, feed it meat or fish to heal it, and it will still be waiting for you when you reload the world — pets work in multiplayer too.',
  },
  {
    date: 'July 3, 2026',
    title: 'New Prop Hunt arena: The Playroom',
    body: 'Shrink down to mouse size in a giant child’s bedroom: hide under a colossal table (or climb its leg to the fruit bowl and chess set on top), crawl beneath the bed, walk the bookshelf shelves among giant books, or lurk in the toy castle by the glow-mushroom night lights. A beamed glass skylight roof pours daylight in stripes across the floorboards, and the fireplace crackles with real lava behind its guard rail. Seekers start penned on the rug.',
  },
  {
    date: 'July 3, 2026',
    title: 'New Prop Hunt arena: Castle Dracul',
    body: 'A brooding fortress joins Little Town in the map picker — crenellated walls you can patrol from above, four climbable towers, a torch-lit gatehouse with molten lava trenches, a throne-room keep, and a graveyard whose mausoleum hides a ladder down into a glow-lit crypt. The high ground and the crypt are safe from seeker bots, which can’t climb. Ladders everywhere now top out onto floors properly, just like Minecraft.',
  },
  {
    date: 'July 3, 2026',
    title: 'Music, cave ambience & collectible discs',
    body: 'ApexCraft has a soundtrack now: seven original synth tracks that play occasionally as you explore — brighter songs by day, hushed ones at night, and dark ambient pieces deep underground, joined by cave drips, drafts, and distant rumbles. Every track can be collected as a craftable music disc (diamond + a themed material) and played on a new jukebox block, with the sound fading as you walk away. Press M to mute music and sound together.',
  },
  {
    date: 'July 3, 2026',
    title: 'Water and lava finally flow',
    body: 'Liquids behave like liquids: break a wall next to a lake and the water pours through, falls down cliffs and cave shafts, and fans out — getting visibly shallower the further it travels (7 blocks for water, 3 for slow-oozing lava). Remove the source and the stream drains away. Water touching lava hardens to stone. New buckets (3 iron ingots) let you scoop and pour water or lava wherever you like.',
  },
  {
    date: 'July 3, 2026',
    title: 'Prop Hunt fairness & cave mob behaviour',
    body: 'A round of gameplay fixes from review: seekers can no longer tag hiders through walls, bots collide with the world honestly, disguises are validated by the host, and departed players are cleaned out of the round roster. Underground, mobs stopped burning in cave darkness at noon, no longer spawn inside lakes or lava, and cave bats actually fly.',
  },
  {
    date: 'July 2, 2026',
    title: 'Performance pass',
    body: 'Big explosions now apply their crater as one batched update instead of thousands of tiny ones, and several hot paths in world generation and the torch-light system were trimmed. Mega TNT chains and busy cave scenes hitch noticeably less.',
  },
  {
    date: 'July 2, 2026',
    title: 'Five critical fixes from code review',
    body: 'A dedicated review of the previous two weeks of features caught and fixed five crash- or progress-threatening bugs before they could ruin a save — including issues in world persistence and mode handling.',
  },
  {
    date: 'July 2, 2026',
    title: 'Prop Hunt arena maps: Little Town',
    body: 'Prop Hunt moved from a generated box arena to hand-built maps, chosen when you create the world. The first is Little Town: streets, plank houses, a market row, farms, a barn, and a smithy — with every disguise block seeded naturally around town so a frozen hider truly blends in.',
  },
  {
    date: 'July 1, 2026',
    title: 'Prop Hunt taunts & style score',
    body: 'Hiders can now taunt — a risky flourish that shows everyone roughly where you are and banks style points if you survive it. A style score rewards daring play beyond simply outlasting the clock.',
  },
  {
    date: 'July 1, 2026',
    title: 'New game mode: Prop Hunt (hide & seek)',
    body: 'A third world mode alongside survival and creative. Hiders disguise themselves as blocks and freeze in plain sight; seekers hunt them down and tag them — but a wrong guess stuns the seeker. Play solo against bot seekers or with up to 8 friends in a multiplayer room.',
  },
  {
    date: 'June 30, 2026',
    title: 'Mega TNT & creative palette',
    body: 'A new Mega TNT block carves a truly enormous crater (stand well back). Creative mode gained a scrollable palette of every block in the game, and drag-and-drop item swapping got fixed on mobile.',
  },
  {
    date: 'June 22, 2026',
    title: 'The cave overhaul',
    body: 'Caves became a real place: genuine darkness below the surface (bring torches), hostile cave mobs that spawn in the deep, bioluminescent glow mushrooms lighting the way, richer ore veins the deeper you dig, and rare landmark caverns worth hunting for.',
  },
  {
    date: 'June 22, 2026',
    title: 'Underground lakes & lava pools',
    body: 'Cave systems now flood naturally — still water pools in mid-depth caverns and glowing lava lakes near the bottom of the world, changing how you route a deep mining trip.',
  },
  {
    date: 'June 19, 2026',
    title: 'Creative mode',
    body: 'A second way to play, chosen at world creation: infinite blocks, instant breaking, flight (press F), no damage, and no mobs — a pure building sandbox alongside survival.',
  },
];

export function Changelog({ onClose }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, overflowY: 'auto', zIndex: 6,
      background: 'linear-gradient(180deg, #0a1430 0%, #16386b 60%, #1d4a85 100%)',
      color: '#eaf2ff', font: '16px system-ui',
      display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 20px',
    }}>
      <div style={{ width: '100%', maxWidth: 720 }}>
        <button
          onClick={onClose}
          style={{
            font: 'bold 15px system-ui', padding: '8px 18px', cursor: 'pointer', color: '#eaf2ff',
            background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.3)',
            borderRadius: 8, marginBottom: 24,
          }}
        >← Back</button>

        <h1 style={{ fontSize: 40, letterSpacing: 2, margin: '0 0 6px', textShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
          What&apos;s New
        </h1>
        <p style={{ opacity: 0.75, marginTop: 0, marginBottom: 28 }}>
          Everything that shipped to ApexCraft recently — newest first.
        </p>

        {CHANGELOG.map((e) => (
          <div key={e.title} style={{
            background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.14)',
            borderRadius: 10, padding: '16px 18px', marginBottom: 14, textAlign: 'left',
          }}>
            <div style={{ fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', color: '#9fc4ff', opacity: 0.9 }}>
              {e.date}
            </div>
            <div style={{ fontWeight: 700, fontSize: 18, color: '#9fe084', margin: '4px 0 8px' }}>
              {e.title}
            </div>
            <div style={{ fontSize: 14.5, lineHeight: 1.55, opacity: 0.9 }}>{e.body}</div>
          </div>
        ))}

        <div style={{ textAlign: 'center', fontSize: 13, opacity: 0.6, margin: '26px 0 10px' }}>
          Pre-alpha — expect rough edges. Full history on{' '}
          <a href="https://github.com/pantharev/ApexCraft/pulls?q=is%3Apr+is%3Amerged" target="_blank" rel="noreferrer"
            style={{ color: '#bcd6ff' }}>GitHub</a>.
        </div>
      </div>
    </div>
  );
}
