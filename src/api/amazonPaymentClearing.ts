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

export interface PaymentClearingPreview {
  success: boolean
  batch?: {
    batchId: number
    status: string
    createdAt: string
    approvedBy?: number | null
    approvedAt?: string | null
    postedBy?: number | null
    postedAt?: string | null
  }
  status?: string
  approvedBy?: number | null
  approvedAt?: string | null
  postedBy?: number | null
  postedAt?: string | null
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
  reconciliationSummary: ReconciliationSummary
  matchedOrders: MatchedOrder[]
  unmatchedOrders: UnmatchedOrder[]
  warnings: string[]
  rawRowCount: number
  duplicateZohoInvoiceNumbers?: string[]
  duplicateZohoPoNumbers?: string[]
  unmatchedOrderIds?: string[]
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
  difference: number
}

export interface PaymentClearingPaymentPreview {
  success: boolean
  batchId: number
  paymentPreviewId?: number
  createdAt?: string | null
  status: string
  paymentPlanSummary: PaymentPreviewSummary
  payments: PaymentPreviewRow[]
  warnings: string[]
}

export interface PaymentPostingResult {
  success: boolean
  dryRun: boolean
  batchId: number
  status: string
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
}) {
  return api.post('/api/amazon/payment-clearing/ksa/preview', body, longOpts) as Promise<PaymentClearingPreview>
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
