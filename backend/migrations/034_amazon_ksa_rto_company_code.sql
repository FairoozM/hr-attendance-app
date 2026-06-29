DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'amazon_ksa_rto_label_rows'
      AND column_name = 'alternative_name'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'amazon_ksa_rto_label_rows'
      AND column_name = 'company_code'
  ) THEN
    ALTER TABLE amazon_ksa_rto_label_rows RENAME COLUMN alternative_name TO company_code;
  END IF;
END $$;

ALTER TABLE amazon_ksa_rto_label_rows
  ADD COLUMN IF NOT EXISTS company_code TEXT;

DROP INDEX IF EXISTS idx_amazon_ksa_rto_label_rows_alt_name;

CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_rows_company_code
  ON amazon_ksa_rto_label_rows(LOWER(company_code));
