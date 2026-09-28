-- Customer advance refunds detected before admin confirmation.
-- Adds REFUND_DETECTED to refund_status and the refund identity columns. Additive only:
-- existing cases keep their data. Applied at boot by ensureStripeTables(); this file is
-- the reference migration and is safe to run repeatedly.

ALTER TABLE stripe_customer_advance_cases ADD COLUMN IF NOT EXISTS refund_id TEXT;
ALTER TABLE stripe_customer_advance_cases ADD COLUMN IF NOT EXISTS refund_detected_at TIMESTAMPTZ;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'stripe_customer_advance_cases'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%NOT_REFUNDED%'
      AND pg_get_constraintdef(oid) LIKE '%REFUND_MISMATCH%'
      AND pg_get_constraintdef(oid) NOT LIKE '%REFUND_DETECTED%'
  LOOP
    EXECUTE format('ALTER TABLE stripe_customer_advance_cases DROP CONSTRAINT %I', r.conname);
  END LOOP;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stripe_customer_advance_cases'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%NOT_REFUNDED%'
      AND pg_get_constraintdef(oid) LIKE '%REFUND_DETECTED%'
  ) THEN
    ALTER TABLE stripe_customer_advance_cases ADD CONSTRAINT ck_stripe_customer_advance_refund_status
      CHECK (refund_status IN ('NOT_REFUNDED', 'REFUND_DETECTED', 'REFUND_MATCHED', 'REFUNDED', 'REFUND_MISMATCH'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stripe_customer_advance_cases'::regclass AND conname = 'ck_stripe_customer_advance_refund_fields'
  ) THEN
    ALTER TABLE stripe_customer_advance_cases ADD CONSTRAINT ck_stripe_customer_advance_refund_fields CHECK (
      refund_status NOT IN ('REFUND_DETECTED', 'REFUND_MATCHED', 'REFUNDED')
      OR (refund_id IS NOT NULL AND refund_balance_transaction_id IS NOT NULL
          AND refund_amount = overpayment_amount AND refund_detected_at IS NOT NULL));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stripe_customer_advance_cases'::regclass AND conname = 'ck_stripe_customer_advance_refund_payout'
  ) THEN
    ALTER TABLE stripe_customer_advance_cases ADD CONSTRAINT ck_stripe_customer_advance_refund_payout CHECK (
      refund_status NOT IN ('REFUND_MATCHED', 'REFUNDED')
      OR (refund_payout_id IS NOT NULL AND refund_payout_id <> payout_id));
  END IF;
END $$;
