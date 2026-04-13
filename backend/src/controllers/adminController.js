const usersService = require('../services/usersService')
const assignmentService = require('../services/attendanceAssignmentService')

const VALID_MODULES = ['attendance', 'leave', 'employees', 'roster', 'influencers']
const VALID_ACTIONS = {
  attendance: ['view', 'manage'],
  leave: ['view', 'approve'],
  employees: ['view', 'edit'],
  roster: ['view'],
  influencers: ['view', 'manage', 'approve', 'payments', 'agreements'],
}

/**
 * Admin-only: list ALL active employees plus any non-employee portal users
 * (warehouse etc.) with their permissions.
 * Employees without a portal account are included but show has_account = false.
 */
async function listUsersWithPermissions(req, res) {
  try {
    const { query } = require('../db')
    const result = await query(
      `-- Active employees (with or without a portal account)
       SELECT
         u.id,
         u.username,
         COALESCE(u.role, 'employee') AS role,
         e.id AS employee_id,
         COALESCE(u.permissions, '{}'::jsonb) AS permissions,
         u.created_at,
         e.full_name AS employee_full_name,
         e.department,
         e.designation,
         e.employee_code,
         (u.id IS NOT NULL) AS has_account
       FROM employees e
       LEFT JOIN users u ON u.employee_id = e.id AND u.role != 'admin'
       WHERE e.is_active = true

       UNION ALL

       -- Non-employee portal users (warehouse, etc.) not linked to an employee record
       SELECT
         u.id,
         u.username,
         u.role,
         u.employee_id,
         COALESCE(u.permissions, '{}'::jsonb) AS permissions,
         u.created_at,
         u.username AS employee_full_name,
         NULL AS department,
         NULL AS designation,
         NULL AS employee_code,
         true AS has_account
       FROM users u
       WHERE u.role NOT IN ('admin', 'employee')

       ORDER BY employee_full_name`
    )
    res.json(result.rows)
  } catch (err) {
    console.error('[admin] listUsersWithPermissions error:', err)
    res.status(500).json({ error: 'Failed to list users' })
  }
}

/**
 * Admin-only: update permissions for a specific user.
 */
async function updateUserPermissions(req, res) {
  try {
    const userId = parseInt(req.params.userId, 10)
    if (Number.isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user id' })
    }

    const user = await usersService.findById(userId)
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Cannot modify admin permissions' })
    }

    const incoming = req.body.permissions
    if (typeof incoming !== 'object' || incoming === null) {
      return res.status(400).json({ error: 'permissions must be an object' })
    }

    // Sanitize: only allow known modules and actions
    const sanitized = {}
    for (const mod of VALID_MODULES) {
      if (incoming[mod] && typeof incoming[mod] === 'object') {
        sanitized[mod] = {}
        for (const action of VALID_ACTIONS[mod]) {
          sanitized[mod][action] = Boolean(incoming[mod][action])
        }
      }
    }
    // Top-level scope flag
    sanitized.department_only = Boolean(incoming.department_only)

    await usersService.updatePermissions(userId, sanitized)
    console.log('[admin] Updated permissions for user', userId, '->', JSON.stringify(sanitized))
    return res.json({ success: true, permissions: sanitized })
  } catch (err) {
    console.error('[admin] updateUserPermissions error:', err)
    return res.status(500).json({ error: err.message || 'Failed to update permissions' })
  }
}

/**
 * Admin-only: reset a specific user's password without verifying the old one.
 * Admin cannot use this endpoint to change their own password (must use /auth/change-password).
 */
async function resetUserPassword(req, res) {
  try {
    const userId = parseInt(req.params.userId, 10)
    if (Number.isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user id' })
    }

    const newPassword = req.body.newPassword != null ? String(req.body.newPassword) : ''
    const confirmPassword = req.body.confirmPassword != null ? String(req.body.confirmPassword) : ''

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' })
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }
    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'Passwords do not match' })
    }

    const user = await usersService.findById(userId)
    if (!user) {
      return res.status(404).json({ error: 'User not found' })
    }

    // Admin cannot reset their own password through this endpoint
    if (String(userId) === String(req.user.userId)) {
      return res.status(400).json({ error: 'Use the Change Password form to update your own password' })
    }

    await usersService.updatePassword(userId, newPassword)
    console.log('[admin] Password reset for user id', userId, '(username:', user.username, ') by admin', req.user.userId)
    return res.json({ success: true, message: `Password reset for ${user.username}` })
  } catch (err) {
    console.error('[admin] resetUserPassword error:', err)
    return res.status(500).json({ error: err.message || 'Failed to reset password' })
  }
}

/**
 * Admin-only: list all users (username, role, employee_id) — no password hashes.
 */
async function listUsers(req, res) {
  try {
    const { query } = require('../db')
    const result = await query(
      `SELECT u.id, u.username, u.role, u.employee_id, u.created_at,
              e.full_name AS employee_full_name
       FROM users u
       LEFT JOIN employees e ON e.id = u.employee_id
       ORDER BY u.id`
    )
    res.json(result.rows)
  } catch (err) {
    console.error('[admin] listUsers error:', err)
    res.status(500).json({ error: 'Failed to list users' })
  }
}

/**
 * Admin: GET /api/admin/users/:userId/attendance-assignments
 * Returns the list of employees assigned under this user's attendance scope.
 */
async function getAttendanceAssignments(req, res) {
  try {
    const userId = parseInt(req.params.userId, 10)
    if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' })

    const user = await usersService.findById(userId)
    if (!user) return res.status(404).json({ error: 'User not found' })

    const assignments = await assignmentService.getAssignmentsForUser(userId)
    return res.json(assignments)
  } catch (err) {
    console.error('[admin] getAttendanceAssignments error:', err)
    return res.status(500).json({ error: err.message || 'Failed to fetch assignments' })
  }
}

/**
 * Admin: PUT /api/admin/users/:userId/attendance-assignments
 * Body: { employeeIds: [1, 2, 3] }
 * Replaces all attendance assignments for this user.
 */
async function setAttendanceAssignments(req, res) {
  try {
    const userId = parseInt(req.params.userId, 10)
    if (Number.isNaN(userId)) return res.status(400).json({ error: 'Invalid user id' })

    const user = await usersService.findById(userId)
    if (!user) return res.status(404).json({ error: 'User not found' })
    if (user.role === 'admin') {
      return res.status(400).json({ error: 'Admins have full access; assignments do not apply' })
    }

    const rawIds = req.body.employeeIds
    if (!Array.isArray(rawIds)) {
      return res.status(400).json({ error: 'employeeIds must be an array' })
    }

    const employeeIds = rawIds.map((id) => parseInt(id, 10)).filter((id) => !Number.isNaN(id))

    await assignmentService.setAssignments(userId, employeeIds, parseInt(req.user.userId, 10))
    console.log('[admin] Set attendance assignments for user', userId, '→', employeeIds)

    const updated = await assignmentService.getAssignmentsForUser(userId)
    return res.json({ success: true, assignments: updated })
  } catch (err) {
    console.error('[admin] setAttendanceAssignments error:', err)
    return res.status(500).json({ error: err.message || 'Failed to save assignments' })
  }
}

module.exports = {
  resetUserPassword,
  listUsers,
  listUsersWithPermissions,
  updateUserPermissions,
  getAttendanceAssignments,
  setAttendanceAssignments,
}
