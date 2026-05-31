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

  useEffect(() => {
    const game = new Game(containerRef.current);
    gameRef.current = game;
    game.onStats = setStats;
    game.onScreenChange = setOpenScreen;
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

      {/* Hotbar (always visible while playing) */}
      {ready && inventory && !openScreen && <Hotbar inventory={inventory} />}

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
          <div>ApexCraft — Phase 4</div>
          <div>XYZ: {stats.x} / {stats.y} / {stats.z}</div>
          <div>Chunks loaded: {stats.chunks}</div>
          <div>Mode: {stats.flying ? 'Flying' : 'Walking'}{stats.underwater ? ' (underwater)' : ''}</div>
          <div>Holding: {stats.held}</div>
        </div>
      )}

      {/* Click-to-play overlay (not shown while inventory is open) */}
      {!locked && !openScreen && (
        <div
          onClick={() => gameRef.current?.renderer.domElement.requestPointerLock()}
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
            <div><b>E</b> inventory &nbsp; <b>Right-click table</b> to craft 3×3 &nbsp; <b>F</b> fly</div>
          </div>
        </div>
      )}
    </div>
  );
}
