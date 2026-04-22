-- Optional manual migration; backend/src/db/index.js also ensures these via ensure* helpers.
--
-- item_report_groups maps Zoho items (by sku, item_id, or display name) to a
-- logical "report_group" used by the Weekly Reports section. The grouping is
-- the source of truth for which items appear in which weekly report. The
-- numeric values themselves (opening/closing stock, purchases, returns, sold)
-- always come from the Zoho-source webhook — this table only decides
-- membership.

CREATE TABLE IF NOT EXISTS item_report_groups (
  id           SERIAL PRIMARY KEY,
  sku          VARCHAR(100),
  item_id      VARCHAR(100),
  item_name    VARCHAR(255),
  report_group VARCHAR(64) NOT NULL,
  active       BOOLEAN NOT NULL DEFAULT true,
  notes        TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (sku IS NOT NULL OR item_id IS NOT NULL OR item_name IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_irg_group ON item_report_groups(report_group, active);
CREATE INDEX IF NOT EXISTS idx_irg_sku   ON item_report_groups(LOWER(sku));
CREATE INDEX IF NOT EXISTS idx_irg_name  ON item_report_groups(LOWER(item_name));

-- Partial unique indexes prevent duplicate (sku, group) and (item_name, group) pairs
-- while still allowing rows that only carry one of the identifiers.
CREATE UNIQUE INDEX IF NOT EXISTS uq_irg_sku_group
  ON item_report_groups(LOWER(sku), report_group)
  WHERE sku IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_irg_name_group
  ON item_report_groups(LOWER(item_name), report_group)
  WHERE sku IS NULL AND item_name IS NOT NULL;
