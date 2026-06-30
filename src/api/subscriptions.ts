import { api } from './client'

export interface SubscriptionInvoice {
  id: string
  subscriptionId: string
  fileName: string
  fileUrl: string
  s3Key: string
  amount: number | null
  currency: string
  uploadedBy: number | null
  uploadedAt: string
  notes: string
}

export interface SubscriptionActivityLog {
  id: string
  subscriptionId: string
  action: string
  message: string
  metadata: Record<string, unknown>
  createdBy: number | null
  createdAt: string
}

export interface Subscription {
  id: string
  name: string
  vendor: string
  category: string
  status: string
  billingCycle: string
  cost: number
  currency: string
  startDate: string | null
  expiryDate: string | null
  autoRenew: boolean
  responsiblePerson: string
  invoiceRequired: boolean
  invoiceStatus: string
  paymentStatus: string
  paymentSentAt: string | null
  paymentSentBy: number | null
  notes: string
  daysRemaining: number | null
  daysRemainingLabel: string
  invoiceCount: number
  invoices?: SubscriptionInvoice[]
  activityLogs?: SubscriptionActivityLog[]
  createdAt: string
  updatedAt: string
}

export interface SubscriptionSummary {
  totalSubscriptions: number
  monthlyCost: number
  annualizedCost: number
  expiringIn30Days: number
  expired: number
  missingInvoices: number
  pendingPayments: number
}

export interface SubscriptionFormPayload {
  name: string
  vendor?: string
  category: string
  billingCycle: string
  cost: number
  currency?: string
  startDate?: string | null
  expiryDate?: string | null
  autoRenew?: boolean
  responsiblePerson?: string
  invoiceRequired?: boolean
  notes?: string
}

function toPayload(form: SubscriptionFormPayload) {
  return {
    name: form.name.trim(),
    vendor: (form.vendor || '').trim(),
    category: form.category,
    billing_cycle: form.billingCycle,
    cost: Number(form.cost) || 0,
    currency: form.currency || 'AED',
    start_date: form.startDate || null,
    expiry_date: form.expiryDate || null,
    auto_renew: !!form.autoRenew,
    responsible_person: (form.responsiblePerson || '').trim(),
    invoice_required: form.invoiceRequired ?? true,
    notes: (form.notes || '').trim(),
  }
}

export async function fetchSubscriptions(): Promise<Subscription[]> {
  const data = await api.get('/api/subscriptions')
  return Array.isArray(data) ? data : []
}

export async function fetchSubscriptionSummary(): Promise<SubscriptionSummary> {
  return api.get('/api/subscriptions/summary') as Promise<SubscriptionSummary>
}

export async function fetchSubscription(id: string): Promise<Subscription> {
  return api.get(`/api/subscriptions/${id}`) as Promise<Subscription>
}

export async function createSubscription(form: SubscriptionFormPayload): Promise<Subscription> {
  return api.post('/api/subscriptions', toPayload(form)) as Promise<Subscription>
}

export async function updateSubscription(id: string, form: SubscriptionFormPayload): Promise<Subscription> {
  return api.put(`/api/subscriptions/${id}`, toPayload(form)) as Promise<Subscription>
}

export async function deleteSubscription(id: string): Promise<void> {
  await api.delete(`/api/subscriptions/${id}`)
}

export async function uploadSubscriptionInvoice(
  id: string,
  file: File,
  opts: { amount?: number; currency?: string; notes?: string } = {}
): Promise<SubscriptionInvoice> {
  const form = new FormData()
  form.append('file', file)
  if (opts.amount != null) form.append('amount', String(opts.amount))
  if (opts.currency) form.append('currency', opts.currency)
  if (opts.notes) form.append('notes', opts.notes)
  return api.postForm(`/api/subscriptions/${id}/invoices`, form) as Promise<SubscriptionInvoice>
}

export async function getInvoiceDownloadUrl(
  subscriptionId: string,
  invoiceId: string
): Promise<{ url: string; fileName: string }> {
  return api.get(`/api/subscriptions/${subscriptionId}/invoices/${invoiceId}/download-url`) as Promise<{
    url: string
    fileName: string
  }>
}

export async function previewPaymentGroupMessage(id: string): Promise<{ message: string }> {
  return api.post(`/api/subscriptions/${id}/send-to-payment-group`, {}) as Promise<{ message: string }>
}

export async function confirmSendToPaymentGroup(id: string): Promise<{ message: string; subscription: Subscription }> {
  return api.post(`/api/subscriptions/${id}/send-to-payment-group`, { confirm: true }) as Promise<{
    message: string
    subscription: Subscription
  }>
}

export async function markSubscriptionPaid(id: string): Promise<Subscription> {
  return api.post(`/api/subscriptions/${id}/mark-paid`, {}) as Promise<Subscription>
}

export async function renewSubscription(id: string): Promise<Subscription> {
  return api.post(`/api/subscriptions/${id}/renew`, {}) as Promise<Subscription>
}
