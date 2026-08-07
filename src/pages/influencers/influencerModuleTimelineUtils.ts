import type {
  InfluencerContractPayment,
  InfluencerContractPaymentStatus,
  InfluencerModuleTimelineEvent,
  InfluencerModuleTimelineEventType,
  InfluencerModuleTimelineGroup,
  InfluencerModuleTimelineGroupMode,
  InfluencerModuleTimelineStatus,
  InfluencerModuleTimelineSummary,
  InfluencerPerformance,
} from '../../types/influencer'
import type { Influencer } from '../../lib/influencers'
import type { InfluencerContract } from '../../types/influencer'
import {
  contractEndDateFromStartAndDays,
  createInfluencerFromAppRecord,
  getVideoContractTimelines,
  isStoryPosting,
  isoDateSlice,
  storyPostingLabel,
  toNumber,
} from '../../utils/influencerPerformanceUtils'
import {
  computeEffectivePaymentStatus,
  computeOutstanding,
} from './influencerPaymentsRoiUtils'
import {
  contractOverlapsDateRange,
  resolveDashboardDateRange,
  type InfluencerDashboardDateRange,
} from './influencerDashboardUtils'
import type { InfluencerPerformanceInput } from '../../types/influencer'
import type { InfluencerModuleTimelineDatePreset } from '../../types/influencer'

export const TIMELINE_PAGE_SIZE = 50

const DUE_SOON_DAYS = 7
const COMPLETED_RECENT_DAYS = 14

function utcTodayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

function parseIsoDate(date: string): Date | null {
  const iso = isoDateSlice(date)
  if (!iso) return null
  const [year, month, day] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(year, month - 1, day))
  return Number.isNaN(dt.getTime()) ? null : dt
}

function daysBetween(fromIso: string, toIso: string): number {
  const from = parseIsoDate(fromIso)
  const to = parseIsoDate(toIso)
  if (!from || !to) return Number.POSITIVE_INFINITY
  return Math.round((to.getTime() - from.getTime()) / 86400000)
}

function contractEndDate(contract: InfluencerContract): string {
  return isoDateSlice(
    contract.contractEndDate
    || contractEndDateFromStartAndDays(contract.contractStartDate, contract.monitoringDays)
    || contract.latestDate,
  )
}

function contractCompletedDate(contract: InfluencerContract, endDate: string, today: string): string {
  const recorded = toNumber(contract.recordedDays)
  const monitoring = toNumber(contract.monitoringDays) || 5
  if (recorded >= monitoring && contract.latest?.date) {
    return isoDateSlice(contract.latest.date)
  }
  if (endDate && endDate < today) return endDate
  return ''
}

function baseEvent(
  partial: Omit<InfluencerModuleTimelineEvent, 'status'> & { status?: InfluencerModuleTimelineStatus },
  today: string,
): InfluencerModuleTimelineEvent {
  const date = isoDateSlice(partial.date)
  const status = partial.status || deriveEventStatus({
    type: partial.type,
    date,
    paymentStatus: partial.paymentStatus,
    storedPaymentStatus: partial.storedPaymentStatus,
    amountAed: partial.amountAed,
    contractCost: null,
    amountPaid: null,
    hasPersistedPayment: partial.hasPersistedPayment,
    today,
  })
  return {
    ...partial,
    date,
    status,
  }
}

export function deriveEventStatus({
  type,
  date,
  paymentStatus,
  storedPaymentStatus,
  amountAed,
  contractCost,
  amountPaid,
  hasPersistedPayment,
  today,
}: {
  type: InfluencerModuleTimelineEventType
  date: string
  paymentStatus: string | null
  storedPaymentStatus: string | null
  amountAed: number | null
  contractCost: number | null
  amountPaid: number | null
  hasPersistedPayment: boolean
  today: string
}): InfluencerModuleTimelineStatus {
  if (!date) return 'normal'

  if (type === 'payment_due') {
    if (paymentStatus === 'Overdue' || (storedPaymentStatus && storedPaymentStatus !== 'Paid' && date < today && (amountAed ?? 0) > 0)) {
      return 'overdue'
    }
    if (date >= today) {
      const days = daysBetween(today, date)
      return days <= DUE_SOON_DAYS ? 'upcoming' : 'upcoming'
    }
    return 'needs_attention'
  }

  if (type === 'payment_completed' || type === 'contract_completed') {
    const daysAgo = daysBetween(date, today)
    return daysAgo <= COMPLETED_RECENT_DAYS ? 'completed' : 'normal'
  }

  if (type === 'payment_updated') {
    if (storedPaymentStatus === 'Disputed') return 'needs_attention'
    if (paymentStatus === 'Overdue') return 'overdue'
    if (!hasPersistedPayment) return 'normal'
  }

  if (type === 'check_in' && storedPaymentStatus === 'Disputed') {
    return 'normal'
  }

  if (date > today) return 'upcoming'
  if (date === today) return 'upcoming'

  if (type === 'contract_start' || type === 'contract_end') {
    const daysAhead = daysBetween(today, date)
    if (daysAhead >= 0 && daysAhead <= DUE_SOON_DAYS) return 'upcoming'
  }

  return 'normal'
}

function profileFields(contract: InfluencerContract) {
  return {
    influencerId: String(contract.influencerId),
    influencerName: contract.influencer?.name || 'Influencer',
    influencerHandle: contract.influencer?.username || '',
    influencerImage: contract.influencer?.profileImage || '',
    contractId: String(contract.id),
    contractLabel: contract.campaignName || contract.videoTitle || 'Campaign',
  }
}

function influencerOnlyFields(inf: Influencer, profileImage: string) {
  return {
    influencerId: String(inf.id),
    influencerName: inf.name,
    influencerHandle: inf.instagram?.handle || '',
    influencerImage: profileImage,
    contractId: null,
    contractLabel: null,
  }
}

function checkInDescription(record: InfluencerPerformance, dayNumber: number): string {
  const parts = [
    `Day ${dayNumber} check-in`,
    `${formatNumberCompact(record.views)} views`,
    `${formatNumberCompact(record.likes)} likes`,
    `${formatNumberCompact(record.salesAed)} AED sales`,
  ]
  if (isStoryPosting(record.storyViews)) {
    parts.push(`Story posting: ${storyPostingLabel(record.storyViews)}`)
  }
  if (record.postUrl) parts.push('Post linked')
  if (record.notes?.trim()) parts.push(record.notes.trim())
  return parts.join(' · ')
}

function formatNumberCompact(value: unknown): string {
  return toNumber(value).toLocaleString()
}

function coercePaymentStatus(value: string | undefined): InfluencerContractPaymentStatus {
  const status = String(value || 'Not Due')
  if (status === 'Pending' || status === 'Partially Paid' || status === 'Paid' || status === 'Overdue' || status === 'Disputed' || status === 'Not Due') {
    return status
  }
  return 'Not Due'
}

function paymentFields(
  contract: InfluencerContract,
  payment: InfluencerContractPayment | undefined,
  today: string,
) {
  const contractCost = toNumber(contract.totals?.cost)
  const amountPaid = toNumber(payment?.amountPaid)
  const outstanding = computeOutstanding(contractCost, amountPaid)
  const storedStatus = coercePaymentStatus(payment?.paymentStatus)
  const effectiveStatus = computeEffectivePaymentStatus(
    storedStatus,
    payment?.dueDate || null,
    outstanding,
    today,
  )
  return {
    contractCost,
    amountPaid,
    outstanding,
    storedStatus,
    effectiveStatus,
    hasPersistedPayment: Boolean(payment),
    payment,
  }
}

export function buildInfluencerModuleTimelineEvents({
  records,
  roster,
  payments,
  today = utcTodayIso(),
}: {
  records: InfluencerPerformanceInput[]
  roster: Influencer[]
  payments: InfluencerContractPayment[]
  today?: string
}): InfluencerModuleTimelineEvent[] {
  const profiles = roster.map((row, index) => createInfluencerFromAppRecord(row, index))
  const profileById = new Map(profiles.map((profile) => [String(profile.id), profile]))
  const paymentByContract = new Map(payments.map((row) => [String(row.contractId), row]))
  const contracts = getVideoContractTimelines(records, profiles)
  const events: InfluencerModuleTimelineEvent[] = []
  const seen = new Set<string>()

  function push(event: InfluencerModuleTimelineEvent) {
    if (!event.date || seen.has(event.id)) return
    seen.add(event.id)
    events.push(event)
  }

  contracts.forEach((contract) => {
    const fields = profileFields(contract)
    const startDate = isoDateSlice(contract.contractStartDate)
    const endDate = contractEndDate(contract)
    const completedDate = contractCompletedDate(contract, endDate, today)
    const pay = paymentFields(contract, paymentByContract.get(String(contract.id)), today)

    if (startDate) {
      push(baseEvent({
        id: `contract_start:${contract.id}`,
        type: 'contract_start',
        title: 'Contract started',
        description: `${fields.contractLabel} monitoring window opened.`,
        date: startDate,
        timestamp: null,
        ...fields,
        amountAed: null,
        metricLabel: null,
        metricValue: null,
        paymentStatus: null,
        storedPaymentStatus: null,
        hasPersistedPayment: false,
      }, today))
    }

    if (endDate) {
      push(baseEvent({
        id: `contract_end:${contract.id}`,
        type: 'contract_end',
        title: 'Contract end date',
        description: `${fields.contractLabel} scheduled to end.`,
        date: endDate,
        timestamp: null,
        ...fields,
        amountAed: null,
        metricLabel: 'Check-ins',
        metricValue: `${contract.recordedDays || 0}/${contract.monitoringDays || 5}`,
        paymentStatus: null,
        storedPaymentStatus: null,
        hasPersistedPayment: false,
      }, today))
    }

    if (completedDate) {
      push(baseEvent({
        id: `contract_completed:${contract.id}`,
        type: 'contract_completed',
        title: 'Contract completed',
        description: `${fields.contractLabel} reached ${contract.recordedDays || 0} of ${contract.monitoringDays || 5} check-ins.`,
        date: completedDate,
        timestamp: null,
        ...fields,
        amountAed: toNumber(contract.totals?.cost) || null,
        metricLabel: 'Net profit',
        metricValue: Number.isFinite(toNumber(contract.totals?.netProfitAed))
          ? `${formatNumberCompact(contract.totals?.netProfitAed)} AED`
          : null,
        paymentStatus: null,
        storedPaymentStatus: null,
        hasPersistedPayment: false,
      }, today))
    }

    const dayByDate = new Map(
      (contract.days || []).map((day) => [isoDateSlice(day.date), day.dayNumber]),
    )

    contract.records.forEach((record) => {
      const date = isoDateSlice(record.date)
      if (!date) return
      const dayNumber = dayByDate.get(date) || 0
      push(baseEvent({
        id: `check_in:${record.id}`,
        type: 'check_in',
        title: dayNumber ? `Check-in · Day ${dayNumber}` : 'Performance check-in',
        description: checkInDescription(record, dayNumber || 0),
        date,
        timestamp: record.updatedAt || record.createdAt || null,
        ...fields,
        amountAed: toNumber(record.cost) || null,
        metricLabel: 'Sales',
        metricValue: `${formatNumberCompact(record.salesAed)} AED`,
        paymentStatus: null,
        storedPaymentStatus: null,
        hasPersistedPayment: false,
      }, today))
    })

    if (pay.payment?.dueDate) {
      push(baseEvent({
        id: `payment_due:${contract.id}`,
        type: 'payment_due',
        title: 'Payment due',
        description: pay.hasPersistedPayment
          ? `Outstanding ${formatNumberCompact(pay.outstanding)} AED · Stored status ${pay.storedStatus}`
          : 'Due date recorded.',
        date: isoDateSlice(pay.payment.dueDate),
        timestamp: pay.payment.updatedAt || null,
        ...fields,
        amountAed: pay.outstanding > 0 ? pay.outstanding : pay.contractCost || null,
        metricLabel: 'Contract cost',
        metricValue: pay.contractCost > 0 ? `${formatNumberCompact(pay.contractCost)} AED` : null,
        paymentStatus: pay.effectiveStatus,
        storedPaymentStatus: pay.storedStatus,
        hasPersistedPayment: pay.hasPersistedPayment,
      }, today))
    }

    if (pay.payment?.paymentDate && pay.amountPaid > 0) {
      push(baseEvent({
        id: `payment_completed:${contract.id}:${pay.payment.paymentDate}`,
        type: 'payment_completed',
        title: 'Payment completed',
        description: `${formatNumberCompact(pay.amountPaid)} AED paid${pay.payment.invoiceReference ? ` · Invoice ${pay.payment.invoiceReference}` : ''}.`,
        date: isoDateSlice(pay.payment.paymentDate),
        timestamp: pay.payment.updatedAt || null,
        ...fields,
        amountAed: pay.amountPaid,
        metricLabel: 'Outstanding',
        metricValue: pay.outstanding > 0 ? `${formatNumberCompact(pay.outstanding)} AED` : '0 AED',
        paymentStatus: pay.effectiveStatus,
        storedPaymentStatus: pay.storedStatus,
        hasPersistedPayment: true,
      }, today))
    }

    if (pay.hasPersistedPayment && pay.payment?.updatedAt) {
      const updatedDate = isoDateSlice(pay.payment.updatedAt)
      const dueDate = isoDateSlice(pay.payment.dueDate)
      const paymentDate = isoDateSlice(pay.payment.paymentDate)
      if (updatedDate && updatedDate !== dueDate && updatedDate !== paymentDate) {
        push(baseEvent({
          id: `payment_updated:${contract.id}:${updatedDate}`,
          type: 'payment_updated',
          title: 'Payment record updated',
          description: [
            `Status: ${pay.storedStatus}`,
            pay.payment.invoiceReference ? `Invoice ${pay.payment.invoiceReference}` : '',
            pay.payment.notes?.trim() || '',
          ].filter(Boolean).join(' · '),
          date: updatedDate,
          timestamp: pay.payment.updatedAt || null,
          ...fields,
          amountAed: pay.amountPaid || null,
          metricLabel: 'Outstanding',
          metricValue: pay.outstanding > 0 ? `${formatNumberCompact(pay.outstanding)} AED` : null,
          paymentStatus: pay.effectiveStatus,
          storedPaymentStatus: pay.storedStatus,
          hasPersistedPayment: true,
        }, today))
      } else if (pay.hasPersistedPayment && !dueDate && !paymentDate && updatedDate) {
        push(baseEvent({
          id: `payment_updated:${contract.id}:${updatedDate}`,
          type: 'payment_updated',
          title: 'Payment tracked',
          description: `Finance status set to ${pay.storedStatus}.`,
          date: updatedDate,
          timestamp: pay.payment.updatedAt || null,
          ...fields,
          amountAed: pay.amountPaid || null,
          metricLabel: null,
          metricValue: null,
          paymentStatus: pay.effectiveStatus,
          storedPaymentStatus: pay.storedStatus,
          hasPersistedPayment: true,
        }, today))
      }
    }
  })

  roster.forEach((inf) => {
    const profile = profileById.get(String(inf.id))
    const image = profile?.profileImage || ''
    const fields = influencerOnlyFields(inf, image)

    const shootDate = isoDateSlice(inf.shootDate)
    if (shootDate) {
      push(baseEvent({
        id: `shoot:${inf.id}:${shootDate}`,
        type: 'shoot_scheduled',
        title: 'Shoot scheduled',
        description: [inf.shootLocation, inf.shootTime, inf.campaign].filter(Boolean).join(' · ') || 'Deliverable shoot on calendar.',
        date: shootDate,
        timestamp: null,
        ...fields,
        amountAed: null,
        metricLabel: null,
        metricValue: null,
        paymentStatus: null,
        storedPaymentStatus: null,
        hasPersistedPayment: false,
      }, today))
    }

    const timeline = Array.isArray(inf.timeline) ? inf.timeline : []
    timeline.forEach((entry, index) => {
      const date = isoDateSlice(entry.date)
      if (!date) return
      push(baseEvent({
        id: `workflow:${inf.id}:${index}:${date}`,
        type: 'workflow',
        title: entry.event || 'Workflow update',
        description: entry.note?.trim() || 'Roster workflow timeline entry.',
        date,
        timestamp: null,
        ...fields,
        amountAed: null,
        metricLabel: null,
        metricValue: null,
        paymentStatus: null,
        storedPaymentStatus: null,
        hasPersistedPayment: false,
      }, today))
    })
  })

  return events.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date)
    if (dateCmp !== 0) return dateCmp
    return a.id.localeCompare(b.id)
  })
}

export function resolveTimelineDateRange(
  preset: InfluencerModuleTimelineDatePreset,
  customFrom = '',
  customTo = '',
): InfluencerDashboardDateRange {
  return resolveDashboardDateRange(preset, customFrom, customTo)
}

export function filterTimelineEvents(
  events: InfluencerModuleTimelineEvent[],
  {
    range,
    influencerId,
    contractId,
    eventType,
    status,
    needsAttentionOnly,
  }: {
    range: InfluencerDashboardDateRange
    influencerId: string
    contractId: string
    eventType: InfluencerModuleTimelineEventType | 'all'
    status: InfluencerModuleTimelineStatus | 'all'
    needsAttentionOnly: boolean
  },
): InfluencerModuleTimelineEvent[] {
  return events.filter((event) => {
    if (range && event.date && (event.date < range.from || event.date > range.to)) return false
    if (influencerId !== 'all' && event.influencerId !== influencerId) return false
    if (contractId !== 'all' && event.contractId !== contractId) return false
    if (eventType !== 'all' && event.type !== eventType) return false
    if (status !== 'all' && event.status !== status) return false
    if (needsAttentionOnly && !['needs_attention', 'overdue'].includes(event.status)) return false
    return true
  })
}

export function summarizeTimelineEvents(
  events: InfluencerModuleTimelineEvent[],
  today = utcTodayIso(),
): InfluencerModuleTimelineSummary {
  let upcoming = 0
  let dueSoon = 0
  let overdue = 0
  let completedRecently = 0

  events.forEach((event) => {
    if (event.status === 'overdue') overdue += 1
    if (event.status === 'needs_attention') dueSoon += 1
    if (event.status === 'upcoming') upcoming += 1
    if (event.status === 'completed') completedRecently += 1
    if (event.type === 'payment_due' && event.date >= today) {
      const days = daysBetween(today, event.date)
      if (days <= DUE_SOON_DAYS) dueSoon += 1
    }
  })

  return { upcoming, dueSoon, overdue, completedRecently }
}

export function paginateTimelineEvents(
  events: InfluencerModuleTimelineEvent[],
  visibleCount: number,
): { visible: InfluencerModuleTimelineEvent[]; hasMore: boolean; total: number } {
  const total = events.length
  const limit = Math.max(0, visibleCount)
  return {
    visible: events.slice(0, limit),
    hasMore: total > limit,
    total,
  }
}

function monthLabel(date: string): string {
  const dt = parseIsoDate(date)
  if (!dt) return 'Unknown date'
  return new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(dt).toUpperCase()
}

function startOfWeekIso(today: string): string {
  const dt = parseIsoDate(today)
  if (!dt) return today
  const day = dt.getUTCDay()
  const diff = day === 0 ? 6 : day - 1
  dt.setUTCDate(dt.getUTCDate() - diff)
  return dt.toISOString().slice(0, 10)
}

export function groupTimelineEvents(
  events: InfluencerModuleTimelineEvent[],
  mode: InfluencerModuleTimelineGroupMode,
  today = utcTodayIso(),
): InfluencerModuleTimelineGroup[] {
  if (mode === 'influencer') {
    const map = new Map<string, InfluencerModuleTimelineEvent[]>()
    events.forEach((event) => {
      const key = event.influencerId
      const list = map.get(key) || []
      list.push(event)
      map.set(key, list)
    })
    return Array.from(map.entries())
      .sort((a, b) => (a[1][0]?.influencerName || '').localeCompare(b[1][0]?.influencerName || ''))
      .map(([key, groupEvents]) => ({
        key,
        label: groupEvents[0]?.influencerName || 'Influencer',
        events: groupEvents,
      }))
  }

  if (mode === 'contract') {
    const map = new Map<string, InfluencerModuleTimelineEvent[]>()
    events.forEach((event) => {
      const key = event.contractId || `influencer:${event.influencerId}`
      const list = map.get(key) || []
      list.push(event)
      map.set(key, list)
    })
    return Array.from(map.entries())
      .sort((a, b) => (a[1][0]?.contractLabel || a[1][0]?.influencerName || '').localeCompare(b[1][0]?.contractLabel || b[1][0]?.influencerName || ''))
      .map(([key, groupEvents]) => ({
        key,
        label: groupEvents[0]?.contractLabel || groupEvents[0]?.influencerName || 'Influencer activity',
        events: groupEvents,
      }))
  }

  const weekStart = startOfWeekIso(today)
  const map = new Map<string, InfluencerModuleTimelineEvent[]>()
  events.forEach((event) => {
    let label = monthLabel(event.date)
    if (event.date === today) label = 'TODAY'
    else if (event.date >= weekStart && event.date < today) label = 'THIS WEEK'
    else if (event.date > today) label = 'UPCOMING'
    const list = map.get(label) || []
    list.push(event)
    map.set(label, list)
  })

  const order = ['UPCOMING', 'TODAY', 'THIS WEEK']
  return Array.from(map.entries())
    .sort((a, b) => {
      const ai = order.indexOf(a[0])
      const bi = order.indexOf(b[0])
      if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
      const aDate = a[1][0]?.date || ''
      const bDate = b[1][0]?.date || ''
      return bDate.localeCompare(aDate)
    })
    .map(([label, groupEvents]) => ({
      key: label,
      label,
      events: groupEvents,
    }))
}

export function paymentsUrlForContract(contractId: string): string {
  return `/influencers/payments?contract=${encodeURIComponent(contractId)}`
}

export function performanceUrlForContract(contractId: string): string {
  return `/influencers/performance?contract=${encodeURIComponent(contractId)}`
}

export function influencerProfileUrl(influencerId: string): string {
  return `/influencers/${encodeURIComponent(influencerId)}`
}

export function defaultTimelineFilters(): import('../../types/influencer').InfluencerModuleTimelineFilters {
  return {
    datePreset: 'all_time',
    customFrom: '',
    customTo: '',
    influencerId: 'all',
    contractId: 'all',
    eventType: 'all',
    status: 'all',
    needsAttentionOnly: false,
    groupMode: 'date',
  }
}

export function contractOptionsFromEvents(events: InfluencerModuleTimelineEvent[]) {
  const map = new Map<string, string>()
  events.forEach((event) => {
    if (event.contractId && event.contractLabel) {
      map.set(event.contractId, event.contractLabel)
    }
  })
  return Array.from(map.entries())
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

export { contractOverlapsDateRange }
