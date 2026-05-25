/**
 * linearWorkspaceMigrations.js
 * Idempotent schema setup for all Phase 14A shared workspace tables.
 */
const { query } = require('./index')

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

async function ensureLinearWorkspaceTables() {
  await ensureLinearDocsTable()
  await ensureLinearIntakeTable()
  await ensureLinearMobileReleasesTable()
  await ensureLinearDeploymentsTable()
  await ensureLinearChecklistRunsTable()
  console.log('[db] Linear workspace tables: OK')
}

module.exports = { ensureLinearWorkspaceTables }
