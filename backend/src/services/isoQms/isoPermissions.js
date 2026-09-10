const {
  AUDITOR_VISIBLE_STATUSES,
  CURRENT_LIKE_STATUSES,
} = require('./isoQmsConstants')

function isAuditorRole(user) {
  return String(user?.role || '') === 'auditor'
}

function isIsoAdmin(user) {
  if (!user) return false
  if (user.role === 'admin') return true
  const mod = user.permissions?.iso_qms || {}
  return Boolean(mod.settings || mod.manage)
}

function canEditIso(user) {
  if (!user) return false
  if (isAuditorRole(user)) return false
  if (user.role === 'admin' || user.role === 'warehouse') return true
  const mod = user.permissions?.iso_qms || {}
  return Boolean(mod.edit || mod.add || mod.manage || mod.settings)
}

function canApproveIso(user) {
  if (!user) return false
  if (isAuditorRole(user)) return false
  if (user.role === 'admin' || user.role === 'warehouse') return true
  const mod = user.permissions?.iso_qms || {}
  return Boolean(mod.approve || mod.manage || mod.settings)
}

function canDownloadAsAuditor(doc) {
  if (!doc) return false
  return Boolean(doc.auditorDownloadAllowed ?? doc.auditor_download_allowed)
}

/**
 * Assignment is active when not revoked and within optional start/expiry window.
 */
function auditorAccessActive(assignment, now = new Date()) {
  if (!assignment) return false
  if (assignment.revoked_at || assignment.revokedAt) return false
  const start = assignment.access_start_date || assignment.accessStartDate
  const expiry = assignment.access_expiry_date || assignment.accessExpiryDate
  const today = now.toISOString().slice(0, 10)
  if (start) {
    const s = String(start).slice(0, 10)
    if (s > today) return false
  }
  if (expiry) {
    const e = String(expiry).slice(0, 10)
    if (e < today) return false
  }
  return true
}

/**
 * SQL fragment + params for auditor-visible documents.
 * Caller appends params starting after `paramOffset`.
 */
function filterForAuditor(alias = 'd', paramOffset = 0) {
  const statuses = AUDITOR_VISIBLE_STATUSES
  const start = paramOffset + 1
  return {
    sql: `${alias}.publish_to_auditor_room = TRUE
      AND ${alias}.status = ANY($${start}::text[])
      AND ${alias}.soft_deleted_at IS NULL
      AND ${alias}.status NOT IN ('Obsolete', 'Archived')`,
    params: [statuses],
  }
}

function isCurrentLikeStatus(status) {
  return CURRENT_LIKE_STATUSES.includes(String(status || ''))
}

module.exports = {
  isAuditorRole,
  isIsoAdmin,
  canEditIso,
  canApproveIso,
  canDownloadAsAuditor,
  auditorAccessActive,
  filterForAuditor,
  isCurrentLikeStatus,
}
