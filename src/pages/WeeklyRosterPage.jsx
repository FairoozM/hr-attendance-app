import { useState, useMemo } from 'react'
import { useEmployees } from '../hooks/useEmployees'
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

function capitalize(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
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

function EmpCard({ emp, badge }) {
  const locLabel = emp.dutyLocation === 'warehouse' ? 'Warehouse'
    : emp.dutyLocation === 'office' ? 'Office'
    : emp.dutyLocation === 'remote' ? 'Remote'
    : null

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
          {badge && (
            <span className={`roster-badge roster-badge--${badge.color}`}>{badge.label}</span>
          )}
          {locLabel && !badge?.isLoc && (
            <span className={`roster-badge roster-badge--${emp.dutyLocation}`}>{locLabel}</span>
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

function TodayColumn({ title, icon, colorKey, employees, emptyText, badge }) {
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
            <EmpCard key={emp.id} emp={emp} badge={badge} />
          ))
        )}
      </div>
    </div>
  )
}

// ── Day card (weekly overview) ───────────────────────────────────────────────

function DayCard({ day, offEmployees, isToday }) {
  return (
    <div className={`roster-day${isToday ? ' roster-day--today' : ''}`}>
      <div className="roster-day__header">
        <span className="roster-day__name">{day.label}</span>
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
  const { employees, loading } = useEmployees()
  const [search, setSearch] = useState('')
  const [filterDept, setFilterDept] = useState('')
  const [filterLoc, setFilterLoc] = useState('')

  const todayKey = getTodayKey()
  const todayLabel = formatDateLong()
  const todayDay = DAYS.find((d) => d.key === todayKey)

  // Active, included employees only
  const active = useMemo(
    () => employees.filter((e) => e.isActive && e.includeInAttendance),
    [employees]
  )

  const departments = useMemo(
    () => [...new Set(active.map((e) => e.department).filter(Boolean))].sort(),
    [active]
  )

  // Filters
  const filtered = useMemo(() => {
    return active.filter((e) => {
      if (filterDept && e.department !== filterDept) return false
      if (filterLoc && e.dutyLocation !== filterLoc) return false
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

  // Today breakdown
  const offToday       = filtered.filter((e) => e.weeklyOffDay === todayKey)
  const workingToday   = filtered.filter((e) => e.weeklyOffDay !== todayKey)
  const warehouse      = workingToday.filter((e) => e.dutyLocation === 'warehouse')
  const office         = workingToday.filter((e) => e.dutyLocation === 'office')
  const remote         = workingToday.filter((e) => e.dutyLocation === 'remote')
  const unassigned     = workingToday.filter(
    (e) => !e.dutyLocation || !['warehouse', 'office', 'remote'].includes(e.dutyLocation)
  )

  // Weekly breakdown (off per day)
  const weeklyBreakdown = DAYS.map((day) => ({
    ...day,
    off: filtered.filter((e) => e.weeklyOffDay === day.key),
  }))

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
              <h2 className="roster-section__title">Weekly Off Schedule</h2>
              <p className="roster-section__sub">
                Shows which employees are off on each day of the week
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
                    <th>Weekly Off</th>
                    <th>Work Location</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((emp) => {
                    const isOff = emp.weeklyOffDay === todayKey
                    return (
                      <tr key={emp.id} className={isOff ? 'roster-table__row--off' : ''}>
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
                          {emp.weeklyOffDay
                            ? <span className="roster-badge roster-badge--off-day">{capitalize(emp.weeklyOffDay)}</span>
                            : <span className="roster-table__unset">Not set</span>
                          }
                        </td>
                        <td>
                          {emp.dutyLocation
                            ? <span className={`roster-badge roster-badge--${emp.dutyLocation}`}>{capitalize(emp.dutyLocation)}</span>
                            : <span className="roster-table__unset">Not set</span>
                          }
                        </td>
                        <td>
                          {isOff
                            ? <span className="roster-badge roster-badge--red">Off Today</span>
                            : <span className="roster-badge roster-badge--green">Working</span>
                          }
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
