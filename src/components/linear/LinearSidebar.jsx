/**
 * LinearSidebar.jsx
 * Left navigation sidebar for the Linear-style issue tracker.
 * Product engineering workspace for Life Smile development teams.
 * Does NOT mention "Jira", "Sprint", "Task", or legacy ops team names.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import {
  Inbox, LayoutList, Map, LayoutDashboard, FileText, BookOpen,
  FolderOpen, RotateCcw, Tag, CheckCircle2, X, Plus,
  Globe, Smartphone, Server, PenTool, BarChart2,
  Bookmark, AlertCircle, AlertTriangle, Rocket, User, Bug, Users, Settings, History, Archive, ShieldAlert, Bell, Search,
} from 'lucide-react'
import { useAuth, hasPermission } from '../../contexts/AuthContext'
import { useTeamProjectsContext } from '../../contexts/TeamProjectsContext'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import {
  canAccessLinearSettings,
  canCreateDigestOutbox,
  canViewAudit,
  canExportWorkspace,
  canManageWorkspaceUsers,
} from '../../lib/linearPermissions'
import {
  LINEAR_NOTIFICATIONS_DISMISSED_KEY,
  LINEAR_NOTIFICATIONS_READ_KEY,
  buildIssueAttentionNotifications,
  countUnreadNotifications,
  readNotificationIdList,
} from '../../lib/linearNotifications'
import { DEFAULT_LABELS, labelColors } from './linearLabels'
import './LinearSidebar.css'

// Map string icon names (from savedViews.js) to Lucide components
const VIEW_ICON_MAP = {
  LayoutList,  User, Bug, AlertCircle, RotateCcw,
  Rocket, AlertTriangle, Smartphone, Server, Bookmark,
}

// ── Product engineering teams ─────────────────────────────────────────────────
// key prefix used for issue keys (WEB-12, AND-5, etc.)
const TEAMS = [
  { key: 'website',  label: 'Website',      prefix: 'WEB', Icon: Globe,       color: '#3b82f6' },
  { key: 'android',  label: 'Android App',  prefix: 'AND', Icon: Smartphone,  color: '#10b981' },
  { key: 'ios',      label: 'iOS App',      prefix: 'IOS', Icon: Smartphone,  color: '#6366f1' },
  { key: 'api',      label: 'Backend / API',prefix: 'API', Icon: Server,      color: '#f59e0b' },
  { key: 'ux',       label: 'UX/UI Design', prefix: 'UX',  Icon: PenTool,     color: '#ec4899' },
  { key: 'bi',       label: 'Data & BI',    prefix: 'BI',  Icon: BarChart2,   color: '#8b5cf6' },
]

function SidebarSection({ title, children }) {
  return (
    <div className="lsb-section">
      {title && <div className="lsb-section__title">{title}</div>}
      {children}
    </div>
  )
}

function SidebarLink({ to, Icon, label, badge, end = false, disabled = false }) {
  if (disabled) {
    return (
      <span className="lsb-link lsb-link--disabled">
        <Icon size={14} strokeWidth={1.8} className="lsb-link__icon" aria-hidden="true" />
        <span className="lsb-link__label">{label}</span>
        <span className="lsb-link__soon">Soon</span>
      </span>
    )
  }
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `lsb-link ${isActive ? 'lsb-link--active' : ''}`}
    >
      <Icon size={14} strokeWidth={1.8} className="lsb-link__icon" aria-hidden="true" />
      <span className="lsb-link__label">{label}</span>
      {badge != null && <span className="lsb-link__badge">{badge}</span>}
    </NavLink>
  )
}

export function LinearSidebar({
  projects = [],
  inboxCount = 0,
  activeLabel,
  onLabelFilter,
  cycles = [],
  activeCycle,
  onCycleFilter,
  onManageCycles,
  allViews = [],
  activeViewId,
  onApplyView,
  onDeleteView,
}) {
  const { user } = useAuth()
  const { getPref, prefsVersion } = useUserPreferences()
  const {
    projects: contextProjects,
    getTasksForProject,
    actions,
  } = useTeamProjectsContext()
  const navigate = useNavigate()
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [cyclesOpen, setCyclesOpen] = useState(false)
  const [viewsOpen,  setViewsOpen]  = useState(true) // open by default
  const fetchedRef = useRef(false)
  const canManagePlanner = hasPermission(user, 'planner', 'manage')
  const canOpenSettings = canAccessLinearSettings(user) || canManagePlanner
  const canOpenAudit = canViewAudit(user)
  const canOpenBackup = canExportWorkspace(user)
  const canOpenUsers = canManageWorkspaceUsers(user)
  const canOpenDigestOutbox = canCreateDigestOutbox(user)
  const sidebarProjects = projects.length > 0 ? projects : contextProjects

  useEffect(() => {
    if (fetchedRef.current) return
    fetchedRef.current = true
    actions.fetchProjects()
  }, [actions])

  useEffect(() => {
    if (!contextProjects.length) return
    contextProjects.forEach((project) => {
      actions.fetchTasks(project.id)
    })
  }, [contextProjects, actions])

  const notificationProjectsMap = useMemo(() => {
    const map = {}
    contextProjects.forEach((project) => {
      map[project.id] = project
    })
    return map
  }, [contextProjects])

  const notificationIssues = useMemo(
    () => contextProjects.flatMap((project) => getTasksForProject(project.id) || []),
    [contextProjects, getTasksForProject]
  )

  const readIds = useMemo(
    () => new Set(readNotificationIdList(getPref(LINEAR_NOTIFICATIONS_READ_KEY, []))),
    [getPref, prefsVersion]
  )

  const dismissedIds = useMemo(
    () => new Set(readNotificationIdList(getPref(LINEAR_NOTIFICATIONS_DISMISSED_KEY, []))),
    [getPref, prefsVersion]
  )

  const notificationsUnreadCount = useMemo(() => {
    const notificationItems = buildIssueAttentionNotifications({
      user,
      issues: notificationIssues,
      projectsMap: notificationProjectsMap,
      membersMap: {},
    })
    return countUnreadNotifications(notificationItems, readIds, dismissedIds)
  }, [user, notificationIssues, notificationProjectsMap, readIds, dismissedIds])

  const workspaceLinks = [
    { to: '/projects/linear/dashboard',       Icon: LayoutDashboard, label: 'Dashboard'     },
    { to: '/projects/linear/search',          Icon: Search,          label: 'Search'        },
    { to: '/projects/linear/notifications',   Icon: Bell,            label: 'Notifications', badge: notificationsUnreadCount || null },
    { to: '/projects/linear/notifications/settings', Icon: Settings, label: 'Notification Settings' },
    ...(canOpenDigestOutbox ? [{ to: '/projects/linear/notifications/outbox', Icon: Archive, label: 'Digest Outbox' }] : []),
    { to: '/projects/linear/reports/weekly',  Icon: FileText,        label: 'Weekly Report' },
    { to: '/projects/linear/docs',            Icon: BookOpen,        label: 'Docs'          },
    { to: '/projects/linear/projects',        Icon: FolderOpen,      label: 'Projects'      },
    { to: '/projects/linear/team',            Icon: Users,           label: 'Team'          },
    { to: '/projects/linear/workload',        Icon: BarChart2,       label: 'Workload'      },
    { to: '/projects/linear/releases',        Icon: Rocket,          label: 'Releases'      },
    { to: '/projects/linear/launch',          Icon: CheckCircle2,    label: 'Launch Control' },
    { to: '/projects/linear/launch/history',  Icon: History,         label: 'Launch History' },
  ]

  const customViews = allViews.filter((v) => !v.builtin)

  return (
    <aside className="lsb" aria-label="Issue tracker navigation">
      <div className="lsb-logo">
        <span className="lsb-logo__mark">LS</span>
        <span className="lsb-logo__name">Life Smile Dev</span>
      </div>

      <SidebarSection>
        <SidebarLink to="/projects/linear" Icon={LayoutList} label="Issues" end />
        <SidebarLink to="/projects/linear/inbox" Icon={Inbox} label="Inbox" badge={inboxCount || null} />

        {/* Views toggle */}
        <button
          type="button"
          className={`lsb-link lsb-link--btn ${viewsOpen ? 'lsb-link--active' : ''}`}
          onClick={() => setViewsOpen((v) => !v)}
          aria-expanded={viewsOpen}
        >
          <Map size={14} strokeWidth={1.8} className="lsb-link__icon" aria-hidden="true" />
          <span className="lsb-link__label">Views</span>
          {customViews.length > 0 && (
            <span className="lsb-link__badge">{customViews.length}</span>
          )}
        </button>

        {viewsOpen && (
          <div className="lsb-labels lsb-views">
            {allViews.map((view) => {
              const Icon = VIEW_ICON_MAP[view.icon] || Bookmark
              const isActive = activeViewId === view.id
              return (
                <div
                  key={view.id}
                  className={`lsb-view-row ${isActive ? 'lsb-view-row--active' : ''}`}
                >
                  <button
                    type="button"
                    className="lsb-view-btn"
                    onClick={() => onApplyView?.(view)}
                    title={view.label}
                  >
                    <Icon size={11} strokeWidth={2} className="lsb-view-icon" aria-hidden="true" />
                    <span className="lsb-label-name">{view.label}</span>
                  </button>
                  {!view.builtin && (
                    <button
                      type="button"
                      className="lsb-view-delete"
                      onClick={(e) => { e.stopPropagation(); onDeleteView?.(view.id) }}
                      aria-label={`Delete view ${view.label}`}
                      title="Delete view"
                    >
                      <X size={9} strokeWidth={2.5} aria-hidden="true" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <SidebarLink to="/projects/linear/roadmap" Icon={Map} label="Roadmap" />
      </SidebarSection>

      <SidebarSection title="Teams">
        {TEAMS.map(({ key, label, Icon, color }) => (
          <NavLink
            key={key}
            to="/projects/linear/team"
            className={() => 'lsb-link'}
          >
            <Icon size={14} strokeWidth={1.8} className="lsb-link__icon" style={{ color }} aria-hidden="true" />
            <span className="lsb-link__label">{label}</span>
          </NavLink>
        ))}
      </SidebarSection>

      <SidebarSection title="Workspace">
        {/* Cycles — interactive toggle */}
        <button
          type="button"
          className={`lsb-link lsb-link--btn ${cyclesOpen ? 'lsb-link--active' : ''}`}
          onClick={() => setCyclesOpen((v) => !v)}
          aria-expanded={cyclesOpen}
        >
          <RotateCcw size={14} strokeWidth={1.8} className="lsb-link__icon" aria-hidden="true" />
          <span className="lsb-link__label">Cycles</span>
          {activeCycle != null && activeCycle !== 'none' && (
            <span className="lsb-link__badge lsb-link__badge--accent">1</span>
          )}
        </button>

        {cyclesOpen && (
          <div className="lsb-labels">
            {/* Clear filter */}
            {activeCycle != null && (
              <button
                type="button"
                className="lsb-label-item lsb-label-item--clear"
                onClick={() => onCycleFilter?.(null)}
              >
                <X size={10} strokeWidth={2.5} aria-hidden="true" />
                Clear filter
              </button>
            )}

            {/* No Cycle */}
            <button
              type="button"
              className={`lsb-label-item ${activeCycle === 'none' ? 'lsb-label-item--active' : ''}`}
              onClick={() => onCycleFilter?.(activeCycle === 'none' ? null : 'none')}
            >
              <span className="lsb-label-dot" style={{ background: '#6b7280' }} />
              <span className="lsb-label-name">No Cycle</span>
            </button>

            {/* Cycle entries */}
            {cycles.map((c) => {
              const statusColor = c.status === 'active' ? '#6ee7b7' : c.status === 'completed' ? '#9ca3af' : '#a5b4fc'
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`lsb-label-item ${activeCycle === c.id ? 'lsb-label-item--active' : ''}`}
                  onClick={() => onCycleFilter?.(activeCycle === c.id ? null : c.id)}
                >
                  <span className="lsb-label-dot" style={{ background: statusColor }} />
                  <span className="lsb-label-name">{c.name}</span>
                </button>
              )
            })}

            {/* Manage cycles button */}
            {canManagePlanner && (
              <button
                type="button"
                className="lsb-label-item lsb-cycles-manage"
                onClick={onManageCycles}
              >
                <Plus size={10} strokeWidth={2.5} aria-hidden="true" />
                <span className="lsb-label-name">Manage Cycles</span>
              </button>
            )}
          </div>
        )}

        {/* Labels — interactive toggle */}
        <button
          type="button"
          className={`lsb-link lsb-link--btn ${labelsOpen ? 'lsb-link--active' : ''}`}
          onClick={() => setLabelsOpen((v) => !v)}
          aria-expanded={labelsOpen}
        >
          <Tag size={14} strokeWidth={1.8} className="lsb-link__icon" aria-hidden="true" />
          <span className="lsb-link__label">Labels</span>
          {activeLabel && <span className="lsb-link__badge lsb-link__badge--accent">1</span>}
        </button>

        {labelsOpen && (
          <div className="lsb-labels">
            {activeLabel && (
              <button
                type="button"
                className="lsb-label-item lsb-label-item--clear"
                onClick={() => onLabelFilter?.(null)}
              >
                <X size={10} strokeWidth={2.5} aria-hidden="true" />
                Clear filter
              </button>
            )}
            {DEFAULT_LABELS.map((lbl) => {
              const c = labelColors(lbl)
              const isActive = activeLabel === lbl
              return (
                <button
                  key={lbl}
                  type="button"
                  className={`lsb-label-item ${isActive ? 'lsb-label-item--active' : ''}`}
                  onClick={() => onLabelFilter?.(isActive ? null : lbl)}
                >
                  <span className="lsb-label-dot" style={{ background: c.text }} />
                  <span className="lsb-label-name">{lbl}</span>
                </button>
              )
            })}
          </div>
        )}

        {workspaceLinks.map(({ to, Icon, label, disabled, badge }) => (
          <SidebarLink key={to} to={to} Icon={Icon} label={label} badge={badge} disabled={!!disabled} />
        ))}
      </SidebarSection>

      {sidebarProjects.length > 0 && (
        <SidebarSection title="Projects">
          {sidebarProjects.slice(0, 8).map((p) => (
            <button
              key={p.id}
              type="button"
              className="lsb-link"
              onClick={() => navigate('/projects/linear', { state: { filterProjectId: p.id } })}
              title={`Open ${p.name} issues`}
            >
              <span
                className="lsb-proj-dot"
                style={{ background: p.color || '#8b5cf6' }}
                aria-hidden="true"
              />
              <span className="lsb-link__label">{p.name}</span>
            </button>
          ))}
        </SidebarSection>
      )}

      {(canOpenSettings || canOpenAudit || canOpenBackup || canOpenUsers) && (
        <SidebarSection title="Settings / Admin">
          {canOpenSettings && (
            <SidebarLink to="/projects/linear/settings" Icon={Settings} label="Settings" />
          )}
          {canOpenUsers && (
            <>
              <SidebarLink to="/projects/linear/admin/users" Icon={Users} label="Users & Roles" />
              <SidebarLink to="/projects/linear/admin/permissions" Icon={ShieldAlert} label="Permissions Audit" />
            </>
          )}
          {canOpenAudit && (
            <>
              <SidebarLink to="/projects/linear/smoke-tests" Icon={CheckCircle2} label="Smoke Tests" />
              <SidebarLink to="/projects/linear/health" Icon={AlertCircle} label="Health" />
              <SidebarLink to="/projects/linear/audit" Icon={History} label="Audit Log" />
            </>
          )}
          {canOpenBackup && (
            <>
              <SidebarLink to="/projects/linear/admin/backup" Icon={Archive} label="Backup & Export" />
            </>
          )}
        </SidebarSection>
      )}
    </aside>
  )
}

export { TEAMS }
export default LinearSidebar
