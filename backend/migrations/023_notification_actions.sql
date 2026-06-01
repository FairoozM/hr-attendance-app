-- Persist snooze / ignore / resolve actions for dynamically generated compliance notifications.

CREATE TABLE IF NOT EXISTS notification_actions (
  id SERIAL PRIMARY KEY,
  notification_key VARCHAR(512) NOT NULL UNIQUE,
  source_type VARCHAR(64) NOT NULL DEFAULT '',
  source_id VARCHAR(64) NOT NULL DEFAULT '',
  status VARCHAR(32) NOT NULL DEFAULT 'active',
  snoozed_until DATE,
  resolved_at TIMESTAMPTZ,
  resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ignored_at TIMESTAMPTZ,
  ignored_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ignore_reason TEXT NOT NULL DEFAULT '',
  due_date DATE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notification_actions_status ON notification_actions(status);
CREATE INDEX IF NOT EXISTS idx_notification_actions_snoozed_until ON notification_actions(snoozed_until);
CREATE INDEX IF NOT EXISTS idx_notification_actions_source ON notification_actions(source_type, source_id);
