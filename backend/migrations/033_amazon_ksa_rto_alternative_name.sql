ALTER TABLE amazon_ksa_rto_label_rows
  ADD COLUMN IF NOT EXISTS alternative_name TEXT;

CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_rows_alt_name
  ON amazon_ksa_rto_label_rows(LOWER(alternative_name));
