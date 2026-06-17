import { useState, useMemo, useEffect } from 'react'
import { fmtISO } from '../../utils/dateFormat'

export function AnnualLeaveNewRequestForm({
  employees,
  alternateCandidates,
  isAdmin,
  loggedInEmployeeId,
  onSubmit,
  empLoading,
  open,
  setOpen,
}) {
  const [employeeId, setEmployeeId] = useState(isAdmin ? '' : loggedInEmployeeId || '')
  const [alternateEmployeeId, setAlternateEmployeeId] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [reason, setReason] = useState('')
  const [err, setErr] = useState(null)
  const [saving, setSaving] = useState(false)
  const isOpen = Boolean(open)

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
      setOpen?.(false)
    } catch (e2) {
      setErr(e2.message || 'Failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="al-new-request-wrap">
      {isOpen && (
        <div className="al-new-request-form">
          <div className="al-new-request-form__head">
            <div>
              <p className="al-new-request-form__eyebrow">New leave request</p>
              <h2>Review the leave details before submitting</h2>
            </div>
            <button type="button" className="al-btn al-btn--ghost" onClick={() => setOpen?.(false)}>
              Close
            </button>
          </div>
          <form onSubmit={handleSubmit} className="al-form-row">
            <section className="al-form-section">
              <span className="al-form-section__num">1</span>
              <div className="al-form-field">
                <label>Employee details</label>
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
                {!isAdmin && <span className="al-form-field__hint">Employee requests are locked to your own profile.</span>}
              </div>
            </section>
            <section className="al-form-section">
              <span className="al-form-section__num">2</span>
              <div className="al-form-field">
                <label>Leave from</label>
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
                <label>Leave to</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  min={fromDate || undefined}
                  disabled={saving}
                  required
                />
              </div>
            </section>
            <section className="al-form-section">
              <span className="al-form-section__num">3</span>
              <div className="al-form-field">
                <label>Alternate / handover</label>
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
            </section>
            <section className="al-form-section al-form-section--wide">
              <span className="al-form-section__num">4</span>
              <div className="al-form-field al-form-field--grow">
                <label>Reason (optional)</label>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Short note for HR"
                  disabled={saving}
                />
              </div>
            </section>
            <div className="al-form-field al-form-field--btn al-form-field--review">
              <span className="al-form-field__hint">The request will be submitted as Pending.</span>
              <button type="submit" className="al-btn al-btn--primary" disabled={saving || empLoading}>
                {saving ? 'Submitting…' : 'Submit request'}
              </button>
            </div>
          </form>
          {err && <p className="al-form-err">{err}</p>}
        </div>
      )}
    </div>
  )
}
