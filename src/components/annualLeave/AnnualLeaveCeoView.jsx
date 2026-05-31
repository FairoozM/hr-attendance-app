import { useMemo, useState } from 'react'
import { alDaysBetween } from '../../utils/annualLeaveUtils'
import {
  alternateAvailabilityForRow,
  CEO_SORT_OPTIONS,
  CEO_STATUS_FILTERS,
  computeCeoOverviewStats,
  resolveAlternateEmployeePhotoUrl,
  splitCeoDisplayDate,
} from '../../utils/annualLeaveCeoView'
import { ModernSearchInput } from '../ui/ModernSearchInput'
import { ModernSelect } from '../ui/ModernSelect'
import { ANNUAL_LEAVE_STORAGE_KEY } from '../../lib/annualLeaveMockData'

const CEO_PAGE_SIZE = 24
const CEO_EMP_AVATAR_SIZE = 70
const CEO_ALT_AVATAR_SIZE = 64

function SummaryMetric({ label, value }) {
  return (
    <div className="al-ceo-summary__item">
      <span className="al-ceo-summary__label">{label}</span>
      <span className="al-ceo-summary__value">{value}</span>
    </div>
  )
}

function CeoDateBlock({ label, isoDate, compact = false }) {
  const parts = splitCeoDisplayDate(isoDate)
  if (!parts) return null

  return (
    <div
      className={
        compact
          ? 'flex min-w-[60px] flex-col items-center rounded-md border border-neutral-200 bg-neutral-50 px-1 py-0.5 text-center'
          : 'flex min-w-[56px] flex-col items-center rounded-md border border-neutral-200 bg-white px-1 py-0.5 text-center'
      }
    >
      <div className="mb-0 text-center text-[6px] font-extrabold uppercase tracking-[0.12em] text-neutral-400">
        {label}
      </div>
      <div className="flex items-baseline justify-center gap-1">
        <span className="text-[12px] font-black leading-none tracking-[-0.06em] text-neutral-950">
          {parts.day}
        </span>
        <span className="text-[8px] font-bold uppercase leading-none text-neutral-700">{parts.month}</span>
      </div>
      <div className="mt-0 w-full text-center text-[8px] font-bold leading-none text-neutral-400">
        {parts.year}
      </div>
    </div>
  )
}

function CeoLeavePeriod({ fromDate, toDate, days }) {
  return (
    <div className="al-ceo-leave-period al-ceo-leave-period__track grid w-[280px] grid-cols-[1fr_auto_1fr] items-center rounded-lg border border-neutral-200 bg-neutral-50/80 p-0.5">
      <CeoDateBlock label="From" isoDate={fromDate} compact />

      <div className="flex min-w-[3.75rem] flex-col items-center justify-center gap-0.5 px-0.5">
        <div className="flex h-4 w-4 items-center justify-center rounded-full border border-neutral-200 bg-white text-[9px] font-bold text-neutral-400">
          →
        </div>
        <span className="al-ceo-days-pill">
          {days} day{days !== 1 ? 's' : ''}
        </span>
      </div>

      <CeoDateBlock label="To" isoDate={toDate} />
    </div>
  )
}

function CeoPersonPhoto({ name, photoUrl, size = CEO_EMP_AVATAR_SIZE }) {
  const [imgFailed, setImgFailed] = useState(false)
  const initial = (name || '?')[0].toUpperCase()
  const showImg = Boolean(photoUrl) && !imgFailed

  if (showImg) {
    return (
      <img
        src={photoUrl}
        alt=""
        className="al-ceo-plan-avatar shrink-0 border border-neutral-200 object-cover"
        style={{ width: size, height: size, fontSize: size * 0.38 }}
        onError={() => setImgFailed(true)}
      />
    )
  }

  return (
    <div
      className="al-ceo-plan-avatar flex shrink-0 items-center justify-center border border-neutral-200 bg-neutral-100 font-bold text-neutral-600"
      style={{ width: size, height: size, fontSize: size * 0.38 }}
    >
      {initial}
    </div>
  )
}

function CeoPerson({ photoUrl, name, role, children, avatarSize = CEO_EMP_AVATAR_SIZE }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <CeoPersonPhoto name={name} photoUrl={photoUrl} size={avatarSize} />
      <div className="min-w-0 flex-1">
        <div
          className="truncate text-[13px] font-bold leading-snug tracking-[-0.03em] text-neutral-950"
          title={name || undefined}
        >
          {name || '—'}
        </div>
        {role ? <div className="truncate text-[10px] font-medium leading-snug text-neutral-500" title={role}>{role}</div> : null}
        {children}
      </div>
    </div>
  )
}

function CeoAltBadge({ status, label }) {
  if (status === 'available') {
    return (
      <span className="mt-0.5 inline-flex rounded-full bg-emerald-50 px-1.5 py-[2px] text-[9px] font-bold leading-none text-emerald-800 ring-1 ring-emerald-100">
        {label}
      </span>
    )
  }
  if (status === 'unavailable') {
    return (
      <span className="mt-0.5 inline-flex rounded-full bg-red-50 px-1.5 py-[2px] text-[9px] font-bold leading-none text-red-800 ring-1 ring-red-100">
        {label}
      </span>
    )
  }
  return (
    <span className="mt-0.5 inline-flex rounded-full bg-neutral-100 px-1.5 py-[2px] text-[9px] font-bold leading-none text-neutral-600 ring-1 ring-neutral-200">
      {label}
    </span>
  )
}

function CeoRowSkeleton() {
  return (
    <div className="al-ceo-plan-row al-ceo-plan-grid" aria-hidden>
      <div className="al-ceo-plan-cell al-ceo-plan-cell--emp">
        <div className="flex items-center gap-2.5">
          <div className="al-ceo-plan-avatar bg-neutral-100" style={{ width: CEO_EMP_AVATAR_SIZE, height: CEO_EMP_AVATAR_SIZE }} />
          <div className="space-y-1">
            <div className="h-3 w-24 rounded bg-neutral-100" />
            <div className="h-2 w-16 rounded bg-neutral-100" />
          </div>
        </div>
      </div>
      <div className="al-ceo-plan-cell al-ceo-plan-cell--period">
        <div className="mx-auto h-11 w-[280px] rounded-lg bg-neutral-100" />
      </div>
      <div className="al-ceo-plan-cell al-ceo-plan-cell--alt">
        <div className="flex items-center gap-2.5">
          <div className="al-ceo-plan-avatar bg-neutral-100" style={{ width: CEO_ALT_AVATAR_SIZE, height: CEO_ALT_AVATAR_SIZE }} />
          <div className="h-3 w-20 rounded bg-neutral-100" />
        </div>
      </div>
    </div>
  )
}

function LeaveRequestCard({ row, allRequests }) {
  const days = row.leave_days ?? alDaysBetween(row.from_date, row.to_date)
  const alt = alternateAvailabilityForRow(row, allRequests)
  const alternatePhotoUrl = resolveAlternateEmployeePhotoUrl(row)
  const role = row.department || row.designation || ''

  return (
    <div className="al-ceo-plan-row al-ceo-plan-grid">
      <div className="al-ceo-plan-cell al-ceo-plan-cell--emp">
        <CeoPerson photoUrl={row.photo_url} name={row.full_name} role={role} avatarSize={CEO_EMP_AVATAR_SIZE} />
      </div>

      <div className="al-ceo-plan-cell al-ceo-plan-cell--period">
        <CeoLeavePeriod fromDate={row.from_date} toDate={row.to_date} days={days} />
      </div>

      <div className="al-ceo-plan-cell al-ceo-plan-cell--alt">
        {alt.name ? (
          <CeoPerson photoUrl={alternatePhotoUrl} name={alt.name} avatarSize={CEO_ALT_AVATAR_SIZE}>
            <CeoAltBadge status={alt.status} label={alt.label} />
          </CeoPerson>
        ) : (
          <CeoPerson photoUrl={null} name="—" avatarSize={CEO_ALT_AVATAR_SIZE}>
            <CeoAltBadge status="missing" label="Not assigned" />
          </CeoPerson>
        )}
      </div>
    </div>
  )
}

function CeoPlanBoard({ children }) {
  return (
    <div className="al-ceo-plan-board overflow-x-auto rounded-2xl border border-neutral-200 bg-white/60 p-2 shadow-sm">
      <div className="al-ceo-plan-board__inner">
        <div className="al-ceo-plan-grid al-ceo-plan-grid--head mb-2 rounded-xl border border-neutral-200 bg-[#f0eee9]">
          <div className="al-ceo-plan-cell al-ceo-plan-cell--emp al-ceo-plan-cell--head">
            Employee
          </div>
          <div className="al-ceo-plan-cell al-ceo-plan-cell--period al-ceo-plan-cell--head">
            Leave Period
          </div>
          <div className="al-ceo-plan-cell al-ceo-plan-cell--alt al-ceo-plan-cell--head">
            Alternate / Availability
          </div>
        </div>
        <div className="al-ceo-plan-list">{children}</div>
      </div>
    </div>
  )
}

/**
 * CEO overview — row-card layout: employee, leave period blocks, alternate cover.
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
          <h2 className="al-ceo-overview__title">Annual Leave Plan</h2>
          <p className="al-ceo-overview__subtitle">
            Row-card layout with each leave entry wrapped in one clean container.
          </p>
        </header>
        <CeoPlanBoard>
          {[1, 2, 3, 4].map((i) => (
            <CeoRowSkeleton key={i} />
          ))}
        </CeoPlanBoard>
      </section>
    )
  }

  if (error) {
    return (
      <section className="al-ceo-overview" aria-label="CEO leave overview error">
        <header className="al-ceo-overview__header">
          <p className="al-ceo-overview__eyebrow">CEO Overview</p>
          <h2 className="al-ceo-overview__title">Annual Leave Plan</h2>
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
            Annual Leave Plan
          </h2>
          <p className="al-ceo-overview__subtitle">
            Row-card layout with each leave entry wrapped in one clean container.
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
          <CeoPlanBoard>
            {visible.map((row) => (
              <LeaveRequestCard key={row.id} row={row} allRequests={allRequests || rows} />
            ))}
          </CeoPlanBoard>

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
