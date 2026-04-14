-- Alternate employee covers work during this employee's annual leave (HR reference).
ALTER TABLE employees
  ADD COLUMN IF NOT EXISTS alternate_employee_id INTEGER REFERENCES employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_employees_alternate_employee_id ON employees(alternate_employee_id);
