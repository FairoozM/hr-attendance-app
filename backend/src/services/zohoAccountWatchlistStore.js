/**
 * Company-level Zoho Books account balance watchlist (shared).
 */

const { query } = require('../db')

async function ensureZohoAccountWatchlistTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS zoho_account_watchlist (
      account_id VARCHAR(64) PRIMARY KEY,
      account_name VARCHAR(500) NOT NULL DEFAULT '',
      account_code VARCHAR(100) NOT NULL DEFAULT '',
      account_type VARCHAR(100) NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await query(`
    CREATE INDEX IF NOT EXISTS idx_zoho_account_watchlist_sort
    ON zoho_account_watchlist (sort_order, created_at)
  `)
}

/**
 * @returns {Promise<Array<{
 *   accountId: string,
 *   accountName: string,
 *   accountCode: string,
 *   accountType: string,
 *   sortOrder: number,
 *   addedBy: number|null,
 *   createdAt: string,
 *   updatedAt: string,
 * }>>}
 */
async function listWatchedAccounts() {
  const { rows } = await query(
    `SELECT account_id, account_name, account_code, account_type,
            sort_order, added_by, created_at, updated_at
     FROM zoho_account_watchlist
     ORDER BY sort_order ASC, created_at ASC`,
  )
  return rows.map((row) => ({
    accountId: String(row.account_id),
    accountName: String(row.account_name || ''),
    accountCode: String(row.account_code || ''),
    accountType: String(row.account_type || ''),
    sortOrder: Number(row.sort_order) || 0,
    addedBy: row.added_by == null ? null : Number(row.added_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }))
}

/**
 * @param {string} accountId
 */
async function getWatchedAccount(accountId) {
  const id = String(accountId || '').trim()
  if (!id) return null
  const { rows } = await query(
    `SELECT account_id, account_name, account_code, account_type,
            sort_order, added_by, created_at, updated_at
     FROM zoho_account_watchlist
     WHERE account_id = $1`,
    [id],
  )
  const row = rows[0]
  if (!row) return null
  return {
    accountId: String(row.account_id),
    accountName: String(row.account_name || ''),
    accountCode: String(row.account_code || ''),
    accountType: String(row.account_type || ''),
    sortOrder: Number(row.sort_order) || 0,
    addedBy: row.added_by == null ? null : Number(row.added_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * @param {{
 *   accountId: string,
 *   accountName?: string,
 *   accountCode?: string,
 *   accountType?: string,
 *   addedBy?: number|null,
 * }} account
 */
async function addWatchedAccount(account) {
  const accountId = String(account?.accountId || '').trim()
  if (!accountId) {
    const err = new Error('account_id is required')
    err.code = 'VALIDATION'
    err.status = 400
    throw err
  }

  const { rows: maxRows } = await query(
    `SELECT COALESCE(MAX(sort_order), 0)::int AS max_sort FROM zoho_account_watchlist`,
  )
  const nextSort = (Number(maxRows[0]?.max_sort) || 0) + 1

  const { rows } = await query(
    `INSERT INTO zoho_account_watchlist
       (account_id, account_name, account_code, account_type, sort_order, added_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
     ON CONFLICT (account_id) DO UPDATE SET
       account_name = EXCLUDED.account_name,
       account_code = EXCLUDED.account_code,
       account_type = EXCLUDED.account_type,
       updated_at = NOW()
     RETURNING account_id, account_name, account_code, account_type,
               sort_order, added_by, created_at, updated_at`,
    [
      accountId,
      String(account?.accountName || '').trim(),
      String(account?.accountCode || '').trim(),
      String(account?.accountType || '').trim(),
      nextSort,
      account?.addedBy == null ? null : Number(account.addedBy),
    ],
  )
  const row = rows[0]
  return {
    accountId: String(row.account_id),
    accountName: String(row.account_name || ''),
    accountCode: String(row.account_code || ''),
    accountType: String(row.account_type || ''),
    sortOrder: Number(row.sort_order) || 0,
    addedBy: row.added_by == null ? null : Number(row.added_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * @param {string} accountId
 * @returns {Promise<boolean>} true if a row was deleted
 */
async function removeWatchedAccount(accountId) {
  const id = String(accountId || '').trim()
  if (!id) return false
  const { rowCount } = await query(
    `DELETE FROM zoho_account_watchlist WHERE account_id = $1`,
    [id],
  )
  return Number(rowCount) > 0
}

module.exports = {
  ensureZohoAccountWatchlistTable,
  listWatchedAccounts,
  getWatchedAccount,
  addWatchedAccount,
  removeWatchedAccount,
}
