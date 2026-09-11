# Playm8te — Technical Debt Register

## P0 — Blocks correctness/security

*(none currently open — the one P0 found this session, the production-config
secret-validation bug below, is fixed)*

**[FIXED this session] Production startup always rejected valid secrets.**
`assertProductionConfig`'s fallback-secret check was built from
`config.auth.jwtAccessSecret`/`jwtRefreshSecret` — which themselves equal
"whatever the current env var is, or the dev fallback." That made the
check tautologically true for *any* configured secret, real or not, so
the app refused to boot in production unconditionally. Found via an actual
production-boot smoke test (not code review), fixed by comparing against
two literal constant strings instead, and covered by a permanent
regression test (`test/unit/config.test.ts`).

## P1 — Blocks a trustworthy MVP

- **No lint configuration.** `npm run lint` doesn't exist. Typecheck/tests/build
  are all real gates; lint is not. Should add ESLint with a reasonable
  TypeScript config before calling engineering quality "complete."
- **Legacy `engine_state` rows have no recorded `moveNumber`.** Matches
  persisted before this session's fix only stored the bare `ChessBoardState`
  (no `moveNumber` field at all). `restoreActiveMatches` falls back to `0`
  for those specific rows and logs a warning — this is an honest,
  documented limitation for pre-existing data, not a bug in current code,
  but any match created before this fix will show an inaccurate move
  number in its UI (FEN/turn/legality are unaffected) until it completes.
- **CI workflow added but not run on real GitHub infrastructure.** Every
  individual command it calls (`npm install`, `npm run typecheck`,
  `npm run migrate`, `npm test`, `npm run build`) was verified working
  locally in this exact sequence, but the workflow file itself
  (`.github/workflows/ci.yml`) has not been executed by GitHub Actions —
  there's no way to do that from this environment. Verify on first real push.

## P2 — Important but can wait

- **Stockfish process-per-call, not pooled.** Each move/analysis spawns a
  fresh Stockfish process (~30-80ms startup overhead). Documented as
  acceptable for now; revisit if move latency becomes a real complaint
  under load.
- **WebSocket chat handler duplicates some logic** with the REST move
  handler (fetching companion/match data). Minor duplication, not urgent.
- **Tactical motif detection is intentionally limited** to
  check/checkmate/stalemate/capture/promotion/immediate-recapture — fork,
  pin, skewer, discovered attack, and back-rank-weakness detection are not
  implemented. Documented as a deliberate scope decision (avoiding false
  tactic claims) rather than an oversight; expanding this is real,
  scoped future work.
- **No puzzle generation, player chess profile, or hint system** —
  explicitly deferred phases from earlier planning, not started.

## P3 — Future optimization

- Netlify's `config.js` generation is a plain Node script rather than
  anything more sophisticated — fine for two variables, would need
  revisiting if the frontend ever needs more runtime configuration.
- No CDN/caching strategy for the static frontend beyond Netlify's defaults.

## Notable gotcha (not a bug, but a trap)

`TRUNCATE users ... CASCADE` in Postgres also wipes `companion_personalities`
built-in preset rows, because `companion_personalities.owner_id` references
`users` even for the NULL-owner preset rows — CASCADE truncates the entire
referencing table, not just matching rows. Test helpers
(`test/helpers/db.ts`) re-seed the presets after every truncate to work
around this. Worth knowing before manually resetting a local dev database.
