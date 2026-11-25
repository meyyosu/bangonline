# Project guidance for coding agents

## Project overview

Bang! Online is a Vietnamese web implementation of the original Bang! board game
for 4–7 players. It supports accounts, room codes and invitation links, live game
updates, room chat, and reconnecting to an ongoing game.

Use Vietnamese for user-facing game text and error messages; keep card and
character names in English. Existing guidance in `CLAUDE.md` also calls for
communicating with users in Vietnamese.

## Stack and conventions

- Node.js 18 or later, CommonJS modules, and built-in Node.js APIs only for the
  application. No dependency installation is needed to run it.
- The frontend uses plain HTML, CSS, and JavaScript, with no build step.
- Do not add frameworks or runtime dependencies without the user's agreement.
- Follow the surrounding style: `'use strict'`, two-space indentation,
  semicolons, and single-quoted JavaScript strings.
- Keep changes focused on the requested behavior and preserve the existing
  separation between game rules, HTTP transport, and presentation.

## Repository map

| Path | Responsibility |
| --- | --- |
| `game.js` | `Game` class, card/character/role metadata, rules, actions, and player-specific views. Exports `Game`, `GameError`, and metadata. |
| `server.js` | HTTP API, static files, authentication, rooms, chat, and Server-Sent Events (SSE). |
| `public/index.html` | Page shell. |
| `public/app.js` | Client API calls, SSE subscriptions, rendering, and transient `ui` state. |
| `public/style.css` | Game and lobby styling. |
| `test/sim.js` | Seeded random game simulation and card-count checks. |
| `test/e2e.js` | Playwright browser smoke test with four isolated player contexts. |
| `CHAY-GAME.bat` | Windows entry point for `tools/start.ps1`. |
| `tools/start.ps1` | Node discovery/download, firewall setup, Radmin VPN address discovery, and server startup. |
| `data/` | Generated account and session storage; ignored by Git. |

## Run locally

From the repository root:

```powershell
node server.js
# Equivalent: npm start
```

Open `http://localhost:3000`. To use another port in PowerShell:

```powershell
$env:PORT = '8080'
node server.js
```

Windows players can run `CHAY-GAME.bat`. The launcher can download portable Node
and configure the firewall, so use direct Node startup for routine development.

## Architecture and invariants

- Keep game rules in `game.js`, independent of HTTP and browser APIs. Invalid
  game actions use `GameError` with Vietnamese messages.
- Reactions and multi-step actions use `pending` and `queue`; preserve their
  ordering when changing combat, drawing, or character abilities.
- The server is authoritative. Room actions arrive at
  `POST /api/rooms/:code/action` with an `{ action }` body.
- Send game state through `Game.viewFor(name)`. Preserve hidden hands and roles;
  never broadcast the complete internal game object to clients.
- Room SSE payloads are personalized per connected player. The client rerenders
  room/game content on updates, while transient interaction state lives in `ui`.
- Preserve the original 80-card deck, 16 characters, supported role sets, turn
  order, distance/range rules, and card conservation across all card locations.
- Accounts use salted scrypt password hashes and an `sid` session cookie.
  Accounts and sessions persist in `data/users.json` and `data/sessions.json`;
  rooms and active games exist only in memory and disappear on server restart.
- Escape user-provided strings in rendered HTML using the existing `esc` helper.
  Retain authentication and room-membership checks when changing endpoints.

## Validation

- After any `game.js` change, run `npm test` or `node test/sim.js 100`. The
  simulation checks card conservation across expansion settings and exercises player views.
  For a specific rule fix, also verify the affected scenario directly; random
  simulation alone does not prove every rule is correct.
- For syntax checks, use `node --check` on changed JavaScript files.
- For UI or API changes, verify the relevant flow with a running server:
  registration/login, room creation/joining, starting with at least four players,
  actions and reactions, chat, and reconnecting as applicable.
- `node test/e2e.js` requires a server at `http://localhost:3000`, Playwright, and
  a Chromium browser installation. It currently imports Playwright from the
  environment-specific absolute path `/opt/npm-tools/node_modules/playwright`;
  check availability before running. Playwright is not declared in
  `package.json`. The test creates persistent test accounts and ignored PNGs in
  `test/`.
- Report what was actually checked and any unavailable tooling. There is no
  configured build, lint, or formatting command.

## Existing behavior to preserve

Characters are assigned randomly. Beer is used automatically when dying, with
Sid Ketchum's automatic discard fallback when applicable. Lucky Duke chooses a
favorable check automatically. Treat these as intentional simplifications unless
the requested change explicitly revises them.

## Files and platform details

- Keep `tools/start.ps1` encoded as UTF-8 with BOM and CRLF line endings for
  Vietnamese text under Windows PowerShell 5.1.
- Keep `CHAY-GAME.bat` ASCII with CRLF line endings.
- Do not commit generated accounts, sessions, screenshots, `node_modules/`,
  portable `node/`, or `node-tmp/`; these are covered by `.gitignore`.
- Update `README.md` when changing startup instructions or documented gameplay.
