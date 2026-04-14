import { useState, useMemo, useCallback, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useEmployees } from '../hooks/useEmployees'
import { useAnnualLeave } from '../hooks/useAnnualLeave'
import { AnnualLeaveSalaryPage } from './AnnualLeaveSalaryPage'
import { fmtDMY, fmtISO } from '../utils/dateFormat'
import {
  openAnnualLeaveLetterPreview,
  downloadAnnualLeaveLetterPdf,
} from '../api/annualLeaveDocuments'
import './Page.css'
import './AnnualLeavePage.css'

// ── helpers ──────────────────────────────────────────────────────────────────
function daysBetween(from, to) {
  if (!from || !to) return 0
  const diff = new Date(`${fmtISO(to)}T12:00:00Z`) - new Date(`${fmtISO(from)}T12:00:00Z`)
  return Math.max(0, Math.floor(diff / 86400000) + 1)
}
function todayISO() { return new Date().toISOString().slice(0, 10) }

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconEdit() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.5 2.5a2.121 2.121 0 0 1 3 3L6 17l-4 1 1-4L14.5 2.5z"/>
    </svg>
  )
}
function IconTrash() {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 5h14M8 5V3h4v2M6 5l1 12h6l1-12"/>
    </svg>
  )
}
function IconChevron({ up }) {
  return (
    <svg viewBox="0 0 20 20" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d={up ? 'M5 12l5-5 5 5' : 'M5 8l5 5 5-5'} />
    </svg>
  )
}

// ── Status config ─────────────────────────────────────────────────────────────
const STATUS_CFG = {
  Pending:       { label: 'Pending',           color: '#b45309', bg: '#fef3c7', dot: '#f59e0b' },
  Approved:      { label: 'Approved',          color: '#1d4ed8', bg: '#dbeafe', dot: '#3b82f6' },
  Ongoing:       { label: 'On Leave',          color: '#6d28d9', bg: '#ede9fe', dot: '#8b5cf6' },
  ReturnPending: { label: 'Return Pending',    color: '#c2410c', bg: '#ffedd5', dot: '#f97316' },
  Completed:     { label: 'Completed',         color: '#15803d', bg: '#dcfce7', dot: '#22c55e' },
  Overstayed:    { label: 'Overstayed',        color: '#b91c1c', bg: '#fee2e2', dot: '#ef4444' },
  Rejected:      { label: 'Rejected',          color: '#4b5563', bg: '#f3f4f6', dot: '#9ca3af' },
}
function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.Pending
  return (
    <span className="al-badge" style={{ color: cfg.color, background: cfg.bg }}>
      <span className="al-badge__dot" style={{ background: cfg.dot }} />
      {cfg.label}
    </span>
  )
}

// ── Avatar ────────────────────────────────────────────────────────────────────
function EmpAvatar({ name, photoUrl, size = 36 }) {
  const initial = (name || '?')[0].toUpperCase()
  return (
    <div className="al-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {photoUrl ? <img src={photoUrl} alt="" /> : initial}
    </div>
  )
}

// ── Timeline ─────────────────────────────────────────────────────────────────
function Timeline({ row }) {
  const t = todayISO()
  const steps = [
    { label: 'Applied',      date: row.created_at,         done: true },
    { label: 'Approved',     date: row.updated_at,         done: row.status === 'Approved' || !!row.actual_return_date },
    { label: 'Leave starts', date: row.from_date,          done: t >= fmtISO(row.from_date) && row.status === 'Approved' },
    { label: 'Leave ends',   date: row.to_date,            done: t > fmtISO(row.to_date) && row.status === 'Approved' },
    { label: 'Returned',     date: row.actual_return_date, done: !!row.actual_return_date },
  ]
  return (
    <div className="al-timeline">
      {steps.map((s, i) => (
        <div key={i} className={`al-timeline__step ${s.done ? 'al-timeline__step--done' : ''}`}>
          <div className="al-timeline__node" />
          {i < steps.length - 1 && <div className="al-timeline__line" />}
          <div className="al-timeline__info">
            <span className="al-timeline__label">{s.label}</span>
            <span className="al-timeline__date">{fmtDMY(s.date)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Confirm Return modal ──────────────────────────────────────────────────────
function ConfirmReturnModal({ row, onConfirm, onClose }) {
  const expectedReturn = row.expected_return_date ? fmtISO(row.expected_return_date) : todayISO()
  const [returnDate, setReturnDate] = useState(expectedReturn <= todayISO() ? expectedReturn : todayISO())
  const [remarks, setRemarks]       = useState(row.admin_remarks || '')
  const [saving, setSaving]         = useState(false)
  const [err, setErr]               = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!returnDate) return setErr('Return date is required')
    setSaving(true)
    try {
      await onConfirm(row.id, { actual_return_date: returnDate, admin_remarks: remarks })
      onClose()
    } catch (ex) { setErr(ex.message || 'Failed'); setSaving(false) }
  }
  return (
    <div className="al-modal-overlay" onClick={onClose}>
      <div className="al-modal" onClick={e => e.stopPropagation()}>
        <div className="al-modal__head">
          <h3>Confirm Employee Return</h3>
          <button className="al-modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="al-modal__emp">
          <EmpAvatar name={row.full_name} photoUrl={row.photo_url} />
          <div><strong>{row.full_name}</strong><span>{row.department}</span></div>
        </div>
        <form onSubmit={submit}>
          <div className="al-modal__field">
            <label>Expected Return Date</label>
            <input type="text" value={fmtDMY(expectedReturn)} readOnly className="al-modal__readonly" />
          </div>
          <div className="al-modal__field">
            <label>Actual Return Date *</label>
            <input type="date" value={returnDate} onChange={e => setReturnDate(e.target.value)} required />
          </div>
          <div className="al-modal__field">
            <label>Remarks</label>
            <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} placeholder="Optional notes…" />
          </div>
          {err && <p className="al-modal__err">{err}</p>}
          <div className="al-modal__actions">
            <button type="button" className="al-btn al-btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="al-btn al-btn--success" disabled={saving}>
              {saving ? 'Saving…' : '✓ Confirm Return'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Extend Leave modal ────────────────────────────────────────────────────────
function ExtendLeaveModal({ row, onExtend, onClose }) {
  const currentEnd = fmtISO(row.to_date)
  const [newEnd, setNewEnd]     = useState('')
  const [remarks, setRemarks]   = useState(row.admin_remarks || '')
  const [saving, setSaving]     = useState(false)
  const [err, setErr]           = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!newEnd || newEnd <= currentEnd) return setErr('New end date must be after ' + fmtDMY(currentEnd))
    setSaving(true)
    try {
      await onExtend(row.id, { new_to_date: newEnd, admin_remarks: remarks })
      onClose()
    } catch (ex) { setErr(ex.message || 'Failed'); setSaving(false) }
  }
  return (
    <div className="al-modal-overlay" onClick={onClose}>
      <div className="al-modal" onClick={e => e.stopPropagation()}>
        <div className="al-modal__head">
          <h3>Extend Annual Leave</h3>
          <button className="al-modal__close" onClick={onClose}>✕</button>
        </div>
        <div className="al-modal__emp">
          <EmpAvatar name={row.full_name} photoUrl={row.photo_url} />
          <div><strong>{row.full_name}</strong><span>{row.department}</span></div>
        </div>
        <form onSubmit={submit}>
          <div className="al-modal__field">
            <label>Current End Date</label>
            <input type="text" value={fmtDMY(currentEnd)} readOnly className="al-modal__readonly" />
          </div>
          <div className="al-modal__field">
            <label>New End Date *</label>
            <input type="date" value={newEnd} onChange={e => setNewEnd(e.target.value)} min={currentEnd} required />
          </div>
          <div className="al-modal__field">
            <label>Remarks</label>
            <textarea value={remarks} onChange={e => setRemarks(e.target.value)} rows={2} placeholder="Reason for extension…" />
          </div>
          {err && <p className="al-modal__err">{err}</p>}
          <div className="al-modal__actions">
            <button type="button" className="al-btn al-btn--ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="al-btn al-btn--primary" disabled={saving}>
              {saving ? 'Saving…' : '↗ Extend Leave'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ── Dashboard stat cards ──────────────────────────────────────────────────────
function DashboardCards({ stats, isAdmin, onFilterClick }) {
  if (!stats || !isAdmin) return null
  const cards = [
    { key: 'Ongoing',       label: 'On Leave Now',      value: stats.ongoing,              color: '#8b5cf6', bg: '#ede9fe', icon: '✈️' },
    { key: 'Approved',      label: 'Upcoming Leaves',   value: stats.upcoming,             color: '#3b82f6', bg: '#dbeafe', icon: '📅' },
    { key: 'ReturnPending', label: 'Return Pending',    value: stats.return_pending_total, color: '#f97316', bg: '#ffedd5', icon: '⏳' },
    { key: 'Overstayed',    label: 'Overstayed',        value: stats.overstayed,           color: '#ef4444', bg: '#fee2e2', icon: '⚠️' },
    { key: 'Pending',       label: 'Pending Approval',  value: stats.pending,              color: '#f59e0b', bg: '#fef3c7', icon: '🔔' },
    { key: 'Completed',     label: 'Completed (Month)', value: stats.completed_this_month, color: '#22c55e', bg: '#dcfce7', icon: '✅' },
  ]
  return (
    <div className="al-dashboard">
      {cards.map(c => (
        <button key={c.key} className="al-stat-card" style={{ borderTopColor: c.color }}
          onClick={() => onFilterClick(c.key)}>
          <div className="al-stat-card__icon" style={{ background: c.bg }}>{c.icon}</div>
          <div className="al-stat-card__body">
            <div className="al-stat-card__num" style={{ color: c.color }}>{c.value ?? 0}</div>
            <div className="al-stat-card__label">{c.label}</div>
          </div>
        </button>
      ))}
    </div>
  )
}

// ── Leave row ─────────────────────────────────────────────────────────────────
function LeaveRow({
  row,
  isAdmin,
  canEmployeeEditPending,
  onStatusChange,
  onConfirmReturn,
  onExtend,
  onDelete,
  onEdit,
  expanded,
  onToggle,
  yearTotal,
  onPreviewLeaveLetter,
  onDownloadLeaveLetter,
  onRegenerateLeaveLetter,
  letterBusyId,
}) {
  const es        = row.effective_status || row.status
  const leaveDays = row.leave_days ?? daysBetween(row.from_date, row.to_date)
  const canConfirm = isAdmin && ['Ongoing', 'ReturnPending', 'Overstayed'].includes(es) && !row.actual_return_date
  const canExtend  = isAdmin && ['Approved', 'Ongoing'].includes(es)
  const letterBusy = letterBusyId === row.id
  const employeeCanEditThis = canEmployeeEditPending && row.status === 'Pending'
  const showActions = isAdmin || employeeCanEditThis

  return (
    <>
      <tr className={`al-row ${expanded ? 'al-row--expanded' : ''}`} onClick={onToggle}>
        <td>
          <div className="al-row__emp">
            <EmpAvatar name={row.full_name} photoUrl={row.photo_url} />
            <div>
              <span className="al-row__name">{row.full_name}</span>
              <span className="al-row__dept">{row.department}</span>
            </div>
          </div>
        </td>
        <td>
          <div className="al-row__dates">
            <span>{fmtDMY(row.from_date)} → {fmtDMY(row.to_date)}</span>
          </div>
        </td>
        <td className="al-row__days-cell">
          <span className="al-row__days-num">{leaveDays}</span>
          <span className="al-row__days-label"> days</span>
        </td>
        <td className="al-row__yrtotal-cell">
          {yearTotal != null
            ? <><span className="al-row__days-num" style={{ color: '#6366f1' }}>{yearTotal}</span><span className="al-row__days-label"> days</span></>
            : <span className="al-row__days-label">—</span>}
        </td>
        <td><StatusBadge status={es} /></td>
        <td className="al-row__ret">
          {row.actual_return_date
            ? <span className="al-row__returned">↩ {fmtDMY(row.actual_return_date)}</span>
            : row.expected_return_date
              ? <span className="al-row__expected">Exp. {fmtDMY(row.expected_return_date)}</span>
              : '—'}
        </td>
        {showActions && (
          <td onClick={e => e.stopPropagation()}>
            <div className="al-row__acts">
              {row.status === 'Pending' && (
                isAdmin ? (
                <button className="al-btn al-btn--approve" onClick={() => onStatusChange(row, 'Approved')}>Approve</button>
                ) : null
              )}
              {canConfirm && (
                <button className="al-btn al-btn--success" onClick={() => onConfirmReturn(row)}>✓ Return</button>
              )}
              {canExtend && (
                <button className="al-btn al-btn--extend" onClick={() => onExtend(row)}>↗ Extend</button>
              )}
              {(isAdmin || employeeCanEditThis) && (
                <button className="al-icon-btn al-icon-btn--edit" title="Edit" onClick={() => onEdit(row)}>
                  <IconEdit />
                </button>
              )}
              {isAdmin && row.status === 'Pending' && (
                <button className="al-icon-btn al-icon-btn--del" title="Delete" onClick={() => onDelete(row.id)}>
                  <IconTrash />
                </button>
              )}
            </div>
          </td>
        )}
        <td className="al-row__chevron"><IconChevron up={expanded} /></td>
      </tr>
      {expanded && (
        <tr className="al-row-detail">
          <td colSpan={showActions ? 8 : 7}>
            <div className="al-detail">
              <div className="al-detail__left">
                <Timeline row={row} />
                {row.overstay_days > 0 && !row.actual_return_date && (
                  <div className="al-detail__overstay">
                    ⚠️ Overstayed by <strong>{row.overstay_days} day{row.overstay_days !== 1 ? 's' : ''}</strong>
                  </div>
                )}
                {row.detected_return_date && !row.actual_return_date && (
                  <div className="al-detail__detected">
                    🔍 Attendance detected from <strong>{fmtDMY(row.detected_return_date)}</strong> — confirm below
                  </div>
                )}
              </div>
              <div className="al-detail__right">
                <div className="al-detail__meta">
                  <div><span>Reason</span><span>{row.reason || '—'}</span></div>
                  <div><span>Applied</span><span>{fmtDMY(row.created_at)}</span></div>
                  <div><span>Expected Return</span><span>{fmtDMY(row.expected_return_date)}</span></div>
                  {row.actual_return_date && <div><span>Actual Return</span><span>{fmtDMY(row.actual_return_date)}</span></div>}
                  {row.overstay_days > 0 && <div><span>Overstay Days</span><span>{row.overstay_days}</span></div>}
                  {row.admin_remarks && <div><span>Admin Notes</span><span>{row.admin_remarks}</span></div>}
                  {row.alternate_employee_full_name && (
                    <div><span>Alternate (leave)</span><span>{row.alternate_employee_full_name}</span></div>
                  )}
                  {row.leave_request_pdf_generated_at && (
                    <div>
                      <span>Letter PDF saved</span>
                      <span>{fmtDMY(row.leave_request_pdf_generated_at)}</span>
                    </div>
                  )}
                </div>
                <div className="al-doc-actions" onClick={(e) => e.stopPropagation()}>
                  <span className="al-doc-actions__title">Formal leave letter</span>
                  <div className="al-doc-actions__btns">
                    <button
                      type="button"
                      className="al-btn al-btn--ghost al-btn--sm"
                      disabled={letterBusy}
                      onClick={() => onPreviewLeaveLetter(row.id)}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      className="al-btn al-btn--ghost al-btn--sm"
                      disabled={letterBusy}
                      onClick={() => onDownloadLeaveLetter(row.id)}
                    >
                      Download PDF
                    </button>
                    {isAdmin && (
                      <button
                        type="button"
                        className="al-btn al-btn--ghost al-btn--sm"
                        disabled={letterBusy}
                        onClick={() => onRegenerateLeaveLetter(row.id)}
                      >
                        {letterBusy ? 'Working…' : 'Regenerate'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// ── New Request form ──────────────────────────────────────────────────────────
function NewRequestForm({ employees, alternateCandidates, isAdmin, loggedInEmployeeId, onSubmit, empLoading }) {
  const [employeeId, setEmployeeId] = useState(isAdmin ? '' : loggedInEmployeeId || '')
  const [alternateEmployeeId, setAlternateEmployeeId] = useState('')
  const [fromDate, setFromDate]     = useState('')
  const [toDate, setToDate]         = useState('')
  const [reason, setReason]         = useState('')
  const [err, setErr]               = useState(null)
  const [saving, setSaving]         = useState(false)
  const [open, setOpen]             = useState(false)

  const options = useMemo(() => {
    const list = [...employees].sort((a, b) => a.name.localeCompare(b.name))
    if (!isAdmin && loggedInEmployeeId) return list.filter(e => String(e.id) === loggedInEmployeeId)
    return list
  }, [employees, isAdmin, loggedInEmployeeId])
  const alternateOptions = useMemo(() => {
    const selectedEmployeeId = String(employeeId || '')
    return [...alternateCandidates]
      .filter((e) => String(e.id) !== selectedEmployeeId)
      .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
  }, [alternateCandidates, employeeId])

  useEffect(() => {
    if (!isAdmin && loggedInEmployeeId) setEmployeeId(loggedInEmployeeId)
  }, [isAdmin, loggedInEmployeeId])
  useEffect(() => {
    if (alternateEmployeeId && String(alternateEmployeeId) === String(employeeId)) {
      setAlternateEmployeeId('')
    }
  }, [employeeId, alternateEmployeeId])

  async function handleSubmit(e) {
    e.preventDefault()
    setErr(null)
    if (!employeeId)            return setErr('Select an employee')
    if (!alternateEmployeeId)   return setErr('Select an alternate employee')
    if (!fromDate || !toDate)   return setErr('Dates are required')
    if (fromDate > toDate)      return setErr('From date must be before to date')
    setSaving(true)
    try {
      await onSubmit({
        employee_id: Number(employeeId),
        alternate_employee_id: Number(alternateEmployeeId),
        from_date: fromDate,
        to_date: toDate,
        reason: reason.trim() || null,
        status: 'Pending',
      })
      setFromDate(''); setToDate(''); setReason(''); setAlternateEmployeeId('')
      if (isAdmin) setEmployeeId('')
      setOpen(false)
    } catch (e2) { setErr(e2.message || 'Failed') }
    finally { setSaving(false) }
  }

  return (
    <div className="al-new-request-wrap">
      <button className="al-btn al-btn--primary" onClick={() => setOpen(o => !o)}>
        {open ? '✕ Cancel' : '+ New Leave Request'}
      </button>
      {open && (
        <div className="al-new-request-form">
          <form onSubmit={handleSubmit} className="al-form-row">
            <div className="al-form-field">
              <label>Employee</label>
              <select value={employeeId} onChange={e => setEmployeeId(e.target.value)}
                disabled={empLoading || saving || !isAdmin} required>
                <option value="">— Select —</option>
                {options.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.name} ({emp.department})</option>
                ))}
              </select>
            </div>
            <div className="al-form-field">
              <label>From date</label>
              <input
                type="date"
                value={fromDate}
                onChange={e => setFromDate(e.target.value)}
                max={toDate || undefined}
                disabled={saving}
                required
              />
            </div>
            <div className="al-form-field">
              <label>Alternate employee</label>
              <select
                value={alternateEmployeeId}
                onChange={e => setAlternateEmployeeId(e.target.value)}
                disabled={empLoading || saving}
                required
              >
                <option value="">— Select —</option>
                {alternateOptions.map(emp => (
                  <option key={emp.id} value={emp.id}>{emp.full_name} ({emp.employee_code})</option>
                ))}
              </select>
            </div>
            <div className="al-form-field">
              <label>To date</label>
              <input
                type="date"
                value={toDate}
                onChange={e => setToDate(e.target.value)}
                min={fromDate || undefined}
                disabled={saving}
                required
              />
            </div>
            <div className="al-form-field al-form-field--grow">
              <label>Reason (optional)</label>
              <input type="text" value={reason} onChange={e => setReason(e.target.value)} placeholder="Optional" disabled={saving} />
            </div>
            <div className="al-form-field al-form-field--btn">
              <button type="submit" className="al-btn al-btn--primary" disabled={saving || empLoading}>
                {saving ? 'Submitting…' : 'Submit'}
              </button>
            </div>
          </form>
          {err && <p className="al-form-err">{err}</p>}
        </div>
      )}
    </div>
  )
}

// ── Edit row (inline) ─────────────────────────────────────────────────────────
function EditRowForm({ row, employees, alternateCandidates, onSave, onCancel, empLoading, isAdmin }) {
  const [empId,  setEmpId]  = useState(String(row.employee_id))
  const [alternateEmpId, setAlternateEmpId] = useState(
    row.alternate_employee_id != null ? String(row.alternate_employee_id) : ''
  )
  const [from,   setFrom]   = useState(fmtISO(row.from_date))
  const [to,     setTo]     = useState(fmtISO(row.to_date))
  const [reason, setReason] = useState(row.reason || '')
  const [status, setStatus] = useState(row.status)
  const [err,    setErr]    = useState('')
  const [saving, setSaving] = useState(false)
  const alternateOptions = useMemo(
    () => alternateCandidates.filter((e) => String(e.id) !== String(empId)),
    [alternateCandidates, empId]
  )

  async function submit(e) {
    e.preventDefault()
    if (!from || !to || from > to) return setErr('Invalid dates')
    if (!alternateEmpId) return setErr('Alternate employee is required')
    setSaving(true)
    try {
      await onSave(row.id, {
        employee_id: Number(empId),
        alternate_employee_id: Number(alternateEmpId),
        from_date: from,
        to_date: to,
        reason: reason.trim() || null,
        status,
      })
      onCancel()
    } catch (e2) { setErr(e2.message || 'Update failed'); setSaving(false) }
  }

  return (
    <tr className="al-row al-row--editing">
      <td colSpan={8}>
        <form onSubmit={submit} className="al-form-row al-form-row--edit">
          <div className="al-form-field">
            <label>Employee</label>
            <select value={empId} onChange={e => setEmpId(e.target.value)} disabled={empLoading || saving} required>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
          <div className="al-form-field">
            <label>From</label>
            <input
              type="date"
              value={from}
              onChange={e => setFrom(e.target.value)}
              max={to || undefined}
              required
              disabled={saving}
            />
          </div>
          <div className="al-form-field">
            <label>To</label>
            <input
              type="date"
              value={to}
              onChange={e => setTo(e.target.value)}
              min={from || undefined}
              required
              disabled={saving}
            />
          </div>
          <div className="al-form-field">
            <label>Alternate</label>
            <select
              value={alternateEmpId}
              onChange={e => setAlternateEmpId(e.target.value)}
              disabled={empLoading || saving}
              required
            >
              <option value="">— Select —</option>
              {alternateOptions.map(emp => (
                <option key={emp.id} value={emp.id}>{emp.full_name} ({emp.employee_code})</option>
              ))}
            </select>
          </div>
          <div className="al-form-field">
            <label>Status</label>
            {isAdmin ? (
              <select value={status} onChange={e => setStatus(e.target.value)} disabled={saving}>
                <option value="Pending">Pending</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
              </select>
            ) : (
              <input type="text" value="Pending" readOnly className="al-modal__readonly" />
            )}
          </div>
          <div className="al-form-field al-form-field--grow">
            <label>Reason</label>
            <input type="text" value={reason} onChange={e => setReason(e.target.value)} disabled={saving} />
          </div>
          <div className="al-form-field al-form-field--btn">
            <button type="submit" className="al-btn al-btn--primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button type="button" className="al-btn al-btn--ghost"   onClick={onCancel} disabled={saving}>Cancel</button>
          </div>
        </form>
        {err && <p className="al-form-err">{err}</p>}
      </td>
    </tr>
  )
}

// ── Sortable column header ─────────────────────────────────────────────────────
function SortHeader({ col, label, current, dir, onSort, style }) {
  const active = current === col
  return (
    <th className={`al-th-sort ${active ? 'al-th-sort--active' : ''}`} style={style} onClick={() => onSort(col)}>
      <span className="al-th-sort__label">{label}</span>
      <span className="al-th-sort__icon">{active ? (dir === 'asc' ? '↑' : '↓') : '↕'}</span>
    </th>
  )
}

// ── Table headers shared ──────────────────────────────────────────────────────
function TableHead({ showActions, sortBy, sortDir, onSort }) {
  return (
    <thead>
      <tr>
        <SortHeader col="name"        label="Employee"     current={sortBy} dir={sortDir} onSort={onSort} />
        <SortHeader col="from_date"   label="Leave Period" current={sortBy} dir={sortDir} onSort={onSort} />
        <SortHeader col="days"        label="Days"         current={sortBy} dir={sortDir} onSort={onSort} style={{ width: 72, textAlign: 'center' }} />
        <SortHeader col="yr_total"    label="This Year"    current={sortBy} dir={sortDir} onSort={onSort} style={{ width: 90, textAlign: 'center' }} />
        <SortHeader col="status"      label="Status"       current={sortBy} dir={sortDir} onSort={onSort} />
        <SortHeader col="return_date" label="Return Date"  current={sortBy} dir={sortDir} onSort={onSort} />
        {showActions && <th>Actions</th>}
        <th />
      </tr>
    </thead>
  )
}

// ── Section group ─────────────────────────────────────────────────────────────
const SECTION_DEFS = [
  { key: 'Pending',       label: 'Pending Requests' },
  { key: 'Ongoing',       label: 'On Leave Now' },
  { key: 'ReturnPending', label: 'Return Pending Confirmation' },
  { key: 'Overstayed',    label: 'Overstayed / Not Returned' },
  { key: 'Approved',      label: 'Approved / Upcoming' },
  { key: 'Completed',     label: 'Completed Leaves' },
  { key: 'Rejected',      label: 'Rejected' },
]

function SectionGroup({
  sectionKey, label, rows, isAdmin,
  canEmployeeEditPending,
  showActionsColumn,
  sortBy, sortDir, onSort,
  expandedId, onToggle,
  editingRow, setEditingRow,
  employees, alternateCandidates, empLoading,
  yearTotals, updateRequest,
  onStatusChange, onConfirmReturn, onExtend, onDelete, onEditStart,
  onPreviewLeaveLetter,
  onDownloadLeaveLetter,
  onRegenerateLeaveLetter,
  letterBusyId,
}) {
  const [collapsed, setCollapsed] = useState(false)
  const cfg = STATUS_CFG[sectionKey] || {}

  if (rows.length === 0) return null

  return (
    <div className="al-section">
      <div className="al-section__head" onClick={() => setCollapsed(c => !c)}
           style={{ borderLeftColor: cfg.dot || '#6366f1' }}>
        <span className="al-section__dot" style={{ background: cfg.dot || '#6366f1' }} />
        <span className="al-section__title">{label}</span>
        <span className="al-section__count">{rows.length}</span>
        <span className="al-section__chevron"><IconChevron up={!collapsed} /></span>
      </div>
      {!collapsed && (
        <div className="al-table-wrap al-table-wrap--section">
          <table className="al-table">
            <TableHead showActions={showActionsColumn} sortBy={sortBy} sortDir={sortDir} onSort={onSort} />
            <tbody>
              {rows.map(row =>
                editingRow?.id === row.id ? (
                  <EditRowForm
                    key={row.id}
                    row={editingRow}
                    employees={employees}
                    alternateCandidates={alternateCandidates}
                    onSave={updateRequest}
                    onCancel={() => setEditingRow(null)}
                    empLoading={empLoading}
                    isAdmin={isAdmin}
                  />
                ) : (
                  <LeaveRow
                    key={row.id}
                    row={row}
                    isAdmin={isAdmin}
                    canEmployeeEditPending={canEmployeeEditPending}
                    onStatusChange={onStatusChange}
                    onConfirmReturn={onConfirmReturn}
                    onExtend={onExtend}
                    onDelete={onDelete}
                    onEdit={onEditStart}
                    expanded={expandedId === row.id}
                    onToggle={() => onToggle(row.id)}
                    yearTotal={yearTotals[String(row.employee_id)] ?? null}
                    onPreviewLeaveLetter={onPreviewLeaveLetter}
                    onDownloadLeaveLetter={onDownloadLeaveLetter}
                    onRegenerateLeaveLetter={onRegenerateLeaveLetter}
                    letterBusyId={letterBusyId}
                  />
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Filter tabs ───────────────────────────────────────────────────────────────
const FILTER_TABS = [
  { key: 'All',           label: 'All' },
  { key: 'Pending',       label: 'Pending' },
  { key: 'Approved',      label: 'Upcoming' },
  { key: 'Ongoing',       label: 'On Leave' },
  { key: 'ReturnPending', label: 'Return Pending' },
  { key: 'Completed',     label: 'Completed' },
  { key: 'Overstayed',    label: 'Overstayed' },
  { key: 'Rejected',      label: 'Rejected' },
]

// ── Main page ─────────────────────────────────────────────────────────────────
export function AnnualLeavePage() {
  const { user }    = useAuth()
  const isAdmin     = user?.role === 'admin'
  const isEmployee  = user?.role === 'employee'
  const canEmployeeEditPending = isEmployee
  const showActionsColumn = isAdmin || canEmployeeEditPending
  const loggedInEmpId = user?.employeeId ? String(user.employeeId) : null

  const { employees, loading: empLoading } = useEmployees()
  const {
    requests, loading, error, dashboard, alternateOptions,
    createRequest, updateRequest, deleteRequest, confirmReturn, extendLeave, regenerateLeaveLetter,
  } = useAnnualLeave()

  const [activeTab,    setActiveTab]    = useState('requests')
  const [filterStatus, setFilterStatus] = useState('All')
  const [search,       setSearch]       = useState('')
  const [deptFilter,   setDeptFilter]   = useState('')
  const [expandedId,   setExpandedId]   = useState(null)
  const [editingRow,   setEditingRow]   = useState(null)
  const [confirmRow,   setConfirmRow]   = useState(null)
  const [extendRow,    setExtendRow]    = useState(null)
  const [sortBy,       setSortBy]       = useState('from_date')
  const [sortDir,      setSortDir]      = useState('desc')
  const [letterBusyId, setLetterBusyId] = useState(null)

  const handlePreviewLeaveLetter = useCallback(async (id) => {
    try {
      await openAnnualLeaveLetterPreview(id)
    } catch (e) {
      window.alert(e.message || 'Could not open the document.')
    }
  }, [])

  const handleDownloadLeaveLetter = useCallback(async (id) => {
    try {
      await downloadAnnualLeaveLetterPdf(id)
    } catch (e) {
      window.alert(e.message || 'Download failed.')
    }
  }, [])

  const handleRegenerateLeaveLetter = useCallback(
    async (id) => {
      if (!window.confirm('Regenerate the leave request PDF from current employee and leave data?')) return
      setLetterBusyId(id)
      try {
        await regenerateLeaveLetter(id)
      } catch (e) {
        window.alert(e.message || 'Regeneration failed.')
      } finally {
        setLetterBusyId(null)
      }
    },
    [regenerateLeaveLetter]
  )

  function handleSort(col) {
    setSortBy(prev => {
      if (prev === col) { setSortDir(d => d === 'asc' ? 'desc' : 'asc'); return col }
      setSortDir('asc'); return col
    })
  }

  // Total leave days this calendar year per employee (approved/active/completed)
  const yearTotals = useMemo(() => {
    const yr = new Date().getFullYear()
    const totals = {}
    requests.forEach(r => {
      const es = r.effective_status || r.status
      if (['Approved','Ongoing','ReturnPending','Completed','Overstayed'].includes(es)) {
        const fromYr = new Date(fmtISO(r.from_date) + 'T12:00:00Z').getFullYear()
        if (fromYr === yr) {
          const k = String(r.employee_id)
          totals[k] = (totals[k] || 0) + (r.leave_days || daysBetween(r.from_date, r.to_date))
        }
      }
    })
    return totals
  }, [requests])

  // Unique departments
  const departments = useMemo(() => {
    const s = new Set(requests.map(r => r.department).filter(Boolean))
    return Array.from(s).sort()
  }, [requests])

  // Restrict to own requests for employee role
  const visibleRequests = useMemo(() => {
    if (!isEmployee || !loggedInEmpId) return requests
    return requests.filter(r => String(r.employee_id) === loggedInEmpId)
  }, [requests, isEmployee, loggedInEmpId])

  // Apply search + dept filter + sort (status grouping handled separately)
  const baseFiltered = useMemo(() => {
    let list = visibleRequests
    if (deptFilter) list = list.filter(r => r.department === deptFilter)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        (r.full_name || '').toLowerCase().includes(q) ||
        (r.department || '').toLowerCase().includes(q) ||
        (r.employee_code || '').toLowerCase().includes(q)
      )
    }
    return [...list].sort((a, b) => {
      let va, vb
      switch (sortBy) {
        case 'name':        va = a.full_name || '';              vb = b.full_name || '';              break
        case 'dept':        va = a.department || '';             vb = b.department || '';             break
        case 'from_date':   va = a.from_date || '';              vb = b.from_date || '';              break
        case 'days':        va = a.leave_days || daysBetween(a.from_date, a.to_date);
                            vb = b.leave_days || daysBetween(b.from_date, b.to_date);                break
        case 'yr_total':    va = yearTotals[String(a.employee_id)] || 0;
                            vb = yearTotals[String(b.employee_id)] || 0;                             break
        case 'status':      va = a.effective_status || a.status; vb = b.effective_status || b.status; break
        case 'return_date': va = a.expected_return_date || '';   vb = b.expected_return_date || '';  break
        default:            return 0
      }
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ?  1 : -1
      return 0
    })
  }, [visibleRequests, deptFilter, search, sortBy, sortDir, yearTotals])

  // For single-status filter view
  const filteredRequests = useMemo(() => {
    if (filterStatus === 'All') return baseFiltered
    return baseFiltered.filter(r => (r.effective_status || r.status) === filterStatus)
  }, [baseFiltered, filterStatus])

  // Tab counts
  const tabCounts = useMemo(() => {
    const counts = {}
    baseFiltered.forEach(r => {
      const es = r.effective_status || r.status
      counts[es] = (counts[es] || 0) + 1
    })
    counts.All = baseFiltered.length
    return counts
  }, [baseFiltered])

  const toggleExpand = useCallback((id) => {
    setExpandedId(prev => prev === id ? null : id)
    setEditingRow(null)
  }, [])

  async function onStatusChange(row, nextStatus) {
    if (nextStatus === row.status) return
    try {
      await updateRequest(row.id, {
        employee_id: row.employee_id,
        alternate_employee_id: row.alternate_employee_id,
        from_date:   fmtISO(row.from_date),
        to_date:     fmtISO(row.to_date),
        reason:      row.reason,
        status:      nextStatus,
      })
    } catch (e) { window.alert(e.message || 'Update failed') }
  }

  async function onDelete(id) {
    if (!window.confirm('Delete this leave request?')) return
    try { await deleteRequest(id) } catch (e) { window.alert(e.message || 'Delete failed') }
  }

  const onEditStart = useCallback(r => { setEditingRow(r); setExpandedId(null) }, [])

  // Shared props for SectionGroup
  const sectionProps = {
    isAdmin,
    canEmployeeEditPending,
    showActionsColumn,
    sortBy, sortDir, onSort: handleSort,
    expandedId, onToggle: toggleExpand,
    editingRow, setEditingRow,
    employees, alternateCandidates: alternateOptions, empLoading,
    yearTotals, updateRequest,
    onStatusChange,
    onConfirmReturn: r => setConfirmRow(r),
    onExtend:        r => setExtendRow(r),
    onDelete,
    onEditStart,
    onPreviewLeaveLetter: handlePreviewLeaveLetter,
    onDownloadLeaveLetter: handleDownloadLeaveLetter,
    onRegenerateLeaveLetter: handleRegenerateLeaveLetter,
    letterBusyId,
  }

  return (
    <div className="page al-page">
      <div className="page-header">
        <h1 className="page-title">Annual Leave</h1>
      </div>

      {/* ── Sub-tabs ── */}
      <div className="al-tabs">
        <button className={`al-tab ${activeTab === 'requests' ? 'al-tab--active' : ''}`}
          onClick={() => setActiveTab('requests')}>
          Leave Management
        </button>
        {isAdmin && (
          <button className={`al-tab ${activeTab === 'salary' ? 'al-tab--active' : ''}`}
            onClick={() => setActiveTab('salary')}>
            Leave Salary Calculator
          </button>
        )}
      </div>

      {activeTab === 'salary' && isAdmin && (
        <AnnualLeaveSalaryPage embedded employees={employees} />
      )}

      {activeTab === 'requests' && (
        <>
          {error && <p className="page-error">{error}</p>}

          <DashboardCards
            stats={dashboard}
            isAdmin={isAdmin}
            onFilterClick={key => { setFilterStatus(key); setSearch('') }}
          />

          <NewRequestForm
            employees={employees}
            alternateCandidates={alternateOptions}
            isAdmin={isAdmin}
            loggedInEmployeeId={loggedInEmpId}
            onSubmit={createRequest}
            empLoading={empLoading}
          />

          {/* Filter bar */}
          <div className="al-filter-bar">
            <div className="al-filter-tabs">
              {FILTER_TABS.map(t => (
                <button key={t.key}
                  className={`al-filter-tab ${filterStatus === t.key ? 'al-filter-tab--active' : ''}`}
                  onClick={() => setFilterStatus(t.key)}>
                  {t.label}
                  {tabCounts[t.key] > 0 && <span className="al-filter-tab__count">{tabCounts[t.key]}</span>}
                </button>
              ))}
            </div>
            <div className="al-filter-bar__right">
              {departments.length > 0 && (
                <select className="al-filter-select" value={deptFilter} onChange={e => setDeptFilter(e.target.value)}>
                  <option value="">All Departments</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              )}
              <input className="al-search" type="text" placeholder="Search employee…"
                value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          </div>

          {loading && <p className="page-loading">Loading…</p>}

          {!loading && (
            filterStatus === 'All'
              /* ── Grouped sections (All) ── */
              ? (
                baseFiltered.length === 0
                  ? (
                    <div className="al-empty-state">
                      <div className="al-empty-state__icon">🏖️</div>
                      <p>No leave requests found.</p>
                    </div>
                  )
                  : SECTION_DEFS.map(sec => (
                    <SectionGroup
                      key={sec.key}
                      sectionKey={sec.key}
                      label={sec.label}
                      rows={baseFiltered.filter(r => (r.effective_status || r.status) === sec.key)}
                      {...sectionProps}
                    />
                  ))
              )
              /* ── Single-status view ── */
              : (
                filteredRequests.length === 0
                  ? (
                    <div className="al-empty-state">
                      <div className="al-empty-state__icon">🏖️</div>
                      <p>No leave requests for this filter.</p>
                    </div>
                  )
                  : (
                    <div className="al-table-wrap">
                      <table className="al-table">
                        <TableHead showActions={showActionsColumn} sortBy={sortBy} sortDir={sortDir} onSort={handleSort} />
                        <tbody>
                          {filteredRequests.map(row =>
                            editingRow?.id === row.id ? (
                              <EditRowForm
                                key={row.id}
                                row={editingRow}
                                employees={employees}
                                alternateCandidates={alternateOptions}
                                onSave={updateRequest}
                                onCancel={() => setEditingRow(null)}
                                empLoading={empLoading}
                                isAdmin={isAdmin}
                              />
                            ) : (
                              <LeaveRow
                                key={row.id}
                                row={row}
                                isAdmin={isAdmin}
                                canEmployeeEditPending={canEmployeeEditPending}
                                onStatusChange={onStatusChange}
                                onConfirmReturn={r => setConfirmRow(r)}
                                onExtend={r => setExtendRow(r)}
                                onDelete={onDelete}
                                onEdit={r => { setEditingRow(r); setExpandedId(null) }}
                                expanded={expandedId === row.id}
                                onToggle={() => toggleExpand(row.id)}
                                yearTotal={yearTotals[String(row.employee_id)] ?? null}
                                onPreviewLeaveLetter={handlePreviewLeaveLetter}
                                onDownloadLeaveLetter={handleDownloadLeaveLetter}
                                onRegenerateLeaveLetter={handleRegenerateLeaveLetter}
                                letterBusyId={letterBusyId}
                              />
                            )
                          )}
                        </tbody>
                      </table>
                    </div>
                  )
              )
          )}
        </>
      )}

      {/* Modals */}
      {confirmRow && (
        <ConfirmReturnModal row={confirmRow} onConfirm={confirmReturn} onClose={() => setConfirmRow(null)} />
      )}
      {extendRow && (
        <ExtendLeaveModal row={extendRow} onExtend={extendLeave} onClose={() => setExtendRow(null)} />
      )}
    </div>
  )
}
