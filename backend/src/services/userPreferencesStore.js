/**
 * Per-user JSON preferences (PostgreSQL). Replaces browser localStorage for synced client state.
 */

const { query } = require('../db')

const KEY_RE = /^[a-z0-9][a-z0-9_.-]{0,119}$/i

async function ensureUserPreferencesTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pref_key VARCHAR(120) NOT NULL,
      pref_value JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (user_id, pref_key)
    )
  `)
  await query(`CREATE INDEX IF NOT EXISTS idx_user_preferences_user ON user_preferences (user_id)`)
}

/**
 * @param {number} userId
 * @returns {Promise<Record<string, unknown>>}
 */
async function getAllUserPreferences(userId) {
  const { rows } = await query(
    `SELECT pref_key, pref_value FROM user_preferences WHERE user_id = $1`,
    [userId],
  )
  const out = {}
  for (const r of rows) {
    out[r.pref_key] = r.pref_value
  }
  return out
}

function assertKey(key) {
  const k = String(key || '').trim()
  if (!KEY_RE.test(k)) {
    const e = new Error('Invalid preference key')
    e.code = 'INVALID_PREF_KEY'
    throw e
  }
  return k
}

/**
 * @param {number} userId
 * @param {string} key
 * @param {unknown} value — JSON-serializable; null removes the row
 */
async function setUserPreference(userId, key, value) {
  const k = assertKey(key)
  if (value === null || value === undefined) {
    await query(`DELETE FROM user_preferences WHERE user_id = $1 AND pref_key = $2`, [userId, k])
    return
  }
  await query(
    `INSERT INTO user_preferences (user_id, pref_key, pref_value, updated_at)
     VALUES ($1, $2, $3::jsonb, NOW())
     ON CONFLICT (user_id, pref_key) DO UPDATE SET
       pref_value = EXCLUDED.pref_value,
       updated_at = NOW()`,
    [userId, k, JSON.stringify(value)],
  )
}

module.exports = {
  ensureUserPreferencesTable,
  getAllUserPreferences,
  setUserPreference,
  KEY_RE,
}
