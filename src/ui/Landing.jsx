import React, { useState } from 'react';
import { Changelog } from './Changelog.jsx';
import { MENU_FONT, SHADE, card, Wordmark } from './MenuBackdrop.jsx';

// In-app landing / title screen shown before the world menu: the wordmark and
// a Play call-to-action over the live backdrop (ui/MenuBackdrop.jsx), with the
// feature list tucked along the bottom so the world stays in view.

const FEATURES = [
  ['Explore', 'Procedural biomes, oceans, caves & forests'],
  ['Build', 'Mine, craft tools, smelt ores, place blocks'],
  ['Survive', 'Hunger, day/night, and mobs that hunt at dark'],
  ['Persist', 'Multiple worlds, auto-saved in your browser'],
  ['Feel it', 'Synthesized sound & a living world'],
  ['Anywhere', 'Plays on desktop and mobile'],
];

const softShadow = '0 2px 10px rgba(0,0,0,0.75)';

export function Landing({ onPlay }) {
  const [showLog, setShowLog] = useState(false);
  const [hot, setHot] = useState(false); // pointer over Play
  if (showLog) return <Changelog onClose={() => setShowLog(false)} />;
  return (
    <div style={{
      position: 'absolute', inset: 0, overflowY: 'auto', zIndex: 5, background: SHADE,
      color: '#eaf2ff', font: `16px ${MENU_FONT}`, display: 'flex', flexDirection: 'column',
      alignItems: 'center', textAlign: 'center', padding: '28px 20px 18px', boxSizing: 'border-box',
    }}>
      <div style={{ flex: 1, minHeight: 12 }} />

      <Wordmark size="clamp(46px, 10vw, 104px)" />
      <p style={{ fontSize: 'clamp(15px, 2.2vw, 20px)', margin: '22px 0 30px', textShadow: softShadow }}>
        A voxel survival sandbox in your browser. Mine, craft, build, and survive.
      </p>

      <button
        onClick={onPlay}
        onMouseEnter={() => setHot(true)}
        onMouseLeave={() => setHot(false)}
        style={{
          font: `bold 24px ${MENU_FONT}`, padding: '15px 64px', cursor: 'pointer', color: '#fff',
          background: hot ? '#4aa64a' : '#3f943f', border: '2px solid #1f4a1f', borderRadius: 10,
          boxShadow: hot
            ? 'inset 0 2px 0 rgba(255,255,255,0.3), 0 3px 0 #1f4a1f, 0 10px 22px rgba(0,0,0,0.45)'
            : 'inset 0 2px 0 rgba(255,255,255,0.25), 0 6px 0 #1f4a1f, 0 14px 28px rgba(0,0,0,0.45)',
          transform: hot ? 'translateY(3px)' : 'none', transition: 'transform 80ms, box-shadow 80ms, background 80ms',
          letterSpacing: 1, textShadow: '0 2px 0 rgba(0,0,0,0.35)',
        }}
      >▶ Play</button>
      <div style={{ fontSize: 13, marginTop: 20, textShadow: softShadow }}>
        No install · free · works on phones
      </div>

      <button
        onClick={() => setShowLog(true)}
        style={{
          ...card, font: `bold 14px ${MENU_FONT}`, padding: '8px 22px', cursor: 'pointer', color: '#eaf2ff',
          borderRadius: 8, marginTop: 14,
        }}
      >★ What&apos;s New</button>

      <div style={{ flex: 1.4, minHeight: 24 }} />

      <div style={{
        // Three across on a desktop, two on a phone — never a tall single
        // column that would cover the world behind.
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(max(140px, 30%), 1fr))', gap: 10,
        maxWidth: 780, width: '100%',
      }}>
        {FEATURES.map(([title, desc]) => (
          <div key={title} style={{ ...card, padding: '10px 14px', textAlign: 'left' }}>
            <div style={{ fontWeight: 700, color: '#9fe084', marginBottom: 2 }}>{title}</div>
            <div style={{ fontSize: 13.5, opacity: 0.88 }}>{desc}</div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, fontSize: 13, opacity: 0.8, textShadow: softShadow }}>
        Pre-alpha · Built with React + Three.js ·{' '}
        <a href="https://github.com/pantharev/ApexCraft" target="_blank" rel="noreferrer"
          style={{ color: '#bcd6ff' }}>GitHub</a>
      </div>
    </div>
  );
}
