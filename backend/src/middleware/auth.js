const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'hr-attendance-dev-secret-change-me'

/**
 * Verify the Bearer JWT and load FRESH permissions from the DB on every
 * request.  Reading permissions from the DB (single PK lookup, <1 ms) means
 * permission changes made by the admin take effect immediately — no re-login
 * required by the employee.
 */
async function attachAuth(req, res, next) {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) {
    req.user = null
    return next()
  }
  try {
    const payload = jwt.verify(h.slice(7), JWT_SECRET)

    // Always fetch fresh permissions from DB so changes apply immediately
    const { query } = require('../db')
    const row = await query(
      'SELECT permissions FROM users WHERE id = $1',
      [String(payload.sub)]
    )
    const permissions = row.rows[0]?.permissions || {}

    req.user = {
      userId: String(payload.sub),
      role: payload.role,
      employeeId: payload.employeeId != null ? String(payload.employeeId) : null,
      permissions,
    }
    next()
  } catch {
    req.user = null
    next()
  }
}

function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  next()
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' })
  }
  next()
}

function requireAdminOrWarehouse(req, res, next) {
  if (!req.user || !['admin', 'warehouse'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  next()
}

function requireEmployee(req, res, next) {
  if (!req.user || req.user.role !== 'employee' || !req.user.employeeId) {
    return res.status(403).json({ error: 'Forbidden' })
  }
  next()
}

/**
 * Permission-based access control middleware.
 * - admin: always passes
 * - warehouse: always passes (backward compatibility)
 * - employee: must have the specific permission (manage implies view)
 */
function requirePermission(module, action) {
  return function permissionCheck(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
    if (req.user.role === 'admin') return next()
    if (req.user.role === 'warehouse') return next()

    const p = req.user.permissions || {}
    const mod = p[module] || {}

    // manage permission implicitly grants view
    if (action === 'view' && mod.manage) return next()
    // approve permission implicitly grants view for leave
    if (action === 'view' && module === 'leave' && mod.approve) return next()

    if (mod[action]) return next()

    return res.status(403).json({
      error: `Access denied: requires ${module} ${action} permission`,
    })
  }
}

module.exports = {
  JWT_SECRET,
  attachAuth,
  requireAuth,
  requireAdmin,
  requireAdminOrWarehouse,
  requireEmployee,
  requirePermission,
}
