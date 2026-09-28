-- Normal (invoice) Stripe refunds cleared per payout: one row per Stripe refund + component.
--   REFUND_CREDIT_NOTE_REFUND  refund of the existing Zoho credit note, paid from Stripe Undeposited Funds (1019)
--   REFUND_FEE_ADJUSTMENT      journal between 1019 and 1013 for Stripe's fee on the refund (only when non-zero)
-- Customer advance refunds (Dr 1123 / Cr 1019) are not stored here. Additive only. Applied at
-- boot by ensureStripeTables(); this file is the reference migration and is safe to run repeatedly.

CREATE TABLE IF NOT EXISTS stripe_payout_refund_components (
  id BIGSERIAL PRIMARY KEY,
  payout_id TEXT NOT NULL,
  refund_id TEXT NOT NULL,
  balance_transaction_id TEXT NOT NULL,
  charge_id TEXT NOT NULL,
  payment_intent_id TEXT,
  zoho_customer_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  credit_note_id TEXT NOT NULL,
  component VARCHAR(32) NOT NULL CHECK (component IN ('REFUND_CREDIT_NOTE_REFUND', 'REFUND_FEE_ADJUSTMENT')),
  zoho_record_type VARCHAR(24) NOT NULL CHECK (zoho_record_type IN ('creditnote_refund', 'journal')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  deposit_account_id TEXT,
  debit_account_id TEXT,
  credit_account_id TEXT,
  reference TEXT NOT NULL,
  status VARCHAR(24) NOT NULL CHECK (status IN ('PLANNED', 'POSTING', 'POSTED', 'VERIFIED', 'FAILED', 'NEEDS_REVIEW')),
  zoho_record_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  posted_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stripe_payout_refund_component UNIQUE (refund_id, component),
  CONSTRAINT ck_stripe_payout_refund_component_verified
    CHECK (status <> 'VERIFIED' OR (zoho_record_id IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT ck_stripe_payout_refund_component_shape CHECK (
    (component = 'REFUND_CREDIT_NOTE_REFUND' AND zoho_record_type = 'creditnote_refund' AND deposit_account_id IS NOT NULL)
    OR (component = 'REFUND_FEE_ADJUSTMENT' AND zoho_record_type = 'journal'
        AND debit_account_id IS NOT NULL AND credit_account_id IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_payout_refund_component_record
  ON stripe_payout_refund_components (zoho_record_type, zoho_record_id) WHERE zoho_record_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stripe_payout_refund_components_payout
  ON stripe_payout_refund_components (payout_id);

-- Audit events for refund components.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'stripe_payout_clearing_events'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%ADVANCE_CASE%'
      AND pg_get_constraintdef(oid) NOT LIKE '%REFUND_COMPONENT%'
  LOOP
    EXECUTE format('ALTER TABLE stripe_payout_clearing_events DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stripe_payout_clearing_events'::regclass AND conname = 'ck_stripe_payout_event_entity'
  ) THEN
    ALTER TABLE stripe_payout_clearing_events ADD CONSTRAINT ck_stripe_payout_event_entity
      CHECK (entity_type IN ('ADVANCE_CASE', 'COMPONENT', 'REFUND_COMPONENT'));
  END IF;
END $$;
