// Entry point: wires the start menu to the game UI and the online lobby.

import { GameUI } from "./ui.js";
import { initOnline } from "./online.js";
import { isOnlineAvailable } from "./net.js";

const $ = (id) => document.getElementById(id);

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

// Show exactly one top-level section and hide the game-over overlay.
const sections = { menu: $("menu"), lobby: $("lobby"), game: $("game") };
function show(name) {
  for (const key of Object.keys(sections)) {
    sections[key].classList.toggle("hidden", key !== name);
  }
  $("gameover").classList.add("hidden");
}

const online = initOnline({ ui, show });

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

function startLocal() {
  show("game");
  ui.start(readConfig());
}

function backToMenu() {
  online.exit();
  show("menu");
}

$("start-btn").addEventListener("click", startLocal);
$("online-btn").addEventListener("click", () => online.openLobby(readConfig()));
$("lobby-back-btn").addEventListener("click", backToMenu);
$("confirm-btn").addEventListener("click", () => ui.confirm());
$("end-btn").addEventListener("click", () => ui.endTurn());
$("clear-btn").addEventListener("click", () => ui.clear());
$("newgame-btn").addEventListener("click", backToMenu);
$("again-btn").addEventListener("click", backToMenu);

// If the page is opened via a shared room link, jump straight to the lobby.
if (location.hash.length > 1 && isOnlineAvailable()) {
  online.openLobby(readConfig());
}
