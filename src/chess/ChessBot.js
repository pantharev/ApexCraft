import { legalMoves, applyMoveUnchecked, inCheck } from './ChessEngine.js';

// A built-in opponent: negamax + alpha-beta over the perft-verified move
// generator, with material + centre evaluation. Three strengths:
//   1 Easy   (~700):  depth 1, wide candidate window, occasional blunder
//   2 Medium (~1400): depth 2, small randomness among near-best moves
//   3 Hard   (~2000): depth 4 with capture-first ordering
// (Not actual Stockfish — a tiny dependency-free engine tuned to feel like
// those levels for casual play.)

export const BOT_LEVELS = { '#bot:1': 1, '#bot:2': 2, '#bot:3': 3 };
export const BOT_NAMES = { 1: 'Easy Bot (~700)', 2: 'Medium Bot (~1400)', 3: 'Hard Bot (~2000)' };
export const botId = (level) => `#bot:${level}`;

const VAL = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 0 };

// Small centre bonus (max at d4/e4/d5/e5), applied to knights/bishops/pawns.
const CENTER = new Array(64);
for (let i = 0; i < 64; i++) {
  const f = i & 7, r = i >> 3;
  CENTER[i] = 12 - 2 * (Math.abs(2 * f - 7) + Math.abs(2 * r - 7)) / 2;
}

function evaluate(board) {
  let score = 0;
  for (let i = 0; i < 64; i++) {
    const p = board[i];
    if (!p) continue;
    const sign = p[0] === 'w' ? 1 : -1;
    let v = VAL[p[1]];
    if (p[1] === 'N' || p[1] === 'B' || p[1] === 'P') v += CENTER[i];
    score += sign * v;
  }
  return score;
}

// All legal [from, to] pairs for the side to move, captures first (ordering
// makes alpha-beta prune far more).
function allMoves(state) {
  const quiet = [], caps = [];
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (!p || p[0] !== state.turn) continue;
    for (const to of legalMoves(state, i)) {
      (state.board[to] ? caps : quiet).push([i, to]);
    }
  }
  return caps.concat(quiet);
}

function negamax(state, depth, alpha, beta) {
  const moves = allMoves(state);
  if (!moves.length) return inCheck(state) ? -(100000 + depth) : 0; // mate sooner = better
  if (depth === 0) return (state.turn === 'w' ? 1 : -1) * evaluate(state.board);
  let best = -Infinity;
  for (const [from, to] of moves) {
    const v = -negamax(applyMoveUnchecked(state, from, to), depth - 1, -beta, -alpha);
    if (v > best) best = v;
    if (best > alpha) alpha = best;
    if (alpha >= beta) break;
  }
  return best;
}

// Choose the bot's move for the side to move, or null if the game is over.
export function pickMove(state, level) {
  const moves = allMoves(state);
  if (!moves.length) return null;

  // Easy blunders outright sometimes.
  if (level === 1 && Math.random() < 0.3) {
    const [from, to] = moves[(Math.random() * moves.length) | 0];
    return { from, to };
  }

  const depth = level === 1 ? 1 : level === 2 ? 2 : 4;
  const window = level === 1 ? 120 : level === 2 ? 40 : 10; // candidate spread (centipawns)

  let best = -Infinity;
  const scored = [];
  for (const [from, to] of moves) {
    const v = -negamax(applyMoveUnchecked(state, from, to), depth - 1, -Infinity, -best + window);
    scored.push({ from, to, v });
    if (v > best) best = v;
  }
  const candidates = scored.filter((m) => m.v >= best - window);
  const pick = candidates[(Math.random() * candidates.length) | 0];
  return { from: pick.from, to: pick.to };
}
