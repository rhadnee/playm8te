# Playm8te MVP — Phase 1 (Chess Arena)

Working modular-monolith backend proving the core loop: human plays chess
against an AI companion that reacts to real game events with a
personality-driven voice, remembers things across the match, and never
blocks gameplay waiting on the AI.

## What's implemented and tested

- **Chess engine**: `chess.js`-backed `ChessAdapter` implementing the
  game-agnostic `GameAdapter` interface (`getGameState`, `submitAction`,
  `getAvailableActions`, `onGameEvent`) — the seed of the future Playm8te SDK.
- **Event pipeline**: `GAME EVENT → RELEVANCE FILTER → AI DECISION →
  COMMUNICATION → MEMORY UPDATE`, implemented in `DecisionLoop`. Verified
  end-to-end with a real Scholar's Mate sequence (`MOVE_PLAYED`,
  `CAPTURE_MADE`, `CHECKMATE`, `PLAYER_WON`, `PLAYER_LOST`, `ROUND_ENDED` all
  fire correctly, phase transitions to `COMPLETE`).
- **Personality system**: 7 config-driven presets (competitive, funny,
  chill, coach, strategic, savage, supportive) — no hardcoded responses,
  personalities are data consumed when building the AI system prompt.
- **Memory**: `MemoryService` with real SHORT_TERM/LONG_TERM separation and
  a `retrieve()` layer that returns a small relevant slice — the full store
  is never sent to the model.
- **AIProvider abstraction**: `AnthropicProvider` implementation, plus a
  `DeterministicFallbackProvider` so the app degrades gracefully (never
  hard-fails) when no API key is configured — exercised in testing.
- **Safety**: basic prompt-injection sanitization on player input and
  disallowed-content filtering on AI output, with a safe fallback line.
- **REST + WebSocket server**: create match, submit move, fetch state, live
  companion chat over WS — all manually tested against a running server.
- **Postgres schema** for the Phase 1 tables (users, companions,
  companion_personalities, companion_memories, matches, match_players,
  game_events, player_statistics, ai_conversations).

## What's deliberately NOT built yet (do not assume it exists)

- No auth implementation (schema exists; no password hashing/JWT wiring yet).
- No repository layer wiring services to Postgres — everything currently
  runs in-memory (matches, personalities-as-data, memory). Swapping in real
  DB-backed repositories is the next task, not done.
- No voice (STT/TTS) layer.
- No frontend — this is backend-only.
- No matchmaking, social loop, billing, or analytics services — schema/spec
  exists for later phases only.
- `requestAIRecommendation` on `ChessAdapter` is a naive random/capture-biased
  move picker, not a real chess engine — fine for making the AI companion's
  own moves in the MVP, not for coaching quality.

## Running it

```bash
npm install
cp .env.example .env   # optionally set ANTHROPIC_API_KEY and DATABASE_URL
npm run build
npm start
```

Without `ANTHROPIC_API_KEY` set, the server runs against
`DeterministicFallbackProvider` (generic placeholder companion lines) — this
was the actual configuration used for testing in this environment, since no
key was available. Set a real key to get real personality-driven reactions.

Note: `ts-node-dev` is listed as a dev dependency but is currently
incompatible with the TypeScript 7.x resolved by this environment's
`npm install` (upstream issue, not a code bug). Use `npm run build && npm
start`, or pin `typescript` to `~5.x` in `package.json` if you want
`ts-node-dev`'s watch mode back.

### Try it

```bash
curl http://localhost:3000/api/personalities

curl -X POST http://localhost:3000/api/matches -H "Content-Type: application/json" -d \
  '{"playerId":"player-1","playerDisplayName":"Alex","companionId":"companion-1","companionName":"Nova","personalityId":"savage"}'

curl -X POST http://localhost:3000/api/matches/<matchId>/moves -H "Content-Type: application/json" -d \
  '{"playerId":"player-1","from":"e2","to":"e4"}'
```

Connect a WebSocket to `ws://localhost:3000/ws?matchId=<matchId>` to receive
live `state_update` and `companion_message` pushes, and send
`{"type":"player_chat","playerId":"...","companionId":"...","personalityId":"...","companionName":"...","text":"..."}`
to chat with the companion mid-match.

## Next implementation task (Phase 1 continuation)

Wire `PersonalityService`, `MemoryService`, and match persistence to the
Postgres schema in `src/db/schema.sql` via a repository layer, so state
survives a server restart. Currently everything lives in process memory.
