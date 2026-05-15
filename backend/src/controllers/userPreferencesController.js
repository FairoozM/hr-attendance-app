const {
  getAllUserPreferences,
  setUserPreference,
  KEY_RE,
} = require('../services/userPreferencesStore')

function userIdFromReq(req) {
  const uid = parseInt(String(req.user && req.user.userId), 10)
  return Number.isFinite(uid) && uid > 0 ? uid : null
}

/**
 * GET /api/user-preferences
 */
async function getUserPreferences(req, res) {
  const userId = userIdFromReq(req)
  if (!userId) return res.status(400).json({ error: 'Invalid user' })
  try {
    const preferences = await getAllUserPreferences(userId)
    return res.json({ preferences })
  } catch (err) {
    console.error('[userPreferences] get:', err && err.message)
    return res.status(500).json({ error: 'Failed to load preferences' })
  }
}

/**
 * PUT /api/user-preferences
 * Body: { key: string, value: any JSON-serializable | null to delete }
 */
async function putUserPreference(req, res) {
  const userId = userIdFromReq(req)
  if (!userId) return res.status(400).json({ error: 'Invalid user' })
  const key = req.body && req.body.key
  if (key == null || !KEY_RE.test(String(key).trim())) {
    return res.status(400).json({ error: 'key is required (1–120 chars: letters, digits, _ . -)' })
  }
  const value = req.body.value
  let size = 0
  if (value !== null && value !== undefined) {
    try {
      size = Buffer.byteLength(JSON.stringify(value), 'utf8')
    } catch {
      return res.status(400).json({ error: 'value must be JSON-serializable' })
    }
    if (size > 12_000_000) {
      return res.status(400).json({ error: 'value too large' })
    }
  }
  try {
    await setUserPreference(userId, String(key).trim(), value)
    const preferences = await getAllUserPreferences(userId)
    return res.json({ preferences })
  } catch (err) {
    if (err && err.code === 'INVALID_PREF_KEY') {
      return res.status(400).json({ error: err.message })
    }
    console.error('[userPreferences] put:', err && err.message)
    return res.status(500).json({ error: 'Failed to save preference' })
  }
}

module.exports = { getUserPreferences, putUserPreference }
