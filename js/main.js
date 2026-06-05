// Entry point: wires the start menu to the game UI.

import { GameUI } from "./ui.js";

const $ = (id) => document.getElementById(id);

const menu = $("menu");
const gameSection = $("game");

const ui = new GameUI({
  board: $("board"),
  hud: $("hud"),
  status: $("status"),
  confirmBtn: $("confirm-btn"),
  endBtn: $("end-btn"),
  clearBtn: $("clear-btn"),
  gameover: $("gameover"),
  resultTitle: $("result-title"),
  resultScores: $("result-scores"),
});

// Live label for the grid-size slider.
const sizeInput = $("opt-size");
const sizeOut = $("opt-size-out");
const updateSizeLabel = () => {
  sizeOut.textContent = `${sizeInput.value} × ${sizeInput.value}`;
};
sizeInput.addEventListener("input", updateSizeLabel);
updateSizeLabel();

function readConfig() {
  return {
    n: parseInt(sizeInput.value, 10),
    numPlayers: parseInt($("opt-players").value, 10),
    seedMode: $("opt-seed").value,
    vsAI: $("opt-mode").value === "ai",
  };
}

function startGame() {
  menu.classList.add("hidden");
  gameSection.classList.remove("hidden");
  ui.start(readConfig());
}

function backToMenu() {
  gameSection.classList.add("hidden");
  $("gameover").classList.add("hidden");
  menu.classList.remove("hidden");
}

$("start-btn").addEventListener("click", startGame);
$("confirm-btn").addEventListener("click", () => ui.confirm());
$("end-btn").addEventListener("click", () => ui.endTurn());
$("clear-btn").addEventListener("click", () => ui.clear());
$("newgame-btn").addEventListener("click", backToMenu);
$("again-btn").addEventListener("click", backToMenu);
