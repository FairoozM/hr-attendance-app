import { useState, useMemo, useCallback } from 'react'
import { useAuth } from '../contexts/AuthContext'
import { useEmployees } from '../hooks/useEmployees'
import { useAnnualLeave } from '../hooks/useAnnualLeave'
import { ExcelStyleColumnFilter, excelFilterIsActive } from '../components/ExcelStyleColumnFilter'
import './Page.css'
import './AnnualLeavePage.css'


const STATUSES = ['Pending', 'Approved', 'Rejected']

function fmtDate(v) {
  if (v == null) return '—'
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'string') return v.slice(0, 10)
  return String(v).slice(0, 10)
}

function leaveDaysInclusive(fromDate, toDate) {
  if (!fromDate || !toDate) return 0
  const from = new Date(`${fmtDate(fromDate)}T00:00:00`)
  const to = new Date(`${fmtDate(toDate)}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 0
  const diffDays = Math.floor((to.getTime() - from.getTime()) / 86400000)
  return diffDays >= 0 ? diffDays + 1 : 0
}

function statusClass(status) {
  if (status === 'Approved') return 'annual-leave-status--approved'
  if (status === 'Rejected') return 'annual-leave-status--rejected'
  return 'annual-leave-status--pending'
}

const LEAVE_BLANK = '__blank__'

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
  const [openFilterId, setOpenFilterId] = useState(null)
  const [columnFilters, setColumnFilters] = useState({})
  const [sortKey, setSortKey] = useState('from')
  const [sortDir, setSortDir] = useState('desc')

  const employeeOptions = useMemo(
    () => [...employees].sort((a, b) => a.name.localeCompare(b.name)),
    [employees]
  )

  const rows = useMemo(
    () =>
      requests.map((row) => ({
        ...row,
        fromText: fmtDate(row.from_date),
        toText: fmtDate(row.to_date),
        days: leaveDaysInclusive(row.from_date, row.to_date),
        reasonText: row.reason || '—',
      })),
    [requests]
  )

  const filterOptionsByKey = useMemo(() => {
    const byKey = {
      employee: new Set(),
      department: new Set(),
      from: new Set(),
      to: new Set(),
      days: new Set(),
      reason: new Set(),
      status: new Set(),
    }
    rows.forEach((row) => {
      byKey.employee.add(row.full_name || LEAVE_BLANK)
      byKey.department.add(row.department || LEAVE_BLANK)
      byKey.from.add(row.fromText || LEAVE_BLANK)
      byKey.to.add(row.toText || LEAVE_BLANK)
      byKey.days.add(String(row.days))
      byKey.reason.add(row.reasonText || LEAVE_BLANK)
      byKey.status.add(row.status || LEAVE_BLANK)
    })
    const toOptions = (set, key) =>
      [...set]
        .sort((a, b) => {
          if (key === 'days') return Number(a) - Number(b)
          return String(a).localeCompare(String(b), undefined, { sensitivity: 'base' })
        })
        .map((value) => ({ value, label: value === LEAVE_BLANK ? '(Blanks)' : value }))
    return {
      employee: toOptions(byKey.employee, 'employee'),
      department: toOptions(byKey.department, 'department'),
      from: toOptions(byKey.from, 'from'),
      to: toOptions(byKey.to, 'to'),
      days: toOptions(byKey.days, 'days'),
      reason: toOptions(byKey.reason, 'reason'),
      status: toOptions(byKey.status, 'status'),
    }
  }, [rows])

  const setIncluded = useCallback((key, next) => {
    setColumnFilters((prev) => {
      const copy = { ...prev }
      if (next == null) delete copy[key]
      else copy[key] = next
      return copy
    })
  }, [])

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const checks = [
          ['employee', row.full_name || LEAVE_BLANK],
          ['department', row.department || LEAVE_BLANK],
          ['from', row.fromText || LEAVE_BLANK],
          ['to', row.toText || LEAVE_BLANK],
          ['days', String(row.days)],
          ['reason', row.reasonText || LEAVE_BLANK],
          ['status', row.status || LEAVE_BLANK],
        ]
        for (const [key, value] of checks) {
          const included = columnFilters[key]
          if (included && !included.has(value)) return false
        }
        return true
      }),
    [rows, columnFilters]
  )

  const sortedRows = useMemo(() => {
    const copy = [...filteredRows]
    const mul = sortDir === 'asc' ? 1 : -1
    copy.sort((a, b) => {
      let va = ''
      let vb = ''
      switch (sortKey) {
        case 'employee':
          va = (a.full_name || '').toLowerCase()
          vb = (b.full_name || '').toLowerCase()
          break
        case 'department':
          va = (a.department || '').toLowerCase()
          vb = (b.department || '').toLowerCase()
          break
        case 'from':
          va = a.fromText
          vb = b.fromText
          break
        case 'to':
          va = a.toText
          vb = b.toText
          break
        case 'days':
          va = a.days
          vb = b.days
          break
        case 'reason':
          va = (a.reasonText || '').toLowerCase()
          vb = (b.reasonText || '').toLowerCase()
          break
        case 'status':
          va = (a.status || '').toLowerCase()
          vb = (b.status || '').toLowerCase()
          break
        default:
          return 0
      }
      if (va < vb) return -1 * mul
      if (va > vb) return 1 * mul
      return 0
    })
    return copy
  }, [filteredRows, sortKey, sortDir])

  const onSort = useCallback((key) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
        return prev
      }
      setSortDir('asc')
      return key
    })
  }, [])

  const hasActiveFilters = useMemo(
    () =>
      Object.entries(filterOptionsByKey).some(([key, opts]) =>
        excelFilterIsActive(columnFilters[key], opts.map((o) => o.value))
      ),
    [filterOptionsByKey, columnFilters]
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

  const sortableHeader = (key, label) => (
    <button
      type="button"
      className="annual-leave-sort-btn"
      onClick={() => onSort(key)}
      aria-sort={sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
    >
      <span>{label}</span>
      <span className={`annual-leave-sort-icon${sortKey === key ? ' annual-leave-sort-icon--active' : ''}`}>
        {sortKey === key ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}
      </span>
    </button>
  )

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
        {hasActiveFilters && (
          <p className="annual-leave-filter-hint" role="status">
            Showing filtered results.
          </p>
        )}
        {loading && <p className="page-loading">Loading…</p>}
        {!loading && requests.length === 0 && (
          <p className="annual-leave-empty">No annual leave requests yet.</p>
        )}
        {!loading && requests.length > 0 && (
          <div className="annual-leave-table-wrap">
            <table className="annual-leave-table">
              <thead>
                <tr>
                  <th>{sortableHeader('employee', 'Employee')}</th>
                  <th>{sortableHeader('department', 'Department')}</th>
                  <th>{sortableHeader('from', 'From')}</th>
                  <th>{sortableHeader('to', 'To')}</th>
                  <th>{sortableHeader('days', 'Days')}</th>
                  <th>{sortableHeader('reason', 'Reason')}</th>
                  <th>{sortableHeader('status', 'Status')}</th>
                  {isAdmin && <th />}
                </tr>
                <tr className="annual-leave-filter-row">
                  <th>
                    <ExcelStyleColumnFilter
                      filterId="leave-employee"
                      openFilterId={openFilterId}
                      onOpenFilterId={setOpenFilterId}
                      ariaLabel="Filter leave by employee"
                      options={filterOptionsByKey.employee}
                      included={columnFilters.employee}
                      onIncludedChange={(next) => setIncluded('employee', next)}
                    />
                  </th>
                  <th>
                    <ExcelStyleColumnFilter
                      filterId="leave-department"
                      openFilterId={openFilterId}
                      onOpenFilterId={setOpenFilterId}
                      ariaLabel="Filter leave by department"
                      options={filterOptionsByKey.department}
                      included={columnFilters.department}
                      onIncludedChange={(next) => setIncluded('department', next)}
                    />
                  </th>
                  <th>
                    <ExcelStyleColumnFilter
                      filterId="leave-from"
                      openFilterId={openFilterId}
                      onOpenFilterId={setOpenFilterId}
                      ariaLabel="Filter leave by from date"
                      options={filterOptionsByKey.from}
                      included={columnFilters.from}
                      onIncludedChange={(next) => setIncluded('from', next)}
                    />
                  </th>
                  <th>
                    <ExcelStyleColumnFilter
                      filterId="leave-to"
                      openFilterId={openFilterId}
                      onOpenFilterId={setOpenFilterId}
                      ariaLabel="Filter leave by to date"
                      options={filterOptionsByKey.to}
                      included={columnFilters.to}
                      onIncludedChange={(next) => setIncluded('to', next)}
                    />
                  </th>
                  <th>
                    <ExcelStyleColumnFilter
                      filterId="leave-days"
                      openFilterId={openFilterId}
                      onOpenFilterId={setOpenFilterId}
                      ariaLabel="Filter leave by number of days"
                      options={filterOptionsByKey.days}
                      included={columnFilters.days}
                      onIncludedChange={(next) => setIncluded('days', next)}
                    />
                  </th>
                  <th>
                    <ExcelStyleColumnFilter
                      filterId="leave-reason"
                      openFilterId={openFilterId}
                      onOpenFilterId={setOpenFilterId}
                      ariaLabel="Filter leave by reason"
                      options={filterOptionsByKey.reason}
                      included={columnFilters.reason}
                      onIncludedChange={(next) => setIncluded('reason', next)}
                    />
                  </th>
                  <th>
                    <ExcelStyleColumnFilter
                      filterId="leave-status"
                      openFilterId={openFilterId}
                      onOpenFilterId={setOpenFilterId}
                      ariaLabel="Filter leave by status"
                      options={filterOptionsByKey.status}
                      included={columnFilters.status}
                      onIncludedChange={(next) => setIncluded('status', next)}
                    />
                  </th>
                  {isAdmin && <th />}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.full_name}</td>
                    <td>{row.department}</td>
                    <td>{row.fromText}</td>
                    <td>{row.toText}</td>
                    <td>{row.days}</td>
                    <td className="annual-leave-reason">{row.reasonText}</td>
                    <td>
                      {isAdmin ? (
                        <select
                          className={`annual-leave-status-select ${statusClass(row.status)}`}
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
                        <span className={statusClass(row.status)}>{row.status}</span>
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
            {sortedRows.length === 0 && (
              <p className="annual-leave-empty annual-leave-empty--filtered">
                No requests match the selected filters.
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
