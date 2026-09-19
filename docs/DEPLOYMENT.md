# Playm8te — Deployment Guide

This covers deploying the actual repository as it exists today: a static
frontend (`public/`) to Netlify, and the Node/Express/WebSocket backend to
a persistent-process host, backed by managed PostgreSQL with Stockfish
installed alongside the backend.

## Root cause of the original "Page not found" on Netlify

`public/index.html` is the frontend, but nothing told Netlify to look in
`public/` — with no `netlify.toml`, Netlify looks for `index.html` at the
repo root (both for drag-and-drop deploys, which publish exactly what's
uploaded, and for connected-repo deploys, which default the publish
directory to the repo root). It was never there — it's in `public/` — so
Netlify served its generic 404. `netlify.toml` (added) fixes this by
explicitly setting `publish = "public"`.

---

## 1. Frontend deployment (Netlify)

**Build command:** `node scripts/generate-frontend-config.js`
**Publish directory:** `public`

Both are already set in `netlify.toml` at the repo root — connecting the
repo to Netlify with default settings will pick these up automatically.

**Required environment variables** (Netlify dashboard → Site settings →
Environment variables):

| Variable | Purpose | Example |
|---|---|---|
| `API_URL` | Backend's public HTTPS URL | `https://api.playm8te.onrender.com` |
| `WS_URL` | Backend's public WSS URL (same host, `wss://` scheme) | `wss://api.playm8te.onrender.com` |

If these are unset, `config.js` defaults both to same-origin (empty
string), which only works if frontend and backend share an origin — not
the case once the backend is deployed separately, so **always set these**
for a real deployment.

**No redirect rules are needed** — this is a single static page with no
client-side router.

**Steps:**
1. Push this repository to a Git provider Netlify can connect to (GitHub/GitLab/Bitbucket).
2. In Netlify: "Add new site" → "Import an existing project" → connect the repo.
3. Netlify should auto-detect `netlify.toml`. Confirm build command = `node scripts/generate-frontend-config.js`, publish directory = `public`.
4. Set `API_URL` and `WS_URL` env vars (pointing at your backend — see section 2 — even before it's deployed; you can update these later).
5. Deploy. Visit the generated `*.netlify.app` URL and confirm the Playm8te login screen loads (verified in this session by serving `public/` standalone with a plain static file server — see Testing section below).

---

## 2. Backend deployment

**Recommended provider: Render** (or Railway/Fly.io — any host supporting a persistent Node process, outbound child-process spawning for Stockfish, and WebSockets). Netlify Functions cannot run this backend — see `docs/DEPLOYMENT_ARCHITECTURE.md` for why.

**Build command:** `npm install && npm run build`
**Start command:** `npm start`
**Migration command (run once per deploy with schema changes, NOT automatically on every boot):** `npm run migrate`

**Required environment variables:**

| Variable | Required | Purpose |
|---|---|---|
| `NODE_ENV` | Yes | Must be `production` — enables the startup guard below and disables verbose error responses. |
| `PORT` | No (defaults to 3000) | Most hosts inject this automatically. |
| `DATABASE_URL` | Yes | Managed Postgres connection string. Append `?sslmode=require` if your provider requires it. |
| `FRONTEND_URL` | Yes | Your exact Netlify origin, e.g. `https://playm8te.netlify.app`. Used for CORS and WebSocket origin validation. |
| `ANTHROPIC_API_KEY` | No | If omitted, the app uses the deterministic fallback provider; add the key later to enable real Anthropic-powered conversation. |
| `AI_MODEL` | No | Defaults to `claude-sonnet-4-6`. |
| `STOCKFISH_PATH` | No (defaults to `/usr/games/stockfish`) | See Stockfish section below — set this if your provider installs it elsewhere. |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | Yes | The app **refuses to start** in production with the built-in dev-fallback values. Generate with: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` (run twice, once per secret). |
| `ACCESS_TOKEN_TTL`, `REFRESH_TOKEN_TTL_DAYS`, `BCRYPT_ROUNDS` | No | Sensible defaults; see `.env.example`. |
| `RATE_LIMIT_*` | No | Sensible defaults; see `.env.example`. |

**Steps (Render as the concrete example):**
1. Create a "Web Service," connect this repository.
2. Build command: `npm install && npm run build`. Start command: `npm start`.
3. Add a Render PostgreSQL instance (or any managed Postgres); copy its connection string into `DATABASE_URL`.
4. Add a build/deploy hook (or a one-off shell) to run `npm run migrate` against that `DATABASE_URL` before the service starts serving traffic — do this explicitly per deploy that changes the schema, not automatically on every boot (see Migration Strategy below).
5. Install Stockfish in the service's environment — see Stockfish section.
6. Set all required environment variables above.
7. Deploy. Check `GET /health` (should return `{"status":"ok"}`) and `GET /ready` (should return `{"status":"ready","database":"healthy","stockfish":"healthy"}` — if `stockfish` reports `"unavailable"`, see the Stockfish section).
8. Point Netlify's `API_URL`/`WS_URL` at this service's public URL and redeploy the frontend.

---

## 3. Database (PostgreSQL)

- Any managed Postgres works — Render, Railway, Neon, Supabase, RDS.
- `DATABASE_URL` is the only required connection config; SSL is handled by
  including the appropriate query params in that URL if your provider needs it.
- **Migrations are authoritative.** `migrations/` contains every schema
  change as a versioned `node-pg-migrate` file — there is no separate
  `schema.sql` to fall out of sync with it.
- **Migration strategy:** run `npm run migrate` as an explicit deploy step
  (a Render "pre-deploy command," a manual `npm run migrate` invocation
  against the production `DATABASE_URL`, or a CI step gated on approval) —
  **never automatically on server start.** Automatic migrations on boot
  risk running a destructive change against production data during a
  routine restart/scale event, with no human in the loop.
- Verified this session: migrations apply cleanly to a completely fresh
  database (`npm run migrate` against an empty Postgres instance produces
  the full current schema with no manual SQL required).

---

## 4. Stockfish

- The backend spawns Stockfish as a child process per move/analysis via
  `child_process.spawn(STOCKFISH_PATH)` — it is not a server, just a binary
  that must exist on the backend's filesystem.
- `STOCKFISH_PATH` defaults to `/usr/games/stockfish` (the path when
  installed via `apt-get install stockfish` on Debian/Ubuntu, which is what
  most standard buildpacks provide).
- **Render/Railway (Debian-based buildpacks):** add a build step or
  Dockerfile line: `apt-get update && apt-get install -y stockfish`. If
  your provider's buildpack doesn't allow apt access, use a Dockerfile
  deployment instead (`FROM node:22-slim` + the same apt-get line) — most
  of these providers support deploying from a Dockerfile as an alternative
  to their buildpack.
- **Verify after deploy:** `GET /ready` reports `"stockfish": "healthy"` or
  `"unavailable"` explicitly — never silently. If unavailable, the app
  still runs (gameplay falls back to legal-random moves, and chess analysis
  reports `engineAvailable: false` instead of fabricating numbers), but
  chess intelligence quality is significantly degraded. **Do not consider
  the deployment complete with Stockfish unavailable** — this is a real
  production capability gap, not a cosmetic one.

---

## 5. Security configuration checklist

- [ ] `NODE_ENV=production` set — enables the startup guards below and hides stack traces from error responses.
- [ ] `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` set to real, randomly-generated values (app refuses to boot otherwise — verified this session).
- [ ] `FRONTEND_URL` set to the exact Netlify origin (app refuses to boot without it in production).
- [ ] CORS locked to `FRONTEND_URL` — verified this session that a request with a non-matching `Origin` header receives no `Access-Control-Allow-Origin` header.
- [ ] WebSocket connections validate `Origin` against `FRONTEND_URL` in production — verified this session (matching origin connects, non-matching origin is closed with code 1008).
- [ ] No secrets committed to the repository — `.env` is gitignored; `.env.example` contains placeholders only.
- [ ] Rate limiting active on auth and AI-invoking endpoints (already implemented; no config needed beyond defaults).

---

## 6. Testing this deployment locally before going live

A full production-mode simulation (`NODE_ENV=production` + real secrets +
real Postgres + real Stockfish) was run and verified this session:

- Server boots successfully with real, randomly-generated JWT secrets (this
  previously failed unconditionally due to a bug, now fixed and covered by
  an automated regression test).
- `GET /health` and `GET /ready` both respond correctly.
- Full HTTP journey (register → create companion → create match → play a
  move, with the AI auto-replying via real Stockfish) works with
  `Origin: https://<your-netlify-app>` headers matching `FRONTEND_URL`.
- WebSocket connections from the configured `FRONTEND_URL` origin succeed;
  connections from any other origin are rejected (code 1008).
- `public/` serves correctly as pure static files with zero Node backend
  involved (simulated via a plain static file server) — confirming the
  Netlify deploy will actually work once connected.

To repeat this yourself before a real deploy:
```bash
npm run build
npm run migrate   # against your target DATABASE_URL
NODE_ENV=production DATABASE_URL=... FRONTEND_URL=... \
  JWT_ACCESS_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))") \
  JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(48).toString('hex'))") \
  npm start
curl http://localhost:3000/health
curl http://localhost:3000/ready
```
