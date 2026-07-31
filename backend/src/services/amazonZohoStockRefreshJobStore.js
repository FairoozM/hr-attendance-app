const { query } = require('../db')

function refreshStaleMinutes(value = process.env.AMAZON_ZOHO_STOCK_REFRESH_STALE_MINUTES) {
  const parsed = parseInt(String(value == null ? '' : value).trim(), 10)
  const minutes = Number.isFinite(parsed) && parsed > 0 ? parsed : 10
  return Math.min(120, Math.max(2, minutes))
}

async function ensureAmazonZohoStockRefreshJobTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS amazon_zoho_stock_refresh_job (
      id UUID PRIMARY KEY,
      marketplace VARCHAR(16) NOT NULL DEFAULT 'all',
      status VARCHAR(24) NOT NULL DEFAULT 'queued',
      progress_step TEXT,
      progress_current INTEGER NOT NULL DEFAULT 0,
      progress_total INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      total_rows INTEGER,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_amz_zoho_refresh_job_status
     ON amazon_zoho_stock_refresh_job (status, started_at DESC)`
  )
}

function mapRow(r) {
  if (!r) return null
  return {
    jobId: r.id,
    status: r.status,
    marketplace: r.marketplace,
    progress: {
      step: r.progress_step || '',
      current: Number(r.progress_current) || 0,
      total: Number(r.progress_total) || 0,
    },
    startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
    completedAt: r.completed_at ? new Date(r.completed_at).toISOString() : null,
    error: r.error_message || null,
    totalRows: r.total_rows == null ? null : Number(r.total_rows),
    metadata: r.metadata && typeof r.metadata === 'object' ? r.metadata : {},
  }
}

async function insertJob({ jobId, marketplace }) {
  await query(
    `INSERT INTO amazon_zoho_stock_refresh_job (
      id, marketplace, status, progress_step, progress_current, progress_total, started_at, updated_at
    ) VALUES ($1, $2, 'queued', 'Queued', 0, 0, NOW(), NOW())`,
    [jobId, marketplace || 'all']
  )
}

async function updateJob(jobId, patch) {
  const fields = []
  const vals = []
  let i = 1
  if (patch.status) {
    fields.push(`status = $${i++}`)
    vals.push(patch.status)
  }
  if (patch.progress) {
    if (patch.progress.step !== undefined) {
      fields.push(`progress_step = $${i++}`)
      vals.push(patch.progress.step)
    }
    if (patch.progress.current !== undefined) {
      fields.push(`progress_current = $${i++}`)
      vals.push(patch.progress.current)
    }
    if (patch.progress.total !== undefined) {
      fields.push(`progress_total = $${i++}`)
      vals.push(patch.progress.total)
    }
  }
  if (patch.error !== undefined) {
    fields.push(`error_message = $${i++}`)
    vals.push(patch.error)
  }
  if (patch.completedAt !== undefined) {
    fields.push(`completed_at = $${i++}`)
    vals.push(patch.completedAt)
  }
  if (patch.totalRows !== undefined) {
    fields.push(`total_rows = $${i++}`)
    vals.push(patch.totalRows)
  }
  if (patch.metadata !== undefined) {
    fields.push(`metadata = $${i++}::jsonb`)
    vals.push(JSON.stringify(patch.metadata))
  }
  if (fields.length === 0) return
  fields.push('updated_at = NOW()')
  vals.push(jobId)
  await query(
    `UPDATE amazon_zoho_stock_refresh_job SET ${fields.join(', ')} WHERE id = $${i}`,
    vals
  )
}

async function getJob(jobId) {
  const r = await query(
    `SELECT id, marketplace, status, progress_step, progress_current, progress_total,
            error_message, total_rows, metadata, started_at, completed_at
     FROM amazon_zoho_stock_refresh_job WHERE id = $1`,
    [jobId]
  )
  return mapRow(r.rows[0])
}

async function findRunningJob(marketplace) {
  const mk = String(marketplace || 'all').trim().toLowerCase()
  const staleMins = refreshStaleMinutes()
  const r = await query(
    `SELECT id, marketplace, status, progress_step, progress_current, progress_total,
            error_message, total_rows, metadata, started_at, completed_at
     FROM amazon_zoho_stock_refresh_job
     WHERE status IN ('queued', 'running')
       AND updated_at > NOW() - ($2::int * interval '1 minute')
       AND ($1 = 'all' OR marketplace = $1 OR marketplace = 'all')
     ORDER BY started_at DESC
     LIMIT 1`,
    [mk === 'uae' || mk === 'ksa' ? mk : 'all', staleMins]
  )
  return mapRow(r.rows[0])
}

async function markStaleJobsFailed() {
  const staleMins = refreshStaleMinutes()
  await query(
    `UPDATE amazon_zoho_stock_refresh_job
     SET status = 'failed',
         completed_at = NOW(),
         error_message = COALESCE(error_message, 'Refresh timed out or server restarted'),
         updated_at = NOW()
     WHERE status IN ('queued', 'running')
       AND updated_at < NOW() - ($1::int * interval '1 minute')`,
    [staleMins]
  )
}

module.exports = {
  ensureAmazonZohoStockRefreshJobTable,
  insertJob,
  updateJob,
  getJob,
  findRunningJob,
  markStaleJobsFailed,
  _internals: {
    refreshStaleMinutes,
  },
}
