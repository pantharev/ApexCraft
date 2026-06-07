import React, { useRef, useState } from 'react';

// On-screen controls for touch devices: a left analog joystick to move, drag
// anywhere else to look, and action buttons. Drives the Game's player /
// interaction directly (no pointer lock on mobile).
export function TouchControls({ game, onInventory, onPause }) {
  const player = game.player;
  const interaction = game.interaction;

  const lookId = useRef(null);
  const lookLast = useRef({ x: 0, y: 0 });
  const joyId = useRef(null);
  const joyBase = useRef(null);
  const [thumb, setThumb] = useState({ x: 0, y: 0 });

  // --- Look (drag on the background layer) ---
  const onLookStart = (e) => {
    if (lookId.current != null) return;
    const t = e.changedTouches[0];
    lookId.current = t.identifier;
    lookLast.current = { x: t.clientX, y: t.clientY };
  };
  const onLookMove = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier === lookId.current) {
        player.look(t.clientX - lookLast.current.x, t.clientY - lookLast.current.y);
        lookLast.current = { x: t.clientX, y: t.clientY };
      }
    }
  };
  const onLookEnd = (e) => {
    for (const t of e.changedTouches) if (t.identifier === lookId.current) lookId.current = null;
  };

  // --- Joystick ---
  const updateJoy = (t) => {
    const b = joyBase.current;
    let dx = (t.clientX - b.cx) / b.radius;
    let dy = (t.clientY - b.cy) / b.radius;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    setThumb({ x: dx * 38, y: dy * 38 });
    player.setTouchMove(dx, -dy); // screen-down is backward
  };
  const onJoyStart = (e) => {
    e.stopPropagation();
    const t = e.changedTouches[0];
    joyId.current = t.identifier;
    const r = e.currentTarget.getBoundingClientRect();
    joyBase.current = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: r.width / 2 };
    updateJoy(t);
  };
  const onJoyMove = (e) => {
    e.stopPropagation();
    for (const t of e.changedTouches) if (t.identifier === joyId.current) updateJoy(t);
  };
  const onJoyEnd = (e) => {
    e.stopPropagation();
    for (const t of e.changedTouches) if (t.identifier === joyId.current) {
      joyId.current = null; setThumb({ x: 0, y: 0 }); player.setTouchMove(0, 0);
    }
  };

  const hold = (down, up) => ({
    onTouchStart: (e) => { e.stopPropagation(); down(); },
    onTouchEnd: (e) => { e.stopPropagation(); up && up(); },
    onTouchCancel: (e) => { e.stopPropagation(); up && up(); },
  });
  const tap = (fn) => ({ onTouchStart: (e) => { e.stopPropagation(); fn(); } });

  const btn = {
    width: 64, height: 64, borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'rgba(255,255,255,0.18)', border: '2px solid rgba(255,255,255,0.4)',
    color: '#fff', font: 'bold 13px system-ui', userSelect: 'none', touchAction: 'none',
  };
  const smallBtn = { ...btn, width: 44, height: 44, font: 'bold 11px system-ui' };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 6, touchAction: 'none', pointerEvents: 'none' }}>
      {/* Look layer (full screen, behind the controls) */}
      <div
        onTouchStart={onLookStart} onTouchMove={onLookMove} onTouchEnd={onLookEnd} onTouchCancel={onLookEnd}
        style={{ position: 'absolute', inset: 0, zIndex: 5, pointerEvents: 'auto', touchAction: 'none' }}
      />

      {/* Joystick (bottom-left) */}
      <div
        onTouchStart={onJoyStart} onTouchMove={onJoyMove} onTouchEnd={onJoyEnd} onTouchCancel={onJoyEnd}
        style={{
          position: 'absolute', left: 24, bottom: 24, width: 130, height: 130, borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)', border: '2px solid rgba(255,255,255,0.3)',
          zIndex: 7, pointerEvents: 'auto', touchAction: 'none',
        }}
      >
        <div style={{
          position: 'absolute', left: '50%', top: '50%', width: 56, height: 56, marginLeft: -28, marginTop: -28,
          borderRadius: '50%', background: 'rgba(255,255,255,0.35)',
          transform: `translate(${thumb.x}px, ${thumb.y}px)`,
        }} />
      </div>

      {/* Action buttons (bottom-right) */}
      <div style={{ position: 'absolute', right: 24, bottom: 24, display: 'grid', gridTemplateColumns: '64px 64px', gap: 12, zIndex: 7, pointerEvents: 'auto' }}>
        <div style={btn} {...hold(() => (player.keys['ShiftLeft'] = true), () => (player.keys['ShiftLeft'] = false))}>Down</div>
        <div style={btn} {...hold(() => (player.keys['Space'] = true), () => (player.keys['Space'] = false))}>Jump</div>
        <div style={btn} {...tap(() => interaction.secondary())}>Place</div>
        <div style={btn} {...hold(() => interaction.primaryDown(), () => interaction.primaryUp())}>Mine</div>
      </div>

      {/* Top-right utility buttons */}
      <div style={{ position: 'absolute', right: 16, top: 16, display: 'flex', gap: 10, zIndex: 7, pointerEvents: 'auto' }}>
        <div style={smallBtn} {...tap(() => { player.flying = !player.flying; })}>Fly</div>
        <div style={smallBtn} {...tap(onInventory)}>Bag</div>
        <div style={smallBtn} {...tap(onPause)}>☰</div>
      </div>
    </div>
  );
}
