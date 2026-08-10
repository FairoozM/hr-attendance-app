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
  excludeFromPaymentClearing?: boolean
  excludeReason?: string
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

export interface NoonSettlementBridgeAccount {
  accountId: string
  accountName: string
  accountCode?: string
}

export interface NoonInputVatAccount {
  accountId: string
  accountName: string
  accountCode?: string
  inputVatAccountId?: string
  inputVatAccountName?: string
  inputVatAccountCode?: string
  vatRate?: number
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
    zohoAccountName?: string
    zohoAccountId?: string
    inputVatAccountId?: string
    inputVatAccountName?: string
    journalDirection?: string
    counterAccountName?: string
    vatTreatment?: string
    grossInclVat?: number
    netExpense?: number
    inputVatAmount?: number
    vatBreakdown?: {
      originalGrossAmount: number
      vatRate: number
      netAmount: number
      vatAmount: number
      vatInclusive: boolean
      vatSource: string
      expenseAccountId?: string
      inputVatAccountId?: string
    }
    clearingAccountName?: string
    clearingAccountId?: string
    settlementBridgeAccountName?: string
    accountingPreview?: {
      debit?: string
      credit?: string
      lines?: Array<{ accountName?: string; debitOrCredit?: string; amount?: number }>
      grossInclVat?: number
      netExpense?: number
      inputVat?: number
      expenseAccount?: string
      vatAccount?: string
      clearingAccount?: string
      customerAccount?: string
    }
    debit?: { accountId: string; accountName: string }
    credit?: { accountId: string; accountName: string }
    lineItems?: Array<{ accountId?: string; accountName?: string; debitOrCredit?: string; amount?: number }>
  }>
  feeJournalVatSummary?: {
    grossInclVat: number
    netExpense: number
    inputVat: number
    vatInclusiveLineCount: number
  }
  settlementBridgeAccount?: NoonSettlementBridgeAccount
  paymentPreviewAccounts?: Record<string, { depositToAccountCode?: string; depositToAccountName?: string; depositToAccountId?: string }>
  inputVatAccount?: NoonInputVatAccount
  blockingIssues: NoonBlockingIssue[]
  warnings: string[]
  zohoCustomerId: string
  zohoCustomerName: string
  totals: Record<string, number>
  isCleanForApproval: boolean
  status?: string
  postedToZoho?: boolean
  postingSummary?: Record<string, unknown>
  openBalanceShortfalls?: Array<{
    itemOrderId: string
    zohoInvoiceId: string
    zohoInvoiceNumber: string
    invoiceTotal: number
    openBalance: number
    totalClearingAmount: number
    overBy: number
    shipping?: number
    commission?: number
    reason?: string
  }>
  openBalanceCheckedAt?: string | null
}

export interface NoonPaymentPreview {
  paymentPreviewId?: number
  status?: string
  invoicePayments: Array<{
    itemOrderId: string
    parentOrderId: string
    sku: string
    zohoInvoiceId: string
    zohoInvoiceNumber: string
    invoiceTotal?: number
    totalClearingAmount: number
    netProceed: number
    referralFee: number
    fulfillmentShipping: number
    parentLogisticsAddOn?: number
    parentCommissionAddOn?: number
    parentLogisticsSources?: Array<Record<string, unknown>>
    exceedsInvoiceTotal?: boolean
    netBalancePayment?: { amount: number; depositToAccountCode?: string; depositToAccountName?: string }
    commissionPayment?: { amount: number; depositToAccountCode?: string; depositToAccountName?: string }
    fulfillmentPayment?: { amount: number; depositToAccountCode?: string; depositToAccountName?: string }
    paymentAction: string
  }>
  invoiceOverpayments?: Array<{
    itemOrderId: string
    zohoInvoiceNumber: string
    invoiceTotal: number
    totalClearingAmount: number
    overBy: number
  }>
  parentLevelCharges: Array<Record<string, unknown>>
  statementLevelCharges: Array<Record<string, unknown>>
  adjustmentClearings?: Array<Record<string, unknown>>
  feeJournalLines: Array<Record<string, unknown>>
  unclearedReclassJournals?: Array<Record<string, unknown>>
  unclearedReclassSummary?: Record<string, unknown>
  summary: {
    invoicePaymentCount: number
    totalInvoicePayments: number
    totalFeesJournals: number
    totalUnclearedReclassJournals?: number
    totalAdjustments: number
    expectedNoonSettlement: number
    finalDifference: number
    unmappedFeeJournalCount: number
    unmappedUnclearedReclassCount?: number
    invoiceOverpaymentCount?: number
    blocked?: boolean
    blockedReason?: string | null
  }
}

export interface NoonPostingResult {
  success: boolean
  dryRun: boolean
  batchId: number
  status: string
  settlementReference?: string
  message?: string
  missingPaymentTypes?: string[]
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
  const started = await api.postForm<{
    success: boolean
    async?: boolean
    jobId?: string
    status?: string
    progress?: { step?: string; current?: number; total?: number }
  } & NoonPaymentClearingPreview>(`${BASE}/preview-upload`, form, longOpts)

  // Legacy sync response (no job) — keep working if an older backend is hit.
  if (!started?.async || !started.jobId) {
    return unwrap(started as NoonPaymentClearingPreview & { success: boolean })
  }

  const deadline = Date.now() + longOpts.timeoutMs
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1500))
    const job = await api.get<{
      success: boolean
      status?: string
      error?: string
      progress?: { step?: string; current?: number; total?: number }
      result?: NoonPaymentClearingPreview
    }>(`${BASE}/preview-upload/jobs/${encodeURIComponent(started.jobId)}`, longOpts)

    if (job.status === 'completed' && job.result) {
      return unwrap({ success: true, ...job.result })
    }
    if (job.status === 'failed') {
      throw new Error(job.error || 'Noon statement upload failed')
    }
  }
  throw new Error('Noon statement upload timed out while matching Zoho invoices. Re-open the batch from Saved if it finished server-side.')
}

export async function approveNoonPaymentClearingBatch(batchId: string | number) {
  const data = await api.post<{ success: boolean; batch: { batchId: number; status: string } }>(
    `${BASE}/batches/${batchId}/approve`,
    {},
    longOpts
  )
  return unwrap(data)
}

export async function reconcileNoonOpenBalances(batchId: string | number) {
  const data = await api.post<{ success: boolean } & NoonPaymentClearingPreview>(
    `${BASE}/batches/${batchId}/reconcile-open-balances`,
    {},
    longOpts
  )
  return unwrap(data)
}

export async function excludeNoonOpenBalanceShortfalls(
  batchId: string | number,
  body: { zohoInvoiceIds?: string[]; itemOrderIds?: string[] } = {}
) {
  const data = await api.post<{ success: boolean } & NoonPaymentClearingPreview>(
    `${BASE}/batches/${batchId}/exclude-open-balance-shortfalls`,
    body,
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

/** Gateway hiccups (CloudFront 502/503/504) must not abort a post that is still running. */
const TRANSIENT_POLL_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504])
const MAX_CONSECUTIVE_POLL_FAILURES = 15

async function pollNoonPostingJob(jobId: string) {
  const deadline = Date.now() + longOpts.timeoutMs
  let consecutiveFailures = 0
  let lastPollError = ''

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, consecutiveFailures ? 5000 : 2000))

    let job: {
      success: boolean
      status?: string
      error?: string
      progress?: { step?: string; current?: number; total?: number }
      result?: NoonPostingResult
    }
    try {
      job = await api.get(`${BASE}/posting-jobs/${encodeURIComponent(jobId)}`, longOpts)
    } catch (err) {
      const status = Number((err as { status?: number })?.status) || 0
      lastPollError = (err as { message?: string })?.message || `HTTP ${status}`

      // Job vanished — backend restarted (deploy) while posting. Never report a hard failure:
      // Zoho may already have the payments.
      if (status === 404) {
        throw new Error(
          'Lost track of the Noon posting job (the API restarted while posting). ' +
            'Do NOT force repost yet — check Zoho for this statement first, then reopen the batch to see its status.'
        )
      }
      if (status && !TRANSIENT_POLL_STATUSES.has(status)) throw err

      consecutiveFailures += 1
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) {
        throw new Error(
          `Lost connection while waiting for the Noon posting job (${lastPollError}). ` +
            'The post may still be running server-side — check Zoho and reopen the batch before retrying.'
        )
      }
      continue
    }

    consecutiveFailures = 0
    if (job.status === 'completed' && job.result) {
      return unwrap({ success: true, ...job.result })
    }
    if (job.status === 'failed') {
      throw new Error(job.error || 'Noon Zoho posting failed')
    }
  }
  throw new Error(
    'Noon Zoho posting timed out while waiting for the background job. Check Zoho / Saved batch — it may still have finished server-side.'
  )
}

export async function postNoonPaymentClearingToZoho(batchId: string | number, dryRun = true) {
  if (dryRun) {
    const data = await api.post<NoonPostingResult & { success: boolean }>(
      `${BASE}/batches/${batchId}/post-to-zoho`,
      { dryRun: true },
      longOpts
    )
    return unwrap(data)
  }

  const started = await api.post<{
    success: boolean
    async?: boolean
    jobId?: string
    status?: string
  } & NoonPostingResult>(`${BASE}/batches/${batchId}/post-to-zoho`, { dryRun: false }, longOpts)

  if (!started?.async || !started.jobId) {
    return unwrap(started as NoonPostingResult & { success: boolean })
  }
  return pollNoonPostingJob(started.jobId)
}

export async function forceRepostNoonPaymentClearing(batchId: string | number, reason: string) {
  const started = await api.post<{
    success: boolean
    async?: boolean
    jobId?: string
    status?: string
  } & NoonPostingResult>(`${BASE}/batches/${batchId}/force-repost`, { reason }, longOpts)

  if (!started?.async || !started.jobId) {
    return unwrap(started as NoonPostingResult & { success: boolean })
  }
  return pollNoonPostingJob(started.jobId)
}

export interface NoonFeeJournalMapping {
  id: number
  marketplace: string
  normalizedFeeType: string
  zohoAccountId: string
  zohoAccountName: string
  debitAccountId?: string
  debitAccountName?: string
  isActive: boolean
  priority?: number
}

export async function fetchNoonFeeJournalMappings() {
  const data = await api.get<{
    success: boolean
    mappings: NoonFeeJournalMapping[]
    suggestions: Array<Record<string, string>>
    zohoCustomerName?: string
    undepositedFundsAccount?: NoonSettlementBridgeAccount
    unclearedCommissionAccount?: NoonSettlementBridgeAccount
    unclearedShippingAccount?: NoonSettlementBridgeAccount
    customerCounterAccount?: NoonSettlementBridgeAccount
    settlementBridgeAccount?: NoonSettlementBridgeAccount
    paymentPreviewAccounts?: Record<string, { depositToAccountCode?: string; depositToAccountName?: string; depositToAccountId?: string }>
    inputVatAccount?: NoonInputVatAccount
  }>(`${BASE}/fee-journal-mappings`)
  return unwrap(data)
}

export async function fetchNoonInputVatSettings() {
  const data = await api.get<{
    success: boolean
    settings: NoonInputVatAccount
    inputVatAccount: NoonInputVatAccount
  }>(`${BASE}/settings/input-vat`)
  return unwrap(data).inputVatAccount || unwrap(data).settings
}

export async function saveNoonInputVatSettings(body: {
  inputVatAccountId: string
  inputVatAccountName: string
  inputVatAccountCode?: string
  vatRate?: number
}) {
  const data = await api.put<{
    success: boolean
    settings: NoonInputVatAccount
    inputVatAccount: NoonInputVatAccount
  }>(`${BASE}/settings/input-vat`, body)
  return unwrap(data).inputVatAccount || unwrap(data).settings
}

export async function saveNoonFeeJournalMapping(body: {
  id?: number
  normalizedFeeType: string
  zohoAccountId: string
  zohoAccountName: string
  isActive?: boolean
}) {
  const data = await api.post<{ success: boolean; mapping: NoonFeeJournalMapping }>(
    `${BASE}/fee-journal-mappings`,
    body
  )
  return unwrap(data).mapping
}

export async function deleteNoonFeeJournalMapping(id: number | string) {
  const data = await api.delete<{ success: boolean; mapping: NoonFeeJournalMapping }>(
    `${BASE}/fee-journal-mappings/${id}`
  )
  return unwrap(data).mapping
}

export async function fetchNoonZohoChartAccounts() {
  const data = await api.get<{
    success: boolean
    accounts: Array<{
      accountId: string
      accountName: string
      accountCode?: string
      accountType?: string
      isActive?: boolean
    }>
  }>(`${BASE}/zoho/chart-accounts`, longOpts)
  return unwrap(data).accounts || []
}
