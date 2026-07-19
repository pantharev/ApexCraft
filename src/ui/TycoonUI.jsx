import React, { useEffect, useRef, useState } from 'react';
import { TycoonMode, MAX_WORKERS } from '../systems/TycoonMode.js';

// Tycoon HUD. Purely informational — every purchase happens in-world at the
// plot's wall pads (right-click), Roblox style, so there is no shop overlay
// and nothing here needs clicking. Reads the plot state pushed by TycoonMode
// through game.onMatch.

const wrap = { position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 22, color: '#fff', fontFamily: 'system-ui' };
const shadow = { textShadow: '1px 1px 2px #000' };

export function TycoonHUD({ game, match }) {
  const selfId = game?.tycoonMode ? game.tycoonMode.selfId : 'self';
  const plots = match?.plots || [];
  const mineIdx = plots.findIndex((p) => p.owner === selfId);
  const mine = mineIdx >= 0 ? plots[mineIdx] : null;

  // Money delta floater: remember the last seen balance, float the difference.
  const prevMoney = useRef(null);
  const [floater, setFloater] = useState(null); // { amount, key }
  useEffect(() => {
    if (!mine) { prevMoney.current = null; return; }
    if (prevMoney.current != null && mine.money > prevMoney.current) {
      setFloater({ amount: mine.money - prevMoney.current, key: Date.now() });
    }
    prevMoney.current = mine.money;
  }, [mine?.money]);

  return (
    <div style={wrap}>
      {mine ? (
        <>
          <div style={{ position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)', textAlign: 'center' }}>
            <div style={{ display: 'inline-block', background: 'rgba(15,17,22,0.7)', padding: '6px 22px', borderRadius: 16, ...shadow }}>
              <span style={{ fontSize: 24, fontWeight: 800, color: '#ffe08a', fontVariantNumeric: 'tabular-nums' }}>
                $ {mine.money.toLocaleString()}
              </span>
              {floater && (
                <span key={floater.key} style={{
                  position: 'absolute', left: '100%', marginLeft: 8, top: 4, whiteSpace: 'nowrap',
                  color: '#9fe084', fontWeight: 700, ...shadow,
                  animation: 'tycoonFloat 1.2s ease-out forwards',
                }}>
                  +${floater.amount}
                </span>
              )}
            </div>
            <div style={{ marginTop: 6, display: 'inline-block', background: 'rgba(15,17,22,0.55)', padding: '4px 14px', borderRadius: 12, fontSize: 13, ...shadow }}>
              🏭 Mill T{mine.mill} · 🪓 Workers {mine.workers}/{MAX_WORKERS} · 🏠 House {mine.house > 0 ? `T${mine.house}` : '—'}
            </div>
          </div>

          {/* Next-purchase hints so the wall pads' prices are known on sight. */}
          <div style={{ position: 'absolute', bottom: 26, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 14, background: 'rgba(15,17,22,0.6)', padding: '5px 16px', borderRadius: 12, fontSize: 13, ...shadow }}>
            <Hint icon="🪓" label="Worker" cost={TycoonMode.nextCost(mine, 'worker')} />
            <Hint icon="🏭" label="Mill" cost={TycoonMode.nextCost(mine, 'mill')} />
            <Hint icon="🏠" label="House" cost={TycoonMode.nextCost(mine, 'house')} />
          </div>
        </>
      ) : (
        <div style={{ position: 'absolute', top: '32%', left: '50%', transform: 'translate(-50%,-50%)', textAlign: 'center', textShadow: '2px 2px 3px #000' }}>
          <div style={{ fontSize: 42, fontWeight: 800, letterSpacing: 2 }}>TYCOON</div>
          <div style={{ fontSize: 16, opacity: 0.9, marginTop: 6 }}>
            Workers chop, mills pay, mansions rise.
          </div>
          <div style={{ fontSize: 18, marginTop: 18, padding: '8px 18px', background: 'rgba(138,116,46,0.8)', borderRadius: 10, display: 'inline-block', animation: 'tycoonPulse 1.6s ease-in-out infinite' }}>
            ⭐ Walk onto a golden pad to claim your plot!
          </div>
        </div>
      )}

      {/* Other players' plots, tucked into the corner. */}
      {plots.some((p, i) => i !== mineIdx && p.mill > 0) && (
        <div style={{ position: 'absolute', top: 10, right: 12, background: 'rgba(15,17,22,0.55)', padding: '6px 12px', borderRadius: 10, fontSize: 12, ...shadow }}>
          {plots.map((p, i) => (i === mineIdx || p.mill === 0) ? null : (
            <div key={i} style={{ opacity: p.owner ? 1 : 0.5 }}>
              {p.ownerName || 'Player'}{p.owner ? '' : ' (away)'} · ${p.money.toLocaleString()} · T{p.mill}
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes tycoonFloat {
          from { transform: translateY(0); opacity: 1; }
          to { transform: translateY(-26px); opacity: 0; }
        }
        @keyframes tycoonPulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.05); }
        }
      `}</style>
    </div>
  );
}

function Hint({ icon, label, cost }) {
  return (
    <span style={{ opacity: cost == null ? 0.45 : 1 }}>
      {icon} {label}: {cost == null ? 'MAX' : <b style={{ color: '#ffe08a' }}>${cost}</b>}
    </span>
  );
}
