-- Independent of employment status: when false, employee is hidden from attendance UI.
ALTER TABLE employees ADD COLUMN IF NOT EXISTS include_in_attendance BOOLEAN NOT NULL DEFAULT true;
