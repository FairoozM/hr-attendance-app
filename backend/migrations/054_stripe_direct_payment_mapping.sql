-- Admin-confirmed mappings of direct Stripe payments (Payment Links) to an existing Zoho invoice.
-- One ACTIVE mapping per PaymentIntent, per charge and per Zoho invoice; a mapping is released
-- (kept for audit), never edited. No website order is created or referenced.
-- Applied at boot by ensureStripeTables(); this file is the reference migration and is
-- safe to run repeatedly.

CREATE TABLE IF NOT EXISTS stripe_direct_payment_mappings (
  id BIGSERIAL PRIMARY KEY,
  stripe_payment_intent_id TEXT NOT NULL CHECK (stripe_payment_intent_id LIKE 'pi\_%'),
  stripe_charge_id TEXT CHECK (stripe_charge_id IS NULL OR stripe_charge_id LIKE 'ch\_%'),
  zoho_invoice_id TEXT NOT NULL CHECK (zoho_invoice_id <> ''),
  zoho_invoice_number TEXT NOT NULL CHECK (zoho_invoice_number <> ''),
  zoho_customer_id TEXT NOT NULL CHECK (zoho_customer_id <> ''),
  customer_key VARCHAR(16) NOT NULL CHECK (customer_key IN ('WEBSITE', 'SHOP')),
  payout_id TEXT NOT NULL CHECK (payout_id LIKE 'po\_%'),
  mapping_type VARCHAR(24) NOT NULL DEFAULT 'DIRECT_PAYMENT' CHECK (mapping_type IN ('DIRECT_PAYMENT')),
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RELEASED')),
  currency CHAR(3) NOT NULL,
  stripe_gross NUMERIC(14, 2) NOT NULL CHECK (stripe_gross > 0),
  invoice_reference TEXT,
  evidence TEXT,
  reason TEXT NOT NULL CHECK (length(btrim(reason)) >= 10),
  mapped_by TEXT NOT NULL CHECK (mapped_by <> ''),
  mapped_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  released_by TEXT,
  released_at TIMESTAMPTZ,
  release_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_stripe_direct_payment_released
    CHECK ((status = 'RELEASED') = (released_at IS NOT NULL AND released_by IS NOT NULL AND release_reason IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_direct_payment_intent_active
  ON stripe_direct_payment_mappings (stripe_payment_intent_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_direct_payment_charge_active
  ON stripe_direct_payment_mappings (stripe_charge_id) WHERE status = 'ACTIVE' AND stripe_charge_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_direct_payment_invoice_active
  ON stripe_direct_payment_mappings (zoho_invoice_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_stripe_direct_payment_payout
  ON stripe_direct_payment_mappings (payout_id);
