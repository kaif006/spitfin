CREATE TABLE matches (
  id           BIGSERIAL PRIMARY KEY,
  seed         BIGINT NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL,
  duration_s   INTEGER NOT NULL,
  player_count SMALLINT NOT NULL CHECK (player_count BETWEEN 1 AND 4)
);

CREATE TABLE match_players (
  match_id     BIGINT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  bugs_eaten   INTEGER NOT NULL,
  final_stash  INTEGER NOT NULL,
  shots        INTEGER NOT NULL,
  hits         INTEGER NOT NULL,
  nips         INTEGER NOT NULL,
  steals_made  INTEGER NOT NULL,
  stolen_from  INTEGER NOT NULL,
  placement    SMALLINT NOT NULL,
  rating_delta INTEGER NOT NULL,
  PRIMARY KEY (match_id, user_id)
);
CREATE INDEX match_players_user_idx ON match_players (user_id, match_id DESC);

-- steals_total is also the number of nips that landed.
CREATE TABLE user_stats (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  matches          INTEGER NOT NULL DEFAULT 0,
  wins             INTEGER NOT NULL DEFAULT 0,
  bugs_eaten_total INTEGER NOT NULL DEFAULT 0,
  shots_total      INTEGER NOT NULL DEFAULT 0,
  hits_total       INTEGER NOT NULL DEFAULT 0,
  nips_total       INTEGER NOT NULL DEFAULT 0,
  steals_total     INTEGER NOT NULL DEFAULT 0,
  stolen_total     INTEGER NOT NULL DEFAULT 0,
  current_streak   INTEGER NOT NULL DEFAULT 0,
  best_streak      INTEGER NOT NULL DEFAULT 0,
  rating           INTEGER NOT NULL DEFAULT 1000
);
CREATE INDEX user_stats_rating_idx ON user_stats (rating DESC);
