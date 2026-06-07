import React, { useState } from 'react';

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

// Title screen: pick an existing world or create a new one.
export function MainMenu({ worlds, onPlay, onCreate, onDelete, onHome }) {
  const [name, setName] = useState('');

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
                <div style={{ fontWeight: 600 }}>{w.name}</div>
                <div style={{ fontSize: 12, opacity: 0.55 }}>seed {w.seed} · {fmtDate(w.lastPlayed)}</div>
              </div>
              <button style={btn} onClick={() => onPlay(w)}>Play</button>
              <button style={btnGrey} onClick={() => onDelete(w)} title="Delete world">✕</button>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New world name"
            style={{ flex: 1, padding: '8px 10px', borderRadius: 4, border: '1px solid #444', background: '#111', color: '#eee', font: '15px system-ui' }}
            onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) { onCreate(name.trim()); setName(''); } }}
          />
          <button style={btn} onClick={() => { if (name.trim()) { onCreate(name.trim()); setName(''); } }}>Create</button>
        </div>
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
