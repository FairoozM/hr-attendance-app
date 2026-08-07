/**
 * Consolidated influencer profile — aggregates roster, performance, and payments.
 * All financial totals reuse Dashboard / Analytics definitions (latest check-in per contract).
 */
import type { Influencer } from '../../lib/influencers'
import type {
  InfluencerContractPayment,
  InfluencerPerformanceInput,
} from '../../types/influencer'
import {
  buildInfluencerDashboardSnapshot,
  type DashboardContractMetrics,
  type InfluencerDashboardDateRange,
} from './influencerDashboardUtils'
import {
  buildInfluencerAnalyticsSnapshot,
  defaultAnalyticsFilters,
  type InfluencerAnalyticsPoint,
  type InfluencerAnalyticsSummary,
} from './influencerAnalyticsUtils'
import {
  buildInfluencerPaymentRows,
  performanceContractUrl,
  summarizePaymentsRoi,
  type InfluencerContractPaymentRow,
} from './influencerPaymentsRoiUtils'
import { calculateEngagementRate, toNumber } from '../../utils/influencerPerformanceUtils'
import { addContractUrl } from './influencerPerformanceScreenShared'

export type InfluencerProfileTab =
  | 'overview'
  | 'contracts'
  | 'performance'
  | 'notes'

export type InfluencerProfileAttentionItem = {
  id: string
  label: string
  detail: string
  tone: 'info' | 'warning' | 'danger'
  href: string
}

export type InfluencerProfileFinanceSnapshot = {
  totalContracted: number
  trackedPaid: number
  trackedOutstanding: number
  untrackedContractCount: number
  overdueTrackedCount: number
}

export type InfluencerProfileSnapshot = {
  influencerId: string
  influencer: Influencer
  summary: InfluencerAnalyticsSummary
  contracts: DashboardContractMetrics[]
  activeContracts: DashboardContractMetrics[]
  paymentRows: InfluencerContractPaymentRow[]
  finance: InfluencerProfileFinanceSnapshot
  needsAttention: InfluencerProfileAttentionItem[]
  performancePoints: InfluencerAnalyticsPoint[]
  notesFields: Array<{ key: string; label: string; value: string }>
}

const INFLUENCER_QUERY_KEY = 'influencer'

export function influencerQueryParam(influencerId: string): string {
  return `${INFLUENCER_QUERY_KEY}=${encodeURIComponent(influencerId)}`
}

export function moduleDeepLinks(influencerId: string) {
  const q = influencerQueryParam(influencerId)
  return {
    profile: `/influencers/${encodeURIComponent(influencerId)}`,
    edit: `/influencers/${encodeURIComponent(influencerId)}/edit`,
    addContract: addContractUrl(influencerId),
    performance: `/influencers/performance?${q}`,
  }
}

/** Resolve roster influencer by stable id only — never by display name. */
export function resolveInfluencerById(
  roster: Influencer[],
  influencerId: string,
): Influencer | null {
  const id = String(influencerId || '').trim()
  if (!id) return null
  return roster.find((row) => String(row.id) === id) || null
}

export function filterRecordsForInfluencer(
  records: InfluencerPerformanceInput[],
  influencerId: string,
): InfluencerPerformanceInput[] {
  const id = String(influencerId)
  return records.filter((row) => String(row.influencerId) === id)
}

function engagementTotal(contract: DashboardContractMetrics): number {
  const t = contract.contract.totals
  return toNumber(t?.likes) + toNumber(t?.comments) + toNumber(t?.shares)
}

function buildFinanceSnapshot(paymentRows: InfluencerContractPaymentRow[]): InfluencerProfileFinanceSnapshot {
  const paymentSummary = summarizePaymentsRoi(paymentRows)
  const untrackedContractCount = paymentRows.filter((row) => !row.hasPersistedPayment).length
  const overdueTrackedCount = paymentRows.filter(
    (row) => row.hasPersistedPayment && row.effectiveStatus === 'Overdue',
  ).length
  return {
    totalContracted: paymentSummary.totalContractedCost,
    trackedPaid: paymentSummary.totalPaid,
    trackedOutstanding: paymentSummary.outstandingPayments,
    untrackedContractCount,
    overdueTrackedCount,
  }
}

function buildNotesFields(influencer: Influencer): Array<{ key: string; label: string; value: string }> {
  const entries: Array<{ key: string; label: string; value: string | undefined }> = [
    { key: 'notes', label: 'Notes / Intelligence', value: influencer.notes },
    { key: 'discussionNotes', label: 'Discussion Notes', value: influencer.discussionNotes },
    { key: 'negotiationNotes', label: 'Negotiation Notes', value: influencer.negotiationNotes },
    { key: 'approvalNotes', label: 'Approval Notes', value: influencer.approvalNotes },
    { key: 'rejectionNotes', label: 'Rejection Notes', value: influencer.rejectionNotes },
    { key: 'paymentNotes', label: 'Finance Notes', value: influencer.paymentNotes },
    { key: 'audienceNotes', label: 'Audience Notes', value: influencer.audienceNotes },
  ]
  return entries
    .map((row) => ({ ...row, value: String(row.value || '').trim() }))
    .filter((row) => row.value.length > 0)
}

export function buildProfileNeedsAttention({
  contracts,
  paymentRows,
  today = new Date().toISOString().slice(0, 10),
}: {
  contracts: DashboardContractMetrics[]
  paymentRows: InfluencerContractPaymentRow[]
  today?: string
}): InfluencerProfileAttentionItem[] {
  const items: InfluencerProfileAttentionItem[] = []
  const endingSoonCutoff = addDaysIso(today, 7)

  paymentRows.forEach((row) => {
    if (row.hasPersistedPayment && row.effectiveStatus === 'Overdue') {
      items.push({
        id: `pay-overdue-${row.contractId}`,
        label: 'Overdue tracked payment',
        detail: `${row.contractLabel} · ${row.amountOutstanding.toLocaleString()} AED outstanding`,
        tone: 'danger',
        href: performanceContractUrl(row.contractId),
      })
    }
    if (!row.hasPersistedPayment && row.contractCost > 0) {
      items.push({
        id: `pay-untracked-${row.contractId}`,
        label: 'Missing finance tracking',
        detail: `${row.contractLabel} has no payment record (Untracked)`,
        tone: 'warning',
        href: moduleDeepLinks(row.influencerId).performance,
      })
    }
  })

  contracts.forEach((row) => {
    if (row.isActive && row.netProfitAed < 0) {
      items.push({
        id: `loss-${row.contractId}`,
        label: 'Loss-making active contract',
        detail: `${row.campaignName} · net profit ${row.netProfitAed.toLocaleString()} AED`,
        tone: 'danger',
        href: performanceContractUrl(row.contractId),
      })
    }
    if (row.isActive && row.contractEndDate >= today && row.contractEndDate <= endingSoonCutoff) {
      items.push({
        id: `ending-${row.contractId}`,
        label: 'Contract ending soon',
        detail: `${row.campaignName} ends ${row.contractEndDate}`,
        tone: 'warning',
        href: performanceContractUrl(row.contractId),
      })
    }
    if (row.isActive && row.recordedDays < row.monitoringDays) {
      const nextDay = row.contract.days.find((day) => day.inContractWindow && !day.isRecorded && day.date >= today)
      if (nextDay) {
        items.push({
          id: `checkin-${row.contractId}-${nextDay.date}`,
          label: 'Upcoming check-in',
          detail: `${row.campaignName} · Day ${nextDay.dayNumber} due ${nextDay.date}`,
          tone: 'info',
          href: performanceContractUrl(row.contractId),
        })
      }
    }
  })

  return items.slice(0, 12)
}

function addDaysIso(iso: string, days: number): string {
  const dt = new Date(`${iso}T00:00:00Z`)
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

export function buildInfluencerProfileSnapshot({
  influencerId,
  roster,
  records,
  payments,
  today = new Date().toISOString().slice(0, 10),
}: {
  influencerId: string
  roster: Influencer[]
  records: InfluencerPerformanceInput[]
  payments: InfluencerContractPayment[]
  today?: string
}): InfluencerProfileSnapshot | null {
  const influencer = resolveInfluencerById(roster, influencerId)
  if (!influencer) return null

  const influencerRecords = filterRecordsForInfluencer(records, influencerId)
  const range: InfluencerDashboardDateRange = null

  const dashboard = buildInfluencerDashboardSnapshot({
    records: influencerRecords,
    roster,
    range,
    groupMode: 'contract',
    today,
  })

  const analytics = buildInfluencerAnalyticsSnapshot({
    records: influencerRecords,
    roster,
    filters: {
      ...defaultAnalyticsFilters(),
      influencerId: String(influencerId),
      groupMode: 'contract',
    },
    today,
  })

  const paymentRows = buildInfluencerPaymentRows({
    records: influencerRecords,
    roster,
    payments,
    range,
    today,
  })

  const activeContracts = dashboard.contracts.filter((row) => row.isActive)

  return {
    influencerId: String(influencerId),
    influencer,
    summary: {
      ...analytics.summary,
      totalViews: dashboard.contracts.reduce((sum, row) => sum + toNumber(row.contract.totals?.views), 0),
      totalEngagement: dashboard.contracts.reduce((sum, row) => sum + engagementTotal(row), 0),
      contractsAnalysed: dashboard.contracts.length,
    },
    contracts: dashboard.contracts,
    activeContracts,
    paymentRows,
    finance: buildFinanceSnapshot(paymentRows),
    needsAttention: buildProfileNeedsAttention({ contracts: dashboard.contracts, paymentRows, today }),
    performancePoints: analytics.points,
    notesFields: buildNotesFields(influencer),
  }
}

export function reconcileProfileWithAnalytics(
  profile: InfluencerProfileSnapshot,
  analyticsSummary: InfluencerAnalyticsSummary,
): boolean {
  return (
    profile.summary.totalCost === analyticsSummary.totalCost
    && profile.summary.totalSales === analyticsSummary.totalSales
    && profile.summary.totalNetProfit === analyticsSummary.totalNetProfit
    && profile.summary.overallRoi === analyticsSummary.overallRoi
  )
}

export function reconcileProfileWithPayments(
  profile: InfluencerProfileSnapshot,
): boolean {
  const paymentSummary = summarizePaymentsRoi(profile.paymentRows)
  return (
    profile.finance.totalContracted === paymentSummary.totalContractedCost
    && profile.finance.trackedPaid === paymentSummary.totalPaid
    && profile.finance.trackedOutstanding === paymentSummary.outstandingPayments
  )
}

export function profileEngagementRate(contracts: DashboardContractMetrics[]): number {
  const views = contracts.reduce((sum, row) => sum + toNumber(row.contract.totals?.views), 0)
  const likes = contracts.reduce((sum, row) => sum + toNumber(row.contract.totals?.likes), 0)
  const comments = contracts.reduce((sum, row) => sum + toNumber(row.contract.totals?.comments), 0)
  const shares = contracts.reduce((sum, row) => sum + toNumber(row.contract.totals?.shares), 0)
  return calculateEngagementRate({ views, likes, comments, shares })
}

/** Performance records always bind via influencerId; roster CRM uses stable id. */
export const PROFILE_IDENTITY_STRATEGY = {
  routeKey: 'influencerId',
  rosterMatch: 'String(row.id) === String(influencerId)',
  performanceMatch: 'String(record.influencerId) === String(influencerId)',
  paymentMatch: 'contract row influencerId + contractId from performance',
  noNameBasedMigration: true,
} as const
