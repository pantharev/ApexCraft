import React from 'react';

// In-app landing / title screen shown before the world menu. A self-contained
// hero with a Play call-to-action. (Can be replaced later by a standalone
// designed landing page — just point its Play button at the same onPlay.)

const FEATURES = [
  ['Explore', 'Procedural biomes, oceans, caves & forests'],
  ['Build', 'Mine, craft tools, smelt ores, place blocks'],
  ['Survive', 'Hunger, day/night, and mobs that hunt at dark'],
  ['Persist', 'Multiple worlds, auto-saved in your browser'],
  ['Feel it', 'Synthesized sound & a living world'],
  ['Anywhere', 'Plays on desktop and mobile'],
];

export function Landing({ onPlay }) {
  return (
    <div style={{
      position: 'absolute', inset: 0, overflowY: 'auto', zIndex: 5,
      background: 'linear-gradient(180deg, #0a1430 0%, #16386b 45%, #2f6db0 100%)',
      color: '#eaf2ff', font: '16px system-ui', display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '40px 20px',
    }}>
      <div style={{ flex: 1 }} />

      <h1 style={{ fontSize: 64, letterSpacing: 4, margin: 0, textShadow: '0 4px 20px rgba(0,0,0,0.5)' }}>
        Apex<span style={{ color: '#7ec860' }}>Craft</span>
      </h1>
      <p style={{ fontSize: 19, opacity: 0.9, marginTop: 10, marginBottom: 28 }}>
        A voxel survival sandbox in your browser. Mine, craft, build, and survive.
      </p>

      <button
        onClick={onPlay}
        style={{
          font: 'bold 22px system-ui', padding: '14px 48px', cursor: 'pointer', color: '#fff',
          background: '#3c8b3c', border: '3px solid #235123', borderRadius: 8,
          boxShadow: '0 6px 18px rgba(0,0,0,0.4)', letterSpacing: 1,
        }}
      >▶ Play</button>
      <div style={{ fontSize: 13, opacity: 0.7, marginTop: 10 }}>No install · free · works on phones</div>

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 14,
        maxWidth: 760, marginTop: 40, width: '100%',
      }}>
        {FEATURES.map(([title, desc]) => (
          <div key={title} style={{
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 10, padding: '14px 16px', textAlign: 'left',
          }}>
            <div style={{ fontWeight: 700, color: '#9fe084', marginBottom: 4 }}>{title}</div>
            <div style={{ fontSize: 14, opacity: 0.85 }}>{desc}</div>
          </div>
        ))}
      </div>

      <div style={{ flex: 1 }} />

      <div style={{ marginTop: 40, fontSize: 13, opacity: 0.65 }}>
        Pre-alpha · Built with React + Three.js ·{' '}
        <a href="https://github.com/pantharev/ApexCraft" target="_blank" rel="noreferrer"
          style={{ color: '#bcd6ff' }}>GitHub</a>
      </div>
    </div>
  );
}
