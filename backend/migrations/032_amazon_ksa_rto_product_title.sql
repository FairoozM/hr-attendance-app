ALTER TABLE amazon_ksa_rto_label_rows
  ADD COLUMN IF NOT EXISTS product_title TEXT;

CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_rows_title
  ON amazon_ksa_rto_label_rows(LOWER(product_title));
