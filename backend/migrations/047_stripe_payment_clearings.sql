-- Stripe PaymentIntent → Zoho invoice clearing records.
-- Operational reconciliation fields only; no Stripe payloads or customer data.
-- Applied at boot by ensureStripeTables(); this file is the reference migration.

CREATE TABLE IF NOT EXISTS stripe_payment_clearings (
  id BIGSERIAL PRIMARY KEY,
  stripe_payment_intent_id TEXT NOT NULL,
  stripe_charge_id TEXT,
  stripe_livemode BOOLEAN NOT NULL,
  website_order_id TEXT NOT NULL,
  website_order_number TEXT NOT NULL,
  zoho_invoice_id TEXT NOT NULL,
  zoho_invoice_number TEXT NOT NULL,
  zoho_customer_id TEXT NOT NULL,
  zoho_account_id TEXT NOT NULL,
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  payment_date DATE NOT NULL,
  stripe_created_at TIMESTAMPTZ,
  status VARCHAR(32) NOT NULL
    CHECK (status IN ('READY', 'POSTING', 'POSTED', 'FAILED', 'BLOCKED', 'FAILED_NEEDS_REVIEW')),
  zoho_payment_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  CONSTRAINT uq_stripe_payment_clearings_intent UNIQUE (stripe_payment_intent_id),
  CONSTRAINT uq_stripe_payment_clearings_invoice UNIQUE (zoho_invoice_id),
  CONSTRAINT ck_stripe_payment_clearings_posted
    CHECK (status <> 'POSTED' OR (zoho_payment_id IS NOT NULL AND posted_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_payment_clearings_zoho_payment
  ON stripe_payment_clearings (zoho_payment_id) WHERE zoho_payment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stripe_payment_clearings_status
  ON stripe_payment_clearings (status);

CREATE TABLE IF NOT EXISTS stripe_payment_clearing_events (
  id BIGSERIAL PRIMARY KEY,
  clearing_id BIGINT NOT NULL REFERENCES stripe_payment_clearings(id),
  from_status VARCHAR(32),
  to_status VARCHAR(32) NOT NULL,
  detail TEXT,
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_payment_clearing_events_clearing
  ON stripe_payment_clearing_events (clearing_id, created_at);
