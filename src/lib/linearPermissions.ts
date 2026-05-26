export type LinearWorkspaceRole =
  | 'viewer'
  | 'contributor'
  | 'developer'
  | 'qa'
  | 'manager'
  | 'admin'

type MaybeUser = {
  id?: string | number | null
  userId?: string | number | null
  role?: string | null
  linearWorkspaceRole?: string | null
  linear_workspace_role?: string | null
  permissions?: Record<string, any> | null
} | null | undefined

type MaybeIssue = {
  assigneeUserId?: string | number | null
  assignee_user_id?: string | number | null
  reporterUserId?: string | number | null
  reporter_user_id?: string | number | null
  createdBy?: string | number | null
  created_by?: string | number | null
} | null | undefined

type MaybeDigestOutbox = {
  created_by?: string | number | null
  createdBy?: string | number | null
} | null | undefined

const ROLE_ORDER: LinearWorkspaceRole[] = [
  'viewer',
  'contributor',
  'developer',
  'qa',
  'manager',
  'admin',
]

export const LINEAR_PERMISSION_DENIED_MESSAGE = 'You do not have permission to perform this action.'

export const LINEAR_ROLE_CAPABILITIES: Record<LinearWorkspaceRole, string[]> = {
  viewer: [
    'View issues, docs, releases, roadmap, dashboard, and reports',
    'Open comments, attachments, and activity in read-only mode',
  ],
  contributor: [
    'Create issues',
    'Add comments and attachments',
    'Create intake items',
  ],
  developer: [
    'Update assigned issues',
    'Edit dev workflow metadata',
    'Run checklist workflows',
    'Sync GitHub PR metadata for assigned issues',
  ],
  qa: [
    'Update QA notes',
    'Approve or revoke QA',
    'Add QA proof attachments',
    'Run SOP checklists',
  ],
  manager: [
    'Manage issues, docs, intake, releases, and deployments',
    'Approve release and deployment sign-off',
    'View audit history',
    'Open GitHub integration settings',
  ],
  admin: [
    'Full workspace access',
    'Delete shared workspace records',
    'Export and restore workspace data',
    'Open audit, backup, and admin settings',
    'Manage workspace user roles',
  ],
}

function normalizeRole(value: unknown): LinearWorkspaceRole | null {
  const role = String(value || '').trim().toLowerCase()
  return (ROLE_ORDER as string[]).includes(role) ? (role as LinearWorkspaceRole) : null
}

function getPermissions(user: MaybeUser) {
  return (user?.permissions || {}) as Record<string, any>
}

function getLinearModule(user: MaybeUser) {
  const permissions = getPermissions(user)
  const moduleValue = permissions.linear_workspace || permissions.linearWorkspace || permissions.linear || {}
  return moduleValue && typeof moduleValue === 'object' ? moduleValue : {}
}

function roleAtLeast(user: MaybeUser, minimumRole: LinearWorkspaceRole) {
  const currentRole = getUserWorkspaceRole(user)
  if (!currentRole) return false
  return ROLE_ORDER.indexOf(currentRole) >= ROLE_ORDER.indexOf(minimumRole)
}

function userId(user: MaybeUser) {
  const raw = user?.userId ?? user?.id ?? null
  return raw == null ? null : String(raw)
}

function issueAssigneeId(issue: MaybeIssue) {
  const raw = issue?.assigneeUserId ?? issue?.assignee_user_id ?? null
  return raw == null ? null : String(raw)
}

function digestCreatedBy(item: MaybeDigestOutbox) {
  const raw = item?.created_by ?? item?.createdBy ?? null
  return raw == null ? null : String(raw)
}

export function getUserWorkspaceRole(user: MaybeUser): LinearWorkspaceRole | null {
  if (!user) return null

  const storedRole = normalizeRole(user.linearWorkspaceRole ?? user.linear_workspace_role)
  if (storedRole) return storedRole

  if (user.role === 'admin') return 'admin'

  const directRole = normalizeRole(user.role)
  if (directRole) return directRole

  const linearModule = getLinearModule(user)
  for (const role of ['manager', 'qa', 'developer', 'contributor', 'viewer'] as const) {
    if (linearModule[role]) return role
  }

  const planner = getPermissions(user).planner || {}
  if (planner.manage) return 'manager'
  if (planner.view) return 'viewer'

  if (user.role === 'warehouse') return 'viewer'
  return null
}

export function canViewLinear(user: MaybeUser) {
  return Boolean(getUserWorkspaceRole(user))
}

export function canCreateIssue(user: MaybeUser) {
  return roleAtLeast(user, 'contributor')
}

export function canEditIssue(user: MaybeUser, issue: MaybeIssue) {
  if (!user || !issue) return false
  if (roleAtLeast(user, 'manager')) return true

  const role = getUserWorkspaceRole(user)
  if (role === 'developer') {
    const currentUserId = userId(user)
    return Boolean(currentUserId && issueAssigneeId(issue) === currentUserId)
  }

  if (role === 'qa') return true

  return false
}

export function canDeleteIssue(user: MaybeUser) {
  return roleAtLeast(user, 'admin')
}

export function canManageDocs(user: MaybeUser) {
  return roleAtLeast(user, 'manager')
}

export function canManageIntake(user: MaybeUser) {
  return roleAtLeast(user, 'manager')
}

export function canApproveQA(user: MaybeUser) {
  return roleAtLeast(user, 'qa')
}

export function canApproveRelease(user: MaybeUser) {
  return roleAtLeast(user, 'manager')
}

export function canManageGitHub(user: MaybeUser) {
  return roleAtLeast(user, 'manager')
}

export function canViewAudit(user: MaybeUser) {
  return roleAtLeast(user, 'manager')
}

export function canExportWorkspace(user: MaybeUser) {
  return roleAtLeast(user, 'admin')
}

export function canRestoreWorkspace(user: MaybeUser) {
  return roleAtLeast(user, 'admin')
}

export function canManageWorkspaceUsers(user: MaybeUser) {
  return roleAtLeast(user, 'admin')
}

export function canViewDigestOutbox(user: MaybeUser, item?: MaybeDigestOutbox) {
  if (!user) return false
  if (roleAtLeast(user, 'manager')) return true
  if (!roleAtLeast(user, 'contributor')) return false
  if (!item) return true
  const currentUserId = userId(user)
  const createdBy = digestCreatedBy(item)
  return Boolean(currentUserId && createdBy && currentUserId === createdBy)
}

export function canCreateDigestOutbox(user: MaybeUser) {
  return roleAtLeast(user, 'contributor')
}

export function canEditDigestOutbox(user: MaybeUser, item: MaybeDigestOutbox) {
  if (!user || !item) return false
  if (roleAtLeast(user, 'manager')) return true
  if (!roleAtLeast(user, 'contributor')) return false
  const currentUserId = userId(user)
  const createdBy = digestCreatedBy(item)
  return Boolean(currentUserId && createdBy && currentUserId === createdBy)
}

export function canCommentOnIssue(user: MaybeUser) {
  return roleAtLeast(user, 'contributor')
}

export function canManageIssueAttachments(user: MaybeUser) {
  return roleAtLeast(user, 'contributor')
}

export function canRunChecklists(user: MaybeUser) {
  return roleAtLeast(user, 'developer')
}

export function canManageReleases(user: MaybeUser) {
  return roleAtLeast(user, 'manager')
}

export function canManageDeployments(user: MaybeUser) {
  return roleAtLeast(user, 'manager')
}

export function canViewLaunchRecords(user: MaybeUser) {
  return canViewLinear(user)
}

export function canManageLaunchRecords(user: MaybeUser) {
  return roleAtLeast(user, 'manager')
}

export function canDeleteLaunchRecords(user: MaybeUser) {
  return roleAtLeast(user, 'admin')
}

export function canAccessLinearSettings(user: MaybeUser) {
  return canManageGitHub(user)
}

export function canUseGitHubSync(user: MaybeUser, issue: MaybeIssue) {
  if (canManageGitHub(user)) return true
  if (getUserWorkspaceRole(user) !== 'developer') return false
  const currentUserId = userId(user)
  return Boolean(currentUserId && issue && issueAssigneeId(issue) === currentUserId)
}

export function canEditIssueTitleOrDescription(user: MaybeUser) {
  return roleAtLeast(user, 'manager')
}

export function canManageIssueProperties(user: MaybeUser, issue: MaybeIssue) {
  return canEditIssue(user, issue)
}
