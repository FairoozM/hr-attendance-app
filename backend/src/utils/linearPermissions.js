const WORKSPACE_ROLE_ORDER = ['viewer', 'contributor', 'developer', 'qa', 'manager', 'admin']
const WORKSPACE_ROLES_DESC = [...WORKSPACE_ROLE_ORDER].reverse()

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase()
  return WORKSPACE_ROLE_ORDER.includes(role) ? role : null
}

function getLinearPermissionModule(user) {
  const permissions = user?.permissions || {}
  const moduleValue =
    permissions.linear_workspace ||
    permissions.linearWorkspace ||
    permissions.linear ||
    {}
  return moduleValue && typeof moduleValue === 'object' ? moduleValue : {}
}

function hasWorkspaceFlag(user, key) {
  return Boolean(getLinearPermissionModule(user)?.[key])
}

function getStoredWorkspaceRole(user) {
  return normalizeRole(user?.linearWorkspaceRole ?? user?.linear_workspace_role)
}

function getExplicitWorkspaceRole(user) {
  if (!user) return null

  const storedRole = getStoredWorkspaceRole(user)
  if (storedRole) return storedRole

  if (user.role === 'admin') return 'admin'

  const directRole = normalizeRole(user.role)
  if (directRole) return directRole

  const modulePerms = getLinearPermissionModule(user)
  for (const role of ['manager', 'qa', 'developer', 'contributor', 'viewer']) {
    if (modulePerms[role]) return role
  }

  return null
}

function getUserWorkspaceRole(user) {
  const explicitRole = getExplicitWorkspaceRole(user)
  if (explicitRole) return explicitRole

  const planner = user?.permissions?.planner || {}
  if (planner.manage) return 'manager'
  if (planner.view) return 'viewer'

  if (user?.role === 'warehouse') return 'viewer'

  return null
}

function hasAnyWorkspaceRole(user) {
  return Boolean(getUserWorkspaceRole(user))
}

function roleAtLeast(user, minimumRole) {
  const currentRole = getUserWorkspaceRole(user)
  if (!currentRole) return false
  return WORKSPACE_ROLE_ORDER.indexOf(currentRole) >= WORKSPACE_ROLE_ORDER.indexOf(minimumRole)
}

function getUserId(user) {
  const raw = user?.userId ?? user?.id ?? null
  return raw == null ? null : String(raw)
}

function getIssueAssigneeId(issue) {
  const raw = issue?.assignee_user_id ?? issue?.assigneeUserId ?? null
  return raw == null ? null : String(raw)
}

function getIssueReporterId(issue) {
  const raw = issue?.reporter_user_id ?? issue?.reporterUserId ?? issue?.created_by ?? issue?.createdBy ?? null
  return raw == null ? null : String(raw)
}

function getIssueCreatedBy(issue) {
  const raw = issue?.created_by ?? issue?.createdBy ?? null
  return raw == null ? null : String(raw)
}

function canViewLinear(user) {
  return hasAnyWorkspaceRole(user)
}

function canCreateIssue(user) {
  return roleAtLeast(user, 'contributor')
}

function canEditIssue(user, issue) {
  if (!user || !issue) return false
  if (roleAtLeast(user, 'manager')) return true

  const role = getUserWorkspaceRole(user)
  const userId = getUserId(user)
  if (!userId) return false

  if (role === 'developer') {
    return getIssueAssigneeId(issue) === userId
  }

  if (role === 'qa') {
    return true
  }

  return false
}

function canDeleteIssue(user) {
  return roleAtLeast(user, 'admin')
}

function canManageDocs(user) {
  return roleAtLeast(user, 'manager')
}

function canManageIntake(user) {
  return roleAtLeast(user, 'manager')
}

function canApproveQA(user) {
  return roleAtLeast(user, 'qa')
}

function canApproveRelease(user) {
  return roleAtLeast(user, 'manager')
}

function canManageGitHub(user) {
  return roleAtLeast(user, 'manager')
}

function canViewAudit(user) {
  return roleAtLeast(user, 'manager')
}

function canExportWorkspace(user) {
  return roleAtLeast(user, 'admin')
}

function canRestoreWorkspace(user) {
  return roleAtLeast(user, 'admin')
}

function canManageWorkspaceUsers(user) {
  return roleAtLeast(user, 'admin')
}

function canCommentOnIssue(user) {
  return roleAtLeast(user, 'contributor')
}

function canManageIssueAttachments(user) {
  return roleAtLeast(user, 'contributor')
}

function canUseGitHubSync(user, issue) {
  if (!user || !issue) return false
  if (canManageGitHub(user)) return true

  const role = getUserWorkspaceRole(user)
  if (role !== 'developer') return false

  const userId = getUserId(user)
  if (!userId) return false

  return getIssueAssigneeId(issue) === userId
}

function canRunChecklists(user) {
  return roleAtLeast(user, 'developer')
}

function canManageReleases(user) {
  return roleAtLeast(user, 'manager')
}

function canManageDeployments(user) {
  return roleAtLeast(user, 'manager')
}

function canViewLaunchRecords(user) {
  return canViewLinear(user)
}

function canManageLaunchRecords(user) {
  return roleAtLeast(user, 'manager')
}

function canDeleteLaunchRecords(user) {
  return roleAtLeast(user, 'admin')
}

function canCreateIntake(user) {
  return roleAtLeast(user, 'contributor')
}

function getDigestCreatedBy(outboxItem) {
  const raw = outboxItem?.created_by ?? outboxItem?.createdBy ?? null
  return raw == null ? null : String(raw)
}

function canViewDigestOutbox(user, outboxItem = null) {
  if (!user) return false
  if (roleAtLeast(user, 'manager')) return true
  if (!roleAtLeast(user, 'contributor')) return false
  if (!outboxItem) return true
  const currentUserId = getUserId(user)
  const createdBy = getDigestCreatedBy(outboxItem)
  return currentUserId != null && createdBy != null && currentUserId === createdBy
}

function canCreateDigestOutbox(user) {
  return roleAtLeast(user, 'contributor')
}

function canEditDigestOutbox(user, outboxItem) {
  if (!user || !outboxItem) return false
  if (roleAtLeast(user, 'manager')) return true
  if (!roleAtLeast(user, 'contributor')) return false
  const currentUserId = getUserId(user)
  const createdBy = getDigestCreatedBy(outboxItem)
  return currentUserId != null && createdBy != null && currentUserId === createdBy
}

function canEditIntake(user, item) {
  if (!user || !item) return false
  if (canManageIntake(user)) return true
  if (getUserWorkspaceRole(user) !== 'contributor') return false

  const userId = getUserId(user)
  const createdBy = item?.created_by ?? item?.createdBy ?? null
  return userId != null && createdBy != null && String(createdBy) === userId
}

function canDeleteIntake(user, item) {
  return canEditIntake(user, item)
}

function getAllowedIssueUpdateFields(user, issue) {
  if (roleAtLeast(user, 'manager')) {
    return new Set([
      'title',
      'description',
      'status',
      'priority',
      'start_date',
      'due_date',
      'section_id',
      'parent_task_id',
      'estimated_hours',
      'actual_hours',
      'progress_percent',
      'sort_order',
      'archived',
      'assignee_user_id',
      'reporter_user_id',
      'reviewer_user_id',
      'issue_type',
      'sprint_id',
      'story_points',
      'blocked_reason',
      'labels',
      'dev_meta',
    ])
  }

  const role = getUserWorkspaceRole(user)
  if (role === 'developer' && canEditIssue(user, issue)) {
    return new Set(['status', 'priority', 'blocked_reason', 'dev_meta'])
  }

  if (role === 'qa') {
    return new Set(['dev_meta'])
  }

  return new Set()
}

function canManageCycles(user) {
  return roleAtLeast(user, 'manager')
}

function canManageDependencies(user) {
  return roleAtLeast(user, 'manager')
}

function canAccessLinearSettings(user) {
  return canManageGitHub(user)
}

const PERMISSION_AUDIT_ACTIONS = [
  { key: 'viewWorkspace', label: 'View workspace' },
  { key: 'createIssue', label: 'Create issue' },
  { key: 'editIssue', label: 'Edit issue' },
  { key: 'deleteIssue', label: 'Delete issue' },
  { key: 'comment', label: 'Comment' },
  { key: 'uploadAttachment', label: 'Upload attachment' },
  { key: 'manageDocs', label: 'Manage docs' },
  { key: 'manageIntake', label: 'Manage intake' },
  { key: 'approveQA', label: 'Approve QA' },
  { key: 'approveRelease', label: 'Approve release' },
  { key: 'manageReleasesDeployments', label: 'Manage releases/deployments' },
  { key: 'syncGitHubPr', label: 'Sync GitHub PR' },
  { key: 'manageGitHub', label: 'Manage GitHub' },
  { key: 'manageGitHubSettings', label: 'Manage GitHub settings' },
  { key: 'viewAudit', label: 'View audit' },
  { key: 'viewLaunchHistory', label: 'View launch history' },
  { key: 'manageLaunchHistory', label: 'Manage launch history' },
  { key: 'deleteLaunchHistory', label: 'Delete launch history' },
  { key: 'exportWorkspace', label: 'Export workspace' },
  { key: 'restoreWorkspace', label: 'Restore workspace' },
  { key: 'manageRoles', label: 'Manage roles' },
  { key: 'viewDigestOutbox', label: 'View digest outbox' },
  { key: 'createDigestOutbox', label: 'Create digest draft' },
]

const PROTECTED_ROUTE_AUDIT_MAP = [
  { method: 'GET', path: '/api/projects/linear/smoke-tests', requiredPermission: 'runWorkspaceSmokeTests', allowedRoles: ['manager', 'admin'] },
  { method: 'POST', path: '/api/projects/linear/smoke-tests/run', requiredPermission: 'runWorkspaceSmokeTests', allowedRoles: ['manager', 'admin'] },
  { method: 'GET', path: '/api/projects/linear/health', requiredPermission: 'viewWorkspaceHealth', allowedRoles: ['manager', 'admin'] },
  { method: 'GET', path: '/api/projects/linear/search', requiredPermission: 'viewWorkspace (audit results only for manager/admin)', allowedRoles: [...WORKSPACE_ROLES_DESC] },
  { method: 'GET', path: '/api/projects/linear/notifications/preferences', requiredPermission: 'viewWorkspaceOwnNotificationPreferences', allowedRoles: [...WORKSPACE_ROLES_DESC] },
  { method: 'PATCH', path: '/api/projects/linear/notifications/preferences', requiredPermission: 'viewWorkspaceOwnNotificationPreferences', allowedRoles: [...WORKSPACE_ROLES_DESC] },
  { method: 'GET', path: '/api/projects/linear/notifications/digests', requiredPermission: 'viewOwnDigestOutboxOrManageAll', allowedRoles: ['contributor', 'developer', 'qa', 'manager', 'admin'] },
  { method: 'POST', path: '/api/projects/linear/notifications/digests', requiredPermission: 'createDigestOutbox', allowedRoles: ['contributor', 'developer', 'qa', 'manager', 'admin'] },
  { method: 'PATCH', path: '/api/projects/linear/notifications/digests/:id', requiredPermission: 'editOwnDigestOutboxOrManageAll', allowedRoles: ['contributor', 'developer', 'qa', 'manager', 'admin'] },
  { method: 'DELETE', path: '/api/projects/linear/notifications/digests/:id', requiredPermission: 'editOwnDigestOutboxOrManageAll', allowedRoles: ['contributor', 'developer', 'qa', 'manager', 'admin'] },
  { method: 'GET', path: '/api/projects/linear/docs', requiredPermission: 'viewWorkspace', allowedRoles: [...WORKSPACE_ROLES_DESC] },
  { method: 'POST', path: '/api/projects/linear/docs', requiredPermission: 'manageDocs', allowedRoles: ['manager', 'admin'] },
  { method: 'PATCH', path: '/api/projects/linear/docs/:id', requiredPermission: 'manageDocs', allowedRoles: ['manager', 'admin'] },
  { method: 'DELETE', path: '/api/projects/linear/docs/:id', requiredPermission: 'manageDocs', allowedRoles: ['manager', 'admin'] },
  { method: 'GET', path: '/api/projects/linear/intake', requiredPermission: 'viewWorkspace', allowedRoles: [...WORKSPACE_ROLES_DESC] },
  { method: 'POST', path: '/api/projects/linear/intake', requiredPermission: 'createIntake', allowedRoles: ['contributor', 'developer', 'qa', 'manager', 'admin'] },
  { method: 'PATCH', path: '/api/projects/linear/intake/:id', requiredPermission: 'editOwnIntakeOrManageIntake', allowedRoles: ['contributor', 'manager', 'admin'] },
  { method: 'DELETE', path: '/api/projects/linear/intake/:id', requiredPermission: 'deleteOwnIntakeOrManageIntake', allowedRoles: ['contributor', 'manager', 'admin'] },
  { method: 'GET', path: '/api/projects/linear/mobile-releases', requiredPermission: 'viewWorkspace', allowedRoles: [...WORKSPACE_ROLES_DESC] },
  { method: 'POST', path: '/api/projects/linear/mobile-releases', requiredPermission: 'manageReleases', allowedRoles: ['manager', 'admin'] },
  { method: 'PATCH', path: '/api/projects/linear/mobile-releases/:id', requiredPermission: 'manageReleases', allowedRoles: ['manager', 'admin'] },
  { method: 'DELETE', path: '/api/projects/linear/mobile-releases/:id', requiredPermission: 'manageReleases', allowedRoles: ['manager', 'admin'] },
  { method: 'GET', path: '/api/projects/linear/deployments', requiredPermission: 'viewWorkspace', allowedRoles: [...WORKSPACE_ROLES_DESC] },
  { method: 'POST', path: '/api/projects/linear/deployments', requiredPermission: 'manageDeployments', allowedRoles: ['manager', 'admin'] },
  { method: 'PATCH', path: '/api/projects/linear/deployments/:id', requiredPermission: 'manageDeployments', allowedRoles: ['manager', 'admin'] },
  { method: 'DELETE', path: '/api/projects/linear/deployments/:id', requiredPermission: 'manageDeployments', allowedRoles: ['manager', 'admin'] },
  { method: 'GET', path: '/api/projects/linear/launch-records', requiredPermission: 'viewLaunchHistory', allowedRoles: [...WORKSPACE_ROLES_DESC] },
  { method: 'POST', path: '/api/projects/linear/launch-records', requiredPermission: 'manageLaunchHistory', allowedRoles: ['manager', 'admin'] },
  { method: 'PATCH', path: '/api/projects/linear/launch-records/:id', requiredPermission: 'manageLaunchHistory', allowedRoles: ['manager', 'admin'] },
  { method: 'DELETE', path: '/api/projects/linear/launch-records/:id', requiredPermission: 'deleteLaunchHistory', allowedRoles: ['admin'] },
  { method: 'GET', path: '/api/projects/linear/checklist-runs', requiredPermission: 'viewWorkspace', allowedRoles: [...WORKSPACE_ROLES_DESC] },
  { method: 'POST', path: '/api/projects/linear/checklist-runs', requiredPermission: 'runChecklists', allowedRoles: ['developer', 'qa', 'manager', 'admin'] },
  { method: 'DELETE', path: '/api/projects/linear/checklist-runs/:id', requiredPermission: 'manageReleases', allowedRoles: ['manager', 'admin'] },
  { method: 'GET', path: '/api/projects/linear/audit', requiredPermission: 'viewAudit', allowedRoles: ['manager', 'admin'] },
  { method: 'GET', path: '/api/projects/linear/admin/export', requiredPermission: 'exportWorkspace', allowedRoles: ['admin'] },
  { method: 'POST', path: '/api/projects/linear/admin/import/dry-run', requiredPermission: 'restoreWorkspace', allowedRoles: ['admin'] },
  { method: 'POST', path: '/api/projects/linear/admin/import/preview', requiredPermission: 'restoreWorkspace', allowedRoles: ['admin'] },
  { method: 'POST', path: '/api/projects/linear/admin/import/apply', requiredPermission: 'restoreWorkspace', allowedRoles: ['admin'] },
  { method: 'GET', path: '/api/projects/linear/admin/users', requiredPermission: 'manageRoles', allowedRoles: ['admin'] },
  { method: 'PATCH', path: '/api/projects/linear/admin/users/:userId/role', requiredPermission: 'manageRoles', allowedRoles: ['admin'] },
  { method: 'GET', path: '/api/projects/linear/admin/permissions/audit', requiredPermission: 'manageRoles', allowedRoles: ['admin'] },
  { method: 'POST', path: '/api/projects/linear/admin/permissions/simulate', requiredPermission: 'manageRoles', allowedRoles: ['admin'] },
  { method: 'GET', path: '/api/projects/:projectId/issues', requiredPermission: 'viewWorkspace', allowedRoles: [...WORKSPACE_ROLES_DESC] },
  { method: 'POST', path: '/api/projects/:projectId/issues', requiredPermission: 'createIssue', allowedRoles: ['contributor', 'developer', 'qa', 'manager', 'admin'] },
  { method: 'PATCH', path: '/api/projects/:projectId/issues/:issueId', requiredPermission: 'editIssue (contextual)', allowedRoles: ['developer', 'qa', 'manager', 'admin'] },
  { method: 'DELETE', path: '/api/projects/:projectId/issues/:issueId', requiredPermission: 'deleteIssue', allowedRoles: ['admin'] },
  { method: 'GET', path: '/api/projects/:projectId/issues/:issueId/comments', requiredPermission: 'viewWorkspace', allowedRoles: [...WORKSPACE_ROLES_DESC] },
  { method: 'POST', path: '/api/projects/:projectId/issues/:issueId/comments', requiredPermission: 'comment', allowedRoles: ['contributor', 'developer', 'qa', 'manager', 'admin'] },
  { method: 'POST', path: '/api/projects/:projectId/issues/:issueId/attachments/upload-url', requiredPermission: 'uploadAttachment', allowedRoles: ['contributor', 'developer', 'qa', 'manager', 'admin'] },
  { method: 'POST', path: '/api/projects/:projectId/issues/:issueId/attachments', requiredPermission: 'uploadAttachment', allowedRoles: ['contributor', 'developer', 'qa', 'manager', 'admin'] },
  { method: 'PATCH', path: '/api/projects/:projectId/issues/:issueId/attachments/:attachmentId', requiredPermission: 'uploadAttachment', allowedRoles: ['contributor', 'developer', 'qa', 'manager', 'admin'] },
  { method: 'DELETE', path: '/api/projects/:projectId/issues/:issueId/attachments/:attachmentId', requiredPermission: 'uploadAttachment', allowedRoles: ['contributor', 'developer', 'qa', 'manager', 'admin'] },
  { method: 'POST', path: '/api/projects/:projectId/issues/:issueId/qa/approve', requiredPermission: 'approveQA', allowedRoles: ['qa', 'manager', 'admin'] },
  { method: 'POST', path: '/api/projects/:projectId/issues/:issueId/qa/revoke', requiredPermission: 'approveQA', allowedRoles: ['qa', 'manager', 'admin'] },
  { method: 'POST', path: '/api/projects/:projectId/issues/:issueId/github/sync-pr', requiredPermission: 'syncGitHubPr (contextual)', allowedRoles: ['developer', 'manager', 'admin'] },
  { method: 'GET', path: '/api/projects/integrations/github/status', requiredPermission: 'manageGitHubSettings', allowedRoles: ['manager', 'admin'] },
  { method: 'GET', path: '/api/projects/integrations/github/audit', requiredPermission: 'manageGitHubSettings', allowedRoles: ['manager', 'admin'] },
]

function buildPermissionSummaryForUser(user) {
  const actorId = getUserId(user) || 'sim-user'
  const assignedIssue = {
    assignee_user_id: actorId,
    created_by: actorId,
    reporter_user_id: actorId,
  }

  return {
    viewWorkspace: canViewLinear(user),
    createIssue: canCreateIssue(user),
    editIssue: canEditIssue(user, assignedIssue),
    deleteIssue: canDeleteIssue(user),
    comment: canCommentOnIssue(user),
    uploadAttachment: canManageIssueAttachments(user),
    manageDocs: canManageDocs(user),
    manageIntake: canManageIntake(user),
    approveQA: canApproveQA(user),
    approveRelease: canApproveRelease(user),
    manageReleasesDeployments: canManageReleases(user) || canManageDeployments(user),
    syncGitHubPr: canUseGitHubSync(user, assignedIssue),
    manageGitHub: canManageGitHub(user),
    manageGitHubSettings: canAccessLinearSettings(user),
    viewAudit: canViewAudit(user),
    viewLaunchHistory: canViewLaunchRecords(user),
    manageLaunchHistory: canManageLaunchRecords(user),
    deleteLaunchHistory: canDeleteLaunchRecords(user),
    exportWorkspace: canExportWorkspace(user),
    restoreWorkspace: canRestoreWorkspace(user),
    manageRoles: canManageWorkspaceUsers(user),
    viewDigestOutbox: canViewDigestOutbox(user, { created_by: actorId }),
    createDigestOutbox: canCreateDigestOutbox(user),
  }
}

function buildSimulatedUser(role) {
  const normalizedRole = normalizeRole(role)
  if (!normalizedRole) return null
  return {
    userId: 'sim-user',
    role: 'employee',
    linearWorkspaceRole: normalizedRole,
    permissions: {},
  }
}

function getRolePermissionSummary(role) {
  const user = buildSimulatedUser(role)
  if (!user) return null
  return buildPermissionSummaryForUser(user)
}

function getRoleSimulation(role) {
  const normalizedRole = normalizeRole(role)
  if (!normalizedRole) return null
  const permissions = getRolePermissionSummary(normalizedRole)
  const allowedActions = []
  const deniedActions = []

  for (const action of PERMISSION_AUDIT_ACTIONS) {
    if (permissions[action.key]) allowedActions.push(action.label)
    else deniedActions.push(action.label)
  }

  return {
    role: normalizedRole,
    permissions,
    allowedActions,
    deniedActions,
  }
}

function getAllRolePermissionSummaries() {
  const out = {}
  for (const role of WORKSPACE_ROLE_ORDER) {
    out[role] = getRolePermissionSummary(role)
  }
  return out
}

function getProtectedRouteAuditMap() {
  return PROTECTED_ROUTE_AUDIT_MAP.map((route) => ({ ...route, allowedRoles: [...route.allowedRoles] }))
}

function getPermissionAuditActions() {
  return PERMISSION_AUDIT_ACTIONS.map((action) => ({ ...action }))
}

module.exports = {
  getUserWorkspaceRole,
  canViewLinear,
  canCreateIssue,
  canEditIssue,
  canDeleteIssue,
  canManageDocs,
  canManageIntake,
  canApproveQA,
  canApproveRelease,
  canManageGitHub,
  canViewAudit,
  canExportWorkspace,
  canRestoreWorkspace,
  canManageWorkspaceUsers,
  canCommentOnIssue,
  canManageIssueAttachments,
  canUseGitHubSync,
  canRunChecklists,
  canManageReleases,
  canManageDeployments,
  canViewLaunchRecords,
  canManageLaunchRecords,
  canDeleteLaunchRecords,
  canCreateIntake,
  canViewDigestOutbox,
  canCreateDigestOutbox,
  canEditDigestOutbox,
  canEditIntake,
  canDeleteIntake,
  getAllowedIssueUpdateFields,
  canManageCycles,
  canManageDependencies,
  canAccessLinearSettings,
  getIssueAssigneeId,
  getIssueReporterId,
  getIssueCreatedBy,
  getRolePermissionSummary,
  getRoleSimulation,
  getAllRolePermissionSummaries,
  getProtectedRouteAuditMap,
  getPermissionAuditActions,
}
