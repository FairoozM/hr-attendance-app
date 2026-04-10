import { useState, useMemo, useCallback, useEffect } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useEmployees } from '../hooks/useEmployees'
import { useAnnualLeave } from '../hooks/useAnnualLeave'
import { AnnualLeaveSalaryPage } from './AnnualLeaveSalaryPage'
import './Page.css'
import './AnnualLeavePage.css'

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtDate(v) {
  if (v == null) return '—'
  return String(v).slice(0, 10)
}
function fmtDisplay(v) {
  const iso = fmtDate(v)
  if (!iso || iso === '—') return '—'
  const [y, m, d] = iso.split('-')
  return `${d}/${m}/${y}`
}
function daysBetween(from, to) {
  if (!from || !to) return 0
  const diff = new Date(`${fmtDate(to)}T12:00:00Z`) - new Date(`${fmtDate(from)}T12:00:00Z`)
  return Math.max(0, Math.floor(diff / 86400000) + 1)
}
function today() { return new Date().toISOString().slice(0, 10) }

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
  const steps = [
    { label: 'Applied',  date: row.created_at,           done: true },
    { label: 'Approved', date: row.updated_at,           done: row.status === 'Approved' || !!row.actual_return_date },
    { label: 'Leave starts', date: row.from_date,        done: today() >= fmtDate(row.from_date) && row.status === 'Approved' },
    { label: 'Leave ends',   date: row.to_date,          done: today() > fmtDate(row.to_date) && row.status === 'Approved' },
    { label: 'Returned', date: row.actual_return_date,   done: !!row.actual_return_date },
  ]
  return (
    <div className="al-timeline">
      {steps.map((s, i) => (
        <div key={i} className={`al-timeline__step ${s.done ? 'al-timeline__step--done' : ''}`}>
          <div className="al-timeline__node" />
          {i < steps.length - 1 && <div className="al-timeline__line" />}
          <div className="al-timeline__info">
            <span className="al-timeline__label">{s.label}</span>
            <span className="al-timeline__date">{s.date ? fmtDisplay(s.date) : '—'}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ── Confirm Return modal ──────────────────────────────────────────────────────
function ConfirmReturnModal({ row, onConfirm, onClose }) {
  const expectedReturn = row.expected_return_date ? fmtDate(row.expected_return_date) : today()
  const [returnDate, setReturnDate] = useState(expectedReturn <= today() ? expectedReturn : today())
  const [remarks, setRemarks] = useState(row.admin_remarks || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!returnDate) return setErr('Return date is required')
    setSaving(true)
    try {
      await onConfirm(row.id, { actual_return_date: returnDate, admin_remarks: remarks })
      onClose()
    } catch (e) { setErr(e.message || 'Failed'); setSaving(false) }
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
          <div>
            <strong>{row.full_name}</strong>
            <span>{row.department}</span>
          </div>
        </div>
        <form onSubmit={submit}>
          <div className="al-modal__field">
            <label>Expected Return Date</label>
            <input type="text" value={fmtDisplay(expectedReturn)} readOnly className="al-modal__readonly" />
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
  const currentEnd = fmtDate(row.to_date)
  const [newEnd, setNewEnd] = useState('')
  const [remarks, setRemarks] = useState(row.admin_remarks || '')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  async function submit(e) {
    e.preventDefault()
    if (!newEnd || newEnd <= currentEnd) return setErr('New end date must be after ' + fmtDisplay(currentEnd))
    setSaving(true)
    try {
      await onExtend(row.id, { new_to_date: newEnd, admin_remarks: remarks })
      onClose()
    } catch (e) { setErr(e.message || 'Failed'); setSaving(false) }
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
            <input type="text" value={fmtDisplay(currentEnd)} readOnly className="al-modal__readonly" />
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

function LeaveRow({ row, isAdmin, onStatusChange, onConfirmReturn, onExtend, onDelete, expanded, onToggle }) {
  const es = row.effective_status || row.status
  const canConfirm = isAdmin && ['Ongoing', 'ReturnPending', 'Overstayed'].includes(es) && !row.actual_return_date
  const canExtend  = isAdmin && ['Approved', 'Ongoing'].includes(es)

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
            <span>{fmtDisplay(row.from_date)} → {fmtDisplay(row.to_date)}</span>
            <span className="al-row__days">{row.leave_days ?? daysBetween(row.from_date, row.to_date)} days</span>
          </div>
        </td>
        <td><StatusBadge status={es} /></td>
        <td className="al-row__ret">
          {row.actual_return_date
            ? <span className="al-row__returned">↩ {fmtDisplay(row.actual_return_date)}</span>
            : row.expected_return_date
              ? <span className="al-row__expected">Exp. {fmtDisplay(row.expected_return_date)}</span>
              : '—'}
        </td>
        {isAdmin && (
          <td onClick={e => e.stopPropagation()}>
            <div className="al-row__acts">
              {row.status === 'Pending' && (
                <>
                  <button className="al-btn al-btn--approve" onClick={() => onStatusChange(row, 'Approved')}>Approve</button>
                  <button className="al-btn al-btn--reject"  onClick={() => onStatusChange(row, 'Rejected')}>Reject</button>
                </>
              )}
              {canConfirm && (
                <button className="al-btn al-btn--success" onClick={() => onConfirmReturn(row)}>
                  ✓ Return
                </button>
              )}
              {canExtend && (
                <button className="al-btn al-btn--extend" onClick={() => onExtend(row)}>
                  ↗ Extend
                </button>
              )}
              {row.status === 'Pending' && (
                <button className="al-btn al-btn--del" onClick={() => onDelete(row.id)}>Del</button>
              )}
            </div>
          </td>
        )}
        <td className="al-row__chevron">{expanded ? '▲' : '▼'}</td>
      </tr>
      {expanded && (
        <tr className="al-row-detail">
          <td colSpan={isAdmin ? 6 : 5}>
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
                    🔍 Attendance detected from <strong>{fmtDisplay(row.detected_return_date)}</strong> — confirm below
                  </div>
                )}
              </div>
              <div className="al-detail__right">
                <div className="al-detail__meta">
                  <div><span>Reason</span><span>{row.reason || '—'}</span></div>
                  <div><span>Applied</span><span>{fmtDisplay(row.created_at)}</span></div>
                  <div><span>Expected Return</span><span>{fmtDisplay(row.expected_return_date)}</span></div>
                  {row.actual_return_date && <div><span>Actual Return</span><span>{fmtDisplay(row.actual_return_date)}</span></div>}
                  {row.overstay_days > 0 && <div><span>Overstay Days</span><span>{row.overstay_days}</span></div>}
                  {row.admin_remarks && <div><span>Admin Notes</span><span>{row.admin_remarks}</span></div>}
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
function NewRequestForm({ employees, isAdmin, loggedInEmployeeId, onSubmit, empLoading }) {
  const [employeeId, setEmployeeId] = useState(isAdmin ? '' : loggedInEmployeeId || '')
  const [fromDate, setFromDate]   = useState('')
  const [toDate, setToDate]       = useState('')
  const [reason, setReason]       = useState('')
  const [err, setErr]             = useState(null)
  const [saving, setSaving]       = useState(false)
  const [open, setOpen]           = useState(false)

  const options = useMemo(() => {
    const list = [...employees].sort((a, b) => a.name.localeCompare(b.name))
    if (!isAdmin && loggedInEmployeeId) return list.filter(e => String(e.id) === loggedInEmployeeId)
    return list
  }, [employees, isAdmin, loggedInEmployeeId])

  useEffect(() => {
    if (!isAdmin && loggedInEmployeeId) setEmployeeId(loggedInEmployeeId)
  }, [isAdmin, loggedInEmployeeId])

  async function handleSubmit(e) {
    e.preventDefault()
    setErr(null)
    if (!employeeId) return setErr('Select an employee')
    if (!fromDate || !toDate) return setErr('Dates are required')
    if (fromDate > toDate) return setErr('From date must be before to date')
    setSaving(true)
    try {
      await onSubmit({ employee_id: Number(employeeId), from_date: fromDate, to_date: toDate, reason: reason.trim() || null, status: 'Pending' })
      setFromDate(''); setToDate(''); setReason('')
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
              <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} disabled={saving} required />
            </div>
            <div className="al-form-field">
              <label>To date</label>
              <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} disabled={saving} required />
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
function EditRowForm({ row, employees, onSave, onCancel, empLoading }) {
  const [empId,  setEmpId]  = useState(String(row.employee_id))
  const [from,   setFrom]   = useState(fmtDate(row.from_date))
  const [to,     setTo]     = useState(fmtDate(row.to_date))
  const [reason, setReason] = useState(row.reason || '')
  const [status, setStatus] = useState(row.status)
  const [err,    setErr]    = useState('')
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!from || !to || from > to) return setErr('Invalid dates')
    setSaving(true)
    try {
      await onSave(row.id, { employee_id: Number(empId), from_date: from, to_date: to, reason: reason.trim() || null, status })
      onCancel()
    } catch (e2) { setErr(e2.message || 'Update failed'); setSaving(false) }
  }

  return (
    <tr className="al-row al-row--editing">
      <td colSpan={6}>
        <form onSubmit={submit} className="al-form-row al-form-row--edit">
          <div className="al-form-field">
            <label>Employee</label>
            <select value={empId} onChange={e => setEmpId(e.target.value)} disabled={empLoading || saving} required>
              {employees.map(emp => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
            </select>
          </div>
          <div className="al-form-field">
            <label>From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} required disabled={saving} />
          </div>
          <div className="al-form-field">
            <label>To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} required disabled={saving} />
          </div>
          <div className="al-form-field">
            <label>Status</label>
            <select value={status} onChange={e => setStatus(e.target.value)} disabled={saving}>
              <option value="Pending">Pending</option>
              <option value="Approved">Approved</option>
              <option value="Rejected">Rejected</option>
            </select>
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

// ── Main page ─────────────────────────────────────────────────────────────────
export function AnnualLeavePage() {
  const { user } = useAuth()
  const isAdmin      = user?.role === 'admin'
  const isEmployee   = user?.role === 'employee'
  const loggedInEmpId = user?.employeeId ? String(user.employeeId) : null

  const { employees, loading: empLoading } = useEmployees()
  const { requests, loading, error, dashboard, createRequest, updateRequest, deleteRequest, confirmReturn, extendLeave } = useAnnualLeave()

  const [activeTab,    setActiveTab]    = useState('requests')
  const [filterStatus, setFilterStatus] = useState('All')
  const [search,       setSearch]       = useState('')
  const [expandedId,   setExpandedId]   = useState(null)
  const [editingRow,   setEditingRow]   = useState(null)
  const [confirmRow,   setConfirmRow]   = useState(null)
  const [extendRow,    setExtendRow]    = useState(null)

  // filter employees for the employee role
  const visibleRequests = useMemo(() => {
    if (!isEmployee || !loggedInEmpId) return requests
    return requests.filter(r => String(r.employee_id) === loggedInEmpId)
  }, [requests, isEmployee, loggedInEmpId])

  // filter by status tab + search
  const filteredRequests = useMemo(() => {
    let list = visibleRequests
    if (filterStatus !== 'All') {
      list = list.filter(r => (r.effective_status || r.status) === filterStatus)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(r =>
        (r.full_name || '').toLowerCase().includes(q) ||
        (r.department || '').toLowerCase().includes(q) ||
        (r.employee_code || '').toLowerCase().includes(q)
      )
    }
    return list
  }, [visibleRequests, filterStatus, search])

  // tab counts
  const tabCounts = useMemo(() => {
    const counts = {}
    visibleRequests.forEach(r => {
      const es = r.effective_status || r.status
      counts[es] = (counts[es] || 0) + 1
    })
    counts.All = visibleRequests.length
    return counts
  }, [visibleRequests])

  const toggleExpand = useCallback((id) => {
    setExpandedId(prev => prev === id ? null : id)
    setEditingRow(null)
  }, [])

  async function onStatusChange(row, nextStatus) {
    if (nextStatus === row.status) return
    try {
      await updateRequest(row.id, {
        employee_id: row.employee_id,
        from_date: fmtDate(row.from_date),
        to_date: fmtDate(row.to_date),
        reason: row.reason,
        status: nextStatus,
      })
    } catch (e) { window.alert(e.message || 'Update failed') }
  }

  async function onDelete(id) {
    if (!window.confirm('Delete this leave request?')) return
    try { await deleteRequest(id) } catch (e) { window.alert(e.message || 'Delete failed') }
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

          {/* Dashboard summary */}
          <DashboardCards
            stats={dashboard}
            isAdmin={isAdmin}
            onFilterClick={key => { setFilterStatus(key); setSearch('') }}
          />

          {/* New request */}
          <NewRequestForm
            employees={employees}
            isAdmin={isAdmin}
            loggedInEmployeeId={loggedInEmpId}
            onSubmit={createRequest}
            empLoading={empLoading}
          />

          {/* Filter tabs + search */}
          <div className="al-filter-bar">
            <div className="al-filter-tabs">
              {FILTER_TABS.map(t => (
                <button
                  key={t.key}
                  className={`al-filter-tab ${filterStatus === t.key ? 'al-filter-tab--active' : ''}`}
                  onClick={() => setFilterStatus(t.key)}
                >
                  {t.label}
                  {tabCounts[t.key] > 0 && (
                    <span className="al-filter-tab__count">{tabCounts[t.key]}</span>
                  )}
                </button>
              ))}
            </div>
            <input
              className="al-search"
              type="text"
              placeholder="Search employee…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          {/* Table */}
          {loading && <p className="page-loading">Loading…</p>}
          {!loading && filteredRequests.length === 0 && (
            <div className="al-empty-state">
              <div className="al-empty-state__icon">🏖️</div>
              <p>No leave requests found{filterStatus !== 'All' ? ` for "${filterStatus}"` : ''}.</p>
            </div>
          )}
          {!loading && filteredRequests.length > 0 && (
            <div className="al-table-wrap">
              <table className="al-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Leave Period</th>
                    <th>Status</th>
                    <th>Return Date</th>
                    {isAdmin && <th>Actions</th>}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {filteredRequests.map(row =>
                    editingRow?.id === row.id ? (
                      <EditRowForm
                        key={row.id}
                        row={editingRow}
                        employees={employees}
                        onSave={updateRequest}
                        onCancel={() => setEditingRow(null)}
                        empLoading={empLoading}
                      />
                    ) : (
                      <LeaveRow
                        key={row.id}
                        row={row}
                        isAdmin={isAdmin}
                        onStatusChange={onStatusChange}
                        onConfirmReturn={r => setConfirmRow(r)}
                        onExtend={r => setExtendRow(r)}
                        onDelete={onDelete}
                        expanded={expandedId === row.id}
                        onToggle={() => toggleExpand(row.id)}
                      />
                    )
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Modals */}
      {confirmRow && (
        <ConfirmReturnModal
          row={confirmRow}
          onConfirm={confirmReturn}
          onClose={() => setConfirmRow(null)}
        />
      )}
      {extendRow && (
        <ExtendLeaveModal
          row={extendRow}
          onExtend={extendLeave}
          onClose={() => setExtendRow(null)}
        />
      )}
    </div>
  )
}
