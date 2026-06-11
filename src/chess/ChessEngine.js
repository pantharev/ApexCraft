// A compact, dependency-free chess rules engine. Pure functions over a plain
// state object so it runs identically in the browser, on the multiplayer host,
// and in node tests.
//
// Board: array of 64, index = rank * 8 + file, rank 0 = white's back rank
// (a1 = 0, h8 = 63). Pieces are 2-char strings: colour 'w'|'b' + type
// 'P','N','B','R','Q','K'. Promotion is auto-queen (kept simple for the UI).

export function initialState() {
  const board = new Array(64).fill(null);
  const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (let f = 0; f < 8; f++) {
    board[f] = 'w' + back[f];
    board[8 + f] = 'wP';
    board[48 + f] = 'bP';
    board[56 + f] = 'b' + back[f];
  }
  return {
    board,
    turn: 'w',
    castle: { wK: true, wQ: true, bK: true, bQ: true },
    ep: -1,        // en-passant target square, or -1
    half: 0,       // halfmove clock (50-move rule)
    full: 1,
  };
}

const FILE = (i) => i & 7;
const RANK = (i) => i >> 3;
const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const idx = (f, r) => r * 8 + f;

const KNIGHT_D = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING_D = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK_D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP_D = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

// All squares attacked by `colour` (for check + castling-through-check tests).
export function isAttacked(board, square, byColour) {
  const f = FILE(square), r = RANK(square);
  // Pawns
  const pr = byColour === 'w' ? r - 1 : r + 1;
  for (const df of [-1, 1]) {
    if (onBoard(f + df, pr) && board[idx(f + df, pr)] === byColour + 'P') return true;
  }
  // Knights
  for (const [df, dr] of KNIGHT_D) {
    if (onBoard(f + df, r + dr) && board[idx(f + df, r + dr)] === byColour + 'N') return true;
  }
  // King
  for (const [df, dr] of KING_D) {
    if (onBoard(f + df, r + dr) && board[idx(f + df, r + dr)] === byColour + 'K') return true;
  }
  // Sliders
  for (const [df, dr] of ROOK_D) {
    let nf = f + df, nr = r + dr;
    while (onBoard(nf, nr)) {
      const p = board[idx(nf, nr)];
      if (p) { if (p[0] === byColour && (p[1] === 'R' || p[1] === 'Q')) return true; break; }
      nf += df; nr += dr;
    }
  }
  for (const [df, dr] of BISHOP_D) {
    let nf = f + df, nr = r + dr;
    while (onBoard(nf, nr)) {
      const p = board[idx(nf, nr)];
      if (p) { if (p[0] === byColour && (p[1] === 'B' || p[1] === 'Q')) return true; break; }
      nf += df; nr += dr;
    }
  }
  return false;
}

const kingSquare = (board, colour) => board.indexOf(colour + 'K');

export function inCheck(state, colour = state.turn) {
  return isAttacked(state.board, kingSquare(state.board, colour), colour === 'w' ? 'b' : 'w');
}

// Pseudo-legal destination squares for the piece on `from` (no self-check test).
function pseudoMoves(state, from) {
  const { board, castle, ep } = state;
  const piece = board[from];
  if (!piece) return [];
  const colour = piece[0], type = piece[1];
  const f = FILE(from), r = RANK(from);
  const out = [];
  const push = (nf, nr) => { if (onBoard(nf, nr)) out.push(idx(nf, nr)); };

  if (type === 'P') {
    const dir = colour === 'w' ? 1 : -1;
    const start = colour === 'w' ? 1 : 6;
    if (onBoard(f, r + dir) && !board[idx(f, r + dir)]) {
      push(f, r + dir);
      if (r === start && !board[idx(f, r + 2 * dir)]) push(f, r + 2 * dir);
    }
    for (const df of [-1, 1]) {
      if (!onBoard(f + df, r + dir)) continue;
      const t = idx(f + df, r + dir);
      if ((board[t] && board[t][0] !== colour) || t === ep) out.push(t);
    }
  } else if (type === 'N') {
    for (const [df, dr] of KNIGHT_D) {
      if (!onBoard(f + df, r + dr)) continue;
      const t = idx(f + df, r + dr);
      if (!board[t] || board[t][0] !== colour) out.push(t);
    }
  } else if (type === 'K') {
    for (const [df, dr] of KING_D) {
      if (!onBoard(f + df, r + dr)) continue;
      const t = idx(f + df, r + dr);
      if (!board[t] || board[t][0] !== colour) out.push(t);
    }
    // Castling: rights intact, path empty, not through/into/out of check.
    const enemy = colour === 'w' ? 'b' : 'w';
    const home = colour === 'w' ? 0 : 56;
    if (from === home + 4 && !isAttacked(board, from, enemy)) {
      if (castle[colour + 'K'] && !board[home + 5] && !board[home + 6] &&
          !isAttacked(board, home + 5, enemy) && !isAttacked(board, home + 6, enemy) &&
          board[home + 7] === colour + 'R') {
        out.push(home + 6);
      }
      if (castle[colour + 'Q'] && !board[home + 3] && !board[home + 2] && !board[home + 1] &&
          !isAttacked(board, home + 3, enemy) && !isAttacked(board, home + 2, enemy) &&
          board[home] === colour + 'R') {
        out.push(home + 2);
      }
    }
  } else {
    const dirs = type === 'R' ? ROOK_D : type === 'B' ? BISHOP_D : [...ROOK_D, ...BISHOP_D];
    for (const [df, dr] of dirs) {
      let nf = f + df, nr = r + dr;
      while (onBoard(nf, nr)) {
        const t = idx(nf, nr);
        if (!board[t]) out.push(t);
        else { if (board[t][0] !== colour) out.push(t); break; }
        nf += df; nr += dr;
      }
    }
  }
  return out;
}

// Apply a move WITHOUT legality checks; returns a new state.
function applyRaw(state, from, to) {
  const board = state.board.slice();
  const piece = board[from];
  const colour = piece[0], type = piece[1];
  const castle = { ...state.castle };
  let ep = -1;
  let half = state.half + 1;

  if (board[to] || type === 'P') half = 0;

  // En passant capture: the pawn being taken sits behind the target square.
  if (type === 'P' && to === state.ep && !board[to]) {
    board[to + (colour === 'w' ? -8 : 8)] = null;
  }
  // Double push opens an en-passant square.
  if (type === 'P' && Math.abs(RANK(to) - RANK(from)) === 2) {
    ep = from + (colour === 'w' ? 8 : -8);
  }
  // Castling moves the rook too.
  if (type === 'K' && Math.abs(FILE(to) - FILE(from)) === 2) {
    const home = colour === 'w' ? 0 : 56;
    if (to === home + 6) { board[home + 5] = board[home + 7]; board[home + 7] = null; }
    else { board[home + 3] = board[home]; board[home] = null; }
  }
  // Rights expire when king/rooks move or rooks are captured.
  if (type === 'K') { castle[colour + 'K'] = false; castle[colour + 'Q'] = false; }
  for (const [sq, key] of [[0, 'wQ'], [7, 'wK'], [56, 'bQ'], [63, 'bK']]) {
    if (from === sq || to === sq) castle[key] = false;
  }

  board[to] = piece;
  board[from] = null;
  // Promotion (auto-queen).
  if (type === 'P' && (RANK(to) === 7 || RANK(to) === 0)) board[to] = colour + 'Q';

  return {
    board,
    turn: colour === 'w' ? 'b' : 'w',
    castle,
    ep,
    half,
    full: state.full + (colour === 'b' ? 1 : 0),
  };
}

// Legal destination squares for the piece on `from` in the side-to-move's hand.
export function legalMoves(state, from) {
  const piece = state.board[from];
  if (!piece || piece[0] !== state.turn) return [];
  return pseudoMoves(state, from).filter((to) => !inCheck(applyRaw(state, from, to), state.turn));
}

// Does the side to move have any legal move at all?
function hasMoves(state) {
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (p && p[0] === state.turn && legalMoves(state, i).length) return true;
  }
  return false;
}

// 'playing' | 'check' | 'checkmate' | 'stalemate' | 'draw' (50-move).
export function status(state) {
  const check = inCheck(state);
  if (!hasMoves(state)) return check ? 'checkmate' : 'stalemate';
  if (state.half >= 100) return 'draw';
  return check ? 'check' : 'playing';
}

// Validated move. Returns the new state or null if illegal.
export function makeMove(state, from, to) {
  if (!legalMoves(state, from).includes(to)) return null;
  return applyRaw(state, from, to);
}

// "e4"-style square name for UI labels.
export const squareName = (i) => 'abcdefgh'[FILE(i)] + (RANK(i) + 1);
