import { api } from './client'

/** Zoho reads for a whole statement can take a while. Posting itself runs as a background job. */
export const TABBY_LONG_TIMEOUT_MS = 180_000

export type TabbyBatchStatus =
  | 'IMPORTED'
  | 'READY'
  | 'BLOCKED'
  | 'POSTING'
  | 'PARTIALLY_POSTED'
  | 'POSTED'
  | 'NEEDS_REVIEW'

export type TabbyBankStatus =
  | 'BANK_MATCHED'
  | 'BANK_MATCH_PENDING'
  | 'BANK_MATCH_AMBIGUOUS'
  | 'BANK_LOOKUP_FAILED'
  | 'BANK_NOT_REQUIRED'

export type TabbyZohoState = 'MISSING' | 'VERIFIED' | 'CONFLICT' | 'AMBIGUOUS' | 'LOOKUP_FAILED'

export type TabbyRecoveryAction =
  | 'SKIP_VERIFIED'
  | 'POST_ELIGIBLE'
  | 'RETRY_ELIGIBLE'
  | 'WAIT_UNCERTAIN'
  | 'RECHECK_THEN_RETRY'
  | 'NEEDS_REVIEW'
  | 'LOOKUP_FAILED'

export interface TabbyIssue {
  code: string
  message: string
  scope?: string
  excelRow?: number
  key?: string
  websiteOrderId?: string
}

export interface TabbyBatchReview {
  at: string
  status: TabbyBatchStatus
  fingerprint: string
  blockers: number
  warnings: number
  bankStatus: TabbyBankStatus
  date: string
  totals?: { bankPayout: number; inputVat: number }
}

export interface TabbyBatch {
  id: string
  statementNumber: string
  fileHash: string
  fileName: string | null
  statementDate: string | null
  transferDate: string | null
  companyName: string | null
  currency: string
  status: TabbyBatchStatus
  review: TabbyBatchReview | null
  bankStatus: TabbyBankStatus | null
  bankTransactionId: string | null
  postingJob: TabbyPostJob | null
  importedBy: string | null
  createdAt: string | null
  updatedAt: string | null
  postedAt: string | null
}

export interface TabbyRowMatch {
  status: string
  reason?: string
  warnings: string[]
  order: {
    orderId: string
    orderNumber: string
    status: string | null
    paymentStatus: string | null
    paymentMethod: string | null
    total: number | null
    shopOrder: boolean
    createdAt: string | null
  } | null
  invoice: {
    invoiceId: string
    invoiceNumber: string
    status: string
    total: number
    balance: number
    customerId: string
  } | null
  customerId: string | null
  invoiceState: 'OPEN' | 'PAID' | 'PARTIALLY_PAID' | null
}

export interface TabbyRowRefund {
  code: string | null
  problem: string | null
  kind: string | null
  sequence: number | null
  priorRefunded: number
  cumulativeRefunded: number
  creditNote: {
    creditNoteId: string
    creditNoteNumber: string
    total: number
    balance: number
    how: string
  } | null
  creditNoteProblem: { code: string; message: string } | null
}

export interface TabbyRow {
  excelRow: number
  kind: 'SALE' | 'REFUND' | 'PAYOUT_FEE' | 'TOTAL' | 'NOTE' | 'UNKNOWN'
  subtype: string | null
  orderNumber: string
  websiteOrderId: string
  saleRefundDate: string | null
  transferDate: string | null
  productType: string | null
  fingerprint: string | null
  signNormalized: boolean
  amounts: Record<string, number>
  effects: Record<string, number> | null
  problems: TabbyIssue[]
  warnings?: TabbyIssue[]
  match: TabbyRowMatch | null
  refund: TabbyRowRefund | null
}

export interface TabbyComponentLine {
  role: string
  account: string
  accountId: string | null
  side: 'debit' | 'credit'
  amount: number
}

export interface TabbyComponent {
  key: string
  component: string
  phase: number
  scope: string
  zohoRecordType: string
  reference: string
  amount: number
  date: string
  customerId: string | null
  invoiceId: string | null
  invoiceNumber: string | null
  websiteOrderId: string | null
  creditNoteId: string | null
  creditNoteNumber: string | null
  depositAccount: string | null
  fromAccount: string | null
  toAccount: string | null
  lines: TabbyComponentLine[]
  direction: string | null
  sourceRows: number[]
  payload: Record<string, unknown> | null
  local: {
    id: string
    status: string
    zohoRecordId: string | null
    attemptCount: number
    lastError: string | null
    recoveryStatus: string | null
    uncertainSince: string | null
    recoveryCheckCount: number
    verifiedAt: string | null
  } | null
  zoho: { state: TabbyZohoState; recordId?: string | null; reason?: string } | null
  recovery: { action: TabbyRecoveryAction; code?: string; reason?: string }
}

export interface TabbyBankTransaction {
  transactionId: string
  date: string
  amount: number
  transactionType: string
  referenceNumber: string
  offsetAccountName: string
  status: string
  claimedBy?: string
}

export interface TabbyBank {
  status: TabbyBankStatus
  amount: number
  matched: TabbyBankTransaction | null
  candidates: TabbyBankTransaction[]
  skipped?: TabbyBankTransaction[]
  window?: { start: string; end: string }
  reason: string
  recordedByWorkflow?: boolean
  linkedTransactionId: string | null
}

export interface TabbyResolvedAccount {
  accountId: string
  accountName: string
  accountCode?: string | null
  accountType?: string
  label?: string
  source?: 'MAPPING' | 'EXACT_NAME' | 'KNOWN_EQUIVALENT'
}

export interface TabbyPreviewSections {
  settlement: {
    statementNumber: string
    statementDate: string | null
    transferDate: string | null
    companyName: string | null
    currency: string
    fileName: string | null
    fileHash: string
    rows: { sales: number; refunds: number; payoutFees: number }
    totalCheck?: unknown
  }
  sales: { count: number; gross: number; net: number; charges: number }
  commission: { refundable: number; nonRefundable: number; expense: number; refundReversal: number; net: number }
  fees: {
    transactionFixed: number
    rounding: number
    transactionTotalFee: number
    payoutFee: number
    refundReversal: number
    feesExpense: number
  }
  vat: { transaction: number; payout: number; refundReversal: number; inputVat: number }
  clearing: { account: string; in: number; out: number; afterSales: number; final: number; totalDeduction: number }
  undeposited: {
    account: string
    saleNet: number
    refunds: number
    prePayout: number
    payoutFeeAndVat: number
    bankPayout: number
    final: number
  }
  refunds: { count: number; gross: number; commissionReturned: number; feesReturned: number; vatReturned: number; transfer: number }
  matching: { matched: number; total: number; byStatus: Record<string, number>; customers: Record<string, number> }
  ledger: Record<string, Record<string, number>>
}

export interface TabbyPreview {
  batchId: string
  statementNumber: string
  date: string
  status: TabbyBatchStatus
  postingEnabled: boolean
  canPost: boolean
  fingerprint: string
  blockers: TabbyIssue[]
  warnings: TabbyIssue[]
  accounts: {
    resolved: Record<string, TabbyResolvedAccount>
    problems: Array<{ role: string; code: string; message: string; suggestions?: TabbyResolvedAccount[] }>
    mappings: TabbyAccountMapping[]
  }
  bank: TabbyBank
  sections: TabbyPreviewSections
  rows: TabbyRow[]
  components: TabbyComponent[]
  counts: { components: number; verified: number; toPost: number; uncertain: number; review: number }
}

export interface TabbyAccountMapping {
  role: string
  accountId: string
  accountName: string
  accountCode: string | null
  accountType: string
  updatedBy: string | null
  updatedAt: string | null
}

export interface TabbyChartAccount {
  accountId: string
  accountName: string
  accountCode: string
  accountType: string
}

export interface TabbyAccountRole {
  role: string
  label: string
  types: string[]
  resolved: TabbyResolvedAccount | null
  problem: { role: string; code: string; message: string; suggestions?: TabbyResolvedAccount[] } | null
  mapping: TabbyAccountMapping | null
}

export interface TabbyEvent {
  id: string
  componentId: string | null
  eventType: string
  fromStatus: string | null
  toStatus: string | null
  detail: string | null
  evidence: unknown
  actor: string | null
  at: string | null
}

export interface TabbyPostLogEntry {
  key: string
  component: string
  reference?: string
  amount?: number
  status: string
  zohoRecordId?: string
  code?: string
  message?: string
}

export type TabbyPostJobStatus = 'RUNNING' | 'SUCCEEDED' | 'STOPPED' | 'FAILED' | 'INTERRUPTED'

/** Background "Post to Zoho" run; the page polls it until it leaves RUNNING. */
export interface TabbyPostJob {
  id: string
  status: TabbyPostJobStatus
  statementNumber: string
  actor: string
  startedAt: string
  heartbeatAt: string
  finishedAt: string | null
  progress: { phase: 'QUEUED' | 'CHECKING' | 'POSTING' | 'FINISHING'; done: number; total: number | null; current: string | null }
  result: { status: TabbyBatchStatus; stoppedAt: string | null; stopReason: string | null; log: TabbyPostLogEntry[] } | null
  error: { status: number; code: string; message: string } | null
}

export interface TabbyUploadResult {
  result: 'IMPORTED' | 'ALREADY_IMPORTED'
  batchId: string
  preview: TabbyPreview
}

/** Error body the API attaches to failed requests (see client.js `err.body`). */
export interface TabbyApiErrorBody {
  error?: string
  code?: string
  problems?: TabbyIssue[]
  existing?: { batchId: string; fileName: string | null; fileHash: string; uploadedHash: string }
  preview?: TabbyPreview
  job?: TabbyPostJob
}

export function tabbyErrorBody(err: unknown): TabbyApiErrorBody | null {
  const body = (err as { body?: unknown } | null)?.body
  return body && typeof body === 'object' ? (body as TabbyApiErrorBody) : null
}

const BASE = '/api/tabby-clearing'

export function listTabbyBatches(): Promise<{ batches: TabbyBatch[]; postingEnabled: boolean }> {
  return api.get(`${BASE}/batches`)
}

export function uploadTabbyStatement(file: File): Promise<TabbyUploadResult> {
  const form = new FormData()
  form.append('file', file)
  return api.postForm(`${BASE}/upload`, form, { timeoutMs: TABBY_LONG_TIMEOUT_MS })
}

export function getTabbyPreview(batchId: string, opts: { deep?: boolean } = {}): Promise<{ preview: TabbyPreview }> {
  const q = opts.deep ? '?deep=1' : ''
  return api.get(`${BASE}/batches/${encodeURIComponent(batchId)}/preview${q}`, { timeoutMs: TABBY_LONG_TIMEOUT_MS })
}

/** Starts posting in the background; returns immediately with the RUNNING job. */
export function postTabbyBatch(batchId: string, fingerprint: string): Promise<{ job: TabbyPostJob }> {
  return api.post(`${BASE}/batches/${encodeURIComponent(batchId)}/post`, { fingerprint })
}

export function getTabbyPostJob(batchId: string): Promise<{ job: TabbyPostJob | null }> {
  return api.get(`${BASE}/batches/${encodeURIComponent(batchId)}/post-job`)
}

export function getTabbyActivity(batchId: string): Promise<{ events: TabbyEvent[] }> {
  return api.get(`${BASE}/batches/${encodeURIComponent(batchId)}/activity`)
}

export function chooseTabbyBankMatch(batchId: string, transactionId: string): Promise<{ preview: TabbyPreview }> {
  return api.post(`${BASE}/batches/${encodeURIComponent(batchId)}/bank-match`, { transactionId }, { timeoutMs: TABBY_LONG_TIMEOUT_MS })
}

export function getTabbyAccounts(): Promise<{ roles: TabbyAccountRole[]; chartAccounts: TabbyChartAccount[] }> {
  return api.get(`${BASE}/accounts`, { timeoutMs: TABBY_LONG_TIMEOUT_MS })
}

export function saveTabbyAccount(role: string, accountId: string): Promise<{ mapping: TabbyAccountMapping }> {
  return api.put(`${BASE}/accounts/${encodeURIComponent(role)}`, { accountId })
}

export function clearTabbyAccount(role: string): Promise<{ ok: true }> {
  return api.delete(`${BASE}/accounts/${encodeURIComponent(role)}`)
}
