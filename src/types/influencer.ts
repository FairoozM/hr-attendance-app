/**
 * Shared Influencer module types.
 * Roster CRM shape lives in `src/lib/influencers.ts` and is re-exported here
 * so consumers can import from one module types location.
 */

import type { Influencer, InfluencerSocial } from '../lib/influencers'

export type {
  Influencer,
  InfluencerSocial,
  InfluencerTimelineEntry,
} from '../lib/influencers'

export type {
  InfluencerResponse,
  NormalizedInfluencerResponse,
} from '../lib/influencerResponse'

/** Slim influencer model used on the performance screen (from createInfluencerFromAppRecord). */
export interface InfluencerPerformanceProfile {
  id: string
  name: string
  platform: string
  username: string
  niche: string
  profileImage: string
  followers: number
  assignedCampaign: string
  status: string
  createdAt: string
  updatedAt: string
}

/** Daily check-in / performance record (stored in influencer_performance_records.body). */
export interface InfluencerPerformance {
  id: string
  contractId: string
  influencerId: string
  date: string
  platform?: string
  postUrl?: string
  campaignName?: string
  videoTitle?: string
  contractStartDate?: string
  contractEndDate?: string
  monitoringDays?: number
  views: number
  likes: number
  comments: number
  shares: number
  saves?: number
  /** 0 = no story posting, 1 = posted (legacy rows may have large view counts). */
  storyViews?: number
  salesAed: number
  cost: number
  /** Admin-only; omitted when the viewer cannot see net profit. */
  netProfitAed?: number
  engagementRate?: number
  notes?: string
  screenshotUrl?: string
  createdAt?: string
  updatedAt?: string
}

/** Metric fields may arrive as form strings before normalizePerformanceRecord. */
export type InfluencerMetricValue = number | string

/** Partial / incoming payload before normalizePerformanceRecord. */
export type InfluencerPerformanceInput = Omit<
  Partial<InfluencerPerformance>,
  'views' | 'likes' | 'comments' | 'shares' | 'saves' | 'storyViews' | 'salesAed' | 'cost' | 'netProfitAed'
> & {
  influencerId?: string
  date?: string
  views?: InfluencerMetricValue
  likes?: InfluencerMetricValue
  comments?: InfluencerMetricValue
  shares?: InfluencerMetricValue
  saves?: InfluencerMetricValue
  storyViews?: InfluencerMetricValue
  salesAed?: InfluencerMetricValue
  cost?: InfluencerMetricValue
  netProfitAed?: InfluencerMetricValue
}

export interface InfluencerAggregatedMetrics {
  views: number
  likes: number
  comments: number
  shares: number
  saves: number
  storyViews: number
  cost: number
  salesAed: number
  netProfitAed: number
}

export interface InfluencerContractDay {
  dayNumber: number
  date: string
  inContractWindow: boolean
  record: InfluencerPerformance | null
  isRecorded: boolean
}

/** Video contract timeline built client-side from daily check-ins. */
export interface InfluencerContract {
  id: string
  naturalKey?: string
  influencerId: string
  influencer?: InfluencerPerformanceProfile
  platform?: string
  videoTitle?: string
  postUrl?: string
  campaignName?: string
  contractStartDate: string
  contractEndDate?: string
  latestDate?: string
  monitoringDays: number
  records: InfluencerPerformance[]
  days: InfluencerContractDay[]
  latest?: InfluencerPerformance
  totals: InfluencerAggregatedMetrics
  recordedDays: number
  averageEngagementRate: number
}

/** Ranking row for a contract (by latest net profit AED). */
export interface InfluencerContractRanking {
  rank: number
  score: number
  score100: number
  contractId: string
}

/** Table row derived from a contract (flattened metrics for sorting/display). */
export interface InfluencerContractRow extends InfluencerAggregatedMetrics {
  id: string
  contractId: string
  influencerId: string
  influencer?: InfluencerPerformanceProfile
  platform?: string
  postUrl?: string
  campaignName?: string
  videoTitle?: string
  contractStartDate: string
  startDate: string
  latestDate: string
  date: string
  monitoringDays: number
  recordedDays: number
  days: InfluencerContractDay[]
  latest?: InfluencerPerformance
  records: InfluencerPerformance[]
  totals: InfluencerAggregatedMetrics
  engagementRate: number
}

/** Payment fields on the influencer snapshot (no separate payment entity). */
export interface InfluencerPayment {
  influencerId: string
  name: string
  paymentStatus: string
  paymentMethod?: string
  paymentNotes?: string
  bankName?: string
  accountTitle?: string
  iban?: string
  currency?: string
  packagePrice?: string | number
  reelsPrice?: string | number
  storiesPrice?: string | number
  updatedAt?: string
}

export const INFLUENCER_CONTRACT_PAYMENT_STATUSES = [
  'Not Due',
  'Pending',
  'Partially Paid',
  'Paid',
  'Overdue',
  'Disputed',
] as const

export type InfluencerContractPaymentStatus = (typeof INFLUENCER_CONTRACT_PAYMENT_STATUSES)[number]

/** UI-only status when no influencer_contract_payments row exists (not persisted). */
export type InfluencerContractPaymentDisplayStatus = InfluencerContractPaymentStatus | 'Untracked'

export const INFLUENCER_CONTRACT_PAYMENT_FILTER_STATUSES = [
  'Untracked',
  ...INFLUENCER_CONTRACT_PAYMENT_STATUSES,
] as const

export type InfluencerContractPaymentFilterStatus = (typeof INFLUENCER_CONTRACT_PAYMENT_FILTER_STATUSES)[number]

/** GET/PATCH /api/influencers/contract-payments — per performance contract. */
export interface InfluencerContractPayment {
  contractId: string
  influencerId: string
  amountPaid: number
  paymentStatus: InfluencerContractPaymentStatus | string
  dueDate: string | null
  paymentDate: string | null
  invoiceReference: string
  notes?: string
  zohoVendorBillId?: string | null
  zohoPaymentId?: string | null
  zohoLastSyncedAt?: string | null
  createdAt?: string
  updatedAt?: string
  updatedBy?: number | null
}

/** Workflow / agreement timeline entry (alias of roster timeline entry). */
export type InfluencerTimelineEvent = {
  event: string
  date: string
  note?: string
}

/** Unified module timeline — derived from performance, payments, and roster data. */
export const INFLUENCER_MODULE_TIMELINE_EVENT_TYPES = [
  'contract_start',
  'contract_end',
  'contract_completed',
  'check_in',
  'workflow',
  'shoot_scheduled',
  'payment_due',
  'payment_completed',
  'payment_updated',
] as const

export type InfluencerModuleTimelineEventType = (typeof INFLUENCER_MODULE_TIMELINE_EVENT_TYPES)[number]

export const INFLUENCER_MODULE_TIMELINE_STATUSES = [
  'normal',
  'upcoming',
  'completed',
  'needs_attention',
  'overdue',
] as const

export type InfluencerModuleTimelineStatus = (typeof INFLUENCER_MODULE_TIMELINE_STATUSES)[number]

export type InfluencerModuleTimelineGroupMode = 'date' | 'influencer' | 'contract'

export type InfluencerModuleTimelineDatePreset =
  | 'this_month'
  | 'last_month'
  | 'this_quarter'
  | 'this_year'
  | 'custom'
  | 'all_time'

export interface InfluencerModuleTimelineFilters {
  datePreset: InfluencerModuleTimelineDatePreset
  customFrom: string
  customTo: string
  influencerId: string
  contractId: string
  eventType: InfluencerModuleTimelineEventType | 'all'
  status: InfluencerModuleTimelineStatus | 'all'
  needsAttentionOnly: boolean
  groupMode: InfluencerModuleTimelineGroupMode
}

export interface InfluencerModuleTimelineEvent {
  id: string
  type: InfluencerModuleTimelineEventType
  status: InfluencerModuleTimelineStatus
  title: string
  description: string
  /** Primary sort key — YYYY-MM-DD (time-less operational dates). */
  date: string
  /** Optional ISO timestamp for display when available. */
  timestamp: string | null
  influencerId: string
  influencerName: string
  influencerHandle: string
  influencerImage: string
  contractId: string | null
  contractLabel: string | null
  amountAed: number | null
  metricLabel: string | null
  metricValue: string | null
  paymentStatus: string | null
  storedPaymentStatus: string | null
  hasPersistedPayment: boolean
}

export interface InfluencerModuleTimelineSummary {
  upcoming: number
  dueSoon: number
  overdue: number
  completedRecently: number
}

export interface InfluencerModuleTimelineGroup {
  key: string
  label: string
  events: InfluencerModuleTimelineEvent[]
}

export interface InfluencerDashboardSummary {
  totalContracts: number
  activeContracts: number
  completedContracts: number
  totalViews: number
  totalLikes: number
  totalComments: number
  totalShares: number
  totalSalesAed: number
  totalCost: number
  totalNetProfitAed?: number
}

export interface InfluencerFilters {
  search?: string
  approvalStatus?: string
  paymentStatus?: string
  nationality?: string
  collaborationType?: string
  followersBucket?: string
  dateFrom?: string
  dateTo?: string
  sortKey?: string
  sortDirection?: 'asc' | 'desc'
}

export interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

/** GET /api/influencers/performance-records */
export interface InfluencerPerformanceRecordsResponse {
  records: InfluencerPerformanceInput[]
  contracts?: Array<Record<string, unknown>>
}

/** POST .../performance-records/bulk-upsert */
export interface InfluencerPerformanceBulkUpsertResponse {
  success?: boolean
  upserted?: number
  skipped?: number
  skippedTombstoned?: number
}

/** Sort state for performance table / contract rows. */
export interface InfluencerPerformanceSort {
  key: string
  direction: 'asc' | 'desc'
}

export type InfluencerFormatNumberOptions = {
  currency?: string
}

export type InfluencerMetricBestField =
  | 'views'
  | 'likes'
  | 'comments'
  | 'shares'
  | 'salesAed'
  | 'netProfitAed'
  | 'cost'

export type InfluencerMetricBests = Partial<Record<InfluencerMetricBestField, number>>

/** List metadata from InfluencersContext (Pagination + client vs server paging flag). */
export type InfluencerListMeta = Pagination & {
  isFullListClientPaging: boolean
}

/** PATCH body for partial influencer updates (context / pages). */
export type InfluencerUpdatePayload = Partial<Influencer> & {
  id?: string
  updatedAt?: string
  timelineAppend?: InfluencerTimelineEvent
}

/** Payload passed to addInfluencer before server assigns id and defaults. */
export type InfluencerCreatePayload = Partial<Omit<Influencer, 'id'>>

/** Form state on Add/Edit influencer (empty strings instead of optional fields). */
export type InfluencerFormState = {
  name: string
  mobile: string
  whatsapp: string
  email: string
  nationality: string
  basedIn: string
  niche: string
  notes: string
  instagram: InfluencerSocial
  youtube: InfluencerSocial
  tiktok: InfluencerSocial
  snapchat: string
  facebook: string
  twitter: string
  telegram: string
  website: string
  otherSocial: string
  followersCount: string
  engagementRate: string
  avgReelViews: string
  avgStoryReach: string
  audienceNotes: string
  insightsReceived: boolean
  reelsPrice: string
  storiesPrice: string
  packagePrice: string
  currency: string
  deliverables: string
  collaborationType: string
  reelStaysOnPage: boolean
  contentForBrand: boolean
  contactStatus: string
  discussionNotes: string
  negotiationNotes: string
  offerShared: boolean
  approvalNotes: string
  rejectionNotes: string
  followUpReminder: string
  bankName: string
  accountTitle: string
  iban: string
  paymentMethod: string
  paymentNotes: string
  workflowStatus: string
  approvalStatus: string
  paymentStatus: string
  assignedTo: string
  shootDate: string
  shootTime: string
  shootLocation: string
  campaign: string
  agreementStatus: string
  profileImageKey: string
  profileImageUrl: string
  insightsImageKeys: string[]
  insightsImageRotations: Record<string, number>
}
