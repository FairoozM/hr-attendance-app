-- Scope Amazon payment-clearing account cache by marketplace so KSA and UAE
-- can share account codes (1024/1026/1028) with different Zoho account IDs.
-- Existing rows default to KSA.

ALTER TABLE amazon_payment_clearing_account_mappings
  ADD COLUMN IF NOT EXISTS marketplace VARCHAR(16) NOT NULL DEFAULT 'KSA';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'amazon_payment_clearing_account_mappings'::regclass
      AND contype = 'p'
      AND conname = 'amazon_payment_clearing_account_mappings_pkey'
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_index i
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
    WHERE i.indrelid = 'amazon_payment_clearing_account_mappings'::regclass
      AND i.indisprimary
      AND a.attname = 'marketplace'
  ) THEN
    ALTER TABLE amazon_payment_clearing_account_mappings
      DROP CONSTRAINT amazon_payment_clearing_account_mappings_pkey;
    ALTER TABLE amazon_payment_clearing_account_mappings
      ADD CONSTRAINT amazon_payment_clearing_account_mappings_pkey
      PRIMARY KEY (marketplace, account_code);
  END IF;
END $$;
