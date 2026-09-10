const { query } = require('../../db')

/**
 * Append-only ISO QMS activity log.
 */
async function logActivity({
  userId = null,
  action,
  entityType,
  entityId = null,
  versionId = null,
  previousValue = null,
  newValue = null,
  ip = null,
  userAgent = null,
  message = null,
} = {}) {
  if (!action || !entityType) {
    const err = new Error('action and entityType are required')
    err.status = 400
    throw err
  }

  const result = await query(
    `INSERT INTO iso_activity_log (
       user_id, action, entity_type, entity_id, version_id,
       previous_value, new_value, ip, user_agent, message
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9, $10)
     RETURNING *`,
    [
      userId != null ? Number(userId) : null,
      String(action).slice(0, 128),
      String(entityType).slice(0, 128),
      entityId != null ? Number(entityId) : null,
      versionId != null ? Number(versionId) : null,
      previousValue != null ? JSON.stringify(previousValue) : null,
      newValue != null ? JSON.stringify(newValue) : null,
      ip != null ? String(ip).slice(0, 64) : null,
      userAgent != null ? String(userAgent).slice(0, 2000) : null,
      message != null ? String(message).slice(0, 4000) : null,
    ]
  )
  return mapRow(result.rows[0])
}

async function listActivity({
  entityType = null,
  entityId = null,
  limit = 100,
  offset = 0,
} = {}) {
  const params = []
  const where = []
  if (entityType) {
    params.push(String(entityType))
    where.push(`entity_type = $${params.length}`)
  }
  if (entityId != null) {
    params.push(Number(entityId))
    where.push(`entity_id = $${params.length}`)
  }
  params.push(Math.min(Math.max(Number(limit) || 100, 1), 500))
  params.push(Math.max(Number(offset) || 0, 0))
  const sql = `
    SELECT * FROM iso_activity_log
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY created_at DESC
    LIMIT $${params.length - 1} OFFSET $${params.length}
  `
  const result = await query(sql, params)
  return result.rows.map(mapRow)
}

function mapRow(row) {
  if (!row) return null
  return {
    id: Number(row.id),
    userId: row.user_id != null ? Number(row.user_id) : null,
    action: row.action,
    entityType: row.entity_type,
    entityId: row.entity_id != null ? Number(row.entity_id) : null,
    versionId: row.version_id != null ? Number(row.version_id) : null,
    previousValue: row.previous_value,
    newValue: row.new_value,
    ip: row.ip,
    userAgent: row.user_agent,
    message: row.message,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  }
}

module.exports = {
  logActivity,
  listActivity,
  mapRow,
}
