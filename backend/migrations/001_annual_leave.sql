-- Optional: run manually if you do not rely on server startup migrations.
-- App also creates these via backend/src/db/index.js ensure* helpers.

CREATE TABLE IF NOT EXISTS annual_leave (
  id SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  reason TEXT,
  status VARCHAR(20) NOT NULL DEFAULT 'Pending'
    CHECK (status IN ('Pending', 'Approved', 'Rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_annual_leave_employee_id ON annual_leave(employee_id);

ALTER TABLE attendance
  ADD COLUMN IF NOT EXISTS annual_leave_id INTEGER REFERENCES annual_leave(id) ON DELETE SET NULL;
