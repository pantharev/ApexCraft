import React, { useState } from 'react';
import { MAPS, MAP_LIST } from '../world/arenas/index.js';

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
const btnBlue = { ...btn, background: '#2e5d8e', border: '2px solid #1c3a59' };

// Title screen: pick an existing world or create a new one. Worlds can also be
// hosted for friends (multiplayer), or you can join a friend's room by code.
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

  return (
    <div style={overlay}>
      <div style={panel}>
        <h1 style={{ fontSize: 34, letterSpacing: 2, marginBottom: 4, textAlign: 'center' }}>ApexCraft</h1>
        <div style={{ opacity: 0.6, textAlign: 'center', marginBottom: 18 }}>
          Select a world{onHome && (
            <> · <span onClick={onHome} style={{ cursor: 'pointer', color: '#8fb6ff' }}>Home</span></>
          )}
        </div>

        <div style={{ maxHeight: 240, overflowY: 'auto', marginBottom: 16 }}>
          {worlds.length === 0 && <div style={{ opacity: 0.6, textAlign: 'center', padding: 12 }}>No worlds yet — create one below.</div>}
          {worlds.map((w) => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #2a2d33' }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600 }}>
                  {w.name}
                  {w.mode === 'creative' && (
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#d7c6ff', background: 'rgba(80,50,130,0.5)', padding: '1px 6px', borderRadius: 8, letterSpacing: 0.5 }}>CREATIVE</span>
                  )}
                  {w.mode === 'hideseek' && (
                    <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: '#ffd9a8', background: 'rgba(130,90,46,0.5)', padding: '1px 6px', borderRadius: 8, letterSpacing: 0.5 }}>PROP HUNT</span>
                  )}
                </div>
                <div style={{ fontSize: 12, opacity: 0.55 }}>
                  seed {w.seed}{w.map && MAPS[w.map] ? ` · ${MAPS[w.map].name}` : ''} · {fmtDate(w.lastPlayed)}
                </div>
              </div>
              <button style={btn} onClick={() => onPlay(w)}>Play</button>
              {onHost && (
                <button style={btnBlue} disabled={netBusy} onClick={() => onHost(w, myName())}
                  title="Host this world so friends can join">Host</button>
              )}
              <button style={btnGrey} onClick={() => onDelete(w)} title="Delete world">✕</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New world name"
            style={{ ...input, flex: 1 }}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { onCreate(name.trim(), mode, map); setName(''); } }}
          />
          <button style={btn} onClick={() => { if (name.trim()) { onCreate(name.trim(), mode, map); setName(''); } }}>Create</button>
        </div>
        {/* Game mode picker for the new world. */}
        <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
          {[
            ['survival', 'Survival', 'Mobs, mining, hunger & health'],
            ['creative', 'Creative', 'Infinite blocks, flight, no mobs'],
            ['hideseek', 'Prop Hunt', 'Hide as a block — or hunt the hiders'],
          ].map(([val, label, desc]) => {
            const accent = val === 'creative' ? '#5a3c8a' : val === 'hideseek' ? '#8a5a2e' : '#3c6b3c';
            return (
              <button key={val} onClick={() => setMode(val)} title={desc}
                style={{
                  flex: 1, font: '13px system-ui', padding: '7px 8px', cursor: 'pointer', borderRadius: 4,
                  background: mode === val ? accent : '#2a2d33',
                  color: mode === val ? '#fff' : '#9aa', textAlign: 'center',
                  border: mode === val ? '2px solid #fff5' : '2px solid #3a3d44',
                }}>
                <div style={{ fontWeight: 700 }}>{label}</div>
                <div style={{ fontSize: 10, opacity: 0.75 }}>{desc}</div>
              </button>
            );
          })}
        </div>
        {/* Arena map picker (Prop Hunt worlds only). */}
        {mode === 'hideseek' && (
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            {MAP_LIST.map((m) => (
              <button key={m.id} onClick={() => setMap(m.id)} title={m.desc}
                style={{
                  flex: 1, font: '13px system-ui', padding: '7px 8px', cursor: 'pointer', borderRadius: 4,
                  background: map === m.id ? '#8a5a2e' : '#2a2d33',
                  color: map === m.id ? '#fff' : '#9aa', textAlign: 'center',
                  border: map === m.id ? '2px solid #fff5' : '2px solid #3a3d44',
                }}>
                <div style={{ fontWeight: 700 }}>{m.name}</div>
                <div style={{ fontSize: 10, opacity: 0.75 }}>{m.desc}</div>
              </button>
            ))}
          </div>
        )}

        {onJoin && (
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid #2a2d33' }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              Multiplayer
              <span style={{ fontWeight: 400, opacity: 0.55 }}> — host a world above, or join a friend</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Your name"
                maxLength={16}
                style={{ ...input, width: 110 }}
              />
              <input
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                placeholder="Room code"
                maxLength={5}
                style={{ ...input, flex: 1, textTransform: 'uppercase', letterSpacing: 2 }}
                onKeyDown={(e) => { if (e.key === 'Enter' && joinCode.trim()) onJoin(joinCode.trim(), myName()); }}
              />
              <button style={btnBlue} disabled={netBusy}
                onClick={() => { if (joinCode.trim()) onJoin(joinCode.trim(), myName()); }}>
                {netBusy ? '…' : 'Join'}
              </button>
            </div>
            {netError && <div style={{ marginTop: 8, color: '#ff9b8a', fontSize: 13 }}>{netError}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// In-game pause menu (shown when the mouse is released).
export function PauseMenu({ worldName, onResume, onSave, onQuit, justSaved }) {
  return (
    <div style={overlay}>
      <div style={{ ...panel, minWidth: 300, textAlign: 'center' }}>
        <h2 style={{ fontSize: 24, marginBottom: 4 }}>Paused</h2>
        <div style={{ opacity: 0.6, marginBottom: 18 }}>{worldName}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button style={btn} onClick={onResume}>Resume</button>
          <button style={btnGrey} onClick={onSave}>{justSaved ? 'Saved!' : 'Save World'}</button>
          <button style={btnGrey} onClick={onQuit}>Save &amp; Quit to Menu</button>
        </div>
        <div style={{ marginTop: 16, fontSize: 12, opacity: 0.55, lineHeight: 1.7 }}>
          <div><b>WASD</b> move · <b>Mouse</b> look · <b>Space</b> jump/swim</div>
          <div><b>Left</b> mine/attack · <b>Right</b> place/use/eat · <b>E</b> inventory · <b>F</b> fly · <b>M</b> mute</div>
        </div>
      </div>
    </div>
  );
}
