ALTER TABLE amazon_ksa_rto_label_files
  ADD COLUMN IF NOT EXISTS row_id INTEGER REFERENCES amazon_ksa_rto_label_rows(id) ON DELETE CASCADE;

ALTER TABLE amazon_ksa_rto_label_rows
  DROP CONSTRAINT IF EXISTS amazon_ksa_rto_label_rows_status_chk;

ALTER TABLE amazon_ksa_rto_label_rows
  ADD CONSTRAINT amazon_ksa_rto_label_rows_status_chk
  CHECK (status IN ('Ready', 'Missing Product Code', 'Missing FNSKU', 'Missing Image', 'Missing PDF', 'Invalid Qty'));

ALTER TABLE amazon_ksa_rto_label_files
  DROP CONSTRAINT IF EXISTS amazon_ksa_rto_label_files_type_chk;

ALTER TABLE amazon_ksa_rto_label_files
  ADD CONSTRAINT amazon_ksa_rto_label_files_type_chk
  CHECK (file_type IN ('batch_header', 'header_image', 'fnsku_pdf', 'product_image', 'fnsku_label_pdf'));

CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_files_row
  ON amazon_ksa_rto_label_files(row_id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_amazon_ksa_rto_row_file_type
  ON amazon_ksa_rto_label_files(row_id, file_type)
  WHERE row_id IS NOT NULL AND file_type IN ('product_image', 'fnsku_label_pdf');
