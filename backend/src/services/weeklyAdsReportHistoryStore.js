/**
 * Weekly Ads report snapshots — persisted per user in PostgreSQL (not localStorage).
 */

const { query } = require('../db')

async function ensureWeeklyAdsReportHistoryTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS weekly_ads_report_history (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      start_date DATE NOT NULL,
      end_date DATE NOT NULL,
      rows JSONB NOT NULL,
      notes TEXT NOT NULL DEFAULT '',
      saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, client_id)
    )
  `)
  await query(
    `CREATE INDEX IF NOT EXISTS idx_weekly_ads_hist_user_saved ON weekly_ads_report_history (user_id, saved_at DESC)`,
  )
}

/**
 * @param {number} userId
 * @returns {Promise<object[]>} entries for UI (id = client_id)
 */
async function listWeeklyAdsReportHistory(userId) {
  const { rows } = await query(
    `SELECT client_id, title, start_date, end_date, rows, notes, saved_at
     FROM weekly_ads_report_history
     WHERE user_id = $1
     ORDER BY saved_at DESC`,
    [userId],
  )
  return rows.map((r) => ({
    id: r.client_id,
    title: r.title || '',
    startDate: r.start_date instanceof Date ? r.start_date.toISOString().slice(0, 10) : String(r.start_date),
    endDate: r.end_date instanceof Date ? r.end_date.toISOString().slice(0, 10) : String(r.end_date),
    rows: r.rows,
    notes: r.notes || '',
    savedAt: r.saved_at instanceof Date ? r.saved_at.toISOString() : String(r.saved_at),
  }))
}

/**
 * @param {number} userId
 * @param {object} body
 * @param {string} body.id
 * @param {string} body.title
 * @param {string} body.startDate
 * @param {string} body.endDate
 * @param {object} body.rows
 * @param {string} [body.notes]
 */
async function upsertWeeklyAdsReportHistory(userId, body) {
  const clientId = String(body.id || '').trim()
  const title = String(body.title ?? '').slice(0, 500)
  const startDate = String(body.startDate || '').trim()
  const endDate = String(body.endDate || '').trim()
  const notes = String(body.notes ?? '').slice(0, 20000)
  const rows = body.rows != null && typeof body.rows === 'object' ? body.rows : {}

  await query(
    `INSERT INTO weekly_ads_report_history (user_id, client_id, title, start_date, end_date, rows, notes, saved_at, updated_at)
     VALUES ($1, $2, $3, $4::date, $5::date, $6::jsonb, $7, NOW(), NOW())
     ON CONFLICT (user_id, client_id) DO UPDATE SET
       title = EXCLUDED.title,
       start_date = EXCLUDED.start_date,
       end_date = EXCLUDED.end_date,
       rows = EXCLUDED.rows,
       notes = EXCLUDED.notes,
       saved_at = NOW(),
       updated_at = NOW()`,
    [userId, clientId, title, startDate, endDate, JSON.stringify(rows), notes],
  )
}

/**
 * @param {number} userId
 * @param {string} clientId
 * @returns {Promise<boolean>} true if a row was deleted
 */
async function deleteWeeklyAdsReportHistory(userId, clientId) {
  const id = String(clientId || '').trim()
  const r = await query(
    `DELETE FROM weekly_ads_report_history WHERE user_id = $1 AND client_id = $2`,
    [userId, id],
  )
  return (r.rowCount || 0) > 0
}

module.exports = {
  ensureWeeklyAdsReportHistoryTable,
  listWeeklyAdsReportHistory,
  upsertWeeklyAdsReportHistory,
  deleteWeeklyAdsReportHistory,
}
