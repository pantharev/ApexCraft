import React, { useEffect, useRef, useState } from 'react';
import { Game } from './core/Game.js';
import { reseed } from './world/noise.js';
import { listWorlds, loadWorld, deleteWorld } from './systems/Storage.js';
import { MainMenu, PauseMenu } from './ui/Menus.jsx';
import { Hotbar, InventoryPanel, CraftingTableScreen, FurnaceScreen } from './ui/InventoryUI.jsx';

export default function App() {
  const containerRef = useRef(null);
  const gameRef = useRef(null);

  const [phase, setPhase] = useState('menu'); // 'menu' | 'playing'
  const [worlds, setWorlds] = useState([]);
  const [current, setCurrent] = useState(null); // { id, name, seed, save }

  const [stats, setStats] = useState(null);
  const [locked, setLocked] = useState(false);
  const [openScreen, setOpenScreen] = useState(null);
  const [dead, setDead] = useState(false);
  const [saved, setSaved] = useState(false);

  const refreshWorlds = async () => setWorlds(await listWorlds());
  useEffect(() => { refreshWorlds(); }, []);

  // Build/tear down the Game when a world is entered/left.
  useEffect(() => {
    if (phase !== 'playing' || !current) return;
    let savedTimer = null;
    reseed(current.seed);
    const save = { ...(current.save || {}), id: current.id, name: current.name, seed: current.seed };
    const game = new Game(containerRef.current, save);
    gameRef.current = game;
    window.__apex = game;
    game.onStats = setStats;
    game.onScreenChange = setOpenScreen;
    game.onDead = setDead;
    game.onSaved = () => { setSaved(true); clearTimeout(savedTimer); savedTimer = setTimeout(() => setSaved(false), 1500); };
    game.start();

    const onLock = () => setLocked(document.pointerLockElement === game.renderer.domElement);
    document.addEventListener('pointerlockchange', onLock);

    return () => {
      clearTimeout(savedTimer);
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
    setStats(null); setLocked(false); setOpenScreen(null); setDead(false);
    setCurrent({ id: meta.id, name: meta.name, seed: meta.seed, save });
    setPhase('playing');
  };

  const createNew = (name) => {
    const seed = Math.floor(Math.random() * 1e9);
    const id = `w_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    setStats(null); setLocked(false); setOpenScreen(null); setDead(false);
    setCurrent({ id, name, seed, save: null });
    setPhase('playing');
  };

  const removeWorld = async (meta) => {
    await deleteWorld(meta.id);
    refreshWorlds();
  };

  const quitToMenu = async () => {
    await gameRef.current?.save();
    setPhase('menu');
    setCurrent(null);
    await refreshWorlds();
  };

  const paused = phase === 'playing' && !locked && !openScreen && !dead;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {phase === 'menu' && (
        <MainMenu worlds={worlds} onPlay={playExisting} onCreate={createNew} onDelete={removeWorld} />
      )}

      {phase === 'playing' && (
        <>
          {/* Crosshair */}
          {locked && !openScreen && !dead && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', width: 18, height: 18, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>
              <div style={{ position: 'absolute', top: 8, left: 0, width: 18, height: 2, background: 'rgba(255,255,255,0.8)' }} />
              <div style={{ position: 'absolute', left: 8, top: 0, width: 2, height: 18, background: 'rgba(255,255,255,0.8)' }} />
            </div>
          )}

          {gameRef.current?.inventory && !openScreen && !dead && <Hotbar inventory={gameRef.current.inventory} />}
          {stats && !openScreen && !dead && (
            <StatusBars health={stats.health} hunger={stats.hunger} air={stats.air} submerged={stats.submerged} />
          )}

          {gameRef.current?.inventory && openScreen === 'inventory' && <InventoryPanel inventory={gameRef.current.inventory} />}
          {gameRef.current?.inventory && openScreen === 'crafting' && <CraftingTableScreen inventory={gameRef.current.inventory} />}
          {gameRef.current?.inventory && openScreen === 'furnace' && (
            <FurnaceScreen inventory={gameRef.current.inventory} furnace={gameRef.current.activeFurnace} />
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
              onResume={requestLock}
              onSave={() => gameRef.current?.save()}
              onQuit={quitToMenu}
            />
          )}
        </>
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
