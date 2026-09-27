-- Stripe connection event log.
-- Stores an allowlisted summary of each verified webhook, not the full Stripe object.
-- Applied at boot by ensureStripeTables(); this file is the reference migration.

CREATE TABLE IF NOT EXISTS stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type VARCHAR(120) NOT NULL,
  livemode BOOLEAN NOT NULL DEFAULT false,
  api_version TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload_summary JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_received_at
  ON stripe_events (received_at DESC);
