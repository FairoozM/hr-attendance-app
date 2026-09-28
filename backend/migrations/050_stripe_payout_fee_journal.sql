-- Payout-level Stripe fee journal (Dr Stripe Fees 2270 / Cr 1013), one per payout.
-- Stored as component PAYOUT_FEE_JOURNAL with no customer. Additive only: existing
-- customer components keep their data. Applied at boot by ensureStripeTables(); this file
-- is the reference migration and is safe to run repeatedly.

ALTER TABLE stripe_payout_clearing_components ALTER COLUMN zoho_customer_id DROP NOT NULL;
ALTER TABLE stripe_payout_clearing_components ADD COLUMN IF NOT EXISTS created_by TEXT;
ALTER TABLE stripe_payout_clearing_components ADD COLUMN IF NOT EXISTS updated_by TEXT;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'stripe_payout_clearing_components'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%CUSTOMER_ADVANCE_REFUND%'
      AND pg_get_constraintdef(oid) NOT LIKE '%PAYOUT_FEE_JOURNAL%'
  LOOP
    EXECUTE format('ALTER TABLE stripe_payout_clearing_components DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stripe_payout_clearing_components'::regclass AND conname = 'ck_stripe_payout_component_kind'
  ) THEN
    ALTER TABLE stripe_payout_clearing_components ADD CONSTRAINT ck_stripe_payout_component_kind
      CHECK (component IN ('NET', 'FEE', 'CUSTOMER_ADVANCE', 'CUSTOMER_ADVANCE_REFUND', 'PAYOUT_FEE_JOURNAL'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stripe_payout_clearing_components'::regclass AND conname = 'ck_stripe_payout_component_scope'
  ) THEN
    ALTER TABLE stripe_payout_clearing_components ADD CONSTRAINT ck_stripe_payout_component_scope
      CHECK ((component = 'PAYOUT_FEE_JOURNAL') = (zoho_customer_id IS NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stripe_payout_clearing_components'::regclass AND conname = 'ck_stripe_payout_fee_journal_shape'
  ) THEN
    ALTER TABLE stripe_payout_clearing_components ADD CONSTRAINT ck_stripe_payout_fee_journal_shape CHECK (
      component <> 'PAYOUT_FEE_JOURNAL'
      OR (zoho_record_type = 'journal' AND debit_account_id IS NOT NULL AND credit_account_id IS NOT NULL
          AND allocations = '[]'::jsonb AND advance_case_ids = '{}'));
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_stripe_payout_fee_journal
  ON stripe_payout_clearing_components (payout_id) WHERE component = 'PAYOUT_FEE_JOURNAL';
