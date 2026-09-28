import { api } from './client'

export interface StripeRecentEvent {
  eventId: string
  type: string
  livemode: boolean
  receivedAt: string
  objectId: string | null
  objectType: string | null
}

export interface StripeConnectionStatus {
  ready: boolean
  secretKeyConfigured: boolean
  webhookSecretConfigured: boolean
  mode: 'test' | 'live' | null
  keyMode: 'test' | 'live' | null
  modeMismatch: boolean
  webhookPath: string
  lastEventAt: string | null
  lastEventType: string | null
  recentEvents: StripeRecentEvent[]
}

export interface StripeConnectionTestResult {
  ok: boolean
  mode: 'test' | 'live'
  accountId: string | null
  chargesEnabled: boolean
  payoutsEnabled: boolean
}

export type StripeMatchStatus =
  | 'MATCHED_READY_TO_CLEAR'
  | 'ALREADY_CLEARED'
  | 'NO_WEBSITE_ORDER'
  | 'NO_ZOHO_INVOICE'
  | 'MULTIPLE_ZOHO_INVOICES'
  | 'AMOUNT_MISMATCH'
  | 'CURRENCY_MISMATCH'
  | 'STRIPE_NOT_SUCCEEDED'
  | 'ZOHO_BALANCE_MISMATCH'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED'
  | 'NEEDS_REVIEW'
  | 'STRIPE_NOT_VERIFIED'

export type StripeClearingStatus =
  | 'READY'
  | 'POSTING'
  | 'POSTED'
  | 'FAILED'
  | 'BLOCKED'
  | 'FAILED_NEEDS_REVIEW'
  | 'REVERSED_EXTERNALLY'

export interface StripeClearingDryRunRow {
  stripePaymentIntentId: string | null
  stripe: { amount: number; currency: string; status: string; livemode: boolean } | null
  website: { orderNumber: string; finalAmount: number; orderStatus: string; paymentStatus: string } | null
  zoho: { invoiceId: string; invoiceNumber: string; total: number; balance: number; status: string } | null
  localClearing: { status: StripeClearingStatus; zohoPaymentId: string | null; postedAt: string | null; lastError: string | null } | null
  result: { status: StripeMatchStatus; reason: string }
  canPost: boolean
}

export interface StripeClearingDryRun {
  dryRun: true
  source: 'stripe' | 'website'
  stripeVerified: boolean
  posting: { enabled: boolean; reasons: Array<{ code: string; message: string }>; depositAccountName: string }
  truncated: boolean
  counts: Record<StripeMatchStatus, number>
  rows: StripeClearingDryRunRow[]
}

export function getStripeClearingDryRun(params: { from: string; to: string; source: 'stripe' | 'website' }) {
  const query = new URLSearchParams(params).toString()
  return api.get(`/api/stripe/clearing/dry-run?${query}`) as Promise<StripeClearingDryRun>
}

// ── Payout clearing (read-only preview + local admin confirmation) ──────────

export type StripePayoutGroupStatus =
  | 'READY'
  | 'READY_WITH_CUSTOMER_ADVANCE'
  | 'NEEDS_REVIEW'
  | 'PARTIALLY_POSTED'
  | 'POSTED'
  | 'ALREADY_POSTED'

export type StripePayoutStatus = 'READY' | 'PARTIALLY_CLEARED' | 'FULLY_CLEARED' | 'NEEDS_REVIEW'

export type StripePayoutComponentKind = 'NET' | 'FEE' | 'CUSTOMER_ADVANCE' | 'CUSTOMER_ADVANCE_REFUND'

export type StripePayoutLineState = 'OPEN' | 'PARTIALLY_CLEARED' | 'CLEARED' | 'NEEDS_REVIEW'

export type StripeAdvanceCaseStatus =
  | 'CUSTOMER_ADVANCE_REVIEW_REQUIRED'
  | 'CONFIRMED'
  | 'ADVANCE_POSTED'
  | 'REFUNDED'
  | 'REJECTED'

export type StripeRecoveryAction = 'SKIP_VERIFIED' | 'POST_ELIGIBLE' | 'RETRY_ELIGIBLE' | 'NEEDS_REVIEW'

export interface StripeZohoAccount {
  accountId: string
  accountName: string
  accountCode: string
  accountType?: string
}

export interface StripePayoutComposition {
  chargeCount: number
  chargeGross: number
  chargeFee: number
  chargeNet: number
  otherCount: number
  otherNet: number
  contentNet: number
  payoutAmount: number
  reconciles: boolean
}

export interface StripePayoutSummary {
  payoutId: string
  status: string
  amount: number
  currency: string
  arrivalDate: string | null
  createdAt: string | null
  composition: StripePayoutComposition
}

export type StripeAdvanceRefundStatus = 'NOT_REFUNDED' | 'REFUND_DETECTED' | 'REFUND_MATCHED' | 'REFUNDED' | 'REFUND_MISMATCH'

/** A Stripe refund that equals the customer advance and belongs to a later payout. */
export interface StripeAdvanceRefundDetail {
  refundId: string
  balanceTransactionId: string
  amount: number
  fee: number
  net: number
  currency: string
  status: string
  createdAt: string | null
  refundPayoutId: string | null
}

/** Refunds found on an overpaid charge, and whether they are exactly the advance. */
export interface StripeLineRefundCheck {
  status: StripeAdvanceRefundStatus
  matchesAdvance: boolean
  reason: string
  refundedAmount: number
  refunds: Array<{ refundId: string; amount: number; status: string; createdAt: string | null; balanceTransactionId: string | null }>
  refund: StripeAdvanceRefundDetail | null
}

export interface StripePayoutAdvance {
  overpaymentAmount: number
  invoiceTotal: number
  stripeGross: number
  netAllocation: number
  caseStatus: StripeAdvanceCaseStatus
  confirmed: boolean
  caseId: string | null
  confirmedBy: string | null
  confirmedAt: string | null
  reason: string | null
  refundStatus?: StripeAdvanceRefundStatus
  refund?: StripeAdvanceRefundDetail | null
  refundDetectedAt?: string | null
}

export interface StripePayoutLine {
  balanceTransactionId: string
  chargeId: string | null
  paymentIntentId: string | null
  gross: number
  net: number
  fee: number
  invoiceTotal: number
  netAllocation: number
  feeAllocation: number
  customerAdvance: number
  website: { orderId: string; orderNumber: string; finalAmount: number; shopOrder: boolean; orderStatus: string; paymentStatus: string } | null
  invoice: { invoiceId: string; invoiceNumber: string; total: number; balance: number; status: string; customerId: string } | null
  advance: StripePayoutAdvance | null
  refund?: StripeLineRefundCheck | null
  state: StripePayoutLineState
  matchStatus: StripeMatchStatus | null
  reason: string
}

export interface StripePayoutAllocation {
  invoiceId: string
  invoiceNumber: string
  orderNumber: string
  paymentIntentId: string | null
  amount: number
}

export interface StripePayoutComponent {
  component: StripePayoutComponentKind
  zohoRecordType: 'customer_payment' | 'journal'
  amount: number
  reference: string
  depositAccountId?: string | null
  account?: StripeZohoAccount | null
  debitAccountId?: string | null
  creditAccountId?: string | null
  debitAccount?: StripeZohoAccount | null
  creditAccount?: StripeZohoAccount | null
  allocations: StripePayoutAllocation[]
  advanceCaseIds: string[]
  payload: Record<string, unknown>
  zoho: {
    state: 'MISSING' | 'VERIFIED' | 'CONFLICT'
    recordId: string | null
    records: Array<{ recordId: string; amount?: number; date?: string | null }>
    differences: string[]
    reason?: string
  }
  local: {
    id: string
    status: string
    zohoRecordId: string | null
    zohoJournalId: string | null
    attemptCount: number
    lastError: string | null
    postedAt: string | null
    verifiedAt: string | null
  } | null
  recovery: { action: StripeRecoveryAction; reason: string }
}

export interface StripePayoutGroupTotals {
  invoiceGross: number
  netTo1019: number
  customerAdvance: number
  total1019: number
  feeTo1013: number
  stripeGross: number
}

export interface StripePayoutGroup {
  groupKey: string
  customerId: string
  customerName: string
  status: StripePayoutGroupStatus
  reasons: string[]
  postable: boolean
  advanceReviewRequired: boolean
  invoiceCount: number
  chargeCount: number
  totals: StripePayoutGroupTotals
  checks: { total1019PlusFeeEqualsGross: boolean; netPlusFeeEqualsInvoices: boolean; everyLineBalances: boolean }
  components: StripePayoutComponent[]
  /** Sent back when posting; the server refuses if the live plan no longer matches. */
  postingFingerprint: string
  lines: StripePayoutLine[]
}

export interface StripePayoutReconciliation {
  netTo1019: number
  customerAdvances: number
  total1019: number
  advanceRefundsOutOf1019: number
  fees: number
  payoutAmount: number
  stripeGross: number
  total1019PlusFees: number
  payoutMatches: boolean
  grossMatches: boolean
}

export interface StripeAdvanceCaseEvent {
  entityId: string
  fromStatus: string | null
  toStatus: string
  detail: string | null
  actor: string | null
  at: string | null
}

export interface StripeAdvanceRefund {
  balanceTransactionId: string
  refundId: string | null
  chargeId: string | null
  amount: number
  caseId: string | null
  caseStatus: string | null
  originalPayoutId: string | null
  status: 'REFUND_MATCHED' | 'REFUND_MISMATCH' | 'NO_ADVANCE_CASE'
  matched: boolean
  reason: string
  originalAdvanceJournal: { reference: string; state: 'MISSING' | 'VERIFIED' | 'CONFLICT'; recordId: string | null; reason: string | null } | null
  posting: { allowed: boolean; blockers: string[] }
  proposedJournal: { amount: number; reference: string; payload: Record<string, unknown> } | null
}

export interface StripeOtherTransaction {
  balanceTransactionId: string
  type: string
  reportingCategory: string | null
  amount: number
  fee: number
  net: number
  description: string | null
}

export interface StripePayoutPreview {
  preview: true
  postingEnabled: boolean
  postingBlockedReasons?: Array<{ code: string; message: string }>
  payout: { payoutId: string; status: string; amount: number; currency: string; arrivalDate: string | null; createdAt: string | null }
  status: StripePayoutStatus
  blockers: string[]
  proposedPaymentDate: string | null
  accounts: { net: StripeZohoAccount | null; fee: StripeZohoAccount | null; advance: StripeZohoAccount | null; problems: string[] }
  composition: StripePayoutComposition
  reconciliation: StripePayoutReconciliation
  customersPresent: string[]
  groups: StripePayoutGroup[]
  unassigned: StripePayoutLine[]
  advanceCaseEvents: StripeAdvanceCaseEvent[]
  advanceRefunds: StripeAdvanceRefund[]
  otherTransactions: StripeOtherTransaction[]
  warnings: string[]
}

export interface StripeAdvanceConfirmResult {
  alreadyConfirmed: boolean
  caseId?: string | null
  zohoWrites: 0
}

export function getStripePayouts(limit = 10) {
  return api.get(`/api/stripe/payouts?limit=${limit}`) as Promise<{ rows: StripePayoutSummary[] }>
}

export function getStripePayoutPreview(payoutId: string) {
  return api.get(`/api/stripe/payouts/${encodeURIComponent(payoutId)}/preview`) as Promise<StripePayoutPreview>
}

/** Local status only; nothing is sent to Zoho. */
export function confirmStripeCustomerAdvance(payoutId: string, chargeId: string, reason: string) {
  return api.post(`/api/stripe/payouts/${encodeURIComponent(payoutId)}/customer-advance-cases/confirm`, {
    chargeId,
    reason,
  }) as Promise<StripeAdvanceConfirmResult>
}

export interface StripePayoutPostComponentResult {
  component: StripePayoutComponentKind
  amount: number
  reference: string
  status: string | null
  zohoRecordId: string | null
  attemptCount?: number
  lastError?: string | null
  requestSent: boolean
  reason?: string
}

export interface StripePayoutPostResult {
  outcome: 'POSTED' | 'PARTIALLY_POSTED' | 'NEEDS_REVIEW' | 'NOT_POSTED'
  alreadyPosted: boolean
  payoutId: string
  customerId: string
  customerName: string
  components: StripePayoutPostComponentResult[]
  notAttempted?: StripePayoutComponentKind[]
  zohoRequests: number
  advanceCasesPosted: Array<{ id: string; status: string; zohoJournalId: string | null }>
}

/** Creates Zoho customer payments (and the confirmed advance journal) for one payout + customer. */
export function postStripePayoutGroup(payoutId: string, zohoCustomerId: string, fingerprint: string) {
  return api.post(`/api/stripe/payouts/${encodeURIComponent(payoutId)}/customers/${encodeURIComponent(zohoCustomerId)}/post`, {
    fingerprint,
  }) as Promise<StripePayoutPostResult>
}

export function getStripeStatus() {
  return api.get('/api/stripe/status') as Promise<StripeConnectionStatus>
}

export function testStripeConnection() {
  return api.post('/api/stripe/connection-test', {}) as Promise<StripeConnectionTestResult>
}
