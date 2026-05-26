/**
 * linearWorkspaceController.js
 * REST handlers for linear_* shared workspace tables.
 * All user-facing errors return JSON.
 */
const { query } = require('../db')
const svc = require('../services/linearWorkspaceService')
const { listLinearAudit, logLinearAudit } = require('../services/linearAuditService')
const {
  exportLinearWorkspaceData,
  dryRunLinearWorkspaceImport,
  previewLinearWorkspaceImport,
  applyLinearWorkspaceImport,
} = require('../services/linearWorkspaceAdminService')
const {
  listLinearWorkspaceSmokeTests,
  runLinearWorkspaceSmokeTests,
} = require('../services/linearWorkspaceSmokeTestsService')
const {
  getLinearWorkspaceHealth,
  recordLinearWorkspaceError,
} = require('../services/linearWorkspaceHealthService')
const {
  listLinearWorkspaceUsers,
  updateLinearWorkspaceUserRole,
} = require('../services/linearWorkspaceUsersService')
const {
  canCreateDigestOutbox,
  canCreateIntake,
  canDeleteIntake,
  canDeleteLaunchRecords,
  canEditDigestOutbox,
  canExportWorkspace,
  canManageLaunchRecords,
  canManageDeployments,
  canManageDocs,
  canManageReleases,
  canManageWorkspaceUsers,
  canRestoreWorkspace,
  canRunChecklists,
  canViewDigestOutbox,
  canViewAudit,
  canViewLaunchRecords,
  canViewLinear,
  canEditIntake,
  getAllRolePermissionSummaries,
  getPermissionAuditActions,
  getProtectedRouteAuditMap,
  getRoleSimulation,
  getUserWorkspaceRole,
  getRolePermissionSummary,
} = require('../utils/linearPermissions')

function userId(req) {
  return req.user?.userId || req.user?.id || null
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message })
}

function sendForbidden(res) {
  return res.status(403).json({
    error: 'Forbidden',
    message: 'You do not have permission to perform this action.',
  })
}

function trackWorkspaceError(route, error, fallbackStatus = 500) {
  recordLinearWorkspaceError({
    route,
    error,
    status: error?.status || fallbackStatus,
    module: 'linearWorkspaceController',
  })
}

function resolveNotificationPreferenceTargetUserId(req) {
  const requestedTarget = req.method === 'GET'
    ? req.query?.userId
    : req.body?.userId ?? req.query?.userId

  if (requestedTarget != null && canManageWorkspaceUsers(req.user)) {
    return String(requestedTarget)
  }

  return String(userId(req) || '')
}

async function getIntakeItem(id) {
  const result = await query('SELECT * FROM linear_intake_items WHERE id = $1', [id])
  return result.rows[0] || null
}

async function getCurrentWorkspaceAuditUser(req) {
  const currentUserId = userId(req)
  if (!currentUserId) return null

  const result = await query(
    `SELECT
       u.id,
       u.username,
       u.role,
       u.permissions,
       u.linear_workspace_role,
       COALESCE(NULLIF(TRIM(e.full_name), ''), NULLIF(TRIM(u.username), ''), CONCAT('User #', u.id)) AS name
     FROM users u
     LEFT JOIN employees e ON e.id = u.employee_id
     WHERE u.id = $1
     LIMIT 1`,
    [currentUserId]
  )

  const row = result.rows[0]
  if (!row) return null

  return {
    id: String(row.id),
    name: row.name,
    email: row.username,
    effectiveLinearRole: getUserWorkspaceRole({
      role: row.role,
      permissions: row.permissions,
      linearWorkspaceRole: row.linear_workspace_role,
      userId: row.id,
    }),
    permissions: getRolePermissionSummary(
      getUserWorkspaceRole({
        role: row.role,
        permissions: row.permissions,
        linearWorkspaceRole: row.linear_workspace_role,
        userId: row.id,
      })
    ) || {},
    isAdmin: row.role === 'admin',
    linearWorkspaceRole: row.linear_workspace_role || null,
  }
}

// ── Notification Preferences ───────────────────────────────────────────────────

async function getNotificationPreferences(req, res) {
  try {
    if (!canViewLinear(req.user)) return sendForbidden(res)
    const targetUserId = resolveNotificationPreferenceTargetUserId(req)
    if (!targetUserId) return sendError(res, 400, 'Unable to resolve notification preferences user')
    const preferences = await svc.getNotificationPreferences(targetUserId)
    res.json(preferences)
  } catch (e) {
    console.error('[linearWorkspace] getNotificationPreferences:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to load notification preferences')
  }
}

async function updateNotificationPreferences(req, res) {
  try {
    if (!canViewLinear(req.user)) return sendForbidden(res)
    const targetUserId = resolveNotificationPreferenceTargetUserId(req)
    if (!targetUserId) return sendError(res, 400, 'Unable to resolve notification preferences user')
    const preferences = await svc.updateNotificationPreferences(targetUserId, req.body || {})
    res.json(preferences)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/notifications/preferences', e)
    console.error('[linearWorkspace] updateNotificationPreferences:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to update notification preferences')
  }
}

// ── Digest Outbox ──────────────────────────────────────────────────────────────

async function listDigestOutbox(req, res) {
  try {
    if (!canViewDigestOutbox(req.user)) return sendForbidden(res)
    const items = await svc.listDigestOutbox({
      viewerUserId: userId(req),
      includeAll: canManageReleases(req.user),
    })
    res.json(items)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/notifications/digests', e)
    console.error('[linearWorkspace] listDigestOutbox:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to load digest outbox')
  }
}

async function createDigestOutbox(req, res) {
  try {
    if (!canCreateDigestOutbox(req.user)) return sendForbidden(res)
    const draft = await svc.createDigestOutbox(req.body || {}, userId(req))
    res.status(201).json(draft)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/notifications/digests', e)
    console.error('[linearWorkspace] createDigestOutbox:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to create digest draft')
  }
}

async function updateDigestOutbox(req, res) {
  try {
    const existing = await svc.getDigestOutboxById(req.params.id)
    if (!existing) return sendError(res, 404, 'Digest draft not found')
    if (!canEditDigestOutbox(req.user, existing)) return sendForbidden(res)
    const draft = await svc.updateDigestOutbox(req.params.id, req.body || {}, userId(req))
    if (!draft) return sendError(res, 404, 'Digest draft not found')
    res.json(draft)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/notifications/digests/:id', e)
    console.error('[linearWorkspace] updateDigestOutbox:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to update digest draft')
  }
}

async function deleteDigestOutbox(req, res) {
  try {
    const existing = await svc.getDigestOutboxById(req.params.id)
    if (!existing) return sendError(res, 404, 'Digest draft not found')
    if (!canEditDigestOutbox(req.user, existing)) return sendForbidden(res)
    await svc.deleteDigestOutbox(req.params.id, userId(req))
    res.json({ ok: true })
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/notifications/digests/:id', e)
    console.error('[linearWorkspace] deleteDigestOutbox:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to delete digest draft')
  }
}

// ── Global Search ──────────────────────────────────────────────────────────────

async function searchWorkspace(req, res) {
  try {
    if (!canViewLinear(req.user)) return sendForbidden(res)
    const q = String(req.query?.q || '').trim()
    const type = String(req.query?.type || 'all').trim().toLowerCase()
    const includeAudit = canViewAudit(req.user)
    const result = await svc.searchLinearWorkspace({
      q,
      type: type === 'audit' && !includeAudit ? 'all' : type,
      limit: req.query?.limit,
      includeAudit,
    })
    if (type === 'audit' && !includeAudit) {
      return res.json({ results: [] })
    }
    res.json(result)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/search', e)
    console.error('[linearWorkspace] searchWorkspace:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to search workspace')
  }
}

async function getWorkspaceHealth(req, res) {
  try {
    if (!canViewAudit(req.user)) return sendForbidden(res)
    const health = await getLinearWorkspaceHealth()
    res.json(health)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/health', e)
    console.error('[linearWorkspace] getWorkspaceHealth:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to load workspace health')
  }
}

async function listWorkspaceSmokeTests(req, res) {
  try {
    if (!canViewAudit(req.user)) return sendForbidden(res)
    res.json(listLinearWorkspaceSmokeTests())
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/smoke-tests', e)
    console.error('[linearWorkspace] listWorkspaceSmokeTests:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to load smoke tests')
  }
}

async function runWorkspaceSmokeTests(req, res) {
  try {
    if (!canViewAudit(req.user)) return sendForbidden(res)
    const result = await runLinearWorkspaceSmokeTests({
      tests: req.body?.tests,
      mode: req.body?.mode || 'read_only',
      user: req.user,
    })

    const passed = result.results.filter((item) => item.status === 'passed').length
    const warning = result.results.filter((item) => item.status === 'warning' || item.status === 'skipped').length
    const failed = result.results.filter((item) => item.status === 'failed').length

    await logLinearAudit({
      entityType: 'admin',
      entityId: String(userId(req) || ''),
      action: 'smoke_tests_run',
      actorUserId: userId(req),
      summary: `Smoke tests run: ${result.status}`,
      metadata: {
        runId: result.runId,
        status: result.status,
        mode: result.mode,
        counts: { passed, warning, failed },
        tests: result.results.map((item) => item.id),
      },
    }).catch(() => {})

    res.json(result)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/smoke-tests/run', e)
    console.error('[linearWorkspace] runWorkspaceSmokeTests:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to run smoke tests')
  }
}

// ── Docs ──────────────────────────────────────────────────────────────────────

async function listDocs(req, res) {
  try {
    if (!canViewLinear(req.user)) return sendForbidden(res)
    res.json(await svc.listDocs())
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/docs', e)
    console.error('[linearWorkspace] listDocs:', e.message)
    sendError(res, 500, 'Failed to list docs')
  }
}

async function getDoc(req, res) {
  try {
    if (!canViewLinear(req.user)) return sendForbidden(res)
    const doc = await svc.getDoc(req.params.id)
    if (!doc) return sendError(res, 404, 'Doc not found')
    res.json(doc)
  } catch (e) {
    sendError(res, 500, 'Failed to get doc')
  }
}

async function createDoc(req, res) {
  try {
    if (!canManageDocs(req.user)) return sendForbidden(res)
    if (!req.body?.title?.trim()) return sendError(res, 400, 'title is required')
    res.status(201).json(await svc.createDoc(req.body, userId(req)))
  } catch (e) {
    console.error('[linearWorkspace] createDoc:', e.message)
    sendError(res, 500, 'Failed to create doc')
  }
}

async function updateDoc(req, res) {
  try {
    if (!canManageDocs(req.user)) return sendForbidden(res)
    const doc = await svc.updateDoc(req.params.id, req.body, userId(req))
    if (!doc) return sendError(res, 404, 'Doc not found')
    res.json(doc)
  } catch (e) {
    sendError(res, 500, 'Failed to update doc')
  }
}

async function deleteDoc(req, res) {
  try {
    if (!canManageDocs(req.user)) return sendForbidden(res)
    await svc.deleteDoc(req.params.id, userId(req))
    res.json({ ok: true })
  } catch (e) {
    sendError(res, 500, 'Failed to delete doc')
  }
}

// ── Intake ────────────────────────────────────────────────────────────────────

async function listIntake(req, res) {
  try {
    if (!canViewLinear(req.user)) return sendForbidden(res)
    res.json(await svc.listIntake())
  }
  catch (e) {
    trackWorkspaceError('/api/projects/linear/intake', e)
    sendError(res, 500, 'Failed to list intake')
  }
}

async function createIntake(req, res) {
  try {
    if (!canCreateIntake(req.user)) return sendForbidden(res)
    if (!req.body?.title?.trim()) return sendError(res, 400, 'title is required')
    res.status(201).json(await svc.createIntake(req.body, userId(req)))
  } catch (e) {
    console.error('[linearWorkspace] createIntake:', e.message)
    sendError(res, 500, 'Failed to create intake item')
  }
}

async function updateIntake(req, res) {
  try {
    const existing = await getIntakeItem(req.params.id)
    if (!existing) return sendError(res, 404, 'Intake item not found')
    if (!canEditIntake(req.user, existing)) return sendForbidden(res)
    const item = await svc.updateIntake(req.params.id, req.body, userId(req))
    if (!item) return sendError(res, 404, 'Intake item not found')
    res.json(item)
  } catch (e) { sendError(res, 500, 'Failed to update intake item') }
}

async function deleteIntake(req, res) {
  try {
    const existing = await getIntakeItem(req.params.id)
    if (!existing) return sendError(res, 404, 'Intake item not found')
    if (!canDeleteIntake(req.user, existing)) return sendForbidden(res)
    await svc.deleteIntake(req.params.id, userId(req))
    res.json({ ok: true })
  } catch (e) { sendError(res, 500, 'Failed to delete intake item') }
}

// ── Mobile Releases ───────────────────────────────────────────────────────────

async function listMobileReleases(req, res) {
  try {
    if (!canViewLinear(req.user)) return sendForbidden(res)
    res.json(await svc.listMobileReleases())
  }
  catch (e) {
    trackWorkspaceError('/api/projects/linear/mobile-releases', e)
    sendError(res, 500, 'Failed to list mobile releases')
  }
}

async function createMobileRelease(req, res) {
  try {
    if (!canManageReleases(req.user)) return sendForbidden(res)
    if (!req.body?.name?.trim()) return sendError(res, 400, 'name is required')
    res.status(201).json(await svc.createMobileRelease(req.body, userId(req)))
  } catch (e) {
    console.error('[linearWorkspace] createMobileRelease:', e.message)
    sendError(res, 500, 'Failed to create mobile release')
  }
}

async function updateMobileRelease(req, res) {
  try {
    if (!canManageReleases(req.user)) return sendForbidden(res)
    const item = await svc.updateMobileRelease(req.params.id, req.body, userId(req))
    if (!item) return sendError(res, 404, 'Mobile release not found')
    res.json(item)
  } catch (e) { sendError(res, 500, 'Failed to update mobile release') }
}

async function deleteMobileRelease(req, res) {
  try {
    if (!canManageReleases(req.user)) return sendForbidden(res)
    await svc.deleteMobileRelease(req.params.id, userId(req))
    res.json({ ok: true })
  } catch (e) { sendError(res, 500, 'Failed to delete mobile release') }
}

// ── Deployments ───────────────────────────────────────────────────────────────

async function listDeployments(req, res) {
  try {
    if (!canViewLinear(req.user)) return sendForbidden(res)
    res.json(await svc.listDeployments())
  }
  catch (e) {
    trackWorkspaceError('/api/projects/linear/deployments', e)
    sendError(res, 500, 'Failed to list deployments')
  }
}

async function createDeployment(req, res) {
  try {
    if (!canManageDeployments(req.user)) return sendForbidden(res)
    if (!req.body?.name?.trim()) return sendError(res, 400, 'name is required')
    res.status(201).json(await svc.createDeployment(req.body, userId(req)))
  } catch (e) {
    console.error('[linearWorkspace] createDeployment:', e.message)
    sendError(res, 500, 'Failed to create deployment')
  }
}

async function updateDeployment(req, res) {
  try {
    if (!canManageDeployments(req.user)) return sendForbidden(res)
    const item = await svc.updateDeployment(req.params.id, req.body, userId(req))
    if (!item) return sendError(res, 404, 'Deployment not found')
    res.json(item)
  } catch (e) { sendError(res, 500, 'Failed to update deployment') }
}

async function deleteDeployment(req, res) {
  try {
    if (!canManageDeployments(req.user)) return sendForbidden(res)
    await svc.deleteDeployment(req.params.id, userId(req))
    res.json({ ok: true })
  } catch (e) { sendError(res, 500, 'Failed to delete deployment') }
}

// ── Checklist Runs ────────────────────────────────────────────────────────────

async function listChecklistRuns(req, res) {
  try {
    if (!canViewLinear(req.user)) return sendForbidden(res)
    const { context_type, context_id } = req.query
    res.json(await svc.listChecklistRuns({ context_type, context_id }))
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/checklist-runs', e)
    sendError(res, 500, 'Failed to list checklist runs')
  }
}

async function upsertChecklistRun(req, res) {
  try {
    if (!canRunChecklists(req.user)) return sendForbidden(res)
    if (!req.body?.context_type || !req.body?.context_id) {
      return sendError(res, 400, 'context_type and context_id are required')
    }
    res.json(await svc.upsertChecklistRun(req.body, userId(req)))
  } catch (e) {
    console.error('[linearWorkspace] upsertChecklistRun:', e.message)
    sendError(res, 500, 'Failed to save checklist run')
  }
}

async function deleteChecklistRun(req, res) {
  try {
    if (!canManageReleases(req.user)) return sendForbidden(res)
    await svc.deleteChecklistRun(req.params.id, userId(req))
    res.json({ ok: true })
  } catch (e) { sendError(res, 500, 'Failed to delete checklist run') }
}

// ── Launch Records ─────────────────────────────────────────────────────────────

async function listLaunchRecords(req, res) {
  try {
    if (!canViewLaunchRecords(req.user)) return sendForbidden(res)
    res.json(await svc.listLaunchRecords())
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/launch-records', e)
    console.error('[linearWorkspace] listLaunchRecords:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to load launch records')
  }
}

async function createLaunchRecord(req, res) {
  try {
    if (!canManageLaunchRecords(req.user)) return sendForbidden(res)
    if (!req.body?.launch_name?.trim()) return sendError(res, 400, 'launch_name is required')
    const record = await svc.createLaunchRecord(req.body || {}, userId(req))
    res.status(201).json(record)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/launch-records', e)
    console.error('[linearWorkspace] createLaunchRecord:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to create launch record')
  }
}

async function updateLaunchRecord(req, res) {
  try {
    if (!canManageLaunchRecords(req.user)) return sendForbidden(res)
    const existing = await svc.getLaunchRecord(req.params.id)
    if (!existing) return sendError(res, 404, 'Launch record not found')

    const payload = { ...(req.body || {}) }
    if (Object.prototype.hasOwnProperty.call(payload, 'markReviewed')) {
      if (payload.markReviewed) {
        payload.reviewed_by = userId(req) || null
        payload.reviewed_at = new Date().toISOString()
      } else {
        payload.reviewed_by = null
        payload.reviewed_at = null
      }
      delete payload.markReviewed
    }

    const record = await svc.updateLaunchRecord(req.params.id, payload, userId(req))
    if (!record) return sendError(res, 404, 'Launch record not found')
    res.json(record)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/launch-records/:id', e)
    console.error('[linearWorkspace] updateLaunchRecord:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to update launch record')
  }
}

async function deleteLaunchRecord(req, res) {
  try {
    if (!canDeleteLaunchRecords(req.user)) return sendForbidden(res)
    const existing = await svc.getLaunchRecord(req.params.id)
    if (!existing) return sendError(res, 404, 'Launch record not found')
    await svc.deleteLaunchRecord(req.params.id, userId(req))
    res.json({ ok: true })
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/launch-records/:id', e)
    console.error('[linearWorkspace] deleteLaunchRecord:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to delete launch record')
  }
}

// ── Audit ─────────────────────────────────────────────────────────────────────

async function getAuditLog(req, res) {
  try {
    if (!canViewAudit(req.user)) return sendForbidden(res)
    const data = await listLinearAudit({
      entityType: req.query.entityType,
      entityId: req.query.entityId,
      relatedIssueId: req.query.relatedIssueId,
      actorUserId: req.query.actorUserId,
      action: req.query.action,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
      offset: req.query.offset,
      search: req.query.search,
    })
    res.json(data)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/audit', e)
    console.error('[linearWorkspace] getAuditLog:', e.message)
    sendError(res, 500, 'Failed to load audit log')
  }
}

// ── Admin Backup / Export ─────────────────────────────────────────────────────

async function exportWorkspaceData(req, res) {
  try {
    if (!canExportWorkspace(req.user)) return sendForbidden(res)
    const format = String(req.query.format || 'json').toLowerCase()
    if (format !== 'json') return sendError(res, 400, 'Only json export is supported')

    const payload = await exportLinearWorkspaceData({
      scope: req.query.scope || 'all',
      actorUserId: userId(req),
      auditLimit: req.query.limit,
    })
    res.json(payload)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/admin/export', e)
    console.error('[linearWorkspace] exportWorkspaceData:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to export workspace data')
  }
}

async function dryRunImportWorkspaceData(req, res) {
  try {
    if (!canRestoreWorkspace(req.user)) return sendForbidden(res)
    const result = await dryRunLinearWorkspaceImport(req.body)
    res.json(result)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/admin/import/dry-run', e)
    console.error('[linearWorkspace] dryRunImportWorkspaceData:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to validate export file')
  }
}

async function previewImportWorkspaceData(req, res) {
  try {
    if (!canRestoreWorkspace(req.user)) return sendForbidden(res)
    const result = await previewLinearWorkspaceImport(req.body)
    res.json(result)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/admin/import/preview', e)
    console.error('[linearWorkspace] previewImportWorkspaceData:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to preview import')
  }
}

async function applyImportWorkspaceData(req, res) {
  try {
    if (!canRestoreWorkspace(req.user)) return sendForbidden(res)
    const result = await applyLinearWorkspaceImport({
      exportData: req.body?.exportData,
      options: req.body?.options || {},
      confirmation: req.body?.confirmation,
      previewToken: req.body?.previewToken,
      actorUserId: userId(req),
    })
    res.json(result)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/admin/import/apply', e)
    console.error('[linearWorkspace] applyImportWorkspaceData:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to apply import')
  }
}

// ── Admin Users / Roles ───────────────────────────────────────────────────────

async function listWorkspaceUsers(req, res) {
  try {
    if (!canManageWorkspaceUsers(req.user)) return sendForbidden(res)
    const users = await listLinearWorkspaceUsers()
    res.json(users)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/admin/users', e)
    console.error('[linearWorkspace] listWorkspaceUsers:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to load workspace users')
  }
}

async function updateWorkspaceUserRole(req, res) {
  try {
    if (!canManageWorkspaceUsers(req.user)) return sendForbidden(res)
    if (!Object.prototype.hasOwnProperty.call(req.body || {}, 'linearWorkspaceRole')) {
      return sendError(res, 400, 'linearWorkspaceRole is required')
    }
    const user = await updateLinearWorkspaceUserRole({
      userId: req.params.userId,
      linearWorkspaceRole: req.body?.linearWorkspaceRole,
      actorUserId: userId(req),
    })
    res.json(user)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/admin/users/:userId/role', e)
    console.error('[linearWorkspace] updateWorkspaceUserRole:', e.message)
    const payload = { error: e.message || 'Failed to update workspace role' }
    if (e.details) payload.details = e.details
    res.status(e.status || 500).json(payload)
  }
}

async function getPermissionsAudit(req, res) {
  try {
    if (!canManageWorkspaceUsers(req.user)) return sendForbidden(res)
    const currentUser = await getCurrentWorkspaceAuditUser(req)
    res.json({
      roles: getAllRolePermissionSummaries(),
      actions: getPermissionAuditActions(),
      protectedRoutes: getProtectedRouteAuditMap(),
      currentUser,
    })
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/admin/permissions/audit', e)
    console.error('[linearWorkspace] getPermissionsAudit:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to load permissions audit')
  }
}

async function simulatePermissions(req, res) {
  try {
    if (!canManageWorkspaceUsers(req.user)) return sendForbidden(res)
    const role = String(req.body?.role || '').trim().toLowerCase()
    const result = getRoleSimulation(role)
    if (!result) {
      return res.status(400).json({
        error: 'Invalid role',
        message: 'Role must be one of viewer, contributor, developer, qa, manager, or admin.',
      })
    }
    res.json(result)
  } catch (e) {
    trackWorkspaceError('/api/projects/linear/admin/permissions/simulate', e)
    console.error('[linearWorkspace] simulatePermissions:', e.message)
    sendError(res, e.status || 500, e.message || 'Failed to simulate role permissions')
  }
}

module.exports = {
  getWorkspaceHealth,
  listWorkspaceSmokeTests,
  runWorkspaceSmokeTests,
  getNotificationPreferences,
  updateNotificationPreferences,
  listDigestOutbox,
  createDigestOutbox,
  updateDigestOutbox,
  deleteDigestOutbox,
  searchWorkspace,
  listDocs, getDoc, createDoc, updateDoc, deleteDoc,
  listIntake, createIntake, updateIntake, deleteIntake,
  listMobileReleases, createMobileRelease, updateMobileRelease, deleteMobileRelease,
  listDeployments, createDeployment, updateDeployment, deleteDeployment,
  listChecklistRuns, upsertChecklistRun, deleteChecklistRun,
  listLaunchRecords, createLaunchRecord, updateLaunchRecord, deleteLaunchRecord,
  getAuditLog,
  exportWorkspaceData,
  dryRunImportWorkspaceData,
  previewImportWorkspaceData,
  applyImportWorkspaceData,
  listWorkspaceUsers,
  updateWorkspaceUserRole,
  getPermissionsAudit,
  simulatePermissions,
}
