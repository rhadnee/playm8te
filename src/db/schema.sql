-- Playm8te MVP schema — Phase 1 subset.
-- Only the tables needed for: auth, companion creation, chess matches,
-- match events, and long-term memory. Remaining tables from the spec
-- (friends, rivalries, challenges, subscriptions, transactions,
-- analytics_events) are deferred to later phases and intentionally omitted
-- here rather than stubbed, per "never leave TODOs for core MVP functionality."

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  display_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE companions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  avatar_key TEXT NOT NULL,
  voice_key TEXT,
  personality_id TEXT NOT NULL, -- references the config id from presets (or a custom row, later)
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE companion_personalities (
  id TEXT PRIMARY KEY, -- e.g. 'competitive', or a custom uuid-based id
  owner_id UUID REFERENCES users(id) ON DELETE CASCADE, -- null for built-in presets
  config JSONB NOT NULL, -- serialized PersonalityConfig
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE companion_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  fact TEXT NOT NULL,
  weight REAL NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (companion_id, player_id, category, fact)
);

CREATE TABLE games (
  id TEXT PRIMARY KEY, -- e.g. 'chess'
  display_name TEXT NOT NULL
);

INSERT INTO games (id, display_name) VALUES ('chess', 'Chess') ON CONFLICT DO NOTHING;

CREATE TABLE matches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id TEXT NOT NULL REFERENCES games(id),
  status TEXT NOT NULL DEFAULT 'WAITING_FOR_PLAYERS'
    CHECK (status IN ('WAITING_FOR_PLAYERS','IN_PROGRESS','PAUSED','COMPLETE')),
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  result TEXT, -- 'white_win' | 'black_win' | 'draw' | null while in progress
  final_pgn TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE match_players (
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_kind TEXT NOT NULL CHECK (player_kind IN ('human','ai_companion')),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  companion_id UUID REFERENCES companions(id) ON DELETE CASCADE,
  color TEXT NOT NULL CHECK (color IN ('white','black')),
  PRIMARY KEY (match_id, color),
  CHECK (
    (player_kind = 'human' AND user_id IS NOT NULL) OR
    (player_kind = 'ai_companion' AND companion_id IS NOT NULL)
  )
);

CREATE TABLE game_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  actor_player_id UUID, -- nullable: system-level events (e.g. ROUND_ENDED) have no actor
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_game_events_match_id ON game_events(match_id);

CREATE TABLE player_statistics (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  matches_played INT NOT NULL DEFAULT 0,
  matches_won INT NOT NULL DEFAULT 0,
  matches_lost INT NOT NULL DEFAULT 0,
  matches_drawn INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- AI conversation log (for debugging, safety review, and future memory
-- consolidation jobs). Not sent back to the model in bulk — MemoryService
-- reads structured facts derived from this, not raw transcripts, at
-- inference time.
CREATE TABLE ai_conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  match_id UUID REFERENCES matches(id) ON DELETE CASCADE,
  companion_id UUID NOT NULL REFERENCES companions(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('player','companion')),
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_conversations_match_id ON ai_conversations(match_id);
