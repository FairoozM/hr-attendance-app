import { useEffect, useMemo, useState } from 'react'
import { Modal } from '../Modal'
import { isValidSnoozeDate, snoozePresets, todayIso } from './notificationFormat'

interface NotificationSnoozeModalProps {
  open: boolean
  /** Shown so the user can tell which reminder they are about to snooze. */
  title?: string
  busy?: boolean
  onClose: () => void
  onSnooze: (date: string) => void | Promise<void>
}

export function NotificationSnoozeModal({
  open,
  title,
  busy = false,
  onClose,
  onSnooze,
}: NotificationSnoozeModalProps) {
  const [customDate, setCustomDate] = useState('')
  const today = useMemo(() => todayIso(), [open])
  const presets = useMemo(() => snoozePresets(today), [today])

  // Reset between openings, otherwise a date typed for one reminder leaks into the next.
  useEffect(() => {
    if (!open) setCustomDate('')
  }, [open])

  const customValid = isValidSnoozeDate(customDate, today)

  return (
    <Modal title="Snooze reminder" open={open} onClose={onClose}>
      <div className="notif-snooze">
        {title && <p className="notif-snooze__target">{title}</p>}
        <p className="notif-snooze__hint">
          The reminder disappears until the chosen date, then returns automatically.
        </p>

        <div className="notif-snooze__presets">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="notif-snooze__preset"
              disabled={busy}
              onClick={() => onSnooze(preset.date)}
            >
              {preset.label}
            </button>
          ))}
        </div>

        <div className="notif-snooze__custom">
          <label className="notif-field">
            Or pick a date
            <input
              type="date"
              min={today}
              value={customDate}
              disabled={busy}
              onChange={(e) => setCustomDate(e.target.value)}
            />
          </label>
          {customDate && !customValid && (
            <p className="notif-form__error">Choose today or a later date.</p>
          )}
          <div className="notif-form__actions">
            <button type="button" className="notif-btn" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button
              type="button"
              className="notif-btn notif-btn--primary"
              disabled={busy || !customValid}
              onClick={() => onSnooze(customDate)}
            >
              {busy ? 'Snoozing…' : 'Snooze'}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  )
}
