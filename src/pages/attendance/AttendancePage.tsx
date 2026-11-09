import { AlertTriangle, Check, Loader2, RotateCw, Users } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
import { AttendanceDaySummary } from '../../components/attendance/AttendanceDaySummary'
import { AttendanceExceptions } from '../../components/attendance/AttendanceExceptions'
import { AttendanceHeader } from '../../components/attendance/AttendanceHeader'
import { AttendanceInfoTip } from '../../components/attendance/AttendanceInfoTip'
import { AttendanceLegend } from '../../components/attendance/AttendanceLegend'
import { AttendanceMonthStrip } from '../../components/attendance/AttendanceMonthStrip'
import { AttendanceSettingsDialog } from '../../components/attendance/AttendanceSettingsDialog'
import { AttendanceTable } from '../../components/attendance/AttendanceTable'
import { AttendanceToolbar } from '../../components/attendance/AttendanceToolbar'
import { hasPermission, useAuth } from '../../contexts/AuthContext'
import { useAttendanceEmployees } from '../../hooks/attendance/useAttendanceEmployees'
import { useAttendanceMonth } from '../../hooks/attendance/useAttendanceMonth'
import { type GridView, useAttendanceViewState } from '../../hooks/attendance/useAttendanceViewState'
import { useBusinessToday } from '../../hooks/attendance/useBusinessToday'
import { useWeeklyHolidayDay } from '../../hooks/useWeeklyHolidayDay'
import {
  formatDate,
  formatMonth,
  parseIsoDate,
  parseWeeklyOffDay,
  toIsoDate,
} from '../../utils/attendance/attendanceCalendar'
import {
  buildDayCsv,
  buildMonthCsv,
  buildMonthStrip,
  listDepartments,
  matchesRowFilter,
  NO_DEPARTMENT,
  ROW_FILTER_LABELS,
  ROW_FILTERS,
  type ResolveContext,
  type RowFilter,
  scopeEmployees,
  summarizeDay,
} from '../../utils/attendance/attendanceModel'
import '../../components/attendance/attendance.css'

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
}

function GridSkeleton() {
  return (
    <div className="att-skeleton" aria-busy="true" aria-label="Loading attendance">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="att-skeleton__row">
          <span className="att-skeleton__avatar" />
          <span className="att-skeleton__text" style={{ width: `${7 + (i % 3) * 2}rem` }} />
          <span className="att-skeleton__cells" />
        </div>
      ))}
    </div>
  )
}

export function AttendancePage() {
  const { user } = useAuth()
  const canManage = hasPermission(user, 'attendance', 'manage')
  const today = useBusinessToday()
  const view = useAttendanceViewState(today)
  const { selected } = view
  const [defaultWeeklyOff, setDefaultWeeklyOff] = useWeeklyHolidayDay() as [number, (day: number) => void]
  const staff = useAttendanceEmployees()
  const month = useAttendanceMonth(selected.year, selected.month)
  const [search, setSearch] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)

  const ctx = useMemo<ResolveContext>(
    () => ({ records: month.records, today, defaultWeeklyOff }),
    [month.records, today, defaultWeeklyOff]
  )

  const departments = useMemo(() => {
    const options = listDepartments(staff.employees)
    if (view.department !== 'all' && !options.some((o) => o.value === view.department)) {
      options.push({ value: view.department, label: view.department === NO_DEPARTMENT ? 'No department' : view.department })
    }
    return options
  }, [staff.employees, view.department])

  const scoped = useMemo(
    () => scopeEmployees(staff.employees, view.department, search),
    [staff.employees, view.department, search]
  )
  const rows = useMemo(
    () => scoped.filter((employee) => matchesRowFilter(employee, view.rowFilter, selected, ctx)),
    [scoped, view.rowFilter, selected, ctx]
  )
  const summary = useMemo(() => summarizeDay(scoped, selected, ctx), [scoped, selected, ctx])
  const previous = useMemo(
    () => (selected.day > 1 ? summarizeDay(scoped, { ...selected, day: selected.day - 1 }, ctx) : null),
    [scoped, selected, ctx]
  )
  const strip = useMemo(
    () => buildMonthStrip(scoped, selected.year, selected.month, ctx),
    [scoped, selected.year, selected.month, ctx]
  )

  const departmentLabel =
    view.department === 'all' ? '' : departments.find((d) => d.value === view.department)?.label || view.department
  const scopeLabel = [departmentLabel, search.trim() && `“${search.trim()}”`].filter(Boolean).join(' · ')
  const fileScope = [departmentLabel && slug(departmentLabel), search.trim() && 'filtered'].filter(Boolean).join('-')

  const exportDay = useCallback(() => {
    downloadCsv(
      buildDayCsv(scoped, selected, ctx),
      `attendance-${toIsoDate(selected)}${fileScope ? `-${fileScope}` : ''}.csv`
    )
  }, [scoped, selected, ctx, fileScope])

  const exportMonth = useCallback(() => {
    const ym = `${selected.year}-${String(selected.month + 1).padStart(2, '0')}`
    downloadCsv(
      buildMonthCsv(scoped, selected.year, selected.month, ctx),
      `attendance-${ym}${fileScope ? `-${fileScope}` : ''}.csv`
    )
  }, [scoped, selected.year, selected.month, ctx, fileScope])

  const clearScope = useCallback(() => {
    setSearch('')
    view.setDepartment('all')
  }, [view])

  const retryLoad = useCallback(() => {
    if (staff.error) staff.reload()
    month.reload()
  }, [staff, month])

  const saveEntries = Object.entries(month.saveStates)
  const savingCount = saveEntries.filter(([, s]) => s.state === 'saving').length
  const failed = saveEntries.filter(([, s]) => s.state === 'error')
  const recentlySaved = saveEntries.some(([, s]) => s.state === 'saved')
  const employeesById = useMemo(() => new Map(staff.employees.map((e) => [e.id, e])), [staff.employees])

  const loading = staff.loading || month.loading
  const loadError = staff.error || month.error
  const employeesWithOwnDay = staff.employees.filter((e) => parseWeeklyOffDay(e.weeklyOffDay) != null).length

  return (
    <div className="att">
      <AttendanceHeader
        periodLabel={formatMonth(selected.year, selected.month)}
        employeeCount={scoped.length}
        scopeLabel={scopeLabel}
        dayLabel={formatDate(selected)}
        monthLabel={formatMonth(selected.year, selected.month)}
        exportDisabled={loading || Boolean(loadError) || scoped.length === 0}
        onExportDay={exportDay}
        onExportMonth={exportMonth}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <AttendanceToolbar
        selected={selected}
        today={today}
        department={view.department}
        departments={departments}
        search={search}
        onMonthChange={view.goToMonth}
        onSelectDate={view.selectDate}
        onToday={view.goToToday}
        onDepartmentChange={view.setDepartment}
        onSearchChange={setSearch}
      />

      {loadError ? (
        <div className="att-state att-state--error" role="alert">
          <AlertTriangle size={20} aria-hidden />
          <div>
            <strong>Could not load attendance</strong>
            <p>{loadError}</p>
          </div>
          <button type="button" className="att-btn" onClick={retryLoad}>
            <RotateCw size={14} aria-hidden /> Retry
          </button>
        </div>
      ) : loading ? (
        <>
          <div className="att-summary att-summary--loading" aria-hidden>
            <div className="att-stats">
              {Array.from({ length: 8 }, (_, i) => (
                <div key={i} className="att-stat att-stat--skeleton" />
              ))}
            </div>
          </div>
          <div className="att-grid">
            <GridSkeleton />
          </div>
        </>
      ) : staff.employees.length === 0 ? (
        <div className="att-state">
          <Users size={22} aria-hidden />
          <div>
            <strong>No employees in attendance</strong>
            <p>
              {canManage
                ? 'Employees appear here when they are active and “Include in attendance” is on in their profile.'
                : 'No employees are assigned to you for attendance. Ask an administrator to assign employees.'}
            </p>
          </div>
        </div>
      ) : scoped.length === 0 ? (
        <div className="att-state">
          <Users size={22} aria-hidden />
          <div>
            <strong>No employees match</strong>
            <p>Nobody matches {scopeLabel || 'the current filter'}.</p>
          </div>
          <button type="button" className="att-btn" onClick={clearScope}>
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <AttendanceDaySummary
            summary={summary}
            previous={previous}
            today={today}
            rowFilter={view.rowFilter}
            onRowFilterChange={view.setRowFilter}
          />

          <AttendanceMonthStrip days={strip} selected={selected} today={today} onSelectDate={view.selectDate} />

          <section className="att-grid" aria-labelledby="att-grid-title">
            <div className="att-grid__bar">
              <div className="att-grid__title-wrap">
                <h2 id="att-grid-title" className="att-section-title">
                  Attendance grid
                  <AttendanceInfoTip label="About the grid and month totals" align="start">
                    Click a day header to select that day. Click a cell (or press Enter) to change a status or manage a
                    sick-leave certificate. Totals on the right cover the whole month, including approved upcoming
                    leave and scheduled weekly holidays; “–” counts unmarked days up to today.
                  </AttendanceInfoTip>
                </h2>
                <span className="att-grid__count">
                  {rows.length === scoped.length ? `${rows.length} employees` : `${rows.length} of ${scoped.length} employees`}
                </span>
                <span className="att-grid__save" role="status" aria-live="polite">
                  {savingCount > 0 ? (
                    <>
                      <Loader2 size={13} className="att-spin" aria-hidden /> Saving…
                    </>
                  ) : failed.length > 0 ? (
                    <span className="is-error">
                      <AlertTriangle size={13} aria-hidden /> {failed.length} change{failed.length > 1 ? 's' : ''} not saved
                    </span>
                  ) : recentlySaved ? (
                    <span className="is-ok">
                      <Check size={13} aria-hidden /> All changes saved
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="att-grid__controls">
                <label className="att-inline-field">
                  <span>Show</span>
                  <select
                    className="att-select"
                    value={view.rowFilter}
                    onChange={(e) => view.setRowFilter(e.target.value as RowFilter)}
                  >
                    {ROW_FILTERS.map((f) => (
                      <option key={f} value={f}>
                        {ROW_FILTER_LABELS[f]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="att-segmented" role="group" aria-label="Grid range">
                  {(['month', 'week'] as GridView[]).map((v) => (
                    <button key={v} type="button" aria-pressed={view.view === v} onClick={() => view.setView(v)}>
                      {v === 'month' ? 'Month' : 'Week'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {failed.length > 0 && (
              <ul className="att-save-errors">
                {failed.map(([key, state]) => {
                  const [iso, employeeId] = key.split(':')
                  const date = parseIsoDate(iso)
                  const employee = employeesById.get(employeeId)
                  return (
                    <li key={key} role="alert">
                      <AlertTriangle size={14} aria-hidden />
                      <span>
                        Could not save {employee?.name || 'employee'}
                        {date ? ` on ${formatDate(date)}` : ''}: {state.message}
                      </span>
                      {state.retry && (
                        <button type="button" className="att-btn att-btn--sm" onClick={state.retry}>
                          Retry
                        </button>
                      )}
                      <button type="button" className="att-btn att-btn--sm att-btn--ghost" onClick={() => month.dismissSaveState(key)}>
                        Dismiss
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            <AttendanceLegend />

            {rows.length === 0 ? (
              <div className="att-state att-state--inline">
                <div>
                  <strong>No employees match “{ROW_FILTER_LABELS[view.rowFilter]}”</strong>
                  <p>for {formatDate(selected)}.</p>
                </div>
                <button type="button" className="att-btn" onClick={() => view.setRowFilter('all')}>
                  Show all employees
                </button>
              </div>
            ) : (
              <AttendanceTable
                employees={rows}
                selected={selected}
                today={today}
                ctx={ctx}
                view={view.view}
                canManage={canManage}
                saveStates={month.saveStates}
                onSelectDate={view.selectDate}
                onAction={(employee, date, action) => void month.saveCell(employee, date, action)}
                onUpload={(employee, date, file) => void month.uploadDocument(employee, date, file)}
                onRemoveDocument={(employee, date) => void month.removeDocument(employee, date)}
                onDismissError={month.dismissSaveState}
              />
            )}
          </section>

          <AttendanceExceptions employees={scoped} selected={selected} ctx={ctx} />
        </>
      )}

      {settingsOpen && (
        <AttendanceSettingsDialog
          defaultWeeklyOff={defaultWeeklyOff}
          employeesWithOwnDay={employeesWithOwnDay}
          totalEmployees={staff.employees.length}
          onSave={setDefaultWeeklyOff}
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
