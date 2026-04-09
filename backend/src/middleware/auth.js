const jwt = require('jsonwebtoken')

const JWT_SECRET = process.env.JWT_SECRET || 'hr-attendance-dev-secret-change-me'

function attachAuth(req, res, next) {
  const h = req.headers.authorization
  if (!h || !h.startsWith('Bearer ')) {
    req.user = null
    return next()
  }
  try {
    const payload = jwt.verify(h.slice(7), JWT_SECRET)
    req.user = {
      userId: String(payload.sub),
      role: payload.role,
      employeeId: payload.employeeId != null ? String(payload.employeeId) : null,
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

module.exports = {
  JWT_SECRET,
  attachAuth,
  requireAuth,
  requireAdmin,
  requireAdminOrWarehouse,
  requireEmployee,
}
