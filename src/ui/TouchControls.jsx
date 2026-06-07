import React, { useRef, useState } from 'react';

// On-screen controls for touch devices:
//   • left analog joystick = move
//   • touch the world = look (drag), place (quick tap), or mine (press & hold)
//   • buttons: Jump (and Down while flying), Fly, Bag, Pause
const HOLD_MS = 220;     // press-and-hold before mining starts
const TAP_MS = 250;      // max duration for a tap (= place)
const MOVE_PX = 12;      // movement beyond this = a look drag (not a tap/mine)

export function TouchControls({ game, onInventory, onPause }) {
  const player = game.player;
  const interaction = game.interaction;

  const [flying, setFlying] = useState(player.flying);

  // Look / mine / place touch (the world layer).
  const lookId = useRef(null);
  const last = useRef({ x: 0, y: 0 });
  const t0 = useRef(0);
  const moved = useRef(0);
  const mining = useRef(false);
  const mineTimer = useRef(null);

  const onLookStart = (e) => {
    if (lookId.current != null) return;
    const t = e.changedTouches[0];
    lookId.current = t.identifier;
    last.current = { x: t.clientX, y: t.clientY };
    t0.current = Date.now();
    moved.current = 0;
    mining.current = false;
    mineTimer.current = setTimeout(() => { mining.current = true; interaction.startMining(); }, HOLD_MS);
  };
  const onLookMove = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId.current) continue;
      const dx = t.clientX - last.current.x, dy = t.clientY - last.current.y;
      last.current = { x: t.clientX, y: t.clientY };
      moved.current += Math.hypot(dx, dy);
      player.look(dx, dy);
      if (!mining.current && moved.current > MOVE_PX) clearTimeout(mineTimer.current); // it's a drag
    }
  };
  const onLookEnd = (e) => {
    for (const t of e.changedTouches) {
      if (t.identifier !== lookId.current) continue;
      clearTimeout(mineTimer.current);
      if (mining.current) interaction.primaryUp();
      else if (Date.now() - t0.current < TAP_MS && moved.current < MOVE_PX) interaction.attackOrPlace(); // tap = attack mob or place
      lookId.current = null;
      mining.current = false;
    }
  };

  // Joystick.
  const joyId = useRef(null);
  const joyBase = useRef(null);
  const [thumb, setThumb] = useState({ x: 0, y: 0 });
  const updateJoy = (t) => {
    const b = joyBase.current;
    let dx = (t.clientX - b.cx) / b.radius;
    let dy = (t.clientY - b.cy) / b.radius;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    setThumb({ x: dx * 38, y: dy * 38 });
    player.setTouchMove(dx, -dy);
  };
  const onJoyStart = (e) => {
    e.stopPropagation();
    const t = e.changedTouches[0];
    joyId.current = t.identifier;
    const r = e.currentTarget.getBoundingClientRect();
    joyBase.current = { cx: r.left + r.width / 2, cy: r.top + r.height / 2, radius: r.width / 2 };
    updateJoy(t);
  };
  const onJoyMove = (e) => { e.stopPropagation(); for (const t of e.changedTouches) if (t.identifier === joyId.current) updateJoy(t); };
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
    width: 70, height: 70, borderRadius: '50%', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: 'rgba(255,255,255,0.18)', border: '2px solid rgba(255,255,255,0.4)',
    color: '#fff', font: 'bold 14px system-ui', userSelect: 'none', touchAction: 'none',
  };
  const smallBtn = { ...btn, width: 46, height: 46, font: 'bold 11px system-ui' };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 6, touchAction: 'none', pointerEvents: 'none' }}>
      {/* World layer: drag = look, tap = place, hold = mine */}
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
          borderRadius: '50%', background: 'rgba(255,255,255,0.35)', transform: `translate(${thumb.x}px, ${thumb.y}px)`,
        }} />
      </div>

      {/* Jump (and Down while flying), bottom-right */}
      <div style={{ position: 'absolute', right: 28, bottom: 28, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'center', zIndex: 7, pointerEvents: 'auto' }}>
        {flying && (
          <div style={btn} {...hold(() => (player.keys['ShiftLeft'] = true), () => (player.keys['ShiftLeft'] = false))}>Down</div>
        )}
        <div style={btn} {...hold(() => (player.keys['Space'] = true), () => (player.keys['Space'] = false))}>Jump</div>
      </div>

      {/* Utility buttons (top-right) */}
      <div style={{ position: 'absolute', right: 16, top: 16, display: 'flex', gap: 10, zIndex: 7, pointerEvents: 'auto' }}>
        <div style={{ ...smallBtn, background: flying ? 'rgba(120,180,255,0.4)' : smallBtn.background }}
          {...tap(() => { player.flying = !player.flying; setFlying(player.flying); })}>Fly</div>
        <div style={smallBtn} {...tap(onInventory)}>Bag</div>
        <div style={smallBtn} {...tap(onPause)}>☰</div>
      </div>
    </div>
  );
}
