// Chess engine correctness tests (run in CI: node src/chess/engineTest.js).
// perft node counts verify move generation exhaustively to depth 3; the
// vectors cover mate, castling, en passant, promotion, and stalemate.
// The bot is checked for legality, mate-finding, and speed.
import { initialState, legalMoves, makeMove, status } from './ChessEngine.js';
import { pickMove } from './ChessBot.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok -', m); } else { fail++; console.error('  FAIL -', m); } };
const sq = (n) => 'abcdefgh'.indexOf(n[0]) + (parseInt(n[1], 10) - 1) * 8;

function perft(state, d) {
  if (d === 0) return 1;
  let n = 0;
  for (let i = 0; i < 64; i++) {
    const p = state.board[i];
    if (!p || p[0] !== state.turn) continue;
    for (const to of legalMoves(state, i)) n += perft(makeMove(state, i, to), d - 1);
  }
  return n;
}

const s0 = initialState();
ok(perft(s0, 1) === 20, 'perft(1) = 20');
ok(perft(s0, 2) === 400, 'perft(2) = 400');
ok(perft(s0, 3) === 8902, 'perft(3) = 8902');

let s = s0;
s = makeMove(s, sq('f2'), sq('f3')); s = makeMove(s, sq('e7'), sq('e5'));
s = makeMove(s, sq('g2'), sq('g4')); s = makeMove(s, sq('d8'), sq('h4'));
ok(s && status(s) === 'checkmate', "fool's mate -> checkmate");

s = initialState();
for (const [a, b] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'c4'], ['f8', 'c5']]) {
  s = makeMove(s, sq(a), sq(b));
}
ok(legalMoves(s, sq('e1')).includes(sq('g1')), 'O-O available');
s = makeMove(s, sq('e1'), sq('g1'));
ok(s.board[sq('f1')] === 'wR' && s.board[sq('g1')] === 'wK', 'castling moves the rook');

s = initialState();
for (const [a, b] of [['e2', 'e4'], ['a7', 'a6'], ['e4', 'e5'], ['d7', 'd5']]) s = makeMove(s, sq(a), sq(b));
ok(legalMoves(s, sq('e5')).includes(sq('d6')), 'en passant offered');
s = makeMove(s, sq('e5'), sq('d6'));
ok(s.board[sq('d5')] === null && s.board[sq('d6')] === 'wP', 'en passant captures the bypassed pawn');

s = initialState();
s.board[sq('a7')] = 'wP'; s.board[sq('a8')] = null; s.board[sq('a2')] = null;
s = makeMove(s, sq('a7'), sq('a8'));
ok(s && s.board[sq('a8')] === 'wQ', 'promotion auto-queens');

s = { board: new Array(64).fill(null), turn: 'b', castle: { wK: false, wQ: false, bK: false, bQ: false }, ep: -1, half: 0, full: 1 };
s.board[sq('a8')] = 'bK'; s.board[sq('b6')] = 'wK'; s.board[sq('c7')] = 'wQ';
ok(status(s) === 'stalemate', 'stalemate detected');

// --- Bot ---
// Always returns a legal move from the initial position, at every level.
for (const lv of [1, 2, 3]) {
  const st = initialState();
  const mv = pickMove(st, lv);
  ok(mv && makeMove(st, mv.from, mv.to) !== null, `bot level ${lv} plays a legal opening move`);
}

// Hard bot finds mate in 1: back-rank with Ra1-a8#.
s = { board: new Array(64).fill(null), turn: 'w', castle: { wK: false, wQ: false, bK: false, bQ: false }, ep: -1, half: 0, full: 1 };
s.board[sq('g8')] = 'bK'; s.board[sq('f7')] = 'bP'; s.board[sq('g7')] = 'bP'; s.board[sq('h7')] = 'bP';
s.board[sq('a1')] = 'wR'; s.board[sq('g1')] = 'wK';
const mate = pickMove(s, 3);
const after = makeMove(s, mate.from, mate.to);
ok(after && status(after) === 'checkmate', 'hard bot plays the mate in 1');

// Speed: hard bot from the initial position stays interactive.
const t0 = Date.now();
pickMove(initialState(), 3);
const ms = Date.now() - t0;
ok(ms < 3000, `hard bot opening move under 3s (${ms}ms)`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
