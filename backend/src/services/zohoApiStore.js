/**
 * PostgreSQL persistence for Zoho API guard rails (usage log, response cache, sync locks).
 * Equivalent to Mongo collections ZohoApiUsageLog, ZohoApiCache, ZohoSyncLock requested for HR/BI.
 */

const { query } = require('../db')

function utcDayStart() {
  const d = new Date()
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
}

async function ensureZohoApiTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS zoho_api_usage_log (
      id BIGSERIAL PRIMARY KEY,
      endpoint TEXT NOT NULL,
      method VARCHAR(16) NOT NULL DEFAULT 'GET',
      cache_key TEXT,
      status VARCHAR(32) NOT NULL,
      source TEXT,
      called_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      response_code INTEGER,
      error_message TEXT,
      cost INTEGER NOT NULL DEFAULT 1
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_zoho_api_usage_called_at ON zoho_api_usage_log (called_at)`)
  await query(`
    CREATE TABLE IF NOT EXISTS zoho_api_cache (
      cache_key VARCHAR(512) PRIMARY KEY,
      data JSONB NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_zoho_api_cache_expires ON zoho_api_cache (expires_at)`)

  await query(`
    CREATE TABLE IF NOT EXISTS zoho_sync_lock (
      job_name VARCHAR(128) PRIMARY KEY,
      locked_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      status VARCHAR(32) NOT NULL DEFAULT 'running'
    )
  `)
}

/**
 * @param {object} row
 * @param {string} row.endpoint
 * @param {string} [row.method]
 * @param {string|null} [row.cacheKey]
 * @param {string} row.status
 * @param {string|null} [row.source]
 * @param {number|null} [row.responseCode]
 * @param {string|null} [row.errorMessage]
 * @param {number} [row.cost]
 */
async function insertUsageLog(row) {
  await query(
    `INSERT INTO zoho_api_usage_log
      (endpoint, method, cache_key, status, source, response_code, error_message, cost)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      row.endpoint,
      row.method || 'GET',
      row.cacheKey || null,
      row.status,
      row.source || null,
      row.responseCode != null ? row.responseCode : null,
      row.errorMessage || null,
      row.cost != null ? row.cost : 1,
    ]
  )
}

async function getCacheRow(cacheKey) {
  const r = await query(
    `SELECT data, expires_at FROM zoho_api_cache WHERE cache_key = $1`,
    [cacheKey]
  )
  return r.rows[0] || null
}

async function upsertCache(cacheKey, dataObj, expiresAt) {
  const now = new Date()
  await query(
    `INSERT INTO zoho_api_cache (cache_key, data, expires_at, created_at, updated_at)
     VALUES ($1, $2::jsonb, $3, $4, $4)
     ON CONFLICT (cache_key) DO UPDATE SET
       data = EXCLUDED.data,
       expires_at = EXCLUDED.expires_at,
       updated_at = EXCLUDED.updated_at`,
    [cacheKey, JSON.stringify(dataObj), expiresAt, now]
  )
}

async function deleteCacheByPrefix(prefix) {
  await query(`DELETE FROM zoho_api_cache WHERE cache_key LIKE $1`, [`${prefix}%`])
}

async function deleteAllCache() {
  await query(`DELETE FROM zoho_api_cache`)
}

async function cacheStats() {
  const total = await query(`SELECT COUNT(*)::int AS n FROM zoho_api_cache`)
  const soon = await query(
    `SELECT COUNT(*)::int AS n FROM zoho_api_cache WHERE expires_at > NOW() AND expires_at < NOW() + INTERVAL '1 hour'`
  )
  return {
    entries: total.rows[0]?.n || 0,
    expiringWithin1h: soon.rows[0]?.n || 0,
  }
}

/** Successful outbound Zoho calls since UTC midnight */
async function countSuccessfulCallsTodayUtc() {
  const r = await query(
    `SELECT COUNT(*)::int AS n FROM zoho_api_usage_log
     WHERE status = 'success'
       AND called_at >= $1`,
    [utcDayStart()]
  )
  return r.rows[0]?.n || 0
}

async function usageSummaryTodayUtc() {
  const day = utcDayStart()
  const r = await query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'success')::int AS success_count,
       COUNT(*) FILTER (WHERE status LIKE 'blocked%')::int AS blocked_count,
       COUNT(*) FILTER (WHERE status = 'error')::int AS error_count,
       COALESCE(SUM(cost) FILTER (WHERE status = 'success'), 0)::int AS success_cost
     FROM zoho_api_usage_log
     WHERE called_at >= $1`,
    [day]
  )
  return r.rows[0] || {}
}

async function usageByEndpointToday(limit = 50) {
  const r = await query(
    `SELECT endpoint, COUNT(*)::int AS calls
     FROM zoho_api_usage_log
     WHERE called_at >= $1
       AND status = 'success'
     GROUP BY endpoint
     ORDER BY calls DESC
     LIMIT $2`,
    [utcDayStart(), limit]
  )
  return r.rows
}

/**
 * @returns {Promise<boolean>}
 */
async function acquireSyncLock(jobName, ttlMs = 30 * 60 * 1000) {
  const now = new Date()
  const exp = new Date(now.getTime() + ttlMs)
  const r = await query(
    `INSERT INTO zoho_sync_lock (job_name, locked_at, expires_at, status)
     VALUES ($1, $2, $3, 'running')
     ON CONFLICT (job_name) DO NOTHING
     RETURNING job_name`,
    [jobName, now, exp]
  )
  if (r.rowCount > 0) return true
  const check = await query(
    `UPDATE zoho_sync_lock
     SET locked_at = $2, expires_at = $3, status = 'running'
     WHERE job_name = $1 AND expires_at < NOW()
     RETURNING job_name`,
    [jobName, now, exp]
  )
  return check.rowCount > 0
}

async function releaseSyncLock(jobName) {
  await query(`DELETE FROM zoho_sync_lock WHERE job_name = $1`, [jobName])
}

async function getSyncLock(jobName) {
  const r = await query(`SELECT * FROM zoho_sync_lock WHERE job_name = $1`, [jobName])
  return r.rows[0] || null
}

module.exports = {
  ensureZohoApiTables,
  insertUsageLog,
  getCacheRow,
  upsertCache,
  deleteCacheByPrefix,
  deleteAllCache,
  cacheStats,
  countSuccessfulCallsTodayUtc,
  usageSummaryTodayUtc,
  usageByEndpointToday,
  acquireSyncLock,
  releaseSyncLock,
  getSyncLock,
}
