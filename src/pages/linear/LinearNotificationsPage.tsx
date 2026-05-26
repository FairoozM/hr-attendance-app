import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Archive, Bell, EyeOff, Filter, Loader2, Mail, MessageSquareText, Settings2 } from 'lucide-react'
import { LinearSidebar } from '../../components/linear/LinearSidebar'
import NotificationItem from '../../components/linear/NotificationItem'
import DigestBuilder from '../../components/linear/DigestBuilder'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import { useAuth } from '../../contexts/AuthContext'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import {
  LINEAR_NOTIFICATIONS_DISMISSED_KEY,
  LINEAR_NOTIFICATIONS_READ_KEY,
  buildDigestText,
  buildWorkspaceNotifications,
  countUnreadNotifications,
  readNotificationIdList,
} from '../../lib/linearNotifications'
import {
  listDeploymentsApi,
  listIntakeApi,
  listMobileReleasesApi,
  listAuditLogApi,
} from '../../lib/linearWorkspaceApi'
import { getGithubAuditLog } from '../../lib/projectsApi'
import { canCreateDigestOutbox, canManageGitHub, canManageWorkspaceUsers } from '../../lib/linearPermissions'
import './LinearNotificationsPage.css'

type DateRange = 'all' | '24h' | '7d' | '30d'

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const area = document.createElement('textarea')
      area.value = text
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      document.body.removeChild(area)
      return true
    } catch {
      return false
    }
  }
}

function useStoredIdSet(rawValue: unknown) {
  return useMemo(() => new Set(readNotificationIdList(rawValue)), [rawValue])
}

function safeArray<T>(value: T[] | null | undefined) {
  return Array.isArray(value) ? value : []
}

function matchesDateRange(timestampMs: number, range: DateRange) {
  if (range === 'all') return true
  if (!timestampMs) return false
  const limits = {
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000,
  }
  return Date.now() - timestampMs <= limits[range]
}

function summaryCount(label: string, value: number) {
  return (
    <div className="lnp-stat" key={label}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

export default function LinearNotificationsPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { getPref, setPref, prefsVersion } = useUserPreferences()
  const {
    projects,
    members,
    getTasksForProject,
    actions,
    loadingProjects,
    loadingTasks,
    error,
  } = useTeamProjectsContext()

  const [loadingExtra, setLoadingExtra] = useState(false)
  const [extraError, setExtraError] = useState('')
  const [mobileReleases, setMobileReleases] = useState<any[]>([])
  const [deployments, setDeployments] = useState<any[]>([])
  const [intakeItems, setIntakeItems] = useState<any[]>([])
  const [githubAuditItems, setGithubAuditItems] = useState<any[]>([])
  const [adminAuditItems, setAdminAuditItems] = useState<any[]>([])

  const [categoryFilter, setCategoryFilter] = useState('all')
  const [projectFilter, setProjectFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [dateRange, setDateRange] = useState<DateRange>('7d')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [showDismissed, setShowDismissed] = useState(false)
  const [externalSaveRequest, setExternalSaveRequest] = useState<{
    key: string
    digestType?: 'daily' | 'weekly' | 'release' | 'my_work' | 'management'
  } | null>(null)

  const fetchedRef = useRef(false)
  const commandHandledRef = useRef('')

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    actions.fetchProjects()
    actions.fetchMembers()
  }, [actions])

  useEffect(() => {
    if (!projects.length) return
    projects.forEach((project) => {
      actions.fetchTasks(project.id)
    })
  }, [projects, actions])

  useEffect(() => {
    let cancelled = false
    const loadExtra = async () => {
      setLoadingExtra(true)
      setExtraError('')
      try {
        const requests: Promise<any>[] = [
          listIntakeApi(),
          listMobileReleasesApi(),
          listDeploymentsApi(),
        ]
        if (canManageGitHub(user)) requests.push(getGithubAuditLog({ limit: 40 }))
        if (canManageWorkspaceUsers(user)) requests.push(listAuditLogApi({ limit: 80 }))
        const results = await Promise.all(requests)
        if (cancelled) return

        setIntakeItems(safeArray(results[0]))
        setMobileReleases(safeArray(results[1]))
        setDeployments(safeArray(results[2]))

        let nextIndex = 3
        if (canManageGitHub(user)) {
          setGithubAuditItems(safeArray(results[nextIndex]))
          nextIndex += 1
        } else {
          setGithubAuditItems([])
        }

        if (canManageWorkspaceUsers(user)) {
          setAdminAuditItems(safeArray(results[nextIndex]))
        } else {
          setAdminAuditItems([])
        }
      } catch (loadError: any) {
        if (!cancelled) setExtraError(loadError?.message || 'Failed to load notifications data')
      } finally {
        if (!cancelled) setLoadingExtra(false)
      }
    }
    loadExtra()
    return () => {
      cancelled = true
    }
  }, [user])

  const projectsMap = useMemo(() => {
    const map: Record<string | number, any> = {}
    projects.forEach((project) => {
      map[project.id] = project
    })
    return map
  }, [projects])

  const membersMap = useMemo(() => {
    const map: Record<string | number, any> = {}
    members.forEach((member) => {
      map[String(member.id)] = member
      map[member.id] = member
    })
    return map
  }, [members])

  const issues = useMemo(
    () => projects.flatMap((project) => getTasksForProject(project.id) || []),
    [projects, getTasksForProject]
  )

  const readIds = useStoredIdSet(getPref(LINEAR_NOTIFICATIONS_READ_KEY, []))
  const dismissedIds = useStoredIdSet(getPref(LINEAR_NOTIFICATIONS_DISMISSED_KEY, []))

  const notifications = useMemo(
    () => buildWorkspaceNotifications({
      user,
      issues,
      projectsMap,
      membersMap,
      mobileReleases,
      deployments,
      intakeItems,
      githubAuditItems,
      adminAuditItems,
    }),
    [user, issues, projectsMap, membersMap, mobileReleases, deployments, intakeItems, githubAuditItems, adminAuditItems]
  )

  const unreadCount = useMemo(
    () => countUnreadNotifications(notifications, readIds, dismissedIds),
    [notifications, readIds, dismissedIds, prefsVersion]
  )

  const filteredNotifications = useMemo(() => {
    return notifications.filter((notification) => {
      const dismissed = dismissedIds.has(notification.id)
      const read = readIds.has(notification.id)

      if (!showDismissed && dismissed) return false
      if (unreadOnly && read) return false
      if (categoryFilter !== 'all' && notification.category !== categoryFilter) return false
      if (projectFilter !== 'all' && String(notification.projectId || '') !== projectFilter) return false
      if (assigneeFilter !== 'all' && String(notification.assigneeUserId || '') !== assigneeFilter) return false
      if (priorityFilter !== 'all' && String(notification.priority || '') !== priorityFilter) return false
      if (!matchesDateRange(notification.timestampMs, dateRange)) return false
      return true
    })
  }, [notifications, dismissedIds, readIds, showDismissed, unreadOnly, categoryFilter, projectFilter, assigneeFilter, priorityFilter, dateRange])

  const activeNotifications = useMemo(
    () => filteredNotifications.filter((notification) => !dismissedIds.has(notification.id)),
    [filteredNotifications, dismissedIds]
  )

  const dismissedNotifications = useMemo(
    () => filteredNotifications.filter((notification) => dismissedIds.has(notification.id)),
    [filteredNotifications, dismissedIds]
  )

  const updateIdSet = useCallback((key: string, updater: (current: Set<string>) => Set<string>) => {
    const current = new Set(readNotificationIdList(getPref(key, [])))
    const next = updater(current)
    setPref(key, Array.from(next))
  }, [getPref, setPref])

  const markAllRead = useCallback((items = notifications) => {
    updateIdSet(LINEAR_NOTIFICATIONS_READ_KEY, (current) => {
      const next = new Set(current)
      items.forEach((item) => next.add(item.id))
      return next
    })
  }, [notifications, updateIdSet])

  const handleToggleRead = useCallback((notification: any, nextRead: boolean) => {
    updateIdSet(LINEAR_NOTIFICATIONS_READ_KEY, (current) => {
      const next = new Set(current)
      if (nextRead) next.add(notification.id)
      else next.delete(notification.id)
      return next
    })
  }, [updateIdSet])

  const handleToggleDismissed = useCallback((notification: any, nextDismissed: boolean) => {
    updateIdSet(LINEAR_NOTIFICATIONS_DISMISSED_KEY, (current) => {
      const next = new Set(current)
      if (nextDismissed) next.add(notification.id)
      else next.delete(notification.id)
      return next
    })
  }, [updateIdSet])

  const handleOpen = useCallback((notification: any) => {
    handleToggleRead(notification, true)
    window.location.hash = notification.actionHref
  }, [handleToggleRead])

  const digestContext = useMemo(() => ({
    user,
    issues,
    projectsMap,
    membersMap,
    mobileReleases,
    deployments,
    notifications,
  }), [user, issues, projectsMap, membersMap, mobileReleases, deployments, notifications])

  useEffect(() => {
    if (!notifications.length) return
    if (!location.search) return
    if (commandHandledRef.current === location.search) return

    const params = new URLSearchParams(location.search)
    const action = params.get('action')
    const digest = params.get('digest')
    const copyMode = params.get('copy')

    const runCommand = async () => {
      if (action === 'mark-all-read') {
        markAllRead(notifications.filter((item) => !dismissedIds.has(item.id)))
      } else if (action === 'save-digest') {
        const digestType = ['daily', 'weekly', 'release', 'my_work', 'management'].includes(digest || '')
          ? (digest as 'daily' | 'weekly' | 'release' | 'my_work' | 'management')
          : 'daily'
        setExternalSaveRequest({ key: `${location.search}:${Date.now()}`, digestType })
      } else if (digest && (copyMode === 'markdown' || copyMode === 'whatsapp' || copyMode === 'email')) {
        const digestType = ['daily', 'weekly', 'release', 'my_work', 'management'].includes(digest)
          ? (digest as 'daily' | 'weekly' | 'release' | 'my_work' | 'management')
          : 'daily'
        const text = buildDigestText(digestType, copyMode, digestContext)
        await copyText(text)
      } else {
        return
      }

      commandHandledRef.current = location.search
      navigate('/projects/linear/notifications', { replace: true })
    }

    runCommand()
  }, [location.search, notifications, dismissedIds, digestContext, markAllRead, navigate])

  const categoryOptions = useMemo(() => {
    const set = new Set(notifications.map((item) => item.category))
    return ['all', ...Array.from(set)]
  }, [notifications])

  const projectOptions = useMemo(() => ['all', ...projects.map((project) => String(project.id))], [projects])

  const assigneeOptions = useMemo(
    () => ['all', ...members.map((member) => String(member.id))],
    [members]
  )

  const priorityOptions = useMemo(() => {
    const set = new Set(notifications.map((item) => item.priority).filter(Boolean))
    return ['all', ...Array.from(set)] as string[]
  }, [notifications])

  const stats = [
    summaryCount('Unread', unreadCount),
    summaryCount('Visible', activeNotifications.length),
    summaryCount('Dismissed', dismissedNotifications.length),
    summaryCount('Total', notifications.length),
  ]

  const loadingAny = loadingProjects || loadingExtra || Object.values(loadingTasks || {}).some(Boolean)

  return (
    <div className="lnp-shell">
      <LinearSidebar />

      <main className="lnp-page">
        <header className="lnp-header">
          <div>
            <div className="lnp-header__eyebrow">
              <Bell size={16} />
              Notifications
            </div>
            <h1>Notifications Center</h1>
            <p>Track product workspace updates and generate copy-ready daily or weekly digests.</p>
          </div>

          <div className="lnp-header__actions">
            {canCreateDigestOutbox(user) && (
              <button type="button" className="lnp-btn" onClick={() => navigate('/projects/linear/notifications/outbox')}>
                <Archive size={14} />
                Digest Outbox
              </button>
            )}
            <button type="button" className="lnp-btn" onClick={() => navigate('/projects/linear/notifications/settings')}>
              <Settings2 size={14} />
              Notification Settings
            </button>
            <button type="button" className="lnp-btn lnp-btn--primary" onClick={() => markAllRead(activeNotifications)}>
              Mark all read
            </button>
            <button type="button" className="lnp-btn" onClick={() => setShowDismissed((value) => !value)}>
              <EyeOff size={14} />
              {showDismissed ? 'Hide dismissed' : 'Show dismissed'}
            </button>
          </div>
        </header>

        <section className="lnp-stats">{stats}</section>

        <section className="lnp-filters">
          <div className="lnp-section__header">
            <div>
              <h2><Filter size={16} /> Filters</h2>
              <p>Refine notifications by category, owner, priority, or recent activity window.</p>
            </div>
          </div>

          <div className="lnp-filters__grid">
            <label>
              <span>Category</span>
              <select className="lnp-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                {categoryOptions.map((option) => (
                  <option key={option} value={option}>{option === 'all' ? 'All categories' : option.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Project</span>
              <select className="lnp-select" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}>
                <option value="all">All projects</option>
                {projectOptions.filter((option) => option !== 'all').map((option) => (
                  <option key={option} value={option}>{projectsMap[option]?.name || `Project #${option}`}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Assignee</span>
              <select className="lnp-select" value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}>
                <option value="all">All assignees</option>
                {assigneeOptions.filter((option) => option !== 'all').map((option) => (
                  <option key={option} value={option}>{membersMap[option]?.displayName || membersMap[option]?.username || `User #${option}`}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Priority</span>
              <select className="lnp-select" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}>
                {priorityOptions.map((option) => (
                  <option key={option} value={option}>{option === 'all' ? 'All priorities' : option}</option>
                ))}
              </select>
            </label>

            <label>
              <span>Date range</span>
              <select className="lnp-select" value={dateRange} onChange={(event) => setDateRange(event.target.value as DateRange)}>
                <option value="all">All time</option>
                <option value="24h">Last 24 hours</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
              </select>
            </label>

            <label className="lnp-checkbox">
              <input type="checkbox" checked={unreadOnly} onChange={(event) => setUnreadOnly(event.target.checked)} />
              <span>Unread only</span>
            </label>
          </div>
        </section>

        <div className="lnp-layout">
          <section className="lnp-list">
            <div className="lnp-section__header">
              <div>
                <h2>Workspace Updates</h2>
                <p>Only notifications derived from data you can already access are shown here.</p>
              </div>
              <div className="lnp-list__shortcuts">
                <button type="button" className="lnp-btn" onClick={() => copyText(buildDigestText('daily', 'whatsapp', digestContext))}>
                  <MessageSquareText size={14} />
                  Copy Daily WhatsApp
                </button>
                <button type="button" className="lnp-btn" onClick={() => copyText(buildDigestText('weekly', 'email', digestContext))}>
                  <Mail size={14} />
                  Copy Weekly Email
                </button>
              </div>
            </div>

            {loadingAny && (
              <div className="lnp-empty">
                <Loader2 size={16} className="lnp-spin" />
                <span>Loading notifications…</span>
              </div>
            )}

            {(error || extraError) && !loadingAny && (
              <div className="lnp-empty lnp-empty--error">
                {error || extraError}
              </div>
            )}

            {!loadingAny && !error && !extraError && filteredNotifications.length === 0 && (
              <div className="lnp-empty">
                No notifications match the current filters.
              </div>
            )}

            {!loadingAny && !error && !extraError && filteredNotifications.length > 0 && (
              <div className="lnp-items">
                {activeNotifications.map((notification) => (
                  <NotificationItem
                    key={notification.id}
                    notification={notification}
                    read={readIds.has(notification.id)}
                    dismissed={false}
                    onOpen={handleOpen}
                    onToggleRead={handleToggleRead}
                    onToggleDismissed={handleToggleDismissed}
                  />
                ))}

                {showDismissed && dismissedNotifications.length > 0 && (
                  <>
                    <div className="lnp-subheading">Dismissed</div>
                    {dismissedNotifications.map((notification) => (
                      <NotificationItem
                        key={notification.id}
                        notification={notification}
                        read={readIds.has(notification.id)}
                        dismissed
                        onOpen={handleOpen}
                        onToggleRead={handleToggleRead}
                        onToggleDismissed={handleToggleDismissed}
                      />
                    ))}
                  </>
                )}
              </div>
            )}
          </section>

          <DigestBuilder
            digestContext={digestContext}
            initialType="daily"
            enableOutboxSave={canCreateDigestOutbox(user)}
            externalSaveRequest={externalSaveRequest}
          />
        </div>
      </main>
    </div>
  )
}
