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

      {/* Hotbar */}
      {stats?.hotbar && (
        <div style={{
          position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', gap: 4, pointerEvents: 'none',
        }}>
          {stats.hotbar.map((slot, i) => (
            <div key={slot.name} title={slot.name} style={{
              width: 46, height: 46, borderRadius: 4,
              border: i === stats.selectedIndex ? '3px solid #fff' : '3px solid rgba(0,0,0,0.4)',
              background: slot.color, boxShadow: 'inset 0 0 0 1px rgba(0,0,0,0.3)',
              position: 'relative',
            }}>
              <span style={{
                position: 'absolute', top: 1, left: 3, font: 'bold 11px monospace',
                color: '#fff', textShadow: '1px 1px 1px #000',
              }}>{i + 1}</span>
            </div>
          ))}
        </div>
      )}

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
          <div>Tool: {stats.tool} <span style={{ opacity: 0.6 }}>(T to cycle)</span></div>
        </div>
      )}

      {/* Collected items (temporary, pre-inventory) */}
      {stats?.collected?.length > 0 && (
        <div style={{
          position: 'absolute', top: 8, right: 8, color: '#fff',
          font: '13px monospace', textShadow: '1px 1px 2px #000',
          pointerEvents: 'none', lineHeight: 1.6, textAlign: 'right',
        }}>
          <div style={{ opacity: 0.7, marginBottom: 2 }}>Collected</div>
          {stats.collected.map((c) => (
            <div key={c.name} style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 6 }}>
              <span>{c.display}: {c.count}</span>
              <span style={{ width: 12, height: 12, background: c.color, border: '1px solid rgba(0,0,0,0.5)', display: 'inline-block' }} />
            </div>
          ))}
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
            <div><b>Left-click</b> mine &nbsp; <b>Right-click</b> place &nbsp; <b>1-9 / Scroll</b> select block</div>
            <div><b>T</b> cycle tool &nbsp; <b>F</b> toggle fly &nbsp; <b>Shift</b> descend (fly) &nbsp; <b>Esc</b> release mouse</div>
          </div>
        </div>
      )}
    </div>
  );
}
