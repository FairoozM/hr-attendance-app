import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useNotifications } from '../../hooks/useNotifications'
import type { DocumentReminder, NotificationItem } from '../../types/notifications'
import { bellAriaLabel, formatBadge, todayIso } from './notificationFormat'
import { notificationRoute } from './notificationRouting'
import { NotificationsPanel } from './NotificationsPanel'
import { NotificationSnoozeModal } from './NotificationSnoozeModal'
import { NotificationIgnoreModal } from './NotificationIgnoreModal'
import { DocExpiryRenewModal } from './DocExpiryRenewModal'
import { NotificationToast, useNotificationToast } from './NotificationToast'
import { fmtDMY } from '../../utils/dateFormat'
import './notifications.css'

const PANEL_WIDTH = 400
const VIEWPORT_MARGIN = 12
const PANEL_GAP = 10

interface PanelPosition {
  top: number
  left: number
  width: number
  maxHeight: number
}

/**
 * Anchor the portalled panel to the bell. The panel is rendered into `document.body` rather than
 * inside the top bar so it can never be clipped by an ancestor's `overflow` or stacking context.
 */
function usePanelPosition(anchorRef: React.RefObject<HTMLElement>, open: boolean): PanelPosition | null {
  const [position, setPosition] = useState<PanelPosition | null>(null)

  const measure = useCallback(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    const rect = anchor.getBoundingClientRect()
    const width = Math.min(PANEL_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
    const left = Math.min(
      Math.max(VIEWPORT_MARGIN, rect.right - width),
      window.innerWidth - width - VIEWPORT_MARGIN
    )
    const top = rect.bottom + PANEL_GAP
    setPosition({
      top,
      left,
      width,
      maxHeight: Math.max(220, window.innerHeight - top - VIEWPORT_MARGIN),
    })
  }, [anchorRef])

  useLayoutEffect(() => {
    if (!open) return undefined
    measure()
    window.addEventListener('resize', measure)
    // Capture phase so the panel follows the bell when any scroll container moves it.
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [measure, open])

  return position
}

type ActiveModal =
  | { kind: 'snooze'; reminder: DocumentReminder }
  | { kind: 'ignore'; reminder: DocumentReminder }
  | { kind: 'renew'; reminder: DocumentReminder }
  | null

export function NotificationsBell() {
  const navigate = useNavigate()
  const titleId = useId()
  const [open, setOpen] = useState(false)
  const [activeModal, setActiveModal] = useState<ActiveModal>(null)
  const [today, setToday] = useState(() => todayIso())

  const bellRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  const { toast, show: showToast, dismiss: dismissToast } = useNotificationToast()
  const {
    items,
    counts,
    unread,
    initialLoading,
    refreshing,
    error,
    pendingKeys,
    refresh,
    markRead,
    markUnread,
    markAllRead,
    snooze,
    ignore,
    undo,
  } = useNotifications(true)

  const position = usePanelPosition(bellRef, open)
  const modalOpen = activeModal !== null

  const closePanel = useCallback(
    ({ restoreFocus = true }: { restoreFocus?: boolean } = {}) => {
      setOpen(false)
      if (restoreFocus) bellRef.current?.focus()
    },
    []
  )

  const togglePanel = useCallback(() => {
    setOpen((wasOpen) => {
      if (!wasOpen) void refresh({ silent: true })
      return !wasOpen
    })
  }, [refresh])

  // Keep relative dates ("Yesterday", "In 3 days") correct across a midnight rollover.
  useEffect(() => {
    const timer = window.setInterval(() => setToday(todayIso()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  // Escape closes the panel — unless a modal owns the key, which handles its own dismissal.
  useEffect(() => {
    if (!open || modalOpen) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        closePanel()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closePanel, modalOpen, open])

  // Dismiss on an outside press, ignoring presses inside a modal layered above the panel.
  useEffect(() => {
    if (!open || modalOpen) return undefined
    const onPointerDown = (event: PointerEvent | MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      if (bellRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('.modal-backdrop, .notif-toast')) return
      closePanel({ restoreFocus: false })
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [closePanel, modalOpen, open])

  /**
   * Tabbing out of a non-modal popover should close it, which is also what keeps the panel from
   * hiding focus behind itself. A modal takes over focus, so pause the behaviour while one is open.
   */
  useEffect(() => {
    if (!open || modalOpen) return undefined
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (panelRef.current?.contains(target)) return
      if (bellRef.current?.contains(target)) return
      if (target instanceof Element && target.closest('.modal-backdrop, .notif-toast')) return
      setOpen(false)
    }
    document.addEventListener('focusin', onFocusIn)
    return () => document.removeEventListener('focusin', onFocusIn)
  }, [modalOpen, open])

  // Move focus into the panel when it opens so keyboard users land in the right place.
  useEffect(() => {
    if (!open) return
    const frame = window.requestAnimationFrame(() => panelRef.current?.focus())
    return () => window.cancelAnimationFrame(frame)
  }, [open])

  const handleToggleRead = useCallback(
    (item: NotificationItem) => {
      const run = item.is_read ? markUnread : markRead
      void run(item).catch((err: Error) => showToast(err.message || 'Could not update.', { tone: 'error' }))
    },
    [markRead, markUnread, showToast]
  )

  const handleMarkAllRead = useCallback(() => {
    void markAllRead()
      .then(() => showToast('All notifications marked as read.'))
      .catch((err: Error) => showToast(err.message || 'Could not mark all read.', { tone: 'error' }))
  }, [markAllRead, showToast])

  const handleView = useCallback(
    (item: NotificationItem) => {
      closePanel({ restoreFocus: false })
      navigate(notificationRoute(item))
    },
    [closePanel, navigate]
  )

  const handleSnooze = useCallback(
    async (date: string) => {
      if (activeModal?.kind !== 'snooze') return
      const reminder = activeModal.reminder
      setActiveModal(null)
      try {
        await snooze(reminder, date)
        showToast(`Snoozed until ${fmtDMY(date)}.`, { onUndo: () => undo(reminder) })
      } catch (err) {
        showToast((err as Error)?.message || 'Could not snooze this reminder.', { tone: 'error' })
      }
    },
    [activeModal, showToast, snooze, undo]
  )

  const handleIgnore = useCallback(
    async (reason: string) => {
      if (activeModal?.kind !== 'ignore') return
      const reminder = activeModal.reminder
      setActiveModal(null)
      try {
        await ignore(reminder, reason)
        showToast('Reminder ignored.', { onUndo: () => undo(reminder) })
      } catch (err) {
        showToast((err as Error)?.message || 'Could not ignore this reminder.', { tone: 'error' })
      }
    },
    [activeModal, ignore, showToast, undo]
  )

  const handleRenewSaved = useCallback(
    async (expiryDate: string) => {
      showToast(`Renewed until ${fmtDMY(expiryDate)}.`)
      await refresh({ silent: true })
    },
    [refresh, showToast]
  )

  const badge = formatBadge(unread)

  return (
    <>
      <button
        ref={bellRef}
        type="button"
        className={`notif-bell ${open ? 'notif-bell--open' : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={bellAriaLabel(unread)}
        onClick={togglePanel}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
        {unread > 0 && <span className="notif-bell__badge">{badge}</span>}
      </button>

      {/* Announced separately so the count reaches screen readers without stealing focus. */}
      <span className="notif-sr-only" role="status" aria-live="polite">
        {unread > 0 ? `${badge} unread notifications` : ''}
      </span>

      {open &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            className="notif-panel"
            role="dialog"
            aria-modal="false"
            aria-labelledby={titleId}
            tabIndex={-1}
            style={
              position
                ? {
                    top: `${position.top}px`,
                    left: `${position.left}px`,
                    width: `${position.width}px`,
                    maxHeight: `${position.maxHeight}px`,
                  }
                : { visibility: 'hidden' }
            }
          >
            <NotificationsPanel
              items={items}
              counts={counts}
              today={today}
              initialLoading={initialLoading}
              refreshing={refreshing}
              error={error}
              pendingKeys={pendingKeys}
              titleId={titleId}
              onRetry={() => void refresh()}
              onMarkAllRead={handleMarkAllRead}
              onToggleRead={handleToggleRead}
              onRenew={(reminder) => setActiveModal({ kind: 'renew', reminder })}
              onSnooze={(reminder) => setActiveModal({ kind: 'snooze', reminder })}
              onIgnore={(reminder) => setActiveModal({ kind: 'ignore', reminder })}
              onView={handleView}
            />
          </div>,
          document.body
        )}

      <NotificationSnoozeModal
        open={activeModal?.kind === 'snooze'}
        title={activeModal?.kind === 'snooze' ? activeModal.reminder.title : undefined}
        busy={
          activeModal?.kind === 'snooze' && pendingKeys.has(activeModal.reminder.notification_key)
        }
        onClose={() => setActiveModal(null)}
        onSnooze={handleSnooze}
      />

      <NotificationIgnoreModal
        open={activeModal?.kind === 'ignore'}
        title={activeModal?.kind === 'ignore' ? activeModal.reminder.title : undefined}
        busy={
          activeModal?.kind === 'ignore' && pendingKeys.has(activeModal.reminder.notification_key)
        }
        onClose={() => setActiveModal(null)}
        onConfirm={handleIgnore}
      />

      <DocExpiryRenewModal
        open={activeModal?.kind === 'renew'}
        documentId={activeModal?.kind === 'renew' ? activeModal.reminder.source_id : null}
        onClose={() => setActiveModal(null)}
        onSaved={handleRenewSaved}
      />

      <NotificationToast toast={toast} onDismiss={dismissToast} />
    </>
  )
}
