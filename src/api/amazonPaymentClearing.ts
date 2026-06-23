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
  status: 'matched' | 'blocked'
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
  status: string
  errorMessage: string
  createdAt: string | null
}

export interface PostingSummary {
  invoicesPosted?: number
  paymentsCreated?: number
  paymentsSkipped?: number
  errors?: number
  forceRepost?: boolean
  postedAt?: string
  reference?: string
  settlementReference?: SettlementReference
  zohoPaymentIds?: Array<{ paymentType: string; zohoPaymentId: string; referenceNumber?: string }>
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
  refundReturnRows?: AdjustmentClearingRow[]
  matchedReturns?: RefundReturnCreditNoteRow[]
  missingCreditNotes?: RefundReturnCreditNoteRow[]
  creditNoteBlockingRows?: RefundReturnCreditNoteRow[]
  adjustmentRows?: AdjustmentClearingRow[]
  reconciliationSummary: ReconciliationSummary
  matchedOrders: MatchedOrder[]
  unmatchedOrders: UnmatchedOrder[]
  allRows?: ParsedSettlementRow[]
  blockingIssues?: BlockingIssue[]
  amountDifferences?: AmountDifferenceRow[]
  warnings: string[]
  rawRowCount: number
  duplicateZohoInvoiceNumbers?: string[]
  duplicateZohoPoNumbers?: string[]
  unmatchedOrderIds?: string[]
  missingOrderIdRows?: AdjustmentClearingRow[]
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
  settlementReference?: SettlementReference
  postingReferences?: PostingReference[]
  warnings: string[]
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

export async function approveKsaPaymentClearingBatch(batchId: number | string) {
  return api.post(`/api/amazon/payment-clearing/ksa/batches/${encodeURIComponent(String(batchId))}/approve`, {}, longOpts) as Promise<PaymentClearingPreview>
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
