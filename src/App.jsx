import React, { useEffect, useRef, useState } from 'react';
import { Game } from './core/Game.js';

export default function App() {
  const containerRef = useRef(null);
  const gameRef = useRef(null);
  const [stats, setStats] = useState(null);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    const game = new Game(containerRef.current);
    gameRef.current = game;
    game.onStats = setStats;
    game.start();

    const onLock = () => setLocked(document.pointerLockElement === game.renderer.domElement);
    document.addEventListener('pointerlockchange', onLock);

    return () => {
      document.removeEventListener('pointerlockchange', onLock);
      game.dispose();
    };
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />

      {/* Crosshair */}
      <div
        style={{
          position: 'absolute', top: '50%', left: '50%',
          width: 18, height: 18, transform: 'translate(-50%, -50%)',
          pointerEvents: 'none',
        }}
      >
        <div style={{ position: 'absolute', top: 8, left: 0, width: 18, height: 2, background: 'rgba(255,255,255,0.8)' }} />
        <div style={{ position: 'absolute', left: 8, top: 0, width: 2, height: 18, background: 'rgba(255,255,255,0.8)' }} />
      </div>

      {/* Debug HUD */}
      {stats && (
        <div style={{
          position: 'absolute', top: 8, left: 8, color: '#fff',
          font: '13px monospace', textShadow: '1px 1px 2px #000',
          pointerEvents: 'none', lineHeight: 1.5,
        }}>
          <div>ApexCraft — Phase 1</div>
          <div>XYZ: {stats.x} / {stats.y} / {stats.z}</div>
          <div>Chunks loaded: {stats.chunks}</div>
          <div>Mode: {stats.flying ? 'Flying' : 'Walking'}{stats.underwater ? ' (underwater)' : ''}</div>
        </div>
      )}

      {/* Click-to-play overlay */}
      {!locked && (
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
            <div><b>F</b> toggle fly &nbsp; <b>Shift</b> descend (fly) &nbsp; <b>Esc</b> release mouse</div>
          </div>
        </div>
      )}
    </div>
  );
}
