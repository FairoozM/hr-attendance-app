import { memo } from 'react'
import type { DocumentReminder, NotificationItem } from '../../types/notifications'
import { isDocumentReminder } from '../../types/notifications'
import {
  URGENCY_LABEL,
  notificationSubtitle,
  notificationTitle,
  relativeDayLabel,
  snoozeNote,
} from './notificationFormat'

export interface NotificationRowProps {
  item: NotificationItem
  busy: boolean
  today: string
  onToggleRead: (item: NotificationItem) => void
  onRenew: (reminder: DocumentReminder) => void
  onSnooze: (reminder: DocumentReminder) => void
  onIgnore: (reminder: DocumentReminder) => void
  onView: (item: NotificationItem) => void
}

function UrgencyBadge({ reminder }: { reminder: DocumentReminder }) {
  return (
    <span className={`notif-badge notif-badge--${reminder.urgency}`}>
      {URGENCY_LABEL[reminder.urgency] || reminder.urgency}
    </span>
  )
}

export const NotificationRow = memo(function NotificationRow({
  item,
  busy,
  today,
  onToggleRead,
  onRenew,
  onSnooze,
  onIgnore,
  onView,
}: NotificationRowProps) {
  const reminder = isDocumentReminder(item) ? item : null
  const unread = !item.is_read
  const subtitle = notificationSubtitle(item)
  const note = snoozeNote(item, today)
  const date = relativeDayLabel(item.scheduled_for, today)

  return (
    <li
      className={[
        'notif-row',
        unread ? 'notif-row--unread' : 'notif-row--read',
        reminder ? `notif-row--${reminder.urgency}` : 'notif-row--system',
        busy ? 'notif-row--busy' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      aria-busy={busy || undefined}
    >
      <span className="notif-row__rail" aria-hidden />

      <div className="notif-row__main">
        <div className="notif-row__heading">
          <h3 className="notif-row__title">{notificationTitle(item)}</h3>
          {reminder && <UrgencyBadge reminder={reminder} />}
          {unread && <span className="notif-row__dot" aria-label="Unread" />}
        </div>

        {subtitle && <p className="notif-row__subtitle">{subtitle}</p>}
        <p className="notif-row__message">{item.message}</p>

        <div className="notif-row__meta">
          {date && <span>{date}</span>}
          {note && <span className="notif-row__note">{note}</span>}
        </div>

        <div className="notif-row__actions">
          {reminder ? (
            <>
              <button
                type="button"
                className="notif-btn notif-btn--primary notif-btn--sm"
                disabled={busy}
                onClick={() => onRenew(reminder)}
              >
                Renew
              </button>
              <button
                type="button"
                className="notif-btn notif-btn--sm"
                disabled={busy}
                onClick={() => onSnooze(reminder)}
              >
                Snooze
              </button>
              <button
                type="button"
                className="notif-btn notif-btn--sm"
                disabled={busy}
                onClick={() => onIgnore(reminder)}
              >
                Ignore
              </button>
            </>
          ) : null}
          <button
            type="button"
            className="notif-btn notif-btn--ghost notif-btn--sm"
            disabled={busy}
            onClick={() => onView(item)}
          >
            View
          </button>
        </div>
      </div>

      <button
        type="button"
        className="notif-row__read-toggle"
        disabled={busy}
        onClick={() => onToggleRead(item)}
        aria-label={unread ? 'Mark as read' : 'Mark as unread'}
        title={unread ? 'Mark as read' : 'Mark as unread'}
      >
        {unread ? (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="8" />
          </svg>
        )}
      </button>
    </li>
  )
})
