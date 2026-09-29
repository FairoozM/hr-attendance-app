-- Background "Post to Zoho" job state for Tabby settlement batches (also applied at server boot).
ALTER TABLE tabby_settlement_batches ADD COLUMN IF NOT EXISTS posting_job JSONB;
