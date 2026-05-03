import { useState, useCallback, useEffect, useMemo } from 'react'
import { fmtDMY, fmtISO, shopVisitAllowedWindowISO, shopVisitDateValidationError } from '../../utils/dateFormat'
import { shopWorkflowLabel } from './annualLeaveLabels'
import './ShopVisitWorkflow.css'

export { shopWorkflowLabel } from './annualLeaveLabels'

const SHOP_BADGE_STYLES = {
  'Pending leave approval': { color: '#b45309', bg: '#fef3c7' },
  Rejected: { color: '#4b5563', bg: '#f3f4f6' },
  'Shop visit: waiting for employee': { color: '#0369a1', bg: '#e0f2fe' },
  'Shop visit: submitted': { color: '#7c3aed', bg: '#ede9fe' },
  'Shop visit confirmed': { color: '#047857', bg: '#d1fae5' },
  'Calculator applied to visit': { color: '#1d4ed8', bg: '#dbeafe' },
  'Shop visit completed': { color: '#15803d', bg: '#dcfce7' },
  'Shop visit cancelled': { color: '#991b1b', bg: '#fee2e2' },
}

export function ShopWorkflowBadge({ row }) {
  const label = shopWorkflowLabel(row)
  const st = SHOP_BADGE_STYLES[label] || { color: 'var(--text-muted)', bg: 'var(--theme-glass-soft)' }
  return (
    <span className="sv-badge" style={{ color: st.color, background: st.bg }} title="Leave / shop process">
      {label}
    </span>
  )
}

/** Employee: submit or update proposed main shop visit (API allows PendingSubmission + Submitted). */
export function EmployeeShopVisitForm({ row, onSubmit, embedInModal = false }) {
  const visitWindow = useMemo(() => shopVisitAllowedWindowISO(row.from_date), [row.from_date])
  const [date, setDate] = useState(() => fmtISO(row.shop_visit_date) || '')
  const [time, setTime] = useState(() => (row.shop_visit_time ? String(row.shop_visit_time) : ''))
  const [note, setNote] = useState(() => (row.shop_visit_note ? String(row.shop_visit_note) : ''))
  const [confirm, setConfirm] = useState(false)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const canEdit = row.status === 'Approved' && ['PendingSubmission', 'Submitted'].includes(row.shop_visit_status || 'PendingSubmission')

  useEffect(() => {
    if (!visitWindow || !date) return
    if (date < visitWindow.min || date > visitWindow.max) setDate('')
  }, [visitWindow, row.id, row.from_date, date])

  const submit = useCallback(
    async (e) => {
      e.preventDefault()
      setErr('')
      if (!date) return setErr('Proposed visit date is required')
      if (!time) return setErr('Proposed visit time is required')
      if (!confirm) return setErr('Please confirm you will visit the main shop')
      const ve = shopVisitDateValidationError(date, row.from_date)
      if (ve) return setErr(ve)
      setSaving(true)
      try {
        await onSubmit(row.id, {
          shop_visit_date: date,
          shop_visit_time: time,
          shop_visit_note: note.trim() || null,
          confirmation: true,
        })
      } catch (ex) {
        setErr(ex.message || 'Failed to submit')
      } finally {
        setSaving(false)
      }
    },
    [row.id, row.from_date, date, time, note, confirm, onSubmit]
  )

  if (!canEdit) return null

  const formInner = (
    <>
      {!embedInModal && (
        <div className="sv-card__head">
          <span className="sv-card__title">Main shop visit (passport &amp; money)</span>
          <span className="sv-card__hint">Leave period: {fmtDMY(row.from_date)} – {fmtDMY(row.to_date)}</span>
          {visitWindow && (
            <span className="sv-card__hint sv-card__hint--block">
              Visit must be between {fmtDMY(visitWindow.min)} and {fmtDMY(visitWindow.max)} (before leave starts on{' '}
              {fmtDMY(row.from_date)}).
            </span>
          )}
        </div>
      )}
      {embedInModal && (
        <div className="sv-modal-intro">
          <p>
            Leave period: <strong>{fmtDMY(row.from_date)}</strong> – <strong>{fmtDMY(row.to_date)}</strong>
          </p>
          {visitWindow && (
            <p className="sv-modal-intro__hint">
              Visit must be between {fmtDMY(visitWindow.min)} and {fmtDMY(visitWindow.max)} (before leave starts).
            </p>
          )}
        </div>
      )}
      <form className="sv-form" onSubmit={submit}>
        <div className="sv-form__row">
          <label>
            Proposed visit date
            <input
              type="date"
              value={date}
              min={visitWindow?.min}
              max={visitWindow?.max}
              onChange={(e) => setDate(e.target.value)}
              disabled={saving}
              required
            />
          </label>
          <label>
            Proposed visit time
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} disabled={saving} required />
          </label>
        </div>
        <label>
          Note <span className="sv-optional">(optional)</span>
          <textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={saving} placeholder="Any comment for HR…" />
        </label>
        <label className="sv-check">
          <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} disabled={saving} />
          <span>I will visit the main shop to collect my passport and money.</span>
        </label>
        {err && <p className="sv-form__err">{err}</p>}
        <button type="submit" className="al-btn al-btn--primary" disabled={saving}>
          {saving ? 'Submitting…' : row.shop_visit_status === 'Submitted' ? 'Update submission' : 'Submit shop visit'}
        </button>
      </form>
    </>
  )

  if (embedInModal) {
    return <div className="sv-embed-modal">{formInner}</div>
  }

  return (
    <div className="sv-card">
      {formInner}
    </div>
  )
}

/**
 * Full-screen modal for employee shop visit (used from leave row; replaces bottom-of-page stack).
 */
export function EmployeeShopVisitModal({ row, open, onClose, onSubmit }) {
  if (!open || !row) return null
  const can =
    row.status === 'Approved' &&
    ['PendingSubmission', 'Submitted'].includes(row.shop_visit_status || 'PendingSubmission') &&
    !['Completed', 'Cancelled'].includes(row.shop_visit_status || '')

  return (
    <div className="al-modal-overlay" onClick={onClose}>
      <div className="al-modal al-modal--contextual al-modal--scroll" onClick={(e) => e.stopPropagation()}>
        <div className="al-modal__head al-modal__head--split">
          <div>
            <h3>Submit main shop visit</h3>
            <p className="al-modal__kicker">
              {row.full_name} · {fmtDMY(row.from_date)} – {fmtDMY(row.to_date)} · {shopWorkflowLabel(row)}
            </p>
          </div>
          <button type="button" className="al-modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="al-modal__body-scroll">
          {!can ? (
            <p className="al-modal__hint">You cannot edit the shop visit in the current state.</p>
          ) : (
            <EmployeeShopVisitForm
              row={row}
              embedInModal
              onSubmit={async (id, payload) => {
                await onSubmit(id, payload)
                onClose()
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}

export { ShopVisitCard as AdminShopVisitPanel } from './ShopVisitCard'

export function ShopVisitRescheduleModal({ row, onSave, onClose }) {
  const visitWindow = useMemo(() => shopVisitAllowedWindowISO(row.from_date), [row.from_date])
  const [date, setDate] = useState(() => fmtISO(row.shop_visit_date) || '')
  const [time, setTime] = useState(() => (row.shop_visit_time ? String(row.shop_visit_time) : ''))
  const [remarks, setRemarks] = useState(() => row.shop_visit_admin_note || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!visitWindow || !date) return
    if (date < visitWindow.min || date > visitWindow.max) setDate('')
  }, [visitWindow, row.id, row.from_date, date])

  async function submit(e) {
    e.preventDefault()
    if (!date || !time) return setErr('Date and time are required')
    const ve = shopVisitDateValidationError(date, row.from_date)
    if (ve) return setErr(ve)
    setSaving(true)
    try {
      await onSave(row.id, {
        shop_visit_date: date,
        shop_visit_time: time,
        shop_visit_admin_note: remarks.trim() || null,
      })
      onClose()
    } catch (ex) {
      setErr(ex.message || 'Failed')
      setSaving(false)
    }
  }

  return (
    <div className="al-modal-overlay" onClick={onClose}>
      <div className="al-modal al-modal--contextual" onClick={(e) => e.stopPropagation()}>
        <div className="al-modal__head">
          <h3>Reschedule main shop visit</h3>
          {row.full_name && (
            <p className="al-modal__kicker">
              {row.full_name} · {fmtDMY(row.from_date)} – {fmtDMY(row.to_date)} · {shopWorkflowLabel(row)}
            </p>
          )}
          <button type="button" className="al-modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form onSubmit={submit}>
          {visitWindow && (
            <p className="al-modal__hint">
              Allowed: {fmtDMY(visitWindow.min)} – {fmtDMY(visitWindow.max)} (before leave on {fmtDMY(row.from_date)}).
            </p>
          )}
          <div className="al-modal__field">
            <label>New visit date *</label>
            <input
              type="date"
              value={date}
              min={visitWindow?.min}
              max={visitWindow?.max}
              onChange={(e) => setDate(e.target.value)}
              required
            />
          </div>
          <div className="al-modal__field">
            <label>New visit time *</label>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </div>
          <div className="al-modal__field">
            <label>Internal note</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
          </div>
          {err && <p className="al-modal__err">{err}</p>}
          <div className="al-modal__actions al-modal__actions--sticky">
            <button type="button" className="al-btn al-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="al-btn al-btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function ShopVisitConfirmModal({ row, onSave, onClose }) {
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    try {
      await onSave(row.id, { shop_visit_admin_note: remarks.trim() || null })
      onClose()
    } catch (ex) {
      setErr(ex.message || 'Failed')
      setSaving(false)
    }
  }

  return (
    <div className="al-modal-overlay" onClick={onClose}>
      <div className="al-modal al-modal--contextual" onClick={(e) => e.stopPropagation()}>
        <div className="al-modal__head">
          <h3>Confirm main shop visit</h3>
          {row.full_name && (
            <p className="al-modal__kicker">
              {row.full_name} · {fmtDMY(row.from_date)} – {fmtDMY(row.to_date)} · {shopWorkflowLabel(row)}
            </p>
          )}
          <button type="button" className="al-modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <form onSubmit={submit}>
          <p className="sv-modal__summary">
            {fmtDMY(row.shop_visit_date)} at {row.shop_visit_time || '—'}
          </p>
          <div className="al-modal__field">
            <label>Internal note (optional)</label>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={2} />
          </div>
          {err && <p className="al-modal__err">{err}</p>}
          <div className="al-modal__actions al-modal__actions--sticky">
            <button type="button" className="al-btn al-btn--ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="al-btn al-btn--success" disabled={saving}>
              {saving ? 'Saving…' : 'Confirm'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Apply latest salary calculator snapshot to this leave (API may return 409 if none saved). */
export function ShopApplyCalculatorModal({ row, onApply, onClose, applying, applyError }) {
  if (!row) return null
  return (
    <div className="al-modal-overlay" onClick={onClose}>
      <div className="al-modal al-modal--contextual al-modal--scroll" onClick={(e) => e.stopPropagation()}>
        <div className="al-modal__head al-modal__head--split">
          <div>
            <h3>Apply salary calculator</h3>
            {row.full_name && (
              <p className="al-modal__kicker">
                {row.full_name} · {fmtDMY(row.from_date)} – {fmtDMY(row.to_date)} · {shopWorkflowLabel(row)}
              </p>
            )}
          </div>
          <button type="button" className="al-modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="al-modal__body-scroll">
          <p className="al-modal__hint">
            This copies the <strong>latest saved calculation</strong> from the Leave Salary Calculator for this employee onto
            this request. If nothing was saved in the calculator yet, the request will be rejected.
          </p>
          {applyError && <p className="al-modal__err al-modal__err--block">{applyError}</p>}
        </div>
        <div className="al-modal__actions al-modal__actions--sticky">
          <button type="button" className="al-btn al-btn--ghost" onClick={onClose} disabled={applying}>
            Cancel
          </button>
          <button type="button" className="al-btn al-btn--primary" onClick={() => onApply(row.id)} disabled={applying}>
            {applying ? 'Applying…' : 'Apply calculator'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ShopMarkCompleteModal({ row, onComplete, onClose, completing, err }) {
  if (!row) return null
  return (
    <div className="al-modal-overlay" onClick={onClose}>
      <div className="al-modal al-modal--contextual al-modal--scroll" onClick={(e) => e.stopPropagation()}>
        <div className="al-modal__head al-modal__head--split">
          <div>
            <h3>Mark shop visit completed</h3>
            {row.full_name && (
              <p className="al-modal__kicker">
                {row.full_name} · {fmtDMY(row.from_date)} – {fmtDMY(row.to_date)} · {shopWorkflowLabel(row)}
              </p>
            )}
          </div>
          <button type="button" className="al-modal__close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="al-modal__body-scroll">
          <p className="al-modal__hint">Confirm that passport and money have been collected at the main shop for this visit.</p>
          {err && <p className="al-modal__err">{err}</p>}
        </div>
        <div className="al-modal__actions al-modal__actions--sticky">
          <button type="button" className="al-btn al-btn--ghost" onClick={onClose} disabled={completing}>
            Cancel
          </button>
          <button type="button" className="al-btn al-btn--primary" onClick={() => onComplete(row.id)} disabled={completing}>
            {completing ? 'Saving…' : 'Mark completed'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Admin filter chips: shop_visit_status subset */
export function shopVisitFilterMatch(row, filterKey) {
  if (!filterKey || filterKey === 'All') return true
  if (row.status !== 'Approved') return false
  const sv = row.shop_visit_status || 'PendingSubmission'
  if (filterKey === 'ShopPendingSubmission') return sv === 'PendingSubmission' || !row.shop_visit_status
  if (filterKey === 'ShopSubmitted') return sv === 'Submitted'
  if (filterKey === 'ShopConfirmed') return sv === 'Confirmed'
  if (filterKey === 'ShopMoneyCalculated') return sv === 'MoneyCalculated'
  if (filterKey === 'ShopCompleted') return sv === 'Completed'
  return true
}

export const SHOP_VISIT_FILTER_TABS = [
  { key: 'All', label: 'All' },
  { key: 'ShopPendingSubmission', label: 'Shop: awaiting employee' },
  { key: 'ShopSubmitted', label: 'Shop: submitted' },
  { key: 'ShopConfirmed', label: 'Shop: confirmed' },
  { key: 'ShopMoneyCalculated', label: 'Shop: money calculated' },
  { key: 'ShopCompleted', label: 'Shop: completed' },
]
