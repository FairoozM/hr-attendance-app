/**
 * Contracts module — composes dashboard contract metrics + Payments & ROI rows.
 * Financial fields always come from latest check-in per contract (dashboard rules).
 */
import type {
  InfluencerContractPayment,
  InfluencerContractPaymentDisplayStatus,
  InfluencerContractPaymentFilterStatus,
} from '../../types/influencer'
import type { Influencer } from '../../lib/influencers'
import type { InfluencerPerformanceInput } from '../../types/influencer'
import {
  buildInfluencerDashboardSnapshot,
  contractOverlapsDateRange,
  resolveDashboardDateRange,
  type DashboardContractMetrics,
  type InfluencerDashboardDatePreset,
  type InfluencerDashboardDateRange,
} from './influencerDashboardUtils'
import {
  buildInfluencerPaymentRows,
  type InfluencerContractPaymentRow,
  type InfluencerPaymentsProfitFilter,
} from './influencerPaymentsRoiUtils'
import { isoDateSlice } from '../../utils/influencerPerformanceUtils'

export const CONTRACTS_PAGE_SIZE = 25

export type InfluencerContractStatusFilter = 'all' | 'active' | 'upcoming' | 'completed' | 'pending'

export type InfluencerContractCheckInFilter = 'all' | 'complete' | 'in_progress' | 'not_started'

export type InfluencerContractSortKey =
  | 'influencer'
  | 'period'
  | 'campaign'
  | 'status'
  | 'cost'
  | 'sales'
  | 'netProfit'
  | 'roi'
  | 'checkins'
  | 'payment'

export type InfluencerContractAttentionFlag = {
  id: string
  label: string
  tone: 'info' | 'warning' | 'danger'
}

export type InfluencerContractListRow = DashboardContractMetrics & {
  paymentStatus: InfluencerContractPaymentDisplayStatus
  effectivePaymentStatus: InfluencerContractPaymentDisplayStatus
  hasPersistedPayment: boolean
  statusLabel: 'Active' | 'Completed' | 'Upcoming' | 'Pending'
  attentionFlags: InfluencerContractAttentionFlag[]
  paymentRow: InfluencerContractPaymentRow | null
}

export type InfluencerContractsFilters = {
  datePreset: InfluencerDashboardDatePreset
  customFrom: string
  customTo: string
  influencerId: string
  contractStatus: InfluencerContractStatusFilter
  campaignQuery: string
  paymentStatus: InfluencerContractPaymentFilterStatus | 'All'
  checkInStatus: InfluencerContractCheckInFilter
  profitFilter: InfluencerPaymentsProfitFilter
  needsAttentionOnly: boolean
  sortKey: InfluencerContractSortKey
  sortDirection: 'asc' | 'desc'
  page: number
}

export function defaultContractsFilters(): InfluencerContractsFilters {
  return {
    datePreset: 'all_time',
    customFrom: '',
    customTo: '',
    influencerId: 'all',
    contractStatus: 'all',
    campaignQuery: '',
    paymentStatus: 'All',
    checkInStatus: 'all',
    profitFilter: 'all',
    needsAttentionOnly: false,
    sortKey: 'period',
    sortDirection: 'desc',
    page: 1,
  }
}

function utcTodayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function addDaysIso(iso: string, days: number): string {
  const dt = new Date(`${iso}T00:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export function deriveContractStatusLabel(
  row: DashboardContractMetrics,
  today = utcTodayIso(),
): InfluencerContractListRow['statusLabel'] {
  if (row.isCompleted) return 'Completed'
  if (row.isActive) return 'Active'
  const start = isoDateSlice(row.contractStartDate)
  if (start && start > today) return 'Upcoming'
  return 'Pending'
}

export function buildContractAttentionFlags(
  row: DashboardContractMetrics,
  payment: InfluencerContractPaymentRow | null,
  today = utcTodayIso(),
): InfluencerContractAttentionFlag[] {
  const flags: InfluencerContractAttentionFlag[] = []
  const endingSoonCutoff = addDaysIso(today, 7)

  if (row.isActive && row.netProfitAed < 0) {
    flags.push({ id: 'loss', label: 'Loss-making', tone: 'danger' })
  }
  if (payment?.hasPersistedPayment && payment.effectiveStatus === 'Overdue') {
    flags.push({ id: 'pay-overdue', label: 'Overdue payment', tone: 'danger' })
  }
  if (payment && !payment.hasPersistedPayment && row.cost > 0) {
    flags.push({ id: 'pay-untracked', label: 'Untracked finance', tone: 'warning' })
  }
  if (row.isActive && row.contractEndDate >= today && row.contractEndDate <= endingSoonCutoff) {
    flags.push({ id: 'ending', label: 'Ending soon', tone: 'warning' })
  }
  if (row.isActive && row.recordedDays < row.monitoringDays) {
    const nextDay = row.contract.days.find((day) => day.inContractWindow && !day.isRecorded && day.date >= today)
    if (nextDay) {
      flags.push({ id: 'checkin', label: 'Upcoming check-in', tone: 'info' })
    }
  }
  if (row.recordedDays === 0 && row.isActive) {
    flags.push({ id: 'no-data', label: 'No check-ins yet', tone: 'info' })
  }
  return flags
}

export function buildInfluencerContractListRows({
  records,
  roster,
  payments,
  today = utcTodayIso(),
}: {
  records: InfluencerPerformanceInput[]
  roster: Influencer[]
  payments: InfluencerContractPayment[]
  today?: string
}): InfluencerContractListRow[] {
  const dashboard = buildInfluencerDashboardSnapshot({
    records,
    roster,
    range: null,
    groupMode: 'contract',
    today,
  })
  const paymentRows = buildInfluencerPaymentRows({
    records,
    roster,
    payments,
    range: null,
    today,
  })
  const paymentByContract = new Map(paymentRows.map((row) => [row.contractId, row]))

  return dashboard.contracts.map((row) => {
    const paymentRow = paymentByContract.get(row.contractId) || null
    return {
      ...row,
      paymentStatus: paymentRow?.paymentStatus ?? 'Untracked',
      effectivePaymentStatus: paymentRow?.effectiveStatus ?? 'Untracked',
      hasPersistedPayment: paymentRow?.hasPersistedPayment ?? false,
      statusLabel: deriveContractStatusLabel(row, today),
      attentionFlags: buildContractAttentionFlags(row, paymentRow, today),
      paymentRow,
    }
  })
}

function matchesContractStatus(row: InfluencerContractListRow, filter: InfluencerContractStatusFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'active') return row.statusLabel === 'Active'
  if (filter === 'completed') return row.statusLabel === 'Completed'
  if (filter === 'upcoming') return row.statusLabel === 'Upcoming'
  return row.statusLabel === 'Pending'
}

function matchesCheckInStatus(row: InfluencerContractListRow, filter: InfluencerContractCheckInFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'complete') return row.recordedDays >= row.monitoringDays
  if (filter === 'in_progress') return row.recordedDays > 0 && row.recordedDays < row.monitoringDays
  return row.recordedDays === 0
}

function matchesPaymentStatus(
  row: InfluencerContractListRow,
  filter: InfluencerContractPaymentFilterStatus | 'All',
): boolean {
  if (filter === 'All') return true
  if (filter === 'Untracked') return !row.hasPersistedPayment
  return row.hasPersistedPayment && row.effectivePaymentStatus === filter
}

export function filterContractListRows(
  rows: InfluencerContractListRow[],
  filters: Pick<
    InfluencerContractsFilters,
    | 'influencerId'
    | 'contractStatus'
    | 'campaignQuery'
    | 'paymentStatus'
    | 'checkInStatus'
    | 'profitFilter'
    | 'needsAttentionOnly'
  >,
  range: InfluencerDashboardDateRange,
): InfluencerContractListRow[] {
  const campaign = filters.campaignQuery.trim().toLowerCase()
  return rows.filter((row) => {
    if (filters.influencerId !== 'all' && String(row.influencerId) !== String(filters.influencerId)) return false
    if (!contractOverlapsDateRange(row.contract, range)) return false
    if (!matchesContractStatus(row, filters.contractStatus)) return false
    if (!matchesCheckInStatus(row, filters.checkInStatus)) return false
    if (!matchesPaymentStatus(row, filters.paymentStatus)) return false
    if (filters.profitFilter === 'profitable' && row.netProfitAed <= 0) return false
    if (filters.profitFilter === 'loss_making' && row.netProfitAed >= 0) return false
    if (filters.needsAttentionOnly && row.attentionFlags.length === 0) return false
    if (campaign) {
      const haystack = [
        row.campaignName,
        row.videoTitle,
        row.influencer?.name,
        row.influencer?.username,
      ].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(campaign)) return false
    }
    return true
  })
}

function sortValue(row: InfluencerContractListRow, key: InfluencerContractSortKey): string | number {
  switch (key) {
    case 'influencer':
      return (row.influencer?.name || '').toLowerCase()
    case 'period':
      return row.contractStartDate || row.latestDate || ''
    case 'campaign':
      return row.campaignName.toLowerCase()
    case 'status':
      return row.statusLabel
    case 'cost':
      return row.cost
    case 'sales':
      return row.salesAed
    case 'netProfit':
      return row.netProfitAed
    case 'roi':
      return row.roi
    case 'checkins':
      return row.recordedDays / Math.max(row.monitoringDays, 1)
    case 'payment':
      return row.effectivePaymentStatus
    default:
      return row.contractStartDate
  }
}

export function sortContractListRows(
  rows: InfluencerContractListRow[],
  sortKey: InfluencerContractSortKey,
  sortDirection: 'asc' | 'desc',
): InfluencerContractListRow[] {
  const dir = sortDirection === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const av = sortValue(a, sortKey)
    const bv = sortValue(b, sortKey)
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir
    return String(av).localeCompare(String(bv)) * dir
  })
}

export function paginateContractListRows<T>(
  rows: T[],
  page: number,
  pageSize = CONTRACTS_PAGE_SIZE,
): { rows: T[]; totalPages: number; total: number } {
  const total = rows.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const safePage = Math.min(Math.max(1, page), totalPages)
  const start = (safePage - 1) * pageSize
  return {
    rows: rows.slice(start, start + pageSize),
    totalPages,
    total,
  }
}

export function readContractsFiltersFromSearchParams(params: URLSearchParams): InfluencerContractsFilters {
  const defaults = defaultContractsFilters()
  const period = params.get('period') as InfluencerDashboardDatePreset | null
  const status = params.get('status') as InfluencerContractStatusFilter | null
  const checkin = params.get('checkin') as InfluencerContractCheckInFilter | null
  const profit = params.get('profit') as InfluencerPaymentsProfitFilter | null
  const sort = params.get('sort') as InfluencerContractSortKey | null
  const dir = params.get('dir')
  const page = Number(params.get('page') || '1')

  return {
    ...defaults,
    datePreset: period && ['this_month', 'last_month', 'last_30_days', 'last_90_days', 'this_quarter', 'this_year', 'custom', 'all_time'].includes(period)
      ? period
      : defaults.datePreset,
    customFrom: params.get('from') || '',
    customTo: params.get('to') || '',
    influencerId: params.get('influencer') || 'all',
    contractStatus: status && ['all', 'active', 'upcoming', 'completed', 'pending'].includes(status)
      ? status
      : defaults.contractStatus,
    campaignQuery: params.get('campaign') || '',
    paymentStatus: (params.get('payment') as InfluencerContractPaymentFilterStatus | 'All' | null) || 'All',
    checkInStatus: checkin && ['all', 'complete', 'in_progress', 'not_started'].includes(checkin)
      ? checkin
      : defaults.checkInStatus,
    profitFilter: profit && ['all', 'profitable', 'loss_making'].includes(profit) ? profit : defaults.profitFilter,
    needsAttentionOnly: params.get('attention') === '1',
    sortKey: sort && ['influencer', 'period', 'campaign', 'status', 'cost', 'sales', 'netProfit', 'roi', 'checkins', 'payment'].includes(sort)
      ? sort
      : defaults.sortKey,
    sortDirection: dir === 'asc' ? 'asc' : 'desc',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  }
}

export function contractsFiltersToSearchParams(filters: InfluencerContractsFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.datePreset !== 'all_time') params.set('period', filters.datePreset)
  if (filters.customFrom) params.set('from', filters.customFrom)
  if (filters.customTo) params.set('to', filters.customTo)
  if (filters.influencerId !== 'all') params.set('influencer', filters.influencerId)
  if (filters.contractStatus !== 'all') params.set('status', filters.contractStatus)
  if (filters.campaignQuery) params.set('campaign', filters.campaignQuery)
  if (filters.paymentStatus !== 'All') params.set('payment', filters.paymentStatus)
  if (filters.checkInStatus !== 'all') params.set('checkin', filters.checkInStatus)
  if (filters.profitFilter !== 'all') params.set('profit', filters.profitFilter)
  if (filters.needsAttentionOnly) params.set('attention', '1')
  if (filters.sortKey !== 'period') params.set('sort', filters.sortKey)
  if (filters.sortDirection !== 'desc') params.set('dir', filters.sortDirection)
  if (filters.page > 1) params.set('page', String(filters.page))
  return params
}

export function resolveContractsDateRange(filters: Pick<InfluencerContractsFilters, 'datePreset' | 'customFrom' | 'customTo'>) {
  return resolveDashboardDateRange(filters.datePreset, filters.customFrom, filters.customTo)
}

export function addContractUrl(influencerId?: string): string {
  const base = '/influencers/performance?add=1'
  if (!influencerId || influencerId === 'all') return base
  return `${base}&influencer=${encodeURIComponent(influencerId)}`
}

export function reconcileContractListRow(
  row: InfluencerContractListRow,
  dashboardRow: DashboardContractMetrics,
  paymentRow: InfluencerContractPaymentRow | null,
): boolean {
  const paymentOk = paymentRow
    ? row.cost === paymentRow.contractCost
      && row.salesAed === paymentRow.salesAed
      && row.netProfitAed === paymentRow.netProfitAed
      && row.roi === paymentRow.roi
    : true
  return (
    row.cost === dashboardRow.cost
    && row.salesAed === dashboardRow.salesAed
    && row.netProfitAed === dashboardRow.netProfitAed
    && row.roi === dashboardRow.roi
    && row.recordedDays === dashboardRow.recordedDays
    && row.monitoringDays === dashboardRow.monitoringDays
    && paymentOk
  )
}
