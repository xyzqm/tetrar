// DOM rendering and interaction for Tetrar. Owns the turn flow and talks to the
// pure engine in game.js plus the AI in ai.js.

import {
  createGame,
  legalFrontier,
  cellLegalForPlayer,
  cellLegalForMine,
  applyMinePlacement,
  turnLimit,
  applyTurn,
  isGameOver,
  scores,
  result,
} from "./game.js";
import { chooseMove, newAIMemory, recordMoveResult } from "./ai.js";

const AI_DELAY_MS = 450;
const MINE_HIT_MSG_MS = 2200;

export class GameUI {
  constructor(els) {
    this.els = els; // { board, hud, status, confirmBtn, endBtn, clearBtn, gameover, resultTitle, resultScores }
    this.state = null;
    this.pending = new Set(); // cells selected this turn, not yet committed
    this.cellEls = []; // index -> div
    this.aiThinking = false;

    // minesByPlayer[i] = Set of mine cells player i has placed ON THIS CLIENT.
    // Used to show a player only their own mines during the blind placement phase
    // (so in local hotseat, the next player can't see the previous one's mines).
    this.minesByPlayer = [];

    // Online mode fields.
    this.mode = "local";
    this.myPid = null;
    this.submitFn = null;
    this.awaitingServer = false;

    // Mine-hit flash state.
    this._mineHitTimer = null;
    this._showingMineHit = false;

    // Drag-to-select state.
    this.dragging = false;
    this.dragMode = null; // "select" | "deselect"
    this.lastDragIdx = -1;

    const board = els.board;
    board.addEventListener("pointerdown", (e) => this.onPointerDown(e));
    board.addEventListener("pointermove", (e) => this.onPointerMove(e));
    window.addEventListener("pointerup", () => this.endDrag());
    window.addEventListener("pointercancel", () => this.endDrag());
    board.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  start(config) {
    this.mode = "local";
    this.pending = new Set();
    this.aiThinking = false;
    this._clearMineHitTimer();
    this.els.gameover.classList.add("hidden");
    this.state = createGame(config);
    this.minesByPlayer = this.state.players.map(() => new Set());
    this.aiMemory = this.state.players.map(() => newAIMemory());
    this.buildBoard();
    this.refresh();
    this.maybeRunAI();
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  beginOnline(state, myPid, submitFn) {
    this.mode = "online";
    this.myPid = myPid;
    this.submitFn = submitFn;
    this.state = state;
    this.pending = new Set();
    this.minesByPlayer = state.players.map(() => new Set());
    this.awaitingServer = false;
    this._clearMineHitTimer();
    this.els.gameover.classList.add("hidden");
    this.buildBoard();
    this.refresh();
  }

  updateOnline(state, mineHit = false) {
    this.state = state;
    this.pending = new Set();
    this.awaitingServer = false;
    if (this.cellEls.length !== state.n * state.n) this.buildBoard();
    if (mineHit) this._triggerMineHit();
    this.refresh();
    if (isGameOver(this.state)) this.showGameOver();
  }

  // ---------------------------------------------------------------------------
  // Board construction
  // ---------------------------------------------------------------------------

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
      board.appendChild(cell);
      this.cellEls.push(cell);
    }
  }

  // ---------------------------------------------------------------------------
  // Turn helpers
  // ---------------------------------------------------------------------------

  get currentPlayer() {
    return this.state.players[this.state.current];
  }

  isMiningPhase() {
    return this.state.phase === "mining";
  }

  isMyMiningTurn() {
    if (!this.isMiningPhase()) return false;
    if (this.mode === "online") return this.currentPlayer.pid === this.myPid;
    return !this.currentPlayer.isAI;
  }

  isHumanTurn() {
    if (this.isMiningPhase()) return false; // mining handled separately
    if (this.mode === "online") {
      return (
        !!this.state &&
        !this.awaitingServer &&
        !isGameOver(this.state) &&
        this.currentPlayer.pid === this.myPid
      );
    }
    return !this.currentPlayer.isAI && !this.aiThinking;
  }

  // ---------------------------------------------------------------------------
  // Pointer / drag events
  // ---------------------------------------------------------------------------

  cellIdxFromPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const cell = el && el.closest && el.closest(".cell");
    return cell ? Number(cell.dataset.idx) : -1;
  }

  onPointerDown(e) {
    if (e.button !== undefined && e.button !== 0) return;
    const idx = this.cellIdxFromPoint(e.clientX, e.clientY);
    if (idx < 0) return;
    e.preventDefault();

    // Mining phase: single click places one mine.
    if (this.isMyMiningTurn()) {
      if (cellLegalForMine(this.state, idx)) {
        this.commitMinePlacement(idx);
      }
      return;
    }

    if (!this.isHumanTurn()) return;

    this.dragging = true;
    this.lastDragIdx = idx;
    try { this.els.board.setPointerCapture(e.pointerId); } catch { /* best-effort */ }

    const player = this.state.current;
    if (this.pending.has(idx)) {
      this.dragMode = "deselect";
      this.deselect(idx, player);
    } else {
      this.dragMode = "select";
      this.tryAdd(idx, player);
    }
    this.refresh();
  }

  onPointerMove(e) {
    if (!this.dragging) return;
    const idx = this.cellIdxFromPoint(e.clientX, e.clientY);
    if (idx < 0 || idx === this.lastDragIdx) return;
    this.lastDragIdx = idx;

    const player = this.state.current;
    if (this.dragMode === "select") {
      this.tryAdd(idx, player);
    } else if (this.dragMode === "deselect" && this.pending.has(idx)) {
      this.deselect(idx, player);
    }
    this.refresh();
  }

  endDrag() {
    if (!this.dragging) return;
    this.dragging = false;
    this.dragMode = null;
    this.lastDragIdx = -1;
  }

  tryAdd(idx, player) {
    if (this.pending.has(idx)) return;
    if (this.pending.size >= turnLimit(this.state, player)) return;
    if (!cellLegalForPlayer(this.state, idx, player, this.pending)) return;
    this.pending.add(idx);
  }

  deselect(idx, player) {
    this.pending.delete(idx);
    this.repairPending(player);
  }

  repairPending(player) {
    const ordered = [...this.pending];
    const rebuilt = new Set();
    for (const idx of ordered) {
      if (cellLegalForPlayer(this.state, idx, player, rebuilt)) rebuilt.add(idx);
    }
    this.pending = rebuilt;
  }

  // ---------------------------------------------------------------------------
  // Mine placement
  // ---------------------------------------------------------------------------

  commitMinePlacement(idx) {
    const player = this.state.current;
    // Don't let a player place a second mine on their own existing one.
    if (this.minesByPlayer[player] && this.minesByPlayer[player].has(idx)) return;

    if (this.mode === "online") {
      this.awaitingServer = true;
      this.minesByPlayer[player].add(idx); // optimistic; server confirms
      this.refresh();
      this.submitFn({ type: "mine", idx });
      return;
    }
    // Local.
    applyMinePlacement(this.state, player, idx);
    this.minesByPlayer[player].add(idx);
    this.refresh();
    this.maybeRunAIMine();
  }

  // Let the AI place its mines automatically.
  maybeRunAIMine() {
    if (!this.isMiningPhase()) {
      // Mining phase just ended — proceed to seeding/playing.
      this.maybeRunAI();
      return;
    }
    if (!this.currentPlayer.isAI) return;
    this.aiThinking = true;
    this.refresh();
    setTimeout(() => {
      this.aiThinking = false;
      const player = this.state.current;
      const n = this.state.n;
      const own = this.minesByPlayer[player] || new Set();
      // AI picks a random legal mine cell it hasn't already used.
      const legal = [];
      for (let i = 0; i < n * n; i++) {
        if (cellLegalForMine(this.state, i) && !own.has(i)) legal.push(i);
      }
      if (legal.length > 0) {
        const pick = legal[Math.floor(Math.random() * legal.length)];
        applyMinePlacement(this.state, player, pick);
        own.add(pick); // track so the AI doesn't reuse its own cell
      }
      this.refresh();
      this.maybeRunAIMine();
    }, AI_DELAY_MS);
  }

  // ---------------------------------------------------------------------------
  // Regular turn commits
  // ---------------------------------------------------------------------------

  confirm() {
    if (!this.isHumanTurn() || this.pending.size === 0) return;
    this.commit([...this.pending]);
  }

  endTurn() {
    if (!this.isHumanTurn()) return;
    this.commit([...this.pending]);
  }

  clear() {
    if (!this.isHumanTurn()) return;
    this.pending = new Set();
    this.refresh();
  }

  commit(cells) {
    if (this.mode === "online") {
      this.pending = new Set();
      this.awaitingServer = true;
      this.refresh();
      this.submitFn({ type: "turn", cells });
      return;
    }

    const player = this.state.current;
    const { mineHit } = applyTurn(this.state, player, cells);
    this.pending = new Set();

    if (mineHit) this._triggerMineHit();

    if (isGameOver(this.state)) {
      this.refresh();
      this.showGameOver();
      return mineHit;
    }
    this.refresh();
    this.maybeRunAI();
    return mineHit;
  }

  maybeRunAI() {
    if (this.isMiningPhase()) { this.maybeRunAIMine(); return; }
    if (isGameOver(this.state)) return;
    if (!this.currentPlayer.isAI) return;
    this.aiThinking = true;
    this.refresh();
    setTimeout(() => {
      const player = this.state.current;
      const memory = this.aiMemory[player];
      const cells = chooseMove(this.state, player, memory);
      this.aiThinking = false;
      const mineHit = this.commit(cells);
      recordMoveResult(memory, cells, mineHit);
    }, AI_DELAY_MS);
  }

  // ---------------------------------------------------------------------------
  // Mine-hit flash
  // ---------------------------------------------------------------------------

  _triggerMineHit() {
    this._clearMineHitTimer();
    this._showingMineHit = true;
    this._mineHitTimer = setTimeout(() => {
      this._showingMineHit = false;
      this._mineHitTimer = null;
      this.refresh();
    }, MINE_HIT_MSG_MS);
  }

  _clearMineHitTimer() {
    if (this._mineHitTimer) { clearTimeout(this._mineHitTimer); this._mineHitTimer = null; }
    this._showingMineHit = false;
  }

  // ---------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------

  refresh() {
    const state = this.state;
    const player = state.current;
    const mining = this.isMiningPhase();

    // The active placer's own mines (shown only to them during placement).
    const ownMines = (mining && this.minesByPlayer[player]) || new Set();
    const frontier = (!mining && this.isHumanTurn())
      ? new Set(legalFrontier(state, player, this.pending))
      : new Set();

    for (let idx = 0; idx < this.cellEls.length; idx++) {
      const cell = this.cellEls[idx];
      const owner = state.grid[idx];
      cell.className = "cell";
      cell.style.removeProperty("--owner");
      if (cell.firstChild) cell.replaceChildren(); // clear any placer dots

      if (owner !== null) {
        cell.classList.add("owned");
        cell.style.setProperty("--owner", state.players[owner].color);
      }

      if (mining) {
        if (ownMines.has(idx)) {
          // Show the active placer their own mines.
          cell.classList.add("mine-own");
        } else if (this.isMyMiningTurn() && cellLegalForMine(state, idx)) {
          cell.classList.add("mine-target");
        }
      } else {
        // Reveal enclosed mines (owned cell + mine) to everyone, with a colored dot
        // per player who placed a mine there.
        const placers = state.mineOwners && state.mineOwners[idx];
        if (owner !== null && placers && placers.length) {
          cell.classList.add("mine-revealed");
          const dots = document.createElement("span");
          dots.className = "mine-dots";
          for (const pl of placers) {
            const d = document.createElement("span");
            d.className = "mine-dot";
            d.style.background = state.players[pl].color;
            d.title = state.players[pl].name;
            dots.appendChild(d);
          }
          cell.appendChild(dots);
        }
        if (this.pending.has(idx)) {
          cell.classList.add("pending");
          cell.style.setProperty("--owner", state.players[player].color);
        } else if (frontier.has(idx) && this.pending.size < turnLimit(state, player)) {
          cell.classList.add("legal");
        }
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
      const mineBonus = (state.mineScores || [])[p.index] || 0;
      const bonusBadge = mineBonus > 0 ? ` <span class="mine-bonus">+${mineBonus}💣</span>` : "";
      chip.innerHTML = `
        <span class="swatch" style="background:${p.color}"></span>
        <span class="who">${p.name}${p.isAI ? " (AI)" : ""}</span>
        <span class="count">${sc[p.index]}${bonusBadge}</span>`;
      hud.appendChild(chip);
    });

    const info = document.createElement("div");
    info.className = "empty-count";
    info.textContent = `${empty} empty`;
    hud.appendChild(info);
  }

  renderControls() {
    const mining = this.isMiningPhase();
    // Hide action buttons during mining phase.
    this.els.confirmBtn.disabled = mining || !this.isHumanTurn() || this.pending.size === 0;
    this.els.endBtn.disabled    = mining || !this.isHumanTurn();
    this.els.clearBtn.disabled  = mining || !this.isHumanTurn() || this.pending.size === 0;

    if (this._showingMineHit) {
      this.els.status.textContent = "💥 Mine hit! Turn skipped.";
      return;
    }

    const player = this.currentPlayer;
    const limit = turnLimit(this.state, player.index);

    if (mining) {
      const placed = (this.state.minesPlaced || [])[player.index] || 0;
      const total = this.state.minesPerPlayer || 0;
      if (this.isMyMiningTurn() && !this.aiThinking) {
        this.els.status.textContent =
          `Place mine ${placed + 1} of ${total} — click any non-border cell.`;
      } else {
        this.els.status.textContent =
          `Waiting for ${player.name} to place mines… (${placed}/${total})`;
      }
      return;
    }

    if (this.mode === "online" && !isGameOver(this.state)) {
      const seedPick =
        this.state.seedMode === "pick" && this.state.movesMade[player.index] === 0;
      if (this.awaitingServer) {
        this.els.status.textContent = "Sending move…";
      } else if (this.isHumanTurn()) {
        this.els.status.textContent = seedPick
          ? "Your turn — pick your starting cell."
          : `Your turn — select up to ${limit} cells (${this.pending.size}/${limit}).`;
      } else {
        this.els.status.textContent = `Waiting for ${player.name}…`;
      }
      return;
    }

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

  // ---------------------------------------------------------------------------
  // Game over
  // ---------------------------------------------------------------------------

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
      const mineBonus = (this.state.mineScores || [])[p.index] || 0;
      const bonusTxt = mineBonus > 0 ? ` (+${mineBonus}💣)` : "";
      row.innerHTML = `
        <span class="swatch" style="background:${p.color}"></span>
        <span>${p.name}${p.isAI ? " (AI)" : ""}</span>
        <strong>${sc[p.index]}${bonusTxt}</strong>`;
      this.els.resultScores.appendChild(row);
    });
    this.els.gameover.classList.remove("hidden");
  }
}
