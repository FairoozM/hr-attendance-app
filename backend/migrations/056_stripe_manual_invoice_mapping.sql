-- Manual invoice mappings: the permanent admin fallback for any Stripe charge the matcher could
-- not resolve. Mapped in the same table (mapping_type MANUAL_INVOICE_MAPPING) with the matcher's
-- status and reason before the override; the original order and invoice, if any, are evidence only.
-- DIRECT_PAYMENT still has no original order and REASSIGNED_PAYMENT still requires one; the
-- original-order check keeps its 055 name so re-running 055 stays a no-op.
-- Applied at boot by ensureStripeTables(); this file is the reference migration and is
-- safe to run repeatedly.

ALTER TABLE stripe_direct_payment_mappings
  ADD COLUMN IF NOT EXISTS matcher_status TEXT,
  ADD COLUMN IF NOT EXISTS matcher_reason TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stripe_direct_payment_mappings'::regclass
      AND conname = 'stripe_direct_payment_mappings_mapping_type_check'
      AND pg_get_constraintdef(oid) LIKE '%MANUAL_INVOICE_MAPPING%'
  ) THEN
    ALTER TABLE stripe_direct_payment_mappings DROP CONSTRAINT IF EXISTS stripe_direct_payment_mappings_mapping_type_check;
    ALTER TABLE stripe_direct_payment_mappings
      ADD CONSTRAINT stripe_direct_payment_mappings_mapping_type_check
      CHECK (mapping_type IN ('DIRECT_PAYMENT', 'REASSIGNED_PAYMENT', 'MANUAL_INVOICE_MAPPING'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'stripe_direct_payment_mappings'::regclass
      AND conname = 'ck_stripe_direct_payment_original_order'
      AND pg_get_constraintdef(oid) LIKE '%DIRECT_PAYMENT%'
  ) THEN
    ALTER TABLE stripe_direct_payment_mappings DROP CONSTRAINT IF EXISTS ck_stripe_direct_payment_original_order;
    ALTER TABLE stripe_direct_payment_mappings
      ADD CONSTRAINT ck_stripe_direct_payment_original_order
      CHECK ((mapping_type <> 'REASSIGNED_PAYMENT' OR (original_order_number IS NOT NULL AND btrim(original_order_number) <> ''))
        AND (mapping_type <> 'DIRECT_PAYMENT' OR original_order_number IS NULL));
  END IF;
END $$;
