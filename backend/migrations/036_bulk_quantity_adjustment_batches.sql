-- Bulk Zoho Inventory quantity adjustment batches (also applied via ensureBulkQuantityAdjustmentTables on boot).

CREATE TABLE IF NOT EXISTS bulk_quantity_adjustment_batches (
  id SERIAL PRIMARY KEY,
  batch_reference VARCHAR(64) NOT NULL UNIQUE,
  uploaded_file_name TEXT NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'uploaded',
  total_rows INTEGER NOT NULL DEFAULT 0,
  valid_rows INTEGER NOT NULL DEFAULT 0,
  error_rows INTEGER NOT NULL DEFAULT 0,
  posted_rows INTEGER NOT NULL DEFAULT 0,
  failed_rows INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  zoho_adjustment_ids JSONB NOT NULL DEFAULT '[]',
  notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bulk_quantity_adjustment_rows (
  id SERIAL PRIMARY KEY,
  batch_id INTEGER NOT NULL REFERENCES bulk_quantity_adjustment_batches(id) ON DELETE CASCADE,
  row_number INTEGER NOT NULL,
  sku TEXT NOT NULL DEFAULT '',
  item_name TEXT DEFAULT '',
  zoho_item_id VARCHAR(160) DEFAULT '',
  warehouse_id VARCHAR(160) DEFAULT '',
  warehouse_name TEXT DEFAULT '',
  current_stock NUMERIC(14, 4),
  adjustment_qty NUMERIC(14, 4) NOT NULL DEFAULT 0,
  expected_stock_after NUMERIC(14, 4),
  reason TEXT DEFAULT '',
  description TEXT DEFAULT '',
  reference_number TEXT DEFAULT '',
  remarks TEXT DEFAULT '',
  validation_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  posting_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  valuation_status VARCHAR(32) NOT NULL DEFAULT 'unknown',
  error_message TEXT DEFAULT '',
  zoho_inventory_adjustment_id VARCHAR(160) DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_bqa_batches_created ON bulk_quantity_adjustment_batches(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bqa_batches_status ON bulk_quantity_adjustment_batches(status);
CREATE INDEX IF NOT EXISTS idx_bqa_rows_batch ON bulk_quantity_adjustment_rows(batch_id);
CREATE INDEX IF NOT EXISTS idx_bqa_rows_validation ON bulk_quantity_adjustment_rows(batch_id, validation_status);
CREATE INDEX IF NOT EXISTS idx_bqa_rows_posting ON bulk_quantity_adjustment_rows(batch_id, posting_status);
