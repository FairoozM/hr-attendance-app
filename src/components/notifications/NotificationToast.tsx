import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export type ToastTone = 'success' | 'error'

export interface ToastState {
  id: number
  message: string
  tone: ToastTone
  onUndo?: () => void | Promise<void>
}

const AUTO_DISMISS_MS = 6_000

/**
 * One toast at a time with an optional undo affordance.
 * The timer lives in a ref: the previous implementation created a bare `setTimeout` per toast, so a
 * second toast was cleared early by the first toast's timer and unmounting left the timer running.
 */
export function useNotificationToast() {
  const [toast, setToast] = useState<ToastState | null>(null)
  const timerRef = useRef<number | null>(null)
  const nextIdRef = useRef(1)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const dismiss = useCallback(() => {
    clearTimer()
    setToast(null)
  }, [clearTimer])

  const show = useCallback(
    (message: string, options: { tone?: ToastTone; onUndo?: () => void | Promise<void> } = {}) => {
      clearTimer()
      const id = nextIdRef.current++
      setToast({ id, message, tone: options.tone || 'success', onUndo: options.onUndo })
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null
        setToast((current) => (current?.id === id ? null : current))
      }, AUTO_DISMISS_MS)
    },
    [clearTimer]
  )

  useEffect(() => clearTimer, [clearTimer])

  return { toast, show, dismiss }
}

interface NotificationToastProps {
  toast: ToastState | null
  onDismiss: () => void
}

export function NotificationToast({ toast, onDismiss }: NotificationToastProps) {
  if (!toast || typeof document === 'undefined') return null

  return createPortal(
    <div
      className={`notif-toast notif-toast--${toast.tone}`}
      role="status"
      aria-live="polite"
      key={toast.id}
    >
      <span className="notif-toast__message">{toast.message}</span>
      {toast.onUndo && (
        <button
          type="button"
          className="notif-toast__undo"
          onClick={() => {
            void toast.onUndo?.()
            onDismiss()
          }}
        >
          Undo
        </button>
      )}
      <button type="button" className="notif-toast__close" onClick={onDismiss} aria-label="Dismiss">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden>
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>
    </div>,
    document.body
  )
}
