import { api } from './client'

const BASE = '/api/noon/payment-clearing'
const longOpts = { timeoutMs: 480_000 }

export interface NoonStatementRow {
  rowNumber: number
  parentOrderId: string
  itemOrderId: string
  orderNr: string
  itemNr: string
  sku: string
  partnerSku: string
  title: string
  transactionType: string
  rowClass: string
  normalizedFeeType?: string
  netProceed: number
  referralFee: number
  fulfillmentFee: number
  shippingCharges: number
  otherOrderFees?: number
  othersInclVat?: number
  nonOrderFees?: number
  total: number
  currency: string
  matchStatus?: string
  zohoInvoiceId?: string
  zohoInvoiceNumber?: string
  blockingReason?: string
  originalParentOrderId?: string
  assignedItemOrderId?: string
  assignmentReason?: string
  assignmentReasonLabel?: string
  parentFallbackStatus?: string
  displayLabel?: string
  accountingTreatment?: string
}

export interface NoonHierarchyChild {
  itemOrderId: string
  parentOrderId: string
  sku: string
  partnerSku: string
  title: string
  totals: { netProceed: number; referralFee: number; fulfillmentFee: number; total: number }
  matchStatus?: string
  zohoInvoiceId?: string
  zohoInvoiceNumber?: string
}

export interface NoonHierarchyParent {
  parentOrderId: string
  children: NoonHierarchyChild[]
  parentCharges: NoonStatementRow[]
  adjustments: NoonStatementRow[]
  totals: { netProceed: number; total: number; fulfillmentFee: number; shippingCharges: number }
}

export interface NoonReconciliationSummary {
  itemOrderProceeds: number
  referralCommissionFees: number
  fulfillmentLogisticsFees: number
  subsidies: number
  orderUpdatesAdjustments: number
  parentOrderCharges: number
  statementLevelFees: number
  advertisingFees: number
  otherNoonFees: number
  calculatedSettlement: number
  expectedSettlement: number
  reconciliationDifference: number
  reconciliationStatus: 'reconciled' | 'mismatch'
}

export interface NoonMatchedItem {
  itemOrderId: string
  parentOrderId: string
  sku: string
  zohoInvoiceId: string
  zohoInvoiceNumber: string
  zohoInvoiceTotal?: number
  netProceed: number
  referralFee: number
  fulfillmentFee: number
  shippingCharges: number
  matchStatus: string
  matchType?: string
}

export interface NoonBlockingIssue {
  code: string
  severity: string
  message: string
  itemOrderId?: string
  parentOrderId?: string
  rowNumber?: number
}

export interface NoonSavedBatchSummary {
  batchId: number
  referenceNr: string
  status: string
  settlementTotal: number
  matchedItemCount: number
  unmatchedItemCount: number
  blockerCount: number
  zohoCustomerName: string
  statementStartDate: string
  statementEndDate: string
  createdAt: string | null
}

export interface NoonPaymentClearingPreview {
  batchId: number
  batch?: { batchId: number; status: string; postedToZoho?: boolean; postingSummary?: Record<string, unknown> }
  metadata?: Record<string, unknown>
  allRows: NoonStatementRow[]
  hierarchy: {
    parentGroups: NoonHierarchyParent[]
    statementFees: NoonStatementRow[]
    summary: Record<string, number>
  }
  matchedOrders: NoonMatchedItem[]
  unmatchedOrders: NoonMatchedItem[]
  multipleMatchItems: NoonMatchedItem[]
  parentCharges: NoonStatementRow[]
  adjustments: NoonStatementRow[]
  statementFees: NoonStatementRow[]
  reconciliationSummary: NoonReconciliationSummary
  feeJournalLines: Array<{
    lineIndex: number
    feeType: string
    amount: number
    signedAmount?: number
    mappingStatus: string
    parentOrderId?: string
    title?: string
    rowClass?: string
    displayLabel?: string
    previewNote?: string
    accountingTreatment?: string
    assignedItemOrderId?: string
    originalParentOrderId?: string
    assignmentReason?: string
    debit?: { accountId: string; accountName: string }
    credit?: { accountId: string; accountName: string }
  }>
  blockingIssues: NoonBlockingIssue[]
  warnings: string[]
  zohoCustomerId: string
  zohoCustomerName: string
  totals: Record<string, number>
  isCleanForApproval: boolean
  status?: string
  postedToZoho?: boolean
  postingSummary?: Record<string, unknown>
}

export interface NoonPaymentPreview {
  paymentPreviewId?: number
  invoicePayments: Array<{
    itemOrderId: string
    parentOrderId: string
    sku: string
    zohoInvoiceId: string
    zohoInvoiceNumber: string
    totalClearingAmount: number
    netProceed: number
    referralFee: number
    fulfillmentShipping: number
    paymentAction: string
  }>
  parentLevelCharges: Array<Record<string, unknown>>
  statementLevelCharges: Array<Record<string, unknown>>
  adjustmentClearings?: Array<Record<string, unknown>>
  feeJournalLines: Array<Record<string, unknown>>
  summary: {
    invoicePaymentCount: number
    totalInvoicePayments: number
    totalFeesJournals: number
    totalAdjustments: number
    expectedNoonSettlement: number
    finalDifference: number
    unmappedFeeJournalCount: number
  }
}

export interface NoonPostingResult {
  success: boolean
  dryRun: boolean
  batchId: number
  status: string
  settlementReference?: string
  summary: Record<string, number>
  payments: Array<Record<string, unknown>>
  journals: Array<Record<string, unknown>>
  errors: Array<Record<string, unknown>>
}

function unwrap<T>(data: T & { success?: boolean }): T {
  return data
}

export async function fetchNoonZohoCustomers() {
  const data = await api.get<{ success: boolean; customers: Array<{ name: string; label: string }> }>(
    `${BASE}/zoho-customers`
  )
  return unwrap(data).customers || []
}

export async function fetchNoonSavedBatches(limit = 50) {
  const data = await api.get<{ success: boolean; batches: NoonSavedBatchSummary[] }>(
    `${BASE}/batches?limit=${limit}`
  )
  return unwrap(data).batches || []
}

export async function fetchNoonPaymentClearingBatch(batchId: string | number) {
  const data = await api.get<NoonPaymentClearingPreview & { success: boolean }>(
    `${BASE}/batches/${batchId}`,
    longOpts
  )
  return unwrap(data)
}

export async function previewNoonStatementUpload(file: File, zohoCustomerName: string) {
  const form = new FormData()
  form.append('file', file)
  form.append('zohoCustomerName', zohoCustomerName)
  form.append('allowMatchFailure', 'true')
  const data = await api.postForm<NoonPaymentClearingPreview & { success: boolean }>(
    `${BASE}/preview-upload`,
    form,
    longOpts
  )
  return unwrap(data)
}

export async function approveNoonPaymentClearingBatch(batchId: string | number) {
  const data = await api.post<{ success: boolean; batch: { batchId: number; status: string } }>(
    `${BASE}/batches/${batchId}/approve`,
    {},
    longOpts
  )
  return unwrap(data)
}

export async function generateNoonPaymentPreview(batchId: string | number) {
  const data = await api.post<{ success: boolean; paymentPreview: NoonPaymentPreview }>(
    `${BASE}/batches/${batchId}/payment-preview`,
    {},
    longOpts
  )
  return unwrap(data).paymentPreview
}

export async function postNoonPaymentClearingToZoho(batchId: string | number, dryRun = true) {
  const data = await api.post<NoonPostingResult & { success: boolean }>(
    `${BASE}/batches/${batchId}/post-to-zoho`,
    { dryRun },
    longOpts
  )
  return unwrap(data)
}

export async function forceRepostNoonPaymentClearing(batchId: string | number, reason: string) {
  const data = await api.post<NoonPostingResult & { success: boolean }>(
    `${BASE}/batches/${batchId}/force-repost`,
    { reason },
    longOpts
  )
  return unwrap(data)
}

export async function fetchNoonFeeJournalMappings() {
  const data = await api.get<{
    success: boolean
    mappings: Array<Record<string, unknown>>
    suggestions: Array<Record<string, string>>
  }>(`${BASE}/fee-journal-mappings`)
  return unwrap(data)
}

export async function saveNoonFeeJournalMapping(body: Record<string, unknown>) {
  const data = await api.post<{ success: boolean; mapping: Record<string, unknown> }>(
    `${BASE}/fee-journal-mappings`,
    body
  )
  return unwrap(data).mapping
}

export async function fetchNoonZohoChartAccounts() {
  const data = await api.get<{ success: boolean; accounts: Array<Record<string, unknown>> }>(
    `${BASE}/zoho/chart-accounts`,
    longOpts
  )
  return unwrap(data).accounts || []
}
