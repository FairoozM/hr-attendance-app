import type { ReactNode } from 'react'
import type { BadgeTone, PlanStatus, RowBadge, SortState, StepStatus } from './purchasePlanningTypes'
import { STEP_STATUS_LABELS, STEP_STATUS_TONES } from './purchasePlanningUtils'

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: BadgeTone }) {
  return <span className={`pp-badge pp-badge--${tone}`}>{children}</span>
}

export function FilterChip({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" className={`pp-filter-chip ${active ? 'pp-filter-chip--active' : ''}`} onClick={onClick}>
      {children}
    </button>
  )
}

interface SortHeaderProps {
  label: string
  sortKey: string
  sort: SortState
  onSort: (next: SortState) => void
  nextSortFn: (current: SortState, key: string) => SortState
}

export function SortHeader({ label, sortKey, sort, onSort, nextSortFn }: SortHeaderProps) {
  const active = sort.key === sortKey
  return (
    <th aria-sort={active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined}>
      <button
        type="button"
        className={`pp-sort-header ${active ? 'pp-sort-header--active' : ''}`}
        onClick={() => onSort(nextSortFn(sort, sortKey))}
      >
        <span>{label}</span>
        <span className="pp-sort-header__icon" aria-hidden>
          {active ? (sort.direction === 'asc' ? '↑' : '↓') : '↕'}
        </span>
      </button>
    </th>
  )
}

export function RowBadgeList({ badges }: { badges: RowBadge[] }) {
  if (!badges.length) return null
  return (
    <div className="pp-row-badges">
      {badges.map((badge) => (
        <Badge key={badge.key} tone={badge.tone}>
          {badge.label}
        </Badge>
      ))}
    </div>
  )
}

const PLAN_STATUS_BADGES: Record<PlanStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'warning' },
  reviewed: { label: 'Reviewed', tone: 'warning' },
  sending: { label: 'Sending to Zoho', tone: 'warning' },
  sent_to_zoho: { label: 'Sent to Zoho', tone: 'success' },
  failed: { label: 'Send failed', tone: 'danger' },
}

export function PlanStatusBadge({ status }: { status: PlanStatus }) {
  const badge = PLAN_STATUS_BADGES[status] || { label: status, tone: 'muted' as BadgeTone }
  return <Badge tone={badge.tone}>{badge.label}</Badge>
}

export function StepStatusBadge({ status }: { status: StepStatus }) {
  return <Badge tone={STEP_STATUS_TONES[status] || 'muted'}>{STEP_STATUS_LABELS[status] || status}</Badge>
}
