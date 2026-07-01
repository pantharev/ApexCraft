import React from 'react';
import { PROP_BLOCKS } from '../world/arenas/index.js';
import { getBlockId } from '../blocks/BlockRegistry.js';

// Prop Hunt HUD. Purely informational: round control (start) and disguise
// selection happen via keys (Enter / number keys) because UI buttons can't be
// clicked while the mouse is pointer-locked. Reads the match state pushed by
// the HideSeek manager through game.onMatch.

const PROPS = PROP_BLOCKS.map((n) => ({ name: n, id: getBlockId(n), label: prettify(n) }));
function prettify(s) { return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

const wrap = { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 22, color: '#fff', fontFamily: 'system-ui' };
const center = (extra) => ({ position: 'absolute', top: '38%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', textShadow: '2px 2px 3px #000', ...extra });
const shadow = { textShadow: '1px 1px 2px #000' };

export function HideSeekHUD({ game, match }) {
  const m = match || { phase: 'lobby', roles: {}, alive: {}, disguise: {}, stun: {}, timeLeft: 0, round: 0, winner: null };
  const selfId = game?.hideSeek ? game.hideSeek.selfId : 'self';
  const role = m.roles[selfId];
  const alive = m.alive[selfId] !== false;
  const ids = Object.keys(m.roles);
  const hidersTotal = ids.filter((id) => m.roles[id] === 'hider').length;
  const hidersAlive = ids.filter((id) => m.roles[id] === 'hider' && m.alive[id]).length;
  const t = Math.max(0, Math.ceil(m.timeLeft));
  const myBlock = m.disguise[selfId];

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
          <span style={{ opacity: 0.6 }}>Round {m.round}</span>
        </div>
      )}

      {m.phase === 'lobby' && (
        <div style={center()}>
          <div style={{ fontSize: 46, fontWeight: 800, letterSpacing: 2 }}>PROP HUNT</div>
          <div style={{ fontSize: 17, opacity: 0.9, marginTop: 6 }}>Hide as a block, or hunt the hiders.</div>
          <div style={{ fontSize: 20, marginTop: 22, padding: '8px 18px', background: 'rgba(60,107,60,0.7)', borderRadius: 10, display: 'inline-block' }}>
            Press <b>Enter</b> to start a round
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
          <div style={{ fontSize: 18, opacity: 0.85, marginTop: 8 }}>Next round in {t}s · press <b>Enter</b> to start now</div>
        </div>
      )}

      {/* Disguise palette: hiders pick during the countdown with number keys. */}
      {m.phase === 'countdown' && role === 'hider' && (
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
            ? 'Left-click a suspicious block to tag it. A wrong guess stuns you briefly.'
            : alive ? 'Stay still and blend in!' : 'You were found! Spectating — fly around to watch.'}
        </div>
      )}
    </div>
  );
}

function fmt(sec) {
  const m = Math.floor(sec / 60), s = sec % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}
