import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, MouseEvent } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'
import type { Subscription } from '../../../api/subscriptions'

const CLOSED = { openId: null as string | null, menuStyle: undefined as CSSProperties | undefined }

interface Props {
  sub: Subscription
  canEdit: boolean
  canDelete: boolean
  onView: (sub: Subscription) => void
  onEdit: (sub: Subscription) => void
  onDelete: (id: string) => void
  onSendPayment: (sub: Subscription) => void
  onMarkPaid: (id: string) => void
  onRenew: (id: string) => void
  onUploadInvoice: (id: string, file: File) => void
  onDownloadInvoice: (subscriptionId: string, invoiceId: string) => void
}

export function SubscriptionRowActions({
  sub,
  canEdit,
  canDelete,
  onView,
  onEdit,
  onDelete,
  onSendPayment,
  onMarkPaid,
  onRenew,
  onUploadInvoice,
  onDownloadInvoice,
}: Props) {
  const [menu, setMenu] = useState(CLOSED)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!menu.openId) return
    const close = () => setMenu(CLOSED)
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Element | null
      if (t?.closest('.sub-row-menu')) return
      close()
    }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu.openId])

  const needsPayment =
    sub.paymentStatus === 'Unpaid' || sub.paymentStatus === 'Payment Requested'
  const needsInvoice =
    sub.invoiceRequired &&
    (sub.invoiceCount === 0 || sub.invoiceStatus === 'Missing')
  const latestInvoice = sub.invoices?.[0]

  const toggleMenu = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (menu.openId === sub.id) {
      setMenu(CLOSED)
      return
    }
    const rect = e.currentTarget.getBoundingClientRect()
    const menuWidth = 220
    const menuHeight = 280
    const gutter = 10
    const top =
      rect.bottom + menuHeight + gutter > window.innerHeight
        ? Math.max(gutter, rect.top - menuHeight - 4)
        : rect.bottom + 4
    const left = Math.min(
      Math.max(gutter, rect.right - menuWidth),
      window.innerWidth - menuWidth - gutter
    )
    setMenu({
      openId: sub.id,
      menuStyle: { top: `${top}px`, left: `${left}px`, minWidth: `${menuWidth}px` },
    })
  }

  const menuPortal = useMemo(() => {
    if (menu.openId !== sub.id || typeof document === 'undefined') return null
    return createPortal(
      <div className="sub-row-menu" role="menu" style={menu.menuStyle}>
        {canEdit && (
          <button type="button" className="sub-row-menu__item" role="menuitem" onClick={(e) => { e.stopPropagation(); onEdit(sub); setMenu(CLOSED) }}>
            Edit
          </button>
        )}
        {canEdit && (
          <button type="button" className="sub-row-menu__item" role="menuitem" onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); setMenu(CLOSED) }}>
            Upload Invoice
          </button>
        )}
        {latestInvoice && (
          <button
            type="button"
            className="sub-row-menu__item"
            role="menuitem"
            onClick={(e) => {
              e.stopPropagation()
              onDownloadInvoice(sub.id, latestInvoice.id)
              setMenu(CLOSED)
            }}
          >
            Download Invoice
          </button>
        )}
        {canEdit && (
          <button type="button" className="sub-row-menu__item" role="menuitem" onClick={(e) => { e.stopPropagation(); onSendPayment(sub); setMenu(CLOSED) }}>
            Send to Payment Group
          </button>
        )}
        {canEdit && (
          <button type="button" className="sub-row-menu__item" role="menuitem" onClick={(e) => { e.stopPropagation(); onMarkPaid(sub.id); setMenu(CLOSED) }}>
            Mark Paid
          </button>
        )}
        {canEdit && (
          <button type="button" className="sub-row-menu__item" role="menuitem" onClick={(e) => { e.stopPropagation(); onRenew(sub.id); setMenu(CLOSED) }}>
            Renew
          </button>
        )}
        {canDelete && (
          <>
            <div className="sub-row-menu__sep" />
            <button
              type="button"
              className="sub-row-menu__item sub-row-menu__item--danger"
              role="menuitem"
              onClick={(e) => { e.stopPropagation(); onDelete(sub.id); setMenu(CLOSED) }}
            >
              Delete
            </button>
          </>
        )}
      </div>,
      document.body
    )
  }, [menu, sub, canEdit, canDelete, onEdit, onDelete, onSendPayment, onMarkPaid, onRenew, onDownloadInvoice, latestInvoice])

  return (
    <div className="sub-row-actions" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="sub-row-actions__btn" onClick={() => onView(sub)}>
        View
      </button>
      {canEdit && needsPayment && (
        <button type="button" className="sub-row-actions__btn sub-row-actions__btn--accent" onClick={() => onSendPayment(sub)}>
          Pay
        </button>
      )}
      {canEdit && needsInvoice && (
        <button type="button" className="sub-row-actions__btn" onClick={() => fileRef.current?.click()}>
          Invoice
        </button>
      )}
      {(canEdit || canDelete) && (
        <button
          type="button"
          className="sub-row-actions__menu-btn"
          aria-label="More actions"
          aria-expanded={menu.openId === sub.id}
          onClick={toggleMenu}
        >
          <MoreVertical size={16} strokeWidth={2} aria-hidden />
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.webp"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onUploadInvoice(sub.id, file)
          e.target.value = ''
        }}
      />
      {menuPortal}
    </div>
  )
}
