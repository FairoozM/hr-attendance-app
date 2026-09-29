-- Tabby settlement clearing: statement batches (statement # + file SHA-256), statement rows,
-- per-component posting records (deterministic component_key), audit events and admin account
-- mappings. Applied at boot by ensureTabbyClearingTables(); this file is the reference migration
-- and is safe to run repeatedly.

CREATE TABLE IF NOT EXISTS tabby_settlement_batches (
   id BIGSERIAL PRIMARY KEY,
   statement_number TEXT NOT NULL,
   file_hash CHAR(64) NOT NULL,
   file_name TEXT,
   statement_date DATE,
   transfer_date DATE,
   company_name TEXT,
   currency CHAR(3) NOT NULL,
   parsed JSONB NOT NULL,
   totals JSONB NOT NULL DEFAULT '{}'::jsonb,
   status VARCHAR(24) NOT NULL DEFAULT 'IMPORTED' CHECK (status IN ('IMPORTED', 'READY', 'BLOCKED', 'POSTING', 'PARTIALLY_POSTED', 'POSTED', 'NEEDS_REVIEW')),
   review JSONB,
   bank_status VARCHAR(32),
   bank_transaction_id TEXT,
   bank_evidence JSONB,
   posting_fingerprint TEXT,
   imported_by TEXT,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   posted_at TIMESTAMPTZ,
   CONSTRAINT uq_tabby_settlement_batches_statement UNIQUE (statement_number)
 );

CREATE UNIQUE INDEX IF NOT EXISTS uq_tabby_settlement_batches_bank_txn
   ON tabby_settlement_batches (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS tabby_settlement_rows (
   id BIGSERIAL PRIMARY KEY,
   batch_id BIGINT NOT NULL REFERENCES tabby_settlement_batches(id) ON DELETE CASCADE,
   statement_number TEXT NOT NULL,
   excel_row INTEGER NOT NULL,
   kind VARCHAR(16) NOT NULL CHECK (kind IN ('SALE', 'REFUND', 'PAYOUT_FEE', 'TOTAL', 'NOTE', 'UNKNOWN')),
   subtype TEXT,
   order_number TEXT,
   website_order_id TEXT,
   sale_refund_date TEXT,
   fingerprint CHAR(64) NOT NULL,
   gross_minor BIGINT NOT NULL DEFAULT 0,
   transferred_minor BIGINT NOT NULL DEFAULT 0,
   effects JSONB,
   raw JSONB NOT NULL DEFAULT '{}'::jsonb,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   CONSTRAINT uq_tabby_settlement_rows_excel UNIQUE (batch_id, excel_row)
 );

CREATE INDEX IF NOT EXISTS idx_tabby_settlement_rows_order ON tabby_settlement_rows (website_order_id, kind);

CREATE INDEX IF NOT EXISTS idx_tabby_settlement_rows_fingerprint ON tabby_settlement_rows (fingerprint);

CREATE TABLE IF NOT EXISTS tabby_clearing_components (
   id BIGSERIAL PRIMARY KEY,
   batch_id BIGINT NOT NULL REFERENCES tabby_settlement_batches(id) ON DELETE CASCADE,
   statement_number TEXT NOT NULL,
   component_key TEXT NOT NULL,
   component VARCHAR(40) NOT NULL CHECK (component IN (
     'SALE_NET', 'SALE_CHARGES', 'REFUND_CREDIT_NOTE', 'REFUND_PAYMENT', 'REFUND_COMMISSION_REVERSAL',
     'REFUND_FEE_REVERSAL', 'REFUND_VAT_REVERSAL', 'CHARGE_EXPENSE_CLEARING', 'PAYOUT_FEE', 'BANK_SETTLEMENT')),
   scope TEXT NOT NULL,
   zoho_record_type VARCHAR(24) NOT NULL CHECK (zoho_record_type IN (
     'customer_payment', 'journal', 'creditnote_refund', 'creditnote_link', 'bank_transfer')),
   amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
   currency CHAR(3) NOT NULL,
   reference TEXT NOT NULL,
   customer_id TEXT,
   invoice_id TEXT,
   credit_note_id TEXT,
   website_order_id TEXT,
   row_fingerprint TEXT,
   plan JSONB NOT NULL,
   status VARCHAR(24) NOT NULL CHECK (status IN ('PLANNED', 'POSTING', 'POSTED', 'VERIFIED', 'FAILED', 'NEEDS_REVIEW', 'POSTING_UNCERTAIN')),
   zoho_record_id TEXT,
   attempt_count INTEGER NOT NULL DEFAULT 0,
   last_error TEXT,
   recovery_status VARCHAR(32),
   posted_at TIMESTAMPTZ,
   verified_at TIMESTAMPTZ,
   first_uncertain_at TIMESTAMPTZ,
   uncertain_since TIMESTAMPTZ,
   last_recovery_check_at TIMESTAMPTZ,
   recovery_check_count INTEGER NOT NULL DEFAULT 0,
   request_snapshot JSONB,
   created_by TEXT,
   updated_by TEXT,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
   CONSTRAINT uq_tabby_clearing_components_key UNIQUE (component_key),
   CONSTRAINT ck_tabby_clearing_components_verified
     CHECK (status <> 'VERIFIED' OR (zoho_record_id IS NOT NULL AND verified_at IS NOT NULL)),
   CONSTRAINT ck_tabby_clearing_components_uncertain
     CHECK (status <> 'POSTING_UNCERTAIN' OR (uncertain_since IS NOT NULL AND first_uncertain_at IS NOT NULL))
 );

CREATE UNIQUE INDEX IF NOT EXISTS uq_tabby_clearing_components_record
   ON tabby_clearing_components (zoho_record_type, zoho_record_id)
   WHERE zoho_record_id IS NOT NULL AND zoho_record_type <> 'creditnote_link';

CREATE INDEX IF NOT EXISTS idx_tabby_clearing_components_batch ON tabby_clearing_components (batch_id);

CREATE TABLE IF NOT EXISTS tabby_clearing_events (
   id BIGSERIAL PRIMARY KEY,
   batch_id BIGINT REFERENCES tabby_settlement_batches(id) ON DELETE CASCADE,
   component_id BIGINT,
   statement_number TEXT,
   event_type VARCHAR(40) NOT NULL,
   from_status VARCHAR(32),
   to_status VARCHAR(32),
   detail TEXT,
   evidence JSONB,
   actor TEXT,
   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );

CREATE INDEX IF NOT EXISTS idx_tabby_clearing_events_batch ON tabby_clearing_events (batch_id, created_at);

CREATE TABLE IF NOT EXISTS tabby_clearing_account_mappings (
   role VARCHAR(32) PRIMARY KEY CHECK (role IN ('UNDEPOSITED', 'PROCESSING', 'COMMISSION_EXPENSE', 'FEES_EXPENSE', 'INPUT_VAT', 'BANK')),
   account_id TEXT NOT NULL,
   account_name TEXT NOT NULL,
   account_code TEXT,
   account_type TEXT NOT NULL,
   updated_by TEXT,
   updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
 );
