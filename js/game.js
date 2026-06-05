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

export function createGame({
  n = 11,
  numPlayers = 2,
  seedMode = "corners",
  vsAI = false,
  minesPerPlayer = 3,
  minePoints = 10,
} = {}) {
  const players = PLAYER_DEFS.slice(0, numPlayers).map((p, i) => ({
    ...p,
    index: i,
    isAI: vsAI && i > 0, // in vs-AI mode, player 0 is human, the rest are bots
  }));

  const grid = new Array(n * n).fill(null);
  // movesMade[i] tracks how many turns player i has completed (for free-first-move
  // and pick-seed phases).
  const movesMade = players.map(() => 0);

  // Mines are hidden from opponents. The mines array is the ground truth; the UI
  // tracks which mines *this client* placed so it can display them locally.
  // NOTE: in online play the full mines array travels in stateJson (technically
  // readable by anyone inspecting the network). For casual play this is acceptable;
  // add Firebase Auth + per-player secret paths for true privacy.
  const mines = new Array(n * n).fill(false);
  const minesPlaced = players.map(() => 0);
  const mineScores = players.map(() => 0);

  // Determine the starting phase.
  // If minesPerPlayer > 0, always start with "mining" before seeding/playing.
  let phase;
  if (minesPerPlayer > 0) {
    phase = "mining";
  } else if (seedMode === "pick" || seedMode === "free") {
    phase = "seeding";
  } else {
    phase = "playing";
  }

  const state = {
    n,
    players,
    grid,
    current: 0,
    seedMode,
    movesMade,
    phase,
    mines,
    minesPerPlayer,
    minePoints,
    minesPlaced,
    mineScores,
    // Count of consecutive passes (zero-cell turns). When a full round of players
    // all pass — e.g. everyone is walled in by mines they can't get past — the game
    // ends instead of stalling forever.
    consecutivePasses: 0,
  };

  if (seedMode === "corners") {
    const seeds = cornerSeeds(n, numPlayers);
    seeds.forEach((idx, i) => {
      grid[idx] = i;
    });
  }

  return state;
}

// ---------------------------------------------------------------------------
// Mine placement helpers
// ---------------------------------------------------------------------------

// Is `idx` a legal cell for placing a mine?
// Rules: not on the outermost border, not already owned. Placing on an
// already-mined cell IS allowed — mines placed blindly may coincide, and two
// mines on the same cell collapse to one (the boolean grid is idempotent).
export function cellLegalForMine(state, idx) {
  const { n, grid } = state;
  const r = Math.floor(idx / n);
  const c = idx % n;
  if (r === 0 || r === n - 1 || c === 0 || c === n - 1) return false; // border
  if (grid[idx] !== null) return false; // already owned (corner seed)
  return true;
}

// Place one mine for `player` at `idx`. Mutates state. Returns state.
//
// Placement is sequenced and blind: a player places ALL their mines before the
// next player starts, and players never see each other's mines. Coinciding mines
// collapse to one. Transitions out of mining once every player has finished.
export function applyMinePlacement(state, player, idx) {
  if (!cellLegalForMine(state, idx)) {
    throw new Error(`Illegal mine placement at ${idx}`);
  }
  state.mines[idx] = true; // idempotent: coinciding mines collapse to one
  state.minesPlaced[player] += 1;

  // This player keeps placing until they've laid all their mines.
  if (state.minesPlaced[player] < state.minesPerPlayer) {
    return state;
  }

  // This player is done — find the next player who still needs to place.
  const count = state.players.length;
  let nextPlacer = -1;
  for (let step = 1; step <= count; step++) {
    const cand = (player + step) % count;
    if (state.minesPlaced[cand] < state.minesPerPlayer) {
      nextPlacer = cand;
      break;
    }
  }

  if (nextPlacer === -1) {
    // Everyone has finished — move to the first real phase.
    state.phase = state.seedMode === "pick" || state.seedMode === "free" ? "seeding" : "playing";
    state.current = 0;
  } else {
    state.current = nextPlacer;
  }
  return state;
}

// ---------------------------------------------------------------------------
// Territory phase helpers (unchanged from before)
// ---------------------------------------------------------------------------

// Is `idx` orthogonally adjacent to a cell owned by `player`?
function adjacentToOwn(state, idx, player) {
  return neighbors(idx, state.n).some((nb) => state.grid[nb] === player);
}

// Is `idx` adjacent to any cell currently pending in this turn?
function adjacentToPending(state, idx, pendingSet) {
  return neighbors(idx, state.n).some((nb) => pendingSet.has(nb));
}

// During the seeding phase (pick/free mode), any empty cell is a legal seed.
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

// Apply a validated set of cells for `player`. Mutates state.
// Returns { state, mineHit: boolean }.
// If any selected cell is a mine, the entire turn is skipped (no cells claimed)
// but the turn still counts and advances.
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

  // Mine check: if ANY selected cell contains a mine, skip the entire turn.
  // Seeding is mine-safe — you can't lose your initial foothold to a mine; mines
  // only bite during the territory battle (the "playing" phase).
  const mineHit = state.phase === "playing" && cells.some((idx) => state.mines[idx]);

  if (!mineHit) {
    for (const idx of cells) state.grid[idx] = player;
    // Any region now fully enclosed flips to its enclosing player.
    captureEnclosed(state);
  }

  state.movesMade[player] += 1;

  // Track passes (zero-cell turns). A mine hit is an attempt, not a pass, so it
  // resets the counter. A full round of passes means nobody can make progress.
  if (cells.length === 0) {
    state.consecutivePasses += 1;
  } else {
    state.consecutivePasses = 0;
  }

  // Leave seeding phase once every player has taken their first turn (pick mode).
  if (state.phase === "seeding" && state.movesMade.every((m) => m > 0)) {
    state.phase = "playing";
  }

  const next = nextMover(state, player);
  if (next === -1 || state.consecutivePasses >= state.players.length) {
    state.phase = "gameover";
  } else {
    state.current = next;
  }
  return { state, mineHit };
}

// ---------------------------------------------------------------------------
// Enclosure capture.
//
// The board EDGE acts as a wall. Empty cells are grouped into connected
// components (flooding through empty cells only). A component is captured by
// player P when P is the ONLY player with a cell bordering it — i.e. P has
// walled it off (together with the board edges) from every opponent.
//
// Only empty cells flip; opponent cells are never taken. Mines inside a captured
// region award bonus points to the enclosing player. Capture is assigned globally
// to whichever single player encloses each region, regardless of who just moved.
// Skipped until every player has a foothold so a first mover in a seed mode can't
// grab the open board.
//
// Note: an opponent cell sitting inside a pocket counts as bordering it, so it
// makes the region contested and blocks capture. Capturing the empties *around*
// a trapped enemy cell is intentionally not supported (doing it safely needs a
// full life/death analysis).
// ---------------------------------------------------------------------------
export function captureEnclosed(state) {
  if (!state.players.every((p) => state.grid.includes(p.index))) return [];

  const { n, grid, mines, minePoints, mineScores } = state;
  const total = n * n;
  const visited = new Uint8Array(total);
  const captured = [];

  for (let start = 0; start < total; start++) {
    if (grid[start] !== null || visited[start]) continue;

    // Flood this connected component of empty cells, noting bordering players.
    const component = [];
    const borderingPlayers = new Set();
    const stack = [start];
    visited[start] = 1;
    while (stack.length) {
      const idx = stack.pop();
      component.push(idx);
      for (const nb of neighbors(idx, n)) {
        if (grid[nb] === null) {
          if (!visited[nb]) {
            visited[nb] = 1;
            stack.push(nb);
          }
        } else {
          borderingPlayers.add(grid[nb]);
        }
      }
    }

    // Enclosed by exactly one player -> that player claims the empty cells.
    if (borderingPlayers.size === 1) {
      const owner = [...borderingPlayers][0];
      for (const idx of component) {
        grid[idx] = owner;
        if (mines[idx]) mineScores[owner] += minePoints; // mine bonus
        captured.push(idx);
      }
    }
  }
  return captured;
}

export function isGameOver(state) {
  if (state.phase === "gameover") return true;
  if (!state.grid.includes(null)) return true;
  return state.players.every((p) => !canPlayerMove(state, p.index));
}

// Owned-cell count + mine bonus points per player.
export function scores(state) {
  const out = state.players.map(() => 0);
  for (const owner of state.grid) {
    if (owner !== null) out[owner] += 1;
  }
  // Add mine bonus points earned through enclosure.
  const mineScores = state.mineScores || [];
  for (let i = 0; i < out.length; i++) out[i] += mineScores[i] || 0;
  return out;
}

// Winner(s) by score. Returns { winners: number[], scores: number[], tie: bool }.
export function result(state) {
  const sc = scores(state);
  const max = Math.max(...sc);
  const winners = sc.map((v, i) => (v === max ? i : -1)).filter((i) => i >= 0);
  return { winners, scores: sc, tie: winners.length > 1 };
}
