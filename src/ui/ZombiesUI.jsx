import React from 'react';
import { SHOP } from '../systems/ZombiesMode.js';

// Zombies HUD. Purely informational: match control happens via keys (Enter to
// start / bring the wave, B for the shop) because UI buttons can't be clicked
// while the mouse is pointer-locked. Reads the match state pushed by the
// ZombiesMode manager through game.onMatch. The shop screen is the exception:
// it renders as an openScreen overlay, where the mouse is free.

const IS_TOUCH = typeof window !== 'undefined' &&
  (window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : 'ontouchstart' in window);

const wrap = { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 22, color: '#fff', fontFamily: 'system-ui' };
const center = (extra) => ({ position: 'absolute', top: '38%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', textShadow: '2px 2px 3px #000', ...extra });
const shadow = { textShadow: '1px 1px 2px #000' };

export function ZombiesHUD({ game, match }) {
  const m = match || { phase: 'lobby', timeLeft: 0, wave: 0, remaining: 0, total: 0, alive: {}, points: {}, kills: {}, finalWave: 0 };
  const selfId = game?.zombiesMode ? game.zombiesMode.selfId : 'self';
  const alive = m.alive[selfId] !== false;
  const t = Math.max(0, Math.ceil(m.timeLeft));
  const ids = Object.keys(m.alive);
  const name = (id) => (id === selfId ? 'You' : (game?.net?.players?.get(id)?.name || 'Player'));

  const inMatch = m.phase === 'build' || m.phase === 'wave';

  return (
    <div style={wrap}>
      {inMatch && (
        <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 18, alignItems: 'center', background: 'rgba(15,17,22,0.7)', padding: '6px 18px', borderRadius: 16, ...shadow }}>
          <span style={{ fontWeight: 700, color: '#ff8b6b', letterSpacing: 1 }}>
            WAVE {m.phase === 'build' ? m.wave + 1 : m.wave}
          </span>
          {m.phase === 'wave'
            ? <span>🧟 {m.remaining}/{m.total}</span>
            : <span>⏱ incoming in {fmt(t)}</span>}
          <span style={{ color: '#ffe08a' }}>⭐ {m.points[selfId] || 0}</span>
          {ids.length > 1 && (
            <span style={{ display: 'flex', gap: 6 }}>
              {ids.map((id) => (
                <span key={id} title={name(id)} style={{ opacity: m.alive[id] ? 1 : 0.35 }}>
                  {m.alive[id] ? '🙂' : '💀'}
                </span>
              ))}
            </span>
          )}
        </div>
      )}

      {m.phase === 'lobby' && (
        <div style={center()}>
          <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: 2 }}>ZOMBIES</div>
          <div style={{ fontSize: 17, opacity: 0.9, marginTop: 6 }}>
            Hold the keep against endless waves. Build, shoot, survive — together.
          </div>
          <div style={{ fontSize: 20, marginTop: 22, padding: '8px 18px', background: 'rgba(138,46,46,0.75)', borderRadius: 10, display: 'inline-block' }}>
            {IS_TOUCH ? 'Tap Start to begin the siege' : <>Press <b>Enter</b> to start the siege</>}
          </div>
        </div>
      )}

      {m.phase === 'build' && (
        <div style={{ position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)', background: 'rgba(15,17,22,0.7)', padding: '6px 16px', borderRadius: 12, fontSize: 14, ...shadow }}>
          {IS_TOUCH
            ? 'Fortify the keep! Tap Shop to spend points, Bring wave when ready.'
            : <>Fortify the keep! <b>[B]</b> shop · <b>[Enter]</b> bring the wave early</>}
        </div>
      )}

      {m.phase === 'wave' && !alive && (
        <div style={{ position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)', background: 'rgba(70,10,10,0.75)', padding: '6px 16px', borderRadius: 12, fontSize: 14, ...shadow }}>
          💀 You're down — spectating. Back on your feet next wave.
        </div>
      )}

      {m.phase === 'gameover' && (
        <div style={center()}>
          <div style={{ fontSize: 50, fontWeight: 800, color: '#ff8b6b' }}>GAME OVER</div>
          <div style={{ fontSize: 22, marginTop: 6 }}>The team survived <b>{m.finalWave}</b> wave{m.finalWave === 1 ? '' : 's'}</div>
          {(() => {
            const board = ids.map((id) => ({ id, p: m.points[id] || 0, k: (m.kills || {})[id] || 0 }))
              .sort((a, b) => b.p - a.p);
            if (!board.length) return null;
            return (
              <div style={{ marginTop: 16, display: 'inline-block', textAlign: 'left', background: 'rgba(15,17,22,0.6)', padding: '12px 20px', borderRadius: 12 }}>
                <div style={{ fontWeight: 700, color: '#ffe08a', marginBottom: 6, letterSpacing: 1 }}>⭐ FINAL STANDINGS</div>
                {board.map((e, i) => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 24, fontSize: 16, opacity: e.id === selfId ? 1 : 0.85 }}>
                    <span>{i + 1}. {name(e.id)}</span>
                    <span><span style={{ opacity: 0.7 }}>🧟 {e.k}</span> · <span style={{ color: '#ffe08a' }}>{e.p}</span></span>
                  </div>
                ))}
              </div>
            );
          })()}
          <div style={{ fontSize: 18, opacity: 0.85, marginTop: 12 }}>
            Lobby in {t}s · {IS_TOUCH ? 'tap Start to go again' : <>press <b>Enter</b> to go again</>}
          </div>
        </div>
      )}
    </div>
  );
}

// Between-wave shop: an openScreen overlay (mouse is free), spending the
// points the wave director awarded. Purchases go through ZombiesMode.buy —
// optimistic locally, validated/decremented by the match authority.
export function ZombiesShop({ game, match }) {
  const [, bump] = React.useReducer((n) => n + 1, 0);
  const m = match || { phase: 'lobby', points: {} };
  const selfId = game?.zombiesMode ? game.zombiesMode.selfId : 'self';
  const points = (m.points || {})[selfId] || 0;
  const open = m.phase === 'build';

  return (
    <div style={{
      position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(0,0,0,0.55)', zIndex: 30, fontFamily: 'system-ui',
    }}>
      <div style={{ background: '#1b1d22', border: '3px solid #3a3d44', borderRadius: 8, padding: 22, minWidth: 380, color: '#eee' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 14 }}>
          <h2 style={{ fontSize: 22, letterSpacing: 1 }}>Supply Shop</h2>
          <span style={{ color: '#ffe08a', fontSize: 18, fontWeight: 700 }}>⭐ {points}</span>
        </div>
        {!open && <div style={{ opacity: 0.7, marginBottom: 12 }}>The shop opens between waves.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {SHOP.filter((s) => !s.wall).map((s) => {
            const afford = open && points >= s.cost;
            return (
              <button key={s.id} disabled={!afford}
                onClick={() => { game.zombiesMode?.buy(s.id); bump(); }}
                style={{
                  font: '14px system-ui', padding: '10px 12px', borderRadius: 6, cursor: afford ? 'pointer' : 'default',
                  background: afford ? '#3c6b3c' : '#2a2d33', color: afford ? '#fff' : '#777',
                  border: afford ? '2px solid #244524' : '2px solid #3a3d44',
                  display: 'flex', justifyContent: 'space-between', gap: 10,
                }}>
                <span>{s.label}</span>
                <span style={{ color: afford ? '#ffe08a' : '#666' }}>⭐ {s.cost}</span>
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 14, fontSize: 12, opacity: 0.55 }}>
          Earn points by killing zombies; a wave-survival bonus pays out even if you fell.
          Guns are bought at the chalk outlines on the walls — and the Mystery Box.
        </div>
      </div>
    </div>
  );
}

// Touch controls for Zombies: contextual tappable pills (start / bring wave /
// shop) since mobile has no keyboard. Rendered only on touch devices.
export function ZombiesTouch({ game, match }) {
  const m = match || {};
  const phase = m.phase;

  const tap = (fn) => ({
    onTouchStart: (e) => { e.stopPropagation(); e.preventDefault(); fn(); },
    onClick: (e) => { e.stopPropagation(); fn(); },
  });
  const pill = {
    pointerEvents: 'auto', touchAction: 'none', userSelect: 'none', color: '#fff',
    borderRadius: 12, textAlign: 'center', textShadow: '1px 1px 2px #000',
    border: '2px solid rgba(255,255,255,0.4)', background: 'rgba(15,17,22,0.82)',
  };

  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 8, pointerEvents: 'none', fontFamily: 'system-ui' }}>
      {(phase === 'lobby' || phase === 'gameover') && (
        <div {...tap(() => game.zStart())}
          style={{ ...pill, position: 'absolute', left: '50%', bottom: '30%', transform: 'translateX(-50%)', padding: '14px 30px', fontSize: 20, fontWeight: 700, background: 'rgba(138,46,46,0.9)' }}>
          ▶ Start siege
        </div>
      )}

      {phase === 'build' && (
        <div style={{ position: 'absolute', right: 24, bottom: 130, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div {...tap(() => game.setScreen('shop'))} style={{ ...pill, padding: '10px 18px', fontSize: 15 }}>
            ⭐ Shop
          </div>
          <div {...tap(() => game.zStartWave())} style={{ ...pill, padding: '10px 18px', fontSize: 15, background: 'rgba(138,46,46,0.9)' }}>
            🧟 Bring wave
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}
