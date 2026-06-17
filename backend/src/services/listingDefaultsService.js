const { query } = require('../db')

const VALID_APPLY_MODES = new Set(['fill_empty', 'overwrite_all', 'ask_before_overwrite', 'do_not_apply'])

function parseUserIdInt(reqUser) {
  const n = Number(reqUser?.userId)
  return Number.isFinite(n) && n > 0 ? n : null
}

function normalizeRule(rule) {
  const mode = VALID_APPLY_MODES.has(rule.apply_mode) ? rule.apply_mode : 'fill_empty'
  return {
    column_key: String(rule.column_key || '').trim(),
    column_label: String(rule.column_label || rule.column_key || '').trim(),
    default_value: String(rule.default_value ?? ''),
    apply_mode: mode,
    enabled: rule.enabled !== false,
    source: String(rule.source || 'Fixed Default'),
  }
}

async function listDefaultProfiles() {
  const profiles = await query(`SELECT * FROM default_profiles ORDER BY is_builtin DESC, name ASC`)
  const fields = await query(`SELECT * FROM default_profile_fields ORDER BY id ASC`)
  const byProfile = new Map()
  for (const f of fields.rows) {
    const arr = byProfile.get(f.profile_id) || []
    arr.push(f)
    byProfile.set(f.profile_id, arr)
  }
  return profiles.rows.map((p) => ({ ...p, fields: byProfile.get(p.id) || [] }))
}

async function createDefaultProfile({ name, marketplace, description, fields, reqUser }) {
  const userId = parseUserIdInt(reqUser)
  const r = await query(
    `INSERT INTO default_profiles (name, marketplace, description, is_builtin, created_by)
     VALUES ($1, $2, $3, false, $4)
     RETURNING *`,
    [String(name || '').trim(), String(marketplace || '').trim(), String(description || '').trim(), userId]
  )
  const profile = r.rows[0]
  await replaceProfileFields(profile.id, fields || [])
  return (await getDefaultProfile(profile.id))
}

async function getDefaultProfile(id) {
  const p = await query(`SELECT * FROM default_profiles WHERE id = $1`, [id])
  if (!p.rows[0]) return null
  const f = await query(`SELECT * FROM default_profile_fields WHERE profile_id = $1 ORDER BY id ASC`, [id])
  return { ...p.rows[0], fields: f.rows }
}

async function replaceProfileFields(profileId, fields) {
  await query(`DELETE FROM default_profile_fields WHERE profile_id = $1`, [profileId])
  for (const raw of fields || []) {
    const f = normalizeRule(raw)
    if (!f.column_key) continue
    await query(
      `INSERT INTO default_profile_fields (profile_id, column_key, column_label, default_value, apply_mode, enabled, source)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [profileId, f.column_key, f.column_label, f.default_value, f.apply_mode, f.enabled, f.source]
    )
  }
}

async function updateDefaultProfile(id, patch) {
  const existing = await getDefaultProfile(id)
  if (!existing) return null
  const r = await query(
    `UPDATE default_profiles
     SET name = $2, marketplace = $3, description = $4, updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      id,
      String(patch.name ?? existing.name).trim(),
      String(patch.marketplace ?? existing.marketplace ?? '').trim(),
      String(patch.description ?? existing.description ?? '').trim(),
    ]
  )
  if (Array.isArray(patch.fields)) await replaceProfileFields(id, patch.fields)
  return getDefaultProfile(r.rows[0].id)
}

function applyRulesToValues(values, sourceMap, rules, { confirmOverwrite = false } = {}) {
  const next = { ...values }
  const source = { ...sourceMap }
  const applied = []
  const skipped = []
  for (const rawRule of rules || []) {
    const rule = normalizeRule(rawRule)
    if (!rule.enabled || !rule.column_key || rule.apply_mode === 'do_not_apply') {
      skipped.push({ column_key: rule.column_key, reason: 'disabled' })
      continue
    }
    const current = String(next[rule.column_key] ?? '')
    const hasValue = current.trim() !== ''
    const wantsOverwrite = rule.apply_mode === 'overwrite_all' || (rule.apply_mode === 'ask_before_overwrite' && confirmOverwrite)
    if (hasValue && !wantsOverwrite) {
      skipped.push({ column_key: rule.column_key, reason: 'already_has_value' })
      continue
    }
    next[rule.column_key] = rule.default_value
    source[rule.column_key] = 'Fixed Default'
    applied.push({ column_key: rule.column_key, value: rule.default_value, previous: current })
  }
  return { values: next, sourceMap: source, applied, skipped }
}

module.exports = {
  listDefaultProfiles,
  createDefaultProfile,
  updateDefaultProfile,
  getDefaultProfile,
  applyRulesToValues,
  normalizeRule,
}
