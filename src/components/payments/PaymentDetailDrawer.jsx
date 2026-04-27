import { useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { PAYMENT_STATUS } from '../../data/paymentTypes'
import {
  getDaysLeft,
  getInformAsadDate,
  getPaymentUrgency,
  getPaymentStatusLabel,
} from '../../utils/paymentUtils'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import './paymentsShared.css'

/**
 * @param {object} props
 * @param {import('../../hooks/useCompanyPayments').CompanyPayment | null} props.payment
 * @param {() => void} props.onClose
 * @param {(id: string) => void} [props.onEdit]
 * @param {(id: string, note: string) => void} [props.onMarkInformed]
 * @param {(id: string, file: File | null, note: string) => void} [props.onMarkDone]
 * @param {(id: string, file: File) => void} [props.onSetProof]
 * @param {(id: string, file: File) => void} [props.onAttachBill]
 */
export function PaymentDetailDrawer({
  payment,
  onClose,
  onEdit,
  onMarkInformed,
  onMarkDone,
  onSetProof,
  onAttachBill,
}) {
  const { user } = useAuth()
  const billInputRef = useRef(null)
  const proofInputRef = useRef(null)
  const canEdit = hasPermission(user, 'document_expiry', 'edit')

  return (
    <AnimatePresence>
      {payment && (
        <PaymentDrawerInner
          payment={payment}
          onClose={onClose}
          onEdit={onEdit}
          onMarkInformed={onMarkInformed}
          onMarkDone={onMarkDone}
          onSetProof={onSetProof}
          onAttachBill={onAttachBill}
          canEdit={canEdit}
          billInputRef={billInputRef}
          proofInputRef={proofInputRef}
        />
      )}
    </AnimatePresence>
  )
}

function PaymentDrawerInner({
  payment,
  onClose,
  onEdit,
  onMarkInformed,
  onMarkDone,
  onSetProof,
  onAttachBill,
  canEdit,
  billInputRef,
  proofInputRef,
}) {
  const dueL = getDaysLeft(payment.dueDate)
  const informD = payment.informAsadDate || getInformAsadDate(payment.dueDate, payment.informAsadBeforeDays)
  const informL = getDaysLeft(informD)
  const u = getPaymentUrgency(payment)
  const isDone = payment.status === PAYMENT_STATUS.PAYMENT_DONE

  return (
    <motion.div
      className="pay-drawer-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.aside
        className="pay-drawer"
        initial={{ x: 48, opacity: 0.9 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: 40, opacity: 0 }}
        transition={{ type: 'spring', stiffness: 380, damping: 35 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pay-drawer__head">
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: 1,
                color: 'var(--text-muted)',
              }}
            >
              {payment.paymentType} · {payment.sourceModule}
            </div>
            <h2 style={{ margin: '0.2rem 0 0', fontSize: '1.15rem', lineHeight: 1.2 }}>{payment.title}</h2>
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              <span className="pay-urgency-badge" style={{ borderColor: u.color, color: u.color }}>
                {u.label}
              </span>
              <span className="pay-status-badge" style={{ color: u.color, borderColor: u.color, opacity: 0.9 }}>
                {getPaymentStatusLabel(payment.status)}
              </span>
            </div>
          </div>
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="pay-drawer__body">
          <div>
            <div className="pay-drawer__k">Amount</div>
            <div className="pay-drawer__v">
              {payment.amount != null ? `${payment.currency} ${Number(payment.amount).toLocaleString()}` : '—'}
            </div>
          </div>
          <div>
            <div className="pay-drawer__k">Due date & days left</div>
            <div className="pay-drawer__v">
              {payment.dueDate} — {dueL == null ? '—' : `${dueL} day(s)`}
            </div>
          </div>
          <div>
            <div className="pay-drawer__k">Inform Asad by</div>
            <div className="pay-drawer__v">
              {informD} — {informL == null ? '—' : `${informL} day(s) from today`}
            </div>
          </div>
          <div>
            <div className="pay-drawer__k">Company & payee</div>
            <div className="pay-drawer__v">
              {payment.company}
              {payment.payeeOrVendor ? ` — ${payment.payeeOrVendor}` : ''}
            </div>
          </div>
          {!!payment.notes && (
            <div>
              <div className="pay-drawer__k">Notes</div>
              <div className="pay-drawer__v">{payment.notes}</div>
            </div>
          )}
          {payment.informedToAsadAt && (
            <div>
              <div className="pay-drawer__k">Informed to Asad</div>
              <div className="pay-drawer__v">
                {new Date(payment.informedToAsadAt).toLocaleString()} by {payment.informedToAsadBy || '—'}
              </div>
            </div>
          )}
          {payment.paymentDoneAt && (
            <div>
              <div className="pay-drawer__k">Payment done</div>
              <div className="pay-drawer__v">
                {new Date(payment.paymentDoneAt).toLocaleString()} by {payment.paymentDoneBy || '—'}
              </div>
            </div>
          )}
          {payment.paymentProofAttachment && (
            <div>
              <div className="pay-drawer__k">Payment proof</div>
              <a
                className="pay-drawer__v"
                href={payment.paymentProofAttachment.dataUrl}
                target="_blank"
                rel="noreferrer"
              >
                {payment.paymentProofAttachment.name}
              </a>
            </div>
          )}
          <div>
            <div className="pay-drawer__k">Bills & attachments</div>
            {payment.attachments && payment.attachments.length > 0 ? (
              <ul style={{ margin: '0.25rem 0 0', paddingLeft: '1.1rem' }}>
                {payment.attachments.map((a) => (
                  <li key={a.id}>
                    <a href={a.dataUrl} target="_blank" rel="noreferrer">
                      {a.name}
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="pay-drawer__v">None</div>
            )}
            {canEdit && !isDone && onAttachBill && (
              <>
                <input
                  ref={billInputRef}
                  type="file"
                  accept="image/*,application/pdf,.pdf"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const file = e.target.files?.[0] || null
                    e.target.value = ''
                    if (file) onAttachBill(payment.id, file)
                  }}
                />
                <button type="button" className="btn btn--ghost btn--sm" style={{ marginTop: 8 }} onClick={() => billInputRef.current?.click()}>
                  + Upload bill (image or PDF)
                </button>
              </>
            )}
          </div>
          <div>
            <div className="pay-drawer__k">Status history</div>
            <ul className="pay-history">
              {Array.isArray(payment.history) && payment.history.length
                ? payment.history.map((h) => (
                    <li key={h.id}>
                      <strong>{h.action}</strong> — {h.performedBy} — {new Date(h.performedAt).toLocaleString()}
                      {(h.fromStatus || h.toStatus) && (
                        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 2 }}>
                          {h.fromStatus || '—'} → {h.toStatus || '—'}
                        </div>
                      )}
                      {h.note && <div style={{ fontSize: '0.8rem', marginTop: 2 }}>{h.note}</div>}
                    </li>
                  ))
                : null}
            </ul>
          </div>
          {canEdit && (
            <div className="pay-drawer-actions">
              {!isDone && onEdit && (
                <button type="button" className="btn btn--primary" onClick={() => onEdit(payment.id)}>
                  Edit
                </button>
              )}
              {payment.status === PAYMENT_STATUS.PAYMENT_NEEDED && onMarkInformed && (
                <button type="button" className="btn btn--accent" onClick={() => onMarkInformed(payment.id, '')}>
                  Mark informed to Asad
                </button>
              )}
              {payment.status === PAYMENT_STATUS.INFORMED_TO_ASAD && onMarkDone && (
                <>
                  <input
                    ref={proofInputRef}
                    type="file"
                    accept="image/*,application/pdf,.pdf"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null
                      e.target.value = ''
                      onMarkDone(payment.id, file, '')
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => onMarkDone(payment.id, null, '')}
                  >
                    Mark payment done
                  </button>
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => proofInputRef.current?.click()}
                  >
                    Add proof (optional)
                  </button>
                </>
              )}
              {onSetProof && payment.status === PAYMENT_STATUS.PAYMENT_DONE && !payment.paymentProofAttachment && (
                <label className="btn btn--ghost" style={{ cursor: 'pointer' }}>
                  Add proof
                  <input
                    type="file"
                    accept="image/*,application/pdf,.pdf"
                    style={{ position: 'absolute', width: 0, height: 0, opacity: 0 }}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null
                      e.target.value = ''
                      if (file) onSetProof(payment.id, file)
                    }}
                  />
                </label>
              )}
            </div>
          )}
        </div>
      </motion.aside>
    </motion.div>
  )
}
