// Online play orchestration: the lobby, room subscription, and bridging the shared
// Firebase state into the existing GameUI. Local play is untouched.

import {
  isOnlineAvailable,
  getMyName,
  createRoom,
  joinRoom,
  watchRoom,
  startGame,
  submitMove,
  leaveRoom,
} from "./net.js";
import { deserializeState } from "./online-core.js";

const $ = (id) => document.getElementById(id);

export function initOnline({ ui, show }) {
  const els = {
    lobby: $("lobby"),
    name: $("lobby-name"),
    entry: $("lobby-entry"),
    createBtn: $("create-room-btn"),
    joinCode: $("join-code"),
    joinBtn: $("join-room-btn"),
    room: $("lobby-room"),
    code: $("room-code"),
    copyBtn: $("copy-link-btn"),
    playerList: $("player-list"),
    startBtn: $("host-start-btn"),
    hint: $("lobby-hint"),
    error: $("online-error"),
    setupNote: $("online-setup-note"),
    banner: $("online-banner"),
  };

  const ctx = {
    config: { n: 11, seedMode: "corners" },
    code: null,
    pid: null,
    unsub: null,
    inGame: false,
  };

  function setError(msg) {
    els.error.textContent = msg || "";
  }

  function showEntry() {
    els.room.classList.add("hidden");
    els.entry.classList.remove("hidden");
  }

  function showRoom() {
    els.entry.classList.add("hidden");
    els.room.classList.remove("hidden");
  }

  // Open the lobby screen. `config` carries grid size + seed mode chosen on the menu.
  function openLobby(config) {
    ctx.config = { n: config.n, seedMode: config.seedMode, minesPerPlayer: config.minesPerPlayer ?? 3, minePoints: config.minePoints ?? 10 };
    setError("");
    els.name.value = getMyName();
    els.banner.classList.add("hidden");
    show("lobby");

    if (!isOnlineAvailable()) {
      els.entry.classList.add("hidden");
      els.room.classList.add("hidden");
      els.setupNote.classList.remove("hidden");
      return;
    }
    els.setupNote.classList.add("hidden");
    showEntry();
    // Deep-link: a room code in the URL hash pre-fills the join field.
    const hashCode = location.hash.replace(/^#/, "").trim().toUpperCase();
    if (hashCode) els.joinCode.value = hashCode;
  }

  function requireName() {
    const name = els.name.value.trim().slice(0, 20);
    if (!name) {
      setError("Enter a name first.");
      els.name.focus();
      return null;
    }
    return name;
  }

  async function onCreate() {
    const name = requireName();
    if (!name) return;
    setError("");
    els.createBtn.disabled = true;
    try {
      const { code, pid } = await createRoom({ ...ctx.config, name });
      enterRoom(code, pid);
    } catch (e) {
      setError(e.message || "Could not create room.");
    } finally {
      els.createBtn.disabled = false;
    }
  }

  async function onJoin() {
    const name = requireName();
    if (!name) return;
    const code = els.joinCode.value.trim().toUpperCase();
    if (!code) {
      setError("Enter a room code.");
      return;
    }
    setError("");
    els.joinBtn.disabled = true;
    try {
      const { pid } = await joinRoom({ code, name });
      enterRoom(code, pid);
    } catch (e) {
      setError(e.message || "Could not join room.");
    } finally {
      els.joinBtn.disabled = false;
    }
  }

  function enterRoom(code, pid) {
    ctx.code = code;
    ctx.pid = pid;
    ctx.inGame = false;
    location.hash = code;
    els.code.textContent = code;
    showRoom();
    if (ctx.unsub) ctx.unsub();
    watchRoom(code, onRoom).then((unsub) => {
      ctx.unsub = unsub;
    });
  }

  // Called on every change to the room (lobby roster, game start, each move).
  function onRoom(room) {
    if (!room) {
      setError("The room was closed.");
      return;
    }

    if (room.status === "lobby") {
      renderLobby(room);
      return;
    }

    // Game is in progress (or over): hand state to the GameUI.
    if (!room.stateJson) return;
    const state = deserializeState(room.stateJson);
    if (!ctx.inGame) {
      ctx.inGame = true;
      showBanner(ctx.code);
      show("game");
      ui.beginOnline(state, ctx.pid, (action) => submitMove(ctx.code, ctx.pid, action));
    } else {
      ui.updateOnline(state, room.lastMineHit || false);
    }
  }

  function renderLobby(room) {
    const players = Object.entries(room.players || {})
      .map(([pid, p]) => ({ pid, ...p }))
      .sort((a, b) => a.slot - b.slot);

    els.playerList.innerHTML = "";
    players.forEach((p) => {
      const li = document.createElement("li");
      li.className = "player-row";
      const you = p.pid === ctx.pid ? " (you)" : "";
      const host = p.pid === room.hostPid ? " · host" : "";
      const off = p.connected === false ? " · offline" : "";
      li.innerHTML = `
        <span class="swatch" style="background:${p.color}"></span>
        <span>${escapeHtml(p.name)}${you}${host}${off}</span>`;
      els.playerList.appendChild(li);
    });

    const isHost = room.hostPid === ctx.pid;
    const enough = players.length >= 2;
    els.startBtn.classList.toggle("hidden", !isHost);
    els.startBtn.disabled = !enough;
    els.hint.textContent = isHost
      ? enough
        ? `${players.length} players in. Start when ready (up to 4).`
        : "Waiting for at least one more player to join…"
      : "Waiting for the host to start…";
  }

  async function onStart() {
    els.startBtn.disabled = true;
    try {
      await startGame(ctx.code);
    } catch (e) {
      setError(e.message || "Could not start the game.");
      els.startBtn.disabled = false;
    }
  }

  function shareUrl(code) {
    return `${location.origin}${location.pathname}#${code}`;
  }

  async function onCopyLink() {
    const url = shareUrl(ctx.code);
    try {
      await navigator.clipboard.writeText(url);
      els.copyBtn.textContent = "Copied!";
      setTimeout(() => (els.copyBtn.textContent = "Copy link"), 1500);
    } catch {
      // Clipboard may be blocked; show the URL so it can be copied manually.
      els.hint.textContent = url;
    }
  }

  function showBanner(code) {
    els.banner.classList.remove("hidden");
    els.banner.innerHTML = `Online · Room <strong>${code}</strong>`;
    const btn = document.createElement("button");
    btn.className = "ghost small";
    btn.textContent = "Copy link";
    btn.addEventListener("click", onCopyLink);
    els.banner.appendChild(btn);
  }

  // Tear down any online session (called when leaving to the menu).
  function exit() {
    if (ctx.unsub) {
      ctx.unsub();
      ctx.unsub = null;
    }
    if (ctx.code && ctx.pid) leaveRoom(ctx.code, ctx.pid).catch(() => {});
    ctx.code = null;
    ctx.pid = null;
    ctx.inGame = false;
    ui.mode = "local";
    els.banner.classList.add("hidden");
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }

  els.createBtn.addEventListener("click", onCreate);
  els.joinBtn.addEventListener("click", onJoin);
  els.startBtn.addEventListener("click", onStart);
  els.copyBtn.addEventListener("click", onCopyLink);

  return { openLobby, exit };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
