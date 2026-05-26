const { query } = require('../db')
const { logLinearAudit } = require('./linearAuditService')
const { getUserWorkspaceRole } = require('../utils/linearPermissions')

const ALLOWED_LINEAR_ROLES = ['viewer', 'contributor', 'developer', 'qa', 'manager', 'admin']

function normalizeLinearRole(value) {
  if (value == null || value === '') return null
  const role = String(value).trim().toLowerCase()
  return ALLOWED_LINEAR_ROLES.includes(role) ? role : null
}

function resolveName(row) {
  const fullName = String(row.full_name || '').trim()
  if (fullName) return fullName
  const username = String(row.username || '').trim()
  if (!username) return `User #${row.id}`
  return username.includes('@') ? username.split('@')[0] : username
}

function effectiveRoleForRow(row) {
  return getUserWorkspaceRole({
    role: row.role,
    permissions: row.permissions,
    userId: row.id,
    linearWorkspaceRole: row.linear_workspace_role,
  })
}

function mapUserRow(row) {
  return {
    id: row.id,
    name: resolveName(row),
    email: row.username || '',
    role: row.role,
    designation: row.designation || null,
    linearWorkspaceRole: row.linear_workspace_role || null,
    effectiveLinearRole: effectiveRoleForRow(row),
    isAdmin: row.role === 'admin',
    active: row.employee_id == null ? true : row.active !== false,
  }
}

async function listUserRows() {
  const result = await query(
    `SELECT
       u.id,
       u.username,
       u.role,
       u.employee_id,
       u.permissions,
       u.linear_workspace_role,
       e.full_name,
       e.designation,
       COALESCE(e.is_active, true) AS active
     FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id
     ORDER BY COALESCE(e.is_active, true) DESC, COALESCE(NULLIF(TRIM(e.full_name), ''), u.username) ASC, u.id ASC`
  )
  return result.rows || []
}

async function listLinearWorkspaceUsers() {
  const rows = await listUserRows()
  return rows.map(mapUserRow)
}

async function countOtherEffectiveAdmins(excludeUserId) {
  const rows = await listUserRows()
  return rows.filter((row) => String(row.id) !== String(excludeUserId) && effectiveRoleForRow(row) === 'admin').length
}

async function getUserRowById(userId) {
  const result = await query(
    `SELECT
       u.id,
       u.username,
       u.role,
       u.employee_id,
       u.permissions,
       u.linear_workspace_role,
       e.full_name,
       e.designation,
       COALESCE(e.is_active, true) AS active
     FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  )
  return result.rows[0] || null
}

async function updateLinearWorkspaceUserRole({ userId, linearWorkspaceRole, actorUserId }) {
  const nextRole = normalizeLinearRole(linearWorkspaceRole)
  if (linearWorkspaceRole != null && linearWorkspaceRole !== '' && !nextRole) {
    const error = new Error('Invalid linear workspace role')
    error.status = 400
    error.details = { allowedValues: [...ALLOWED_LINEAR_ROLES, null] }
    throw error
  }

  const beforeRow = await getUserRowById(userId)
  if (!beforeRow) {
    const error = new Error('User not found')
    error.status = 404
    throw error
  }

  const beforeEffectiveRole = effectiveRoleForRow(beforeRow)
  const afterEffectiveRole = getUserWorkspaceRole({
    role: beforeRow.role,
    permissions: beforeRow.permissions,
    userId: beforeRow.id,
    linearWorkspaceRole: nextRole,
  })

  if (beforeEffectiveRole === 'admin' && afterEffectiveRole !== 'admin') {
    const remainingAdmins = await countOtherEffectiveAdmins(beforeRow.id)
    if (remainingAdmins < 1) {
      const error = new Error('At least one Linear workspace admin must remain.')
      error.status = 409
      throw error
    }
  }

  await query(
    `UPDATE users
     SET linear_workspace_role = $2, updated_at = NOW()
     WHERE id = $1`,
    [userId, nextRole]
  )

  const afterRow = await getUserRowById(userId)
  const beforeUser = mapUserRow(beforeRow)
  const afterUser = mapUserRow(afterRow)

  await logLinearAudit({
    entityType: 'user',
    entityId: String(userId),
    action: 'linear_role_updated',
    actorUserId,
    summary: `Changed Linear workspace role for user ${afterUser.name}`,
    beforeSnapshot: {
      linearWorkspaceRole: beforeUser.linearWorkspaceRole,
      effectiveLinearRole: beforeUser.effectiveLinearRole,
      role: beforeUser.role,
      email: beforeUser.email,
    },
    afterSnapshot: {
      linearWorkspaceRole: afterUser.linearWorkspaceRole,
      effectiveLinearRole: afterUser.effectiveLinearRole,
      role: afterUser.role,
      email: afterUser.email,
    },
    metadata: {
      userId: String(userId),
      previousLinearWorkspaceRole: beforeUser.linearWorkspaceRole,
      nextLinearWorkspaceRole: afterUser.linearWorkspaceRole,
      previousEffectiveRole: beforeUser.effectiveLinearRole,
      nextEffectiveRole: afterUser.effectiveLinearRole,
      inheritedDefault: afterUser.linearWorkspaceRole == null,
    },
  })

  return afterUser
}

module.exports = {
  ALLOWED_LINEAR_ROLES,
  listLinearWorkspaceUsers,
  updateLinearWorkspaceUserRole,
}
