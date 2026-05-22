/**
 * LinearSidebar.jsx
 * Left navigation sidebar for the Linear-style issue tracker.
 * Product engineering workspace for Life Smile development teams.
 * Does NOT mention "Jira", "Sprint", "Task", or legacy ops team names.
 */
import { NavLink } from 'react-router-dom'
import {
  Inbox, LayoutList, Map,
  FolderOpen, RotateCcw, Tag, CheckCircle2,
  Globe, Smartphone, Server, PenTool, BarChart2, Apple,
} from 'lucide-react'
import './LinearSidebar.css'

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

export function LinearSidebar({ projects = [], inboxCount = 0 }) {
  const workspaceLinks = [
    { to: '/projects/linear/projects',  Icon: FolderOpen,   label: 'Projects'  },
    { to: '/projects/linear/cycles',    Icon: RotateCcw,    label: 'Cycles',    disabled: true },
    { to: '/projects/linear/labels',    Icon: Tag,          label: 'Labels',    disabled: true },
    { to: '/projects/linear/completed', Icon: CheckCircle2, label: 'Completed', disabled: true },
  ]

  return (
    <aside className="lsb" aria-label="Issue tracker navigation">
      <div className="lsb-logo">
        <span className="lsb-logo__mark">LS</span>
        <span className="lsb-logo__name">Life Smile Dev</span>
      </div>

      <SidebarSection>
        <SidebarLink to="/projects/linear" Icon={LayoutList} label="Issues" end />
        <SidebarLink to="/projects/linear/inbox"   Icon={Inbox} label="Inbox"   badge={inboxCount || null} disabled />
        <SidebarLink to="/projects/linear/views"   Icon={LayoutList} label="Views"   disabled />
        <SidebarLink to="/projects/linear/roadmap" Icon={Map}   label="Roadmap" disabled />
      </SidebarSection>

      <SidebarSection title="Teams">
        {TEAMS.map(({ key, label, Icon, color }) => (
          <NavLink
            key={key}
            to="/projects/linear"
            className={({ isActive }) => `lsb-link`}
          >
            <Icon size={14} strokeWidth={1.8} className="lsb-link__icon" style={{ color }} aria-hidden="true" />
            <span className="lsb-link__label">{label}</span>
          </NavLink>
        ))}
      </SidebarSection>

      <SidebarSection title="Workspace">
        {workspaceLinks.map(({ to, Icon, label, disabled }) => (
          <SidebarLink key={to} to={to} Icon={Icon} label={label} disabled={!!disabled} />
        ))}
      </SidebarSection>

      {projects.length > 0 && (
        <SidebarSection title="Projects">
          {projects.slice(0, 8).map((p) => (
            <NavLink
              key={p.id}
              to="/projects/linear"
              className={() => 'lsb-link'}
            >
              <span
                className="lsb-proj-dot"
                style={{ background: p.color || '#8b5cf6' }}
                aria-hidden="true"
              />
              <span className="lsb-link__label">{p.name}</span>
            </NavLink>
          ))}
        </SidebarSection>
      )}
    </aside>
  )
}

export { TEAMS }
export default LinearSidebar
