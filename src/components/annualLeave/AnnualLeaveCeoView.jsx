import { Pencil } from 'lucide-react'
import { useCallback, useMemo, useState } from 'react'
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
  normalizeCeoLastReturnDateMap,
  resolveAlternateEmployeePhotoUrl,
  resolveLastAnnualLeaveReturnDate,
  roundupMonthsUntilLeave,
} from '../../utils/annualLeaveCeoView'
import { leaveStatusDisplay } from './annualLeaveLabels'
import { ModernSearchInput } from '../ui/ModernSearchInput'
import { ModernSelect } from '../ui/ModernSelect'
import { ANNUAL_LEAVE_STORAGE_KEY } from '../../lib/annualLeaveMockData'
import { useUserPreferences } from '../../contexts/UserPreferencesContext'
import { PREF_CEO_AL_LAST_RETURN_DATES } from '../../constants/userPreferenceKeys'

const CEO_PAGE_SIZE = 24
const CEO_EMP_AVATAR_SIZE = 88
const CEO_ALT_AVATAR_SIZE = 80

const CEO_TABLE_COLUMNS = [
  { key: 'emp', label: 'Employee' },
  { key: 'period', label: 'Leave period' },
  { key: 'applied', label: 'Annual leave applied' },
  { key: 'alt', label: 'Alternate / availability' },
  { key: 'lastReturn', label: 'Last annual leave return' },
  { key: 'tenure', label: 'Tenure at leave start' },
  { key: 'status', label: 'Status' },
]

function CeoTableHead() {
  return (
    <>
      <colgroup>
        {CEO_TABLE_COLUMNS.map((col) => (
          <col key={col.key} className={`al-ceo-table__col al-ceo-table__col--${col.key}`} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {CEO_TABLE_COLUMNS.map((col) => (
            <th key={col.key} scope="col" className={`al-ceo-table__col al-ceo-table__col--${col.key}`}>
              {col.label}
            </th>
          ))}
        </tr>
      </thead>
    </>
  )
}

function SkeletonRow() {
  return (
    <tr className="al-ceo-table__row al-ceo-table__row--skeleton" aria-hidden>
      <td><div className="al-ceo-card__sk-avatar" /></td>
      <td><div className="al-ceo-card__sk-line al-ceo-card__sk-line--lg" /></td>
      <td><div className="al-ceo-card__sk-line" /></td>
      <td><div className="al-ceo-card__sk-block" /></td>
      <td><div className="al-ceo-card__sk-line" /></td>
      <td><div className="al-ceo-card__sk-line" /></td>
      <td><div className="al-ceo-card__sk-line" /></td>
    </tr>
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

/** Manual last return date when not available from completed leave records. */
function LastReturnDateCell({ employeeId, resolved, onSaveManual }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const startEdit = () => {
    setDraft(resolved.date || '')
    setEditing(true)
  }

  const cancelEdit = () => {
    setEditing(false)
    setDraft('')
  }

  const saveEdit = () => {
    if (!draft || employeeId == null) return
    onSaveManual(employeeId, draft)
    setEditing(false)
    setDraft('')
  }

  if (resolved.date && !editing) {
    return (
      <div className="al-ceo-last-return">
        <span className="al-ceo-card__value">{formatDate(resolved.date)}</span>
        {resolved.source === 'manual' ? (
          <button
            type="button"
            className="al-ceo-last-return__edit-icon"
            onClick={startEdit}
            aria-label="Edit last return date"
            title="Edit last return date"
          >
            <Pencil size={14} aria-hidden />
          </button>
        ) : null}
      </div>
    )
  }

  if (editing) {
    return (
      <div className="al-ceo-last-return al-ceo-last-return--edit">
        <input
          type="date"
          className="al-ceo-last-return__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          aria-label="Last annual leave return date"
        />
        <div className="al-ceo-last-return__actions">
          <button type="button" className="al-ceo-last-return__action" disabled={!draft} onClick={saveEdit}>
            Save
          </button>
          <button type="button" className="al-ceo-last-return__action al-ceo-last-return__action--muted" onClick={cancelEdit}>
            Cancel
          </button>
        </div>
      </div>
    )
  }

  return (
    <button type="button" className="al-ceo-last-return__add" onClick={startEdit}>
      Add date
    </button>
  )
}

/** One table row = one annual leave request. */
function LeaveRequestRow({ row, allRequests, manualReturnDates, onSaveManualReturn }) {
  const appliedThisYear = calculateLeaveAppliedThisYear(row, allRequests)
  const entitlement = getLeaveEntitlement(row)
  const alt = alternateAvailabilityForRow(row, allRequests)
  const alternatePhotoUrl = resolveAlternateEmployeePhotoUrl(row)
  const lastReturn = resolveLastAnnualLeaveReturnDate(row, allRequests, manualReturnDates)
  const months = lastReturn.date ? roundupMonthsUntilLeave(lastReturn.date, row.from_date) : null
  const es = row.effective_status || row.status
  const statusStyle = getStatusStyle(es)
  const role = row.department || row.designation || ''
  const remainingHint =
    entitlement != null
      ? `${Math.max(0, entitlement - appliedThisYear)} remaining of ${entitlement}`
      : null

  return (
    <tr className="al-ceo-table__row">
      <td className="al-ceo-table__cell al-ceo-table__cell--emp">
        <div className="al-ceo-card__person">
          <CeoAvatar name={row.full_name} photoUrl={row.photo_url} size={CEO_EMP_AVATAR_SIZE} />
          <div>
            <span className="al-ceo-card__name">{row.full_name || '—'}</span>
            {role ? <span className="al-ceo-card__role">{role}</span> : null}
          </div>
        </div>
      </td>

      <td className="al-ceo-table__cell al-ceo-table__cell--period">
        <span className="al-ceo-card__period">{fmtLeavePeriodCeo(row.from_date, row.to_date)}</span>
      </td>

      <td className="al-ceo-table__cell al-ceo-table__cell--applied">
        <span className="al-ceo-card__value al-ceo-card__value--applied">
          <strong>{appliedThisYear}</strong> day{appliedThisYear !== 1 ? 's' : ''}
        </span>
        {remainingHint ? <span className="al-ceo-card__days">{remainingHint}</span> : null}
      </td>

      <td className="al-ceo-table__cell al-ceo-table__cell--alt">
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
      </td>

      <td className="al-ceo-table__cell al-ceo-table__cell--lastReturn">
        <LastReturnDateCell
          employeeId={row.employee_id}
          resolved={lastReturn}
          onSaveManual={onSaveManualReturn}
        />
      </td>

      <td className="al-ceo-table__cell al-ceo-table__cell--tenure">
        <span className="al-ceo-card__value al-ceo-card__value--tenure">
          {months != null ? (
            <>
              <strong>{months}</strong> mo
            </>
          ) : (
            '—'
          )}
        </span>
      </td>

      <td className="al-ceo-table__cell al-ceo-table__cell--status">
        <span className={`al-ceo-status al-ceo-status--${statusStyle}`}>
          {leaveStatusDisplay(es)}
        </span>
      </td>
    </tr>
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
  const { getPref, setPref, prefsVersion } = useUserPreferences()

  const manualReturnDates = useMemo(
    () => normalizeCeoLastReturnDateMap(getPref(PREF_CEO_AL_LAST_RETURN_DATES, {})),
    [getPref, prefsVersion],
  )

  const saveManualReturn = useCallback(
    (employeeId, dateIso) => {
      if (employeeId == null || !dateIso) return
      setPref(PREF_CEO_AL_LAST_RETURN_DATES, {
        ...manualReturnDates,
        [String(employeeId)]: dateIso,
      })
    },
    [manualReturnDates, setPref],
  )

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
            Leave periods, cover, last return date, and tenure since last annual leave.
          </p>
        </header>
        <div className="al-ceo-table-wrap">
          <table className="al-ceo-table">
            <CeoTableHead />
            <tbody>
              {[1, 2, 3, 4].map((i) => (
                <SkeletonRow key={i} />
              ))}
            </tbody>
          </table>
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
            Leave periods, cover, last return date, and tenure since last annual leave.
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
          <div className="al-ceo-table-wrap">
            <table className="al-ceo-table">
              <CeoTableHead />
              <tbody>
                {visible.map((row) => (
                  <LeaveRequestRow
                    key={row.id}
                    row={row}
                    allRequests={allRequests || rows}
                    manualReturnDates={manualReturnDates}
                    onSaveManualReturn={saveManualReturn}
                  />
                ))}
              </tbody>
            </table>
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
