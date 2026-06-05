# Tetrar

A tiny territory game for the browser. *Tetra* = the four cells you claim each turn.

## Rules

On an `n × n` grid, players take turns claiming up to **4** empty cells. Every cell
you claim must be orthogonally (4-) connected to your existing territory — or to
another cell you're claiming in the **same** turn, so you can snake out a chain of
four. If you can place fewer than four (blocked by edges, walls of opponents, or
filled space), place what you can and end your turn. When nobody can move, whoever
holds the most cells wins.

**Enclosure:** if you wall off a region of empty cells so that your color (together
with the board edges) is the only thing bordering it, those empty cells are captured
and become yours.

**Mines:** before the game, each player secretly places a number of mines on interior
cells (placement is blind — you never see opponents' mines, and two mines on the same
cell count as separate mines for scoring). During play, if any cell you select is a
mine — anyone's, including your own — your **entire turn is skipped**, and you aren't
told which cell did it, so you may want to probe with fewer than four cells to scout
safe ground. Your starting foothold is mine-safe; mines only bite during the territory
battle. Enclosing a region reveals any mines in it (with a colored dot showing each
player who placed one) and awards **bonus points for every enclosed mine that isn't
your own** — so capturing opponents' minefields pays off, but burying your own under
your territory does not.

## Options

- **Grid size** — 5×5 up to 15×15.
- **Mode** — local hotseat (2–4 humans), vs a greedy in-browser AI, or **online**
  (2–4 humans across the internet — see [Online play](#online-play) below).
- **Players** — 2 to 4.
- **Seeding** — how the first foothold is granted (all three are playtestable):
  - **Auto-seed corners** — each player starts owning one corner.
  - **Pick a starting cell** — each player claims one free cell on their first turn.
  - **Free first move** — first turn places 4 cells anywhere (mutually connected).
- **Mines / player** — how many mines each player hides before the game (0 disables
  the whole mining phase).
- **Mine points** — bonus points awarded per mine you enclose.

## Run locally

ES modules need to be served over HTTP (not opened as `file://`):

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

## Online play

Online mode keeps the site fully static (still GitHub Pages friendly) and uses
**Firebase Realtime Database** as the shared, real-time source of truth. Players
create or join a room (by code or shared link), and each turn syncs through the DB.
Moves are applied in a transaction that only accepts a legal move from the player
whose turn it is, so the shared state can't be corrupted.

It's **off until you add a Firebase project** — local and AI play work without it.

### One-time setup

1. Create a free project at <https://console.firebase.google.com/>.
2. In the project, **Build → Realtime Database → Create Database**. Pick a location;
   start in **test mode** to get going (lock it down before sharing widely — see
   below).
3. **Project settings → Your apps → Web app (`</>`)**, register an app, and copy the
   `firebaseConfig` values.
4. Paste them into [`js/firebase-config.js`](js/firebase-config.js). The key field
   for Realtime Database is `databaseURL`
   (`https://<project>-default-rtdb.firebaseio.com`).
5. Reload. "Play online" now opens the lobby.

The web config is **not secret** — it's meant to ship in the client. Access is
governed by your database rules.

### Database rules

Test mode is fine for trying it out. A reasonable starting point that scopes access
to the `rooms` tree (still open, suitable for a friendly game) is:

```json
{
  "rules": {
    "rooms": {
      ".read": true,
      ".write": true
    }
  }
}
```

For anything public-facing, tighten these (e.g. validate structure, rate-limit, or
add Firebase Auth) — game-logic validation already happens client-side in the move
transaction, but rules are your real guard.

### How a game works

- Host picks grid size + seeding on the menu, clicks **Play online → Create room**,
  and shares the code or the `#CODE` link.
- Others open the link (or enter the code), type a name, and join the lobby.
- When 2–4 players are in, the host starts. Turns sync live; a refresh or reconnect
  rejoins the same seat (your player id is remembered in `localStorage`).

> Note: this is a friendly-play setup. If the player whose turn it is disconnects,
> the game waits on them (no auto-skip yet).

## Project layout

```
index.html             markup: menu, online lobby, board, scoreboard, overlay
css/styles.css         board grid, player colors, lobby, highlights
js/game.js             pure rules engine (no DOM): legality, capture, scoring, end
js/ai.js               greedy bot built on the engine
js/ui.js               DOM rendering, drag-select, local + online turn flow
js/online-core.js      pure online state: build/serialize + authoritative applyMove
js/net.js              Firebase Realtime DB wiring (rooms, presence, move txns)
js/online.js           lobby UI + room subscription, bridges state into the GameUI
js/firebase-config.js  your Firebase project config (enables online play)
js/main.js             entry point wiring the menu, local game, and lobby
```

## Deploy to GitHub Pages

It's a static site at the repo root, so no build step is needed:

1. Push this repo to GitHub.
2. Settings → Pages → Source = `main` branch, `/ (root)`.
3. The site serves at `https://<user>.github.io/tetrar/`.
