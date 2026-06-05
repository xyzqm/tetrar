// Firebase Realtime Database wiring for online play. The site stays static; this
// module talks to RTDB directly from the browser. The SDK is loaded lazily from the
// CDN the first time online play is used, so local games don't pay for it.

import { firebaseConfig, FIREBASE_ENABLED } from "./firebase-config.js";
import { PLAYER_DEFS, isGameOver } from "./game.js";
import { createOnlineState, serializeState, deserializeState, applyMove } from "./online-core.js";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";
const MAX_PLAYERS = 4;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous 0/O/1/I/L
const CODE_LEN = 5;

let db = null;
let fb = null; // bag of imported RTDB functions

export function isOnlineAvailable() {
  return FIREBASE_ENABLED;
}

// A stable per-browser player id and remembered display name (survive refresh).
export function getMyPid() {
  let pid = localStorage.getItem("tetrar.pid");
  if (!pid) {
    pid = (crypto.randomUUID && crypto.randomUUID()) || `p_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    localStorage.setItem("tetrar.pid", pid);
  }
  return pid;
}
export function getMyName() {
  return localStorage.getItem("tetrar.name") || "";
}
export function setMyName(name) {
  localStorage.setItem("tetrar.name", name);
}

async function init() {
  if (db) return;
  if (!FIREBASE_ENABLED) throw new Error("Online play is not configured (see js/firebase-config.js).");
  const appMod = await import(`${SDK}/firebase-app.js`);
  const dbMod = await import(`${SDK}/firebase-database.js`);
  const app = appMod.initializeApp(firebaseConfig);
  db = dbMod.getDatabase(app);
  fb = dbMod;
}

function randomCode() {
  let out = "";
  for (let i = 0; i < CODE_LEN; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function roomRef(code) {
  return fb.ref(db, `rooms/${code}`);
}

// Mark this player offline if the tab closes/disconnects.
function armPresence(code, pid) {
  const cRef = fb.ref(db, `rooms/${code}/players/${pid}/connected`);
  fb.set(cRef, true);
  fb.onDisconnect(cRef).set(false);
}

// Create a new room and seat the creator as host (slot 0). Returns { code, pid }.
export async function createRoom({ n, seedMode, name, minesPerPlayer = 3, minePoints = 10 }) {
  await init();
  const pid = getMyPid();
  setMyName(name);

  // Find a free code (collisions are astronomically rare, but check anyway).
  let code;
  for (let tries = 0; tries < 5; tries++) {
    code = randomCode();
    const snap = await fb.get(roomRef(code));
    if (!snap.exists()) break;
  }

  await fb.set(roomRef(code), {
    createdAt: fb.serverTimestamp(),
    hostPid: pid,
    config: { n, seedMode, minesPerPlayer, minePoints },
    status: "lobby",
    version: 0,
    players: {
      [pid]: { name, slot: 0, color: PLAYER_DEFS[0].color, connected: true, joinedAt: Date.now() },
    },
  });
  armPresence(code, pid);
  return { code, pid };
}

// Join an existing lobby (or rejoin a game already in progress). Returns { pid }.
export async function joinRoom({ code, name }) {
  await init();
  const pid = getMyPid();
  setMyName(name);

  const snap = await fb.get(roomRef(code));
  if (!snap.exists()) throw new Error("Room not found");
  const room = snap.val();
  const already = room.players && room.players[pid];

  if (room.status !== "lobby" && !already) {
    throw new Error("That game has already started");
  }

  // Atomically assign the next free slot.
  const playersRef = fb.ref(db, `rooms/${code}/players`);
  const res = await fb.runTransaction(playersRef, (players) => {
    players = players || {};
    if (players[pid]) {
      players[pid].name = name; // allow name update on rejoin
      return players;
    }
    const used = new Set(Object.values(players).map((p) => p.slot));
    if (Object.keys(players).length >= MAX_PLAYERS) return; // abort: full
    let slot = 0;
    while (used.has(slot)) slot++;
    players[pid] = { name, slot, color: PLAYER_DEFS[slot].color, connected: true, joinedAt: Date.now() };
    return players;
  });
  if (!res.committed) throw new Error("Room is full");

  armPresence(code, pid);
  return { pid };
}

// Subscribe to a room. `cb` receives the room object (or null if it vanishes).
// Returns an unsubscribe function.
export async function watchRoom(code, cb) {
  await init();
  const unsub = fb.onValue(roomRef(code), (snap) => cb(snap.val()));
  return unsub;
}

// Host: build the initial shared state from the seated players and start the game.
export async function startGame(code) {
  await init();
  const snap = await fb.get(roomRef(code));
  if (!snap.exists()) throw new Error("Room not found");
  const room = snap.val();
  const seated = Object.entries(room.players || {})
    .map(([pid, p]) => ({ pid, name: p.name, color: p.color, slot: p.slot }))
    .sort((a, b) => a.slot - b.slot);
  if (seated.length < 2) throw new Error("Need at least 2 players");

  const state = createOnlineState({
    n: room.config.n,
    seedMode: room.config.seedMode,
    minesPerPlayer: room.config.minesPerPlayer ?? 3,
    minePoints: room.config.minePoints ?? 10,
    players: seated.map((p) => ({ pid: p.pid, name: p.name, color: p.color })),
  });

  await fb.update(roomRef(code), {
    status: "playing",
    stateJson: serializeState(state),
    version: 0,
  });
}

// Submit a move or mine placement. Runs as a transaction so only a legal action by
// the player whose turn it is takes effect; everything else aborts.
// `action` = { type: 'turn', cells: [...] } or { type: 'mine', idx: N }
export async function submitMove(code, pid, action) {
  await init();
  const res = await fb.runTransaction(roomRef(code), (room) => {
    if (!room || !room.stateJson) return room;
    // Allow moves during both "playing" and "mining" phases (status is "playing" for both).
    const state = deserializeState(room.stateJson);
    const out = applyMove(state, pid, action);
    if (!out.ok) return; // abort: not your turn / illegal
    room.stateJson = serializeState(state);
    room.version = (room.version || 0) + 1;
    room.status = isGameOver(state) ? "over" : "playing";
    room.lastMineHit = out.mineHit || false;
    return room;
  });
  return res.committed;
}

// Leave a room: drop from the lobby, or just mark offline once a game is underway.
export async function leaveRoom(code, pid) {
  await init();
  const snap = await fb.get(roomRef(code));
  if (!snap.exists()) return;
  const room = snap.val();
  if (room.status === "lobby") {
    await fb.set(fb.ref(db, `rooms/${code}/players/${pid}`), null);
  } else {
    await fb.set(fb.ref(db, `rooms/${code}/players/${pid}/connected`), false);
  }
}
