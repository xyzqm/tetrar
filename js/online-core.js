// Pure helpers for online play: building/serializing the shared game state and
// applying a move authoritatively. No DOM, no network — this is exactly the logic
// that runs inside the Firebase transaction, so it stays testable in isolation.

import {
  createGame,
  cellLegalForPlayer,
  turnLimit,
  applyTurn,
  isGameOver,
} from "./game.js";

// Build the initial shared state from a room's config and its seated players.
// `players` is an ordered array of { pid, name, color }. Reuses the local engine's
// seeding, then stamps each engine player with its owning pid.
export function createOnlineState({ n, seedMode, players }) {
  const state = createGame({
    n,
    numPlayers: players.length,
    seedMode,
    vsAI: false,
  });
  state.players = players.map((p, i) => ({
    name: p.name,
    color: p.color,
    index: i,
    isAI: false,
    pid: p.pid,
  }));
  return state;
}

export function serializeState(state) {
  return JSON.stringify(state);
}

export function deserializeState(json) {
  return typeof json === "string" ? JSON.parse(json) : json;
}

// Apply `pid`'s move of `cells` to `state` (mutating it). Returns { ok, error }.
// Rejects moves that aren't the caller's turn or that break the rules, so a stale
// or malicious client can't corrupt the shared state.
export function applyMove(state, pid, cells) {
  if (state.phase === "gameover" || isGameOver(state)) {
    return { ok: false, error: "Game is over" };
  }
  const cur = state.players[state.current];
  if (!cur || cur.pid !== pid) {
    return { ok: false, error: "Not your turn" };
  }

  const limit = turnLimit(state, state.current);
  if (cells.length > limit) {
    return { ok: false, error: "Too many cells" };
  }
  const pending = new Set();
  for (const idx of cells) {
    if (!cellLegalForPlayer(state, idx, state.current, pending)) {
      return { ok: false, error: "Illegal cell in move" };
    }
    pending.add(idx);
  }

  applyTurn(state, state.current, cells); // re-validates, captures, advances turn
  return { ok: true };
}
