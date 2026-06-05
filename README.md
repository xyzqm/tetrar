# Tetrar

A tiny territory game for the browser. *Tetra* = the four cells you claim each turn.

## Rules

On an `n × n` grid, players take turns claiming up to **4** empty cells. Every cell
you claim must be orthogonally (4-) connected to your existing territory — or to
another cell you're claiming in the **same** turn, so you can snake out a chain of
four. If you can place fewer than four (blocked by edges, walls of opponents, or
filled space), place what you can and end your turn. When nobody can move, whoever
holds the most cells wins.

## Options

- **Grid size** — 5×5 up to 15×15.
- **Mode** — local hotseat (2–4 humans) or vs a greedy in-browser AI.
- **Players** — 2 to 4.
- **Seeding** — how the first foothold is granted (all three are playtestable):
  - **Auto-seed corners** — each player starts owning one corner.
  - **Pick a starting cell** — each player claims one free cell on their first turn.
  - **Free first move** — first turn places 4 cells anywhere (mutually connected).

## Run locally

ES modules need to be served over HTTP (not opened as `file://`):

```sh
python3 -m http.server 8000
# open http://localhost:8000/
```

## Project layout

```
index.html      markup: start menu, board, scoreboard, game-over overlay
css/styles.css  board grid, player colors, legal/pending highlights
js/game.js      pure rules engine (no DOM): state, legality, scoring, end detection
js/ai.js        greedy bot built on the engine
js/ui.js        DOM rendering, click handling, turn flow
js/main.js      entry point wiring the menu to the game
```

## Deploy to GitHub Pages

It's a static site at the repo root, so no build step is needed:

1. Push this repo to GitHub.
2. Settings → Pages → Source = `main` branch, `/ (root)`.
3. The site serves at `https://<user>.github.io/tetrar/`.
