-- Cached Stripe payout list (latest 30, summary only) for Management → Stripe.
-- Written only by the explicit "Reload payouts" refresh. No accounting data, no secrets.
-- Applied at boot by ensureStripeTables(); this file is the reference migration and is
-- safe to run repeatedly.

CREATE TABLE IF NOT EXISTS stripe_payout_list_cache (
  payout_id TEXT PRIMARY KEY CHECK (payout_id LIKE 'po\_%'),
  status VARCHAR(20) NOT NULL,
  amount_minor BIGINT NOT NULL,
  currency CHAR(3) NOT NULL,
  arrival_date TIMESTAMPTZ,
  stripe_created_at TIMESTAMPTZ,
  automatic BOOLEAN NOT NULL DEFAULT false,
  livemode BOOLEAN NOT NULL DEFAULT false,
  composition JSONB NOT NULL,
  composition_fetched_at TIMESTAMPTZ NOT NULL,
  refreshed_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_stripe_payout_list_cache_created
  ON stripe_payout_list_cache (stripe_created_at DESC, payout_id DESC);
