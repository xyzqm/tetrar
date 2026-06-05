// Pure helpers for online play: building/serializing the shared game state and
// applying a move authoritatively. No DOM, no network — this is exactly the logic
// that runs inside the Firebase transaction, so it stays testable in isolation.

import {
  createGame,
  cellLegalForPlayer,
  cellLegalForMine,
  applyMinePlacement,
  turnLimit,
  applyTurn,
  isGameOver,
} from "./game.js";

// Build the initial shared state from a room's config and its seated players.
// `players` is an ordered array of { pid, name, color }. Reuses the local engine's
// seeding, then stamps each engine player with its owning pid.
export function createOnlineState({ n, seedMode, players, minesPerPlayer = 3, minePoints = 10 }) {
  const state = createGame({
    n,
    numPlayers: players.length,
    seedMode,
    vsAI: false,
    minesPerPlayer,
    minePoints,
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

// Apply `pid`'s action to `state` (mutating it). Returns { ok, error, mineHit }.
//
// action can be:
//   { type: 'mine', idx: N }        — place a mine during the mining phase
//   { type: 'turn', cells: [...] }  — claim cells during playing/seeding
//   [...cells]                      — legacy array form, treated as type:'turn'
//
// Rejects moves that aren't the caller's turn or that break the rules, so a stale
// or malicious client can't corrupt the shared state.
export function applyMove(state, pid, action) {
  // Normalise legacy array form.
  if (Array.isArray(action)) action = { type: "turn", cells: action };

  if (state.phase === "gameover" || isGameOver(state)) {
    return { ok: false, error: "Game is over" };
  }
  const cur = state.players[state.current];
  if (!cur || cur.pid !== pid) {
    return { ok: false, error: "Not your turn" };
  }

  // --- Mine placement ---
  if (action.type === "mine") {
    if (state.phase !== "mining") {
      return { ok: false, error: "Not in mining phase" };
    }
    if (!cellLegalForMine(state, action.idx)) {
      return { ok: false, error: "Illegal mine placement" };
    }
    applyMinePlacement(state, state.current, action.idx);
    return { ok: true, mineHit: false };
  }

  // --- Regular turn ---
  if (action.type !== "turn") {
    return { ok: false, error: `Unknown action type: ${action.type}` };
  }
  if (state.phase === "mining") {
    return { ok: false, error: "Still in mining phase" };
  }
  const cells = action.cells;
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

  // applyTurn now returns { state, mineHit }.
  const { mineHit } = applyTurn(state, state.current, cells);
  return { ok: true, mineHit };
}
