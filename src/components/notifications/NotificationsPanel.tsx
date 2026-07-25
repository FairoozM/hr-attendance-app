import { useEffect, useMemo, useRef, useState } from 'react'
import type { DocumentReminder, NotificationCounts, NotificationItem } from '../../types/notifications'
import { notificationUid } from '../../types/notifications'
import { NotificationRow } from './NotificationRow'
import {
  emptyStateCopy,
  filterNotifications,
  groupNotifications,
  type NotificationFilter,
} from './notificationGrouping'
import { pluralize } from './notificationFormat'

/** Rows shown per group before "Show more" — keeps a 60-item inbox from becoming a scroll wall. */
const COLLAPSED_GROUP_SIZE = 5

export interface NotificationsPanelProps {
  items: NotificationItem[]
  counts: NotificationCounts
  today: string
  initialLoading: boolean
  refreshing: boolean
  error: string
  pendingKeys: ReadonlySet<string>
  onRetry: () => void
  onMarkAllRead: () => void
  onToggleRead: (item: NotificationItem) => void
  onRenew: (reminder: DocumentReminder) => void
  onSnooze: (reminder: DocumentReminder) => void
  onIgnore: (reminder: DocumentReminder) => void
  onView: (item: NotificationItem) => void
  titleId: string
}

function Skeletons() {
  return (
    <ul className="notif-list" aria-hidden>
      {[0, 1, 2].map((i) => (
        <li key={i} className="notif-row notif-skeleton">
          <span className="notif-skeleton__line notif-skeleton__line--title" />
          <span className="notif-skeleton__line notif-skeleton__line--sub" />
          <span className="notif-skeleton__line" />
        </li>
      ))}
    </ul>
  )
}

export function NotificationsPanel({
  items,
  counts,
  today,
  initialLoading,
  refreshing,
  error,
  pendingKeys,
  onRetry,
  onMarkAllRead,
  onToggleRead,
  onRenew,
  onSnooze,
  onIgnore,
  onView,
  titleId,
}: NotificationsPanelProps) {
  const [filter, setFilter] = useState<NotificationFilter>('all')
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(() => new Set<string>())
  const bodyRef = useRef<HTMLDivElement>(null)

  const visible = useMemo(() => filterNotifications(items, filter), [items, filter])
  const groups = useMemo(() => groupNotifications(visible), [visible])

  // Switching filters should start the reader at the top of the list.
  useEffect(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = 0
  }, [filter])

  const toggleGroup = (id: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const empty = emptyStateCopy(filter, items.length)
  const showEmpty = !initialLoading && !error && groups.length === 0

  return (
    <>
      <header className="notif-panel__head">
        <div className="notif-panel__head-row">
          <h2 className="notif-panel__title" id={titleId}>
            Notifications
          </h2>
          <span className="notif-panel__status" role="status" aria-live="polite">
            {refreshing && !initialLoading ? 'Updating…' : ''}
          </span>
          <button
            type="button"
            className="notif-btn notif-btn--ghost notif-btn--sm"
            onClick={onMarkAllRead}
            disabled={counts.unread === 0 || pendingKeys.has('mark-all-read')}
          >
            Mark all read
          </button>
        </div>

        <div className="notif-tabs" role="tablist" aria-label="Filter notifications">
          {(['all', 'unread'] as NotificationFilter[]).map((value) => {
            const active = filter === value
            const count = value === 'all' ? counts.total : counts.unread
            return (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={active}
                className={`notif-tab ${active ? 'notif-tab--active' : ''}`}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? 'All' : 'Unread'}
                <span className="notif-tab__count">{count}</span>
              </button>
            )
          })}
        </div>
      </header>

      <div className="notif-panel__body" ref={bodyRef} aria-busy={initialLoading || undefined}>
        {error && (
          <div className="notif-panel__error" role="alert">
            <p className="notif-panel__error-title">Could not load notifications</p>
            <p className="notif-panel__error-body">{error}</p>
            <button type="button" className="notif-btn notif-btn--sm" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}

        {initialLoading && !error && <Skeletons />}

        {showEmpty && (
          <div className="notif-panel__empty">
            <span className="notif-panel__empty-icon" aria-hidden>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
            </span>
            <p className="notif-panel__empty-title">{empty.title}</p>
            <p className="notif-panel__empty-body">{empty.body}</p>
          </div>
        )}

        {groups.map((group) => {
          const expanded = expandedGroups.has(group.id)
          const shown = expanded ? group.items : group.items.slice(0, COLLAPSED_GROUP_SIZE)
          const hidden = group.items.length - shown.length

          return (
            <section className="notif-group" key={group.id} aria-labelledby={`${titleId}-${group.id}`}>
              <h3 className="notif-group__label" id={`${titleId}-${group.id}`}>
                {group.label}
                <span className="notif-group__count">{group.items.length}</span>
              </h3>

              <ul className="notif-list">
                {shown.map((item) => {
                  const uid = notificationUid(item)
                  return (
                    <NotificationRow
                      key={uid}
                      item={item}
                      busy={pendingKeys.has(uid)}
                      today={today}
                      onToggleRead={onToggleRead}
                      onRenew={onRenew}
                      onSnooze={onSnooze}
                      onIgnore={onIgnore}
                      onView={onView}
                    />
                  )
                })}
              </ul>

              {(hidden > 0 || expanded) && (
                <button
                  type="button"
                  className="notif-group__more"
                  onClick={() => toggleGroup(group.id)}
                >
                  {expanded ? 'Show less' : `Show ${pluralize(hidden, 'more')}`}
                </button>
              )}
            </section>
          )
        })}
      </div>
    </>
  )
}
