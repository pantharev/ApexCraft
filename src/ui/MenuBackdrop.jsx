import React, { useEffect, useRef, useState } from 'react';
import { Backdrop } from '../core/Backdrop.js';

const DEV = typeof location !== 'undefined' && ['localhost', '127.0.0.1'].includes(location.hostname);

// What the menus stand in front of: a live flight over generated terrain
// (core/Backdrop.js). Shared look for the screens that sit on it is below.
//
// The plain gradient is always there underneath. The flyover starts a frame
// after the menu has painted — it is decoration, and must never hold up the
// first frame of the UI — and fades in once it has a world to show. If WebGL
// is unavailable the gradient simply stays.
export function MenuBackdrop() {
  const hostRef = useRef(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let backdrop = null;
    const id = requestAnimationFrame(() => {
      try {
        backdrop = new Backdrop(hostRef.current);
        backdrop.onReady = () => setShown(true);
        backdrop.onLost = () => setShown(false); // back to the plain gradient
        backdrop.start();
        if (DEV) window.__backdrop = backdrop; // debug handle on localhost only
      } catch (err) {
        console.warn('[menu] no live backdrop:', err);
      }
    });
    return () => {
      cancelAnimationFrame(id);
      if (backdrop) backdrop.dispose();
      if (DEV && window.__backdrop === backdrop) window.__backdrop = null;
    };
  }, []);

  return (
    <>
      <div style={{
        position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none',
        background: 'linear-gradient(180deg, #0a1430 0%, #16386b 45%, #2f6db0 100%)',
      }} />
      <div ref={hostRef} style={{
        position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'none', overflow: 'hidden',
        opacity: shown ? 1 : 0, transition: 'opacity 1.6s ease',
      }} />
    </>
  );
}

// --- Shared look of the menu screens -------------------------------------------

export const MENU_FONT = "'Trebuchet MS', 'Segoe UI', system-ui, sans-serif";

// A wash over the backdrop that keeps text readable: darker at the top and
// bottom, where the words are, and nearly clear across the middle, where the
// world is.
export const SHADE = 'linear-gradient(180deg, rgba(5,10,24,0.5) 0%, rgba(5,10,24,0.12) 32%, rgba(5,10,24,0.14) 60%, rgba(5,10,24,0.68) 100%)';

// A dark, slightly see-through card.
export const card = {
  background: 'rgba(9,14,26,0.58)', border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
};

// The wordmark: chunky letters with a stepped drop, like a row of blocks seen
// from slightly above.
const step = (a, b, c) => `0 2px 0 ${a}, 0 4px 0 ${b}, 0 6px 0 ${c}, 0 8px 0 rgba(0,0,0,0.35), 0 14px 28px rgba(0,0,0,0.55)`;
export function Wordmark({ size = 64 }) {
  return (
    <h1 style={{
      font: `900 ${typeof size === 'number' ? `${size}px` : size}/1 ${MENU_FONT}`,
      letterSpacing: '0.04em', margin: 0, color: '#f4f8ff',
    }}>
      <span style={{ textShadow: step('#b8c6dc', '#8496b3', '#55677f') }}>Apex</span>
      <span style={{ color: '#86d667', textShadow: step('#5fae45', '#43852f', '#2c5c1f') }}>Craft</span>
    </h1>
  );
}
