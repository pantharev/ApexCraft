# ApexCraft multiplayer server

A small **Express + Socket.IO** server that hosts co-op rooms. It is a
long-running Node process (not a static site) — it holds the live WebSocket
connections between players and relays block edits, player positions, and mob
snapshots. See [docs/MODDING.md](../docs/MODDING.md) and the root README for the
gameplay side.

## What deploys where

There are two different things, and they are **not** interchangeable:

| Artifact   | What it is                    | Where it goes                          |
| ---------- | ----------------------------- | -------------------------------------- |
| `dist/`    | the built **client** (static) | any static host (Vercel) — or served by this server |
| `server/`  | this **Node process**         | an always-on host (Render/Railway/Fly) |

You do **not** "deploy `/dist`" *or* "deploy `/server`" — for online play you
run **this server**, and it serves `dist/` itself (`express.static`). So a
single deploy of this server hosts the whole game. (Vercel can't host it:
serverless functions can't hold persistent WebSocket connections.)

## Run locally

```bash
npm install
npm run build     # produce dist/ (the server serves it at /)
npm start         # or: npm run server   → http://localhost:3001
```

Open http://localhost:3001 and use **Host** / **Join** on the title screen.
During development you can instead run `npm run dev` (client on :5188) next to
`npm start` (server on :3001) — on localhost the client finds the server
automatically.

## Deploy (recommended: one service hosts everything)

### Render

1. Push to GitHub.
2. Render → **New → Blueprint**, select this repo. It reads
   [`render.yaml`](../render.yaml):
   - build: `npm install && npm run build`
   - start: `npm start`
   - health check: `/health`
3. Done — the service URL hosts both the game and multiplayer.

### Railway

1. Railway → **New Project → Deploy from GitHub repo**.
2. It auto-detects Node and runs `npm install` → `npm run build` → `npm start`
   (the `start` script and `engines.node` in `package.json` make this work).
3. Generate a domain; that URL hosts everything.

### Fly.io / a VPS

`npm install && npm run build`, then `npm start`. The server listens on
`process.env.PORT` (default `3001`).

## Split hosting (client on Vercel, server elsewhere)

If you prefer to keep the static client on Vercel and run only the server on
Render/Railway, build the Vercel client with the server's URL:

```bash
VITE_GAME_SERVER=https://your-server.onrender.com npm run build
```

(Set `VITE_GAME_SERVER` as an environment variable in the Vercel project.) The
client will connect there instead of same-origin.

## Tests

```bash
node server/test.js
```

Boots the server on a test port and exercises the full protocol (host/join,
edit sync, mob snapshots, hit routing, host migration). Runs in CI.
