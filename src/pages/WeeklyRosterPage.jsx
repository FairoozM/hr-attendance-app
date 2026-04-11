import { useState, useMemo } from 'react'
import { useAttendanceManagedEmployees } from '../hooks/useAttendanceManagedEmployees'
import { useAttendance } from '../hooks/useAttendance'
import { useWeeklyHolidayDay } from '../hooks/useWeeklyHolidayDay'
import { getEffectiveStatus } from '../utils/attendanceHelpers'
import { employeesForAttendance } from '../utils/employeeAttendance'
import { STATUSES } from '../constants/attendance'
import { EmployeeAvatar } from '../components/employees/EmployeeAvatar'
import './Page.css'
import './WeeklyRosterPage.css'

const DAYS = [
  { key: 'sunday',    label: 'Sunday',    short: 'Sun', jsDay: 0 },
  { key: 'monday',    label: 'Monday',    short: 'Mon', jsDay: 1 },
  { key: 'tuesday',   label: 'Tuesday',   short: 'Tue', jsDay: 2 },
  { key: 'wednesday', label: 'Wednesday', short: 'Wed', jsDay: 3 },
  { key: 'thursday',  label: 'Thursday',  short: 'Thu', jsDay: 4 },
  { key: 'friday',    label: 'Friday',    short: 'Fri', jsDay: 5 },
  { key: 'saturday',  label: 'Saturday',  short: 'Sat', jsDay: 6 },
]

function getTodayKey() {
  return DAYS[new Date().getDay()].key
}

function formatDateLong() {
  return new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

/** Sunday-start week containing `ref` */
function getWeekDates(ref = new Date()) {
  const d = new Date(ref)
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - d.getDay())
  return Array.from({ length: 7 }, (_, i) => {
    const x = new Date(start)
    x.setDate(start.getDate() + i)
    return x
  })
}

function isPresentStatus(s) {
  return s === 'P'
}

/** Counts as “not in” for weekly chips: leave, holiday, or absent */
function isAwayStatus(s) {
  return s === 'WH' || s === 'AL' || s === 'SL' || s === 'A'
}

/**
 * Label for roster: profile primary text first, then enum from "Primary work location" (duty_location).
 */
function primaryLocationLabel(emp) {
  const text = emp.workLocation?.trim()
  if (text) return text
  if (emp.dutyLocation === 'warehouse') return 'Warehouse'
  if (emp.dutyLocation === 'office') return 'Office'
  if (emp.dutyLocation === 'remote') return 'Remote'
  return null
}

/**
 * Bucket for Office / Warehouse / Remote columns: explicit duty_location, else light inference from work_location text.
 */
function primaryLocationBucket(emp) {
  const d = emp.dutyLocation
  if (d === 'warehouse' || d === 'office' || d === 'remote') return d
  const w = (emp.workLocation || '').trim().toLowerCase()
  if (!w) return null
  if (/\bwarehouse\b|\bstore\b|\bwh\b|\bstorage\b/.test(w)) return 'warehouse'
  if (/\bremote\b|\bwfh\b|\bwork from home\b/.test(w)) return 'remote'
  if (/\boffice\b|\bhq\b|\bbranch\b/.test(w)) return 'office'
  return null
}

// ── Stat summary card ────────────────────────────────────────────────────────

function StatCard({ value, label, color, icon }) {
  return (
    <div className={`roster-stat roster-stat--${color}`}>
      <span className="roster-stat__icon" aria-hidden>{icon}</span>
      <span className="roster-stat__value">{value}</span>
      <span className="roster-stat__label">{label}</span>
    </div>
  )
}

// ── Employee card (today view) ────────────────────────────────────────────────

function EmpCard({ emp, badge, attendanceStatus }) {
  const locLabel = primaryLocationLabel(emp)
  const bucket = primaryLocationBucket(emp)
  const locBadgeClass = bucket || 'location-text'
  const statusMeta = attendanceStatus && STATUSES[attendanceStatus]

  return (
    <div className="roster-emp-card">
      <EmployeeAvatar name={emp.name} photoUrl={emp.photoUrl} size="md" />
      <div className="roster-emp-card__info">
        <span className="roster-emp-card__name">{emp.name}</span>
        {emp.designation && (
          <span className="roster-emp-card__role">{emp.designation}</span>
        )}
        {emp.department && (
          <span className="roster-emp-card__dept">{emp.department}</span>
        )}
        <div className="roster-emp-card__badges">
          {statusMeta && (
            <span
              className={`roster-badge roster-badge--${
                attendanceStatus === 'P' ? 'green' : attendanceStatus === 'A' ? 'red' : 'off-day'
              }`}
            >
              {statusMeta.label}
            </span>
          )}
          {badge && (
            <span className={`roster-badge roster-badge--${badge.color}`}>{badge.label}</span>
          )}
          {locLabel && !badge?.isLoc && (
            <span className={`roster-badge roster-badge--${locBadgeClass}`}>{locLabel}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Chip (weekly view) ────────────────────────────────────────────────────────

function EmpChip({ emp }) {
  return (
    <div
      className="roster-chip"
      title={[emp.name, emp.designation, emp.department].filter(Boolean).join(' · ')}
    >
      <EmployeeAvatar name={emp.name} photoUrl={emp.photoUrl} size="xs" />
      <span className="roster-chip__name">{emp.name.split(' ')[0]}</span>
    </div>
  )
}

// ── Today column ─────────────────────────────────────────────────────────────

function TodayColumn({ title, icon, colorKey, employees, emptyText, badge, statusByEmpId }) {
  return (
    <div className={`roster-col roster-col--${colorKey}`}>
      <div className="roster-col__header">
        <span className="roster-col__icon" aria-hidden>{icon}</span>
        <span className="roster-col__title">{title}</span>
        <span className="roster-col__count">{employees.length}</span>
      </div>
      <div className="roster-col__body">
        {employees.length === 0 ? (
          <p className="roster-col__empty">{emptyText}</p>
        ) : (
          employees.map((emp) => (
            <EmpCard
              key={emp.id}
              emp={emp}
              badge={badge}
              attendanceStatus={statusByEmpId?.[emp.id]}
            />
          ))
        )}
      </div>
    </div>
  )
}

// ── Day card (weekly overview) ───────────────────────────────────────────────

function DayCard({ day, offEmployees, isToday }) {
  const dateLabel = day.date
    ? day.date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : null
  return (
    <div className={`roster-day${isToday ? ' roster-day--today' : ''}`}>
      <div className="roster-day__header">
        <span className="roster-day__name">
          {day.label}
          {dateLabel && <span className="roster-day__date"> · {dateLabel}</span>}
        </span>
        {isToday && <span className="roster-day__today-tag">Today</span>}
        <span className="roster-day__count">
          {offEmployees.length === 0 ? 'All working' : `${offEmployees.length} off`}
        </span>
      </div>
      <div className="roster-day__chips">
        {offEmployees.length === 0 ? (
          <span className="roster-day__none">✓ Full team in</span>
        ) : (
          offEmployees.map((emp) => <EmpChip key={emp.id} emp={emp} />)
        )}
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function WeeklyRosterPage() {
  const { employees: managed, loading: managedLoading, error: managedError } = useAttendanceManagedEmployees()
  const [weeklyHolidayDay] = useWeeklyHolidayDay()

  const clock = new Date()
  const curM = clock.getMonth()
  const curY = clock.getFullYear()

  const prevRef = useMemo(() => new Date(curY, curM, 0), [curM, curY])
  const prevM = prevRef.getMonth()
  const prevY = prevRef.getFullYear()
  const nextM = curM === 11 ? 0 : curM + 1
  const nextY = curM === 11 ? curY + 1 : curY

  const scope = useMemo(() => employeesForAttendance(managed), [managed])

  const { attendance: attCur, loading: loadCur, error: errCur } = useAttendance(scope, curM, curY)
  const { attendance: attPrev, loading: loadPrev, error: errPrev } = useAttendance(scope, prevM, prevY)
  const { attendance: attNext, loading: loadNext, error: errNext } = useAttendance(scope, nextM, nextY)

  const loading = managedLoading || loadCur || loadPrev || loadNext
  const loadError = managedError || errCur || errPrev || errNext

  const pickAttendance = useMemo(
    () => (date) => {
      const m = date.getMonth()
      const y = date.getFullYear()
      if (m === curM && y === curY) return attCur
      if (m === prevM && y === prevY) return attPrev
      if (m === nextM && y === nextY) return attNext
      return {}
    },
    [attCur, attPrev, attNext, curM, curY, prevM, prevY, nextM, nextY]
  )

  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [filterLoc, setFilterLoc] = useState('')

  const todayKey = getTodayKey()
  const todayLabel = formatDateLong()
  const todayDay = DAYS.find((d) => d.key === todayKey)

  const weekDates = useMemo(() => getWeekDates(new Date()), [todayKey])

  // Active, included employees only (same scope as attendance grid)
  const active = useMemo(
    () => scope.filter((e) => e.isActive),
    [scope]
  )

  const departments = useMemo(
    () => [...new Set(active.map((e) => e.department).filter(Boolean))].sort(),
    [active]
  )

  const todayStatusById = useMemo(() => {
    const t = new Date()
    const raw = pickAttendance(t)
    const map = {}
    active.forEach((e) => {
      map[e.id] = getEffectiveStatus(
        raw,
        e.id,
        t.getDate(),
        t.getFullYear(),
        t.getMonth(),
        weeklyHolidayDay
      )
    })
    return map
  }, [active, pickAttendance, weeklyHolidayDay])

  // Filters
  const filtered = useMemo(() => {
    return active.filter((e) => {
      if (filterDept && e.department !== filterDept) return false
      if (filterLoc && primaryLocationBucket(e) !== filterLoc) return false
      if (search) {
        const q = search.toLowerCase()
        if (
          !e.name.toLowerCase().includes(q) &&
          !(e.designation || '').toLowerCase().includes(q) &&
          !(e.department || '').toLowerCase().includes(q)
        ) return false
      }
      return true
    })
  }, [active, filterDept, filterLoc, search])

  // Today breakdown — from attendance + duty location for present only
  const offToday = filtered.filter((e) => {
    const s = todayStatusById[e.id]
    return isAwayStatus(s)
  })
  const workingToday = filtered.filter((e) => isPresentStatus(todayStatusById[e.id]))
  const warehouse = workingToday.filter((e) => primaryLocationBucket(e) === 'warehouse')
  const office = workingToday.filter((e) => primaryLocationBucket(e) === 'office')
  const remote = workingToday.filter((e) => primaryLocationBucket(e) === 'remote')
  const unassigned = workingToday.filter((e) => !primaryLocationBucket(e))

  const offStatusById = useMemo(() => {
    const m = {}
    offToday.forEach((e) => {
      m[e.id] = todayStatusById[e.id]
    })
    return m
  }, [offToday, todayStatusById])

  // Weekly breakdown: who is away each day this week (from attendance records)
  const weeklyBreakdown = useMemo(() => {
    return DAYS.map((day, i) => {
      const date = weekDates[i]
      const raw = pickAttendance(date)
      const off = filtered.filter((e) => {
        const s = getEffectiveStatus(
          raw,
          e.id,
          date.getDate(),
          date.getFullYear(),
          date.getMonth(),
          weeklyHolidayDay
        )
        return isAwayStatus(s)
      })
      return { ...day, date, off }
    })
  }, [filtered, weekDates, pickAttendance, weeklyHolidayDay])

  return (
    <div className="page roster-page">

      {/* ── Page header ── */}
      <div className="roster-header">
        <div className="roster-header__left">
          <h1 className="roster-header__title">Weekly Off &amp; Duty</h1>
          <p className="roster-header__date">{todayLabel}</p>
        </div>
        <div className="roster-header__controls">
          <input
            type="search"
            className="roster-search"
            placeholder="Search name, role, dept…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search employees"
          />
          <select
            className="roster-filter"
            value={filterDept}
            onChange={(e) => setFilterDept(e.target.value)}
            aria-label="Filter by department"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <select
            className="roster-filter"
            value={filterLoc}
            onChange={(e) => setFilterLoc(e.target.value)}
            aria-label="Filter by location"
          >
            <option value="">All locations</option>
            <option value="office">Office</option>
            <option value="warehouse">Warehouse</option>
            <option value="remote">Remote</option>
          </select>
        </div>
      </div>

      {loadError && (
        <p className="page-error" role="alert">{loadError}</p>
      )}

      {loading && (
        <div className="roster-loading">
          <span className="roster-loading__spinner" />
          Loading roster…
        </div>
      )}

      {!loading && (
        <>
          {/* ── Stats ── */}
          <div className="roster-stats">
            <StatCard value={workingToday.length} label="Working Today"  color="green"   icon="✅" />
            <StatCard value={offToday.length}     label="Off Today"      color="red"     icon="🔴" />
            <StatCard value={warehouse.length}    label="Warehouse"      color="amber"   icon="🏭" />
            <StatCard value={office.length}       label="Office"         color="blue"    icon="🏢" />
          </div>

          {/* ── Today's breakdown ── */}
          <section className="roster-section">
            <div className="roster-section__heading">
              <h2 className="roster-section__title">
                Today — <strong>{todayDay?.label}</strong>
              </h2>
            </div>

            <div className="roster-today-grid">
              <TodayColumn
                title="Off Today"
                icon="🔴"
                colorKey="off"
                employees={offToday}
                emptyText="No one off today 🎉"
                statusByEmpId={offStatusById}
              />
              <TodayColumn
                title="Warehouse"
                icon="🏭"
                colorKey="warehouse"
                employees={warehouse}
                emptyText="No one assigned to warehouse"
                badge={{ label: 'Warehouse', color: 'warehouse', isLoc: true }}
              />
              <TodayColumn
                title="Office"
                icon="🏢"
                colorKey="office"
                employees={office}
                emptyText="No one assigned to office"
                badge={{ label: 'Office', color: 'office', isLoc: true }}
              />
              {remote.length > 0 && (
                <TodayColumn
                  title="Remote"
                  icon="💻"
                  colorKey="remote"
                  employees={remote}
                  emptyText=""
                  badge={{ label: 'Remote', color: 'remote', isLoc: true }}
                />
              )}
              {unassigned.length > 0 && (
                <TodayColumn
                  title="No location set"
                  icon="👤"
                  colorKey="unassigned"
                  employees={unassigned}
                  emptyText=""
                />
              )}
            </div>
          </section>

          {/* ── Weekly planner ── */}
          <section className="roster-section">
            <div className="roster-section__heading">
              <h2 className="roster-section__title">This week (from attendance)</h2>
              <p className="roster-section__sub">
                Sunday–Saturday; away includes weekly holiday, leave, and absent (same rules as the attendance sheet)
              </p>
            </div>
            <div className="roster-week-grid">
              {weeklyBreakdown.map((day) => (
                <DayCard
                  key={day.key}
                  day={day}
                  offEmployees={day.off}
                  isToday={day.key === todayKey}
                />
              ))}
            </div>
          </section>

          {/* ── Full roster table ── */}
          <section className="roster-section">
            <div className="roster-section__heading">
              <h2 className="roster-section__title">All Employees</h2>
              <span className="roster-section__count">{filtered.length} shown</span>
            </div>
            <div className="roster-table-wrap">
              <table className="roster-table">
                <thead>
                  <tr>
                    <th>Employee</th>
                    <th>Department</th>
                    <th>Today&apos;s attendance</th>
                    <th>Duty location</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((emp) => {
                    const s = todayStatusById[emp.id]
                    const away = isAwayStatus(s)
                    const present = isPresentStatus(s)
                    const statusLabel = s && STATUSES[s] ? STATUSES[s].label : null
                    return (
                      <tr key={emp.id} className={away ? 'roster-table__row--off' : ''}>
                        <td className="roster-table__emp-cell">
                          <EmployeeAvatar name={emp.name} photoUrl={emp.photoUrl} size="sm" />
                          <div className="roster-table__emp-info">
                            <span className="roster-table__emp-name">{emp.name}</span>
                            {emp.designation && (
                              <span className="roster-table__emp-role">{emp.designation}</span>
                            )}
                          </div>
                        </td>
                        <td>{emp.department || '—'}</td>
                        <td>
                          {statusLabel
                            ? (
                              <span
                                className={`roster-badge roster-badge--${
                                  s === 'P' ? 'green' : s === 'A' ? 'red' : 'off-day'
                                }`}
                              >
                                {statusLabel}
                              </span>
                            )
                            : <span className="roster-table__unset">Not marked</span>
                          }
                        </td>
                        <td>
                          {present && primaryLocationLabel(emp)
                            ? (
                              <span
                                className={`roster-badge roster-badge--${
                                  primaryLocationBucket(emp) || 'location-text'
                                }`}
                              >
                                {primaryLocationLabel(emp)}
                              </span>
                            )
                            : <span className="roster-table__unset">—</span>
                          }
                        </td>
                        <td>
                          {present && (
                            <span className="roster-badge roster-badge--green">Working</span>
                          )}
                          {away && (
                            <span className="roster-badge roster-badge--red">{s === 'A' ? 'Absent' : 'Away'}</span>
                          )}
                          {!present && !away && (
                            <span className="roster-table__unset">Not marked</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={5} className="roster-table__empty">No employees match your filters</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
