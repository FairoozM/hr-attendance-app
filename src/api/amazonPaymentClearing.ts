import { api } from './client'

export interface SettlementReport {
  reportId: string
  reportDocumentId: string
  reportType: string
  processingStatus: string
  createdTime: string
  processingEndTime: string
  dataStartTime: string
  dataEndTime: string
}

export interface ClearingTotals {
  amazonSettlementTotal: number
  productSalesTotal: number
  feesTotal: number
  orderLevelFeesTotal: number
  settlementLevelFeesTotal: number
  refundsTotal: number
  returnsTotal?: number
  refundReturnTotal?: number
  adjustmentsTotal: number
  matchedInvoiceTotal: number
  unmatchedOrderTotal: number
  difference: number
}

export interface ClearingPivotRow {
  category: string
  count: number
  total: number
}

export interface OrderFeeBreakdown {
  principalTotal: number
  shippingCollectedTotal: number
  commissionTotal: number
  fulfillmentFeeTotal: number
  closingFeeTotal: number
  shippingPromotionTotal: number
  refundTotal: number
  otherAmazonFeeTotal: number
  amazonOrderTotal: number
  grossAmazonTotal: number
  totalFees: number
  netSettlementAmount: number
}

export interface ReconciliationSummary {
  orderLevelNetBalance: number
  refundReturnImpact?: number
  settlementLevelDeductions: number
  advertisingFeeTotal: number
  premiumServiceFeeTotal: number
  premiumServiceFeeTaxTotal: number
  storageFeeTotal: number
  easyShipChargesTotal: number
  otherSettlementFeeTotal: number
  expectedAmazonDeposit: number
  actualAmazonSettlement: number
  reconciliationDifference: number
  reconciliationStatus: 'reconciled' | 'mismatch'
}

export interface MatchedOrder extends OrderFeeBreakdown {
  orderId: string
  zohoInvoiceId: string
  zohoInvoiceNumber: string
  zohoPoNumber?: string
  zohoCustomerId?: string
  zohoCustomerName: string
  zohoInvoiceTotal: number
  feesTotal: number
  netAmount: number
  status: 'matched'
  matchType: 'po_number' | 'invoice_number_fallback'
}

export interface NetNegativeReturnOrder extends OrderFeeBreakdown {
  orderId: string
  zohoInvoiceId?: string
  zohoInvoiceNumber?: string
  zohoPoNumber?: string
  zohoCustomerId?: string
  zohoCustomerName?: string
  zohoInvoiceTotal?: number
  matchType?: 'po_number' | 'invoice_number_fallback'
  status: 'net_negative_return'
  requiresCreditNote?: boolean
  settlementDerivedReturn?: boolean
  reason?: string
}

export interface UnmatchedOrder extends OrderFeeBreakdown {
  orderId: string
  feesTotal: number
  netAmount: number
  status: 'unmatched'
  reason: string
}

export interface RefundReturnCreditNoteRow {
  rowClass: 'refund' | 'return'
  category: string
  orderId: string
  amazonRefundAmount: number
  transactionType: string
  amountType: string
  amountDescription: string
  zohoInvoiceId?: string
  zohoInvoiceNumber?: string
  zohoPoNumber?: string
  zohoCustomerId?: string
  zohoCustomerName?: string
  zohoCreditNoteId?: string
  zohoCreditNoteNumber?: string
  creditNoteAmount?: number
  creditNoteStatus?: string
  creditNoteDifference?: number
  status: 'matched' | 'blocked' | 'ready_to_create'
  creditNoteAction?: 'matched_existing' | 'ready_to_create' | 'blocked'
  blockingReason?: string
  candidateInvoiceNumbers?: string[]
  candidateCreditNoteNumbers?: string[]
}

export interface AdjustmentClearingRow {
  orderId?: string
  amountType?: string
  amountDescription?: string
  amount: number
  category?: string
  rowClass?: string
}

export type ParsedRowStatus =
  | 'ok'
  | 'matched'
  | 'unmatched'
  | 'missing_order_id'
  | 'account_level_fee'
  | 'blocked'
  | 'review'
  | 'unknown'

export interface ParsedSettlementRow {
  rowNumber: number
  category: string
  rowClass: string
  orderId: string
  amount: number
  currency: string
  settlementDate: string
  transactionType: string
  amountType: string
  amountDescription: string
  status: ParsedRowStatus
  blockingReason: string
}

export interface AmazonFeeJournalMapping {
  key: string
  classification: 'NON_ORDER_LINKED_AMAZON_FEE'
  marketplace: string
  feeType: string
  normalizedFeeType: string
  rawTransactionType: string
  description: string
  rowCount: number
  totalAmount: number
  rowNumbers: number[]
  debitAccountName: string
  debitAccountId?: string
  creditAccountName: string
  creditAccountId?: string
  mappingRuleId?: number | null
  mappingRuleUsed?: AmazonFeeJournalMappingRule | null
  lastUsedAt?: string | null
  mappingStatus: AmazonFeeJournalMappingStatus
  journalPreview: {
    referenceNumber: string
    notes: string
    debit: { accountId?: string; accountName: string; amount: number }
    credit: { accountId?: string; accountName: string; amount: number }
  }
}

export type AmazonFeeJournalMappingStatus =
  | 'mapped'
  | 'needs_mapping'
  | 'not_required'
  | 'suspense_mapping_used'
  | 'inactive_mapping'

export interface AmazonFeeJournalMappingRule {
  id: number
  marketplace: string
  normalizedFeeType: string
  rawTransactionType: string
  descriptionPattern: string
  debitAccountName: string
  debitAccountId: string
  creditAccountName: string
  creditAccountId: string
  isActive: boolean
  priority: number
  createdBy?: number | null
  updatedBy?: number | null
  createdAt?: string | null
  updatedAt?: string | null
  lastUsedAt?: string | null
}

export interface ZohoChartAccount {
  accountId: string
  accountName: string
  accountCode: string
  accountType: string
  isActive: boolean
}

export type BlockingIssueCode =
  | 'MISSING_ORDER_ID'
  | 'UNMATCHED_SALES'
  | 'MISSING_CREDIT_NOTE'
  | 'CREDIT_NOTE_DIFF'
  | 'SETTLEMENT_MISMATCH'
  | 'UNKNOWN_ROWS'

export interface BlockingIssue {
  code: BlockingIssueCode
  label: string
  count: number
  rowNumbers: number[]
  orderIds: string[]
}

export interface AmountDifferenceRow {
  orderId: string
  zohoInvoiceNumber: string
  zohoInvoiceId: string
  amazonOrderTotal: number
  zohoInvoiceTotal: number
  difference: number
}

export interface SettlementReference {
  marketplace: string
  settlementId: string
  reportId: string
  startDate: string
  endDate: string
  startDisplay: string
  endDisplay: string
  periodText: string
  referenceBase: string
  batchId: number | null
}

export interface PostingReference {
  paymentType: string
  entryLabel: string
  amount: number
  depositToAccountCode: string
  depositToAccountName: string
  referenceNumber: string
  description: string
}

export interface ClearingPosting {
  id: number
  batchId: number
  invoiceId: string
  orderId: string
  paymentType: string
  postingGroupKey: string
  zohoPaymentId: string
  amount: number
  accountCode: string
  invoiceAllocations: Array<{ invoiceId: string; invoiceNumber: string; orderId: string; amountApplied: number }>
  referenceNumber: string
  description: string
  zohoJournalNumber?: string
  notes?: string
  mappingSnapshot?: Record<string, unknown>
  status: string
  errorMessage: string
  createdAt: string | null
}

export interface PostingSummary {
  invoicesPosted?: number
  paymentsCreated?: number
  paymentsSkipped?: number
  journalsCreated?: number
  journalsSkipped?: number
  errors?: number
  forceRepost?: boolean
  postedAt?: string
  reference?: string
  settlementReference?: SettlementReference
  zohoPaymentIds?: Array<{ paymentType: string; zohoPaymentId: string; referenceNumber?: string }>
  zohoJournalIds?: Array<{
    paymentType: string
    zohoJournalId: string
    zohoJournalNumber?: string
    referenceNumber?: string
    notes?: string
  }>
}

export interface ClearingAuditEntry {
  id: number
  batchId: number
  action: string
  reason: string
  actorUserId: number | null
  previousZohoPaymentIds: string[]
  details: Record<string, unknown>
  createdAt: string | null
}

export type LifecycleStatus =
  | 'draft'
  | 'ready_for_review'
  | 'ready_to_post'
  | 'approved'
  | 'posted'

export interface SavedBatchSummary {
  batchId: number
  marketplace: string
  reportId: string
  reportDocumentId: string
  settlementId: string
  settlementStartDate: string
  settlementEndDate: string
  depositDate: string
  currency: string
  status: string
  lifecycleStatus: LifecycleStatus
  postedToZoho: boolean
  amazonSettlementTotal: number
  matchedOrderCount: number
  unmatchedOrderCount: number
  creditNoteBlockerCount: number
  reconciliationStatus: string
  zohoCustomerId?: string
  zohoCustomerName?: string
  postingReference?: string
  createdAt: string | null
  approvedAt: string | null
  postedAt: string | null
}

export interface KsaZohoCustomerOption {
  name: string
  label: string
  customerId: string
  available: boolean
}

export interface PaymentClearingPreview {
  success: boolean
  batch?: {
    batchId: number
    status: string
    lifecycleStatus?: LifecycleStatus
    createdAt: string
    approvedBy?: number | null
    approvedAt?: string | null
    postedBy?: number | null
    postedAt?: string | null
    postedToZoho?: boolean
    postingSummary?: PostingSummary
    settlementReference?: SettlementReference
    postingReference?: string
    zohoCustomerId?: string
    zohoCustomerName?: string
  }
  zohoCustomerId?: string
  zohoCustomerName?: string
  status?: string
  lifecycleStatus?: LifecycleStatus
  approvedBy?: number | null
  approvedAt?: string | null
  postedBy?: number | null
  postedAt?: string | null
  postedToZoho?: boolean
  postingSummary?: PostingSummary
  settlementReference?: SettlementReference
  postingReference?: string
  postings?: ClearingPosting[]
  fromCache?: boolean
  rematchedZoho?: boolean
  refreshedFromAmazon?: boolean
  refreshedFromUpload?: boolean
  fromUpload?: boolean
  auditLog?: ClearingAuditEntry[]
  storedRowCount?: number
  message?: string
  marketplace: 'KSA' | 'UAE'
  report: {
    reportId: string
    reportDocumentId: string
    settlementId: string
    settlementStartDate: string
    settlementEndDate: string
    depositDate: string
    currency: string
  }
  totals: ClearingTotals
  pivot: ClearingPivotRow[]
  settlementLevelFees: ClearingPivotRow[]
  nonOrderLinkedAmazonFeeMappings?: AmazonFeeJournalMapping[]
  refundReturnRows?: AdjustmentClearingRow[]
  matchedReturns?: RefundReturnCreditNoteRow[]
  missingCreditNotes?: RefundReturnCreditNoteRow[]
  creditNoteBlockingRows?: RefundReturnCreditNoteRow[]
  adjustmentRows?: AdjustmentClearingRow[]
  reconciliationSummary: ReconciliationSummary
  matchedOrders: MatchedOrder[]
  unmatchedOrders: UnmatchedOrder[]
  netNegativeReturnOrders?: NetNegativeReturnOrder[]
  allRows?: ParsedSettlementRow[]
  blockingIssues?: BlockingIssue[]
  amountDifferences?: AmountDifferenceRow[]
  warnings: string[]
  rawRowCount: number
  duplicateZohoInvoiceNumbers?: string[]
  duplicateZohoPoNumbers?: string[]
  unmatchedOrderIds?: string[]
  missingOrderIdRows?: AdjustmentClearingRow[]
  paymentPreview?: PaymentClearingPaymentPreview | null
}

export interface PaymentPreviewAccount {
  amount: number
  depositToAccountCode: string
  depositToAccountName: string
}

export interface PaymentPreviewRow {
  orderId: string
  zohoInvoiceId: string
  zohoInvoiceNumber: string
  zohoPoNumber: string
  customerId: string
  customerName: string
  invoiceTotal: number
  shippingOffsetTotal: number
  invoiceClearingNetBalance: number
  netBalancePayment: PaymentPreviewAccount
  commissionPayment: PaymentPreviewAccount
  shippingFbaPayment: PaymentPreviewAccount
  totalClearingAmount: number
  remainingDifference: number
  status: 'ready' | 'ready_fx_adjustment' | 'mismatch'
}

export interface PaymentPreviewSummary {
  invoiceCount: number
  paymentEntryCount: number
  netBalanceTotal: number
  commissionClearingTotal: number
  shippingFbaClearingTotal: number
  totalPaymentAmount: number
  zohoInvoiceTotal: number
  refundReturnCreditNoteApplicationTotal?: number
  adjustmentClearingTotal?: number
  amazonFeeJournalTotal?: number
  difference: number
}

export interface RefundReturnCreditNoteApplication {
  orderId: string
  zohoInvoiceId: string
  zohoInvoiceNumber: string
  zohoCreditNoteId: string
  zohoCreditNoteNumber: string
  amazonRefundAmount: number
  creditNoteAmount: number
  difference: number
  status: string
  blockingReason?: string
}

export interface PaymentPreviewAdjustmentClearing {
  key: string
  orderId: string
  amountType: string
  amountDescription: string
  amount: number
  originalAmount: number
  status: string
}

export interface AmazonFeeJournalLine {
  key: string
  classification: 'NON_ORDER_LINKED_AMAZON_FEE'
  marketplace?: string
  feeType: string
  normalizedFeeType?: string
  rawTransactionType: string
  description: string
  rowCount: number
  totalAmount: number
  mappingStatus: AmazonFeeJournalMappingStatus
  rowNumbers: number[]
  debit: { accountId?: string; accountName: string; amount: number }
  credit: { accountId?: string; accountName: string; amount: number }
  referenceNumber: string
  notes: string
  mappingRuleId?: number | null
  mappingRuleUsed?: AmazonFeeJournalMappingRule | null
  lastUsedAt?: string | null
  status: 'ready' | 'needs_mapping'
}

export interface PaymentClearingPaymentPreview {
  success: boolean
  batchId: number
  paymentPreviewId?: number
  createdAt?: string | null
  status: string
  paymentPlanSummary: PaymentPreviewSummary
  payments: PaymentPreviewRow[]
  refundReturnCreditNoteApplications?: RefundReturnCreditNoteApplication[]
  adjustmentClearings?: PaymentPreviewAdjustmentClearing[]
  amazonFeeJournalLines?: AmazonFeeJournalLine[]
  settlementReference?: SettlementReference
  postingReferences?: PostingReference[]
  warnings: string[]
}

export interface CreditNoteLocalPosting {
  postingId: number
  paymentType: string
  status: string
  zohoId: string
  errorMessage: string
}

export interface CreditNoteApplyPlanRow {
  orderId: string
  action:
    | 'skipped_already_refunded'
    | 'skipped_already_applied'
    | 'skipped_already_posted'
    | 'refund_existing'
    | 'apply_existing'
    | 'create_and_refund'
    | 'create_and_apply'
    | 'blocked'
    | 'moved_to_not_received'
  status: string
  applyAmount: number
  refundAmount?: number
  amazonRefundAmount?: number
  creditNoteAmount?: number
  amountAlreadyRefunded?: number
  amountAlreadyApplied?: number
  refundAccountCode?: string
  refundAccountName?: string
  refundAccountId?: string
  zohoInvoiceId?: string
  zohoInvoiceNumber?: string
  zohoCreditNoteId?: string
  zohoCreditNoteNumber?: string
  blockingReason?: string
  error?: string
  localCreate?: CreditNoteLocalPosting | null
  localRefund?: CreditNoteLocalPosting | null
}

export interface CreditNoteApplyPlan {
  success?: boolean
  batchId: number
  rows: CreditNoteApplyPlanRow[]
  summary: {
    totalRows: number
    skippedAlreadyRefunded?: number
    skippedAlreadyApplied?: number
    refundExisting?: number
    applyExisting?: number
    createAndRefund?: number
    createAndApply?: number
    blocked: number
    movedToNotReceived?: number
    completed: number
    verificationRequired?: number
    isComplete?: boolean
  }
  newlyFoundCreditNotes?: NewlyFoundCreditNote[]
  returnDispositions?: ReturnDisposition[]
  /** When this server last re-read the credit notes from Zoho (null until "Refresh credit notes from Zoho"). */
  liveRefreshedAt?: string | null
}

export interface NewlyFoundCreditNote {
  orderId: string
  zohoCreditNoteId: string
  zohoCreditNoteNumber: string
}

export interface ReturnDisposition {
  orderId: string
  disposition: 'not_received'
  amount: number
  reason: string
  zohoInvoiceNumber?: string
  markedBy?: number | null
  markedAt?: string | null
}

export interface RefreshReturnCreditNotesResult extends CreditNoteApplyPlan {
  stillMissing: { orderId: string; amazonRefundAmount?: number; zohoInvoiceNumber?: string }[]
}

export interface ReturnDispositionsResult {
  success: boolean
  disposition?: ReturnDisposition
  returnDispositions: ReturnDisposition[]
}

export interface JournalAccountRef {
  accountCode?: string
  accountName?: string
  accountId?: string
  amount?: number
}

export interface NotReceivedReturnOrder {
  orderId: string
  amount: number
  reason: string
  zohoInvoiceNumber: string
  markedBy: number | null
  markedAt: string | null
}

export interface NotReceivedJournalLine {
  key: string
  paymentType: string
  feeType: string
  amount: number
  orderIds: string[]
  debit: JournalAccountRef
  credit: JournalAccountRef
  referenceNumber: string
  notes: string
  status: 'ready' | 'needs_mapping'
  blockingReason: string
}

export interface NotReceivedPlan {
  success?: boolean
  batchId: number
  marketplace: string
  currency: string
  orders: NotReceivedReturnOrder[]
  line: NotReceivedJournalLine | null
  summary: { orderCount: number; total: number }
  posting: {
    id: number
    status: string
    zohoJournalId: string
    zohoJournalNumber: string
    error: string
  } | null
  notReceivedPostComplete: boolean
}

export interface UnclearedClearingLineItem extends JournalAccountRef {
  debitOrCredit: 'debit' | 'credit'
  amount: number
  description?: string
}

export interface UnclearedClearingMovement {
  paymentType: string
  referenceNumber: string
  zohoId: string
  zohoNumber: string
  amount: number
}

export interface UnclearedClearingLine {
  key: string
  paymentType: string
  feeType: string
  normalizedFeeType: string
  role: 'COMMISSION' | 'SHIPPING_FBA'
  direction: 'to_expense' | 'from_expense'
  amount: number
  grossAmount: number
  netAmount: number
  vatAmount: number
  vatRate: number
  lineItems: UnclearedClearingLineItem[]
  movements: UnclearedClearingMovement[]
  referenceNumber: string
  notes: string
  status: 'ready' | 'needs_mapping'
  blockingReason: string
  posting: {
    id: number
    status: string
    zohoJournalId: string
    zohoJournalNumber: string
    error: string
  } | null
}

export interface UnclearedClearingPlan {
  success?: boolean
  batchId: number
  marketplace: string
  currency: string
  vatRate: number
  lines: UnclearedClearingLine[]
  summary: { grossTotal: number; netTotal: number; vatTotal: number; needsMappingCount: number }
  readiness: { ok: boolean; message: string }
  unclearedClearingComplete: boolean
}

export interface CreditNoteApplyResult {
  success: boolean
  dryRun: boolean
  batchId: number
  plan?: CreditNoteApplyPlan
  summary: {
    created: number
    applied: number
    refunded?: number
    skipped: number
    verificationRequired?: number
    errors: number
  }
  rows: CreditNoteApplyPlanRow[]
  errors: CreditNoteApplyPlanRow[]
}

export interface ReturnFeeBreakdown {
  orderId: string
  customerRefundAmount: number
  commissionReversal: number
  shippingFbaRetained: number
  otherFeeDelta: number
  netReturnSettlement: number
  rowCount: number
}

export interface ReturnFeeJournalLine {
  key: string
  orderId: string
  feeType: string
  normalizedFeeType?: string
  amount: number
  debit?: { accountCode?: string; accountName?: string; accountId?: string; amount?: number }
  credit?: { accountCode?: string; accountName?: string; accountId?: string; amount?: number }
  referenceNumber?: string
  notes?: string
  status: string
  blockingReason?: string
  residual?: number
}

export interface ReturnFeePlan {
  success?: boolean
  batchId: number
  breakdowns: ReturnFeeBreakdown[]
  journalLines: ReturnFeeJournalLine[]
  aggregatedJournalLines?: ReturnFeeJournalLine[]
  summary: {
    orderCount: number
    customerRefundTotal: number
    commissionReversalTotal: number
    shippingRetainedTotal: number
    netReturnSettlementTotal: number
    journalLineCount: number
    varianceBlockerCount: number
    aggregatedJournalCount?: number
  }
  warnings?: string[]
  creditNoteApplyComplete?: boolean
  notReceivedPostComplete?: boolean
  returnFeePostComplete?: boolean
}

export interface PaymentPostingResult {
  success: boolean
  dryRun: boolean
  batchId: number
  status: string
  settlementReference?: SettlementReference
  summary: {
    invoicesPosted: number
    paymentsCreated: number
    paymentsSkipped: number
    journalsCreated?: number
    journalsSkipped?: number
    verificationRequired?: number
    errors: number
  }
  warnings?: string[]
  payments?: Array<{
    paymentType: string
    paymentLabel: string
    orderId: string
    invoiceId: string
    invoiceNumber: string
    amount: number
    accountCode: string
    accountName: string
    entryLabel?: string
    referenceNumber?: string
    description?: string
    status: string
    zohoPaymentId?: string
    zohoPayloadPreview?: {
      customer_id: string
      invoice_id: string
      invoices?: Array<{
        invoice_id: string
        amount_applied: number
      }>
      amount: number
      payment_date: string
      account_id: string
      account_name: string
      reference_number: string
      description?: string
    } | null
    reason?: string
    error?: string
    code?: string
  }>
  journals?: Array<AmazonFeeJournalLine & {
    paymentType?: string
    status: string
    zohoJournalId?: string
    zohoJournalNumber?: string
    mappingSnapshot?: Record<string, unknown> | null
    zohoPayloadPreview?: {
      date: string
      reference_number: string
      notes: string
      journal_type: string
      line_items: Array<{
        account_id: string
        account_name?: string
        debit_or_credit: 'debit' | 'credit'
        amount: number
        description?: string
      }>
    } | null
    reason?: string
    error?: string
    code?: string
  }>
  errors: Array<{
    paymentType: string
    invoiceId: string
    invoiceNumber: string
    error: string
    code: string
  }>
}

export type PostingEntryStatus = 'posted' | 'failed' | 'verification_required' | 'not_started' | 'partially_posted'

export type PostingGroupKey =
  | 'sales_payment'
  | 'fee_journal'
  | 'credit_note'
  | 'return_not_received'
  | 'return_fee_journal'
  | 'uncleared_clearing'

export type PostingGroupStatus = PostingEntryStatus | 'not_required'

export type PostingOverallStatus =
  | 'not_started'
  | 'partially_posted'
  | 'failed'
  | 'verification_required'
  | 'sales_posted'
  | 'completed'

export type PostingRecoveryActionKind = 'resume' | 'link' | 'reverify' | 'release'

export interface PostingRecoveryAction {
  action: PostingRecoveryActionKind
  label: string
  description: string
}

export interface PostingVerificationCandidate {
  zohoId: string
  zohoNumber?: string
  date?: string
  diffs?: Array<{ field: string; expected: unknown; actual: unknown }>
  unverified?: string[]
}

export type PostingLookupOutcome = 'exact' | 'none' | 'conflict' | 'multiple' | 'missing'

export interface PostingVerification {
  reason?: string
  outcome?: PostingLookupOutcome
  message?: string
  candidates?: PostingVerificationCandidate[]
  checkedAt?: string
}

export interface PostingSubStep {
  postingId: number | null
  status: PostingEntryStatus | 'existing'
  zohoId: string
  error: string
}

export interface PostingStatusEntry {
  group: PostingGroupKey
  paymentType: string
  label: string
  amount: number
  referenceNumber?: string
  orderId?: string
  status: PostingEntryStatus
  postingId: number | null
  zohoId?: string
  zohoNumber?: string
  error: string
  verification: PostingVerification | null
  legacyPaymentType?: string
  creditNote?: PostingSubStep | null
  refund?: PostingSubStep | null
  actions: PostingRecoveryAction[]
}

export interface PostingStatusGroup {
  key: PostingGroupKey
  label: string
  status: PostingGroupStatus
  entries: PostingStatusEntry[]
}

export interface PostingStatusBlocker {
  step: string
  message: string
}

export interface PostingStatus {
  success: boolean
  batchId: number
  marketplace: PaymentClearingMarketplace
  batchStatus: string
  overall: PostingOverallStatus
  salesComplete: boolean
  creditNotesComplete: boolean
  returnFeesComplete: boolean
  unclearedClearingComplete?: boolean
  settlementComplete: boolean
  groups: PostingStatusGroup[]
  unmappedLegacyPostings: Array<{
    postingId: number
    paymentType: string
    zohoId: string
    amount: number
    referenceNumber?: string
    status: string
  }>
  blockers: PostingStatusBlocker[]
}

export interface PostingRecoveryResult {
  success: boolean
  posting: ClearingPosting | null
  verification?: PostingVerification
}

const longOpts = { timeoutMs: 480_000 }

export type PaymentClearingMarketplace = 'KSA' | 'UAE'

export function paymentClearingApiSegment(marketplace: PaymentClearingMarketplace | string = 'KSA'): 'ksa' | 'uae' {
  return String(marketplace).trim().toUpperCase() === 'UAE' ? 'uae' : 'ksa'
}

function paymentClearingBase(marketplace: PaymentClearingMarketplace | string = 'KSA') {
  return `/api/amazon/payment-clearing/${paymentClearingApiSegment(marketplace)}`
}

export async function fetchSettlementReports(marketplace: PaymentClearingMarketplace = 'KSA', daysBack = 90) {
  const qs = new URLSearchParams({ daysBack: String(daysBack) })
  return api.get(`${paymentClearingBase(marketplace)}/settlements?${qs.toString()}`, longOpts) as Promise<{
    success: boolean
    marketplace: PaymentClearingMarketplace
    reportType: string
    reports: SettlementReport[]
  }>
}

export async function fetchKsaSettlementReports(daysBack = 90) {
  return fetchSettlementReports('KSA', daysBack)
}

export async function fetchZohoCustomers(marketplace: PaymentClearingMarketplace = 'KSA') {
  return api.get(`${paymentClearingBase(marketplace)}/zoho-customers`, longOpts) as Promise<{
    success: boolean
    marketplace: PaymentClearingMarketplace
    customers: KsaZohoCustomerOption[]
  }>
}

export async function fetchKsaZohoCustomers() {
  return fetchZohoCustomers('KSA')
}

export async function previewSettlementReport(
  marketplace: PaymentClearingMarketplace,
  body: {
    reportId?: string
    reportDocumentId?: string
    daysBack?: number
    forceRefresh?: boolean
    zohoCustomerId?: string
    zohoCustomerName?: string
    fromDate?: string
    toDate?: string
  }
) {
  return api.post(`${paymentClearingBase(marketplace)}/preview`, body, longOpts) as Promise<PaymentClearingPreview>
}

export async function previewKsaSettlementReport(body: {
  reportId?: string
  reportDocumentId?: string
  daysBack?: number
  forceRefresh?: boolean
  zohoCustomerId?: string
  zohoCustomerName?: string
  fromDate?: string
  toDate?: string
}) {
  return previewSettlementReport('KSA', body)
}

export async function previewSettlementUpload(
  marketplace: PaymentClearingMarketplace,
  file: File,
  body: {
    forceRefresh?: boolean
    zohoCustomerId?: string
    zohoCustomerName?: string
    fromDate?: string
    toDate?: string
  } = {}
) {
  const form = new FormData()
  form.append('file', file)
  if (body.forceRefresh) form.append('forceRefresh', 'true')
  if (body.zohoCustomerId) form.append('zohoCustomerId', body.zohoCustomerId)
  if (body.zohoCustomerName) form.append('zohoCustomerName', body.zohoCustomerName)
  if (body.fromDate) form.append('fromDate', body.fromDate)
  if (body.toDate) form.append('toDate', body.toDate)
  return api.postForm(`${paymentClearingBase(marketplace)}/preview-upload`, form, longOpts) as Promise<PaymentClearingPreview>
}

export async function previewKsaSettlementUpload(
  file: File,
  body: {
    forceRefresh?: boolean
    zohoCustomerId?: string
    zohoCustomerName?: string
    fromDate?: string
    toDate?: string
  } = {}
) {
  return previewSettlementUpload('KSA', file, body)
}

export async function fetchSavedBatches(marketplace: PaymentClearingMarketplace = 'KSA', limit = 50) {
  const qs = new URLSearchParams({ limit: String(limit) })
  return api.get(`${paymentClearingBase(marketplace)}/batches?${qs.toString()}`, longOpts) as Promise<{
    success: boolean
    marketplace: PaymentClearingMarketplace
    batches: SavedBatchSummary[]
  }>
}

export async function fetchKsaSavedBatches(limit = 50) {
  return fetchSavedBatches('KSA', limit)
}

export async function fetchPaymentClearingBatch(marketplace: PaymentClearingMarketplace, batchId: number | string) {
  return api.get(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}`,
    longOpts
  ) as Promise<PaymentClearingPreview>
}

export async function fetchKsaPaymentClearingBatch(batchId: number | string) {
  return fetchPaymentClearingBatch('KSA', batchId)
}

export async function fetchFeeJournalMappings(marketplace: PaymentClearingMarketplace = 'KSA', includeInactive = true) {
  const qs = new URLSearchParams({ includeInactive: String(includeInactive) })
  return api.get(`${paymentClearingBase(marketplace)}/fee-journal-mappings?${qs.toString()}`, longOpts) as Promise<{
    success: boolean
    marketplace: PaymentClearingMarketplace
    mappings: AmazonFeeJournalMappingRule[]
  }>
}

export async function fetchKsaFeeJournalMappings(includeInactive = true) {
  return fetchFeeJournalMappings('KSA', includeInactive)
}

export async function saveFeeJournalMapping(
  marketplace: PaymentClearingMarketplace,
  body: Partial<AmazonFeeJournalMappingRule>
) {
  return api.post(`${paymentClearingBase(marketplace)}/fee-journal-mappings`, {
    ...body,
    marketplace,
  }, longOpts) as Promise<{
    success: boolean
    mapping: AmazonFeeJournalMappingRule
  }>
}

export async function saveKsaFeeJournalMapping(body: Partial<AmazonFeeJournalMappingRule>) {
  return saveFeeJournalMapping('KSA', body)
}

export async function fetchAmazonPaymentClearingZohoChartAccounts() {
  return api.get('/api/amazon/payment-clearing/zoho/chart-accounts', longOpts) as Promise<{
    success: boolean
    accounts: ZohoChartAccount[]
  }>
}

export async function approvePaymentClearingBatch(marketplace: PaymentClearingMarketplace, batchId: number | string) {
  return api.post(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}/approve`,
    {},
    longOpts
  ) as Promise<PaymentClearingPreview>
}

export async function approveKsaPaymentClearingBatch(batchId: number | string) {
  return approvePaymentClearingBatch('KSA', batchId)
}

export async function fetchCreditNoteApplyPlan(marketplace: PaymentClearingMarketplace, batchId: number | string) {
  return api.get(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}/credit-note-apply-plan`,
    longOpts
  ) as Promise<CreditNoteApplyPlan>
}

export async function fetchKsaCreditNoteApplyPlan(batchId: number | string) {
  return fetchCreditNoteApplyPlan('KSA', batchId)
}

interface ReturnsJobState<T> {
  jobId?: string
  status?: 'queued' | 'running' | 'completed' | 'failed'
  progress?: PostingJobProgress
  error?: string | null
  result?: T
}

const RETURNS_JOB_WAIT_MS = 30 * 60 * 1000

async function waitForReturnsJob<T>(
  marketplace: PaymentClearingMarketplace,
  started: ReturnsJobState<T>,
  onProgress?: (progress: PostingJobProgress) => void
): Promise<T> {
  if (!started?.jobId) throw new Error('The server did not start the job.')
  if (started.progress) onProgress?.(started.progress)
  const deadline = Date.now() + RETURNS_JOB_WAIT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 2000))
    const job = (await api.get(
      `${paymentClearingBase(marketplace)}/returns-jobs/${encodeURIComponent(started.jobId)}`,
      longOpts
    )) as ReturnsJobState<T>
    if (job.progress) onProgress?.(job.progress)
    if (job.status === 'completed' && job.result) return job.result
    if (job.status === 'failed') throw new Error(job.error || 'The job failed.')
  }
  throw new Error('Timed out waiting for Zoho. Check the status below, then try again.')
}

export async function applyCreditNotes(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string,
  dryRun = true,
  onProgress?: (progress: PostingJobProgress) => void
) {
  const started = (await api.post(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}/apply-credit-notes`,
    { dryRun },
    longOpts
  )) as ReturnsJobState<CreditNoteApplyResult>
  return waitForReturnsJob(marketplace, started, onProgress)
}

export async function applyKsaCreditNotes(batchId: number | string, dryRun = true) {
  return applyCreditNotes('KSA', batchId, dryRun)
}

function batchPath(marketplace: PaymentClearingMarketplace, batchId: number | string) {
  return `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}`
}

export async function refreshReturnCreditNotes(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string,
  onProgress?: (progress: PostingJobProgress) => void
) {
  const started = (await api.post(
    `${batchPath(marketplace, batchId)}/returns/refresh-credit-notes`,
    {},
    longOpts
  )) as ReturnsJobState<RefreshReturnCreditNotesResult>
  return waitForReturnsJob(marketplace, started, onProgress)
}

export async function markReturnNotReceived(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string,
  orderId: string,
  reason: string
) {
  return api.post(
    `${batchPath(marketplace, batchId)}/returns/${encodeURIComponent(orderId)}/not-received`,
    { reason },
    longOpts
  ) as Promise<ReturnDispositionsResult>
}

export async function unmarkReturnNotReceived(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string,
  orderId: string
) {
  return api.delete(
    `${batchPath(marketplace, batchId)}/returns/${encodeURIComponent(orderId)}/not-received`,
    longOpts
  ) as Promise<ReturnDispositionsResult>
}

export async function fetchNotReceivedPlan(marketplace: PaymentClearingMarketplace, batchId: number | string) {
  return api.get(`${batchPath(marketplace, batchId)}/not-received-plan`, longOpts) as Promise<NotReceivedPlan>
}

export async function fetchUnclearedClearingPlan(marketplace: PaymentClearingMarketplace, batchId: number | string) {
  return api.get(`${batchPath(marketplace, batchId)}/uncleared-clearing-plan`, longOpts) as Promise<UnclearedClearingPlan>
}

export async function postUnclearedClearing(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string,
  dryRun = true
) {
  return api.post(
    `${batchPath(marketplace, batchId)}/post-uncleared-clearing`,
    { dryRun },
    longOpts
  ) as Promise<PaymentPostingResult>
}

export async function postNotReceivedReturns(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string,
  dryRun = true
) {
  return api.post(
    `${batchPath(marketplace, batchId)}/post-not-received-returns`,
    { dryRun },
    longOpts
  ) as Promise<PaymentPostingResult>
}

export async function fetchReturnFeePlan(marketplace: PaymentClearingMarketplace, batchId: number | string) {
  return api.get(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}/return-fee-plan`,
    longOpts
  ) as Promise<ReturnFeePlan>
}

export async function fetchKsaReturnFeePlan(batchId: number | string) {
  return fetchReturnFeePlan('KSA', batchId)
}

export async function generatePaymentClearingPaymentPreview(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string
) {
  return api.post(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}/payment-preview`,
    {},
    longOpts
  ) as Promise<PaymentClearingPaymentPreview>
}

export async function generateKsaPaymentClearingPaymentPreview(batchId: number | string) {
  return generatePaymentClearingPaymentPreview('KSA', batchId)
}

export interface PostingJobProgress {
  step: string
  current: number
  total: number
}

const POSTING_JOB_WAIT_MS = 30 * 60 * 1000

export async function postPaymentClearingToZoho(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string,
  dryRun = true,
  onProgress?: (progress: PostingJobProgress) => void
) {
  const started = (await api.post(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}/post-to-zoho`,
    { dryRun },
    longOpts
  )) as PaymentPostingResult & { jobId?: string; status?: string }

  return waitForPostingJob(marketplace, started, onProgress)
}

async function waitForPostingJob(
  marketplace: PaymentClearingMarketplace,
  started: PaymentPostingResult & { jobId?: string; status?: string; progress?: PostingJobProgress },
  onProgress?: (progress: PostingJobProgress) => void
) {
  if (!started?.jobId) return started
  if (started.progress) onProgress?.(started.progress)

  const deadline = Date.now() + POSTING_JOB_WAIT_MS
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const job = (await api.get(
      `${paymentClearingBase(marketplace)}/post-to-zoho-jobs/${encodeURIComponent(started.jobId)}`,
      longOpts
    )) as {
      status?: string
      error?: string
      progress?: PostingJobProgress
      result?: PaymentPostingResult
    }
    if (job.progress) onProgress?.(job.progress)
    if (job.status === 'completed' && job.result) return job.result
    if (job.status === 'failed') {
      throw new Error(job.error || 'Zoho posting failed.')
    }
  }
  throw new Error('Zoho posting timed out while waiting for the background job to finish. Check the posting status below before trying again.')
}

export async function postKsaPaymentClearingToZoho(batchId: number | string, dryRun = true) {
  return postPaymentClearingToZoho('KSA', batchId, dryRun)
}

export async function postReturnFeeJournals(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string,
  dryRun = true
) {
  return api.post(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}/post-return-fee-journals`,
    { dryRun },
    longOpts
  ) as Promise<PaymentPostingResult>
}

export async function fetchPostingStatus(marketplace: PaymentClearingMarketplace, batchId: number | string) {
  return api.get(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}/posting-status`,
    longOpts
  ) as Promise<PostingStatus>
}

export async function reverifyPosting(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string,
  postingId: number
) {
  return api.post(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}/postings/${encodeURIComponent(String(postingId))}/reverify`,
    {},
    longOpts
  ) as Promise<PostingRecoveryResult>
}

export async function linkPosting(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string,
  body: { postingId?: number | null; paymentType?: string; zohoId: string; reason: string }
) {
  return api.post(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}/postings/link`,
    body,
    longOpts
  ) as Promise<PostingRecoveryResult>
}

export async function releasePosting(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string,
  postingId: number,
  reason: string
) {
  return api.post(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}/postings/${encodeURIComponent(String(postingId))}/release`,
    { reason },
    longOpts
  ) as Promise<PostingRecoveryResult>
}

export async function postKsaReturnFeeJournals(batchId: number | string, dryRun = true) {
  return postReturnFeeJournals('KSA', batchId, dryRun)
}

export async function forceRepostPaymentClearing(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string,
  body: { reason: string; dryRun?: boolean },
  onProgress?: (progress: PostingJobProgress) => void
) {
  const response = (await api.post(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}/force-repost`,
    { dryRun: body.dryRun !== false, reason: body.reason },
    longOpts
  )) as PaymentPostingResult & { jobId?: string; status?: string }
  return waitForPostingJob(marketplace, response, onProgress)
}

export async function forceRepostKsaPaymentClearing(
  batchId: number | string,
  body: { reason: string; dryRun?: boolean }
) {
  return forceRepostPaymentClearing('KSA', batchId, body)
}

export async function reclassifyAccountLevelFees(
  marketplace: PaymentClearingMarketplace,
  batchId: number | string,
  rowNumbers: number[]
) {
  return api.post(
    `${paymentClearingBase(marketplace)}/batches/${encodeURIComponent(String(batchId))}/reclassify-account-level-fees`,
    { rowNumbers },
    longOpts
  ) as Promise<PaymentClearingPreview & { message?: string }>
}

export async function reclassifyKsaAccountLevelFees(
  batchId: number | string,
  rowNumbers: number[]
) {
  return reclassifyAccountLevelFees('KSA', batchId, rowNumbers)
}
