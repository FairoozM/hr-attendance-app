import { useState } from 'react'
import { Modal } from '../../../components/Modal'

interface Props {
  open: boolean
  message: string
  onClose: () => void
  onConfirm: () => Promise<void>
  confirming: boolean
}

export function PaymentGroupModal({ open, message, onClose, onConfirm, confirming }: Props) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

  return (
    <Modal title="Send to Payment Group" open={open} onClose={onClose}>
      <div className="sub-payment-modal">
        <p style={{ margin: '0 0 0.75rem', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
          Copy the message below and confirm to update invoice &amp; payment status.
        </p>
        <pre>{message}</pre>
        <div className="modal-actions">
          <button type="button" className="btn btn--ghost" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy Message'}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn--primary" onClick={onConfirm} disabled={confirming}>
            {confirming ? 'Sending…' : 'Confirm & Send'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
