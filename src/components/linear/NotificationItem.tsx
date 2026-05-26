import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  ClipboardList,
  GitBranch,
  Rocket,
  ShieldCheck,
  User,
  XCircle,
} from 'lucide-react'
import type { LinearNotification } from '../../lib/linearNotifications'

type Props = {
  notification: LinearNotification
  read: boolean
  dismissed: boolean
  onOpen: (notification: LinearNotification) => void
  onToggleRead: (notification: LinearNotification, nextRead: boolean) => void
  onToggleDismissed: (notification: LinearNotification, nextDismissed: boolean) => void
}

function categoryIcon(category: LinearNotification['category']) {
  if (category === 'assigned') return User
  if (category === 'status_changed') return Bell
  if (category === 'ready_for_release') return Rocket
  if (category === 'qa_approved') return ShieldCheck
  if (category === 'deployment_verified') return CheckCircle2
  if (category === 'github_update') return GitBranch
  if (category === 'high_priority') return AlertTriangle
  if (category === 'overdue') return XCircle
  if (category === 'intake_converted') return ClipboardList
  if (category === 'checklist_incomplete') return ClipboardList
  return ShieldCheck
}

function categoryLabel(category: LinearNotification['category']) {
  return String(category).replace(/_/g, ' ')
}

function formatTimestamp(value?: string | null) {
  if (!value) return 'Unknown time'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('en-AE', { dateStyle: 'medium', timeStyle: 'short' })
}

export default function NotificationItem({
  notification,
  read,
  dismissed,
  onOpen,
  onToggleRead,
  onToggleDismissed,
}: Props) {
  const Icon = categoryIcon(notification.category)

  return (
    <article className={`lnp-item ${read ? 'lnp-item--read' : 'lnp-item--unread'} ${dismissed ? 'lnp-item--dismissed' : ''}`}>
      <div className="lnp-item__icon">
        <Icon size={16} />
      </div>

      <div className="lnp-item__content">
        <div className="lnp-item__top">
          <div>
            <h3>{notification.title}</h3>
            <p>{notification.description}</p>
          </div>

          <div className="lnp-item__badges">
            <span className="lnp-badge lnp-badge--category">{categoryLabel(notification.category)}</span>
            {notification.priority && (
              <span className={`lnp-badge lnp-badge--priority lnp-badge--priority-${String(notification.priority).toLowerCase().replace(/\s+/g, '-')}`}>
                {notification.priority}
              </span>
            )}
          </div>
        </div>

        <div className="lnp-item__meta">
          {notification.relatedLabel && <span>{notification.relatedLabel}</span>}
          {notification.actorName && <span>{notification.actorName}</span>}
          <time dateTime={notification.timestampRaw || undefined}>{formatTimestamp(notification.timestampRaw)}</time>
        </div>

        <div className="lnp-item__actions">
          <button type="button" className="lnp-btn lnp-btn--primary" onClick={() => onOpen(notification)}>
            {notification.actionLabel}
          </button>
          <button type="button" className="lnp-btn" onClick={() => onToggleRead(notification, !read)}>
            {read ? 'Mark unread' : 'Mark read'}
          </button>
          <button type="button" className="lnp-btn" onClick={() => onToggleDismissed(notification, !dismissed)}>
            {dismissed ? 'Restore' : 'Dismiss'}
          </button>
        </div>
      </div>
    </article>
  )
}
