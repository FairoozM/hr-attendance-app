-- Noon Payment Clearance tables (also ensured at boot by noonPaymentClearingStore.ensureNoonPaymentClearingTables)

CREATE TABLE IF NOT EXISTS noon_payment_clearing_batches (
  id BIGSERIAL PRIMARY KEY,
  marketplace VARCHAR(16) NOT NULL DEFAULT 'AE',
  reference_nr VARCHAR(128),
  contract VARCHAR(128),
  contract_type VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'previewed',
  totals JSONB NOT NULL DEFAULT '{}'::jsonb,
  hierarchy JSONB NOT NULL DEFAULT '{}'::jsonb,
  reconciliation_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  matched_orders JSONB NOT NULL DEFAULT '[]'::jsonb,
  unmatched_orders JSONB NOT NULL DEFAULT '[]'::jsonb,
  multiple_match_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  parent_charges JSONB NOT NULL DEFAULT '[]'::jsonb,
  adjustments JSONB NOT NULL DEFAULT '[]'::jsonb,
  statement_fees JSONB NOT NULL DEFAULT '[]'::jsonb,
  fee_journal_lines JSONB NOT NULL DEFAULT '[]'::jsonb,
  all_rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  blocking_issues JSONB NOT NULL DEFAULT '[]'::jsonb,
  report_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  warnings JSONB NOT NULL DEFAULT '[]'::jsonb,
  zoho_customer_id VARCHAR(128),
  zoho_customer_name VARCHAR(256),
  posted_to_zoho BOOLEAN NOT NULL DEFAULT false,
  posting_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER NULL,
  approved_by INTEGER NULL,
  approved_at TIMESTAMPTZ NULL,
  posted_by INTEGER NULL,
  posted_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_noon_payment_clearing_batches_reference
  ON noon_payment_clearing_batches (marketplace, reference_nr)
  WHERE reference_nr IS NOT NULL AND reference_nr <> '';
