import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  CalendarClock,
  CalendarRange,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Flag,
  RefreshCw,
  Sparkles,
  Video,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { fmtDMY } from '../../utils/dateFormat'
import { formatNumber } from '../../utils/influencerPerformanceUtils'
import {
  INFLUENCER_MODULE_TIMELINE_EVENT_TYPES,
  INFLUENCER_MODULE_TIMELINE_STATUSES,
  type InfluencerModuleTimelineEvent,
  type InfluencerModuleTimelineEventType,
  type InfluencerModuleTimelineStatus,
} from '../../types/influencer'
import { useInfluencerModuleTimeline } from './useInfluencerModuleTimeline'
import {
  influencerProfileUrl,
  paymentsUrlForContract,
  performanceUrlForContract,
} from './influencerModuleTimelineUtils'
import './influencers.css'
import './InfluencerDashboard.css'
import './InfluencerModuleTimeline.css'

const DATE_PRESETS = [
  { id: 'this_month', label: 'This Month' },
  { id: 'last_month', label: 'Last Month' },
  { id: 'this_quarter', label: 'This Quarter' },
  { id: 'this_year', label: 'This Year' },
  { id: 'custom', label: 'Custom Range' },
  { id: 'all_time', label: 'All Time' },
] as const

const EVENT_TYPE_LABELS: Record<InfluencerModuleTimelineEventType, string> = {
  contract_start: 'Contract start',
  contract_end: 'Contract end',
  contract_completed: 'Contract completed',
  check_in: 'Check-in',
  workflow: 'Workflow',
  shoot_scheduled: 'Shoot scheduled',
  payment_due: 'Payment due',
  payment_completed: 'Payment completed',
  payment_updated: 'Payment updated',
}

const STATUS_LABELS: Record<InfluencerModuleTimelineStatus, string> = {
  normal: 'Normal',
  upcoming: 'Upcoming',
  completed: 'Completed',
  needs_attention: 'Needs attention',
  overdue: 'Overdue',
}

function eventIcon(type: InfluencerModuleTimelineEventType): LucideIcon {
  const map: Record<InfluencerModuleTimelineEventType, LucideIcon> = {
    contract_start: CalendarRange,
    contract_end: CalendarClock,
    contract_completed: CheckCircle2,
    check_in: ClipboardCheck,
    workflow: Sparkles,
    shoot_scheduled: Video,
    payment_due: CircleDollarSign,
    payment_completed: CircleDollarSign,
    payment_updated: CircleDollarSign,
  }
  return map[type] || Flag
}

function formatAed(value: number | null): string | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null
  return formatNumber(value, { currency: 'AED' })
}

function statusClass(status: InfluencerModuleTimelineStatus): string {
  if (status === 'upcoming') return 'inf-module-timeline__status--upcoming'
  if (status === 'completed') return 'inf-module-timeline__status--completed'
  if (status === 'needs_attention') return 'inf-module-timeline__status--attention'
  if (status === 'overdue') return 'inf-module-timeline__status--overdue'
  return ''
}

function defaultEventUrl(event: InfluencerModuleTimelineEvent): string {
  if (event.type === 'payment_due' || event.type === 'payment_completed' || event.type === 'payment_updated') {
    return event.contractId ? paymentsUrlForContract(event.contractId) : influencerProfileUrl(event.influencerId)
  }
  if (event.contractId && (event.type === 'check_in' || event.type.startsWith('contract_'))) {
    return performanceUrlForContract(event.contractId)
  }
  return influencerProfileUrl(event.influencerId)
}

function TimelineSkeleton() {
  return (
    <div>
      <div className="inf-dashboard__skeleton-grid">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="inf-dashboard__skeleton" />
        ))}
      </div>
      <div className="inf-module-timeline__skeleton inf-dashboard__skeleton-panel" />
    </div>
  )
}

function TimelineEventRow({ event }: { event: InfluencerModuleTimelineEvent }) {
  const navigate = useNavigate()
  const Icon = eventIcon(event.type)
  const amount = formatAed(event.amountAed)
  const statusText = event.paymentStatus || STATUS_LABELS[event.status]

  return (
    <li>
      <button
        type="button"
        className="inf-module-timeline__event"
        onClick={() => navigate(defaultEventUrl(event))}
      >
        <span className="inf-module-timeline__event-icon" aria-hidden="true">
          <Icon size={15} />
        </span>
        <span className="inf-module-timeline__event-main">
          <p className="inf-module-timeline__event-title">{event.title}</p>
          <p className="inf-module-timeline__event-meta">
            {event.influencerName}
            {event.contractLabel ? ` · ${event.contractLabel}` : ''}
            {' · '}
            {fmtDMY(event.date)}
          </p>
          <p className="inf-module-timeline__event-desc">{event.description}</p>
          {(event.metricLabel && event.metricValue) ? (
            <p className="inf-module-timeline__event-desc">{event.metricLabel}: {event.metricValue}</p>
          ) : null}
          <div className="inf-module-timeline__event-links" onClick={(e) => e.stopPropagation()}>
            <button type="button" onClick={() => navigate(influencerProfileUrl(event.influencerId))}>
              Influencer
            </button>
            {event.contractId ? (
              <>
                <button type="button" onClick={() => navigate(performanceUrlForContract(event.contractId!))}>
                  Contract
                </button>
                {(event.type === 'payment_due' || event.type === 'payment_completed' || event.type === 'payment_updated') ? (
                  <button type="button" onClick={() => navigate(paymentsUrlForContract(event.contractId!))}>
                    Payment
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        </span>
        <span className="inf-module-timeline__event-side">
          {amount ? <strong className="inf-module-timeline__event-amount">{amount}</strong> : null}
          <span className="inf-module-timeline__event-date">{fmtDMY(event.date)}</span>
          <span className={`inf-module-timeline__status ${statusClass(event.status)}`}>{statusText}</span>
        </span>
      </button>
    </li>
  )
}

export function InfluencerTimelinePage() {
  const {
    loading,
    error,
    reload,
    filters,
    updateFilters,
    resetFilters,
    summary,
    groupedEvents,
    remainingCount,
    hasMore,
    loadMore,
    influencers,
    contractOptions,
  } = useInfluencerModuleTimeline()

  if (loading) return <TimelineSkeleton />

  if (error) {
    return (
      <section className="clay-card inf-dashboard__panel">
        <div className="inf-empty">
          <AlertCircle size={28} aria-hidden style={{ opacity: 0.7 }} />
          <div className="inf-empty__title">Could not load timeline</div>
          <div className="inf-empty__desc">{error}</div>
          <button type="button" className="inf-btn inf-btn--primary inf-btn--xs" onClick={() => void reload()}>
            <RefreshCw size={14} aria-hidden /> Retry
          </button>
        </div>
      </section>
    )
  }

  return (
    <div className="inf-module-timeline">
      <div className="inf-module-timeline__intro clay-card" style={{ padding: '0.9rem 1rem' }}>
        <h2 className="inf-payments-roi__title">Timeline</h2>
        <p>
          Operational view across contracts — check-ins, milestones, workflow updates, and finance events.
          Per-contract check-in editing remains on Performance; this page reuses that data without a second check-in system.
        </p>
      </div>

      {summary ? (
        <div className="inf-module-timeline__summary">
          <div className="inf-module-timeline__summary-item inf-module-timeline__summary-item--upcoming">
            <strong>{summary.upcoming}</strong>
            <span>Upcoming</span>
          </div>
          <div className="inf-module-timeline__summary-item inf-module-timeline__summary-item--due">
            <strong>{summary.dueSoon}</strong>
            <span>Due Soon</span>
          </div>
          <div className="inf-module-timeline__summary-item inf-module-timeline__summary-item--overdue">
            <strong>{summary.overdue}</strong>
            <span>Overdue</span>
          </div>
          <div className="inf-module-timeline__summary-item inf-module-timeline__summary-item--done">
            <strong>{summary.completedRecently}</strong>
            <span>Completed Recently</span>
          </div>
        </div>
      ) : null}

      <div className="inf-dashboard__toolbar">
        <div className="inf-dashboard__filters">
          <span className="inf-dashboard__filter-label">Period</span>
          {DATE_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`inf-chip ${filters.datePreset === preset.id ? 'inf-chip--active' : ''}`}
              onClick={() => updateFilters({ datePreset: preset.id })}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="inf-dashboard__grouping">
          <span className="inf-dashboard__filter-label">Group</span>
          {(['date', 'influencer', 'contract'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={`inf-chip ${filters.groupMode === mode ? 'inf-chip--active' : ''}`}
              onClick={() => updateFilters({ groupMode: mode })}
            >
              {mode === 'date' ? 'By Date' : mode === 'influencer' ? 'By Influencer' : 'By Contract'}
            </button>
          ))}
        </div>
      </div>

      {filters.datePreset === 'custom' ? (
        <div className="inf-dashboard__custom-range clay-card" style={{ marginBottom: '1rem', padding: '0.85rem 1rem' }}>
          <label>
            From
            <input
              className="ip-control"
              type="date"
              value={filters.customFrom}
              onChange={(e) => updateFilters({ customFrom: e.target.value })}
            />
          </label>
          <label>
            To
            <input
              className="ip-control"
              type="date"
              value={filters.customTo}
              onChange={(e) => updateFilters({ customTo: e.target.value })}
            />
          </label>
        </div>
      ) : null}

      <div className="inf-module-timeline__filters clay-card">
        <label>
          Influencer
          <select
            className="ip-control"
            value={filters.influencerId}
            onChange={(e) => updateFilters({ influencerId: e.target.value })}
          >
            <option value="all">All influencers</option>
            {influencers.slice().sort((a, b) => a.name.localeCompare(b.name)).map((inf) => (
              <option key={inf.id} value={String(inf.id)}>{inf.name}</option>
            ))}
          </select>
        </label>
        <label>
          Contract
          <select
            className="ip-control"
            value={filters.contractId}
            onChange={(e) => updateFilters({ contractId: e.target.value })}
          >
            <option value="all">All contracts</option>
            {contractOptions.map((option) => (
              <option key={option.id} value={option.id}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          Event type
          <select
            className="ip-control"
            value={filters.eventType}
            onChange={(e) => updateFilters({ eventType: e.target.value as typeof filters.eventType })}
          >
            <option value="all">All events</option>
            {INFLUENCER_MODULE_TIMELINE_EVENT_TYPES.map((type) => (
              <option key={type} value={type}>{EVENT_TYPE_LABELS[type]}</option>
            ))}
          </select>
        </label>
        <label>
          Status
          <select
            className="ip-control"
            value={filters.status}
            onChange={(e) => updateFilters({ status: e.target.value as typeof filters.status })}
          >
            <option value="all">All statuses</option>
            {INFLUENCER_MODULE_TIMELINE_STATUSES.map((status) => (
              <option key={status} value={status}>{STATUS_LABELS[status]}</option>
            ))}
          </select>
        </label>
        <label className="inf-module-timeline__checkbox">
          <input
            type="checkbox"
            checked={filters.needsAttentionOnly}
            onChange={(e) => updateFilters({ needsAttentionOnly: e.target.checked })}
          />
          Needs attention only
        </label>
        <button type="button" className="inf-btn inf-btn--ghost inf-btn--xs" onClick={resetFilters}>
          Reset filters
        </button>
      </div>

      <div className="inf-module-timeline__feed">
        {groupedEvents.length === 0 ? (
          <section className="clay-card inf-dashboard__panel">
            <div className="inf-empty">
              <div className="inf-empty__title">No timeline events</div>
              <div className="inf-empty__desc">
                Try widening the date range or clearing filters. Events are derived from performance check-ins, roster workflow entries, and contract payments.
              </div>
            </div>
          </section>
        ) : (
          groupedEvents.map((group) => (
            <section key={group.key} className="clay-card" style={{ padding: '0.75rem 0.85rem' }}>
              <h3 className="inf-module-timeline__group-title">{group.label}</h3>
              <ul className="inf-module-timeline__list">
                {group.events.map((event) => (
                  <TimelineEventRow key={event.id} event={event} />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {hasMore ? (
        <div className="inf-module-timeline__load-more">
          <button type="button" className="inf-btn inf-btn--secondary" onClick={loadMore}>
            Load more ({remainingCount} remaining)
          </button>
        </div>
      ) : null}
    </div>
  )
}
