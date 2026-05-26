import { issueKey, normalizePriority, normalizeStatus } from '../components/linear/IssueRow'
import { issueNeedsSop } from './linearChecklistCompliance'

export const LINEAR_NOTIFICATIONS_READ_KEY = 'lifesmile.linear.notifications.read.v1'
export const LINEAR_NOTIFICATIONS_DISMISSED_KEY = 'lifesmile.linear.notifications.dismissed.v1'
export const LINEAR_NOTIFICATION_WEEKLY_DAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const

export const LINEAR_NOTIFICATION_CATEGORY_DEFAULTS = {
  assignedToMe: true,
  comments: true,
  readyForRelease: true,
  qaApproved: true,
  releaseApproved: true,
  deploymentVerified: true,
  githubMerged: true,
  highPriority: true,
  overdue: true,
  intakeConverted: true,
  roleChanged: false,
}

export const LINEAR_NOTIFICATION_CATEGORY_FIELDS = [
  { key: 'assignedToMe', label: 'Assigned to me' },
  { key: 'comments', label: 'Comments/updates' },
  { key: 'readyForRelease', label: 'Ready for Release' },
  { key: 'qaApproved', label: 'QA Approved' },
  { key: 'releaseApproved', label: 'Release Approved' },
  { key: 'deploymentVerified', label: 'Deployment Verified' },
  { key: 'githubMerged', label: 'GitHub PR merged' },
  { key: 'highPriority', label: 'High priority' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'intakeConverted', label: 'Intake converted' },
  { key: 'roleChanged', label: 'Role/permission changes' },
] as const

export type LinearNotificationPreferenceCategories = typeof LINEAR_NOTIFICATION_CATEGORY_DEFAULTS
export type LinearNotificationDigestType = 'daily' | 'weekly' | 'release' | 'my_work' | 'management'
export type LinearDigestOutboxType = LinearNotificationDigestType | 'custom'
export type LinearDigestOutboxStatus = 'draft' | 'copied' | 'archived'
export type LinearDigestOutboxChannel = 'manual' | 'whatsapp' | 'email'

export const LINEAR_DIGEST_OUTBOX_TYPES: Array<{ value: LinearDigestOutboxType, label: string }> = [
  { value: 'daily', label: 'Daily Digest' },
  { value: 'weekly', label: 'Weekly Digest' },
  { value: 'release', label: 'Release Digest' },
  { value: 'management', label: 'Management Digest' },
  { value: 'my_work', label: 'My Work Digest' },
  { value: 'custom', label: 'Custom Digest' },
]

export const LINEAR_DIGEST_OUTBOX_CHANNELS: Array<{ value: LinearDigestOutboxChannel, label: string }> = [
  { value: 'manual', label: 'Manual' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'email', label: 'Email' },
]

export const LINEAR_DIGEST_OUTBOX_STATUSES: Array<{ value: LinearDigestOutboxStatus, label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'copied', label: 'Copied' },
  { value: 'archived', label: 'Archived' },
]

export type LinearNotificationPreferences = {
  id?: number
  user_id?: number | string
  channel_in_app: boolean
  channel_email: boolean
  channel_whatsapp: boolean
  email_address: string | null
  whatsapp_number: string | null
  digest_daily: boolean
  digest_weekly: boolean
  digest_release: boolean
  daily_digest_time: string
  weekly_digest_day: (typeof LINEAR_NOTIFICATION_WEEKLY_DAYS)[number]
  categories: LinearNotificationPreferenceCategories
}

export type LinearNotificationCategory =
  | 'assigned'
  | 'status_changed'
  | 'ready_for_release'
  | 'qa_approved'
  | 'deployment_verified'
  | 'github_update'
  | 'high_priority'
  | 'overdue'
  | 'intake_converted'
  | 'checklist_incomplete'
  | 'role_changed'

export type LinearNotification = {
  id: string
  category: LinearNotificationCategory
  title: string
  description: string
  entityType: 'issue' | 'release' | 'deployment' | 'intake' | 'audit'
  actionLabel: string
  actionHref: string
  actorName?: string | null
  relatedLabel?: string | null
  projectId?: string | number | null
  assigneeUserId?: string | number | null
  priority?: string | null
  timestampRaw?: string | null
  timestampMs: number
}

type MaybeUser = {
  id?: string | number | null
  userId?: string | number | null
  displayName?: string | null
  username?: string | null
} | null | undefined

type NotificationBuildArgs = {
  user?: MaybeUser
  issues?: any[]
  projectsMap?: Record<string | number, any>
  membersMap?: Record<string | number, any>
  mobileReleases?: any[]
  deployments?: any[]
  intakeItems?: any[]
  githubAuditItems?: any[]
  adminAuditItems?: any[]
}

type DigestContext = {
  user?: MaybeUser
  issues?: any[]
  projectsMap?: Record<string | number, any>
  membersMap?: Record<string | number, any>
  mobileReleases?: any[]
  deployments?: any[]
  notifications?: LinearNotification[]
}

export function normalizeNotificationPreferences(value: any): LinearNotificationPreferences {
  const source = value && typeof value === 'object' ? value : {}
  const categories = source.categories && typeof source.categories === 'object' && !Array.isArray(source.categories)
    ? source.categories
    : {}

  return {
    id: source.id,
    user_id: source.user_id,
    channel_in_app: source.channel_in_app !== false,
    channel_email: Boolean(source.channel_email),
    channel_whatsapp: Boolean(source.channel_whatsapp),
    email_address: source.email_address ? String(source.email_address) : null,
    whatsapp_number: source.whatsapp_number ? String(source.whatsapp_number) : null,
    digest_daily: Boolean(source.digest_daily),
    digest_weekly: Boolean(source.digest_weekly),
    digest_release: Boolean(source.digest_release),
    daily_digest_time: typeof source.daily_digest_time === 'string' && source.daily_digest_time ? source.daily_digest_time : '09:00',
    weekly_digest_day:
      LINEAR_NOTIFICATION_WEEKLY_DAYS.find((day) => day === source.weekly_digest_day) || 'Monday',
    categories: Object.fromEntries(
      Object.keys(LINEAR_NOTIFICATION_CATEGORY_DEFAULTS).map((key) => [
        key,
        categories[key] === undefined
          ? LINEAR_NOTIFICATION_CATEGORY_DEFAULTS[key as keyof LinearNotificationPreferenceCategories]
          : Boolean(categories[key]),
      ])
    ) as LinearNotificationPreferenceCategories,
  }
}

function parseTime(value: unknown) {
  if (!value) return 0
  const ms = new Date(String(value)).getTime()
  return Number.isFinite(ms) ? ms : 0
}

function formatShortDate(value: unknown) {
  if (!value) return ''
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })
}

function currentUserId(user?: MaybeUser) {
  const raw = user?.userId ?? user?.id ?? null
  return raw == null ? null : String(raw)
}

function memberName(membersMap: Record<string | number, any>, userId: string | number | null | undefined) {
  if (userId == null) return null
  const member = membersMap[String(userId)] || membersMap[userId]
  return member?.displayName || member?.username || `User #${userId}`
}

function projectLabel(projectsMap: Record<string | number, any>, projectId: string | number | null | undefined, issueId?: string | number | null) {
  if (projectId == null || issueId == null) return null
  return issueKey(projectsMap[projectId]?.name, issueId)
}

function dueIsPast(value: unknown) {
  if (!value) return false
  const date = new Date(String(value))
  if (Number.isNaN(date.getTime())) return false
  const now = new Date()
  return date.getTime() < now.getTime()
}

function isActiveIssue(issue: any) {
  const status = normalizeStatus(issue?.status)
  return !['Done', 'Canceled'].includes(status)
}

function isHighPriority(issue: any) {
  const priority = normalizePriority(issue?.priority)
  return priority === 'Urgent' || priority === 'High'
}

function createdRecently(value: unknown, days = 7) {
  const ms = parseTime(value)
  if (!ms) return false
  return Date.now() - ms <= days * 24 * 60 * 60 * 1000
}

function pushNotification(map: Map<string, LinearNotification>, item: LinearNotification) {
  const existing = map.get(item.id)
  if (!existing || item.timestampMs > existing.timestampMs) {
    map.set(item.id, item)
  }
}

function issueHref(issue: any) {
  return `#/projects/linear?issueId=${encodeURIComponent(issue.id)}&projectId=${encodeURIComponent(issue.projectId)}`
}

export function readNotificationIdList(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean)
}

export function buildIssueAttentionNotifications({
  user,
  issues = [],
  projectsMap = {},
  membersMap = {},
}: NotificationBuildArgs) {
  const notifications = new Map<string, LinearNotification>()
  const me = currentUserId(user)

  for (const issue of issues) {
    if (!issue || !isActiveIssue(issue)) continue

    const key = projectLabel(projectsMap, issue.projectId, issue.id) || `Issue #${issue.id}`
    const status = normalizeStatus(issue.status)
    const priority = normalizePriority(issue.priority)
    const timestampRaw = issue.updatedAt || issue.createdAt || issue.dueDate || null
    const timestampMs = parseTime(timestampRaw)
    const actorName = issue.devMeta?.qaApproval?.approvedBy
      ? memberName(membersMap, issue.devMeta.qaApproval.approvedBy)
      : null

    if (me && String(issue.assigneeUserId || '') === me) {
      pushNotification(notifications, {
        id: `assigned:${issue.projectId}:${issue.id}`,
        category: 'assigned',
        title: 'Assigned to me',
        description: `${key} is assigned to you and is currently ${status}.`,
        entityType: 'issue',
        actionLabel: 'Open Issue',
        actionHref: issueHref(issue),
        relatedLabel: key,
        projectId: issue.projectId,
        assigneeUserId: issue.assigneeUserId,
        priority,
        timestampRaw,
        timestampMs,
      })
    }

    if (status === 'Ready for Release') {
      pushNotification(notifications, {
        id: `ready:${issue.projectId}:${issue.id}`,
        category: 'ready_for_release',
        title: 'Ready for Release',
        description: `${key} is ready for release.`,
        entityType: 'issue',
        actionLabel: 'Open Issue',
        actionHref: issueHref(issue),
        relatedLabel: key,
        projectId: issue.projectId,
        assigneeUserId: issue.assigneeUserId,
        priority,
        timestampRaw,
        timestampMs,
      })
    }

    if (issue.devMeta?.qaApproval?.approved || status === 'QA Approved') {
      pushNotification(notifications, {
        id: `qa:${issue.projectId}:${issue.id}`,
        category: 'qa_approved',
        title: 'QA Approved',
        description: `${key} has been QA approved${actorName ? ` by ${actorName}` : ''}.`,
        entityType: 'issue',
        actionLabel: 'Open Issue',
        actionHref: issueHref(issue),
        actorName,
        relatedLabel: key,
        projectId: issue.projectId,
        assigneeUserId: issue.assigneeUserId,
        priority,
        timestampRaw: issue.devMeta?.qaApproval?.approvedAt || timestampRaw,
        timestampMs: parseTime(issue.devMeta?.qaApproval?.approvedAt || timestampRaw),
      })
    }

    if (issue.devMeta?.prStatus) {
      const prStatus = String(issue.devMeta.prStatus).replace(/_/g, ' ')
      pushNotification(notifications, {
        id: `github:${issue.projectId}:${issue.id}:${issue.devMeta.prStatus}`,
        category: 'github_update',
        title: issue.devMeta.prStatus === 'merged' ? 'GitHub PR merged' : 'GitHub PR updated',
        description: `${key} PR status is ${prStatus}.`,
        entityType: 'issue',
        actionLabel: 'Open Issue',
        actionHref: issueHref(issue),
        relatedLabel: key,
        projectId: issue.projectId,
        assigneeUserId: issue.assigneeUserId,
        priority,
        timestampRaw: issue.devMeta?.githubUpdatedAt || timestampRaw,
        timestampMs: parseTime(issue.devMeta?.githubUpdatedAt || timestampRaw),
      })
    }

    if (isHighPriority(issue) && createdRecently(issue.createdAt, 10)) {
      pushNotification(notifications, {
        id: `highpri:${issue.projectId}:${issue.id}`,
        category: 'high_priority',
        title: 'High priority issue created',
        description: `${key} was created with ${priority} priority.`,
        entityType: 'issue',
        actionLabel: 'Open Issue',
        actionHref: issueHref(issue),
        relatedLabel: key,
        projectId: issue.projectId,
        assigneeUserId: issue.assigneeUserId,
        priority,
        timestampRaw: issue.createdAt || timestampRaw,
        timestampMs: parseTime(issue.createdAt || timestampRaw),
      })
    }

    if (issue.dueDate && dueIsPast(issue.dueDate)) {
      pushNotification(notifications, {
        id: `overdue:${issue.projectId}:${issue.id}`,
        category: 'overdue',
        title: 'Overdue issue',
        description: `${key} is overdue${formatShortDate(issue.dueDate) ? ` since ${formatShortDate(issue.dueDate)}` : ''}.`,
        entityType: 'issue',
        actionLabel: 'Open Issue',
        actionHref: issueHref(issue),
        relatedLabel: key,
        projectId: issue.projectId,
        assigneeUserId: issue.assigneeUserId,
        priority,
        timestampRaw: issue.dueDate,
        timestampMs: parseTime(issue.dueDate),
      })
    }

    if (issueNeedsSop(issue, projectsMap?.[issue.projectId])) {
      pushNotification(notifications, {
        id: `checklist:${issue.projectId}:${issue.id}`,
        category: 'checklist_incomplete',
        title: 'Checklist incomplete',
        description: `${key} still needs checklist completion before release.`,
        entityType: 'issue',
        actionLabel: 'Open Issue',
        actionHref: issueHref(issue),
        relatedLabel: key,
        projectId: issue.projectId,
        assigneeUserId: issue.assigneeUserId,
        priority,
        timestampRaw,
        timestampMs,
      })
    }
  }

  return Array.from(notifications.values()).sort((a, b) => b.timestampMs - a.timestampMs)
}

export function buildWorkspaceNotifications(args: NotificationBuildArgs) {
  const {
    projectsMap = {},
    mobileReleases = [],
    deployments = [],
    intakeItems = [],
    githubAuditItems = [],
    adminAuditItems = [],
  } = args

  const notifications = new Map<string, LinearNotification>()
  for (const item of buildIssueAttentionNotifications(args)) {
    pushNotification(notifications, item)
  }

  for (const intake of intakeItems) {
    if (!intake?.linked_issue_id) continue
    const timestampRaw = intake.updated_at || intake.created_at || null
    pushNotification(notifications, {
      id: `intake:${intake.id}`,
      category: 'intake_converted',
      title: 'Intake converted',
      description: `${intake.title || 'Intake item'} was converted into issue #${intake.linked_issue_id}.`,
      entityType: 'intake',
      actionLabel: 'Open Issue',
      actionHref: `#/projects/linear`,
      relatedLabel: intake.title || `Intake #${intake.id}`,
      timestampRaw,
      timestampMs: parseTime(timestampRaw),
    })
  }

  for (const release of mobileReleases) {
    const status = String(release?.status || '')
    if (!['Submitted', 'Released'].includes(status)) continue
    const timestampRaw = release.released_at || release.submitted_at || release.updated_at || release.created_at || null
    pushNotification(notifications, {
      id: `release:${release.id}:${status}`,
      category: 'ready_for_release',
      title: status === 'Released' ? 'Mobile release shipped' : 'Mobile release submitted',
      description: `${release.name || 'Mobile release'} is ${status.toLowerCase()}.`,
      entityType: 'release',
      actionLabel: 'Open Release',
      actionHref: '#/projects/linear/releases',
      relatedLabel: release.name || `Release #${release.id}`,
      timestampRaw,
      timestampMs: parseTime(timestampRaw),
    })
  }

  for (const deployment of deployments) {
    const status = String(deployment?.status || '')
    if (status !== 'Verified' && !deployment?.verified_at) continue
    const timestampRaw = deployment.verified_at || deployment.updated_at || deployment.created_at || null
    pushNotification(notifications, {
      id: `deployment:${deployment.id}:verified`,
      category: 'deployment_verified',
      title: 'Deployment verified',
      description: `${deployment.name || 'Deployment'} has been verified.`,
      entityType: 'deployment',
      actionLabel: 'Open Release',
      actionHref: '#/projects/linear/releases',
      relatedLabel: deployment.name || `Deployment #${deployment.id}`,
      timestampRaw,
      timestampMs: parseTime(timestampRaw),
    })
  }

  for (const event of githubAuditItems) {
    const timestampRaw = event?.createdAt || null
    const issueHrefValue = event?.taskId && event?.projectId
      ? `#/projects/linear?issueId=${encodeURIComponent(event.taskId)}&projectId=${encodeURIComponent(event.projectId)}`
      : '#/projects/linear/settings'
    pushNotification(notifications, {
      id: `github-audit:${event.id}`,
      category: 'github_update',
      title: event?.prStatus === 'merged' ? 'GitHub PR merged' : 'GitHub PR synced',
      description: event?.message || `${event?.repo || 'GitHub PR'} updated.`,
      entityType: 'issue',
      actionLabel: event?.taskId ? 'Open Issue' : 'Open Release',
      actionHref: issueHrefValue,
      actorName: event?.actorUserId ? `User #${event.actorUserId}` : null,
      relatedLabel: event?.projectName && event?.taskId
        ? projectLabel(projectsMap, event.projectId, event.taskId) || event.projectName
        : event?.repo || 'GitHub',
      timestampRaw,
      timestampMs: parseTime(timestampRaw),
    })
  }

  for (const audit of adminAuditItems) {
    const action = String(audit?.action || '')
    const timestampRaw = audit?.created_at || null
    if (action === 'linear_role_updated') {
      pushNotification(notifications, {
        id: `audit:${audit.id}`,
        category: 'role_changed',
        title: 'Workspace role changed',
        description: audit?.summary || 'A Linear workspace role was updated.',
        entityType: 'audit',
        actionLabel: 'Open Audit',
        actionHref: '#/projects/linear/audit',
        actorName: audit?.actor_name || null,
        relatedLabel: 'Permissions',
        timestampRaw,
        timestampMs: parseTime(timestampRaw),
      })
    } else if (action === 'status_changed' && audit?.entity_type === 'issue') {
      pushNotification(notifications, {
        id: `audit-status:${audit.id}`,
        category: 'status_changed',
        title: 'Issue status changed',
        description: audit?.summary || 'An issue status changed.',
        entityType: 'audit',
        actionLabel: 'Open Audit',
        actionHref: audit?.metadata?.projectId && audit?.entity_id
          ? `#/projects/linear?issueId=${encodeURIComponent(audit.entity_id)}&projectId=${encodeURIComponent(audit.metadata.projectId)}`
          : '#/projects/linear/audit',
        actorName: audit?.actor_name || null,
        relatedLabel: audit?.entity_id ? `Issue #${audit.entity_id}` : 'Issue',
        timestampRaw,
        timestampMs: parseTime(timestampRaw),
      })
    }
  }

  return Array.from(notifications.values()).sort((a, b) => b.timestampMs - a.timestampMs)
}

export function countUnreadNotifications(
  notifications: LinearNotification[],
  readIds: Iterable<string>,
  dismissedIds: Iterable<string>
) {
  const read = new Set(Array.from(readIds).map(String))
  const dismissed = new Set(Array.from(dismissedIds).map(String))
  return notifications.filter((item) => !read.has(item.id) && !dismissed.has(item.id)).length
}

function lineForIssue(issue: any, projectsMap: Record<string | number, any>) {
  const key = projectLabel(projectsMap, issue.projectId, issue.id) || `Issue #${issue.id}`
  return `${key}: ${issue.title || 'Untitled issue'}`
}

function makeSection(title: string, lines: string[]) {
  if (!lines.length) return []
  return [`## ${title}`, ...lines.map((line) => `- ${line}`), '']
}

function formatForOutput(text: string, mode: 'markdown' | 'whatsapp' | 'email') {
  if (mode === 'markdown') return text.trim()
  if (mode === 'email') {
    return `Subject: Life Smile Product Workspace Digest\n\n${text.replace(/^## /gm, '').replace(/^# /gm, '')}`.trim()
  }
  return text
    .replace(/^# /gm, '')
    .replace(/^## /gm, '')
    .replace(/\*\*/g, '')
    .trim()
}

export function buildDigestText(
  digestType: 'daily' | 'weekly' | 'release' | 'my_work' | 'management',
  mode: 'markdown' | 'whatsapp' | 'email',
  {
    user,
    issues = [],
    projectsMap = {},
    membersMap = {},
    mobileReleases = [],
    deployments = [],
    notifications = [],
  }: DigestContext
) {
  const me = currentUserId(user)
  const activeIssues = issues.filter((issue) => isActiveIssue(issue))
  const highPriority = activeIssues.filter((issue) => isHighPriority(issue))
  const ready = activeIssues.filter((issue) => ['Ready for Release', 'QA Approved'].includes(normalizeStatus(issue.status)))
  const blocked = activeIssues.filter((issue) => issue.blockedReason)
  const overdue = activeIssues.filter((issue) => issue.dueDate && dueIsPast(issue.dueDate))
  const completed = issues.filter((issue) => normalizeStatus(issue.status) === 'Done' && createdRecently(issue.completedAt || issue.updatedAt, 7))
  const mine = activeIssues.filter((issue) => me && String(issue.assigneeUserId || '') === me)
  const mineInReview = mine.filter((issue) => normalizeStatus(issue.status) === 'In Review')
  const workloadCounts = new Map<string, number>()

  for (const issue of activeIssues) {
    const assignee = issue.assigneeUserId == null ? 'unassigned' : String(issue.assigneeUserId)
    workloadCounts.set(assignee, (workloadCounts.get(assignee) || 0) + 1)
  }

  const overloaded = Array.from(workloadCounts.entries())
    .filter(([assignee, count]) => assignee !== 'unassigned' && count >= 6)
    .map(([assignee, count]) => `${memberName(membersMap, assignee) || `User #${assignee}`} has ${count} active issues`)

  const releasesPlanned = mobileReleases
    .filter((item) => ['Planning', 'Submitted', 'Released'].includes(String(item.status || '')))
    .slice(0, 5)
    .map((item) => `${item.name || `Release #${item.id}`} — ${item.status || 'Planning'}`)

  const deploymentsPlanned = deployments
    .filter((item) => ['Planning', 'Ready', 'Deploying', 'Verified'].includes(String(item.status || '')))
    .slice(0, 5)
    .map((item) => `${item.name || `Deployment #${item.id}`} — ${item.status || 'Planning'}`)

  const decisionsNeeded = [
    ...ready.filter((issue) => !issue.devMeta?.qaApproval?.approved).slice(0, 6).map((issue) =>
      `${lineForIssue(issue, projectsMap)} needs QA approval`
    ),
    ...highPriority.filter((issue) => !issue.assigneeUserId).slice(0, 4).map((issue) =>
      `${lineForIssue(issue, projectsMap)} needs an owner`
    ),
  ]

  const sections: string[] = []
  const titleMap = {
    daily: '# Daily Digest',
    weekly: '# Weekly Digest',
    release: '# Release Digest',
    my_work: '# My Work Digest',
    management: '# Management Digest',
  }
  sections.push(titleMap[digestType], '')

  if (digestType === 'daily') {
    sections.push(
      ...makeSection('High Priority Changes', highPriority.slice(0, 8).map((issue) => lineForIssue(issue, projectsMap))),
      ...makeSection('Ready for Release', ready.slice(0, 8).map((issue) => lineForIssue(issue, projectsMap))),
      ...makeSection('Blocked / Overdue', [...blocked, ...overdue].slice(0, 8).map((issue) => lineForIssue(issue, projectsMap))),
      ...makeSection('Releases / Deployments', [...releasesPlanned, ...deploymentsPlanned].slice(0, 8)),
      ...makeSection('Decisions Needed', decisionsNeeded.slice(0, 8))
    )
  } else if (digestType === 'weekly') {
    sections.push(
      ...makeSection('Completed', completed.slice(0, 10).map((issue) => lineForIssue(issue, projectsMap))),
      ...makeSection('Ready', ready.slice(0, 10).map((issue) => lineForIssue(issue, projectsMap))),
      ...makeSection('Blocked', blocked.slice(0, 10).map((issue) => lineForIssue(issue, projectsMap))),
      ...makeSection('Workload Risks', overloaded.slice(0, 8)),
      ...makeSection('Releases / Deployments Planned', [...releasesPlanned, ...deploymentsPlanned].slice(0, 10))
    )
  } else if (digestType === 'release') {
    sections.push(
      ...makeSection('Ready / Released Items', ready.slice(0, 12).map((issue) => lineForIssue(issue, projectsMap))),
      ...makeSection('QA Approval', ready.slice(0, 12).map((issue) =>
        `${lineForIssue(issue, projectsMap)} — ${issue.devMeta?.qaApproval?.approved ? 'QA approved' : 'QA pending'}`
      )),
      ...makeSection('PR Status', ready.slice(0, 12).map((issue) =>
        `${lineForIssue(issue, projectsMap)} — ${issue.devMeta?.prStatus || 'No PR status'}`
      )),
      ...makeSection('Deployment Status', deploymentsPlanned.slice(0, 10))
    )
  } else if (digestType === 'my_work') {
    sections.push(
      ...makeSection('Assigned Open Issues', mine.slice(0, 12).map((issue) => lineForIssue(issue, projectsMap))),
      ...makeSection('In Review', mineInReview.slice(0, 8).map((issue) => lineForIssue(issue, projectsMap))),
      ...makeSection('Overdue', mine.filter((issue) => issue.dueDate && dueIsPast(issue.dueDate)).slice(0, 8).map((issue) => lineForIssue(issue, projectsMap))),
      ...makeSection('Recent Updates', notifications.filter((item) => item.assigneeUserId != null && String(item.assigneeUserId) === me).slice(0, 8).map((item) => `${item.title}: ${item.description}`))
    )
  } else {
    sections.push(
      ...makeSection('Risks', [...blocked, ...overdue].slice(0, 10).map((issue) => lineForIssue(issue, projectsMap))),
      ...makeSection('Decisions Needed', decisionsNeeded.slice(0, 10)),
      ...makeSection('Overloaded Members', overloaded.slice(0, 10)),
      ...makeSection('Release Readiness', ready.slice(0, 10).map((issue) =>
        `${lineForIssue(issue, projectsMap)} — ${issue.devMeta?.qaApproval?.approved ? 'QA approved' : 'QA pending'}`
      )),
      ...makeSection('Unresolved High Priority', highPriority.slice(0, 10).map((issue) => lineForIssue(issue, projectsMap)))
    )
  }

  if (sections.length <= 2) {
    sections.push('No significant updates for the selected digest.')
  }

  return formatForOutput(sections.join('\n').trim(), mode)
}
