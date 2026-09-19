# Playm8te — Deployment Architecture

```
                                Browser
                                   │
                    ┌──────────────┴──────────────┐
                    │ HTTPS                        │ HTTPS / WSS
                    ▼                              ▼
              Netlify (static)              Node backend (Render/
              public/index.html              Railway/Fly.io/etc.)
              public/config.js                     │
              (generated at build              ┌───┼────────────────┐
               time from API_URL/WS_URL)       │   │                │
                                           PostgreSQL          Stockfish
                                           (managed,           (installed in
                                            e.g. Render/        the backend's
                                            Railway/Neon/        runtime env,
                                            Supabase)            spawned as a
                                                │                child process
                                                │                per analysis/move)
                                          migrations/
                                          (node-pg-migrate,
                                           run explicitly via
                                           `npm run migrate`,
                                           never automatically
                                           on server start)
                                                │
                                          Anthropic API
                                          (companion conversation;
                                           degrades to a deterministic
                                           fallback provider if
                                           unavailable/unconfigured)
```

## Component responsibilities

**Netlify (frontend)** — Serves `public/index.html` and `public/config.js` as static files. No Node runtime involved at request time; the only "build" step is writing `config.js` from environment variables (see `scripts/generate-frontend-config.js` and `netlify.toml`). Talks to the backend over HTTPS (REST) and WSS (live match state, chat).

**Node backend** — Express + `ws` in a single long-running process (not serverless — the WebSocket server and Stockfish child-process lifecycle both need a persistent process). Owns: authentication, authorization, chess rules enforcement (via `chess.js`), AI companion orchestration, and all business logic. Must run on a host that supports long-running processes and outbound TCP for WebSockets (Netlify Functions cannot do this, which is why the backend is NOT deployed to Netlify).

**PostgreSQL** — Source of truth for all durable state: users, companions, matches, game events, memories, statistics. Migrations (`migrations/`, run via `node-pg-migrate`) are the only authoritative schema-evolution mechanism — there is no separate `schema.sql` to fall out of sync (an earlier flat `schema.sql` was deleted when migrations were introduced).

**Stockfish** — A child process spawned per engine call (move selection, position analysis) via `child_process.spawn`, communicating over UCI via stdin/stdout. Not a server, not persistent — the backend process must simply have the `stockfish` binary available on its filesystem (see `STOCKFISH_PATH`). If unavailable, the app degrades (random-legal-move fallback for gameplay, `engineAvailable: false` for analysis) rather than crashing — see `docs/DEPLOYMENT.md` for per-provider install instructions.

**Anthropic API** — Used for companion conversation generation (personality-flavored reactions and chat responses). If `ANTHROPIC_API_KEY` is unset, the app runs against a deterministic fallback provider (generic placeholder lines). This keeps the MVP deployable without API spend; add the key later to enable real Anthropic-powered conversation.

## Why this split (not everything on Netlify)

Netlify Functions are short-lived, stateless, and don't support long-running WebSocket connections or spawning persistent child processes (Stockfish). Playm8te's realtime gameplay (live match state, AI moves, chat) and its chess engine both require a conventional, persistent Node server — so the backend stays on a traditional host (Render/Railway/Fly.io) while the frontend, which is genuinely static, deploys to Netlify.
