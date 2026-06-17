-- Safe additive column for Amazon support correlation (not a secret).
ALTER TABLE amazon_api_call_log
  ADD COLUMN IF NOT EXISTS amazon_request_id VARCHAR(128);
