import { useEffect, useState } from 'react'
import { Modal } from '../../components/Modal'

/**
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {() => void} props.onConfirm
 * @param {'update' | 'delete' | 'bulk-replace' | 'export-saved-unsaved'} props.variant
 * @param {string} [props.listName]
 * @param {{ oldCount?: number, newCount?: number, pastedCount?: number }} [props.counts]
 */
export function AllPricesConfirmModal({
  open,
  onClose,
  onConfirm,
  variant,
  listName = '',
  counts = {},
}) {
  const [typed, setTyped] = useState('')

  useEffect(() => {
    if (!open) setTyped('')
  }, [open])

  const needsTyping = variant === 'update' || variant === 'delete'
  const requiredWord = variant === 'update' ? 'UPDATE' : variant === 'delete' ? 'DELETE' : ''
  const canConfirm = !needsTyping || typed.trim().toUpperCase() === requiredWord

  let title = 'Confirm'
  let body = null

  if (variant === 'update') {
    title = 'Confirm update'
    body = (
      <>
        <p>
          You are about to update <strong>{listName || 'this saved list'}</strong> with a large change in row count (
          {counts.oldCount} → {counts.newCount} rows).
        </p>
        <p>Type <strong>UPDATE</strong> to continue.</p>
        <label className="ap-ec-confirm-input">
          Confirmation
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="UPDATE"
            autoComplete="off"
          />
        </label>
      </>
    )
  } else if (variant === 'delete') {
    title = 'Delete saved list'
    body = (
      <>
        <p>
          Delete <strong>{listName || 'this saved list'}</strong>? A recovery snapshot is saved first so you can restore
          from the toast.
        </p>
        <p>Type <strong>DELETE</strong> to continue.</p>
        <label className="ap-ec-confirm-input">
          Confirmation
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="DELETE"
            autoComplete="off"
          />
        </label>
      </>
    )
  } else if (variant === 'bulk-replace') {
    title = 'Replace all rows'
    body = (
      <p>
        Replace all <strong>{counts.oldCount}</strong> rows with <strong>{counts.pastedCount ?? counts.newCount}</strong>{' '}
        pasted row(s)? This cannot be undone except via Undo in the toast.
      </p>
    )
  } else if (variant === 'export-saved-unsaved') {
    title = 'Export saved list snapshot'
    body = (
      <p>
        Your working draft has unsaved changes compared to <strong>{listName || 'the active saved list'}</strong>. Export
        will use the <strong>last saved snapshot</strong>, not your current draft. Use Export Current Draft for the table
        as shown.
      </p>
    )
  }

  return (
    <Modal open={open} onClose={onClose} title={title} panelClassName="ap-ec-modal-panel">
      <div className="ap-ec-modal-body">{body}</div>
      <div className="ap-ec-modal-actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={!canConfirm}
          onClick={() => {
            if (!canConfirm) return
            onConfirm()
          }}
        >
          {variant === 'export-saved-unsaved' ? 'Continue' : 'Confirm'}
        </button>
      </div>
    </Modal>
  )
}
