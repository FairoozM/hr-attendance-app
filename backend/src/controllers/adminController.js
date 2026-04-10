const usersService = require('../services/usersService')

const VALID_MODULES = ['attendance', 'leave', 'employees', 'roster']
const VALID_ACTIONS = {
  attendance: ['view', 'manage'],
  leave: ['view', 'approve'],
  employees: ['view', 'edit'],
  roster: ['view'],
}

/**
 * Admin-only: list all non-admin users with their permissions.
 */
async function listUsersWithPermissions(req, res) {
  try {
    const { query } = require('../db')
    const result = await query(
      `SELECT u.id, u.username, u.role, u.employee_id, u.permissions, u.created_at,
              e.full_name AS employee_full_name, e.department, e.designation
       FROM users u
       LEFT JOIN employees e ON e.id = u.employee_id
       WHERE u.role != 'admin'
       ORDER BY u.role, u.id`
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

module.exports = { resetUserPassword, listUsers, listUsersWithPermissions, updateUserPermissions }
