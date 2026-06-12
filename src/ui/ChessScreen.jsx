import React, { useEffect, useState } from 'react';
import { BOT_LEVELS, BOT_NAMES } from '../chess/ChessBot.js';

// The chess table screen: a lichess-style 2D board floating over the world
// (the backdrop stays mostly transparent on purpose). Click/tap a piece to
// see its legal moves, click a target to play. First two openers hold the
// seats; everyone else spectates live — or seat a bot (Easy/Medium/Hard).

const GLYPH = { P: '♟', N: '♞', B: '♝', R: '♜', Q: '♛', K: '♚' };
const LIGHT = '#f0d9b5', DARK = '#b58863';
const SEL = 'rgba(106,170,100,0.75)', LAST = 'rgba(205,210,106,0.6)';

const isBot = (id) => typeof id === 'string' && id.startsWith('#bot:');
const botName = (id) => BOT_NAMES[BOT_LEVELS[id]] || 'Bot';

function seatLabel(view, myId) {
  if (isBot(view.black) && view.white === myId) return `You play White vs ${botName(view.black)}`;
  if (view.white === myId && view.black === myId) return 'Hotseat — you play both sides';
  if (view.white === myId) return 'You play White';
  if (view.black === myId) return 'You play Black';
  return 'Spectating';
}

function statusLabel(view) {
  const side = view.turn === 'w' ? 'White' : 'Black';
  if (view.status === 'checkmate') return `Checkmate — ${view.turn === 'w' ? 'Black' : 'White'} wins!`;
  if (view.status === 'stalemate') return 'Stalemate — draw';
  if (view.status === 'draw') return 'Draw (50-move rule)';
  if (view.status === 'check') return `${side} to move — check!`;
  if (view.turn === 'b' && isBot(view.black)) return 'Bot is thinking…';
  return `${side} to move`;
}

export function ChessScreen({ game }) {
  // The first view is pushed before this screen mounts, so read it directly
  // (waiting only for the callback was the "setting up the board…" hang).
  const [view, setView] = useState(game.chessView);
  const [selected, setSelected] = useState(-1);
  const [targets, setTargets] = useState([]);

  useEffect(() => {
    game.onChess = setView;
    setView(game.chessView); // catch anything pushed between render and mount
    return () => { game.onChess = null; game.activeChessKey = null; game.chessView = null; };
  }, [game]);

  if (!view) {
    return (
      <div style={{ position: 'absolute', inset: 0, zIndex: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
        <div style={{ color: '#fff', font: '16px system-ui', textShadow: '1px 1px 2px #000' }}>Setting up the board…</div>
      </div>
    );
  }

  const myId = game._chessId();
  const mySeat = view.white === myId || view.black === myId;
  const over = view.status === 'checkmate' || view.status === 'stalemate' || view.status === 'draw';
  // Black-seated players see the board from their side.
  const flipped = view.black === myId && view.white !== myId;

  const tap = (sq) => {
    if (over) return;
    if (targets.includes(sq)) {
      game.chessMove(selected, sq);
      setSelected(-1);
      setTargets([]);
      return;
    }
    const piece = view.board[sq];
    if (piece && piece[0] === view.turn) {
      const t = game.chessLegalTargets(view, sq);
      setSelected(t.length ? sq : -1);
      setTargets(t);
    } else {
      setSelected(-1);
      setTargets([]);
    }
  };

  const size = 'min(86vw, 62vh, 440px)';
  const squares = [];
  for (let row = 0; row < 8; row++) {       // screen rows top -> bottom
    for (let col = 0; col < 8; col++) {
      const rank = flipped ? row : 7 - row; // board rank for this screen row
      const file = flipped ? 7 - col : col;
      squares.push(rank * 8 + file);
    }
  }

  return (
    <div style={{
      position: 'absolute', inset: 0, zIndex: 12,
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      background: 'rgba(8,10,16,0.25)', // the world stays visible behind the board
    }}>
      <div style={{
        background: 'rgba(24,22,20,0.92)', borderRadius: 10, padding: 14,
        boxShadow: '0 10px 40px rgba(0,0,0,0.6)', border: '1px solid #4a4038',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 16 }}>
          <span style={{ color: '#f0e6d8', font: 'bold 15px system-ui' }}>{statusLabel(view)}</span>
          <span style={{ color: '#b8a890', font: '12px system-ui' }}>{seatLabel(view, myId)}</span>
        </div>

        <div style={{
          width: size, height: size,
          display: 'grid', gridTemplateColumns: 'repeat(8, 1fr)', gridTemplateRows: 'repeat(8, 1fr)',
          border: '3px solid #4a4038', borderRadius: 3, overflow: 'hidden', touchAction: 'manipulation',
        }}>
          {squares.map((sq, i) => {
            const piece = view.board[sq];
            const lightSq = ((sq >> 3) + (sq & 7)) % 2 === 1;
            const isLast = view.last && (view.last[0] === sq || view.last[1] === sq);
            return (
              <div key={i} onPointerDown={(e) => { e.preventDefault(); tap(sq); }}
                style={{
                  background: lightSq ? LIGHT : DARK,
                  position: 'relative', cursor: 'pointer', userSelect: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: sq === selected ? `inset 0 0 0 99px ${SEL}` : isLast ? `inset 0 0 0 99px ${LAST}` : 'none',
                }}>
                {piece && (
                  <span style={{
                    fontSize: `calc(${size} / 8 * 0.78)`, lineHeight: 1,
                    color: piece[0] === 'w' ? '#fafafa' : '#1c1a18',
                    textShadow: piece[0] === 'w'
                      ? '0 0 2px #000, 0 1.5px 1.5px rgba(0,0,0,0.7)'
                      : '0 0 2px rgba(255,255,255,0.35)',
                  }}>{GLYPH[piece[1]]}</span>
                )}
                {targets.includes(sq) && (
                  <span style={{
                    position: 'absolute',
                    width: piece ? '88%' : '30%', height: piece ? '88%' : '30%',
                    borderRadius: '50%',
                    border: piece ? '4px solid rgba(40,90,40,0.75)' : 'none',
                    background: piece ? 'transparent' : 'rgba(40,90,40,0.55)',
                    pointerEvents: 'none',
                  }} />
                )}
              </div>
            );
          })}
        </div>

        {/* Opponent picker: a friend takes the open seat, or seat a bot. */}
        {mySeat && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ color: '#8a7d6c', font: '12px system-ui' }}>Opponent:</span>
            <button onClick={() => game.chessBot(0)} style={btn(isBot(view.black) ? '#444' : '#3c6b3c', 12)}>
              👤 Player
            </button>
            {[1, 2, 3].map((lv) => (
              <button key={lv} onClick={() => game.chessBot(lv)}
                style={btn(view.black === `#bot:${lv}` ? '#3c6b3c' : '#444', 12)}>
                🤖 {['', 'Easy', 'Medium', 'Hard'][lv]}
              </button>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, gap: 10 }}>
          <span style={{ color: '#8a7d6c', font: '12px system-ui', alignSelf: 'center' }}>
            ♙ {view.white ? 'seated' : 'open seat'} · ♟ {isBot(view.black) ? botName(view.black) : view.black ? 'seated' : 'open seat'}
          </span>
          <div style={{ display: 'flex', gap: 8 }}>
            {(mySeat || over) && (
              <button onClick={() => { game.chessReset(); setSelected(-1); setTargets([]); }} style={btn('#5a4a8a')}>
                {over ? 'New game' : 'Reset'}
              </button>
            )}
            <button onClick={() => game.setScreen(null)} style={btn('#555')}>✕ Close</button>
          </div>
        </div>
      </div>
    </div>
  );
}

const btn = (bg, size = 13) => ({
  font: `bold ${size}px system-ui`, padding: size < 13 ? '6px 10px' : '8px 14px', cursor: 'pointer',
  background: bg, color: '#fff', border: '1px solid rgba(0,0,0,0.4)', borderRadius: 5,
});
