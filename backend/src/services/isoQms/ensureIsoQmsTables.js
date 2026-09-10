const fs = require('fs')
const path = require('path')
const { query } = require('../../db')

/**
 * Ensure all ISO & QMS tables, indexes, and seed rows exist.
 * Executes the reference migration (safe IF NOT EXISTS / ON CONFLICT).
 * Does not catch — caller wraps with try/catch.
 */
async function ensureIsoQmsTables() {
  const migrationPath = path.join(__dirname, '../../../migrations/044_iso_qms.sql')
  const sql = fs.readFileSync(migrationPath, 'utf8')
  await query(sql)
  console.log('[db] ISO QMS tables: OK')
}

module.exports = {
  ensureIsoQmsTables,
}
