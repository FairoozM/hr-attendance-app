import { useEffect } from 'react'

/**
 * @param {object} props
 * @param {string | null} props.message
 * @param {'undo' | 'restore'} [props.actionLabel]
 * @param {() => void} [props.onAction]
 * @param {() => void} props.onDismiss
 * @param {number} [props.secondsLeft]
 */
export function AllPricesActionToast({
  message,
  actionLabel = 'undo',
  onAction,
  onDismiss,
  secondsLeft = 10,
}) {
  useEffect(() => {
    if (!message) return undefined
    const t = setTimeout(onDismiss, secondsLeft * 1000)
    return () => clearTimeout(t)
  }, [message, onDismiss, secondsLeft])

  if (!message) return null

  const label = actionLabel === 'restore' ? 'Restore' : 'Undo'

  return (
    <div className="ap-ec-action-toast" role="status" aria-live="polite" data-testid="all-prices-action-toast">
      <span className="ap-ec-action-toast__msg">
        <span
          className="ap-ec-action-toast__progress"
          style={{ '--pct': `${(secondsLeft / 10) * 100}%` }}
        />
        {message}
      </span>
      {onAction ? (
        <button type="button" className="ap-ec-action-toast__action" onClick={onAction}>
          {label}
        </button>
      ) : null}
      <button type="button" className="ap-ec-action-toast__close" onClick={onDismiss} aria-label="Dismiss">
        ×
      </button>
    </div>
  )
}
