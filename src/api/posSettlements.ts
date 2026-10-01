import { api } from './client'

/** RRN indexing reads Zoho invoices, so previews can take a while. Posting runs as a background job. */
export const POS_LONG_TIMEOUT_MS = 180_000

export type PosChannel = 'WEBSITE' | 'WEB_APP' | 'BURJUMAN_SHOP' | 'UNKNOWN'
export type PosSourceFormat = 'ENRICH_CSV' | 'SIMPLE_CSV' | 'DETAIL_TXT' | 'MSA'

export type PosSettlementStatus =
  | 'IMPORTED'
  | 'READY'
  | 'BLOCKED'
  | 'POSTING'
  | 'PARTIALLY_POSTED'
  | 'POSTED'
  | 'NEEDS_REVIEW'

export type PosBankStatus =
  | 'BANK_MATCHED'
  | 'BANK_DEPOSIT_SEEN'
  | 'BANK_DEPOSIT_NOT_FOUND'
  | 'BANK_MATCH_AMBIGUOUS'
  | 'BANK_LOOKUP_FAILED'
  | 'BANK_NOT_REQUIRED'

export type PosRecoveryAction =
  | 'SKIP_VERIFIED'
  | 'POST_ELIGIBLE'
  | 'RETRY_ELIGIBLE'
  | 'WAIT_UNCERTAIN'
  | 'RECHECK_THEN_RETRY'
  | 'NEEDS_REVIEW'
  | 'LOOKUP_FAILED'

export interface PosIssue {
  code: string
  message: string
  scope?: string
  transactionId?: string
  invoiceId?: string
  rrn?: string
  key?: string
  conflictId?: string
}

export interface PosApproval {
  fingerprint: string
  by: string
  at: string
  note: string | null
  totals: PosTotals
  components: Array<{ key: string; amount: number; reference: string }>
}

export interface PosTotals {
  count: number
  gross: number
  commission: number
  otherFees: number
  vat: number
  charges: number
  net: number
}

export interface PosChannelTotals {
  count: number
  gross: number
  commission: number
  vat: number
  net: number
}

export interface PosSettlement {
  id: string
  provider: string
  payoutKey: string
  settlementCode: string
  basis: string
  payoutDate: string | null
  currency: string
  status: PosSettlementStatus
  review: {
    at: string
    status: PosSettlementStatus
    fingerprint: string
    blockers: number
    warnings: number
    bankStatus: PosBankStatus
    feeStatus: string
    totals: PosTotals
    byChannel: Record<string, PosChannelTotals>
  } | null
  approval: PosApproval | null
  bankStatus: PosBankStatus | null
  bankTransactionId: string | null
  postingJob: PosPostJob | null
  createdAt: string | null
  updatedAt: string | null
  postedAt: string | null
  transactionTotals?: { count: number; gross: number; net: number } | null
}

export interface PosFile {
  id: string
  fileHash: string
  fileName: string | null
  sourceFormat: PosSourceFormat
  role: string
  transactionCount: number
  newCount: number
  duplicateCount: number
  conflictCount: number
  importedBy: string | null
  createdAt: string | null
}

export interface PosAllocation {
  invoiceId: string
  invoiceNumber: string
  customerId?: string
  customerName?: string
  grossMinor?: number
  gross?: number
  amount?: number
}

export interface PosInvoiceRef {
  invoiceId: string
  invoiceNumber: string
  referenceNumber: string
  customerId: string
  customerName: string
  date: string
  status: string
  totalMinor: number
  balanceMinor: number
  currencyCode: string
}

export interface PosManualMapping {
  id: string
  transactionId: string
  rrn: string | null
  allocations: PosAllocation[]
  autoResult: { status: string; reason: string; at: string } | null
  reason: string
  state: 'ACTIVE' | 'REVOKED'
  createdBy: string
  createdAt: string | null
  revokedBy: string | null
  revokedAt: string | null
  revokeReason: string | null
}

export interface PosTransaction {
  id: string
  sourceRow: number
  fileId: string
  merchantId: string | null
  terminalId: string | null
  rrn: string | null
  stan: string | null
  authCode: string | null
  transactionType: string
  transactionDate: string | null
  transactionTime: string | null
  batchNumber: string | null
  cardScheme: string | null
  maskedCard: string | null
  gross: number | null
  commission: number | null
  otherFees: number | null
  vat: number | null
  net: number | null
  netDerived: boolean
  match: {
    status: string
    reason: string
    matched: boolean
    allocations: PosAllocation[]
    candidates: PosInvoiceRef[] | null
    possible: PosInvoiceRef[]
  }
  manualMapping: PosManualMapping | null
  channel: PosChannel
  channelSource: string | null
  channelEvidence: unknown[]
  order: { orderNumber: string; shopOrder: boolean; userAgent: string | null; paymentMethod: string } | null
  problems: PosIssue[]
  warnings: PosIssue[]
}

export interface PosInactiveTransaction {
  id: string
  rrn: string | null
  status: 'DUPLICATE' | 'CONFLICT' | 'DISMISSED'
  sourceRow: number
  duplicateOf: string | null
  conflictWith: string | null
  conflictFields: string[] | null
}

export interface PosInvoiceAssessment {
  invoiceId: string
  invoiceNumber: string
  customerId: string
  mode: 'NEW' | 'EXISTING_RECEIPTS' | 'BLOCKED'
  total: number
  balance: number
  gross: number
  net: number
  fee: number
  reclass: number
  partial: boolean
  problem: PosIssue | null
}

export interface PosComponentLine {
  role: string
  account: string
  accountId: string | null
  side: 'debit' | 'credit'
  amount: number
}

export interface PosComponent {
  key: string
  component: 'RECEIPT_NET' | 'RECEIPT_FEE' | 'RECEIPT_RECLASS' | 'FEE_RECOGNITION' | 'BANK_CLEARING'
  phase: number
  scope: string
  zohoRecordType: string
  reference: string
  amount: number
  date: string
  customerId: string | null
  allocations: Array<{ invoiceId: string; invoiceNumber: string; amount: number }>
  depositAccount: string | null
  fromAccount: string | null
  toAccount: string | null
  lines: PosComponentLine[]
  payload: Record<string, unknown> | null
  local: {
    id: string
    status: string
    zohoRecordId: string | null
    attemptCount: number
    lastError: string | null
    recoveryStatus: string | null
    uncertainSince: string | null
    verifiedAt: string | null
  } | null
  zoho: { state: string; recordId?: string | null; reason?: string } | null
  recovery: { action: PosRecoveryAction; code?: string; reason?: string }
}

export interface PosBankTransaction {
  transactionId: string
  date: string
  amount: number
  transactionType: string
  referenceNumber: string
  offsetAccountName: string
  status: string
  claimedBy?: string
}

export interface PosBank {
  status: PosBankStatus
  amount: number
  matched: PosBankTransaction | null
  candidates?: PosBankTransaction[]
  skipped?: PosBankTransaction[]
  deposit?: PosBankTransaction
  window?: { start: string; end: string }
  date?: string
  reason: string
  recordedByWorkflow?: boolean
  linkedTransactionId: string | null
}

export interface PosResolvedAccount {
  accountId: string
  accountName: string
  accountCode?: string | null
  accountType?: string
  label?: string
  source?: 'MAPPING' | 'EXACT_NAME' | 'KNOWN_EQUIVALENT'
}

export interface PosPreview {
  settlementId: string
  settlementCode: string
  payoutKey: string
  basis: string
  payoutDate: string
  status: PosSettlementStatus
  postingEnabled: boolean
  approval: PosApproval | null
  approved: boolean
  canApprove: boolean
  canPost: boolean
  fingerprint: string
  blockers: PosIssue[]
  warnings: PosIssue[]
  accounts: { resolved: Record<string, PosResolvedAccount>; problems: Array<{ role: string; code: string; message: string }> }
  totals: PosTotals
  byChannel: Record<string, PosChannelTotals>
  merchants: string[]
  terminals: string[]
  batches: string[]
  firstDate: string | null
  lastDate: string | null
  transactions: PosTransaction[]
  inactiveTransactions: PosInactiveTransaction[]
  invoices: PosInvoiceAssessment[]
  bank: PosBank
  feeRecognition: { status: string; reason: string; recordedByWorkflow?: boolean; record?: PosBankTransaction }
  components: PosComponent[]
  ledger: Record<string, { account: string; balance: number }>
  rrnIndex: { window: { dateFrom: string; dateTo: string }; stats: Record<string, number> | null }
  counts: { transactions: number; matched: number; components: number; verified: number; toPost: number; review: number }
  zohoCalls: number | null
}

export interface PosPostLogEntry {
  key: string
  component: string
  reference?: string
  amount?: number
  status: string
  zohoRecordId?: string
  code?: string
  message?: string
}

export type PosPostJobStatus = 'RUNNING' | 'SUCCEEDED' | 'STOPPED' | 'FAILED' | 'INTERRUPTED'

export interface PosPostJob {
  id: string
  status: PosPostJobStatus
  settlementCode: string
  actor: string
  startedAt: string
  heartbeatAt: string
  finishedAt: string | null
  progress: { phase: 'QUEUED' | 'CHECKING' | 'POSTING' | 'FINISHING'; done: number; total: number | null; current: string | null }
  result: { status: PosSettlementStatus; stoppedAt: string | null; stopReason: string | null; log: PosPostLogEntry[] } | null
  error: { status: number; code: string; message: string } | null
}

export interface PosUploadResult {
  result: 'IMPORTED' | 'ALREADY_IMPORTED'
  role: 'TRANSACTIONS' | 'CONTROL'
  file: PosFile
  settlementIds: string[]
  counts?: { NEW: number; DUPLICATE: number; CONFLICT: number }
  warnings: PosIssue[]
}

export interface PosTerminalMapping {
  id: string
  merchantId: string
  terminalId: string | null
  channel: PosChannel
  location: string | null
  notes: string | null
  active: boolean
  createdBy: string | null
  createdAt: string | null
}

export interface PosAccountRole {
  role: string
  label: string
  types: string[]
  resolved: PosResolvedAccount | null
  problem: { role: string; code: string; message: string; suggestions?: PosResolvedAccount[] } | null
  mapping: { role: string; accountId: string; accountName: string; accountCode: string | null } | null
}

export interface PosChartAccount {
  accountId: string
  accountName: string
  accountCode: string
  accountType: string
}

export interface PosEvent {
  id: string
  componentId: string | null
  transactionId: string | null
  eventType: string
  fromStatus: string | null
  toStatus: string | null
  detail: string | null
  actor: string | null
  at: string | null
}

export interface PosApiErrorBody {
  error?: string
  code?: string
  problems?: PosIssue[]
  preview?: PosPreview
  job?: PosPostJob
}

export function posErrorBody(err: unknown): PosApiErrorBody | null {
  const body = (err as { body?: unknown } | null)?.body
  return body && typeof body === 'object' ? (body as PosApiErrorBody) : null
}

const BASE = '/api/pos-settlements'
const id = (v: string) => encodeURIComponent(v)

export function listPosSettlements(): Promise<{ settlements: PosSettlement[]; files: PosFile[]; postingEnabled: boolean; sourceFormats: PosSourceFormat[] }> {
  return api.get(`${BASE}/settlements`)
}

export function uploadPosFile(file: File, sourceFormat: PosSourceFormat): Promise<PosUploadResult> {
  const form = new FormData()
  form.append('file', file)
  form.append('sourceFormat', sourceFormat)
  return api.postForm(`${BASE}/upload`, form, { timeoutMs: POS_LONG_TIMEOUT_MS })
}

export function getPosPreview(settlementId: string, opts: { deep?: boolean; deepScan?: boolean } = {}): Promise<{ preview: PosPreview }> {
  const q = new URLSearchParams()
  if (opts.deep) q.set('deep', '1')
  if (opts.deepScan) q.set('deepScan', '1')
  const qs = q.toString()
  return api.get(`${BASE}/settlements/${id(settlementId)}/preview${qs ? `?${qs}` : ''}`, { timeoutMs: POS_LONG_TIMEOUT_MS })
}

export function approvePosSettlement(settlementId: string, fingerprint: string, note: string): Promise<{ approval: PosApproval; preview: PosPreview }> {
  return api.post(`${BASE}/settlements/${id(settlementId)}/approve`, { fingerprint, note }, { timeoutMs: POS_LONG_TIMEOUT_MS })
}

export function revokePosApproval(settlementId: string, reason: string): Promise<{ ok: true }> {
  return api.delete(`${BASE}/settlements/${id(settlementId)}/approval?reason=${encodeURIComponent(reason)}`)
}

/** Starts posting in the background; returns immediately with the RUNNING job. */
export function postPosSettlement(settlementId: string, fingerprint: string): Promise<{ job: PosPostJob }> {
  return api.post(`${BASE}/settlements/${id(settlementId)}/post`, { fingerprint })
}

export function getPosPostJob(settlementId: string): Promise<{ job: PosPostJob | null }> {
  return api.get(`${BASE}/settlements/${id(settlementId)}/post-job`)
}

export function getPosActivity(settlementId: string): Promise<{ events: PosEvent[] }> {
  return api.get(`${BASE}/settlements/${id(settlementId)}/activity`)
}

export function linkPosBank(settlementId: string, transactionId: string): Promise<{ preview: PosPreview }> {
  return api.post(`${BASE}/settlements/${id(settlementId)}/bank-link`, { transactionId }, { timeoutMs: POS_LONG_TIMEOUT_MS })
}

export function unlinkPosBank(settlementId: string): Promise<{ ok: true }> {
  return api.delete(`${BASE}/settlements/${id(settlementId)}/bank-link`)
}

export function dismissPosConflict(transactionId: string, reason: string): Promise<{ transaction: unknown }> {
  return api.post(`${BASE}/transactions/${id(transactionId)}/dismiss-conflict`, { reason })
}

export function searchPosInvoices(q: string): Promise<{ invoices: PosInvoiceRef[] }> {
  return api.get(`${BASE}/invoices/search?q=${encodeURIComponent(q)}`, { timeoutMs: POS_LONG_TIMEOUT_MS })
}

export function getPosManualMappings(transactionId: string): Promise<{ mappings: PosManualMapping[] }> {
  return api.get(`${BASE}/transactions/${id(transactionId)}/manual-mappings`)
}

export function savePosManualMapping(transactionId: string, allocations: Array<{ invoiceId: string; amount: string }>, reason: string): Promise<{ mapping: PosManualMapping }> {
  return api.post(`${BASE}/transactions/${id(transactionId)}/manual-mapping`, { allocations, reason }, { timeoutMs: POS_LONG_TIMEOUT_MS })
}

export function revokePosManualMapping(mappingId: string, reason: string): Promise<{ mapping: PosManualMapping }> {
  return api.delete(`${BASE}/manual-mappings/${id(mappingId)}?reason=${encodeURIComponent(reason)}`)
}

export function listPosTerminals(): Promise<{ terminals: PosTerminalMapping[]; channels: PosChannel[] }> {
  return api.get(`${BASE}/terminals`)
}

export function savePosTerminal(t: { merchantId: string; terminalId: string; channel: PosChannel; location: string; notes: string }): Promise<{ terminal: PosTerminalMapping }> {
  return api.post(`${BASE}/terminals`, t)
}

export function removePosTerminal(terminalMappingId: string): Promise<{ ok: true }> {
  return api.delete(`${BASE}/terminals/${id(terminalMappingId)}`)
}

export function getPosAccounts(): Promise<{ roles: PosAccountRole[]; chartAccounts: PosChartAccount[] }> {
  return api.get(`${BASE}/accounts`, { timeoutMs: POS_LONG_TIMEOUT_MS })
}

export function savePosAccount(role: string, accountId: string): Promise<{ mapping: unknown }> {
  return api.put(`${BASE}/accounts/${id(role)}`, { accountId })
}

export function clearPosAccount(role: string): Promise<{ ok: true }> {
  return api.delete(`${BASE}/accounts/${id(role)}`)
}
