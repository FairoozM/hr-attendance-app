-- Mashreq POS settlement clearing: imported files, POS transactions (RRN kept as TEXT), payouts,
-- RRN index of Zoho invoices, manual mappings, terminal → channel mappings, posting components,
-- audit events and account mappings. Same DDL as SCHEMA_SQL in
-- src/services/posSettlement/posSettlementStore.ts (applied idempotently at boot as well).

CREATE TABLE IF NOT EXISTS pos_settlement_files (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(24) NOT NULL,
  file_hash CHAR(64) NOT NULL,
  file_name TEXT,
  source_format VARCHAR(24) NOT NULL,
  role VARCHAR(16) NOT NULL CHECK (role IN ('TRANSACTIONS', 'CONTROL')),
  parser_version TEXT NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  transaction_count INTEGER NOT NULL DEFAULT 0,
  new_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  conflict_count INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_pos_settlement_files_hash UNIQUE (provider, file_hash)
);

CREATE TABLE IF NOT EXISTS pos_settlements (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(24) NOT NULL,
  payout_key TEXT NOT NULL,
  settlement_code TEXT NOT NULL,
  basis VARCHAR(24) NOT NULL,
  payout_date DATE,
  currency CHAR(3) NOT NULL DEFAULT 'AED',
  status VARCHAR(24) NOT NULL DEFAULT 'IMPORTED' CHECK (status IN ('IMPORTED', 'READY', 'BLOCKED', 'POSTING', 'PARTIALLY_POSTED', 'POSTED', 'NEEDS_REVIEW')),
  review JSONB,
  approval JSONB,
  bank_status VARCHAR(32),
  bank_transaction_id TEXT,
  bank_evidence JSONB,
  posting_fingerprint TEXT,
  posting_job JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  posted_at TIMESTAMPTZ,
  CONSTRAINT uq_pos_settlements_payout UNIQUE (provider, payout_key),
  CONSTRAINT uq_pos_settlements_code UNIQUE (settlement_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_settlements_bank_txn
  ON pos_settlements (bank_transaction_id) WHERE bank_transaction_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS pos_transactions (
  id BIGSERIAL PRIMARY KEY,
  file_id BIGINT NOT NULL REFERENCES pos_settlement_files(id) ON DELETE RESTRICT,
  settlement_id BIGINT REFERENCES pos_settlements(id) ON DELETE RESTRICT,
  organization_id TEXT NOT NULL,
  provider VARCHAR(24) NOT NULL,
  source_row INTEGER NOT NULL,
  record_type TEXT,
  merchant_id TEXT,
  merchant_name TEXT,
  terminal_id TEXT,
  rrn TEXT,
  stan TEXT,
  auth_code TEXT,
  transaction_type_raw TEXT,
  transaction_type VARCHAR(16) NOT NULL,
  transaction_date DATE,
  transaction_time TEXT,
  currency CHAR(3),
  gross_minor BIGINT,
  commission_minor BIGINT,
  other_fees_minor BIGINT,
  vat_minor BIGINT,
  net_minor BIGINT,
  net_derived BOOLEAN NOT NULL DEFAULT FALSE,
  batch_number TEXT,
  settlement_ref TEXT,
  settlement_date DATE,
  bank_reference TEXT,
  card_scheme TEXT,
  masked_card TEXT,
  identity_key CHAR(64) NOT NULL,
  economic_hash CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL CHECK (status IN ('ACTIVE', 'DUPLICATE', 'CONFLICT', 'DISMISSED')),
  duplicate_of BIGINT REFERENCES pos_transactions(id),
  conflict_with BIGINT REFERENCES pos_transactions(id),
  conflict_fields JSONB,
  payout_key TEXT,
  payout_basis VARCHAR(24),
  warnings JSONB,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_reason TEXT,
  status_by TEXT,
  status_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_pos_transactions_rrn_text CHECK (rrn IS NULL OR rrn ~ '^[0-9A-Za-z]+$')
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_transactions_identity_active
  ON pos_transactions (identity_key, transaction_date) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS idx_pos_transactions_rrn ON pos_transactions (organization_id, provider, rrn);
CREATE INDEX IF NOT EXISTS idx_pos_transactions_settlement ON pos_transactions (settlement_id);

CREATE TABLE IF NOT EXISTS pos_rrn_invoice_index (
  organization_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  invoice_number TEXT,
  reference_number TEXT,
  customer_id TEXT,
  customer_name TEXT,
  invoice_date DATE,
  total_minor BIGINT,
  balance_minor BIGINT,
  currency_code TEXT,
  status TEXT,
  last_modified_time TEXT,
  rrn_field TEXT,
  rrns TEXT[] NOT NULL DEFAULT '{}',
  malformed TEXT[] NOT NULL DEFAULT '{}',
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, invoice_id)
);

CREATE INDEX IF NOT EXISTS idx_pos_rrn_invoice_index_rrns ON pos_rrn_invoice_index USING GIN (rrns);
CREATE INDEX IF NOT EXISTS idx_pos_rrn_invoice_index_date ON pos_rrn_invoice_index (organization_id, customer_id, invoice_date);

CREATE TABLE IF NOT EXISTS pos_manual_mappings (
  id BIGSERIAL PRIMARY KEY,
  transaction_id BIGINT NOT NULL REFERENCES pos_transactions(id) ON DELETE RESTRICT,
  rrn TEXT,
  allocations JSONB NOT NULL,
  auto_result JSONB,
  reason TEXT NOT NULL,
  state VARCHAR(16) NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE', 'REVOKED')),
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_by TEXT,
  revoked_at TIMESTAMPTZ,
  revoke_reason TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_manual_mappings_active ON pos_manual_mappings (transaction_id) WHERE state = 'ACTIVE';

CREATE TABLE IF NOT EXISTS pos_terminal_mappings (
  id BIGSERIAL PRIMARY KEY,
  provider VARCHAR(24) NOT NULL,
  merchant_id TEXT NOT NULL,
  terminal_id TEXT,
  channel VARCHAR(24) NOT NULL CHECK (channel IN ('WEBSITE', 'WEB_APP', 'BURJUMAN_SHOP', 'UNKNOWN')),
  location TEXT,
  notes TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  removed_by TEXT,
  removed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_terminal_mappings_active
  ON pos_terminal_mappings (provider, merchant_id, COALESCE(terminal_id, '')) WHERE active;

CREATE TABLE IF NOT EXISTS pos_clearing_components (
  id BIGSERIAL PRIMARY KEY,
  settlement_id BIGINT NOT NULL REFERENCES pos_settlements(id) ON DELETE RESTRICT,
  settlement_code TEXT NOT NULL,
  component_key TEXT NOT NULL,
  component VARCHAR(40) NOT NULL CHECK (component IN ('RECEIPT_NET', 'RECEIPT_FEE', 'RECEIPT_RECLASS', 'FEE_RECOGNITION', 'BANK_CLEARING')),
  scope TEXT NOT NULL,
  zoho_record_type VARCHAR(24) NOT NULL CHECK (zoho_record_type IN ('customer_payment', 'journal', 'bank_transfer')),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  currency CHAR(3) NOT NULL,
  reference TEXT NOT NULL,
  customer_id TEXT,
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
  CONSTRAINT uq_pos_clearing_components_key UNIQUE (component_key),
  CONSTRAINT ck_pos_clearing_components_verified
    CHECK (status <> 'VERIFIED' OR (zoho_record_id IS NOT NULL AND verified_at IS NOT NULL)),
  CONSTRAINT ck_pos_clearing_components_uncertain
    CHECK (status <> 'POSTING_UNCERTAIN' OR (uncertain_since IS NOT NULL AND first_uncertain_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_pos_clearing_components_record
  ON pos_clearing_components (zoho_record_type, zoho_record_id) WHERE zoho_record_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pos_clearing_components_settlement ON pos_clearing_components (settlement_id);

CREATE TABLE IF NOT EXISTS pos_clearing_events (
  id BIGSERIAL PRIMARY KEY,
  settlement_id BIGINT REFERENCES pos_settlements(id) ON DELETE RESTRICT,
  component_id BIGINT,
  transaction_id BIGINT,
  file_id BIGINT,
  settlement_code TEXT,
  event_type VARCHAR(40) NOT NULL,
  from_status VARCHAR(32),
  to_status VARCHAR(32),
  detail TEXT,
  evidence JSONB,
  actor TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pos_clearing_events_settlement ON pos_clearing_events (settlement_id, created_at);

CREATE TABLE IF NOT EXISTS pos_clearing_account_mappings (
  role VARCHAR(32) PRIMARY KEY CHECK (role IN ('UNDEPOSITED', 'PROCESSING', 'FEE_EXPENSE', 'INPUT_VAT', 'BANK')),
  account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  account_code TEXT,
  account_type TEXT NOT NULL,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
