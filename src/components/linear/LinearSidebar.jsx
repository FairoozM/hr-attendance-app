/**
 * LinearSidebar.jsx
 * Left navigation sidebar for the Linear-style issue tracker.
 * Does NOT mention "Jira", "Sprint", or "Task" anywhere.
 */
import { NavLink, useLocation } from 'react-router-dom'
import {
  Inbox, User, LayoutList, Map,
  FolderOpen, RotateCcw, Tag, CheckCircle2,
  Globe, Smartphone, Package, Wallet,
  ChevronRight,
} from 'lucide-react'
import './LinearSidebar.css'

const MAIN_NAV = [
  { to: '/projects/linear',          Icon: LayoutList,   label: 'My Issues'   },
  { to: '/projects/linear/inbox',    Icon: Inbox,        label: 'Inbox',     badge: null },
  { to: '/projects/linear/views',    Icon: LayoutList,   label: 'Views'      },
  { to: '/projects/linear/roadmap',  Icon: Map,          label: 'Roadmap'    },
]

// Team entries with icons — reflect Life Smile team structure
const TEAMS = [
  { key: 'website', label: 'Website', Icon: Globe,      color: '#3b82f6' },
  { key: 'app',     label: 'Mobile App', Icon: Smartphone, color: '#10b981' },
  { key: 'ops',     label: 'Operations', Icon: Package,  color: '#f59e0b' },
  { key: 'finance', label: 'Finance',    Icon: Wallet,   color: '#8b5cf6' },
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
    { to: '/projects/linear/projects', Icon: FolderOpen, label: 'Projects' },
    { to: '/projects/linear/cycles',   Icon: RotateCcw,  label: 'Cycles', disabled: true  },
    { to: '/projects/linear/labels',   Icon: Tag,        label: 'Labels',  disabled: true  },
    { to: '/projects/linear/completed',Icon: CheckCircle2,label: 'Completed', disabled: true },
  ]

  return (
    <aside className="lsb" aria-label="Issue tracker navigation">
      <div className="lsb-logo">
        <span className="lsb-logo__mark">LS</span>
        <span className="lsb-logo__name">Life Smile Issues</span>
      </div>

      <SidebarSection>
        <SidebarLink to="/projects/linear" Icon={LayoutList} label="My Issues" end />
        <SidebarLink to="/projects/linear/inbox"   Icon={Inbox}  label="Inbox"   badge={inboxCount || null} disabled />
        <SidebarLink to="/projects/linear/views"   Icon={LayoutList} label="Views"    disabled />
        <SidebarLink to="/projects/linear/roadmap" Icon={Map}    label="Roadmap"  disabled />
      </SidebarSection>

      <SidebarSection title="Teams">
        {TEAMS.map(({ key, label, Icon, color }) => (
          <SidebarLink
            key={key}
            to={`/projects/linear`}
            Icon={Icon}
            label={label}
          />
        ))}
      </SidebarSection>

      <SidebarSection title="Workspace">
        {workspaceLinks.map(({ to, Icon, label, disabled }) => (
          <SidebarLink key={to} to={to} Icon={Icon} label={label} disabled={!!disabled} />
        ))}
      </SidebarSection>

      {projects.length > 0 && (
        <SidebarSection title="Projects">
          {projects.slice(0, 6).map((p) => (
            <NavLink
              key={p.id}
              to={`/projects/linear`}
              className={({ isActive }) => `lsb-link ${isActive ? 'lsb-link--active' : ''}`}
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

export default LinearSidebar
