import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Modal } from '../../../components/Modal'

export interface ConfirmOptions {
  title: string
  message: ReactNode
  details?: ReactNode[]
  confirmLabel?: string
  cancelLabel?: string
  tone?: 'default' | 'danger'
}

interface PendingConfirm extends ConfirmOptions {
  resolve: (confirmed: boolean) => void
}

/**
 * Promise-based replacement for window.confirm: `if (!(await confirm({...}))) return`.
 * Render `dialog` once in the page.
 */
export function useConfirmDialog(): { confirm: (options: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<PendingConfirm | null>(null)
  const pendingRef = useRef<PendingConfirm | null>(null)
  pendingRef.current = pending

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        pendingRef.current?.resolve(false)
        setPending({ ...options, resolve })
      }),
    []
  )

  const settle = useCallback((confirmed: boolean) => {
    pendingRef.current?.resolve(confirmed)
    setPending(null)
  }, [])

  const cancel = useCallback(() => settle(false), [settle])

  useEffect(() => () => pendingRef.current?.resolve(false), [])

  const dialog = (
    <Modal title={pending?.title ?? ''} open={Boolean(pending)} onClose={cancel} panelClassName="pp-confirm-dialog">
      {pending && (
        <div className="pp-confirm-dialog__body">
          <div className="pp-confirm-dialog__message">{pending.message}</div>
          {pending.details && pending.details.length > 0 && (
            <ul className="pp-confirm-dialog__details">
              {pending.details.map((detail, index) => (
                <li key={index}>{detail}</li>
              ))}
            </ul>
          )}
          <div className="pp-confirm-dialog__actions">
            <button type="button" className="btn" onClick={cancel}>
              {pending.cancelLabel || 'Cancel'}
            </button>
            <button
              type="button"
              className={pending.tone === 'danger' ? 'btn btn--danger' : 'btn btn--primary'}
              onClick={() => settle(true)}
              autoFocus
            >
              {pending.confirmLabel || 'Continue'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )

  return { confirm, dialog }
}
