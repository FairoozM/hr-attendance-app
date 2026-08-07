-- Per-performance-contract payment tracking (separate from influencers_snapshot paymentStatus).

CREATE TABLE IF NOT EXISTS influencer_contract_payments (
  contract_id TEXT PRIMARY KEY REFERENCES influencer_performance_contracts(id) ON DELETE CASCADE,
  influencer_id TEXT NOT NULL,
  amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
  payment_status VARCHAR(50) NOT NULL DEFAULT 'Not Due',
  due_date DATE,
  payment_date DATE,
  invoice_reference TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  zoho_vendor_bill_id TEXT,
  zoho_payment_id TEXT,
  zoho_last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_icp_influencer ON influencer_contract_payments(influencer_id);
CREATE INDEX IF NOT EXISTS idx_icp_status ON influencer_contract_payments(payment_status);
CREATE INDEX IF NOT EXISTS idx_icp_due_date ON influencer_contract_payments(due_date);
