-- Amazon KSA Payment Clearing: row-level transparency, settlement caching, and posted/repost protection.
-- Idempotent DDL only (ADD COLUMN/CREATE ... IF NOT EXISTS). Same objects are created on API boot
-- via ensureAmazonPaymentClearingTables() in backend/src/services/amazonPaymentClearingStore.js.
-- Manual psql: load DATABASE_URL (e.g. from backend/.env) then
--   psql "$DATABASE_URL" -f backend/migrations/020_add_clearing_row_transparency.sql

-- Row-level transparency stored on the batch for fast reopen.
ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS all_rows JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS blocking_issues JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS amount_differences JSONB NOT NULL DEFAULT '[]'::jsonb;

-- Posted / repost protection.
ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS posted_to_zoho BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE amazon_payment_clearing_batches ADD COLUMN IF NOT EXISTS posting_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Per-row ordering for reopen parity.
ALTER TABLE amazon_payment_clearing_rows ADD COLUMN IF NOT EXISTS row_number INTEGER;

-- Statement caching: one saved batch per Amazon report document so the page reopens
-- from the database instead of re-calling Amazon SP-API.
CREATE UNIQUE INDEX IF NOT EXISTS uq_amz_payment_clearing_batches_report_document
  ON amazon_payment_clearing_batches (marketplace, report_document_id)
  WHERE report_document_id IS NOT NULL AND report_document_id <> '';
CREATE INDEX IF NOT EXISTS idx_amz_payment_clearing_batches_settlement
  ON amazon_payment_clearing_batches (marketplace, settlement_id);

-- Force-repost audit trail.
CREATE TABLE IF NOT EXISTS amazon_payment_clearing_audit (
  id BIGSERIAL PRIMARY KEY,
  batch_id BIGINT NOT NULL REFERENCES amazon_payment_clearing_batches(id) ON DELETE CASCADE,
  action VARCHAR(64) NOT NULL,
  reason TEXT,
  actor_user_id INTEGER NULL,
  previous_zoho_payment_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_amz_payment_clearing_audit_batch
  ON amazon_payment_clearing_audit (batch_id, created_at DESC);
