import { initialState, legalMoves, makeMove, status } from './ChessEngine.js';
import { pickMove, BOT_LEVELS } from './ChessBot.js';

// Per-table chess sessions, keyed by the chess table block's "x,y,z". Owns
// seats (first opener = white, second = black, everyone else spectates) and
// validates moves against the engine. Runs wherever the simulation lives:
// single-player locally, the host in multiplayer (guests send actions and
// receive authoritative views).
export class ChessGames {
  constructor({ hotseat = false } = {}) {
    this.hotseat = hotseat; // single-player: one person plays both sides
    this.games = new Map(); // key -> { state, white, black, last }
  }

  _get(key) {
    let g = this.games.get(key);
    if (!g) {
      g = { state: initialState(), white: null, black: null, last: null };
      this.games.set(key, g);
    }
    return g;
  }

  // Open the table: claim a free seat (or keep yours), spectate otherwise.
  open(key, id) {
    const g = this._get(key);
    if (this.hotseat) {
      g.white = id;
      g.black = id;
    } else if (g.white !== id && g.black !== id) {
      if (g.white === null) g.white = id;
      else if (g.black === null) g.black = id;
    }
    return this.view(key);
  }

  // Validated move by seat. Returns the updated view, or null if rejected.
  move(key, id, from, to) {
    const g = this._get(key);
    const seat = g.state.turn === 'w' ? g.white : g.black;
    if (seat !== id) return null;
    const st = status(g.state);
    if (st === 'checkmate' || st === 'stalemate' || st === 'draw') return null;
    const next = makeMove(g.state, from, to);
    if (!next) return null;
    g.state = next;
    g.last = [from, to];
    return this.view(key);
  }

  // Seat a bot opponent (the requester takes white), or null to go back to
  // two-player / hotseat. Resets nothing — the board carries on.
  setBot(key, id, botId) {
    const g = this._get(key);
    if (g.white !== id && g.black !== id && g.white !== null) return null;
    if (botId) {
      g.white = id;
      g.black = botId;
    } else {
      g.black = this.hotseat ? id : null;
    }
    return this.view(key);
  }

  // If it's a bot's turn at this table, compute and play its move.
  botMove(key) {
    const g = this._get(key);
    const seat = g.state.turn === 'w' ? g.white : g.black;
    const level = BOT_LEVELS[seat];
    if (!level) return null;
    const st = status(g.state);
    if (st === 'checkmate' || st === 'stalemate' || st === 'draw') return null;
    const mv = pickMove(g.state, level);
    if (!mv) return null;
    const next = makeMove(g.state, mv.from, mv.to);
    if (!next) return null;
    g.state = next;
    g.last = [mv.from, mv.to];
    return this.view(key);
  }

  // Seated players can reset the board (seats are kept).
  reset(key, id) {
    const g = this._get(key);
    if (g.white !== id && g.black !== id && g.white !== null) return null;
    g.state = initialState();
    g.last = null;
    return this.view(key);
  }

  // Legal targets for highlighting, computed from a broadcast view — works on
  // guests too, who never hold the internal game object. Empty unless `id`
  // owns the side to move. (Hosts still validate the real move.)
  legalTargetsFor(view, from, id) {
    const seat = view.turn === 'w' ? view.white : view.black;
    if (seat !== id) return [];
    const state = { board: view.board, turn: view.turn, castle: view.castle, ep: view.ep, half: 0, full: 1 };
    return legalMoves(state, from);
  }

  // Serializable snapshot for rendering + network broadcast. Carries castle/ep
  // so receivers can compute legal-move highlights locally.
  view(key) {
    const g = this._get(key);
    return {
      key,
      board: g.state.board,
      turn: g.state.turn,
      castle: g.state.castle,
      ep: g.state.ep,
      white: g.white,
      black: g.black,
      last: g.last,
      status: status(g.state),
    };
  }

  // Persistence: board positions survive saves; seats are ephemeral.
  serialize() {
    const out = {};
    for (const [key, g] of this.games) {
      out[key] = { state: g.state, last: g.last };
    }
    return out;
  }

  load(obj) {
    this.games.clear();
    if (!obj) return;
    for (const key of Object.keys(obj)) {
      this.games.set(key, {
        state: obj[key].state,
        last: obj[key].last || null,
        white: null,
        black: null,
      });
    }
  }
}
