import React, { useEffect, useRef, useState } from 'react';
import { Game } from './core/Game.js';
import { Hotbar, InventoryPanel, CraftingTableScreen, FurnaceScreen } from './ui/InventoryUI.jsx';

export default function App() {
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  const [stats, setStats] = useState(null);
  const [locked, setLocked] = useState(false);
  const [openScreen, setOpenScreen] = useState(null);
  const [ready, setReady] = useState(false);
  const [dead, setDead] = useState(false);

  useEffect(() => {
    const game = new Game(containerRef.current);
    gameRef.current = game;
    window.__apex = game; // debug handle
    game.onStats = setStats;
    game.onScreenChange = setOpenScreen;
    game.onDead = setDead;
    game.start();
    setReady(true);

    const onLock = () => setLocked(document.pointerLockElement === game.renderer.domElement);
    document.addEventListener('pointerlockchange', onLock);

    return () => {
      document.removeEventListener('pointerlockchange', onLock);
      game.dispose();
    };
  }, []);

  const inventory = gameRef.current?.inventory;

  // Pointer lock can reject (e.g. inside a permission-less iframe, or during the
  // brief post-unlock cooldown). Catch it so the failure is visible instead of
  // silently leaving you on the "Click to play" screen.
  const requestLock = () => {
    const el = gameRef.current?.renderer.domElement;
    if (!el || !el.requestPointerLock) return;
    try {
      const r = el.requestPointerLock();
      if (r && r.catch) r.catch((err) => console.warn('Pointer lock failed:', err.message || err));
    } catch (err) {
      console.warn('Pointer lock failed:', err);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Crosshair (hidden while a screen is open) */}
      {!openScreen && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          width: 18, height: 18, transform: 'translate(-50%, -50%)', pointerEvents: 'none',
        }}>
          <div style={{ position: 'absolute', top: 8, left: 0, width: 18, height: 2, background: 'rgba(255,255,255,0.8)' }} />
          <div style={{ position: 'absolute', left: 8, top: 0, width: 2, height: 18, background: 'rgba(255,255,255,0.8)' }} />
        </div>
      )}

      {/* Hotbar + survival bars (while playing) */}
      {ready && inventory && !openScreen && !dead && <Hotbar inventory={inventory} />}
      {stats && !openScreen && !dead && (
        <StatusBars health={stats.health} hunger={stats.hunger} air={stats.air} submerged={stats.submerged} />
      )}

      {/* UI screens */}
      {ready && inventory && openScreen === 'inventory' && <InventoryPanel inventory={inventory} />}
      {ready && inventory && openScreen === 'crafting' && <CraftingTableScreen inventory={inventory} />}
      {ready && inventory && openScreen === 'furnace' && (
        <FurnaceScreen inventory={inventory} furnace={gameRef.current.activeFurnace} />
      )}

      {/* Debug HUD */}
      {stats && (
        <div style={{
          position: 'absolute', top: 8, left: 8, color: '#fff',
          font: '13px monospace', textShadow: '1px 1px 2px #000',
          pointerEvents: 'none', lineHeight: 1.5,
        }}>
          <div>ApexCraft — Phase 6</div>
          <div>XYZ: {stats.x} / {stats.y} / {stats.z}</div>
          <div>Chunks loaded: {stats.chunks}</div>
          <div>Mode: {stats.flying ? 'Flying' : 'Walking'}{stats.underwater ? ' (underwater)' : ''}</div>
          <div>Time: {stats.clock} ({stats.night ? 'Night' : 'Day'}) &nbsp; Mobs: {stats.mobs}</div>
          <div>Holding: {stats.held}</div>
        </div>
      )}

      {/* Death overlay */}
      {dead && (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center', color: '#fff',
          background: 'rgba(60,0,0,0.55)', zIndex: 20,
        }}>
          <h1 style={{ fontSize: 44, marginBottom: 20, letterSpacing: 1 }}>You died!</h1>
          <button
            onClick={() => gameRef.current?.respawn()}
            style={{
              font: '18px system-ui', padding: '10px 26px', cursor: 'pointer',
              background: '#6b6b6b', color: '#fff', border: '2px solid #2b2b2b', borderRadius: 4,
            }}
          >Respawn</button>
          <p style={{ marginTop: 16, opacity: 0.8 }}>Your items were dropped where you fell.</p>
        </div>
      )}

      {/* Click-to-play overlay (not shown while a screen or death overlay is up) */}
      {!locked && !openScreen && !dead && (
        <div
          onClick={requestLock}
          style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer',
            background: 'rgba(0,0,0,0.45)', font: '16px system-ui', textAlign: 'center',
          }}>
          <h1 style={{ fontSize: 40, marginBottom: 12, letterSpacing: 2 }}>ApexCraft</h1>
          <p style={{ marginBottom: 18, opacity: 0.85 }}>Click to play</p>
          <div style={{ opacity: 0.7, lineHeight: 1.8 }}>
            <div><b>WASD</b> move &nbsp; <b>Space</b> jump &nbsp; <b>Mouse</b> look</div>
            <div><b>Left-click</b> mine &nbsp; <b>Right-click</b> place &nbsp; <b>1-9 / Scroll</b> select</div>
            <div><b>E</b> inventory &nbsp; <b>Right-click table</b> craft &nbsp; <b>Right-click food</b> eat &nbsp; <b>F</b> fly</div>
          </div>
        </div>
      )}
    </div>
  );
}

// Hearts (health), hunger, and air-bubble bars above the hotbar. Each heart /
// hunger icon represents 2 points and supports a half state.
function StatusBars({ health, hunger, air, submerged }) {
  const halfRow = (value, fullColor, halfColor, char) =>
    Array.from({ length: 10 }).map((_, i) => {
      const v = value / 2 - i;
      const color = v >= 1 ? fullColor : v >= 0.5 ? halfColor : '#333';
      return <span key={i} style={{ color, fontSize: 18, textShadow: '1px 1px 1px #000' }}>{char}</span>;
    });

  return (
    <div style={{
      position: 'absolute', bottom: 70, left: '50%', transform: 'translateX(-50%)',
      width: 470, display: 'flex', justifyContent: 'space-between', pointerEvents: 'none',
    }}>
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
