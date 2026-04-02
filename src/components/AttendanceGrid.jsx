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
import { ExcelStyleColumnFilter, excelFilterIsActive } from './ExcelStyleColumnFilter'
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

const STATUS_ORDER_FOR_FILTER = ['empty', 'P', 'A', 'SL', 'AL', 'WH']

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
  /** Per-day: `undefined` = all statuses; else `Set` of allowed keys (`empty`, `P`, …). */
  const [dayIncluded, setDayIncluded] = useState({})
  /** Per summary column: `undefined` = all counts; else `Set` of allowed numeric strings. */
  const [summaryIncluded, setSummaryIncluded] = useState({})
  const [openFilterId, setOpenFilterId] = useState(null)

  /** Distinct counts per summary column (checkbox list). */
  const summaryFilterOptionsByKey = useMemo(() => {
    const result = {}
    for (const key of SUMMARY_STATUS_ORDER) {
      const counts = new Set()
      for (const emp of employees) {
        const s = getEmployeeMonthSummary(
          attendance,
          emp.id,
          daysInMonth,
          year,
          month,
          weeklyHolidayDay
        )
        counts.add(s[key])
      }
      result[key] = Array.from(counts)
        .sort((a, b) => a - b)
        .map((n) => ({ value: String(n), label: String(n) }))
    }
    return result
  }, [employees, attendance, daysInMonth, year, month, weeklyHolidayDay])

  /** Distinct effective statuses per calendar day (checkbox list). */
  const dayFilterOptionsByDay = useMemo(() => {
    const result = {}
    for (const day of days) {
      const keys = new Set()
      for (const emp of employees) {
        keys.add(
          statusFilterKey(attendance, emp.id, day, year, month, weeklyHolidayDay)
        )
      }
      const sorted = [...keys].sort(
        (a, b) => STATUS_ORDER_FOR_FILTER.indexOf(a) - STATUS_ORDER_FOR_FILTER.indexOf(b)
      )
      result[day] = sorted.map((v) => ({
        value: v,
        label: v === 'empty' ? '—' : v,
      }))
    }
    return result
  }, [days, employees, attendance, year, month, weeklyHolidayDay])

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
        const inc = dayIncluded[day]
        if (inc === undefined) continue
        const key = statusFilterKey(attendance, emp.id, day, year, month, weeklyHolidayDay)
        if (!inc.has(key)) return false
      }
      return true
    },
    [displayDays, dayIncluded, attendance, year, month, weeklyHolidayDay]
  )

  const passesSummaryFilters = useCallback(
    (emp) => {
      const summary = getEmployeeMonthSummary(
        attendance,
        emp.id,
        daysInMonth,
        year,
        month,
        weeklyHolidayDay
      )
      for (const key of SUMMARY_STATUS_ORDER) {
        const inc = summaryIncluded[key]
        if (inc === undefined) continue
        const val = String(summary[key])
        if (!inc.has(val)) return false
      }
      return true
    },
    [summaryIncluded, attendance, daysInMonth, year, month, weeklyHolidayDay]
  )

  const displayEmployees = useMemo(() => {
    const q = employeeSearch.trim().toLowerCase()
    return employees.filter((emp) => {
      if (q) {
        const name = (emp.name || '').toLowerCase()
        const dept = (emp.department || '').toLowerCase()
        if (!name.includes(q) && !dept.includes(q)) return false
      }
      if (!passesSummaryFilters(emp)) return false
      return passesDayFilters(emp)
    })
  }, [employees, employeeSearch, passesSummaryFilters, passesDayFilters])

  const handleSummaryIncluded = useCallback((key, next) => {
    setSummaryIncluded((prev) => {
      const copy = { ...prev }
      if (next === null) delete copy[key]
      else copy[key] = next
      return copy
    })
  }, [])

  const handleDayIncluded = useCallback((day, next) => {
    setDayIncluded((prev) => {
      const copy = { ...prev }
      if (next === null) delete copy[day]
      else copy[day] = next
      return copy
    })
  }, [])

  const clearAttendanceFilters = useCallback(() => {
    setEmployeeSearch('')
    setCellViewMode('all')
    setDayScope('all')
    setDayIncluded({})
    setSummaryIncluded({})
    setOpenFilterId(null)
  }, [])

  const hasActiveAttendanceFilters = useMemo(() => {
    if (employeeSearch.trim() !== '') return true
    if (cellViewMode === 'absentOnly') return true
    if (dayScope === 'absentDaysOnly') return true
    for (const key of SUMMARY_STATUS_ORDER) {
      const opts = (summaryFilterOptionsByKey[key] || []).map((o) => o.value)
      if (excelFilterIsActive(summaryIncluded[key], opts)) return true
    }
    for (const day of days) {
      const opts = (dayFilterOptionsByDay[day] || []).map((o) => o.value)
      if (excelFilterIsActive(dayIncluded[day], opts)) return true
    }
    return false
  }, [
    employeeSearch,
    cellViewMode,
    dayScope,
    summaryFilterOptionsByKey,
    dayFilterOptionsByDay,
    summaryIncluded,
    dayIncluded,
    days,
  ])

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
          Click the funnel on each Summary or day column for Excel-style checkboxes (include/exclude
          values).
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
                  <ExcelStyleColumnFilter
                    filterId={`att-sum-${key}`}
                    openFilterId={openFilterId}
                    onOpenFilterId={setOpenFilterId}
                    ariaLabel={`Filter rows by ${key} month total`}
                    options={summaryFilterOptionsByKey[key] || []}
                    included={summaryIncluded[key]}
                    onIncludedChange={(next) => handleSummaryIncluded(key, next)}
                  />
                </th>
              ))}
              {displayDays.map((day) => (
                <th key={`f-${day}`} className="attendance-grid__th attendance-grid__th--day attendance-grid__th--filter">
                  <ExcelStyleColumnFilter
                    filterId={`att-day-${day}`}
                    openFilterId={openFilterId}
                    onOpenFilterId={setOpenFilterId}
                    ariaLabel={`Filter rows by status on day ${day}`}
                    options={dayFilterOptionsByDay[day] || []}
                    included={dayIncluded[day]}
                    onIncludedChange={(next) => handleDayIncluded(day, next)}
                  />
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
                          {STATUS_KEYS.map((k) => (
                            <option key={k} value={k}>
                              {k}
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
          No rows match your filters. Try clearing filters or including more values in the column
          filters.
        </p>
      )}
    </div>
  )
}
