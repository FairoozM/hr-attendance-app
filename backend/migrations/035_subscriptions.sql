-- Subscription Management tables (reference; also applied via ensureSubscriptionsTables on boot)

CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  name VARCHAR(500) NOT NULL,
  vendor VARCHAR(255) NOT NULL DEFAULT '',
  category VARCHAR(100) NOT NULL DEFAULT 'Other',
  status VARCHAR(50) NOT NULL DEFAULT 'Active',
  billing_cycle VARCHAR(50) NOT NULL DEFAULT 'Monthly',
  cost NUMERIC(14, 2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'AED',
  start_date DATE,
  expiry_date DATE,
  auto_renew BOOLEAN NOT NULL DEFAULT false,
  responsible_person VARCHAR(255) NOT NULL DEFAULT '',
  invoice_required BOOLEAN NOT NULL DEFAULT true,
  invoice_status VARCHAR(100) NOT NULL DEFAULT 'Missing',
  payment_status VARCHAR(100) NOT NULL DEFAULT 'Unpaid',
  payment_sent_at TIMESTAMPTZ,
  payment_sent_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_expiry ON subscriptions(expiry_date);
CREATE INDEX IF NOT EXISTS idx_subscriptions_deleted ON subscriptions(deleted_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_subscriptions_name_active ON subscriptions(name) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS subscription_invoices (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  file_name VARCHAR(500) NOT NULL DEFAULT '',
  file_url TEXT NOT NULL DEFAULT '',
  s3_key VARCHAR(1000) NOT NULL DEFAULT '',
  amount NUMERIC(14, 2),
  currency VARCHAR(10) NOT NULL DEFAULT 'AED',
  uploaded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_subscription_invoices_sub ON subscription_invoices(subscription_id);

CREATE TABLE IF NOT EXISTS subscription_activity_logs (
  id SERIAL PRIMARY KEY,
  subscription_id INTEGER NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  action VARCHAR(100) NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscription_activity_sub ON subscription_activity_logs(subscription_id);
