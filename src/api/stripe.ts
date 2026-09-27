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

export type StripeClearingStatus = 'READY' | 'POSTING' | 'POSTED' | 'FAILED' | 'BLOCKED' | 'FAILED_NEEDS_REVIEW'

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

export interface StripeClearingRecord {
  status: StripeClearingStatus
  paymentIntentId: string
  websiteOrderNumber: string
  zohoInvoiceId: string
  zohoInvoiceNumber: string
  zohoPaymentId: string | null
  amount: number
  currency: string
  paymentDate: string
  attemptCount: number
  lastError: string | null
  postedAt: string | null
}

export interface StripeClearingPreview {
  outcome: 'PREVIEW'
  postingEnabled: boolean
  postingBlockedReasons: Array<{ code: string; message: string }>
  paymentIntentId: string
  websiteOrderNumber: string
  zohoInvoiceNumber: string
  zohoInvoiceBalance: number
  amount: number
  currency: string
  paymentDate: string
  zohoCustomer: { id: string; name: string }
  zohoAccount: { accountId: string; accountName: string; accountCode: string }
}

export interface StripeClearingPostResult {
  outcome: 'POSTED' | 'RECOVERED' | 'ALREADY_POSTED' | 'ALREADY_CLEARED_RECORDED'
  clearing: StripeClearingRecord
  invoiceBalanceBefore?: number | null
  invoiceBalanceAfter?: number | null
}

export interface StripeClearingDetail {
  clearing: StripeClearingRecord | null
  zohoInvoice: { invoiceId: string; invoiceNumber: string; status: string; total: number; balance: number } | null
}

export function getStripeClearingDryRun(params: { from: string; to: string; source: 'stripe' | 'website' }) {
  const query = new URLSearchParams(params).toString()
  return api.get(`/api/stripe/clearing/dry-run?${query}`) as Promise<StripeClearingDryRun>
}

export function previewStripeClearing(paymentIntentId: string) {
  return api.get(`/api/stripe/clearing/${encodeURIComponent(paymentIntentId)}/preview`) as Promise<StripeClearingPreview>
}

export function postStripeClearing(paymentIntentId: string) {
  return api.post(`/api/stripe/clearing/${encodeURIComponent(paymentIntentId)}/post`, {}) as Promise<StripeClearingPostResult>
}

export function getStripeClearing(paymentIntentId: string) {
  return api.get(`/api/stripe/clearing/${encodeURIComponent(paymentIntentId)}`) as Promise<StripeClearingDetail>
}

export function getStripeStatus() {
  return api.get('/api/stripe/status') as Promise<StripeConnectionStatus>
}

export function testStripeConnection() {
  return api.post('/api/stripe/connection-test', {}) as Promise<StripeConnectionTestResult>
}
