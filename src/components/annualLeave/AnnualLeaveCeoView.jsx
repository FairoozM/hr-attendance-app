import { useMemo, useState } from 'react'
import { alDaysBetween } from '../../utils/annualLeaveUtils'
import {
  alternateAvailabilityForRow,
  calculateLeaveAppliedThisYear,
  getLeaveEntitlement,
  CEO_SORT_OPTIONS,
  CEO_STATUS_FILTERS,
  computeCeoOverviewStats,
  fmtLeavePeriodCeo,
  formatDate,
  getStatusStyle,
  resolveAlternateEmployeePhotoUrl,
  roundupMonthsUntilLeave,
} from '../../utils/annualLeaveCeoView'
import { leaveStatusDisplay } from './annualLeaveLabels'
import { ModernSearchInput } from '../ui/ModernSearchInput'
import { ModernSelect } from '../ui/ModernSelect'
import { ANNUAL_LEAVE_STORAGE_KEY } from '../../lib/annualLeaveMockData'

const CEO_PAGE_SIZE = 24
const CEO_EMP_AVATAR_SIZE = 88
const CEO_ALT_AVATAR_SIZE = 80

function SkeletonCard() {
  return (
    <div className="al-ceo-card al-ceo-card--skeleton" aria-hidden>
      <div className="al-ceo-card__sk-avatar" />
      <div className="al-ceo-card__sk-body">
        <div className="al-ceo-card__sk-line al-ceo-card__sk-line--lg" />
        <div className="al-ceo-card__sk-line" />
      </div>
      <div className="al-ceo-card__sk-block" />
      <div className="al-ceo-card__sk-alt" />
      <div className="al-ceo-card__sk-block" />
    </div>
  )
}

function SummaryMetric({ label, value }) {
  return (
    <div className="al-ceo-summary__item">
      <span className="al-ceo-summary__label">{label}</span>
      <span className="al-ceo-summary__value">{value}</span>
    </div>
  )
}

/** Rounded-square avatar for CEO view (2× default size). */
function CeoAvatar({ name, photoUrl, size = CEO_EMP_AVATAR_SIZE }) {
  const [imgFailed, setImgFailed] = useState(false)
  const initial = (name || '?')[0].toUpperCase()
  const showImg = Boolean(photoUrl) && !imgFailed

  return (
    <div
      className="al-avatar al-ceo-avatar"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {showImg ? (
        <img src={photoUrl} alt="" onError={() => setImgFailed(true)} />
      ) : (
        initial
      )}
    </div>
  )
}

/** One card = one annual leave request (single block, not installments). */
function LeaveRequestCard({ row, allRequests }) {
  const days = row.leave_days ?? alDaysBetween(row.from_date, row.to_date)
  const appliedThisYear = calculateLeaveAppliedThisYear(row, allRequests)
  const entitlement = getLeaveEntitlement(row)
  const alt = alternateAvailabilityForRow(row, allRequests)
  const alternatePhotoUrl = resolveAlternateEmployeePhotoUrl(row)
  const joining = row.employee_joining_date
  const months = roundupMonthsUntilLeave(joining, row.from_date)
  const es = row.effective_status || row.status
  const statusStyle = getStatusStyle(es)
  const role = row.department || row.designation || ''

  return (
    <article className="al-ceo-card">
      <div className="al-ceo-card__grid">
        <div className="al-ceo-card__col al-ceo-card__col--emp">
          <span className="al-ceo-card__col-label">Employee</span>
          <div className="al-ceo-card__person">
            <CeoAvatar name={row.full_name} photoUrl={row.photo_url} size={CEO_EMP_AVATAR_SIZE} />
            <div>
              <span className="al-ceo-card__name">{row.full_name || '—'}</span>
              {role ? <span className="al-ceo-card__role">{role}</span> : null}
            </div>
          </div>
        </div>

        <div className="al-ceo-card__col al-ceo-card__col--period">
          <span className="al-ceo-card__col-label">Leave period</span>
          <span className="al-ceo-card__period">{fmtLeavePeriodCeo(row.from_date, row.to_date)}</span>
          <span className="al-ceo-card__days">
            {days} day{days !== 1 ? 's' : ''} this request
          </span>
        </div>

        <div className="al-ceo-card__col al-ceo-card__col--applied">
          <span className="al-ceo-card__col-label">Annual leave applied</span>
          <span className="al-ceo-card__value al-ceo-card__value--applied">
            <strong>{appliedThisYear}</strong> day{appliedThisYear !== 1 ? 's' : ''}
          </span>
          <span className="al-ceo-card__days">
            {entitlement != null
              ? `${Math.max(0, entitlement - appliedThisYear)} remaining of ${entitlement}`
              : 'This calendar year'}
          </span>
        </div>

        <div className="al-ceo-card__col al-ceo-card__col--alt">
          <span className="al-ceo-card__col-label">Alternate / availability</span>
          {alt.name ? (
            <div className="al-ceo-card__alt">
              <CeoAvatar name={alt.name} photoUrl={alternatePhotoUrl} size={CEO_ALT_AVATAR_SIZE} />
              <div>
                <span className="al-ceo-card__alt-name">{alt.name}</span>
                <span className={`al-ceo-alt-badge al-ceo-alt-badge--${alt.status}`}>
                  {alt.label}
                </span>
              </div>
            </div>
          ) : (
            <div className="al-ceo-card__alt al-ceo-card__alt--missing">
              <span className="al-ceo-card__alt-name">—</span>
              <span className="al-ceo-alt-badge al-ceo-alt-badge--missing">Not assigned</span>
            </div>
          )}
        </div>

        <div className="al-ceo-card__col al-ceo-card__col--join">
          <span className="al-ceo-card__col-label">Joining date</span>
          <span className="al-ceo-card__value">{joining ? formatDate(joining) : '—'}</span>
        </div>

        <div className="al-ceo-card__col al-ceo-card__col--tenure">
          <span className="al-ceo-card__col-label">Tenure at leave start</span>
          <span className="al-ceo-card__value al-ceo-card__value--tenure">
            {months != null ? (
              <>
                <strong>{months}</strong> mo
              </>
            ) : (
              '—'
            )}
          </span>
        </div>

        <div className="al-ceo-card__col al-ceo-card__col--status">
          <span className="al-ceo-card__col-label">Status</span>
          <span className={`al-ceo-status al-ceo-status--${statusStyle}`}>
            {leaveStatusDisplay(es)}
          </span>
        </div>
      </div>
    </article>
  )
}

/**
 * CEO overview — one row per annual leave request.
 * Shows leave period, alternate cover + availability, tenure, status.
 */
export function AnnualLeaveCeoView({
  rows,
  allRequests,
  loading,
  error,
  dashboard,
  onRetry,
  employeeCount,
  usingMockData = false,
  onResetMockData,
}) {
  const [limit, setLimit] = useState(CEO_PAGE_SIZE)
  const [search, setSearch] = useState('')
  const [deptFilter, setDeptFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [sortKey, setSortKey] = useState('from_date_asc')

  const stats = useMemo(
    () => computeCeoOverviewStats(allRequests || rows, dashboard, employeeCount),
    [allRequests, rows, dashboard, employeeCount],
  )

  const departments = useMemo(() => {
    const s = new Set((rows || []).map((r) => r.department).filter(Boolean))
    return Array.from(s).sort()
  }, [rows])

  const filtered = useMemo(() => {
    let list = [...(rows || [])].filter((r) => r.from_date && r.to_date)
    if (deptFilter) list = list.filter((r) => r.department === deptFilter)
    if (statusFilter !== 'All') {
      list = list.filter((r) => (r.effective_status || r.status) === statusFilter)
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(
        (r) =>
          (r.full_name || '').toLowerCase().includes(q) ||
          (r.department || '').toLowerCase().includes(q) ||
          (r.designation || '').toLowerCase().includes(q) ||
          (r.employee_code || '').toLowerCase().includes(q) ||
          (r.alternate_employee_full_name || '').toLowerCase().includes(q),
      )
    }
    list.sort((a, b) => {
      switch (sortKey) {
        case 'from_date_desc': {
          const fa = a.from_date || ''
          const fb = b.from_date || ''
          if (fa !== fb) return fa < fb ? 1 : -1
          return (a.full_name || '').localeCompare(b.full_name || '')
        }
        case 'name_asc':
          return (a.full_name || '').localeCompare(b.full_name || '')
        case 'days_desc': {
          const da = a.leave_days ?? alDaysBetween(a.from_date, a.to_date)
          const db = b.leave_days ?? alDaysBetween(b.from_date, b.to_date)
          return db - da
        }
        case 'from_date_asc':
        default: {
          const fa = a.from_date || ''
          const fb = b.from_date || ''
          if (fa !== fb) return fa < fb ? -1 : 1
          return (a.full_name || '').localeCompare(b.full_name || '')
        }
      }
    })
    return list
  }, [rows, deptFilter, statusFilter, search, sortKey])

  const visible = filtered.slice(0, limit)
  const remaining = Math.max(0, filtered.length - visible.length)

  if (loading) {
    return (
      <section className="al-ceo-overview" aria-busy="true" aria-label="Loading CEO leave overview">
        <header className="al-ceo-overview__header">
          <p className="al-ceo-overview__eyebrow">CEO Overview</p>
          <h2 className="al-ceo-overview__title">Annual Leave</h2>
          <p className="al-ceo-overview__subtitle">
            At-a-glance leave periods, cover, and tenure before each leave starts.
          </p>
        </header>
        <div className="al-ceo-card-list">
          {[1, 2, 3, 4].map((i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      </section>
    )
  }

  if (error) {
    return (
      <section className="al-ceo-overview" aria-label="CEO leave overview error">
        <header className="al-ceo-overview__header">
          <p className="al-ceo-overview__eyebrow">CEO Overview</p>
          <h2 className="al-ceo-overview__title">Annual Leave</h2>
        </header>
        <div className="al-ceo-overview__error" role="alert">
          <p>{error}</p>
          {onRetry ? (
            <button type="button" className="al-ceo-btn al-ceo-btn--ghost" onClick={onRetry}>
              Try again
            </button>
          ) : null}
        </div>
      </section>
    )
  }

  return (
    <section className="al-ceo-overview" aria-labelledby="al-ceo-overview-title">
      {usingMockData && import.meta.env.DEV && (
        <div className="al-ceo-dev-banner" role="status">
          <div>
            <strong>Local dev mock data</strong>
            <span>
              Showing records from localStorage ({ANNUAL_LEAVE_STORAGE_KEY}). Not production data.
            </span>
          </div>
          {onResetMockData ? (
            <button type="button" className="al-ceo-btn al-ceo-btn--ghost" onClick={onResetMockData}>
              Reset mock data
            </button>
          ) : null}
        </div>
      )}

      <header className="al-ceo-overview__header">
        <div className="al-ceo-overview__intro">
          <p className="al-ceo-overview__eyebrow">CEO Overview</p>
          <h2 id="al-ceo-overview-title" className="al-ceo-overview__title">
            Annual Leave
          </h2>
          <p className="al-ceo-overview__subtitle">
            At-a-glance leave periods, cover, and tenure before each leave starts.
          </p>
        </div>
        <div className="al-ceo-overview__stats" aria-label="Leave overview statistics">
          <SummaryMetric label="Requests" value={filtered.length} />
          <SummaryMetric label="On leave" value={stats.onLeave} />
          <SummaryMetric label="Upcoming" value={stats.upcomingLeave} />
          {stats.pendingRequests > 0 ? (
            <SummaryMetric label="Pending approval" value={stats.pendingRequests} />
          ) : null}
        </div>
      </header>

      <div className="al-ceo-toolbar">
        <div className="al-ceo-toolbar__filters">
          <ModernSearchInput
            className="al-ceo-toolbar__search"
            placeholder="Search employee or alternate…"
            value={search}
            onChange={setSearch}
            aria-label="Search employees"
          />
          {departments.length > 0 && (
            <ModernSelect
              value={deptFilter || ''}
              options={[
                { value: '', label: 'All departments' },
                ...departments.map((d) => ({ value: d, label: d })),
              ]}
              onChange={setDeptFilter}
            />
          )}
          <ModernSelect
            value={statusFilter}
            options={CEO_STATUS_FILTERS.map((f) => ({ value: f.key, label: f.label }))}
            onChange={setStatusFilter}
          />
          <ModernSelect
            value={sortKey}
            options={CEO_SORT_OPTIONS.map((o) => ({ value: o.key, label: o.label }))}
            onChange={setSortKey}
          />
        </div>
        <span className="al-ceo-toolbar__count">
          {filtered.length} request{filtered.length !== 1 ? 's' : ''}
        </span>
      </div>

      {!filtered.length ? (
        <div className="al-ceo-overview__empty">
          <div className="al-ceo-overview__empty-icon" aria-hidden />
          <p>No annual leave requests found.</p>
          {(search || deptFilter || statusFilter !== 'All') && (
            <button
              type="button"
              className="al-ceo-btn al-ceo-btn--ghost"
              onClick={() => {
                setSearch('')
                setDeptFilter('')
                setStatusFilter('All')
              }}
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="al-ceo-card-list">
            {visible.map((row) => (
              <LeaveRequestCard
                key={row.id}
                row={row}
                allRequests={allRequests || rows}
              />
            ))}
          </div>

          {remaining > 0 && (
            <div className="al-ceo-overview__more">
              <button
                type="button"
                className="al-ceo-btn al-ceo-btn--ghost"
                onClick={() => setLimit((n) => n + CEO_PAGE_SIZE)}
              >
                Show {Math.min(CEO_PAGE_SIZE, remaining)} more
              </button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
