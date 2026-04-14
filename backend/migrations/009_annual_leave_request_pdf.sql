-- Stored leave request letter (PDF) for annual leave applications
ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS leave_request_pdf_key TEXT;
ALTER TABLE annual_leave ADD COLUMN IF NOT EXISTS leave_request_pdf_generated_at TIMESTAMPTZ;
