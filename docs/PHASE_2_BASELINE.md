# Playm8te — Phase 2 Baseline

Date: 2026-09-01 (UTC)
Node: v22.22.2 | npm: 10.9.7 | Postgres: 16
Environment: ephemeral sandbox — see "Environment note" at bottom.

## Commands executed

| Command | Result |
|---|---|
| `npm install` | PASS |
| `npm run typecheck` | **PASS** — 0 errors |
| `npm run lint` | **FAIL — no script configured.** `package.json` has no `lint` script and no ESLint config exists in the repo. This is a real gap against Gate A, not a false negative. |
| `npm run build` | **PASS** |
| `npm test` | **PASS** — 41/41 tests, 7 files (after a transient Postgres connection drop on the first attempt in this session — re-run clean; noted under "Known environment limitations" below, not a code defect) |

## Gate-by-gate status

**GATE A (typecheck/lint/build PASS)** — **PARTIAL FAIL.** Typecheck and build both pass with zero errors. Lint is unconfigured, so this gate cannot be honestly marked PASS.

**GATE B (all critical tests PASS)** — **PASS.** 41 tests covering chess legality (legal/illegal/turn-order/checkmate/stalemate/restart-reconstruction), personality differentiation, safety filtering (including prompt-injection detection), auth (register/duplicate/login/token verify/refresh rotation/logout), memory consolidation (candidate→confirmed promotion, concurrency regression), statistics (draw-vs-decisive regression, concurrent-claim regression), and full HTTP match lifecycle with cross-user authorization checks.

**GATE C (fresh migration PASS)** — **PASS.** 3 migrations (`init`, `seed_personalities`, `add_stats_recorded_guard`) apply cleanly to both `playm8te` and `playm8te_test`; rollback/re-apply was verified in an earlier session. Migrations are authoritative — no hand-run SQL exists outside them (the earlier flat `schema.sql` was deleted when migrations were introduced).

**GATE D (auth/authorization PASS)** — **PASS**, per integration tests: unauthenticated requests to protected endpoints return 401; a user cannot use another user's companion to create a match (403); a user cannot view another user's match (403); WebSocket connections without a token, with an invalid token, or for a match the user isn't a member of are all rejected (verified manually against a live server in a prior session — not yet covered by an automated test, see Remaining Gaps).

**GATE E (real chess engine)** — **FAIL.** This is the explicit top priority for this phase and is not yet done. `ChessAdapter.requestAIRecommendation` still returns a random-weighted-toward-captures move, not a real engine evaluation. This is today's primary work item.

**GATE F (AI contextual interaction)** — **PARTIAL.** `ConversationService` builds prompts from personality + memory + game state and is wired into a relevance-filtered event loop (`DecisionLoop`) that reacts to a curated set of event types rather than every move, with a deterministic fallback provider when the AI provider is unavailable. Not yet verified: a real player→M8 question ("why did you make that move?") answered with grounded board/engine facts — the `CompanionContextBuilder` concept from this phase's spec doesn't exist yet as a distinct component.

**GATE G (mobile application completes the vertical slice)** — **NOT VERIFIED / NOT ATTEMPTED.** No Android toolchain (SDK, Gradle, emulator) is available in this sandbox, and building a mobile app without any way to run or verify it would produce unverified code, which contradicts the standing "never claim something works unless tested" rule. This needs a different environment (Claude Code against a real Android setup, or a developer's machine) and is flagged as out of scope for this session rather than silently skipped.

**GATE H (restart/reconnect preserves match state)** — **PASS**, verified manually in a prior session: a match's FEN, turn, and color assignment all survive a server restart, and play can continue correctly afterward (this required fixing a real bug where restored player color was being dropped). Not yet covered by an automated test — currently only manually verified.

## Known bugs fixed in prior sessions (context for this baseline)

- Illegal/out-of-turn moves returned HTTP 500 instead of 400.
- AI companion never actually moved (no auto-move wiring existed).
- Restart recovery dropped player color, breaking turn tracking.
- Memory consolidation race caused double-counted observations.
- Statistics recording credited both a "win" and a "draw" for the same drawn match (root cause: `recordResult`'s win-branch fired unconditionally regardless of `isDraw`).
- `AppError` base class was silently breaking `instanceof` checks for every subclass (harmful `setPrototypeOf` call).
- JWTs issued within the same second were byte-identical (no unique claim).
- A common prompt-injection phrasing ("ignore all **previous** instructions") slipped past the regex filter.

## Remaining technical debt (carried into this phase)

- No lint configuration (Gate A gap).
- No automated test for WebSocket auth/authorization (manually verified only).
- No automated test for restart recovery (manually verified only).
- `docs/TECHNICAL_DEBT.md`, `docs/API.md`, `docs/adr/`, `docker-compose.yml`, dependency audit doc — none exist yet.
- Chess AI is still random-move (this phase's primary task).

## Known environment limitations

This sandbox is ephemeral: on at least one occasion this engagement, the entire filesystem and installed software (including Postgres) were wiped between conversation turns with no warning, destroying uncommitted work. Postgres itself does not persist as a running service between tool calls within a turn even when the filesystem does — it must be explicitly restarted at the start of most command sequences. Mitigation in place: work is snapshotted to a downloadable zip after each verified milestone. This is not a substitute for a real git remote, which is recommended before continuing this project outside this session.
