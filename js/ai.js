// Greedy, mine-aware AI for Tetrar. Picks a move using the shared rules engine.
//
// Mines are hidden, so the AI plays like a careful human: it remembers which cells
// caused a skipped turn ("suspect") and avoids them, scouting suspects one at a time
// to flush out the real mine ("confirmed"). This keeps it from stepping on the same
// mine forever.

import { legalFrontier, turnLimit, neighbors } from "./game.js";

// Fresh memory for one player. Pass the same object across that player's turns.
export function newAIMemory() {
  return { suspect: new Set(), confirmed: new Set() };
}

// Update memory after a move resolves.
// - A skipped single-cell probe pinpoints the mine (confirmed).
// - A skipped multi-cell move means one of those cells is a mine (all suspect).
// - A successful move clears its cells from suspicion (they're safely owned now).
export function recordMoveResult(memory, cells, mineHit) {
  if (mineHit) {
    if (cells.length === 1) {
      memory.confirmed.add(cells[0]);
      memory.suspect.delete(cells[0]);
    } else {
      for (const c of cells) memory.suspect.add(c);
    }
  } else {
    for (const c of cells) memory.suspect.delete(c);
  }
}

// Count empty, non-pending neighbors — a proxy for "room to grow".
function openNeighbors(state, idx, pending) {
  return neighbors(idx, state.n).filter(
    (nb) => state.grid[nb] === null && !pending.has(nb)
  ).length;
}

// Cells nearer the middle tend to reach more territory.
function centerBias(state, idx) {
  const n = state.n;
  const r = Math.floor(idx / n);
  const c = idx % n;
  const mid = (n - 1) / 2;
  const dist = Math.abs(r - mid) + Math.abs(c - mid);
  return -dist;
}

// Pick a strong cell by openness + center bias. Chooses randomly among the top few
// candidates rather than always the single best, so different players (and repeated
// turns) spread out instead of all funnelling onto the same cell/mine.
function bestCell(state, cells, pending) {
  const scored = cells.map((idx) => ({
    idx,
    score: openNeighbors(state, idx, pending) * 4 + centerBias(state, idx) * 0.5,
  }));
  scored.sort((a, b) => b.score - a.score);
  const topK = scored.slice(0, Math.min(3, scored.length));
  return topK[Math.floor(Math.random() * topK.length)].idx;
}

// Choose up to `turnLimit` cells. Returns an array of grid indices.
export function chooseMove(state, player, memory = newAIMemory()) {
  const limit = turnLimit(state, player);
  const { confirmed, suspect } = memory;
  const pending = new Set();

  // Prefer building a chain from "clean" cells: never known mines, never suspect.
  for (let step = 0; step < limit; step++) {
    const clean = legalFrontier(state, player, pending).filter(
      (i) => !confirmed.has(i) && !suspect.has(i)
    );
    if (clean.length === 0) break;
    pending.add(bestCell(state, clean, pending));
  }
  if (pending.size > 0) return [...pending];

  // No clean cells available — scout a single suspect cell to resolve it. A hit
  // confirms it's the mine; a miss claims it and clears suspicion.
  const suspectFrontier = legalFrontier(state, player).filter(
    (i) => !confirmed.has(i) && suspect.has(i)
  );
  if (suspectFrontier.length > 0) {
    return [bestCell(state, suspectFrontier, pending)];
  }

  // Everything reachable is a known mine — nothing safe to do; pass.
  return [];
}
