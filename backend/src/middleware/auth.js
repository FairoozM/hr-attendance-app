const jwt = require('jsonwebtoken')
const {
  canAccessLinearSettings,
  canManageCycles,
  canViewLinear,
} = require('../utils/linearPermissions')
const { getJwtSecret } = require('../config/jwtSecret')

/**
 * Verify the Bearer JWT and load FRESH permissions from the DB on every
 * request.  Reading permissions from the DB (single PK lookup, <1 ms) means
 * permission changes made by the admin take effect immediately — no re-login
 * required by the employee.
 */
async function attachAuth(req, res, next) {
  let token = null
  const h = req.headers.authorization
  if (h && h.startsWith('Bearer ')) {
    token = h.slice(7).trim()
  }
  if (!token) {
    const { readAccessTokenFromCookie } = require('../utils/authCookie')
    token = readAccessTokenFromCookie(req)
  }
  if (!token) {
    req.user = null
    return next()
  }

  // Resolved outside the catch below: a missing or published signing key is a server
  // misconfiguration, not an unauthenticated request, and must not be quietly turned into
  // one. Startup refuses to boot without a usable key, so this is a backstop.
  let secret
  try {
    secret = getJwtSecret()
  } catch (err) {
    return next(err)
  }

  try {
    const payload = jwt.verify(token, secret)

    // Always fetch fresh permissions from DB so changes apply immediately
    const { query } = require('../db')
    const row = await query(
      'SELECT permissions, linear_workspace_role FROM users WHERE id = $1',
      [String(payload.sub)]
    )
    const permissions = row.rows[0]?.permissions || {}
    const linearWorkspaceRole = row.rows[0]?.linear_workspace_role || null

    req.user = {
      userId: String(payload.sub),
      role: payload.role,
      employeeId: payload.employeeId != null ? String(payload.employeeId) : null,
      permissions,
      linearWorkspaceRole,
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
/** Persist influencer performance rows (not the influencer snapshot). */
function requireInfluencersPerformanceWrite(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  if (req.user.role === 'admin' || req.user.role === 'warehouse') return next()
  const mod = req.user.permissions?.influencers || {}
  if (mod.manage || mod.performance) return next()
  return res.status(403).json({ error: 'Access denied: cannot edit influencer performance records' })
}

/** Any write-capable influencers permission may replace the shared snapshot. */
function requireInfluencersWrite(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' })
  if (req.user.role === 'admin' || req.user.role === 'warehouse') return next()
  const mod = req.user.permissions?.influencers || {}
  if (mod.manage || mod.approve || mod.payments || mod.agreements) return next()
  return res.status(403).json({ error: 'Access denied: cannot modify influencers' })
}

function requirePermission(module, action) {
  return function permissionCheck(req, res, next) {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' })

    // Linear workspace access is governed by the effective workspace role,
    // even for app admins when an explicit workspace role is set.
    if (module === 'planner') {
      if (action === 'view' && canViewLinear(req.user)) return next()
      if (action === 'manage' && canManageCycles(req.user)) return next()
      if (action === 'settings' && canAccessLinearSettings(req.user)) return next()
      return res.status(403).json({
        error: `Access denied: requires ${module} ${action} permission`,
      })
    }

    if (req.user.role === 'admin') return next()
    if (req.user.role === 'warehouse') return next()

    const p = req.user.permissions || {}
    const mod = p[module] || {}

    // manage permission implicitly grants view
    if (action === 'view' && mod.manage) return next()
    // approve permission implicitly grants view for leave
    if (action === 'view' && module === 'leave' && mod.approve) return next()
    // influencers: elevated roles + performance tracking imply list/read API (matches frontend)
    if (
      action === 'view' &&
      module === 'influencers' &&
      (mod.manage || mod.approve || mod.payments || mod.agreements || mod.performance)
    ) {
      return next()
    }
    // influencers: performance page — performance-only flag, or view/manage (list access)
    if (action === 'performance' && module === 'influencers') {
      if (mod.manage || mod.performance || mod.view) return next()
      return res.status(403).json({
        error: 'Access denied: requires influencers performance permission',
      })
    }
    // sim cards: write permissions imply view
    if (
      action === 'view' &&
      module === 'sim_cards' &&
      (mod.add || mod.edit || mod.delete)
    ) {
      return next()
    }
    // document expiry: write permissions imply view
    if (
      action === 'view' &&
      module === 'document_expiry' &&
      (mod.add || mod.edit || mod.delete)
    ) {
      return next()
    }
    // company_payments: write permissions imply view
    if (
      action === 'view' &&
      module === 'company_payments' &&
      (mod.add || mod.edit || mod.delete)
    ) {
      return next()
    }

    if (mod[action]) return next()

    return res.status(403).json({
      error: `Access denied: requires ${module} ${action} permission`,
    })
  }
}

module.exports = {
  attachAuth,
  requireAuth,
  requireAdmin,
  requireAdminOrWarehouse,
  requireEmployee,
  requirePermission,
  requireInfluencersWrite,
  requireInfluencersPerformanceWrite,
}
