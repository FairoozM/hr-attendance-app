-- Shared influencer pipeline (one row per deployment; all permitted users see the same list).
CREATE TABLE IF NOT EXISTS influencers_snapshot (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  body JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
