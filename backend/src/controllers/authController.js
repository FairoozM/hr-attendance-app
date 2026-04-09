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
    if (!username || !password) {
      return res.status(400).json({ error: 'username and password are required' })
    }

    const row = await usersService.findByUsername(username)
    if (!row) {
      return res.status(401).json({ error: 'Invalid username or password' })
    }

    const ok = await bcrypt.compare(password, row.password_hash)
    if (!ok) {
      return res.status(401).json({ error: 'Invalid username or password' })
    }

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
    res.json({ token, user })
  } catch (err) {
    console.error('Login error:', err)
    res.status(500).json({ error: 'Login failed' })
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
    res.json({ user: buildUserPayload(row) })
  } catch (err) {
    console.error('Auth me error:', err)
    res.status(500).json({ error: 'Failed to load session' })
  }
}

module.exports = { login, me }
