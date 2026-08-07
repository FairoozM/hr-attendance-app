import {
  addDays,
  contractEndDateFromStartAndDays,
  createInfluencerFromAppRecord,
  getVideoContractTimelines,
  isoDateSlice,
  toNumber,
} from '../../utils/influencerPerformanceUtils'
import type { Influencer } from '../../lib/influencers'
import type {
  InfluencerContract,
  InfluencerPerformance,
  InfluencerPerformanceInput,
  InfluencerPerformanceProfile,
} from '../../types/influencer'

export type InfluencerDashboardDatePreset =
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'this_year'
  | 'custom'
  | 'all_time'

export type InfluencerDashboardGroupMode = 'influencer' | 'contract'

export type InfluencerDashboardDateRange = {
  from: string
  to: string
} | null

export type DashboardContractMetrics = {
  contractId: string
  influencerId: string
  influencer?: InfluencerPerformanceProfile
  campaignName: string
  videoTitle: string
  contractStartDate: string
  contractEndDate: string
  latestDate: string
  cost: number
  salesAed: number
  netProfitAed: number
  roi: number
  profitMargin: number
  recordedDays: number
  monitoringDays: number
  isActive: boolean
  isCompleted: boolean
  contract: InfluencerContract
}

export type DashboardInfluencerMetrics = {
  influencerId: string
  influencer?: InfluencerPerformanceProfile
  contractCount: number
  cost: number
  salesAed: number
  netProfitAed: number
  roi: number
  profitMargin: number
}

export type DashboardUpcomingCheckIn = {
  contractId: string
  influencerId: string
  influencer?: InfluencerPerformanceProfile
  campaignName: string
  checkDate: string
  dayNumber: number
  contract: InfluencerContract
}

export type DashboardRecentActivityItem = {
  id: string
  kind: 'check_in' | 'timeline'
  date: string
  title: string
  subtitle: string
  influencerId: string
  contractId?: string
  influencer?: InfluencerPerformanceProfile
}

export type InfluencerDashboardSnapshot = {
  totalInfluencers: number
  activeContracts: number
  completedContracts: number
  totalCost: number
  totalSales: number
  totalNetProfit: number
  overallRoi: number
  profitMargin: number
  contracts: DashboardContractMetrics[]
  influencers: DashboardInfluencerMetrics[]
  topByNetProfit: Array<DashboardContractMetrics | DashboardInfluencerMetrics>
  topBySales: Array<DashboardContractMetrics | DashboardInfluencerMetrics>
  topByRoi: Array<DashboardContractMetrics | DashboardInfluencerMetrics>
  activeContractRows: DashboardContractMetrics[]
  upcomingCheckIns: DashboardUpcomingCheckIn[]
  contractsEndingSoon: DashboardContractMetrics[]
  lossMaking: DashboardContractMetrics[]
  recentActivity: DashboardRecentActivityItem[]
}

function utcTodayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function startOfMonthIso(year: number, monthIndex: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`
}

function endOfMonthIso(year: number, monthIndex: number): string {
  const dt = new Date(Date.UTC(year, monthIndex + 1, 0))
  return dt.toISOString().slice(0, 10)
}

function quarterBounds(reference: Date): { from: string; to: string } {
  const month = reference.getUTCMonth()
  const year = reference.getUTCFullYear()
  const qStartMonth = Math.floor(month / 3) * 3
  const from = startOfMonthIso(year, qStartMonth)
  const to = endOfMonthIso(year, qStartMonth + 2)
  return { from, to }
}

export function resolveDashboardDateRange(
  preset: InfluencerDashboardDatePreset,
  customFrom = '',
  customTo = '',
): InfluencerDashboardDateRange {
  if (preset === 'all_time') return null

  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth()

  if (preset === 'this_month') {
    return { from: startOfMonthIso(year, month), to: endOfMonthIso(year, month) }
  }
  if (preset === 'last_month') {
    const prev = new Date(Date.UTC(year, month - 1, 1))
    return {
      from: startOfMonthIso(prev.getUTCFullYear(), prev.getUTCMonth()),
      to: endOfMonthIso(prev.getUTCFullYear(), prev.getUTCMonth()),
    }
  }
  if (preset === 'this_quarter') {
    return quarterBounds(now)
  }
  if (preset === 'this_year') {
    return { from: `${year}-01-01`, to: `${year}-12-31` }
  }

  const from = isoDateSlice(customFrom)
  const to = isoDateSlice(customTo)
  if (!from && !to) return null
  if (from && to) return from <= to ? { from, to } : { from: to, to: from }
  if (from) return { from, to: from }
  return { from: to, to: to }
}

export function safeRatioPercent(numerator: number, denominator: number): number {
  const n = toNumber(numerator)
  const d = toNumber(denominator)
  if (!Number.isFinite(n) || !Number.isFinite(d) || d <= 0) return 0
  const pct = (n / d) * 100
  return Number.isFinite(pct) ? Number(pct.toFixed(1)) : 0
}

export function getContractDateSpan(contract: InfluencerContract): { start: string; end: string } | null {
  const start = isoDateSlice(contract.contractStartDate)
  const end = isoDateSlice(
    contract.contractEndDate
    || contractEndDateFromStartAndDays(contract.contractStartDate, contract.monitoringDays)
    || contract.latest?.date
    || contract.latestDate,
  )
  if (!start && !end) return null
  const s = start || end
  const e = end || start
  return s <= e ? { start: s, end: e } : { start: e, end: s }
}

export function contractOverlapsDateRange(
  contract: InfluencerContract,
  range: InfluencerDashboardDateRange,
): boolean {
  if (!range) return true
  const span = getContractDateSpan(contract)
  if (!span) return false
  return span.start <= range.to && span.end >= range.from
}

function contractStatus(contract: InfluencerContract, today = utcTodayIso()) {
  const span = getContractDateSpan(contract)
  const end = span?.end || today
  const recordedDays = toNumber(contract.recordedDays)
  const monitoringDays = toNumber(contract.monitoringDays) || 5
  const isCompleted = recordedDays >= monitoringDays || (end && end < today)
  const isActive = !isCompleted && Boolean(span) && span.start <= today && end >= today
  return { isActive, isCompleted }
}

function toContractMetrics(contract: InfluencerContract, today = utcTodayIso()): DashboardContractMetrics {
  const cost = toNumber(contract.totals?.cost)
  const salesAed = toNumber(contract.totals?.salesAed)
  const netProfitAed = toNumber(contract.totals?.netProfitAed)
  const { isActive, isCompleted } = contractStatus(contract, today)
  const span = getContractDateSpan(contract)
  return {
    contractId: contract.id,
    influencerId: contract.influencerId,
    influencer: contract.influencer,
    campaignName: contract.campaignName || contract.videoTitle || 'Campaign',
    videoTitle: contract.videoTitle || contract.campaignName || 'Contracted video',
    contractStartDate: span?.start || contract.contractStartDate,
    contractEndDate: span?.end || contract.contractEndDate || '',
    latestDate: isoDateSlice(contract.latest?.date || contract.latestDate),
    cost,
    salesAed,
    netProfitAed,
    roi: safeRatioPercent(netProfitAed, cost),
    profitMargin: safeRatioPercent(netProfitAed, salesAed),
    recordedDays: toNumber(contract.recordedDays),
    monitoringDays: toNumber(contract.monitoringDays) || 5,
    isActive,
    isCompleted,
    contract,
  }
}

function aggregateInfluencerMetrics(rows: DashboardContractMetrics[]): DashboardInfluencerMetrics[] {
  const byId = new Map<string, DashboardInfluencerMetrics>()
  rows.forEach((row) => {
    const id = String(row.influencerId)
    const current = byId.get(id) || {
      influencerId: id,
      influencer: row.influencer,
      contractCount: 0,
      cost: 0,
      salesAed: 0,
      netProfitAed: 0,
      roi: 0,
      profitMargin: 0,
    }
    current.contractCount += 1
    current.cost += row.cost
    current.salesAed += row.salesAed
    current.netProfitAed += row.netProfitAed
    if (!current.influencer && row.influencer) current.influencer = row.influencer
    byId.set(id, current)
  })
  return Array.from(byId.values()).map((row) => ({
    ...row,
    roi: safeRatioPercent(row.netProfitAed, row.cost),
    profitMargin: safeRatioPercent(row.netProfitAed, row.salesAed),
  }))
}

function topN<T>(rows: T[], pick: (row: T) => number, limit = 5): T[] {
  return [...rows].sort((a, b) => pick(b) - pick(a)).slice(0, limit)
}

function buildUpcomingCheckIns(contracts: DashboardContractMetrics[], today = utcTodayIso()): DashboardUpcomingCheckIn[] {
  const out: DashboardUpcomingCheckIn[] = []
  contracts.forEach((row) => {
    if (!row.isActive) return
    const contract = row.contract
    contract.days.forEach((day) => {
      if (!day.inContractWindow || day.isRecorded) return
      if (!day.date || day.date < today) return
      out.push({
        contractId: row.contractId,
        influencerId: row.influencerId,
        influencer: row.influencer,
        campaignName: row.campaignName,
        checkDate: day.date,
        dayNumber: day.dayNumber,
        contract,
      })
    })
  })
  return out.sort((a, b) => a.checkDate.localeCompare(b.checkDate)).slice(0, 8)
}

function buildRecentActivity(
  contracts: DashboardContractMetrics[],
  roster: Influencer[],
  profiles: InfluencerPerformanceProfile[],
  range: InfluencerDashboardDateRange,
): DashboardRecentActivityItem[] {
  const profileById = new Map(profiles.map((p) => [String(p.id), p]))
  const items: DashboardRecentActivityItem[] = []

  contracts.forEach((row) => {
    row.contract.records.forEach((rec: InfluencerPerformance) => {
      const date = isoDateSlice(rec.date)
      if (range && date && (date < range.from || date > range.to)) return
      items.push({
        id: `check-${rec.id}`,
        kind: 'check_in',
        date,
        title: `Check-in · ${row.campaignName}`,
        subtitle: `${row.influencer?.name || 'Influencer'} · Day ${rec.date}`,
        influencerId: row.influencerId,
        contractId: row.contractId,
        influencer: row.influencer,
      })
    })
  })

  roster.forEach((inf) => {
    const timeline = Array.isArray(inf.timeline) ? inf.timeline : []
    timeline.forEach((entry, index) => {
      const date = isoDateSlice(entry.date)
      if (range && date && (date < range.from || date > range.to)) return
      items.push({
        id: `timeline-${inf.id}-${index}`,
        kind: 'timeline',
        date,
        title: entry.event || 'Timeline update',
        subtitle: inf.name,
        influencerId: String(inf.id),
        influencer: profileById.get(String(inf.id)),
      })
    })
  })

  return items
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 12)
}

export function buildInfluencerDashboardSnapshot({
  records,
  roster,
  range,
  groupMode,
  today = utcTodayIso(),
}: {
  records: InfluencerPerformanceInput[]
  roster: Influencer[]
  range: InfluencerDashboardDateRange
  groupMode: InfluencerDashboardGroupMode
  today?: string
}): InfluencerDashboardSnapshot {
  const profiles = roster.map((row, index) => createInfluencerFromAppRecord(row, index))
  const allContracts = getVideoContractTimelines(records, profiles)
  const filteredContracts = allContracts
    .filter((contract) => contractOverlapsDateRange(contract, range))
    .map((contract) => toContractMetrics(contract, today))

  const influencerRows = aggregateInfluencerMetrics(filteredContracts)
  const influencerIdsInRange = new Set(filteredContracts.map((row) => String(row.influencerId)))

  const totalCost = filteredContracts.reduce((sum, row) => sum + row.cost, 0)
  const totalSales = filteredContracts.reduce((sum, row) => sum + row.salesAed, 0)
  const totalNetProfit = filteredContracts.reduce((sum, row) => sum + row.netProfitAed, 0)

  const rankingSource = groupMode === 'influencer' ? influencerRows : filteredContracts
  const pickNetProfit = (row: DashboardContractMetrics | DashboardInfluencerMetrics) => toNumber(row.netProfitAed)
  const pickSales = (row: DashboardContractMetrics | DashboardInfluencerMetrics) => toNumber(row.salesAed)
  const pickRoi = (row: DashboardContractMetrics | DashboardInfluencerMetrics) => toNumber(row.roi)

  const endingSoonCutoff = addDays(today, 7)

  return {
    totalInfluencers: range ? influencerIdsInRange.size : roster.length,
    activeContracts: filteredContracts.filter((row) => row.isActive).length,
    completedContracts: filteredContracts.filter((row) => row.isCompleted).length,
    totalCost,
    totalSales,
    totalNetProfit,
    overallRoi: safeRatioPercent(totalNetProfit, totalCost),
    profitMargin: safeRatioPercent(totalNetProfit, totalSales),
    contracts: filteredContracts,
    influencers: influencerRows,
    topByNetProfit: topN(rankingSource, pickNetProfit),
    topBySales: topN(rankingSource, pickSales),
    topByRoi: topN(rankingSource, pickRoi),
    activeContractRows: filteredContracts
      .filter((row) => row.isActive)
      .sort((a, b) => a.contractEndDate.localeCompare(b.contractEndDate)),
    upcomingCheckIns: buildUpcomingCheckIns(filteredContracts, today),
    contractsEndingSoon: filteredContracts
      .filter((row) => row.isActive && row.contractEndDate >= today && row.contractEndDate <= endingSoonCutoff)
      .sort((a, b) => a.contractEndDate.localeCompare(b.contractEndDate)),
    lossMaking: filteredContracts
      .filter((row) => row.netProfitAed < 0)
      .sort((a, b) => a.netProfitAed - b.netProfitAed),
    recentActivity: buildRecentActivity(filteredContracts, roster, profiles, range),
  }
}

export function performanceContractUrl(contractId: string): string {
  return `/influencers/performance?contract=${encodeURIComponent(contractId)}`
}

export function influencerProfileUrl(influencerId: string): string {
  return `/influencers/${encodeURIComponent(influencerId)}`
}
