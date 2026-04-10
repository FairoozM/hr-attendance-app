const bcrypt = require('bcrypt')
const { query } = require('../db')

const BCRYPT_ROUNDS = 10

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isValidEmail(v) {
  return EMAIL_RE.test(String(v || '').trim())
}

async function findByUsername(email) {
  const u = String(email || '').trim().toLowerCase()
  if (!u) return null
  const result = await query(
    `SELECT u.id, u.username, u.password_hash, u.role, u.employee_id,
            u.permissions,
            e.full_name AS employee_full_name
     FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE LOWER(u.username) = LOWER($1)`,
    [u]
  )
  return result.rows[0] || null
}

/** Alias for semantic clarity when called from login flow */
const findByEmail = findByUsername

async function findById(id) {
  const result = await query(
    `SELECT id, username, password_hash, role, employee_id, permissions FROM users WHERE id = $1`,
    [id]
  )
  return result.rows[0] || null
}

async function findByIdJoined(id) {
  const result = await query(
    `SELECT u.id, u.username, u.password_hash, u.role, u.employee_id,
            u.permissions,
            e.full_name AS employee_full_name
     FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE u.id = $1`,
    [id]
  )
  return result.rows[0] || null
}

async function findByEmployeeId(employeeId) {
  const result = await query(
    `SELECT id, username, password_hash, role, employee_id, permissions FROM users WHERE employee_id = $1`,
    [employeeId]
  )
  return result.rows[0] || null
}

async function updatePermissions(userId, permissions) {
  const safe = typeof permissions === 'object' && permissions !== null ? permissions : {}
  await query(
    `UPDATE users SET permissions = $2, updated_at = NOW() WHERE id = $1`,
    [userId, JSON.stringify(safe)]
  )
}

async function createUser({ username, password, role, employee_id }) {
  const uname = String(username || '').trim().toLowerCase()
  if (!uname) throw new Error('email is required')
  if (!isValidEmail(uname)) throw new Error('Login must be a valid email address')
  if (!password || String(password).length < 8) {
    throw new Error('password must be at least 8 characters')
  }
  const dup = await query(`SELECT id FROM users WHERE LOWER(username) = LOWER($1)`, [uname])
  if (dup.rows.length > 0) throw new Error('This email is already registered')
  const hash = await bcrypt.hash(String(password), BCRYPT_ROUNDS)
  const result = await query(
    `INSERT INTO users (username, password_hash, role, employee_id)
     VALUES ($1, $2, $3, $4)
     RETURNING id, username, role, employee_id`,
    [uname, hash, role, employee_id ?? null]
  )
  return result.rows[0]
}

async function updatePassword(userId, plainPassword) {
  if (!plainPassword || String(plainPassword).length < 8) {
    throw new Error('password must be at least 8 characters')
  }
  const hash = await bcrypt.hash(String(plainPassword), BCRYPT_ROUNDS)
  await query(`UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`, [userId, hash])
}

async function updateUsername(userId, newUsername) {
  const uname = String(newUsername || '').trim().toLowerCase()
  if (!uname) throw new Error('email is required')
  if (!isValidEmail(uname)) throw new Error('Login must be a valid email address')
  const dup = await query(`SELECT id FROM users WHERE LOWER(username) = LOWER($1) AND id != $2`, [
    uname,
    userId,
  ])
  if (dup.rows.length > 0) throw new Error('This email is already registered')
  await query(`UPDATE users SET username = $2, updated_at = NOW() WHERE id = $1`, [userId, uname])
}

/** Alias */
const updateEmail = updateUsername

/**
 * Create or update portal user for an employee (admin-only callers).
 * Accepts portal_email (preferred) or legacy portal_username field.
 */
async function syncEmployeePortal(employeeId, body, isCreate) {
  const rawEmail = (body.portal_email ?? body.portal_username ?? '')
  const pu = String(rawEmail).trim().toLowerCase()
  const pp = body.portal_password != null ? String(body.portal_password) : ''

  if (!pu && !pp) return null

  const existing = await findByEmployeeId(employeeId)

  if (isCreate) {
    if (!pu || !pp) {
      throw new Error('portal_email and portal_password are both required when enabling portal access')
    }
    if (!isValidEmail(pu)) {
      throw new Error('Portal login must be a valid email address')
    }
    if (existing) {
      throw new Error('portal user already exists for this employee')
    }
    return createUser({
      username: pu,
      password: pp,
      role: 'employee',
      employee_id: employeeId,
    })
  }

  if (existing) {
    if (pp) await updatePassword(existing.id, pp)
    if (pu && pu !== String(existing.username).toLowerCase()) {
      if (!isValidEmail(pu)) throw new Error('Portal login must be a valid email address')
      await updateUsername(existing.id, pu)
    }
    return existing
  }

  if (pu && pp) {
    if (!isValidEmail(pu)) throw new Error('Portal login must be a valid email address')
    return createUser({
      username: pu,
      password: pp,
      role: 'employee',
      employee_id: employeeId,
    })
  }

  if (pp && !existing) {
    throw new Error('portal_email is required when setting a password for an employee without portal access')
  }

  return null
}

async function deleteByEmployeeId(employeeId) {
  await query(`DELETE FROM users WHERE employee_id = $1`, [employeeId])
}

module.exports = {
  findByUsername,
  findByEmail,
  findById,
  findByIdJoined,
  findByEmployeeId,
  createUser,
  updatePassword,
  updateUsername,
  updateEmail,
  updatePermissions,
  syncEmployeePortal,
  deleteByEmployeeId,
  isValidEmail,
}
