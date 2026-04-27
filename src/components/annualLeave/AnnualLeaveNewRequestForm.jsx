import { useState, useMemo, useEffect } from 'react'
import { fmtISO } from '../../utils/dateFormat'

export function AnnualLeaveNewRequestForm({ employees, alternateCandidates, isAdmin, loggedInEmployeeId, onSubmit, empLoading }) {
  const [employeeId, setEmployeeId] = useState(isAdmin ? '' : loggedInEmployeeId || '')
  const [alternateEmployeeId, setAlternateEmployeeId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const [open, setOpen] = useState(false)

  const options = useMemo(() => {
    const list = [...employees].sort((a, b) => a.name.localeCompare(b.name))
    if (!isAdmin && loggedInEmployeeId) return list.filter((e) => String(e.id) === loggedInEmployeeId)
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
    if (!employeeId) return setErr('Select an employee')
    if (!alternateEmployeeId) return setErr('Select an alternate employee')
    if (!fromDate || !toDate) return setErr('Dates are required')
    if (fromDate > toDate) return setErr('From date must be before to date')
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
      setFromDate('')
      setToDate('')
      setReason('')
      setAlternateEmployeeId('')
      if (isAdmin) setEmployeeId('')
      setOpen(false)
    } catch (e2) {
      setErr(e2.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="al-new-request-wrap">
      <button type="button" className="al-btn al-btn--primary" onClick={() => setOpen((o) => !o)}>
        {open ? 'Cancel' : 'New leave request'}
      </button>
      {open && (
        <div className="al-new-request-form">
          <form onSubmit={handleSubmit} className="al-form-row">
            <div className="al-form-field">
              <label>Employee</label>
              <select
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                disabled={empLoading || saving || !isAdmin}
                required
              >
                <option value="">— Select —</option>
                {options.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name} ({emp.department})
                  </option>
                ))}
              </select>
            </div>
            <div className="al-form-field">
              <label>From</label>
              <input
                type="date"
                value={fromDate}
                onChange={(e) => setFromDate(e.target.value)}
                max={toDate || undefined}
                disabled={saving}
                required
              />
            </div>
            <div className="al-form-field">
              <label>Alternate</label>
              <select
                value={alternateEmployeeId}
                onChange={(e) => setAlternateEmployeeId(e.target.value)}
                disabled={empLoading || saving}
                required
              >
                <option value="">— Select —</option>
                {alternateOptions.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.full_name} ({emp.employee_code})
                  </option>
                ))}
              </select>
            </div>
            <div className="al-form-field">
              <label>To</label>
              <input
                type="date"
                value={toDate}
                onChange={(e) => setToDate(e.target.value)}
                min={fromDate || undefined}
                disabled={saving}
                required
              />
            </div>
            <div className="al-form-field al-form-field--grow">
              <label>Reason (optional)</label>
              <input
                type="text"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Optional"
                disabled={saving}
              />
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
