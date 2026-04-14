import { useState, useCallback, useEffect, useMemo } from 'react'
import { fmtDMY, fmtISO, shopVisitAllowedWindowISO, shopVisitDateValidationError } from '../../utils/dateFormat'
import './ShopVisitWorkflow.css'

/** Human-readable combined workflow label (leave + main shop). */
export function shopWorkflowLabel(row) {
  if (row.status === 'Pending') return 'Pending Leave Approval'
  if (row.status === 'Rejected') return 'Rejected'
  if (row.status !== 'Approved') return row.status || '—'
  const sv = row.shop_visit_status
  if (!sv || sv === 'PendingSubmission') return 'Shop Visit Pending Submission'
  switch (sv) {
    case 'Submitted':
      return 'Shop Visit Submitted'
    case 'Confirmed':
      return 'Shop Visit Confirmed'
    case 'MoneyCalculated':
      return 'Money Calculated'
    case 'Completed':
      return 'Completed'
    case 'Cancelled':
      return 'Cancelled'
    default:
      return sv || '—'
  }
}

const SHOP_BADGE_STYLES = {
  'Pending Leave Approval': { color: '#b45309', bg: '#fef3c7' },
  Rejected: { color: '#4b5563', bg: '#f3f4f6' },
  'Shop Visit Pending Submission': { color: '#0369a1', bg: '#e0f2fe' },
  'Shop Visit Submitted': { color: '#7c3aed', bg: '#ede9fe' },
  'Shop Visit Confirmed': { color: '#047857', bg: '#d1fae5' },
  'Money Calculated': { color: '#1d4ed8', bg: '#dbeafe' },
  Completed: { color: '#15803d', bg: '#dcfce7' },
  Cancelled: { color: '#991b1b', bg: '#fee2e2' },
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
export function EmployeeShopVisitForm({ row, onSubmit }) {
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

  return (
    <div className="sv-card">
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
    </div>
  )
}

export function AdminShopVisitPanel({
  row,
  onConfirm,
  onReschedule,
  onComplete,
  onApplyCalculator,
  onSaveAdminNote,
}) {
  if (row.status !== 'Approved') return null
  const sv = row.shop_visit_status || 'PendingSubmission'
  if (['Cancelled'].includes(sv)) {
    return (
      <div className="sv-admin">
        <p className="sv-admin__muted">Shop visit workflow cancelled for this leave.</p>
      </div>
    )
  }

  const [adminNote, setAdminNote] = useState(row.shop_visit_admin_note || '')
  const [noteSaving, setNoteSaving] = useState(false)
  const [noteErr, setNoteErr] = useState('')

  useEffect(() => {
    setAdminNote(row.shop_visit_admin_note || '')
  }, [row.id, row.shop_visit_admin_note])

  const saveNote = async () => {
    setNoteErr('')
    setNoteSaving(true)
    try {
      await onSaveAdminNote(row.id, { shop_visit_admin_note: adminNote })
    } catch (e) {
      setNoteErr(e.message || 'Failed')
    } finally {
      setNoteSaving(false)
    }
  }

  const snap = row.calculator_snapshot
  const amount = row.calculated_leave_amount

  return (
    <div className="sv-admin">
      <div className="sv-admin__head">Main shop visit — HR</div>
      <div className="sv-admin__grid">
        <div>
          <span className="sv-admin__label">Shop status</span>
          <strong>{shopWorkflowLabel(row)}</strong>
        </div>
        <div>
          <span className="sv-admin__label">Proposed / scheduled</span>
          <strong>
            {row.shop_visit_date ? fmtDMY(row.shop_visit_date) : '—'} {row.shop_visit_time ? `· ${row.shop_visit_time}` : ''}
          </strong>
        </div>
        {row.shop_visit_note && (
          <div className="sv-admin__full">
            <span className="sv-admin__label">Employee note</span>
            <span>{row.shop_visit_note}</span>
          </div>
        )}
        {(amount != null || snap) && (
          <div className="sv-admin__full sv-admin__calc">
            <span className="sv-admin__label">Settlement (from Leave Salary Calculator)</span>
            {amount != null && <div className="sv-admin__amount">AED {Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>}
            {snap?.annual_leave_salary_id != null && (
              <span className="sv-admin__muted">Record #{snap.annual_leave_salary_id} · {snap.calculation_date ? fmtDMY(snap.calculation_date) : ''}</span>
            )}
          </div>
        )}
      </div>

      <div className="sv-admin__note">
        <label>
          Internal admin note
          <textarea rows={2} value={adminNote} onChange={(e) => setAdminNote(e.target.value)} />
        </label>
        {noteErr && <p className="sv-form__err">{noteErr}</p>}
        <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={saveNote} disabled={noteSaving}>
          {noteSaving ? 'Saving…' : 'Save note'}
        </button>
      </div>

      <div className="sv-admin__actions">
        {sv === 'Submitted' && (
          <button type="button" className="al-btn al-btn--success al-btn--sm" onClick={() => onConfirm(row)}>
            Confirm visit
          </button>
        )}
        {['Submitted', 'Confirmed', 'MoneyCalculated'].includes(sv) && sv !== 'Completed' && (
          <button type="button" className="al-btn al-btn--extend al-btn--sm" onClick={() => onReschedule(row)}>
            Reschedule
          </button>
        )}
        {['Confirmed', 'MoneyCalculated'].includes(sv) && (
          <button type="button" className="al-btn al-btn--ghost al-btn--sm" onClick={() => onApplyCalculator(row.id)}>
            Sync calculator
          </button>
        )}
        {['Confirmed', 'MoneyCalculated'].includes(sv) && (
          <button type="button" className="al-btn al-btn--primary al-btn--sm" onClick={() => onComplete(row.id)}>
            Mark collection completed
          </button>
        )}
      </div>
    </div>
  )
}

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
      <div className="al-modal" onClick={(e) => e.stopPropagation()}>
        <div className="al-modal__head">
          <h3>Reschedule main shop visit</h3>
          <button type="button" className="al-modal__close" onClick={onClose}>
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
          <div className="al-modal__actions">
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
      <div className="al-modal" onClick={(e) => e.stopPropagation()}>
        <div className="al-modal__head">
          <h3>Confirm main shop visit</h3>
          <button type="button" className="al-modal__close" onClick={onClose}>
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
          <div className="al-modal__actions">
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
