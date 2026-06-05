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

// Live labels for range sliders.
function liveLabel(inputId, outId, fmt) {
  const input = $(inputId), out = $(outId);
  const update = () => { out.textContent = fmt(input.value); };
  input.addEventListener("input", update);
  update();
}
liveLabel("opt-size",      "opt-size-out",     (v) => `${v} × ${v}`);
liveLabel("opt-mines",     "opt-mines-out",    (v) => v === "0" ? "off" : v);
liveLabel("opt-mine-pts",  "opt-mine-pts-out", (v) => v);

function readConfig() {
  return {
    n: parseInt($("opt-size").value, 10),
    numPlayers: parseInt($("opt-players").value, 10),
    seedMode: $("opt-seed").value,
    vsAI: $("opt-mode").value === "ai",
    minesPerPlayer: parseInt($("opt-mines").value, 10),
    minePoints: parseInt($("opt-mine-pts").value, 10),
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
