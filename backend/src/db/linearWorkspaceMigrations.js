/**
 * linearWorkspaceMigrations.js
 * Idempotent schema setup for all Phase 14A shared workspace tables.
 */
const { query } = require('./index')

async function ensureUsersLinearWorkspaceRoleColumn() {
  await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS linear_workspace_role TEXT NULL`)
  await query(`CREATE INDEX IF NOT EXISTS idx_users_linear_workspace_role ON users(linear_workspace_role)`)
}

async function ensureLinearDocsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS linear_docs (
      id           SERIAL PRIMARY KEY,
      title        TEXT NOT NULL,
      category     TEXT,
      tags         TEXT[] DEFAULT '{}',
      summary      TEXT,
      content      TEXT,
      related_project_id INTEGER NULL REFERENCES projects(id) ON DELETE SET NULL,
      related_labels TEXT[] DEFAULT '{}',
      created_by   INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      updated_by   INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at   TIMESTAMP DEFAULT NOW(),
      updated_at   TIMESTAMP DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_docs_category ON linear_docs(category)`)
}

async function ensureLinearIntakeTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS linear_intake_items (
      id                    SERIAL PRIMARY KEY,
      title                 TEXT NOT NULL,
      source                TEXT,
      type                  TEXT,
      platform              TEXT,
      status                TEXT DEFAULT 'New',
      priority_suggestion   TEXT,
      description           TEXT,
      url_or_screen         TEXT,
      customer_reference    TEXT,
      labels                TEXT[] DEFAULT '{}',
      template              TEXT,
      structured_fields     JSONB DEFAULT '{}'::jsonb,
      linked_issue_id       INTEGER NULL REFERENCES project_tasks(id) ON DELETE SET NULL,
      duplicate_of_intake_id INTEGER NULL,
      duplicate_reason      TEXT,
      created_by            INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      updated_by            INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at            TIMESTAMP DEFAULT NOW(),
      updated_at            TIMESTAMP DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_intake_status   ON linear_intake_items(status)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_intake_created  ON linear_intake_items(created_at DESC)`)
}

async function ensureLinearMobileReleasesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS linear_mobile_releases (
      id               SERIAL PRIMARY KEY,
      name             TEXT NOT NULL,
      platform         TEXT,
      version_number   TEXT,
      build_number     TEXT,
      status           TEXT DEFAULT 'Planning',
      target_date      DATE NULL,
      submitted_at     TIMESTAMP NULL,
      released_at      TIMESTAMP NULL,
      notes            TEXT,
      store_links      JSONB DEFAULT '{}'::jsonb,
      linked_issue_ids INTEGER[] DEFAULT '{}',
      checklist        JSONB DEFAULT '{}'::jsonb,
      created_by       INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      updated_by       INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at       TIMESTAMP DEFAULT NOW(),
      updated_at       TIMESTAMP DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_mobile_releases_status ON linear_mobile_releases(status)`)
}

async function ensureLinearDeploymentsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS linear_deployments (
      id               SERIAL PRIMARY KEY,
      name             TEXT NOT NULL,
      deployment_type  TEXT,
      environment      TEXT,
      status           TEXT DEFAULT 'Planning',
      target_date      DATE NULL,
      started_at       TIMESTAMP NULL,
      deployed_at      TIMESTAMP NULL,
      verified_at      TIMESTAMP NULL,
      deployed_by      INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      verified_by      INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      notes            TEXT,
      rollback_notes   TEXT,
      linked_issue_ids INTEGER[] DEFAULT '{}',
      checklist        JSONB DEFAULT '{}'::jsonb,
      created_by       INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      updated_by       INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at       TIMESTAMP DEFAULT NOW(),
      updated_at       TIMESTAMP DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_deployments_status ON linear_deployments(status)`)
}

async function ensureLinearChecklistRunsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS linear_checklist_runs (
      id               SERIAL PRIMARY KEY,
      context_type     TEXT NOT NULL,
      context_id       TEXT NOT NULL,
      doc_id           INTEGER NULL REFERENCES linear_docs(id) ON DELETE SET NULL,
      doc_title        TEXT,
      completed_items  JSONB DEFAULT '{}'::jsonb,
      notes            TEXT,
      created_by       INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      updated_by       INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at       TIMESTAMP DEFAULT NOW(),
      updated_at       TIMESTAMP DEFAULT NOW()
    )
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_linear_checklist_runs_context
      ON linear_checklist_runs(context_type, context_id)
  `)
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_linear_checklist_runs_unique
      ON linear_checklist_runs(context_type, context_id, COALESCE(doc_id, 0))
  `)
}

async function ensureLinearAuditLogTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS linear_audit_log (
      id SERIAL PRIMARY KEY,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      action TEXT NOT NULL,
      actor_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      actor_name TEXT,
      summary TEXT,
      before_snapshot JSONB DEFAULT '{}'::jsonb,
      after_snapshot JSONB DEFAULT '{}'::jsonb,
      metadata JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_audit_log_entity_type ON linear_audit_log(entity_type)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_audit_log_entity_id ON linear_audit_log(entity_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_audit_log_actor_user_id ON linear_audit_log(actor_user_id)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_audit_log_created_at ON linear_audit_log(created_at DESC)`)
}

async function ensureLinearNotificationPreferencesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS linear_notification_preferences (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      channel_in_app BOOLEAN DEFAULT true,
      channel_email BOOLEAN DEFAULT false,
      channel_whatsapp BOOLEAN DEFAULT false,
      email_address TEXT NULL,
      whatsapp_number TEXT NULL,
      digest_daily BOOLEAN DEFAULT false,
      digest_weekly BOOLEAN DEFAULT false,
      digest_release BOOLEAN DEFAULT false,
      daily_digest_time TEXT DEFAULT '09:00',
      weekly_digest_day TEXT DEFAULT 'Monday',
      categories JSONB DEFAULT '{
        "assignedToMe": true,
        "comments": true,
        "readyForRelease": true,
        "qaApproved": true,
        "releaseApproved": true,
        "deploymentVerified": true,
        "githubMerged": true,
        "highPriority": true,
        "overdue": true,
        "intakeConverted": true,
        "roleChanged": false
      }'::jsonb,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE(user_id)
    )
  `)
  await query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_linear_notification_preferences_user_id
      ON linear_notification_preferences(user_id)
  `)
}

async function ensureLinearDigestOutboxTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS linear_digest_outbox (
      id SERIAL PRIMARY KEY,
      digest_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT DEFAULT 'draft',
      target_channel TEXT DEFAULT 'manual',
      created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_digest_outbox_status ON linear_digest_outbox(status)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_digest_outbox_type ON linear_digest_outbox(digest_type)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_digest_outbox_created_by ON linear_digest_outbox(created_by)`)
}

async function ensureLinearLaunchRecordsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS linear_launch_records (
      id SERIAL PRIMARY KEY,
      launch_name TEXT NOT NULL,
      launch_type TEXT,
      environment TEXT,
      status TEXT DEFAULT 'Completed',
      linked_issue_ids INTEGER[] DEFAULT '{}',
      linked_deployment_id INTEGER NULL REFERENCES linear_deployments(id) ON DELETE SET NULL,
      linked_mobile_release_id INTEGER NULL REFERENCES linear_mobile_releases(id) ON DELETE SET NULL,
      readiness_snapshot JSONB DEFAULT '{}'::jsonb,
      health_snapshot JSONB DEFAULT '{}'::jsonb,
      smoke_snapshot JSONB DEFAULT '{}'::jsonb,
      checklist_snapshot JSONB DEFAULT '{}'::jsonb,
      qa_summary TEXT,
      deployment_summary TEXT,
      rollback_used BOOLEAN DEFAULT false,
      incident_notes TEXT,
      what_went_well TEXT,
      what_went_wrong TEXT,
      follow_up_actions TEXT,
      reviewed_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMP NULL,
      created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_launch_records_created_at ON linear_launch_records(created_at DESC)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_launch_records_status ON linear_launch_records(status)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_launch_records_environment ON linear_launch_records(environment)`)
  await query(`CREATE INDEX IF NOT EXISTS idx_linear_launch_records_launch_type ON linear_launch_records(launch_type)`)
}

async function ensureLinearWorkspaceTables() {
  await ensureUsersLinearWorkspaceRoleColumn()
  await ensureLinearDocsTable()
  await ensureLinearIntakeTable()
  await ensureLinearMobileReleasesTable()
  await ensureLinearDeploymentsTable()
  await ensureLinearLaunchRecordsTable()
  await ensureLinearChecklistRunsTable()
  await ensureLinearAuditLogTable()
  await ensureLinearNotificationPreferencesTable()
  await ensureLinearDigestOutboxTable()
  console.log('[db] Linear workspace tables: OK')
}

module.exports = { ensureLinearWorkspaceTables }
