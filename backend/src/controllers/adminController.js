const usersService = require('../services/usersService')

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

module.exports = { resetUserPassword, listUsers }
