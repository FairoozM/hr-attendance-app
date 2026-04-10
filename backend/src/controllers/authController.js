const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const usersService = require('../services/usersService')
const { JWT_SECRET } = require('../middleware/auth')

function buildUserPayload(row) {
  const displayName = row.employee_full_name || row.username || 'User'
  return {
    id: String(row.id),
    username: row.username,
    role: row.role,
    employeeId: row.employee_id != null ? String(row.employee_id) : null,
    displayName: String(displayName),
    permissions: row.permissions || {},
  }
}

async function login(req, res) {
  try {
    // Accept 'email' or legacy 'username' field from request body
    const rawIdentifier = (req.body.email ?? req.body.username ?? '')
    const username = String(rawIdentifier).trim()
    const password = req.body.password != null ? String(req.body.password) : ''
    console.log('[auth] POST /api/auth/login hit', { email: username || '(empty)' })
    if (!username || !password) {
      return res.status(400).json({ error: 'Email and password are required' })
    }

    const row = await usersService.findByEmail(username)
    if (!row) {
      console.log('[auth] login: no user found for email', username)
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    const ok = await bcrypt.compare(password, row.password_hash)
    if (!ok) {
      console.log('[auth] login: password mismatch for user id', row.id, 'role', row.role)
      return res.status(401).json({ error: 'Invalid email or password' })
    }

    console.log('[auth] login: success user id', row.id, 'role', row.role)

    const token = jwt.sign(
      {
        sub: String(row.id),
        role: row.role,
        employeeId: row.employee_id != null ? String(row.employee_id) : null,
        permissions: row.permissions || {},
      },
      JWT_SECRET,
      { expiresIn: '7d' }
    )

    const user = buildUserPayload(row)
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.status(200).json({ token, user })
  } catch (err) {
    console.error('[auth] login: server error', err)
    return res.status(500).json({ error: 'Login failed' })
  }
}

async function me(req, res) {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    const row = await usersService.findByIdJoined(req.user.userId)
    if (!row) {
      return res.status(401).json({ error: 'Unauthorized' })
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    return res.status(200).json({ user: buildUserPayload(row) })
  } catch (err) {
    console.error('[auth] GET /api/auth/me error:', err)
    return res.status(500).json({ error: 'Failed to load session' })
  }
}

async function changePassword(req, res) {
  try {
    const userId = req.user?.userId
    if (!userId) return res.status(401).json({ error: 'Unauthorized' })

    const currentPassword = req.body.currentPassword != null ? String(req.body.currentPassword) : ''
    const newPassword = req.body.newPassword != null ? String(req.body.newPassword) : ''
    const confirmPassword = req.body.confirmPassword != null ? String(req.body.confirmPassword) : ''

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({ error: 'Current password, new password, and confirm password are all required' })
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' })
    }
    if (newPassword !== confirmPassword) {
      return res.status(400).json({ error: 'New password and confirm password do not match' })
    }
    if (currentPassword === newPassword) {
      return res.status(400).json({ error: 'New password must be different from your current password' })
    }

    const row = await usersService.findById(userId)
    if (!row) return res.status(401).json({ error: 'User not found' })

    const ok = await bcrypt.compare(currentPassword, row.password_hash)
    if (!ok) {
      return res.status(401).json({ error: 'Current password is incorrect' })
    }

    await usersService.updatePassword(userId, newPassword)
    console.log('[auth] Password changed for user id', userId, 'role', row.role)
    return res.json({ success: true, message: 'Password updated successfully' })
  } catch (err) {
    console.error('[auth] changePassword error:', err)
    return res.status(500).json({ error: err.message || 'Failed to change password' })
  }
}

module.exports = { login, me, changePassword }
