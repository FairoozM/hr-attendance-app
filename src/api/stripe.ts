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
  | 'POSTING_UNCERTAIN'

export type StripePayoutStatus = 'READY' | 'PARTIALLY_CLEARED' | 'FEE_JOURNAL_PENDING' | 'FULLY_CLEARED' | 'NEEDS_REVIEW' | 'POSTING_UNCERTAIN'

export type StripePayoutComponentKind =
  | 'NET'
  | 'FEE'
  | 'CUSTOMER_ADVANCE'
  | 'CUSTOMER_ADVANCE_REFUND'
  | 'PAYOUT_FEE_JOURNAL'
  | 'REFUND_CREDIT_NOTE_REFUND'
  | 'REFUND_FEE_ADJUSTMENT'

export type StripeNormalRefundStatus =
  | 'DETECTED'
  | 'MATCHED'
  | 'READY'
  | 'POSTED'
  | 'VERIFIED'
  | 'LEGACY_VERIFIED'
  | 'NEEDS_REVIEW'
  | 'MISMATCH'
  | 'FAILED'
  | 'POSTING_UNCERTAIN'

export type StripeFeeJournalStatus = 'WAITING' | 'READY' | 'VERIFIED' | 'LEGACY_VERIFIED' | 'NOT_REQUIRED' | 'NEEDS_REVIEW' | 'POSTING_UNCERTAIN'

export type StripePayoutLineState = 'OPEN' | 'PARTIALLY_CLEARED' | 'CLEARED' | 'NEEDS_REVIEW'

export type StripeAdvanceCaseStatus =
  | 'CUSTOMER_ADVANCE_REVIEW_REQUIRED'
  | 'CONFIRMED'
  | 'ADVANCE_POSTED'
  | 'REFUNDED'
  | 'REJECTED'

export type StripeRecoveryAction = 'SKIP_VERIFIED' | 'POST_ELIGIBLE' | 'RETRY_ELIGIBLE' | 'NEEDS_REVIEW' | 'POSTING_UNCERTAIN'

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
  /** Absent from previews produced before direct Stripe payments were supported. */
  source?: StripeLineSource | null
  website: { orderId: string; orderNumber: string; finalAmount: number; shopOrder: boolean; orderStatus: string; paymentStatus: string } | null
  direct?: StripeDirectMapping | null
  /** Set on an unassigned charge whose website order was cancelled without any refund. */
  originalOrder?: StripeReassignOrigin | null
  chargeCreatedAt?: string | null
  description?: string | null
  invoice: {
    invoiceId: string
    invoiceNumber: string
    total: number
    balance: number
    status: string
    customerId: string
    referenceNumber?: string
    date?: string
  } | null
  advance: StripePayoutAdvance | null
  refund?: StripeLineRefundCheck | null
  /** Set when the order was physically returned but no money has moved back yet. */
  returnWarning?: StripeReturnWarning | null
  state: StripePayoutLineState
  matchStatus: StripeMatchStatus | 'DIRECT_PAYMENT_MAPPED' | 'REASSIGNED_PAYMENT_MAPPED' | null
  reason: string
}

/** The cancelled website order a reassignable charge originally paid; evidence only, never changed. */
export interface StripeReassignOrigin {
  orderId: string
  orderNumber: string
  orderStatus: string
  paymentStatus: string
  paymentMethod: string | null
  finalAmount: number
  shopOrder: boolean
  createdAt: string | null
  zohoCustomerId: string
  refundedThroughStripe: number
}

export interface StripeOriginalInvoice {
  invoiceId: string
  invoiceNumber: string
  referenceNumber: string
  total: number
  balance: number
  status: string
  customerId: string
  customerName?: string | null
  date?: string
}

/** Non-blocking: the original payment still clears; the refund clears when it actually happens. */
export interface StripeReturnWarning {
  title: string
  orderNumber: string
  orderStatus: string
  creditNotes: Array<{
    creditNoteId: string
    creditNoteNumber: string
    status: string
    total: number
    balance: number
    salesReturnNumber: string | null
    refundStatus: 'pending' | 'refunded'
  }>
  stripeRefunded: number
  details: string[]
  message: string
}

export type StripeLineSource = 'WEBSITE_ORDER' | 'DIRECT_STRIPE_PAYMENT' | 'REASSIGNED_STRIPE_PAYMENT'

/**
 * DIRECT_PAYMENT: the charge never had a website order (Payment Link).
 * REASSIGNED_PAYMENT: the charge paid a cancelled website order and was reused for a replacement invoice.
 */
export type StripeDirectMappingType = 'DIRECT_PAYMENT' | 'REASSIGNED_PAYMENT'

/** Admin-confirmed mapping of a Stripe charge (direct or reassigned payment) to an existing Zoho invoice. */
export interface StripeDirectMapping {
  mappingId: number
  mappingType: StripeDirectMappingType
  /** Reassigned payments only: the cancelled order and its invoice, kept as audit evidence. */
  originalOrderId?: string | null
  originalOrderNumber?: string | null
  originalOrderStatus?: string | null
  originalInvoiceId?: string | null
  originalInvoiceNumber?: string | null
  status: 'ACTIVE' | 'RELEASED'
  paymentIntentId: string
  chargeId: string | null
  zohoInvoiceId: string
  invoiceNumber: string
  zohoCustomerId: string
  customerKey: 'WEBSITE' | 'SHOP'
  invoiceReference: string | null
  stripeGross: number
  evidence: string | null
  reason: string
  firstPayoutId: string
  mappedBy: string
  mappedAt: string | null
  /** False once any accounting exists for the payout customer. */
  removable: boolean
  lockedReason: string | null
}

export interface StripePaymentEvidence {
  paymentIntentId: string
  chargeId: string | null
  status?: string
  description: string | null
  chargeDescription: string | null
  statementDescriptor?: string | null
  metadata: Record<string, string>
  createdAt: string | null
  /** Checkout Session / Payment Link texts are optional; absent on older previews. */
  checkoutEvidence?: StripeCheckoutEvidence
  sessions: Array<{
    checkoutSessionId: string
    paymentLinkId: string | null
    clientReferenceId: string | null
    metadata: Record<string, string>
    products: Array<{ productName: string | null; productDescription: string | null; lineDescription: string | null; amountMinor: number; quantity: number }>
  }>
}

export type StripeCheckoutEvidence = 'AVAILABLE' | 'UNAVAILABLE_PERMISSION' | 'UNAVAILABLE_ERROR'

export interface StripeEvidenceReference {
  kind: 'reference' | 'invoiceNumber'
  value: string
  sources: Array<{ source: string; text: string }>
}

export interface StripeDirectCandidate {
  invoiceId: string
  invoiceNumber: string
  referenceNumber: string
  customerId: string
  customerName: string | null
  date: string
  total: number
  balance: number
  status: string
  fits: boolean
}

export interface StripeDirectSuggestion {
  status: 'SUGGESTED' | 'NEEDS_REVIEW' | 'NONE'
  reason: string
  invoiceId?: string
  candidates: StripeDirectCandidate[]
}

/** A charge that belongs to no customer group yet. */
export interface StripeUnassignedLine extends StripePayoutLine {
  /** Which mapping "Assign to Zoho Invoice" would create; null when none is allowed. */
  mappingType?: StripeDirectMappingType | null
  directEligible?: boolean
  directIneligibleReason?: string | null
  originalInvoices?: StripeOriginalInvoice[]
  stripeEvidence?: StripePaymentEvidence | null
  references?: StripeEvidenceReference[]
  suggestion?: StripeDirectSuggestion | null
  evidenceError?: string | null
}

export interface StripePayoutAllocation {
  invoiceId: string
  invoiceNumber: string
  orderNumber: string | null
  paymentIntentId: string | null
  source?: StripeLineSource
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
  local: StripeComponentLocal | null
  recovery: { action: StripeRecoveryAction; reason: string }
}

/** Local posting record of one component, including uncertain-write recovery history. */
export interface StripeComponentLocal {
  id: string
  status: string
  zohoRecordId: string | null
  zohoJournalId?: string | null
  attemptCount: number
  lastError: string | null
  postedAt: string | null
  verifiedAt: string | null
  firstUncertainAt?: string | null
  uncertainSince?: string | null
  lastRecoveryCheckAt?: string | null
  recoveryCheckCount?: number
  retryAuthorizedAt?: string | null
  retryAuthorizedBy?: string | null
  retryAuthorizationReason?: string | null
}

export type StripeUncertainScope = 'component' | 'refund-component'

/** A Zoho write whose result is unknown: Zoho may hold the record, so it must not be reposted. */
export interface StripeUncertainComponent {
  scope: StripeUncertainScope
  componentId: string
  component: StripePayoutComponentKind
  zohoRecordType: string
  customerId: string | null
  refundId: string | null
  creditNoteId: string | null
  reference: string
  amount: number
  /** POSTING = an attempt was interrupted; POSTING_UNCERTAIN = the response was uncertain. */
  status: 'POSTING_UNCERTAIN' | 'POSTING'
  attemptCount: number
  lastError: string | null
  firstUncertainAt: string | null
  uncertainSince: string | null
  lastRecoveryCheckAt: string | null
  recoveryCheckCount: number
  confirmAvailableAt: string | null
  canConfirm: boolean
  confirmBlockedReason: string | null
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

export interface StripeLegacyFeeJournal {
  journalId: string
  entryNumber: string | null
  journalDate: string
  referenceNumber: string
  total: number
  how: 'TOTAL_LINE' | 'CUSTOMER_FEE_LINES'
  matchedLines: number[]
}

/** One payout-level journal: Dr Stripe Fees (2270) / Cr 1013 for the payout's total Stripe fees. */
export interface StripePayoutFeeJournal {
  component: 'PAYOUT_FEE_JOURNAL'
  status: StripeFeeJournalStatus
  reasons: string[]
  postable: boolean
  tracked: boolean
  /** Journal amount: the absolute value of the signed Stripe fee total. */
  amount: number
  /** Signed Stripe fee total (negative when refunds returned more fees than were charged). */
  signedAmount?: number
  /** FEE_EXPENSE: Dr 2270 / Cr 1013; FEE_REVERSAL: Dr 1013 / Cr 2270; null: no journal (zero net fee). */
  direction?: 'FEE_EXPENSE' | 'FEE_REVERSAL' | null
  stripeFeeTotal: number
  verifiedFeeTotal: number
  feeComponents: Array<{ customerId: string; customerName: string; amount: number; zohoState: 'MISSING' | 'VERIFIED' | 'CONFLICT'; zohoRecordId: string | null }>
  /** Stripe fee changes carried by normal refunds (negative: fee returned). Absent from older previews. */
  refundFeeAdjustments?: Array<{ refundId: string; fee: number; zohoState: 'MISSING' | 'VERIFIED' | 'CONFLICT'; zohoRecordId: string | null }>
  reference: string
  date: string | null
  /** Null when the net fee is zero (no journal). */
  debitAccountId: string | null
  creditAccountId: string | null
  debitAccount: StripeZohoAccount | null
  creditAccount: StripeZohoAccount | null
  accountProblems: string[]
  payload: Record<string, unknown> | null
  zoho: StripePayoutComponent['zoho']
  legacy: {
    state: 'MATCHED' | 'NONE' | 'AMBIGUOUS' | 'ERROR'
    reason: string
    window: { start: string; end: string }
    candidatesChecked: number
    journals: StripeLegacyFeeJournal[]
  } | null
  local: StripePayoutComponent['local']
  recovery: { action: StripeRecoveryAction; reason: string }
  /** Sent back when posting; the server refuses if the live plan no longer matches. */
  postingFingerprint: string
}

export interface StripePayoutReconciliation {
  netTo1019: number
  customerAdvances: number
  total1019: number
  advanceRefundsOutOf1019: number
  normalRefundsGross?: number
  normalRefundFeeAdjustments?: number
  normalRefundsNetOutOf1019?: number
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
  /** Dr 1123 / Cr 1019 refund journal as found in Zoho (matched refunds only). */
  refundJournal?: { reference: string; state: 'MISSING' | 'VERIFIED' | 'CONFLICT'; recordId: string | null; reason: string | null }
  posting: { allowed: boolean; blockers: string[] }
  proposedJournal: { amount: number; reference: string; payload: Record<string, unknown> } | null
}

export interface StripeCreditNoteRefundRecord {
  creditNoteRefundId: string
  date: string | null
  referenceNumber: string | null
  amount: number
  fromAccountId: string | null
  fromAccountName: string | null
}

export interface StripeRefundCreditNote {
  creditNoteId: string
  creditNoteNumber: string
  status: string
  date: string | null
  total: number
  balance: number
  invoiceId: string | null
  invoiceNumber: string | null
  salesReturnNumber: string | null
  customerId: string | null
  refunds: StripeCreditNoteRefundRecord[]
  matchedBy: string | null
}

export interface StripeReturnedItem {
  name: string | null
  sku: string | null
  itemId: string | null
  quantity: number
  rate: number
  total: number
  invoiceLineItemId: string
  linkedBy: 'INVOICE_LINE' | 'INVOICE_ITEM'
}

export interface StripeRefundComponent {
  component: 'REFUND_CREDIT_NOTE_REFUND' | 'REFUND_FEE_ADJUSTMENT'
  zohoRecordType: 'creditnote_refund' | 'journal'
  amount: number
  currency: string
  reference: string
  date: string | null
  creditNoteId: string
  creditNoteNumber?: string
  direction?: 'FEE_RETURNED' | 'FEE_CHARGED'
  depositAccountId: string | null
  debitAccountId: string | null
  creditAccountId: string | null
  payload: Record<string, unknown>
  zoho: StripePayoutComponent['zoho']
  local: StripePayoutComponent['local']
  recovery: { action: StripeRecoveryAction; reason: string }
}

/** A refund of a normal invoiced website sale: Zoho credit note → refund from 1019. */
export interface StripeNormalRefund {
  refundId: string | null
  balanceTransactionId: string
  chargeId: string | null
  paymentIntentId: string | null
  currency: string
  stripeRefundStatus: string | null
  gross: number
  stripeFee: number
  /** Positive: Stripe returned part of its fee; negative: Stripe charged an extra fee. */
  feeAdjustment: number
  net: number
  reference: string
  kind: 'PARTIAL_REFUND' | 'FULL_REFUND' | null
  sequence: number | null
  refundCount: number | null
  chargeGross: number | null
  priorRefunded: number | null
  cumulativeRefunded: number | null
  remainingRefundable: number | null
  website: { orderId: string; orderNumber: string; finalAmount: number; shopOrder: boolean; orderStatus: string | null; paymentStatus: string | null } | null
  invoice: { invoiceId: string; invoiceNumber: string; total: number; balance: number; status: string; customerId: string } | null
  customerId: string | null
  customerName: string | null
  creditNote: StripeRefundCreditNote | null
  creditNoteCandidates: StripeRefundCreditNote[]
  returnedItems: StripeReturnedItem[]
  itemsProven: boolean
  itemsReason: string | null
  legacyRefund: { creditNoteRefundId: string; referenceNumber: string | null; amount: number; date: string | null; fromAccountId: string | null } | null
  clearingImpact: { stripeUndepositedFunds: number; processingChargesUncleared: number }
  components: StripeRefundComponent[]
  status: StripeNormalRefundStatus
  reasonCode: string | null
  reason: string
  reasons: string[]
  tracked: boolean
  postable: boolean
  /** Sent back when posting; the server refuses if the live plan no longer matches. */
  postingFingerprint: string | null
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
  payout: {
    payoutId: string
    status: string
    amount: number
    currency: string
    arrivalDate: string | null
    /** Stripe arrival as an Asia/Dubai day; source information only, never a Zoho date. */
    arrivalDay?: string | null
    createdAt: string | null
  }
  status: StripePayoutStatus
  blockers: string[]
  /** Absent from previews produced before uncertain-write recovery existed. */
  uncertainComponents?: StripeUncertainComponent[]
  /** Date every new Zoho record gets: today in Asia/Dubai on the server when the preview ran. */
  zohoPostingDate?: string | null
  /** Same as zohoPostingDate (kept for older clients). */
  proposedPaymentDate: string | null
  accounts: {
    net: StripeZohoAccount | null
    fee: StripeZohoAccount | null
    advance: StripeZohoAccount | null
    feeExpense?: StripeZohoAccount | null
    problems: string[]
  }
  composition: StripePayoutComposition
  reconciliation: StripePayoutReconciliation
  customersPresent: string[]
  groups: StripePayoutGroup[]
  /** Absent only from previews produced before the fee journal step existed. */
  feeJournal?: StripePayoutFeeJournal
  unassigned: StripeUnassignedLine[]
  directMappings?: StripeDirectMapping[]
  advanceCaseEvents: StripeAdvanceCaseEvent[]
  advanceRefunds: StripeAdvanceRefund[]
  /** Absent from previews produced before normal refunds were handled. */
  normalRefunds?: StripeNormalRefund[]
  /** Normal refund problems: they keep the payout from FULLY_CLEARED but never block sale posting. */
  refundBlockers?: string[]
  otherTransactions: StripeOtherTransaction[]
  warnings: string[]
}

export interface StripeAdvanceConfirmResult {
  alreadyConfirmed: boolean
  caseId?: string | null
  zohoWrites: 0
}

export interface StripePayoutList {
  rows: StripePayoutSummary[]
  refreshedAt: string | null
  count: number
  maxRows: number
  source: 'cache' | 'stripe'
}

/** Cached payout list from the server database; does not call Stripe. */
export function getStripePayouts() {
  return api.get('/api/stripe/payouts') as Promise<StripePayoutList>
}

/** Re-reads the latest payouts from Stripe (read-only) and replaces the server cache. */
export function refreshStripePayouts() {
  return api.post('/api/stripe/payouts/refresh', {}) as Promise<StripePayoutList>
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

export type StripeDirectSearchBy = 'auto' | 'invoice' | 'reference' | 'amount'
export type StripeDirectCustomer = 'all' | 'website' | 'shop'

export interface StripeDirectInvoice {
  invoiceId: string
  invoiceNumber: string
  referenceNumber: string
  customerId: string
  customerName: string
  customerKey: 'WEBSITE' | 'SHOP' | null
  date: string
  total: number
  balance: number
  status: string
  currencyCode: string
  selectable: boolean
  notSelectableReasons: string[]
}

export interface StripeDirectSearchResult {
  mode: Exclude<StripeDirectSearchBy, 'auto'>
  query: string
  invoices: StripeDirectInvoice[]
  zohoWrites: 0
}

export interface StripeDirectCheck {
  key: string
  label: string
  ok: boolean
  blocking: boolean
  detail: string
}

export interface StripeDirectValidation {
  payoutId: string
  paymentIntentId: string
  chargeId: string | null
  mappingType?: StripeDirectMappingType
  originalOrder?: Omit<StripeReassignOrigin, 'zohoCustomerId' | 'refundedThroughStripe'> | null
  originalInvoices?: StripeOriginalInvoice[]
  stripe: { gross: number; fee: number; net: number; currency: string; createdAt: string | null; description: string | null }
  stripeEvidence: StripePaymentEvidence | null
  checkoutEvidence?: StripeCheckoutEvidence
  references: StripeEvidenceReference[]
  invoice: (Omit<StripeDirectInvoice, 'selectable' | 'notSelectableReasons' | 'customerName'> & { customerName: string | null }) | null
  websiteOrdersWithReference: Array<{ orderNumber: string; orderStatus: string; paymentStatus: string; paymentMethod: string; hasStripePaymentIntent: boolean; deleted: boolean }>
  checks: StripeDirectCheck[]
  blocking: boolean
  evidenceStatus: 'MATCH' | 'CONFLICT' | 'NONE'
  evidenceSummary: string | null
  requiresTypedInvoiceNumber: boolean
  zohoWrites: 0
}

export interface StripeDirectMappingResult {
  mapping: { id: number; zohoInvoiceNumber: string; status: string }
  zohoWrites: 0
  stripeWrites: 0
}

const directPath = (payoutId: string, paymentIntentId: string) =>
  `/api/stripe/payouts/${encodeURIComponent(payoutId)}/direct-payments/${encodeURIComponent(paymentIntentId)}`

/** Read-only Zoho invoice search (invoice number, P.O.# or amount) within the Stripe-clearing customers. */
export function searchStripeDirectInvoices(q: string, by: StripeDirectSearchBy, customer: StripeDirectCustomer) {
  const params = new URLSearchParams({ q, by, customer })
  return api.get(`/api/stripe/direct-payments/invoices?${params.toString()}`) as Promise<StripeDirectSearchResult>
}

/** Read-only: every check for mapping one charge to one invoice. */
export function validateStripeDirectPayment(payoutId: string, paymentIntentId: string, invoiceId: string) {
  const params = new URLSearchParams({ invoiceId })
  return api.get(`${directPath(payoutId, paymentIntentId)}/validate?${params.toString()}`) as Promise<StripeDirectValidation>
}

/** Local mapping only; nothing is sent to Zoho or Stripe. */
export function confirmStripeDirectPayment(payoutId: string, paymentIntentId: string, body: { invoiceId: string; reason: string; confirmInvoiceNumber?: string }) {
  return api.post(`${directPath(payoutId, paymentIntentId)}/confirm`, body) as Promise<StripeDirectMappingResult>
}

/** Local only; refused once any accounting exists for the payout customer. */
export function releaseStripeDirectPayment(payoutId: string, paymentIntentId: string, reason: string) {
  return api.post(`${directPath(payoutId, paymentIntentId)}/release`, { reason }) as Promise<StripeDirectMappingResult>
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
  outcome: 'POSTED' | 'PARTIALLY_POSTED' | 'NEEDS_REVIEW' | 'POSTING_UNCERTAIN' | 'NOT_POSTED'
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

export interface StripePayoutFeeJournalPostResult {
  outcome: 'VERIFIED' | 'NEEDS_REVIEW' | 'POSTING_UNCERTAIN' | 'POSTED_UNVERIFIED' | 'NOT_POSTED'
  alreadyPosted: boolean
  payoutId: string
  amount: number | null
  reference: string | null
  component: StripePayoutPostComponentResult
  zohoRequests: number
}

/** Creates the one payout-level Stripe fee journal in Zoho (after every customer group is verified). */
export function postStripePayoutFeeJournal(payoutId: string, fingerprint: string) {
  return api.post(`/api/stripe/payouts/${encodeURIComponent(payoutId)}/fee-journal/post`, {
    fingerprint,
  }) as Promise<StripePayoutFeeJournalPostResult>
}

export interface StripePayoutRefundPostResult {
  outcome: StripeNormalRefundStatus | 'NOT_POSTED'
  alreadyPosted: boolean
  payoutId: string
  refundId: string
  amount: number
  creditNoteNumber: string | null
  components: StripePayoutPostComponentResult[]
  notAttempted?: StripeRefundComponent['component'][]
  zohoRequests: number
}

/** Refunds the existing Zoho credit note from Stripe Undeposited Funds (plus any fee adjustment journal). */
export function postStripePayoutRefund(payoutId: string, refundId: string, fingerprint: string) {
  return api.post(`/api/stripe/payouts/${encodeURIComponent(payoutId)}/refunds/${encodeURIComponent(refundId)}/post`, {
    fingerprint,
  }) as Promise<StripePayoutRefundPostResult>
}

export interface StripeUncertainResolution {
  payoutId: string
  scope: StripeUncertainScope
  componentId: string
  outcome: 'VERIFIED' | 'NEEDS_REVIEW' | 'POSTING_UNCERTAIN' | 'FAILED'
  component: StripePayoutPostComponentResult & { retryAllowed?: boolean }
  zohoWrites: 0
}

const uncertainPath = (payoutId: string, scope: StripeUncertainScope, componentId: string) =>
  `/api/stripe/payouts/${encodeURIComponent(payoutId)}/uncertain/${encodeURIComponent(scope)}/${encodeURIComponent(componentId)}`

/** Read-only: searches Zoho again for an uncertain write. Never posts. */
export function recheckStripeUncertainComponent(payoutId: string, scope: StripeUncertainScope, componentId: string) {
  return api.post(`${uncertainPath(payoutId, scope, componentId)}/recheck`, {}) as Promise<StripeUncertainResolution>
}

/** The admin's own Zoho check, recorded with the retry authorization. */
export interface StripeUncertainVerification {
  /** ISO time of the check; must be after the settle window. */
  checkedAt: string
  /** Where in Zoho the admin searched. */
  zohoLocation: string
  /** What was searched for; must include the attempt's reference. */
  searchedFor: string
  recordsFound: 0
}

/** Admin confirms Zoho holds no such record; allows one later retry. Never posts. */
export function confirmStripeUncertainNotCreated(
  payoutId: string,
  scope: StripeUncertainScope,
  componentId: string,
  reason: string,
  verification: StripeUncertainVerification,
) {
  return api.post(`${uncertainPath(payoutId, scope, componentId)}/confirm-not-created`, {
    reason,
    acknowledged: true,
    verification,
  }) as Promise<StripeUncertainResolution>
}

export function getStripeStatus() {
  return api.get('/api/stripe/status') as Promise<StripeConnectionStatus>
}

export function testStripeConnection() {
  return api.post('/api/stripe/connection-test', {}) as Promise<StripeConnectionTestResult>
}
