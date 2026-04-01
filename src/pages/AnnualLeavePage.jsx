import { useState, useMemo } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useEmployees } from '../hooks/useEmployees'
import { useAnnualLeave } from '../hooks/useAnnualLeave'
import './Page.css'
import './AnnualLeavePage.css'


const STATUSES = ['Pending', 'Approved', 'Rejected']

function fmtDate(v) {
  if (v == null) return '—'
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string') return v.slice(0, 10)
  return String(v).slice(0, 10)
}

export function AnnualLeavePage() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { employees, loading: empLoading } = useEmployees()
  const {
    requests,
    loading,
    error,
    createRequest,
    updateRequest,
    deleteRequest,
  } = useAnnualLeave()

  const [employeeId, setEmployeeId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [reason, setReason] = useState('')
  const [formError, setFormError] = useState(null)
  const [saving, setSaving] = useState(false)

  const employeeOptions = useMemo(
    () => [...employees].sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  )

  async function handleSubmit(e) {
    e.preventDefault()
    setFormError(null)
    if (!employeeId) {
      setFormError('Select an employee')
      return
    }
    if (!fromDate || !toDate) {
      setFormError('From and To dates are required')
      return
    }
    if (fromDate > toDate) {
      setFormError('From date must be on or before To date')
      return
    }
    setSaving(true)
    try {
      await createRequest({
        employee_id: Number(employeeId),
        from_date: fromDate,
        to_date: toDate,
        reason: reason.trim() || null,
        status: 'Pending',
      })
      setReason('')
      setFromDate('')
      setToDate('')
      setEmployeeId('')
    } catch (err) {
      setFormError(err.message || 'Could not submit')
    } finally {
      setSaving(false)
    }
  }

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
    } catch (err) {
      window.alert(err.message || 'Update failed')
    }
  }

  async function onDelete(id) {
    if (!window.confirm('Delete this annual leave request?')) return
    try {
      await deleteRequest(id)
    } catch (err) {
      window.alert(err.message || 'Delete failed')
    }
  }

  return (
    <div className="page annual-leave-page">
      <div className="page-header">
        <h1 className="page-title">Annual Leave</h1>
      </div>

      {error && (
        <section className="page-section">
          <p className="page-error" role="alert">
            {error}
          </p>
        </section>
      )}

      <section className="page-section annual-leave-form-section">
        <h2 className="annual-leave-section-title">New request</h2>
        <form className="annual-leave-form" onSubmit={handleSubmit}>
          <label className="annual-leave-field">
            <span>Employee</span>
            <select
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              disabled={empLoading || saving}
              required
            >
              <option value="">— Select —</option>
              {employeeOptions.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name} ({emp.department})
                </option>
              ))}
            </select>
          </label>
          <label className="annual-leave-field">
            <span>From date</span>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              disabled={saving}
              required
            />
          </label>
          <label className="annual-leave-field">
            <span>To date</span>
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              disabled={saving}
              required
            />
          </label>
          <label className="annual-leave-field annual-leave-field--grow">
            <span>Reason (optional)</span>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Optional note"
              disabled={saving}
            />
          </label>
          <div className="annual-leave-form-actions">
            <button type="submit" className="annual-leave-submit" disabled={saving || empLoading}>
              {saving ? 'Submitting…' : 'Submit request'}
            </button>
          </div>
          {formError && (
            <p className="annual-leave-form-error" role="alert">
              {formError}
            </p>
          )}
        </form>
      </section>

      <section className="page-section page-section--fill">
        <h2 className="annual-leave-section-title">All requests</h2>
        {loading && <p className="page-loading">Loading…</p>}
        {!loading && requests.length === 0 && (
          <p className="annual-leave-empty">No annual leave requests yet.</p>
        )}
        {!loading && requests.length > 0 && (
          <div className="annual-leave-table-wrap">
            <table className="annual-leave-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  <th>Department</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Reason</th>
                  <th>Status</th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {requests.map((row) => (
                  <tr key={row.id}>
                    <td>{row.full_name}</td>
                    <td>{row.department}</td>
                    <td>{fmtDate(row.from_date)}</td>
                    <td>{fmtDate(row.to_date)}</td>
                    <td className="annual-leave-reason">{row.reason || '—'}</td>
                    <td>
                      {isAdmin ? (
                        <select
                          className="annual-leave-status-select"
                          value={row.status}
                          onChange={(e) => onStatusChange(row, e.target.value)}
                          aria-label={`Status for request ${row.id}`}
                        >
                          {STATUSES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      ) : (
                        row.status
                      )}
                    </td>
                    {isAdmin && (
                      <td>
                        <button
                          type="button"
                          className="annual-leave-delete"
                          onClick={() => onDelete(row.id)}
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
