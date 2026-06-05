// DOM rendering and interaction for Tetrar. Owns the turn flow and talks to the
// pure engine in game.js plus the AI in ai.js.

import {
  createGame,
  legalFrontier,
  cellLegalForPlayer,
  turnLimit,
  applyTurn,
  isGameOver,
  scores,
  result,
} from "./game.js";
import { chooseMove } from "./ai.js";

const AI_DELAY_MS = 450;

export class GameUI {
  constructor(els) {
    this.els = els; // { board, hud, status, confirmBtn, endBtn, clearBtn, gameover, resultTitle, resultScores }
    this.state = null;
    this.pending = new Set(); // cells selected this turn, not yet committed
    this.cellEls = []; // index -> div
    this.aiThinking = false;
  }

  start(config) {
    this.state = createGame(config);
    this.pending = new Set();
    this.aiThinking = false;
    this.els.gameover.classList.add("hidden");
    this.buildBoard();
    this.refresh();
    this.maybeRunAI();
  }

  buildBoard() {
    const { n } = this.state;
    const board = this.els.board;
    board.innerHTML = "";
    board.style.setProperty("--n", n);
    this.cellEls = [];
    for (let idx = 0; idx < n * n; idx++) {
      const cell = document.createElement("button");
      cell.className = "cell";
      cell.dataset.idx = idx;
      cell.addEventListener("click", () => this.onCellClick(idx));
      board.appendChild(cell);
      this.cellEls.push(cell);
    }
  }

  get currentPlayer() {
    return this.state.players[this.state.current];
  }

  isHumanTurn() {
    return !this.currentPlayer.isAI && !this.aiThinking;
  }

  onCellClick(idx) {
    if (!this.isHumanTurn()) return;
    const player = this.state.current;

    if (this.pending.has(idx)) {
      // Deselect, then drop any now-orphaned selections (they may have depended on
      // this cell for connectivity). Rebuild the pending set greedily.
      this.pending.delete(idx);
      this.repairPending(player);
      this.refresh();
      return;
    }

    if (this.pending.size >= turnLimit(this.state, player)) return;
    if (!cellLegalForPlayer(this.state, idx, player, this.pending)) return;

    this.pending.add(idx);
    this.refresh();
  }

  // After a deselection, keep only cells that remain legal in selection order.
  repairPending(player) {
    const ordered = [...this.pending];
    const rebuilt = new Set();
    for (const idx of ordered) {
      if (cellLegalForPlayer(this.state, idx, player, rebuilt)) rebuilt.add(idx);
    }
    this.pending = rebuilt;
  }

  confirm() {
    if (!this.isHumanTurn() || this.pending.size === 0) return;
    this.commit([...this.pending]);
  }

  endTurn() {
    if (!this.isHumanTurn()) return;
    // Commit whatever is selected (may be empty if truly blocked -> counts as a turn).
    this.commit([...this.pending]);
  }

  clear() {
    if (!this.isHumanTurn()) return;
    this.pending = new Set();
    this.refresh();
  }

  commit(cells) {
    const player = this.state.current;
    applyTurn(this.state, player, cells);
    this.pending = new Set();

    if (isGameOver(this.state)) {
      this.refresh();
      this.showGameOver();
      return;
    }
    this.refresh();
    this.maybeRunAI();
  }

  maybeRunAI() {
    if (isGameOver(this.state)) return;
    if (!this.currentPlayer.isAI) return;
    this.aiThinking = true;
    this.refresh();
    setTimeout(() => {
      const player = this.state.current;
      const cells = chooseMove(this.state, player);
      this.aiThinking = false;
      this.commit(cells);
    }, AI_DELAY_MS);
  }

  refresh() {
    const state = this.state;
    const player = state.current;
    const frontier = this.isHumanTurn()
      ? new Set(legalFrontier(state, player, this.pending))
      : new Set();

    for (let idx = 0; idx < this.cellEls.length; idx++) {
      const cell = this.cellEls[idx];
      const owner = state.grid[idx];
      cell.className = "cell";
      cell.style.removeProperty("--owner");
      if (owner !== null) {
        cell.classList.add("owned");
        cell.style.setProperty("--owner", state.players[owner].color);
      }
      if (this.pending.has(idx)) {
        cell.classList.add("pending");
        cell.style.setProperty("--owner", state.players[player].color);
      } else if (frontier.has(idx) && this.pending.size < turnLimit(state, player)) {
        cell.classList.add("legal");
      }
    }

    this.renderHud();
    this.renderControls();
  }

  renderHud() {
    const state = this.state;
    const sc = scores(state);
    const empty = state.grid.filter((o) => o === null).length;
    const hud = this.els.hud;
    hud.innerHTML = "";

    state.players.forEach((p) => {
      const chip = document.createElement("div");
      chip.className = "score-chip";
      if (p.index === state.current) chip.classList.add("active");
      chip.innerHTML = `
        <span class="swatch" style="background:${p.color}"></span>
        <span class="who">${p.name}${p.isAI ? " (AI)" : ""}</span>
        <span class="count">${sc[p.index]}</span>`;
      hud.appendChild(chip);
    });

    const info = document.createElement("div");
    info.className = "empty-count";
    info.textContent = `${empty} empty`;
    hud.appendChild(info);
  }

  renderControls() {
    const human = this.isHumanTurn();
    this.els.confirmBtn.disabled = !human || this.pending.size === 0;
    this.els.endBtn.disabled = !human;
    this.els.clearBtn.disabled = !human || this.pending.size === 0;

    const player = this.currentPlayer;
    const limit = turnLimit(this.state, player.index);
    if (this.aiThinking || player.isAI) {
      this.els.status.textContent = `${player.name} (AI) is thinking…`;
    } else if (this.state.seedMode === "pick" && this.state.movesMade[player.index] === 0) {
      this.els.status.textContent = `${player.name}: pick your starting cell.`;
    } else {
      this.els.status.textContent =
        `${player.name}: select up to ${limit} cells ` +
        `(${this.pending.size}/${limit}), then Confirm.`;
    }
  }

  showGameOver() {
    const { winners, scores: sc, tie } = result(this.state);
    const names = winners.map((i) => this.state.players[i].name);
    this.els.resultTitle.textContent = tie
      ? `Tie: ${names.join(" & ")}`
      : `${names[0]} wins!`;

    this.els.resultScores.innerHTML = "";
    this.state.players.forEach((p) => {
      const row = document.createElement("div");
      row.className = "result-row";
      row.innerHTML = `
        <span class="swatch" style="background:${p.color}"></span>
        <span>${p.name}${p.isAI ? " (AI)" : ""}</span>
        <strong>${sc[p.index]}</strong>`;
      this.els.resultScores.appendChild(row);
    });
    this.els.gameover.classList.remove("hidden");
  }
}
