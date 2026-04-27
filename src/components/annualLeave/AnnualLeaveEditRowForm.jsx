import { useState, useMemo } from 'react'
import { fmtISO } from '../../utils/dateFormat'

export function AnnualLeaveEditRowForm({ row, employees, alternateCandidates, onSave, onCancel, empLoading, isAdmin }) {
  const [empId, setEmpId] = useState(String(row.employee_id))
  const [alternateEmpId, setAlternateEmpId] = useState(
    row.alternate_employee_id != null ? String(row.alternate_employee_id) : ''
  )
  const [from, setFrom] = useState(fmtISO(row.from_date))
  const [to, setTo] = useState(fmtISO(row.to_date))
  const [reason, setReason] = useState(row.reason || '')
  const [status, setStatus] = useState(row.status)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const altOpts = useMemo(
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
    } catch (e2) {
      setErr(e2.message || 'Update failed')
      setSaving(false)
    }
  }

  return (
    <tr className="al-row al-row--editing">
      <td colSpan={8}>
        <form onSubmit={submit} className="al-form-row al-form-row--edit">
          <div className="al-form-field">
            <label>Employee</label>
            <select value={empId} onChange={(e) => setEmpId(e.target.value)} disabled={empLoading || saving} required>
              {employees.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>
          <div className="al-form-field">
            <label>From</label>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
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
              onChange={(e) => setTo(e.target.value)}
              min={from || undefined}
              required
              disabled={saving}
            />
          </div>
          <div className="al-form-field">
            <label>Alternate</label>
            <select
              value={alternateEmpId}
              onChange={(e) => setAlternateEmpId(e.target.value)}
              disabled={empLoading || saving}
              required
            >
              <option value="">— Select —</option>
              {altOpts.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.full_name} ({emp.employee_code})
                </option>
              ))}
            </select>
          </div>
          <div className="al-form-field">
            <label>Status</label>
            {isAdmin ? (
              <select value={status} onChange={(e) => setStatus(e.target.value)} disabled={saving}>
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
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} disabled={saving} />
          </div>
          <div className="al-form-field al-form-field--btn">
            <button type="submit" className="al-btn al-btn--primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button type="button" className="al-btn al-btn--ghost" onClick={onCancel} disabled={saving}>
              Cancel
            </button>
          </div>
        </form>
        {err && <p className="al-form-err">{err}</p>}
      </td>
    </tr>
  )
}
