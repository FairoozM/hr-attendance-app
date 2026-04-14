ALTER TABLE annual_leave
  ADD COLUMN IF NOT EXISTS alternate_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_annual_leave_alternate_employee_id
  ON annual_leave(alternate_employee_id);
