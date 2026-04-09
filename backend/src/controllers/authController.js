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
  }
}

async function login(req, res) {
  try {
    const username = req.body.username != null ? String(req.body.username).trim() : ''
    const password = req.body.password != null ? String(req.body.password) : ''
    console.log('[auth] POST /api/auth/login hit', { username: username || '(empty)' })
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' })
    }

    const row = await usersService.findByUsername(username)
    if (!row) {
      console.log('[auth] login: no user found for username', username)
      return res.status(401).json({ error: 'Invalid username or password' })
    }

    const ok = await bcrypt.compare(password, row.password_hash)
    if (!ok) {
      console.log('[auth] login: password mismatch for user id', row.id, 'role', row.role)
      return res.status(401).json({ error: 'Invalid username or password' })
    }

    console.log('[auth] login: success user id', row.id, 'role', row.role)

    const token = jwt.sign(
      {
        sub: String(row.id),
        role: row.role,
        employeeId: row.employee_id != null ? String(row.employee_id) : null,
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

module.exports = { login, me }
