import { useState, useRef, useMemo, useCallback, useLayoutEffect } from 'react'
import { Eye, Trash2, RefreshCw, Upload } from 'lucide-react'
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
import { SmoothHorizontalScrollbar } from './ui/SmoothHorizontalScrollbar'
import { AttendanceCellDropdown } from './AttendanceCellDropdown'
import { EmployeeAvatar } from './employees/EmployeeAvatar'
import { ModernSearchInput } from './ui/ModernSearchInput'
import { ModernSelect } from './ui/ModernSelect'
import './attendance/dashboard/AttendanceDashboard.css'
import './AttendanceGrid.css'

/** Extract up to 2 initials from a full name. */
function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Deterministic hue from a string (for avatar background). */
function nameHue(name) {
  let h = 0
  for (let i = 0; i < (name || '').length; i++) h = (h * 31 + name.charCodeAt(i)) & 0xfffff
  return h % 360
}

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
  const attendanceSplitRef = useRef(null)
  const mainScrollRef = useRef(null)
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

  /** Align employee / days / summary row heights when SL rows expand */
  useLayoutEffect(() => {
    const root = attendanceSplitRef.current
    if (!root) return undefined

    function syncHeights() {
      const leftRows = root.querySelectorAll('.attendance-grid--frozen-left tbody tr')
      const dayRows = root.querySelectorAll('.attendance-grid--days tbody tr')
      const rightRows = root.querySelectorAll('.attendance-grid--frozen-right tbody tr')
      const n = Math.min(leftRows.length, dayRows.length, rightRows.length)
      if (!n) return
      for (let i = 0; i < n; i++) {
        const lr = leftRows[i]
        const dr = dayRows[i]
        const rr = rightRows[i]
        lr.style.height = ''
        dr.style.height = ''
        rr.style.height = ''
        const h = Math.max(
          lr.getBoundingClientRect().height,
          dr.getBoundingClientRect().height,
          rr.getBoundingClientRect().height
        )
        lr.style.height = `${h}px`
        dr.style.height = `${h}px`
        rr.style.height = `${h}px`
      }
    }

    syncHeights()
    const ro = new ResizeObserver(() => syncHeights())
    const leftRows = root.querySelectorAll('.attendance-grid--frozen-left tbody tr')
    const dayRows = root.querySelectorAll('.attendance-grid--days tbody tr')
    const rightRows = root.querySelectorAll('.attendance-grid--frozen-right tbody tr')
    ;[...leftRows, ...dayRows, ...rightRows].forEach((r) => ro.observe(r))
    return () => ro.disconnect()
  }, [displayEmployees, displayDays, attendance, cellViewMode, sickLeaveDocuments])

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
      <div className="adash__filter-row attendance-grid-toolbar" aria-label="Grid filters">
        <ModernSearchInput
          label="Employee search"
          id="attendance-grid-search"
          placeholder="Name or department"
          value={employeeSearch}
          onChange={setEmployeeSearch}
          className="adash__field--grow"
        />
        <ModernSelect
          label="Cell highlight"
          value={cellViewMode}
          options={[
            { value: 'all',         label: 'None — show all statuses normally' },
            { value: 'absentOnly',  label: 'Absent (A) — dim other cells'      },
          ]}
          onChange={setCellViewMode}
        />
        <ModernSelect
          label="Visible days"
          value={dayScope}
          options={[
            { value: 'all',           label: 'Full month'                  },
            { value: 'absentDaysOnly', label: 'Only days with absence (A)' },
          ]}
          onChange={setDayScope}
        />
        <button
          type="button"
          className="adash__btn adash__btn--clear-filters"
          onClick={clearAttendanceFilters}
          disabled={!hasActiveAttendanceFilters}
        >
          Reset grid filters
        </button>
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
      <div className="attendance-grid-scroll-outer">
        <SmoothHorizontalScrollbar scrollRef={mainScrollRef} />
        <div ref={mainScrollRef} className="attendance-grid-scroll attendance-grid-scroll--main">
        <input
          ref={slFileInputRef}
          type="file"
          className="attendance-sl-file-input"
          accept="application/pdf,image/*"
          aria-hidden
          tabIndex={-1}
          onChange={handleSickLeaveFileChange}
        />
        <div className="attendance-grid-split" ref={attendanceSplitRef}>
          <div className="attendance-grid-frozen attendance-grid-frozen--left">
            <table
              className="attendance-grid attendance-grid--frozen-left"
              role="grid"
              aria-label="Employees"
            >
          <thead>
            <tr className="attendance-grid__header-row attendance-grid__header-row--group">
              <th
                colSpan={1}
                className="attendance-grid__th attendance-grid__th--group attendance-grid__th--group-employee"
              >
                <div className="attendance-grid__header-employee-inner">Employee</div>
              </th>
                </tr>
                <tr className="attendance-grid__header-row attendance-grid__header-row--sub">
                  <th className="attendance-grid__th attendance-grid__th--sticky attendance-grid__th--sub">
                    <div className="attendance-grid__header-employee-inner">Name / Dept</div>
                  </th>
                </tr>
                <tr className="attendance-grid__header-row attendance-grid__header-row--filters">
                  <th className="attendance-grid__th attendance-grid__th--sticky attendance-grid__th--filter">
                    <span className="attendance-grid__filter-row-label">Filter</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {displayEmployees.map((emp) => (
                  <tr key={emp.id}>
                    <td className="attendance-grid__td attendance-grid__td--sticky">
                      <div className="attendance-grid__cell-employee">
                        <EmployeeAvatar
                          name={emp.name}
                          photoUrl={emp.photoUrl}
                          employeeId={emp.id}
                          size="sm"
                        />
                        <div className="attendance-grid__employee-info">
                          <span className="attendance-grid__name">{emp.name}</span>
                          <span className="attendance-grid__dept">{emp.department}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="attendance-grid-days-wrap">
            <table
              className="attendance-grid attendance-grid--days"
              role="grid"
              aria-label="Daily attendance"
            >
              <thead>
                <tr className="attendance-grid__header-row attendance-grid__header-row--group">
                  <th
                    colSpan={Math.max(displayDays.length, 1)}
                className="attendance-grid__th attendance-grid__th--group attendance-grid__th--group-attendance"
              >
                Attendance
              </th>
            </tr>
            <tr className="attendance-grid__header-row attendance-grid__header-row--sub">
                  {displayDays.length === 0 ? (
                    <th className="attendance-grid__th attendance-grid__th--day attendance-grid__th--sub attendance-grid__th--day-first">
                      <div className="attendance-grid__th-day-inner">
                        <span className="attendance-grid__day-name">—</span>
                        <span className="attendance-grid__day-num"> </span>
                      </div>
              </th>
                  ) : (
                    displayDays.map((day) => {
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
                    })
                  )}
            </tr>
            <tr className="attendance-grid__header-row attendance-grid__header-row--filters">
                  {displayDays.length === 0 ? (
                    <th className="attendance-grid__th attendance-grid__th--day attendance-grid__th--filter attendance-grid__th--day-first" aria-hidden />
                  ) : (
                    displayDays.map((day) => (
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
                    ))
                  )}
            </tr>
          </thead>
          <tbody>
            {displayEmployees.map((emp) => (
              <tr key={emp.id}>
                    {displayDays.length === 0 ? (
                      <td className="attendance-grid__td attendance-grid__td--day attendance-grid__td--day-first" aria-hidden />
                    ) : (
                      displayDays.map((day) => {
                  const current = getEffectiveStatus(
                    attendance,
                    emp.id,
                    day,
                    year,
                    month,
                    weeklyHolidayDay
                  )
                  const colorClass = current ? `attendance-cell--${STATUSES[current].color}` : '' // kept for potential external use
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
                        <AttendanceCellDropdown
                          value={current || ''}
                          onChange={(v) => setAttendanceFor(setAttendance, emp.id, day, v)}
                          ariaLabel={`Day ${day} status for ${emp.name}`}
                          dimmed={dimAbsentView}
                        />
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
                                  <Eye size={6} strokeWidth={2.5} />
                                </a>
                                {removeSickLeaveDocument ? (
                                  <button
                                    type="button"
                                    className="attendance-sl-doc__delete"
                                    title="Remove this file (you can upload a different one after)"
                                    onClick={() => removeSickLeaveDocument(emp.id, day)}
                                  >
                                    <Trash2 size={6} strokeWidth={2.5} />
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
                                {docUrl
                                  ? <RefreshCw size={6} strokeWidth={2.8} />
                                  : <Upload size={6} strokeWidth={2.5} />}
                              </button>
                            ) : null}
                          </div>
                        )}
                      </div>
                    </td>
                  )
                      })
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="attendance-grid-frozen attendance-grid-frozen--right">
            <table
              className="attendance-grid attendance-grid--frozen-right"
              role="grid"
              aria-label="Monthly summary totals"
            >
              <thead>
                <tr className="attendance-grid__header-row attendance-grid__header-row--group">
                  <th
                    colSpan={SUMMARY_STATUS_ORDER.length}
                    className="attendance-grid__th attendance-grid__th--group attendance-grid__th--group-summary"
                  >
                    Summary
                  </th>
                </tr>
                <tr className="attendance-grid__header-row attendance-grid__header-row--sub">
                  {SUMMARY_STATUS_ORDER.map((key) => (
                    <th
                      key={key}
                      className={`attendance-grid__th attendance-grid__th--summary attendance-grid__summary-col--${key.toLowerCase()} attendance-grid__th--sub`}
                      title={STATUSES[key].label}
                    >
                      {key}
                    </th>
                  ))}
                </tr>
                <tr className="attendance-grid__header-row attendance-grid__header-row--filters">
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
                </tr>
              </thead>
              <tbody>
                {displayEmployees.map((emp) => (
                  <tr key={emp.id}>
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
              </tr>
            ))}
          </tbody>
        </table>
          </div>
        </div>
        </div>
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
