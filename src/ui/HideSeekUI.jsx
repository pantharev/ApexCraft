import React from 'react';
import { PROP_BLOCKS } from '../world/arenas/index.js';
import { getBlockId } from '../blocks/BlockRegistry.js';
import { TAUNTS } from '../systems/taunts.js';

// Prop Hunt HUD. Purely informational: round control (start) and disguise
// selection happen via keys (Enter / number keys) because UI buttons can't be
// clicked while the mouse is pointer-locked. Reads the match state pushed by
// the HideSeek manager through game.onMatch.

const PROPS = PROP_BLOCKS.map((n) => ({ name: n, id: getBlockId(n), label: prettify(n) }));
function prettify(s) { return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

const IS_TOUCH = typeof window !== 'undefined' &&
  (window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : 'ontouchstart' in window);

const wrap = { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 22, color: '#fff', fontFamily: 'system-ui' };
const center = (extra) => ({ position: 'absolute', top: '38%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', textShadow: '2px 2px 3px #000', ...extra });
const shadow = { textShadow: '1px 1px 2px #000' };

export function HideSeekHUD({ game, match }) {
  const m = match || { phase: 'lobby', roles: {}, alive: {}, disguise: {}, stun: {}, score: {}, timeLeft: 0, round: 0, winner: null };
  const selfId = game?.hideSeek ? game.hideSeek.selfId : 'self';
  const role = m.roles[selfId];
  const alive = m.alive[selfId] !== false;
  const score = m.score || {};
  const ids = Object.keys(m.roles);
  const hidersTotal = ids.filter((id) => m.roles[id] === 'hider').length;
  const hidersAlive = ids.filter((id) => m.roles[id] === 'hider' && m.alive[id]).length;
  const t = Math.max(0, Math.ceil(m.timeLeft));
  const myBlock = m.disguise[selfId];

  const name = (id) => (id === selfId ? 'You' : id.startsWith('#bot:') ? `Bot ${id.slice(5)}` : (game?.net?.players?.get(id)?.name || 'Player'));

  // Top status bar (always visible during a round).
  const inRound = m.phase === 'countdown' || m.phase === 'seeking';
  const roleColor = role === 'seeker' ? '#ff8b6b' : '#9fe0ff';

  return (
    <div style={wrap}>
      {inRound && (
        <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 18, alignItems: 'center', background: 'rgba(15,17,22,0.7)', padding: '6px 18px', borderRadius: 16, ...shadow }}>
          <span style={{ fontWeight: 700, color: roleColor, letterSpacing: 1 }}>{role === 'seeker' ? 'SEEKER' : 'HIDER'}</span>
          <span>⏱ {fmt(t)}</span>
          <span>🫥 {hidersAlive}/{hidersTotal} hidden</span>
          <span style={{ color: '#ffe08a' }}>⭐ {score[selfId] || 0}</span>
          <span style={{ opacity: 0.6 }}>Round {m.round}</span>
        </div>
      )}

      {m.phase === 'lobby' && (
        <div style={center()}>
          <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: 2 }}>PROP HUNT</div>
          <div style={{ fontSize: 17, opacity: 0.9, marginTop: 6 }}>Hide as a block, or hunt the hiders.</div>
          <div style={{ fontSize: 20, marginTop: 22, padding: '8px 18px', background: 'rgba(60,107,60,0.7)', borderRadius: 10, display: 'inline-block' }}>
            {IS_TOUCH ? 'Tap Start to begin a round' : <>Press <b>Enter</b> to start a round</>}
          </div>
        </div>
      )}

      {m.phase === 'countdown' && (
        <div style={center()}>
          <div style={{ fontSize: 22, opacity: 0.9 }}>{role === 'seeker' ? 'Seekers released in' : 'Hide! Seekers released in'}</div>
          <div style={{ fontSize: 64, fontWeight: 800 }}>{t}</div>
          <div style={{ fontSize: 16, marginTop: 4, color: roleColor }}>
            You are a <b>{role === 'seeker' ? 'SEEKER' : 'HIDER'}</b>
          </div>
        </div>
      )}

      {m.phase === 'roundEnd' && (
        <div style={center()}>
          <div style={{ fontSize: 50, fontWeight: 800, color: m.winner === 'seekers' ? '#ff8b6b' : '#9fe0ff' }}>
            {m.winner === 'seekers' ? 'SEEKERS WIN' : 'HIDERS WIN'}
          </div>
          {(() => {
            const board = ids.map((id) => ({ id, s: score[id] || 0 })).sort((a, b) => b.s - a.s).slice(0, 5);
            if (!board.some((e) => e.s > 0)) return null;
            return (
              <div style={{ marginTop: 16, display: 'inline-block', textAlign: 'left', background: 'rgba(15,17,22,0.6)', padding: '12px 20px', borderRadius: 12 }}>
                <div style={{ fontWeight: 700, color: '#ffe08a', marginBottom: 6, letterSpacing: 1 }}>⭐ STYLE LEADERBOARD</div>
                {board.map((e, i) => (
                  <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 24, fontSize: 16, opacity: e.id === selfId ? 1 : 0.85 }}>
                    <span>{i + 1}. {name(e.id)}</span>
                    <span style={{ color: '#ffe08a' }}>{e.s}</span>
                  </div>
                ))}
              </div>
            );
          })()}
          <div style={{ fontSize: 18, opacity: 0.85, marginTop: 12 }}>Next round in {t}s · {IS_TOUCH ? 'tap Start now' : <>press <b>Enter</b> to start now</>}</div>
        </div>
      )}

      {/* Disguise palette: hiders pick during the countdown with number keys.
          On touch the tappable HideSeekTouch buttons cover this instead. */}
      {m.phase === 'countdown' && role === 'hider' && !IS_TOUCH && (
        <div style={{ position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8, background: 'rgba(15,17,22,0.7)', padding: '10px 14px', borderRadius: 12 }}>
          {PROPS.map((p, i) => (
            <div key={p.name} style={{
              padding: '6px 10px', borderRadius: 8, textAlign: 'center', minWidth: 64,
              background: myBlock === p.id ? 'rgba(60,107,60,0.9)' : 'rgba(255,255,255,0.08)',
              border: myBlock === p.id ? '2px solid #fff8' : '2px solid transparent', ...shadow,
            }}>
              <div style={{ fontWeight: 700, opacity: 0.7, fontSize: 12 }}>{i + 1}</div>
              <div style={{ fontSize: 12 }}>{p.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Role-specific hint line. */}
      {m.phase === 'seeking' && (
        <div style={{ position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)', background: 'rgba(15,17,22,0.7)', padding: '6px 16px', borderRadius: 12, fontSize: 14, ...shadow }}>
          {role === 'seeker'
            ? (IS_TOUCH ? 'Tap a suspicious block to tag it. A wrong guess stuns you briefly.' : 'Left-click a suspicious block to tag it. A wrong guess stuns you briefly.')
            : alive ? `Stay still and blend in! ${IS_TOUCH ? 'Tap 😜' : 'Hold [R]'} to taunt for style points — but it draws seekers in.` : 'You were found! Spectating — fly around to watch.'}
        </div>
      )}
    </div>
  );
}

// Touch controls for Prop Hunt: contextual tappable buttons (start / disguise /
// taunt) since mobile has no keyboard. Rendered only on touch devices.
export function HideSeekTouch({ game, match }) {
  const [menu, setMenu] = React.useState(false);
  const m = match || {};
  const selfId = game?.hideSeek ? game.hideSeek.selfId : 'self';
  const role = (m.roles || {})[selfId];
  const alive = (m.alive || {})[selfId] !== false;
  const myBlock = (m.disguise || {})[selfId];
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
      {/* Start / next round */}
      {(phase === 'lobby' || phase === 'roundEnd') && (
        <div {...tap(() => game.hsStart())}
          style={{ ...pill, position: 'absolute', left: '50%', bottom: '30%', transform: 'translateX(-50%)', padding: '14px 30px', fontSize: 20, fontWeight: 700, background: 'rgba(60,107,60,0.9)' }}>
          ▶ Start round
        </div>
      )}

      {/* Disguise picker (countdown, hiders) */}
      {phase === 'countdown' && role === 'hider' && (
        <div style={{ position: 'absolute', left: '50%', bottom: 20, transform: 'translateX(-50%)', display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center', maxWidth: '92%' }}>
          {PROPS.map((p) => (
            <div key={p.name} {...tap(() => game.hsPickDisguise(p.id))}
              style={{ ...pill, padding: '8px 10px', fontSize: 12, background: myBlock === p.id ? 'rgba(60,107,60,0.92)' : pill.background }}>
              {p.label}
            </div>
          ))}
        </div>
      )}

      {/* Taunt menu (seeking, alive hiders) */}
      {phase === 'seeking' && role === 'hider' && alive && (
        <div style={{ position: 'absolute', right: 24, bottom: 130, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
          {menu && TAUNTS.map((t) => (
            <div key={t.id} {...tap(() => { game.hsTaunt(t.id); setMenu(false); })}
              style={{ ...pill, width: 92, padding: '8px 0' }}>
              <div style={{ fontSize: 26 }}>{t.emoji}</div>
              <div style={{ fontSize: 10, opacity: 0.85 }}>{t.label} +{t.points}</div>
            </div>
          ))}
          <div {...tap(() => setMenu((v) => !v))}
            style={{ ...pill, width: 68, height: 68, borderRadius: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', background: menu ? 'rgba(60,107,60,0.9)' : pill.background }}>
            <div style={{ fontSize: 24 }}>😜</div>
            <div style={{ fontSize: 9 }}>Taunt</div>
          </div>
        </div>
      )}
    </div>
  );
}

// Radial taunt wheel: fans the taunts out in a ring while the player holds R.
// Aim with the mouse (Game freezes camera-look); the highlighted taunt fires on
// release. `wheel` = { open, selected } pushed via game.onTauntWheel.
export function TauntWheel({ wheel }) {
  if (!wheel || !wheel.open) return null;
  const R = 120, n = TAUNTS.length;
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 30, pointerEvents: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ position: 'relative', width: R * 2 + 90, height: R * 2 + 90 }}>
        <div style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%,-50%)', color: '#fff', font: 'bold 13px system-ui', opacity: 0.85, textAlign: 'center', textShadow: '1px 1px 2px #000' }}>
          {wheel.selected >= 0 ? `+${TAUNTS[wheel.selected].points}` : 'aim'}
        </div>
        {TAUNTS.map((t, i) => {
          const a = -Math.PI / 2 + (i / n) * Math.PI * 2;
          const cx = Math.cos(a) * R, cy = Math.sin(a) * R;
          const on = wheel.selected === i;
          return (
            <div key={t.id} style={{
              position: 'absolute', left: '50%', top: '50%',
              transform: `translate(-50%,-50%) translate(${cx}px, ${cy}px) scale(${on ? 1.25 : 1})`,
              transition: 'transform 0.08s ease',
              width: 82, height: 82, borderRadius: '50%',
              background: on ? 'rgba(60,107,60,0.95)' : 'rgba(15,17,22,0.82)',
              border: on ? '3px solid #fff' : '2px solid rgba(255,255,255,0.25)',
              display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textShadow: '1px 1px 2px #000',
            }}>
              <div style={{ fontSize: 32, lineHeight: 1 }}>{t.emoji}</div>
              <div style={{ fontSize: 11, color: '#fff', opacity: 0.9 }}>{t.label}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmt(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}
