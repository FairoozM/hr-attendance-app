-- Company-level Zoho Books account balance watchlist (shared across users).

CREATE TABLE IF NOT EXISTS zoho_account_watchlist (
  account_id VARCHAR(64) PRIMARY KEY,
  account_name VARCHAR(500) NOT NULL DEFAULT '',
  account_code VARCHAR(100) NOT NULL DEFAULT '',
  account_type VARCHAR(100) NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_zoho_account_watchlist_sort
  ON zoho_account_watchlist (sort_order, created_at);
