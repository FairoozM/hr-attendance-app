-- Optional manual migration; backend/src/db/index.js also ensures this via
-- ensureItemReportGroupsImportLogTable().
--
-- A small append-only audit trail for the bulk-import feature on
-- item_report_groups. The admin UI shows the last 10 entries; older rows
-- are pruned automatically inside the same transaction that records a new
-- entry, so the table stays bounded without an external job.

CREATE TABLE IF NOT EXISTS item_report_groups_import_log (
  id                SERIAL PRIMARY KEY,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id           INTEGER,
  user_role         VARCHAR(32),
  mode              VARCHAR(32) NOT NULL,
  total_rows        INTEGER NOT NULL DEFAULT 0,
  created_count     INTEGER NOT NULL DEFAULT 0,
  updated_count     INTEGER NOT NULL DEFAULT 0,
  invalid_count     INTEGER NOT NULL DEFAULT 0,
  deactivated_count INTEGER NOT NULL DEFAULT 0,
  succeeded         BOOLEAN NOT NULL DEFAULT TRUE,
  error_code        VARCHAR(64),
  notes             TEXT
);

CREATE INDEX IF NOT EXISTS idx_irg_import_log_created_at
  ON item_report_groups_import_log (created_at DESC);
