ALTER TABLE amazon_ksa_rto_label_batches
  ADD COLUMN IF NOT EXISTS share_token TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS share_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS share_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS agent_notes TEXT,
  ADD COLUMN IF NOT EXISTS agent_completed_by_name TEXT,
  ADD COLUMN IF NOT EXISTS agent_status VARCHAR(32) NOT NULL DEFAULT 'pending';

ALTER TABLE amazon_ksa_rto_label_batches
  DROP CONSTRAINT IF EXISTS amazon_ksa_rto_label_batches_agent_status_chk;

ALTER TABLE amazon_ksa_rto_label_batches
  ADD CONSTRAINT amazon_ksa_rto_label_batches_agent_status_chk
  CHECK (agent_status IN ('pending', 'in_progress', 'completed'));

ALTER TABLE amazon_ksa_rto_label_rows
  ADD COLUMN IF NOT EXISTS agent_row_status VARCHAR(32) NOT NULL DEFAULT 'not_checked',
  ADD COLUMN IF NOT EXISTS agent_row_note TEXT,
  ADD COLUMN IF NOT EXISTS agent_checked_at TIMESTAMPTZ;

ALTER TABLE amazon_ksa_rto_label_rows
  DROP CONSTRAINT IF EXISTS amazon_ksa_rto_label_rows_agent_status_chk;

ALTER TABLE amazon_ksa_rto_label_rows
  ADD CONSTRAINT amazon_ksa_rto_label_rows_agent_status_chk
  CHECK (agent_row_status IN ('not_checked', 'checked', 'issue'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_amazon_ksa_rto_label_batches_share_token
  ON amazon_ksa_rto_label_batches(share_token)
  WHERE share_token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_amazon_ksa_rto_label_batches_share_enabled
  ON amazon_ksa_rto_label_batches(share_enabled, share_expires_at);
