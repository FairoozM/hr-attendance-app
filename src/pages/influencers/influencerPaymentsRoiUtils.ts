import type {
  InfluencerContractPayment,
  InfluencerContractPaymentDisplayStatus,
  InfluencerContractPaymentFilterStatus,
  InfluencerContractPaymentStatus,
} from '../../types/influencer'
import {
  contractOverlapsDateRange,
  resolveDashboardDateRange,
  safeRatioPercent,
  type InfluencerDashboardDatePreset,
  type InfluencerDashboardDateRange,
} from './influencerDashboardUtils'
import {
  createInfluencerFromAppRecord,
  getVideoContractTimelines,
  toNumber,
} from '../../utils/influencerPerformanceUtils'
import type { Influencer } from '../../lib/influencers'
import type { InfluencerPerformanceInput } from '../../types/influencer'

export type InfluencerPaymentsRoiDatePreset = InfluencerDashboardDatePreset

export type InfluencerPaymentsProfitFilter = 'all' | 'profitable' | 'loss_making'

export type InfluencerContractPaymentRow = {
  contractId: string
  influencerId: string
  influencerName: string
  influencerHandle: string
  influencerImage: string
  contractLabel: string
  contractStartDate: string
  contractEndDate: string
  contractCost: number
  amountPaid: number
  /** Finance liability (cost − paid). Zero for Untracked rows — see summarizePaymentsRoi. */
  amountOutstanding: number
  /** Display status: Untracked when no persisted payment row. */
  paymentStatus: InfluencerContractPaymentDisplayStatus
  /** Display status including derived Overdue; Untracked when not persisted. */
  effectiveStatus: InfluencerContractPaymentDisplayStatus
  /** Stored DB status; null when Untracked. */
  storedPaymentStatus: InfluencerContractPaymentStatus | null
  dueDate: string | null
  paymentDate: string | null
  invoiceReference: string
  salesAed: number
  netProfitAed: number
  roi: number
  hasPersistedPayment: boolean
  notes: string
}

export type InfluencerPaymentsRoiSummary = {
  totalContractedCost: number
  totalPaid: number
  outstandingPayments: number
  totalSales: number
  totalNetProfit: number
  overallRoi: number
  lossMakingSpend: number
}

export type InfluencerPaymentsRoiFilters = {
  datePreset: InfluencerPaymentsRoiDatePreset
  customFrom: string
  customTo: string
  influencerId: string
  paymentStatus: InfluencerContractPaymentFilterStatus | 'All'
  profitFilter: InfluencerPaymentsProfitFilter
  outstandingOnly: boolean
}

/**
 * Outstanding Payments summary includes ONLY persisted payment rows.
 * Untracked contracts (no influencer_contract_payments row) are excluded —
 * finance has not recorded a liability even if contract cost exists on performance.
 */
export const OUTSTANDING_SUMMARY_INCLUDES_UNTRACKED = false as const

export function resolvePaymentsDateRange(
  preset: InfluencerPaymentsRoiDatePreset,
  customFrom = '',
  customTo = '',
): InfluencerDashboardDateRange {
  return resolveDashboardDateRange(preset, customFrom, customTo)
}

export function computeOutstanding(contractCost: number, amountPaid: number): number {
  const cost = toNumber(contractCost)
  const paid = toNumber(amountPaid)
  const outstanding = cost - paid
  if (!Number.isFinite(outstanding) || outstanding <= 0) return 0
  return Number(outstanding.toFixed(2))
}

export function computeEffectivePaymentStatus(
  storedStatus: InfluencerContractPaymentStatus,
  dueDate: string | null,
  outstanding: number,
  today = new Date().toISOString().slice(0, 10),
): InfluencerContractPaymentStatus {
  if (storedStatus === 'Paid' || storedStatus === 'Disputed') return storedStatus
  if (
    outstanding > 0
    && dueDate
    && dueDate < today
    && (storedStatus === 'Pending' || storedStatus === 'Partially Paid' || storedStatus === 'Not Due')
  ) {
    return 'Overdue'
  }
  return storedStatus
}

export function resolveDisplayPaymentStatus(
  hasPersistedPayment: boolean,
  storedStatus: InfluencerContractPaymentStatus,
): InfluencerContractPaymentDisplayStatus {
  if (!hasPersistedPayment) return 'Untracked'
  return storedStatus
}

export function resolveEffectivePaymentStatus(
  hasPersistedPayment: boolean,
  storedStatus: InfluencerContractPaymentStatus,
  dueDate: string | null,
  outstanding: number,
  today = new Date().toISOString().slice(0, 10),
): InfluencerContractPaymentDisplayStatus {
  if (!hasPersistedPayment) return 'Untracked'
  return computeEffectivePaymentStatus(storedStatus, dueDate, outstanding, today)
}

function defaultPayment(contractId: string, influencerId: string): InfluencerContractPayment {
  return {
    contractId,
    influencerId,
    amountPaid: 0,
    paymentStatus: 'Not Due',
    dueDate: null,
    paymentDate: null,
    invoiceReference: '',
    notes: '',
  }
}

function coercePaymentStatus(value: string | undefined): InfluencerContractPaymentStatus {
  const status = String(value || 'Not Due')
  if (status === 'Pending' || status === 'Partially Paid' || status === 'Paid' || status === 'Overdue' || status === 'Disputed' || status === 'Not Due') {
    return status
  }
  return 'Not Due'
}

export function buildInfluencerPaymentRows({
  records,
  roster,
  payments,
  range,
  today = new Date().toISOString().slice(0, 10),
}: {
  records: InfluencerPerformanceInput[]
  roster: Influencer[]
  payments: InfluencerContractPayment[]
  range: InfluencerDashboardDateRange
  today?: string
}): InfluencerContractPaymentRow[] {
  const profiles = roster.map((row, index) => createInfluencerFromAppRecord(row, index))
  const paymentByContract = new Map(payments.map((row) => [String(row.contractId), row]))
  const contracts = getVideoContractTimelines(records, profiles)
    .filter((contract) => contractOverlapsDateRange(contract, range))

  return contracts.map((contract) => {
    const contractId = String(contract.id)
    const influencerId = String(contract.influencerId)
    const persisted = paymentByContract.get(contractId)
    const payment = persisted || defaultPayment(contractId, influencerId)
    const hasPersistedPayment = Boolean(persisted)
    const storedStatus = hasPersistedPayment ? coercePaymentStatus(payment.paymentStatus) : null
    const contractCost = toNumber(contract.totals?.cost)
    const amountPaid = toNumber(payment.amountPaid)
    const amountOutstanding = hasPersistedPayment
      ? computeOutstanding(contractCost, amountPaid)
      : 0
    const effectiveStatus = resolveEffectivePaymentStatus(
      hasPersistedPayment,
      storedStatus || 'Not Due',
      payment.dueDate,
      amountOutstanding,
      today,
    )
    const displayStatus = resolveDisplayPaymentStatus(hasPersistedPayment, storedStatus || 'Not Due')
    const salesAed = toNumber(contract.totals?.salesAed)
    const netProfitAed = toNumber(contract.totals?.netProfitAed)

    return {
      contractId,
      influencerId,
      influencerName: contract.influencer?.name || 'Influencer',
      influencerHandle: contract.influencer?.username || '',
      influencerImage: contract.influencer?.profileImage || '',
      contractLabel: contract.campaignName || contract.videoTitle || 'Campaign',
      contractStartDate: contract.contractStartDate || '',
      contractEndDate: contract.contractEndDate || '',
      contractCost,
      amountPaid,
      amountOutstanding,
      paymentStatus: displayStatus,
      effectiveStatus,
      storedPaymentStatus: storedStatus,
      dueDate: payment.dueDate,
      paymentDate: payment.paymentDate,
      invoiceReference: payment.invoiceReference || '',
      salesAed,
      netProfitAed,
      roi: safeRatioPercent(netProfitAed, contractCost),
      hasPersistedPayment,
      notes: payment.notes || '',
    }
  })
}

export function summarizePaymentsRoi(rows: InfluencerContractPaymentRow[]): InfluencerPaymentsRoiSummary {
  const totalContractedCost = rows.reduce((sum, row) => sum + row.contractCost, 0)
  const totalPaid = rows.reduce((sum, row) => sum + row.amountPaid, 0)
  const outstandingPayments = rows.reduce(
    (sum, row) => (row.hasPersistedPayment ? sum + row.amountOutstanding : sum),
    0,
  )
  const totalSales = rows.reduce((sum, row) => sum + row.salesAed, 0)
  const totalNetProfit = rows.reduce((sum, row) => sum + row.netProfitAed, 0)
  const lossMakingSpend = rows
    .filter((row) => row.netProfitAed < 0)
    .reduce((sum, row) => sum + row.contractCost, 0)

  return {
    totalContractedCost,
    totalPaid,
    outstandingPayments,
    totalSales,
    totalNetProfit,
    overallRoi: safeRatioPercent(totalNetProfit, totalContractedCost),
    lossMakingSpend,
  }
}

export function filterPaymentRows(
  rows: InfluencerContractPaymentRow[],
  filters: Pick<
    InfluencerPaymentsRoiFilters,
    'influencerId' | 'paymentStatus' | 'profitFilter' | 'outstandingOnly'
  > & { contractId?: string },
): InfluencerContractPaymentRow[] {
  return rows.filter((row) => {
    if (filters.contractId && filters.contractId !== 'All' && row.contractId !== filters.contractId) return false
    if (filters.influencerId !== 'All' && row.influencerId !== filters.influencerId) return false
    if (filters.paymentStatus !== 'All') {
      if (filters.paymentStatus === 'Untracked') {
        if (row.hasPersistedPayment) return false
      } else if (!row.hasPersistedPayment || row.effectiveStatus !== filters.paymentStatus) {
        return false
      }
    }
    if (filters.outstandingOnly) {
      if (!row.hasPersistedPayment || row.amountOutstanding <= 0) return false
    }
    if (filters.profitFilter === 'profitable' && row.netProfitAed <= 0) return false
    if (filters.profitFilter === 'loss_making' && row.netProfitAed >= 0) return false
    return true
  })
}

export function influencerProfileUrl(influencerId: string): string {
  return `/influencers/${encodeURIComponent(influencerId)}`
}

export function performanceContractUrl(contractId: string): string {
  return `/influencers/performance?contract=${encodeURIComponent(contractId)}`
}

export function readPaymentsInfluencerFilter(params: URLSearchParams): string {
  return params.get('influencer') || 'All'
}

/** Preserve unrelated query params (e.g. contract=). */
export function writePaymentsInfluencerFilter(
  params: URLSearchParams,
  influencerId: string,
): URLSearchParams {
  const next = new URLSearchParams(params)
  if (!influencerId || influencerId === 'All') next.delete('influencer')
  else next.set('influencer', influencerId)
  return next
}
