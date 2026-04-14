-- Optional manual migration; backend/src/db/index.js also ensures these via ensure* helpers.

-- Shop visit workflow (separate from leave approval status)
ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_status VARCHAR(40);
ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_date DATE;
ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_time VARCHAR(32);
ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_note TEXT;
ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_submitted_at TIMESTAMPTZ;
ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_confirmed_by INTEGER REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_confirmed_at TIMESTAMPTZ;
ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS shop_visit_admin_note TEXT;
ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS calculated_leave_amount NUMERIC(14,2);
ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS calculator_snapshot JSONB;

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  type VARCHAR(64) NOT NULL,
  title TEXT,
  message TEXT NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMPTZ,
  scheduled_for DATE NOT NULL,
  trigger_key VARCHAR(255) NOT NULL UNIQUE,
  employee_id INTEGER REFERENCES employees(id) ON DELETE CASCADE,
  annual_leave_id INTEGER REFERENCES annual_leave(id) ON DELETE CASCADE,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_scheduled ON notifications(scheduled_for);
CREATE INDEX IF NOT EXISTS idx_notifications_employee ON notifications(employee_id);
CREATE INDEX IF NOT EXISTS idx_notifications_leave ON notifications(annual_leave_id);
