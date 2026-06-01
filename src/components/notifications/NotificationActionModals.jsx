import { useState } from 'react'
import { Modal } from '../Modal'

function addDays(days) {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function fmtDisplay(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('en-GB')
}

export function NotificationSnoozeMenu({ open, onClose, onSnooze, loading }) {
  const [customDate, setCustomDate] = useState('')

  async function pick(date) {
    await onSnooze(date)
    setCustomDate('')
  }

  return (
    <Modal title="Snooze notification" open={open} onClose={onClose}>
      <div className="notif-snooze-menu" role="menu" aria-label="Snooze options">
        <button type="button" className="notif-snooze-menu__item" disabled={loading} onClick={() => pick(addDays(1))}>
          Until tomorrow ({fmtDisplay(addDays(1))})
        </button>
        <button type="button" className="notif-snooze-menu__item" disabled={loading} onClick={() => pick(addDays(3))}>
          For 3 days ({fmtDisplay(addDays(3))})
        </button>
        <button type="button" className="notif-snooze-menu__item" disabled={loading} onClick={() => pick(addDays(7))}>
          For 7 days ({fmtDisplay(addDays(7))})
        </button>
        <div className="notif-snooze-menu__custom">
          <label className="notif-renew-form__field">
            Custom date
            <input
              type="date"
              min={addDays(0)}
              value={customDate}
              onChange={(e) => setCustomDate(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="notif-action-pill notif-action-pill--primary"
            disabled={loading || !customDate}
            onClick={() => pick(customDate)}
          >
            Snooze until {customDate ? fmtDisplay(customDate) : '…'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function NotificationIgnoreModal({ open, onClose, onConfirm, loading }) {
  const [reason, setReason] = useState('')

  function handleClose() {
    setReason('')
    onClose()
  }

  async function handleConfirm() {
    await onConfirm(reason.trim())
    setReason('')
  }

  return (
    <Modal title="Ignore notification?" open={open} onClose={handleClose}>
      <div className="notif-ignore-modal">
        <p className="notif-ignore-modal__text">
          This hides the reminder for this exact expiry date. It will not return unless the expiry date changes.
        </p>
        <label className="notif-renew-form__field">
          Reason (optional)
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this reminder no longer relevant?"
          />
        </label>
        <div className="notif-renew-form__actions">
          <button type="button" className="notif-action-pill notif-action-pill--ghost" onClick={handleClose} disabled={loading}>
            Cancel
          </button>
          <button type="button" className="notif-action-pill notif-action-pill--danger" onClick={handleConfirm} disabled={loading}>
            {loading ? 'Ignoring…' : 'Ignore'}
          </button>
        </div>
      </div>
    </Modal>
  )
}

export function NotificationToast({ message, type = 'success', onClose }) {
  if (!message) return null
  return (
    <div className={`notif-toast notif-toast--${type}`} role="status">
      <span>{message}</span>
      <button type="button" className="notif-toast__close" onClick={onClose} aria-label="Dismiss toast">
        ×
      </button>
    </div>
  )
}
