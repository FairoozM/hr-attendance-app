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
  postingReference?: string
  createdAt: string | null
  approvedAt: string | null
  postedAt: string | null
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
  }
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
  auditLog?: ClearingAuditEntry[]
  storedRowCount?: number
  message?: string
  marketplace: 'KSA'
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
  status: 'ready' | 'mismatch'
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

export interface CreditNoteApplyPlanRow {
  orderId: string
  action: 'skipped_already_applied' | 'skipped_already_posted' | 'apply_existing' | 'create_and_apply' | 'blocked'
  status: string
  applyAmount: number
  amazonRefundAmount?: number
  creditNoteAmount?: number
  amountAlreadyApplied?: number
  zohoInvoiceId?: string
  zohoInvoiceNumber?: string
  zohoCreditNoteId?: string
  zohoCreditNoteNumber?: string
  blockingReason?: string
}

export interface CreditNoteApplyPlan {
  success?: boolean
  batchId: number
  rows: CreditNoteApplyPlanRow[]
  summary: {
    totalRows: number
    skippedAlreadyApplied: number
    applyExisting: number
    createAndApply: number
    blocked: number
    completed: number
    isComplete?: boolean
  }
}

export interface CreditNoteApplyResult {
  success: boolean
  dryRun: boolean
  batchId: number
  plan?: CreditNoteApplyPlan
  summary: {
    created: number
    applied: number
    skipped: number
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
    errors: number
  }
  payments: Array<{
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

const longOpts = { timeoutMs: 480_000 }

export async function fetchKsaSettlementReports(daysBack = 60) {
  const qs = new URLSearchParams({ daysBack: String(daysBack) })
  return api.get(`/api/amazon/payment-clearing/ksa/settlements?${qs.toString()}`, longOpts) as Promise<{
    success: boolean
    marketplace: 'KSA'
    reportType: string
    reports: SettlementReport[]
  }>
}

export async function previewKsaSettlementReport(body: {
  reportId?: string
  reportDocumentId?: string
  daysBack?: number
  forceRefresh?: boolean
}) {
  return api.post('/api/amazon/payment-clearing/ksa/preview', body, longOpts) as Promise<PaymentClearingPreview>
}

export async function fetchKsaSavedBatches(limit = 50) {
  const qs = new URLSearchParams({ limit: String(limit) })
  return api.get(`/api/amazon/payment-clearing/ksa/batches?${qs.toString()}`, longOpts) as Promise<{
    success: boolean
    marketplace: 'KSA'
    batches: SavedBatchSummary[]
  }>
}

export async function fetchKsaPaymentClearingBatch(batchId: number | string) {
  return api.get(`/api/amazon/payment-clearing/ksa/batches/${encodeURIComponent(String(batchId))}`, longOpts) as Promise<PaymentClearingPreview>
}

export async function fetchKsaFeeJournalMappings(includeInactive = true) {
  const qs = new URLSearchParams({ includeInactive: String(includeInactive) })
  return api.get(`/api/amazon/payment-clearing/ksa/fee-journal-mappings?${qs.toString()}`, longOpts) as Promise<{
    success: boolean
    marketplace: 'KSA'
    mappings: AmazonFeeJournalMappingRule[]
  }>
}

export async function saveKsaFeeJournalMapping(body: Partial<AmazonFeeJournalMappingRule>) {
  return api.post('/api/amazon/payment-clearing/ksa/fee-journal-mappings', body, longOpts) as Promise<{
    success: boolean
    mapping: AmazonFeeJournalMappingRule
  }>
}

export async function fetchAmazonPaymentClearingZohoChartAccounts() {
  return api.get('/api/amazon/payment-clearing/zoho/chart-accounts', longOpts) as Promise<{
    success: boolean
    accounts: ZohoChartAccount[]
  }>
}

export async function approveKsaPaymentClearingBatch(batchId: number | string) {
  return api.post(`/api/amazon/payment-clearing/ksa/batches/${encodeURIComponent(String(batchId))}/approve`, {}, longOpts) as Promise<PaymentClearingPreview>
}

export async function fetchKsaCreditNoteApplyPlan(batchId: number | string) {
  return api.get(`/api/amazon/payment-clearing/ksa/batches/${encodeURIComponent(String(batchId))}/credit-note-apply-plan`, longOpts) as Promise<CreditNoteApplyPlan>
}

export async function applyKsaCreditNotes(batchId: number | string, dryRun = true) {
  return api.post(`/api/amazon/payment-clearing/ksa/batches/${encodeURIComponent(String(batchId))}/apply-credit-notes`, { dryRun }, longOpts) as Promise<CreditNoteApplyResult>
}

export async function fetchKsaReturnFeePlan(batchId: number | string) {
  return api.get(`/api/amazon/payment-clearing/ksa/batches/${encodeURIComponent(String(batchId))}/return-fee-plan`, longOpts) as Promise<ReturnFeePlan>
}

export async function generateKsaPaymentClearingPaymentPreview(batchId: number | string) {
  return api.post(`/api/amazon/payment-clearing/ksa/batches/${encodeURIComponent(String(batchId))}/payment-preview`, {}, longOpts) as Promise<PaymentClearingPaymentPreview>
}

export async function postKsaPaymentClearingToZoho(batchId: number | string, dryRun = true) {
  return api.post(`/api/amazon/payment-clearing/ksa/batches/${encodeURIComponent(String(batchId))}/post-to-zoho`, { dryRun }, longOpts) as Promise<PaymentPostingResult>
}

export async function forceRepostKsaPaymentClearing(
  batchId: number | string,
  body: { reason: string; dryRun?: boolean }
) {
  return api.post(
    `/api/amazon/payment-clearing/ksa/batches/${encodeURIComponent(String(batchId))}/force-repost`,
    { dryRun: body.dryRun !== false, reason: body.reason },
    longOpts
  ) as Promise<PaymentPostingResult>
}
