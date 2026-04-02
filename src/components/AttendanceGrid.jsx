import { useState, useRef, useMemo, useCallback } from 'react'
import {
  STATUS_KEYS,
  STATUSES,
  DAY_NAMES_SHORT,
  STATUS_EXPLICIT_BLANK,
} from '../constants/attendance'
import {
  getDayOfWeek,
  getEffectiveStatus,
  getEmployeeMonthSummary,
  SUMMARY_STATUS_ORDER,
} from '../utils/attendanceHelpers'
import './AttendanceGrid.css'

function setAttendanceFor(setAttendance, employeeId, day, value) {
  setAttendance((prev) => {
    const next = { ...prev }
    if (!next[employeeId]) next[employeeId] = {}
    const emp = { ...next[employeeId] }
    if (value) {
      emp[day] = value
    } else {
      emp[day] = STATUS_EXPLICIT_BLANK
    }
    next[employeeId] = emp
    return next
  })
}

/** Normalize effective status for filter matching (empty cell → 'empty'). */
function statusFilterKey(
  attendance,
  employeeId,
  day,
  year,
  month,
  weeklyHolidayDay
) {
  const s = getEffectiveStatus(attendance, employeeId, day, year, month, weeklyHolidayDay)
  return s || 'empty'
}

const DAY_FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'A', label: 'A' },
  { value: 'P', label: 'P' },
  { value: 'SL', label: 'SL' },
  { value: 'AL', label: 'AL' },
  { value: 'WH', label: 'WH' },
  { value: 'empty', label: '—' },
]

export function AttendanceGrid({
  employees,
  attendance,
  setAttendance,
  sickLeaveDocuments = {},
  uploadSickLeaveDocument,
  removeSickLeaveDocument,
  month,
  year,
  daysInMonth,
  weeklyHolidayDay = 0,
}) {
  const days = useMemo(() => Array.from({ length: daysInMonth }, (_, i) => i + 1), [daysInMonth])
  const slFileInputRef = useRef(null)
  const [slUploadTarget, setSlUploadTarget] = useState(null)

  const [employeeSearch, setEmployeeSearch] = useState('')
  const [cellViewMode, setCellViewMode] = useState('all')
  const [dayScope, setDayScope] = useState('all')
  const [dayFilters, setDayFilters] = useState({})

  const getDayFilter = useCallback((d) => dayFilters[d] || 'all', [dayFilters])

  const daysWithAnyAbsence = useMemo(() => {
    const set = new Set()
    for (const day of days) {
      for (const emp of employees) {
        if (
          getEffectiveStatus(attendance, emp.id, day, year, month, weeklyHolidayDay) === 'A'
        ) {
          set.add(day)
          break
        }
      }
    }
    return set
  }, [days, employees, attendance, year, month, weeklyHolidayDay])

  const displayDays = useMemo(() => {
    if (dayScope !== 'absentDaysOnly') return days
    return days.filter((d) => daysWithAnyAbsence.has(d))
  }, [days, dayScope, daysWithAnyAbsence])

  const passesDayFilters = useCallback(
    (emp) => {
      for (const day of displayDays) {
        const f = getDayFilter(day)
        if (f === 'all') continue
        const key = statusFilterKey(attendance, emp.id, day, year, month, weeklyHolidayDay)
        if (f === 'empty') {
          if (key !== 'empty') return false
        } else if (key !== f) {
          return false
        }
      }
      return true
    },
    [displayDays, getDayFilter, attendance, year, month, weeklyHolidayDay]
  )

  const displayEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase()
    return employees.filter((emp) => {
      if (q) {
        const name = (emp.name || '').toLowerCase()
        const dept = (emp.department || '').toLowerCase()
        if (!name.includes(q) && !dept.includes(q)) return false
      }
      return passesDayFilters(emp)
    })
  }, [employees, employeeSearch, passesDayFilters])

  const setDayColumnFilter = useCallback((day, value) => {
    setDayFilters((prev) => ({ ...prev, [day]: value }))
  }, [])

  const clearAttendanceFilters = useCallback(() => {
    setEmployeeSearch('')
    setCellViewMode('all')
    setDayScope('all')
    setDayFilters({})
  }, [])

  const hasActiveAttendanceFilters =
    employeeSearch.trim() !== '' ||
    cellViewMode === 'absentOnly' ||
    dayScope === 'absentDaysOnly' ||
    Object.values(dayFilters).some((v) => v && v !== 'all')

  async function handleSickLeaveFileChange(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !slUploadTarget || !uploadSickLeaveDocument) return
    try {
      await uploadSickLeaveDocument(slUploadTarget.empId, slUploadTarget.day, file)
    } catch (err) {
      const msg = err.body?.error || err.message || 'Upload failed'
      window.alert(msg)
    } finally {
      setSlUploadTarget(null)
    }
  }

  function openSickLeavePicker(empId, day) {
    setSlUploadTarget({ empId, day })
    slFileInputRef.current?.click()
  }

  return (
    <div className="attendance-grid-wrap">
      <div className="attendance-grid-toolbar">
        <label className="attendance-grid-toolbar__field">
          <span className="attendance-grid-toolbar__label">Find employee</span>
          <input
            type="search"
            className="attendance-grid-toolbar__input"
            placeholder="Name or department…"
            value={employeeSearch}
            onChange={(e) => setEmployeeSearch(e.target.value)}
            aria-label="Filter employees by name or department"
          />
        </label>
        <label className="attendance-grid-toolbar__field">
          <span className="attendance-grid-toolbar__label">Cells</span>
          <select
            className="attendance-grid-toolbar__select"
            value={cellViewMode}
            onChange={(e) => setCellViewMode(e.target.value)}
            aria-label="Cell display mode"
          >
            <option value="all">Show all statuses</option>
            <option value="absentOnly">Absent (A) only — dim other cells</option>
          </select>
        </label>
        <label className="attendance-grid-toolbar__field">
          <span className="attendance-grid-toolbar__label">Day columns</span>
          <select
            className="attendance-grid-toolbar__select"
            value={dayScope}
            onChange={(e) => setDayScope(e.target.value)}
            aria-label="Which day columns to show"
          >
            <option value="all">All days</option>
            <option value="absentDaysOnly">Only days with ≥1 absence (A)</option>
          </select>
        </label>
        <button
          type="button"
          className="attendance-grid-toolbar__clear btn btn--ghost btn--sm"
          onClick={clearAttendanceFilters}
          disabled={!hasActiveAttendanceFilters}
        >
          Clear filters
        </button>
        <p className="attendance-grid-toolbar__hint">
          Use the dropdown under each day to show rows that match that day&apos;s status (Excel-style).
        </p>
      </div>

      <div className="attendance-grid-legend">
        {STATUS_KEYS.map((key) => (
          <span key={key} className={`attendance-legend attendance-legend--${STATUSES[key].color}`}>
            <b>{key}</b> {STATUSES[key].label}
          </span>
        ))}
        {uploadSickLeaveDocument ? (
          <span className="attendance-legend-hint">
            Sick leave (SL): <b>+</b> upload certificate (PDF or image). Then <b>View file</b> /{' '}
            <b>Delete</b> / <b>Replace</b> as needed.
          </span>
        ) : null}
      </div>
      <div className="attendance-grid-scroll">
        <input
          ref={slFileInputRef}
          type="file"
          className="attendance-sl-file-input"
          accept="application/pdf,image/*"
          aria-hidden
          tabIndex={-1}
          onChange={handleSickLeaveFileChange}
        />
        <table className="attendance-grid" role="grid">
          <thead>
            <tr className="attendance-grid__header-row attendance-grid__header-row--group">
              <th
                colSpan={1}
                className="attendance-grid__th attendance-grid__th--group attendance-grid__th--group-employee"
              >
                <div className="attendance-grid__header-employee-inner">Employee</div>
              </th>
              <th
                colSpan={SUMMARY_STATUS_ORDER.length}
                className="attendance-grid__th attendance-grid__th--group attendance-grid__th--group-summary"
              >
                Summary
              </th>
              <th
                colSpan={displayDays.length}
                className="attendance-grid__th attendance-grid__th--group attendance-grid__th--group-attendance"
              >
                Attendance
              </th>
            </tr>
            <tr className="attendance-grid__header-row attendance-grid__header-row--sub">
              <th className="attendance-grid__th attendance-grid__th--sticky attendance-grid__th--sub">
                <div className="attendance-grid__header-employee-inner">Name / Dept</div>
              </th>
              {SUMMARY_STATUS_ORDER.map((key) => (
                <th
                  key={key}
                  className={`attendance-grid__th attendance-grid__th--summary attendance-grid__summary-col--${key.toLowerCase()} attendance-grid__th--sub`}
                  title={STATUSES[key].label}
                >
                  {key}
                </th>
              ))}
              {displayDays.map((day) => {
                const dayOfWeek = getDayOfWeek(year, month, day)
                const dayName = DAY_NAMES_SHORT[dayOfWeek]
                const isFirstVisibleDay = day === displayDays[0]
                return (
                  <th
                    key={day}
                    className={`attendance-grid__th attendance-grid__th--day attendance-grid__th--sub ${isFirstVisibleDay ? 'attendance-grid__th--day-first' : ''}`}
                  >
                    <div className="attendance-grid__th-day-inner">
                      <span className="attendance-grid__day-name">{dayName}</span>
                      <span className="attendance-grid__day-num">{day}</span>
                    </div>
                  </th>
                )
              })}
            </tr>
            <tr className="attendance-grid__header-row attendance-grid__header-row--filters">
              <th className="attendance-grid__th attendance-grid__th--sticky attendance-grid__th--filter">
                <span className="attendance-grid__filter-row-label">Filter</span>
              </th>
              {SUMMARY_STATUS_ORDER.map((key) => (
                <th
                  key={key}
                  className={`attendance-grid__th attendance-grid__th--summary attendance-grid__summary-col--${key.toLowerCase()} attendance-grid__th--filter`}
                >
                  <span className="attendance-grid__filter-na">—</span>
                </th>
              ))}
              {displayDays.map((day) => (
                <th key={`f-${day}`} className="attendance-grid__th attendance-grid__th--day attendance-grid__th--filter">
                  <select
                    className="attendance-day-filter"
                    value={getDayFilter(day)}
                    onChange={(e) => setDayColumnFilter(day, e.target.value)}
                    aria-label={`Filter rows by status on day ${day}`}
                  >
                    {DAY_FILTER_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayEmployees.map((emp) => (
              <tr key={emp.id}>
                <td className="attendance-grid__td attendance-grid__td--sticky">
                  <div className="attendance-grid__cell-employee">
                    <span className="attendance-grid__name">{emp.name}</span>
                    <span className="attendance-grid__dept">{emp.department}</span>
                  </div>
                </td>
                {(() => {
                  const summary = getEmployeeMonthSummary(
                    attendance,
                    emp.id,
                    daysInMonth,
                    year,
                    month,
                    weeklyHolidayDay
                  )
                  return SUMMARY_STATUS_ORDER.map((key) => (
                    <td
                      key={key}
                      className={`attendance-grid__td attendance-grid__td--summary attendance-grid__summary-col--${key.toLowerCase()}`}
                    >
                      <span
                        className={`attendance-grid__summary-value attendance-grid__summary-value--${STATUSES[key].color}`}
                      >
                        {summary[key]}
                      </span>
                    </td>
                  ))
                })()}
                {displayDays.map((day) => {
                  const current = getEffectiveStatus(
                    attendance,
                    emp.id,
                    day,
                    year,
                    month,
                    weeklyHolidayDay
                  )
                  const colorClass = current ? `attendance-cell--${STATUSES[current].color}` : ''
                  const isFirstVisibleDay = day === displayDays[0]
                  const docUrl = sickLeaveDocuments[emp.id]?.[day]
                  const showSlUpload = current === 'SL'
                  const dimAbsentView =
                    cellViewMode === 'absentOnly' && current !== 'A'
                  return (
                    <td
                      key={day}
                      className={`attendance-grid__td attendance-grid__td--day ${isFirstVisibleDay ? 'attendance-grid__td--day-first' : ''}${dimAbsentView ? ' attendance-grid__td--dim' : ''}`}
                    >
                      <div
                        className={`attendance-cell-wrap${showSlUpload ? ' attendance-cell-wrap--with-sl' : ''}`}
                      >
                        <select
                          className={`attendance-cell attendance-cell--select ${colorClass}${dimAbsentView ? ' attendance-cell--dimmed' : ''}`}
                          value={current || ''}
                          onChange={(e) => {
                            const v = e.target.value
                            setAttendanceFor(setAttendance, emp.id, day, v)
                          }}
                          title={current ? STATUSES[current].label : 'Select status'}
                          aria-label={`Day ${day} status for ${emp.name}`}
                        >
                          <option value="">—</option>
                          {STATUS_KEYS.map((key) => (
                            <option key={key} value={key}>
                              {key}
                            </option>
                          ))}
                        </select>
                        {showSlUpload && (
                          <div className="attendance-sl-doc">
                            {docUrl ? (
                              <>
                                <a
                                  href={docUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="attendance-sl-doc__link"
                                  title="Open medical certificate in a new tab"
                                >
                                  View file
                                </a>
                                {removeSickLeaveDocument ? (
                                  <button
                                    type="button"
                                    className="attendance-sl-doc__delete"
                                    title="Remove this file (you can upload a different one after)"
                                    onClick={() => removeSickLeaveDocument(emp.id, day)}
                                  >
                                    Delete
                                  </button>
                                ) : null}
                              </>
                            ) : null}
                            {uploadSickLeaveDocument ? (
                              <button
                                type="button"
                                className={`attendance-sl-doc__add${docUrl ? ' attendance-sl-doc__add--replace' : ''}`}
                                title={
                                  docUrl
                                    ? 'Replace with a different file (PDF or image)'
                                    : 'Upload medical certificate (PDF or image)'
                                }
                                aria-label="Upload or replace medical certificate"
                                onClick={() => openSickLeavePicker(emp.id, day)}
                              >
                                {docUrl ? 'Replace' : '+'}
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {employees.length === 0 && (
        <p className="attendance-grid-empty">Add employees to record attendance.</p>
      )}
      {employees.length > 0 && displayEmployees.length === 0 && (
        <p className="attendance-grid-empty attendance-grid-empty--filter" role="status">
          No rows match your filters. Try clearing filters or widening the day filters.
        </p>
      )}
    </div>
  )
}
