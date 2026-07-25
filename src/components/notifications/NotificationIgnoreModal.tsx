import { useEffect, useState } from 'react'
import { Modal } from '../Modal'

interface NotificationIgnoreModalProps {
  open: boolean
  title?: string
  busy?: boolean
  onClose: () => void
  onConfirm: (reason: string) => void | Promise<void>
}

export function NotificationIgnoreModal({
  open,
  title,
  busy = false,
  onClose,
  onConfirm,
}: NotificationIgnoreModalProps) {
  const [reason, setReason] = useState('')

  useEffect(() => {
    if (!open) setReason('')
  }, [open])

  return (
    <Modal title="Ignore reminder?" open={open} onClose={onClose}>
      <div className="notif-ignore">
        {title && <p className="notif-snooze__target">{title}</p>}
        <p className="notif-snooze__hint">
          This hides the reminder for this exact expiry date. It comes back only if the expiry date
          changes — you can also undo this right after.
        </p>
        <label className="notif-field">
          Reason (optional)
          <textarea
            rows={2}
            value={reason}
            disabled={busy}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this reminder no longer relevant?"
          />
        </label>
        <div className="notif-form__actions">
          <button type="button" className="notif-btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="notif-btn notif-btn--danger"
            onClick={() => onConfirm(reason.trim())}
            disabled={busy}
          >
            {busy ? 'Ignoring…' : 'Ignore reminder'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
