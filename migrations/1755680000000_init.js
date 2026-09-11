/* eslint-disable camelcase */

exports.up = (pgm) => {
  pgm.createExtension("pgcrypto", { ifNotExists: true });

  pgm.createTable("users", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    email: { type: "text", notNull: true, unique: true },
    password_hash: { type: "text", notNull: true },
    display_name: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("refresh_tokens", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    token_hash: { type: "text", notNull: true, unique: true },
    expires_at: { type: "timestamptz", notNull: true },
    revoked_at: { type: "timestamptz" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("refresh_tokens", "user_id");

  pgm.createTable("companion_personalities", {
    id: { type: "text", primaryKey: true },
    owner_id: { type: "uuid", references: "users", onDelete: "CASCADE" },
    config: { type: "jsonb", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("companions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    owner_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    name: { type: "text", notNull: true },
    avatar_key: { type: "text", notNull: true },
    voice_key: { type: "text" },
    personality_id: { type: "text", notNull: true, references: "companion_personalities" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("companions", "owner_id");

  pgm.createTable("companion_memories", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    companion_id: { type: "uuid", notNull: true, references: "companions", onDelete: "CASCADE" },
    player_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    category: { type: "text", notNull: true },
    fact: { type: "text", notNull: true },
    status: { type: "text", notNull: true, default: "candidate" },
    weight: { type: "real", notNull: true, default: 1 },
    observation_count: { type: "integer", notNull: true, default: 1 },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("companion_memories", "companion_memories_unique_fact", {
    unique: ["companion_id", "player_id", "category", "fact"],
  });
  pgm.createIndex("companion_memories", ["companion_id", "player_id"]);

  pgm.createTable("games", {
    id: { type: "text", primaryKey: true },
    display_name: { type: "text", notNull: true },
  });
  pgm.sql(`INSERT INTO games (id, display_name) VALUES ('chess', 'Chess') ON CONFLICT DO NOTHING;`);

  pgm.createTable("matches", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    game_id: { type: "text", notNull: true, references: "games" },
    status: {
      type: "text",
      notNull: true,
      default: "WAITING_FOR_PLAYERS",
      check: "status IN ('WAITING_FOR_PLAYERS','IN_PROGRESS','PAUSED','COMPLETE')",
    },
    engine_state: { type: "jsonb", notNull: true, default: "{}" },
    started_at: { type: "timestamptz" },
    ended_at: { type: "timestamptz" },
    result: { type: "text" },
    created_by: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("match_players", {
    match_id: { type: "uuid", notNull: true, references: "matches", onDelete: "CASCADE" },
    player_kind: { type: "text", notNull: true, check: "player_kind IN ('human','ai_companion')" },
    user_id: { type: "uuid", references: "users", onDelete: "CASCADE" },
    companion_id: { type: "uuid", references: "companions", onDelete: "CASCADE" },
    color: { type: "text", notNull: true, check: "color IN ('white','black')" },
  });
  pgm.addConstraint("match_players", "match_players_pk", { primaryKey: ["match_id", "color"] });
  pgm.addConstraint("match_players", "match_players_kind_check", {
    check:
      "(player_kind = 'human' AND user_id IS NOT NULL) OR (player_kind = 'ai_companion' AND companion_id IS NOT NULL)",
  });
  pgm.createIndex("match_players", "user_id");

  pgm.createTable("game_events", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    match_id: { type: "uuid", notNull: true, references: "matches", onDelete: "CASCADE" },
    type: { type: "text", notNull: true },
    actor_player_id: { type: "uuid" },
    payload: { type: "jsonb", notNull: true, default: "{}" },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("game_events", "match_id");

  pgm.createTable("player_statistics", {
    user_id: { type: "uuid", primaryKey: true, references: "users", onDelete: "CASCADE" },
    matches_played: { type: "integer", notNull: true, default: 0 },
    matches_won: { type: "integer", notNull: true, default: 0 },
    matches_lost: { type: "integer", notNull: true, default: 0 },
    matches_drawn: { type: "integer", notNull: true, default: 0 },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });

  pgm.createTable("ai_conversations", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    match_id: { type: "uuid", references: "matches", onDelete: "CASCADE" },
    companion_id: { type: "uuid", notNull: true, references: "companions", onDelete: "CASCADE" },
    player_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    role: { type: "text", notNull: true, check: "role IN ('player','companion')" },
    content: { type: "text", notNull: true },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.createIndex("ai_conversations", "match_id");
};

exports.down = (pgm) => {
  pgm.dropTable("ai_conversations");
  pgm.dropTable("player_statistics");
  pgm.dropTable("game_events");
  pgm.dropTable("match_players");
  pgm.dropTable("matches");
  pgm.dropTable("games");
  pgm.dropTable("companion_memories");
  pgm.dropTable("companions");
  pgm.dropTable("companion_personalities");
  pgm.dropTable("refresh_tokens");
  pgm.dropTable("users");
};
