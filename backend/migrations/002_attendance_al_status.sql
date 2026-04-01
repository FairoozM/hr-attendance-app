-- Rename Holiday (H) to Annual Leave (AL); align approved annual-leave sync rows (were stored as A).
UPDATE attendance SET status = 'AL' WHERE status = 'H';
UPDATE attendance SET status = 'AL' WHERE annual_leave_id IS NOT NULL AND status = 'A';
