-- Reassigned Stripe payments: a charge that paid a website order which was later cancelled
-- without any refund, whose funds were reused for a replacement Zoho invoice. It is mapped in the
-- same table as direct payments (mapping_type REASSIGNED_PAYMENT) and keeps the original order and
-- invoice as audit evidence only; the cancelled order itself is never changed.
-- Applied at boot by ensureStripeTables(); this file is the reference migration and is
-- safe to run repeatedly.

ALTER TABLE stripe_direct_payment_mappings
  ADD COLUMN IF NOT EXISTS original_order_id TEXT,
  ADD COLUMN IF NOT EXISTS original_order_number TEXT,
  ADD COLUMN IF NOT EXISTS original_order_status TEXT,
  ADD COLUMN IF NOT EXISTS original_invoice_id TEXT,
  ADD COLUMN IF NOT EXISTS original_invoice_number TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stripe_direct_payment_mappings'::regclass
      AND conname = 'stripe_direct_payment_mappings_mapping_type_check'
      AND pg_get_constraintdef(oid) LIKE '%REASSIGNED_PAYMENT%'
  ) THEN
    ALTER TABLE stripe_direct_payment_mappings DROP CONSTRAINT IF EXISTS stripe_direct_payment_mappings_mapping_type_check;
    ALTER TABLE stripe_direct_payment_mappings
      ADD CONSTRAINT stripe_direct_payment_mappings_mapping_type_check
      CHECK (mapping_type IN ('DIRECT_PAYMENT', 'REASSIGNED_PAYMENT'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stripe_direct_payment_mappings'::regclass
      AND conname = 'ck_stripe_direct_payment_original_order'
  ) THEN
    ALTER TABLE stripe_direct_payment_mappings
      ADD CONSTRAINT ck_stripe_direct_payment_original_order
      CHECK ((mapping_type = 'REASSIGNED_PAYMENT') = (original_order_number IS NOT NULL AND btrim(original_order_number) <> ''));
  END IF;
END $$;
