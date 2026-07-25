-- Read state for dynamically generated compliance notifications (document expiry reminders).
-- Without this, every visible reminder counted as unread forever and the bell badge could
-- never be cleared: read state is independent of status so a reminder can be read yet still active.

ALTER TABLE notification_actions ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;
ALTER TABLE notification_actions
  ADD COLUMN IF NOT EXISTS read_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_notification_actions_read_at ON notification_actions(read_at);

-- Unread-count query filters on is_read and scheduled_for together.
CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(is_read, scheduled_for);
