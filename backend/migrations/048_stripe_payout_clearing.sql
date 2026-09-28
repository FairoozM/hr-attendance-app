-- Payout-level Stripe clearing: customer advance cases, per-component tracking, audit events.
-- Also lets legacy gross-only (GROSS_V1) rows be marked REVERSED_EXTERNALLY.
-- Applied at boot by ensureStripeTables(); this file is the reference migration.

ALTER TABLE stripe_payment_clearings
  ADD COLUMN IF NOT EXISTS clearing_model VARCHAR(16) NOT NULL DEFAULT 'GROSS_V1';
ALTER TABLE stripe_payment_clearings ADD COLUMN IF NOT EXISTS reversed_at TIMESTAMPTZ;
ALTER TABLE stripe_payment_clearings ADD COLUMN IF NOT EXISTS reversal_detail TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stripe_payment_clearings'::regclass
      AND conname = 'stripe_payment_clearings_status_check'
      AND pg_get_constraintdef(oid) LIKE '%REVERSED_EXTERNALLY%'
  ) THEN
    ALTER TABLE stripe_payment_clearings DROP CONSTRAINT IF EXISTS stripe_payment_clearings_status_check;
    ALTER TABLE stripe_payment_clearings ADD CONSTRAINT stripe_payment_clearings_status_check
      CHECK (status IN ('READY', 'POSTING', 'POSTED', 'FAILED', 'BLOCKED', 'FAILED_NEEDS_REVIEW', 'REVERSED_EXTERNALLY'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS stripe_customer_advance_cases (
  id BIGSERIAL PRIMARY KEY,
  payout_id TEXT NOT NULL,
  zoho_customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL,
  order_number TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  invoice_number TEXT NOT NULL,
  payment_intent_id TEXT,
  charge_id TEXT NOT NULL,
  balance_transaction_id TEXT,
  currency CHAR(3) NOT NULL,
  stripe_gross NUMERIC(14, 2) NOT NULL,
  stripe_net NUMERIC(14, 2) NOT NULL,
  stripe_fee NUMERIC(14, 2) NOT NULL,
  invoice_total NUMERIC(14, 2) NOT NULL,
  overpayment_amount NUMERIC(14, 2) NOT NULL CHECK (overpayment_amount > 0),
  net_allocation NUMERIC(14, 2) NOT NULL CHECK (net_allocation > 0),
  customer_advance_account_id TEXT NOT NULL,
  customer_advance_account_code TEXT NOT NULL,
  advance_reference TEXT NOT NULL,
  reason TEXT,
  status VARCHAR(40) NOT NULL CHECK (status IN (
    'CUSTOMER_ADVANCE_REVIEW_REQUIRED', 'CONFIRMED', 'ADVANCE_POSTED', 'REFUNDED', 'REJECTED')),
  admin_confirmed BOOLEAN NOT NULL DEFAULT false,
  confirmed_by TEXT,
  confirmed_at TIMESTAMPTZ,
  refund_required BOOLEAN NOT NULL DEFAULT true,
  refund_status VARCHAR(24) NOT NULL DEFAULT 'NOT_REFUNDED' CHECK (refund_status IN (
    'NOT_REFUNDED', 'REFUND_MATCHED', 'REFUNDED', 'REFUND_MISMATCH')),
  refund_payout_id TEXT,
  refund_balance_transaction_id TEXT,
  refund_amount NUMERIC(14, 2),
  zoho_journal_id TEXT,
  refund_zoho_journal_id TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  CONSTRAINT uq_stripe_customer_advance_cases_charge UNIQUE (charge_id),
  CONSTRAINT ck_stripe_customer_advance_gross CHECK (stripe_gross = invoice_total + overpayment_amount),
  CONSTRAINT ck_stripe_customer_advance_net CHECK (stripe_gross = stripe_net + stripe_fee),
  CONSTRAINT ck_stripe_customer_advance_split CHECK (net_allocation + overpayment_amount = stripe_net),
  CONSTRAINT ck_stripe_customer_advance_confirmed CHECK (
    status IN ('CUSTOMER_ADVANCE_REVIEW_REQUIRED', 'REJECTED')
    OR (admin_confirmed AND confirmed_by IS NOT NULL AND confirmed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_stripe_customer_advance_cases_payout
  ON stripe_customer_advance_cases (payout_id, zoho_customer_id);

CREATE TABLE IF NOT EXISTS stripe_payout_clearing_components (
  id BIGSERIAL PRIMARY KEY,
  payout_id TEXT NOT NULL,
  zoho_customer_id TEXT NOT NULL,
  component VARCHAR(32) NOT NULL CHECK (component IN ('NET', 'FEE', 'CUSTOMER_ADVANCE', 'CUSTOMER_ADVANCE_REFUND')),
  zoho_record_type VARCHAR(24) NOT NULL CHECK (zoho_record_type IN ('customer_payment', 'journal')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  deposit_account_id TEXT,
  debit_account_id TEXT,
  credit_account_id TEXT,
  reference TEXT NOT NULL,
  allocations JSONB NOT NULL DEFAULT '[]'::jsonb,
  advance_case_ids BIGINT[] NOT NULL DEFAULT '{}',
  status VARCHAR(24) NOT NULL CHECK (status IN ('PLANNED', 'POSTING', 'POSTED', 'VERIFIED', 'FAILED', 'NEEDS_REVIEW')),
  zoho_record_id TEXT,
  zoho_journal_id TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  posted_at TIMESTAMPTZ,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_stripe_payout_clearing_component UNIQUE (payout_id, zoho_customer_id, component),
  CONSTRAINT ck_stripe_payout_component_verified
    CHECK (status <> 'VERIFIED' OR (zoho_record_id IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT ck_stripe_payout_component_journal
    CHECK (zoho_record_type <> 'journal' OR zoho_record_id IS NULL OR zoho_journal_id = zoho_record_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_payout_clearing_component_record
  ON stripe_payout_clearing_components (zoho_record_id) WHERE zoho_record_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS stripe_payout_clearing_events (
  id BIGSERIAL PRIMARY KEY,
  entity_type VARCHAR(24) NOT NULL CHECK (entity_type IN ('ADVANCE_CASE', 'COMPONENT')),
  entity_id BIGINT NOT NULL,
  payout_id TEXT NOT NULL,
  zoho_customer_id TEXT,
  from_status VARCHAR(40),
  to_status VARCHAR(40) NOT NULL,
  detail TEXT,
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stripe_payout_clearing_events_entity
  ON stripe_payout_clearing_events (entity_type, entity_id, created_at);
