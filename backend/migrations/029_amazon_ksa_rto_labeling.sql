CREATE TABLE IF NOT EXISTS amazon_ksa_rto_label_batches (
  id SERIAL PRIMARY KEY,
  batch_title TEXT NOT NULL,
  reference_no TEXT,
  agent_name TEXT,
  destination TEXT NOT NULL DEFAULT 'Wanasa-Lifesmile',
  notes TEXT,
  header_image_url TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS amazon_ksa_rto_label_rows (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES amazon_ksa_rto_label_batches(id) ON DELETE CASCADE,
  product_code TEXT NOT NULL,
  fnsku_no TEXT,
  quantity NUMERIC(14,2) NOT NULL,
  notes TEXT,
  status VARCHAR(32) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT amazon_ksa_rto_label_rows_quantity_chk CHECK (quantity > 0),
  CONSTRAINT amazon_ksa_rto_label_rows_status_chk CHECK (status IN ('Ready', 'Missing FNSKU', 'Invalid Qty'))
);

CREATE TABLE IF NOT EXISTS amazon_ksa_rto_label_files (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES amazon_ksa_rto_label_batches(id) ON DELETE CASCADE,
  file_type VARCHAR(32) NOT NULL,
  file_name TEXT NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type TEXT,
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT amazon_ksa_rto_label_files_type_chk CHECK (file_type IN ('header_image', 'fnsku_pdf'))
);

CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_batches_created
  ON amazon_ksa_rto_label_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_batches_reference
  ON amazon_ksa_rto_label_batches(LOWER(reference_no));
CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_rows_batch
  ON amazon_ksa_rto_label_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_rows_product
  ON amazon_ksa_rto_label_rows(LOWER(product_code));
CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_rows_fnsku
  ON amazon_ksa_rto_label_rows(LOWER(fnsku_no));
CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_files_batch
  ON amazon_ksa_rto_label_files(batch_id);
