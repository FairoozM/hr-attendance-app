-- Amazon KSA Payment Clearing: store the Zoho reference number and description on each
-- posting row for settlement-period traceability/auditing.
-- Idempotent DDL only (ADD COLUMN IF NOT EXISTS). Same objects are created on API boot
-- via ensureAmazonPaymentClearingTables() in backend/src/services/amazonPaymentClearingStore.js.
-- Manual psql: load DATABASE_URL (e.g. from backend/.env) then
--   psql "$DATABASE_URL" -f backend/migrations/021_add_clearing_posting_references.sql

ALTER TABLE amazon_payment_clearing_postings ADD COLUMN IF NOT EXISTS reference_number VARCHAR(128);
ALTER TABLE amazon_payment_clearing_postings ADD COLUMN IF NOT EXISTS description TEXT;
