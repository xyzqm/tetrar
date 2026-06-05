// Greedy AI for Tetrar. Picks a move using the shared rules engine in game.js.

import { legalFrontier, turnLimit, neighbors } from "./game.js";

// Count how many empty, non-pending neighbors a cell has — a proxy for "room to grow".
function openNeighbors(state, idx, pending) {
  return neighbors(idx, state.n).filter(
    (nb) => state.grid[nb] === null && !pending.has(nb)
  ).length;
}

// Distance-to-center bonus: cells nearer the middle tend to reach more territory.
function centerBias(state, idx) {
  const n = state.n;
  const r = Math.floor(idx / n);
  const c = idx % n;
  const mid = (n - 1) / 2;
  const dist = Math.abs(r - mid) + Math.abs(c - mid);
  return -dist; // closer to center => higher score
}

// Choose up to `turnLimit` cells greedily. Returns an array of grid indices.
export function chooseMove(state, player) {
  const limit = turnLimit(state, player);
  const pending = new Set();

  for (let step = 0; step < limit; step++) {
    const frontier = legalFrontier(state, player, pending);
    if (frontier.length === 0) break;

    let best = [];
    let bestScore = -Infinity;
    for (const idx of frontier) {
      const score = openNeighbors(state, idx, pending) * 4 + centerBias(state, idx) * 0.5;
      if (score > bestScore) {
        bestScore = score;
        best = [idx];
      } else if (score === bestScore) {
        best.push(idx);
      }
    }
    // Random tie-break among equally good cells.
    const pick = best[Math.floor(Math.random() * best.length)];
    pending.add(pick);
  }

  return [...pending];
}
