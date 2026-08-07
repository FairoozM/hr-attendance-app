import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  MoreHorizontal,
  Plus,
  RefreshCw,
  UserRound,
  X,
} from 'lucide-react'
import {
  useAuth,
  canMutateInfluencerPerformance,
  canViewInfluencerPerformanceNetProfit,
  hasPermission,
} from '../../contexts/AuthContext'
import { influencerInitials } from '../../components/influencers/influencerPerformanceTableShared'
import { formatNumber } from '../../utils/influencerPerformanceUtils'
import { fmtDMY } from '../../utils/dateFormat'
import { INFLUENCER_CONTRACT_PAYMENT_FILTER_STATUSES } from '../../types/influencer'
import type { InfluencerContractPaymentFilterStatus } from '../../types/influencer'
import { useInfluencerContracts } from './useInfluencerContracts'
import {
  addContractUrl,
  type InfluencerContractListRow,
  type InfluencerContractSortKey,
  type InfluencerContractStatusFilter,
  type InfluencerContractsFilters,
} from './influencerContractsUtils'
import {
  influencerProfileUrl,
  paymentsUrlForContract,
  performanceContractUrl,
} from './influencerPaymentsRoiUtils'
import type { InfluencerDashboardDatePreset } from './influencerDashboardUtils'
import { INFLUENCER_DASHBOARD_DATE_PRESETS } from './influencerDashboardUtils'
import './influencers.css'
import './InfluencerDashboard.css'
import './InfluencerContracts.css'

const DATE_PRESETS = INFLUENCER_DASHBOARD_DATE_PRESETS

const STATUS_FILTERS: Array<{ id: InfluencerContractStatusFilter; label: string }> = [
  { id: 'all', label: 'All statuses' },
  { id: 'active', label: 'Active' },
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'completed', label: 'Completed' },
  { id: 'pending', label: 'Pending' },
]

const CHECKIN_FILTERS = [
  { id: 'all', label: 'All check-ins' },
  { id: 'complete', label: 'Complete' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'not_started', label: 'Not started' },
] as const

const SORT_COLUMNS: Array<{ key: InfluencerContractSortKey; label: string }> = [
  { key: 'influencer', label: 'Influencer' },
  { key: 'period', label: 'Contract Period' },
  { key: 'campaign', label: 'Campaign / Package' },
  { key: 'status', label: 'Status' },
  { key: 'cost', label: 'Cost' },
  { key: 'sales', label: 'Sales' },
  { key: 'netProfit', label: 'Net Profit' },
  { key: 'roi', label: 'ROI' },
  { key: 'checkins', label: 'Check-in Progress' },
  { key: 'payment', label: 'Payment Status' },
]

function formatAed(value: number): string {
  return formatNumber(value, { currency: 'AED' })
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '0%'
  return `${value.toFixed(1)}%`
}

function payBadge(status: string): string {
  const map: Record<string, string> = {
    Untracked: 'inf-badge--waiting',
    'Not Due': 'inf-badge--not-requested',
    Pending: 'inf-badge--ready',
    'Partially Paid': 'inf-badge--processing',
    Paid: 'inf-badge--paid',
    Overdue: 'inf-badge--waiting',
    Disputed: 'inf-badge--rejected',
  }
  return `inf-badge inf-badge--dot ${map[status] || 'inf-badge--not-requested'}`
}

function statusBadge(label: InfluencerContractListRow['statusLabel']): string {
  const map: Record<InfluencerContractListRow['statusLabel'], string> = {
    Active: 'inf-badge--approved',
    Completed: 'inf-badge--paid',
    Upcoming: 'inf-badge--ready',
    Pending: 'inf-badge--waiting',
  }
  return `inf-badge inf-badge--table ${map[label]}`
}

function ContractsSkeleton() {
  return (
    <div className="inf-dashboard__skeleton-panel" style={{ minHeight: '12rem' }} />
  )
}

function ContractRowActions({
  row,
  canWritePerformance,
  onNavigate,
}: {
  row: InfluencerContractListRow
  canWritePerformance: boolean
  onNavigate: (path: string) => void
}) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function onPointerDown(event: Event) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const run = (path: string) => {
    setOpen(false)
    onNavigate(path)
  }

  return (
    <div ref={rootRef} className="inf-contracts__menu" onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="inf-list-menu__trigger"
        aria-label="Contract actions"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((value) => !value)
        }}
      >
        <MoreHorizontal size={16} aria-hidden />
      </button>
      {open ? (
        <div className="inf-contracts__menu-panel" role="menu">
          <button type="button" className="inf-contracts__menu-item" onClick={() => run(performanceContractUrl(row.contractId))}>
            <ExternalLink size={13} /> View contract
          </button>
          <button type="button" className="inf-contracts__menu-item" onClick={() => run(influencerProfileUrl(row.influencerId))}>
            <UserRound size={13} /> View influencer
          </button>
          {canWritePerformance ? (
            <button type="button" className="inf-contracts__menu-item" onClick={() => run(performanceContractUrl(row.contractId))}>
              Edit in Performance
            </button>
          ) : null}
          <button type="button" className="inf-contracts__menu-item" onClick={() => run(performanceContractUrl(row.contractId))}>
            Open Performance
          </button>
          <button type="button" className="inf-contracts__menu-item" onClick={() => run(paymentsUrlForContract(row.contractId))}>
            Open Payments
          </button>
        </div>
      ) : null}
    </div>
  )
}

export function InfluencerContractsPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const showNetProfit = canViewInfluencerPerformanceNetProfit(user)
  const canWritePerformance = canMutateInfluencerPerformance(user)
  const canAddContract = canWritePerformance

  const {
    loading,
    error,
    reload,
    filters,
    updateFilters,
    clearInfluencerFilter,
    filteredInfluencer,
    pageRows,
    totalRows,
    totalPages,
    campaignOptions,
    influencers,
  } = useInfluencerContracts()

  function toggleSort(key: InfluencerContractSortKey) {
    if (filters.sortKey === key) {
      updateFilters({ sortDirection: filters.sortDirection === 'asc' ? 'desc' : 'asc' })
      return
    }
    updateFilters({ sortKey: key, sortDirection: key === 'period' ? 'desc' : 'asc' })
  }

  function sortIndicator(key: InfluencerContractSortKey): string {
    if (filters.sortKey !== key) return ''
    return filters.sortDirection === 'asc' ? ' ↑' : ' ↓'
  }

  if (loading) return <ContractsSkeleton />

  if (error) {
    return (
      <section className="clay-card inf-dashboard__panel">
        <div className="inf-empty">
          <AlertCircle size={28} aria-hidden style={{ opacity: 0.7 }} />
          <div className="inf-empty__title">Could not load contracts</div>
          <div className="inf-empty__desc">{error}</div>
          <button type="button" className="inf-btn inf-btn--primary inf-btn--xs" onClick={() => void reload()}>
            <RefreshCw size={14} aria-hidden /> Retry
          </button>
        </div>
      </section>
    )
  }

  return (
    <div>
      <div className="inf-contracts__toolbar">
        {canAddContract ? (
          <Link
            to={addContractUrl(filters.influencerId !== 'all' ? filters.influencerId : undefined)}
            className="inf-btn inf-btn--primary inf-btn--xs"
          >
            <Plus size={14} aria-hidden /> Add Contract
          </Link>
        ) : null}
        <button type="button" className="inf-btn inf-btn--ghost inf-btn--xs" onClick={() => void reload()}>
          <RefreshCw size={14} aria-hidden /> Refresh
        </button>
        <span className="inf-table__muted" style={{ marginLeft: 'auto' }}>
          {totalRows} contract{totalRows === 1 ? '' : 's'}
        </span>
      </div>

      {filteredInfluencer ? (
        <div className="inf-contracts__filter-banner">
          <UserRound size={14} aria-hidden />
          <span>Filtered by: <strong>{filteredInfluencer.name}</strong></span>
          <button type="button" className="inf-btn inf-btn--ghost inf-btn--xs" onClick={clearInfluencerFilter}>
            <X size={12} aria-hidden /> Clear filter
          </button>
          <Link to={influencerProfileUrl(filteredInfluencer.id)} className="inf-btn inf-btn--ghost inf-btn--xs">
            View profile
          </Link>
        </div>
      ) : null}

      <section className="clay-card inf-dashboard__panel" style={{ marginBottom: '0.75rem' }}>
        <div className="inf-dashboard__filters">
          <label className="inf-dashboard__filter">
            <span>Date range</span>
            <select
              value={filters.datePreset}
              onChange={(e) => updateFilters({ datePreset: e.target.value as InfluencerContractsFilters['datePreset'] })}
            >
              {DATE_PRESETS.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.label}</option>
              ))}
            </select>
          </label>
          {filters.datePreset === 'custom' ? (
            <>
              <label className="inf-dashboard__filter">
                <span>From</span>
                <input type="date" value={filters.customFrom} onChange={(e) => updateFilters({ customFrom: e.target.value })} />
              </label>
              <label className="inf-dashboard__filter">
                <span>To</span>
                <input type="date" value={filters.customTo} onChange={(e) => updateFilters({ customTo: e.target.value })} />
              </label>
            </>
          ) : null}
          <label className="inf-dashboard__filter">
            <span>Influencer</span>
            <select
              value={filters.influencerId}
              onChange={(e) => updateFilters({ influencerId: e.target.value })}
            >
              <option value="all">All influencers</option>
              {influencers.map((inf) => (
                <option key={inf.id} value={inf.id}>{inf.name}</option>
              ))}
            </select>
          </label>
          <label className="inf-dashboard__filter">
            <span>Contract status</span>
            <select
              value={filters.contractStatus}
              onChange={(e) => updateFilters({ contractStatus: e.target.value as InfluencerContractStatusFilter })}
            >
              {STATUS_FILTERS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="inf-dashboard__filter">
            <span>Campaign</span>
            <input
              type="search"
              list="inf-contract-campaigns"
              value={filters.campaignQuery}
              placeholder="Search campaign"
              onChange={(e) => updateFilters({ campaignQuery: e.target.value })}
            />
            <datalist id="inf-contract-campaigns">
              {campaignOptions.map((name) => <option key={name} value={name} />)}
            </datalist>
          </label>
          {hasPermission(user, 'influencers', 'payments') ? (
            <label className="inf-dashboard__filter">
              <span>Payment status</span>
              <select
                value={filters.paymentStatus}
                onChange={(e) => updateFilters({ paymentStatus: e.target.value as InfluencerContractPaymentFilterStatus | 'All' })}
              >
                <option value="All">All</option>
                {INFLUENCER_CONTRACT_PAYMENT_FILTER_STATUSES.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="inf-dashboard__filter">
            <span>Check-in status</span>
            <select
              value={filters.checkInStatus}
              onChange={(e) => updateFilters({ checkInStatus: e.target.value as InfluencerContractsFilters['checkInStatus'] })}
            >
              {CHECKIN_FILTERS.map((item) => (
                <option key={item.id} value={item.id}>{item.label}</option>
              ))}
            </select>
          </label>
          <label className="inf-dashboard__filter">
            <span>Profitability</span>
            <select
              value={filters.profitFilter}
              onChange={(e) => updateFilters({ profitFilter: e.target.value as InfluencerContractsFilters['profitFilter'] })}
            >
              <option value="all">All</option>
              <option value="profitable">Profitable</option>
              <option value="loss_making">Loss-making</option>
            </select>
          </label>
          <label className="inf-dashboard__filter inf-dashboard__filter--checkbox">
            <input
              type="checkbox"
              checked={filters.needsAttentionOnly}
              onChange={(e) => updateFilters({ needsAttentionOnly: e.target.checked })}
            />
            <span>Needs attention</span>
          </label>
        </div>
      </section>

      <section className="clay-card inf-dashboard__panel">
        {pageRows.length === 0 ? (
          <div className="inf-empty">
            <div className="inf-empty__title">No contracts match these filters</div>
            <div className="inf-empty__desc">Try clearing filters or add a contract from Performance.</div>
            {canAddContract ? (
              <Link to={addContractUrl()} className="inf-btn inf-btn--primary inf-btn--xs" style={{ marginTop: '0.65rem' }}>
                <Plus size={14} /> Add Contract
              </Link>
            ) : null}
          </div>
        ) : (
          <div className="inf-table-wrap">
            <table className="inf-table inf-table--compact">
              <thead>
                <tr>
                  {SORT_COLUMNS.map((col) => {
                    if ((col.key === 'netProfit' || col.key === 'roi') && !showNetProfit) return null
                    return (
                      <th key={col.key}>
                        <button type="button" className="inf-contracts__sort-btn" onClick={() => toggleSort(col.key)}>
                          {col.label}{sortIndicator(col.key)}
                        </button>
                      </th>
                    )
                  })}
                  <th aria-label="Attention" />
                  <th aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr
                    key={row.contractId}
                    onClick={() => navigate(performanceContractUrl(row.contractId))}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <div className="inf-list-name-cell">
                        <span className="inf-dashboard__avatar" aria-hidden="true">
                          {row.influencer?.profileImage ? (
                            <img src={row.influencer.profileImage} alt="" />
                          ) : (
                            <span>{influencerInitials(row.influencer?.name || 'Influencer')}</span>
                          )}
                        </span>
                        <div>
                          <div className="inf-table__name">{row.influencer?.name || 'Influencer'}</div>
                          <div className="inf-table__muted">{row.influencer?.username || row.influencerId}</div>
                        </div>
                      </div>
                    </td>
                    <td>{fmtDMY(row.contractStartDate)} – {fmtDMY(row.contractEndDate)}</td>
                    <td>{row.campaignName}</td>
                    <td><span className={statusBadge(row.statusLabel)}>{row.statusLabel}</span></td>
                    <td>{formatAed(row.cost)}</td>
                    <td>{formatAed(row.salesAed)}</td>
                    {showNetProfit ? <td>{formatAed(row.netProfitAed)}</td> : null}
                    {showNetProfit ? <td>{formatPct(row.roi)}</td> : null}
                    <td>{row.recordedDays}/{row.monitoringDays}</td>
                    <td><span className={payBadge(row.effectivePaymentStatus)}>{row.effectivePaymentStatus}</span></td>
                    <td>
                      {row.attentionFlags.length > 0 ? (
                        <span className="inf-contracts__attention">
                          {row.attentionFlags.slice(0, 2).map((flag) => (
                            <span
                              key={flag.id}
                              className={`inf-contracts__attention-chip inf-contracts__attention-chip--${flag.tone}`}
                              title={flag.label}
                            >
                              {flag.label}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="inf-table__muted">—</span>
                      )}
                    </td>
                    <td>
                      <ContractRowActions
                        row={row}
                        canWritePerformance={canWritePerformance}
                        onNavigate={navigate}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 ? (
          <div className="inf-contracts__pagination">
            <span className="inf-table__muted">
              Page {filters.page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <button
                type="button"
                className="inf-btn inf-btn--ghost inf-btn--xs"
                disabled={filters.page <= 1}
                onClick={() => updateFilters({ page: filters.page - 1 })}
              >
                <ChevronLeft size={14} /> Previous
              </button>
              <button
                type="button"
                className="inf-btn inf-btn--ghost inf-btn--xs"
                disabled={filters.page >= totalPages}
                onClick={() => updateFilters({ page: filters.page + 1 })}
              >
                Next <ChevronRight size={14} />
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  )
}
