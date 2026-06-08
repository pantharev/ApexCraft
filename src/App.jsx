import React, { useEffect, useRef, useState } from 'react';
import { Game } from './core/Game.js';
import { reseed } from './world/noise.js';
import { listWorlds, loadWorld, deleteWorld } from './systems/Storage.js';
import { MainMenu, PauseMenu } from './ui/Menus.jsx';
import { Landing } from './ui/Landing.jsx';
import { Hotbar, InventoryPanel, CraftingTableScreen, FurnaceScreen, ChestScreen } from './ui/InventoryUI.jsx';
import { TouchControls } from './ui/TouchControls.jsx';

const IS_TOUCH = typeof window !== 'undefined' &&
  (window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : 'ontouchstart' in window);

export default function App() {
  const containerRef = useRef(null);
  const gameRef = useRef(null);

  const [phase, setPhase] = useState('landing'); // 'landing' | 'menu' | 'playing'
  const [worlds, setWorlds] = useState([]);
  const [current, setCurrent] = useState(null); // { id, name, seed, save }

  const [stats, setStats] = useState(null);
  const [locked, setLocked] = useState(false);
  const [openScreen, setOpenScreen] = useState(null);
  const [dead, setDead] = useState(false);
  const [saved, setSaved] = useState(false);
  const [hurt, setHurt] = useState(false);
  const [touchActive, setTouchActive] = useState(false); // mobile "playing" (no pointer lock)
  const [portrait, setPortrait] = useState(false);

  const refreshWorlds = async () => setWorlds(await listWorlds());
  useEffect(() => { refreshWorlds(); }, []);

  // Track portrait orientation on touch devices (prompt to rotate while playing).
  useEffect(() => {
    if (!IS_TOUCH) return;
    const check = () => setPortrait(window.innerHeight > window.innerWidth);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Build/tear down the Game when a world is entered/left.
  useEffect(() => {
    if (phase !== 'playing' || !current) return;
    let savedTimer = null;
    let hurtTimer = null;
    reseed(current.seed);
    const save = { ...(current.save || {}), id: current.id, name: current.name, seed: current.seed };
    const game = new Game(containerRef.current, save);
    gameRef.current = game;
    window.__apex = game;
    game.onStats = setStats;
    game.onScreenChange = setOpenScreen;
    game.onDead = setDead;
    game.onSaved = () => { setSaved(true); clearTimeout(savedTimer); savedTimer = setTimeout(() => setSaved(false), 1500); };
    game.onPlayerHurt = () => { setHurt(true); clearTimeout(hurtTimer); hurtTimer = setTimeout(() => setHurt(false), 250); };
    game.start();

    const onLock = () => setLocked(document.pointerLockElement === game.renderer.domElement);
    document.addEventListener('pointerlockchange', onLock);

    return () => {
      clearTimeout(savedTimer);
      clearTimeout(hurtTimer);
      document.removeEventListener('pointerlockchange', onLock);
      game.dispose();
      gameRef.current = null;
    };
  }, [phase, current]);

  const requestLock = () => {
    const el = gameRef.current?.renderer.domElement;
    if (!el || !el.requestPointerLock) return;
    try {
      const r = el.requestPointerLock();
      if (r && r.catch) r.catch((err) => console.warn('Pointer lock failed:', err.message || err));
    } catch (err) { console.warn('Pointer lock failed:', err); }
  };

  const playExisting = async (meta) => {
    const save = await loadWorld(meta.id);
    setStats(null); setLocked(false); setOpenScreen(null); setDead(false); setTouchActive(false);
    setCurrent({ id: meta.id, name: meta.name, seed: meta.seed, save });
    setPhase('playing');
  };

  const createNew = (name) => {
    const seed = Math.floor(Math.random() * 1e9);
    const id = `w_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    setStats(null); setLocked(false); setOpenScreen(null); setDead(false); setTouchActive(false);
    setCurrent({ id, name, seed, save: null });
    setPhase('playing');
  };

  const removeWorld = async (meta) => {
    await deleteWorld(meta.id);
    refreshWorlds();
  };

  const quitToMenu = async () => {
    await gameRef.current?.save();
    setTouchActive(false);
    setPhase('menu');
    setCurrent(null);
    await refreshWorlds();
  };

  const resume = () => {
    if (IS_TOUCH) { setTouchActive(true); gameRef.current?.setTouchActive(true); }
    else requestLock();
  };

  // "Active" = actually playing (mouse captured on desktop, or tapped-in on touch).
  const active = phase === 'playing' && !openScreen && !dead && (IS_TOUCH ? touchActive : locked);
  const paused = phase === 'playing' && !openScreen && !dead && !(IS_TOUCH ? touchActive : locked);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {phase === 'landing' && <Landing onPlay={() => setPhase('menu')} />}

      {phase === 'menu' && (
        <MainMenu worlds={worlds} onPlay={playExisting} onCreate={createNew} onDelete={removeWorld}
          onHome={() => setPhase('landing')} />
      )}

      {phase === 'playing' && (
        <>
          {/* Damage flash */}
          {hurt && (
            <div style={{
              position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 18,
              boxShadow: 'inset 0 0 120px 30px rgba(200,0,0,0.55)',
            }} />
          )}

          {/* Crosshair */}
          {active && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', width: 18, height: 18, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', top: 8, left: 0, width: 18, height: 2, background: 'rgba(255,255,255,0.8)' }} />
              <div style={{ position: 'absolute', left: 8, top: 0, width: 2, height: 18, background: 'rgba(255,255,255,0.8)' }} />
            </div>
          )}

          {/* Flying indicator */}
          {active && stats?.flying && (
            <div style={{
              position: 'absolute', top: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 8,
              pointerEvents: 'none', color: '#cfe6ff', background: 'rgba(30,60,110,0.55)',
              padding: '3px 12px', borderRadius: 12, font: 'bold 12px system-ui', letterSpacing: 1,
              textShadow: '1px 1px 1px #000', border: '1px solid rgba(150,190,255,0.5)',
            }}>FLYING</div>
          )}

          {gameRef.current?.inventory && active && (
            <Hotbar inventory={gameRef.current.inventory}
              onSelect={IS_TOUCH ? (i) => gameRef.current.inventory.setSelected(i) : undefined} />
          )}
          {stats && active && (
            <StatusBars health={stats.health} hunger={stats.hunger} air={stats.air} submerged={stats.submerged} />
          )}

          {/* Touch controls */}
          {IS_TOUCH && active && gameRef.current && (
            <TouchControls
              game={gameRef.current}
              onInventory={() => gameRef.current.setScreen('inventory')}
              onPause={() => { setTouchActive(false); gameRef.current.setTouchActive(false); }}
            />
          )}

          {/* Close button for any open screen (works on touch + desktop) */}
          {openScreen && (
            <button onClick={() => gameRef.current?.setScreen(null)} style={{
              position: 'absolute', top: 16, right: 16, zIndex: 40, cursor: 'pointer',
              font: 'bold 14px system-ui', padding: '8px 14px', background: '#444', color: '#fff',
              border: '2px solid #222', borderRadius: 4,
            }}>✕ Close</button>
          )}

          {gameRef.current?.inventory && openScreen === 'inventory' && <InventoryPanel inventory={gameRef.current.inventory} />}
          {gameRef.current?.inventory && openScreen === 'crafting' && <CraftingTableScreen inventory={gameRef.current.inventory} />}
          {gameRef.current?.inventory && openScreen === 'furnace' && (
            <FurnaceScreen inventory={gameRef.current.inventory} furnace={gameRef.current.activeFurnace} />
          )}
          {gameRef.current?.inventory && openScreen === 'chest' && (
            <ChestScreen inventory={gameRef.current.inventory} chest={gameRef.current.activeChest} />
          )}

          {saved && (
            <div style={{ position: 'absolute', bottom: 8, right: 10, color: '#cfe9c0', font: '12px monospace', textShadow: '1px 1px 2px #000', pointerEvents: 'none' }}>Saved</div>
          )}

          {stats && (
            <div style={{ position: 'absolute', top: 8, left: 8, color: '#fff', font: '13px monospace', textShadow: '1px 1px 2px #000', pointerEvents: 'none', lineHeight: 1.5 }}>
              <div>{current?.name}</div>
              <div>XYZ: {stats.x} / {stats.y} / {stats.z}</div>
              <div>Time: {stats.clock} ({stats.night ? 'Night' : 'Day'}) &nbsp; Mobs: {stats.mobs}</div>
              <div>Holding: {stats.held}</div>
              {stats.dev && <div style={{ color: '#9fe084' }}>[T] day/night: {stats.devTime}</div>}
            </div>
          )}

          {dead && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', background: 'rgba(60,0,0,0.55)', zIndex: 20 }}>
              <h1 style={{ fontSize: 44, marginBottom: 20, letterSpacing: 1 }}>You died!</h1>
              <button onClick={() => gameRef.current?.respawn()} style={{ font: '18px system-ui', padding: '10px 26px', cursor: 'pointer', background: '#6b6b6b', color: '#fff', border: '2px solid #2b2b2b', borderRadius: 4 }}>Respawn</button>
              <p style={{ marginTop: 16, opacity: 0.8 }}>Your items were dropped where you fell.</p>
            </div>
          )}

          {paused && (
            <PauseMenu
              worldName={current?.name}
              justSaved={saved}
              onResume={resume}
              onSave={() => gameRef.current?.save()}
              onQuit={quitToMenu}
            />
          )}
        </>
      )}

      {/* Rotate-to-landscape prompt (touch, portrait, in game) */}
      {IS_TOUCH && portrait && phase === 'playing' && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 100, background: '#0a1430',
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          color: '#eaf2ff', textAlign: 'center', padding: 24, font: '16px system-ui',
        }}>
          <div style={{ width: 76, height: 46, border: '3px solid #cfe6ff', borderRadius: 9, marginBottom: 18, position: 'relative' }}>
            <div style={{ position: 'absolute', right: 5, top: '50%', width: 4, height: 4, marginTop: -2, borderRadius: '50%', background: '#cfe6ff' }} />
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Rotate your device</div>
          <div style={{ opacity: 0.8 }}>Turn your phone sideways (landscape) for the best view.</div>
        </div>
      )}
    </div>
  );
}

// Hearts (health), hunger, and air-bubble bars above the hotbar.
function StatusBars({ health, hunger, air, submerged }) {
  const halfRow = (value, fullColor, halfColor, char) =>
    Array.from({ length: 10 }).map((_, i) => {
      const v = value / 2 - i;
      const color = v >= 1 ? fullColor : v >= 0.5 ? halfColor : '#333';
      return <span key={i} style={{ color, fontSize: 18, textShadow: '1px 1px 1px #000' }}>{char}</span>;
    });

  return (
    <div style={{ position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)', width: 470, display: 'flex', justifyContent: 'space-between', pointerEvents: 'none' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {submerged && air < 10 && (
          <div style={{ display: 'flex', gap: 2 }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <span key={i} style={{ color: i < Math.ceil(air) ? '#7ec8ff' : 'transparent', fontSize: 16, textShadow: '1px 1px 1px #000' }}>●</span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 2 }}>{halfRow(health, '#e2403a', '#b85a30', '♥')}</div>
      </div>
      <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end' }}>{halfRow(hunger, '#c8a24a', '#7d6630', '●')}</div>
    </div>
  );
}
