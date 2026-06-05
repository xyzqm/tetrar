// Pure rules engine for Tetrar. No DOM access — safe to reuse from UI and AI.

export const CELLS_PER_TURN = 4;

// Player palette (index -> {name, color}). Up to 4 players supported.
export const PLAYER_DEFS = [
  { name: "Player 1", color: "#e4572e" },
  { name: "Player 2", color: "#2e86e4" },
  { name: "Player 3", color: "#2eae54" },
  { name: "Player 4", color: "#b04ee4" },
];

// Return up-to-4 orthogonal neighbor indices for a flat grid index.
export function neighbors(idx, n) {
  const r = Math.floor(idx / n);
  const c = idx % n;
  const out = [];
  if (r > 0) out.push(idx - n);
  if (r < n - 1) out.push(idx + n);
  if (c > 0) out.push(idx - 1);
  if (c < n - 1) out.push(idx + 1);
  return out;
}

// Corner cells used for the `corners` seed mode, ordered TL, BR, TR, BL so that a
// 2-player game gets opposite corners and a 4-player game fills all four.
function cornerSeeds(n, numPlayers) {
  const order = [0, n * n - 1, n - 1, n * (n - 1)];
  return order.slice(0, numPlayers);
}

export function createGame({ n = 11, numPlayers = 2, seedMode = "corners", vsAI = false } = {}) {
  const players = PLAYER_DEFS.slice(0, numPlayers).map((p, i) => ({
    ...p,
    index: i,
    isAI: vsAI && i > 0, // in vs-AI mode, player 0 is human, the rest are bots
  }));

  const grid = new Array(n * n).fill(null);
  // movesMade[i] tracks how many turns player i has completed (for free-first-move
  // and pick-seed phases).
  const movesMade = players.map(() => 0);

  const state = {
    n,
    players,
    grid,
    current: 0,
    seedMode,
    movesMade,
    phase: seedMode === "pick" ? "seeding" : "playing",
  };

  if (seedMode === "corners") {
    const seeds = cornerSeeds(n, numPlayers);
    seeds.forEach((idx, i) => {
      grid[idx] = i;
    });
  }

  return state;
}

// Has this player placed any territory yet?
function hasTerritory(state, player) {
  return state.grid.some((owner) => owner === player);
}

// Is `idx` orthogonally adjacent to a cell owned by `player`?
function adjacentToOwn(state, idx, player) {
  return neighbors(idx, state.n).some((nb) => state.grid[nb] === player);
}

// Is `idx` adjacent to any cell currently pending in this turn?
function adjacentToPending(state, idx, pendingSet) {
  return neighbors(idx, state.n).some((nb) => pendingSet.has(nb));
}

// During the seeding phase (pick mode), any empty cell is a legal seed.
function inSeedingPhase(state, player) {
  if (state.seedMode === "pick") return state.movesMade[player] === 0;
  if (state.seedMode === "free") return state.movesMade[player] === 0;
  return false;
}

// Is placing `idx` legal for `player`, given cells already selected this turn?
export function cellLegalForPlayer(state, idx, player, pendingSet = new Set()) {
  if (state.grid[idx] !== null) return false; // already owned
  if (pendingSet.has(idx)) return false; // already selected this turn

  // Pick mode, first turn: claim exactly one free cell anywhere.
  if (state.seedMode === "pick" && state.movesMade[player] === 0) {
    return pendingSet.size === 0; // only the single seed cell
  }

  // Free mode, first turn: 4 cells anywhere, but each after the first must connect
  // to a cell selected this same turn (one connected blob).
  if (state.seedMode === "free" && state.movesMade[player] === 0) {
    if (pendingSet.size === 0) return true;
    return adjacentToPending(state, idx, pendingSet);
  }

  // Normal rule: connect to existing territory or to a cell selected this turn.
  return adjacentToOwn(state, idx, player) || adjacentToPending(state, idx, pendingSet);
}

// All currently-legal cells for the player given the in-progress selection.
export function legalFrontier(state, player, pendingSet = new Set()) {
  const out = [];
  for (let idx = 0; idx < state.grid.length; idx++) {
    if (cellLegalForPlayer(state, idx, player, pendingSet)) out.push(idx);
  }
  return out;
}

// Max cells a player may place this turn (1 during pick-seed, else CELLS_PER_TURN).
export function turnLimit(state, player) {
  if (state.seedMode === "pick" && state.movesMade[player] === 0) return 1;
  return CELLS_PER_TURN;
}

// Can `player` make any move at all right now?
export function canPlayerMove(state, player) {
  // Player with no territory yet (corners always seeds, so this is pick/free pre-seed)
  // can move as long as an empty cell exists.
  if (inSeedingPhase(state, player)) {
    return state.grid.includes(null);
  }
  return legalFrontier(state, player).length > 0;
}

// Index of the next player (after `from`) who can move, or -1 if nobody can.
function nextMover(state, from) {
  const count = state.players.length;
  for (let step = 1; step <= count; step++) {
    const cand = (from + step) % count;
    if (canPlayerMove(state, cand)) return cand;
  }
  return -1;
}

// Apply a validated set of cells for `player`. Mutates and returns state.
// Throws if any cell is illegal or the count exceeds the per-turn limit.
export function applyTurn(state, player, cells) {
  const limit = turnLimit(state, player);
  if (cells.length > limit) {
    throw new Error(`Too many cells: ${cells.length} > ${limit}`);
  }
  // Revalidate the whole set incrementally to guard against bad callers.
  const pending = new Set();
  for (const idx of cells) {
    if (!cellLegalForPlayer(state, idx, player, pending)) {
      throw new Error(`Illegal cell ${idx} for player ${player}`);
    }
    pending.add(idx);
  }
  for (const idx of cells) state.grid[idx] = player;
  state.movesMade[player] += 1;

  // Leave seeding phase once every player has taken their first turn (pick mode).
  if (state.phase === "seeding" && state.movesMade.every((m) => m > 0)) {
    state.phase = "playing";
  }

  const next = nextMover(state, player);
  if (next === -1) {
    state.phase = "gameover";
  } else {
    state.current = next;
  }
  return state;
}

export function isGameOver(state) {
  if (state.phase === "gameover") return true;
  if (!state.grid.includes(null)) return true;
  return state.players.every((p) => !canPlayerMove(state, p.index));
}

// Owned-cell count per player, indexed by player index.
export function scores(state) {
  const out = state.players.map(() => 0);
  for (const owner of state.grid) {
    if (owner !== null) out[owner] += 1;
  }
  return out;
}

// Winner(s) by score. Returns { winners: number[], scores: number[], tie: bool }.
export function result(state) {
  const sc = scores(state);
  const max = Math.max(...sc);
  const winners = sc.map((v, i) => (v === max ? i : -1)).filter((i) => i >= 0);
  return { winners, scores: sc, tie: winners.length > 1 };
}
