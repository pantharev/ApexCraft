import React, { useState } from 'react';
import { MAPS, MAP_LIST, ZOMBIE_MAP_LIST } from '../world/arenas/index.js';
import { MENU_FONT, Wordmark } from './MenuBackdrop.jsx';

const panel = {
  background: '#1b1d22', border: '3px solid #3a3d44', borderRadius: 8,
  padding: 24, minWidth: 360, color: '#eee', font: '15px system-ui',
};
const btn = {
  font: '15px system-ui', padding: '8px 16px', cursor: 'pointer',
  background: '#3c6b3c', color: '#fff', border: '2px solid #244524', borderRadius: 4,
};
const btnGrey = { ...btn, background: '#555', border: '2px solid #333' };
const overlay = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
  justifyContent: 'center', background: 'rgba(0,0,0,0.6)', zIndex: 30,
};

function fmtDate(ms) {
  if (!ms) return 'never';
  const d = new Date(ms);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

const input = {
  padding: '8px 10px', borderRadius: 4, border: '1px solid #444',
  background: '#111', color: '#eee', font: '15px system-ui',
};

// --- The world list ------------------------------------------------------------
// It sits on the live backdrop (ui/MenuBackdrop.jsx), so its panel is a pane
// of smoked glass rather than a solid box, and only lightly dims what is
// behind it.
const menuOverlay = {
  position: 'absolute', inset: 0, zIndex: 30, display: 'flex', alignItems: 'center',
  justifyContent: 'center', padding: 14, boxSizing: 'border-box',
  background: 'rgba(4,8,18,0.34)', font: `15px ${MENU_FONT}`,
};
const menuPanel = {
  width: 'min(580px, 100%)', maxHeight: '100%', overflowY: 'auto', boxSizing: 'border-box',
  padding: '20px 24px 22px', color: '#eef2f8',
  background: 'rgba(13,17,26,0.80)', backdropFilter: 'blur(9px)', WebkitBackdropFilter: 'blur(9px)',
  border: '1px solid rgba(255,255,255,0.16)', borderRadius: 14,
  boxShadow: '0 24px 70px rgba(0,0,0,0.55)',
};
const sectionLabel = {
  fontSize: 11, fontWeight: 700, letterSpacing: 1.6, textTransform: 'uppercase',
  color: '#8fa6c8', margin: '20px 0 8px',
};
const row = {
  display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, padding: '8px 10px', marginBottom: 6,
  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)', borderRadius: 8,
};
const mBtn = { ...btn, font: `15px ${MENU_FONT}`, borderRadius: 6 };
const mBtnGrey = { ...mBtn, background: '#4d525c', border: '2px solid #2f333b' };
const mBtnBlue = { ...mBtn, background: '#2e5d8e', border: '2px solid #1c3a59' };
const mInput = {
  ...input, font: `15px ${MENU_FONT}`, borderRadius: 6, minWidth: 0,
  background: 'rgba(0,0,0,0.38)', border: '1px solid rgba(255,255,255,0.2)',
};
const tag = (color, background) => ({
  marginLeft: 6, fontSize: 10, fontWeight: 700, color, background,
  padding: '1px 6px', borderRadius: 8, letterSpacing: 0.5,
});
// A choice in a row of choices (game mode, arena map).
const choice = (on, accent) => ({
  flex: '1 1 104px', font: `13px ${MENU_FONT}`, padding: '7px 8px', cursor: 'pointer', borderRadius: 6,
  background: on ? accent : 'rgba(255,255,255,0.06)',
  color: on ? '#fff' : '#a9b4c4', textAlign: 'center',
  border: on ? '2px solid rgba(255,255,255,0.4)' : '2px solid rgba(255,255,255,0.1)',
});

// Pick an existing world or create a new one. Worlds can also be hosted for
// friends (multiplayer), or you can join a friend's room by code.
export function MainMenu({ worlds, onPlay, onCreate, onDelete, onHome, onHost, onJoin, netError, netBusy }) {
  const [name, setName] = useState('');
  const [mode, setMode] = useState('survival');
  const [map, setMap] = useState(MAP_LIST[0].id); // Prop Hunt arena map
  const [joinCode, setJoinCode] = useState('');
  const [playerName, setPlayerName] = useState(
    () => (typeof localStorage !== 'undefined' && localStorage.getItem('apex_player_name')) || ''
  );

  const myName = () => {
    const n = playerName.trim() || 'Player';
    try { localStorage.setItem('apex_player_name', n); } catch (_) { /* private mode */ }
    return n;
  };
  const create = () => {
    if (!name.trim()) return;
    onCreate(name.trim(), mode, map);
    setName('');
  };

  return (
    <div style={menuOverlay}>
      <div style={menuPanel}>
        {/* Home on the left, the wordmark dead centre, whatever the width. */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 8, paddingBottom: 6 }}>
          <div>
            {onHome && (
              <button onClick={onHome} title="Back to the title screen" style={{
                font: `13px ${MENU_FONT}`, padding: '5px 10px', whiteSpace: 'nowrap',
                cursor: 'pointer', color: '#cfe0ff', background: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.18)', borderRadius: 6,
              }}>← Home</button>
            )}
          </div>
          <Wordmark size="clamp(24px, 7.2vw, 38px)" />
          <div />
        </div>

        <div style={sectionLabel}>Your worlds</div>
        <div style={{ maxHeight: 232, overflowY: 'auto' }}>
          {worlds.length === 0 && (
            <div style={{ ...row, justifyContent: 'center', opacity: 0.7, padding: 14 }}>No worlds yet — create one below.</div>
          )}
          {worlds.map((w) => (
            <div key={w.id} style={row}>
              {/* On a narrow screen the buttons drop under the name instead of squeezing it. */}
              <div style={{ flex: '1 1 170px', minWidth: 0 }}>
                <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {w.name}
                  {w.mode === 'creative' && <span style={tag('#d7c6ff', 'rgba(80,50,130,0.6)')}>CREATIVE</span>}
                  {w.mode === 'hideseek' && <span style={tag('#ffd9a8', 'rgba(130,90,46,0.6)')}>PROP HUNT</span>}
                  {w.mode === 'zombies' && <span style={tag('#ffb3a8', 'rgba(130,46,46,0.6)')}>ZOMBIES</span>}
                </div>
                <div style={{ fontSize: 12, opacity: 0.6 }}>
                  seed {w.seed}{w.map && MAPS[w.map] ? ` · ${MAPS[w.map].name}` : ''} · {fmtDate(w.lastPlayed)}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button style={mBtn} onClick={() => onPlay(w)}>Play</button>
                {onHost && (
                  <button style={mBtnBlue} disabled={netBusy} onClick={() => onHost(w, myName())}
                    title="Host this world so friends can join">Host</button>
                )}
                <button style={mBtnGrey} onClick={() => onDelete(w)} title="Delete world">✕</button>
              </div>
            </div>
          ))}
        </div>

        <div style={sectionLabel}>New world</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New world name"
            style={{ ...mInput, flex: 1 }}
            onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
          />
          <button style={mBtn} onClick={create}>Create</button>
        </div>
        {/* Game mode picker for the new world. */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {[
            ['survival', 'Survival', 'Mobs, mining, hunger & health'],
            ['creative', 'Creative', 'Infinite blocks, flight, no mobs'],
            ['hideseek', 'Prop Hunt', 'Hide as a block — or hunt the hiders'],
            ['zombies', 'Zombies', 'Co-op wave defense — build & survive'],
          ].map(([val, label, desc]) => {
            const accent = val === 'creative' ? '#5a3c8a' : val === 'hideseek' ? '#8a5a2e' : val === 'zombies' ? '#8a2e2e' : '#3c6b3c';
            return (
              <button key={val}
                onClick={() => {
                  setMode(val);
                  // Each arena mode has its own map list; snap the selection over.
                  if (val === 'zombies') setMap(ZOMBIE_MAP_LIST[0].id);
                  else if (val === 'hideseek') setMap(MAP_LIST[0].id);
                }}
                title={desc}
                style={choice(mode === val, accent)}>
                <div style={{ fontWeight: 700 }}>{label}</div>
                <div style={{ fontSize: 10, opacity: 0.75 }}>{desc}</div>
              </button>
            );
          })}
        </div>
        {/* Arena map picker (Prop Hunt / Zombies worlds). */}
        {(mode === 'hideseek' || mode === 'zombies') && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {(mode === 'zombies' ? ZOMBIE_MAP_LIST : MAP_LIST).map((m) => (
              <button key={m.id} onClick={() => setMap(m.id)} title={m.desc}
                style={choice(map === m.id, mode === 'zombies' ? '#8a2e2e' : '#8a5a2e')}>
                <div style={{ fontWeight: 700 }}>{m.name}</div>
                <div style={{ fontSize: 10, opacity: 0.75 }}>{m.desc}</div>
              </button>
            ))}
          </div>
        )}

        {onJoin && (
          <>
            <div style={sectionLabel}>
              Multiplayer
              <span style={{ fontWeight: 400, letterSpacing: 0, textTransform: 'none', fontSize: 12, opacity: 0.8 }}>
                {' '}— host a world above, or join a friend
              </span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Your name"
                maxLength={16}
                style={{ ...mInput, flex: '0 1 120px' }}
              />
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Room code"
                maxLength={5}
                style={{ ...mInput, flex: '1 1 96px', textTransform: 'uppercase', letterSpacing: 2 }}
                onKeyDown={(e) => { if (e.key === 'Enter' && joinCode.trim()) onJoin(joinCode.trim(), myName()); }}
              />
              <button style={mBtnBlue} disabled={netBusy}
                onClick={() => { if (joinCode.trim()) onJoin(joinCode.trim(), myName()); }}>
                {netBusy ? '…' : 'Join'}
              </button>
            </div>
            {netError && <div style={{ marginTop: 8, color: '#ff9b8a', fontSize: 13 }}>{netError}</div>}
          </>
        )}
      </div>
    </div>
  );
}

// In-game pause menu (shown when the mouse is released).
export function PauseMenu({ worldName, onResume, onSave, onQuit, justSaved, graphics, onGraphics }) {
  // Mirrors Game.graphics; the game applies the change live.
  const [quality, setQuality] = useState(graphics || 'high');
  const toggleQuality = () => {
    const next = quality === 'high' ? 'low' : 'high';
    setQuality(next);
    onGraphics(next);
  };
  return (
    <div style={overlay}>
      <div style={{ ...panel, minWidth: 300, textAlign: 'center' }}>
        <h2 style={{ fontSize: 24, marginBottom: 4 }}>Paused</h2>
        <div style={{ opacity: 0.6, marginBottom: 18 }}>{worldName}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button style={btn} onClick={onResume}>Resume</button>
          <button style={btnGrey} onClick={onSave}>{justSaved ? 'Saved!' : 'Save World'}</button>
          {onGraphics && (
            <button style={btnGrey} onClick={toggleQuality}
              title="High adds real-time sun and moon shadows; Low turns them off for speed">
              Graphics: {quality === 'high' ? 'High (shadows)' : 'Low (no shadows)'}
            </button>
          )}
          <button style={btnGrey} onClick={onQuit}>Save &amp; Quit to Menu</button>
        </div>
        <div style={{ marginTop: 16, fontSize: 12, opacity: 0.55, lineHeight: 1.7 }}>
          <div><b>WASD</b> move · <b>Mouse</b> look · <b>Space</b> jump/swim</div>
          <div><b>Left</b> mine/attack · <b>Right</b> place/use/eat · <b>E</b> inventory · <b>F</b> fly · <b>C</b> camera · <b>M</b> mute</div>
        </div>
      </div>
    </div>
  );
}
