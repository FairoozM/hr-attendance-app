import { api } from './client'
import type { InfluencerContractPayment } from '../types/influencer'

type ContractPaymentsResponse = {
  payments?: InfluencerContractPayment[]
}

export type InfluencerContractPaymentPatch = {
  influencerId: string
  amountPaid?: number
  paymentStatus?: string
  dueDate?: string | null
  paymentDate?: string | null
  invoiceReference?: string
  notes?: string
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parsePayment(row: Record<string, unknown>): InfluencerContractPayment {
  return {
    contractId: String(row.contractId || ''),
    influencerId: String(row.influencerId || ''),
    amountPaid: Number(row.amountPaid || 0),
    paymentStatus: String(row.paymentStatus || 'Not Due'),
    dueDate: row.dueDate ? String(row.dueDate).slice(0, 10) : null,
    paymentDate: row.paymentDate ? String(row.paymentDate).slice(0, 10) : null,
    invoiceReference: String(row.invoiceReference || ''),
    notes: String(row.notes || ''),
    zohoVendorBillId: row.zohoVendorBillId ? String(row.zohoVendorBillId) : null,
    zohoPaymentId: row.zohoPaymentId ? String(row.zohoPaymentId) : null,
    zohoLastSyncedAt: row.zohoLastSyncedAt ? String(row.zohoLastSyncedAt) : null,
    createdAt: row.createdAt ? String(row.createdAt) : undefined,
    updatedAt: row.updatedAt ? String(row.updatedAt) : undefined,
    updatedBy: typeof row.updatedBy === 'number' ? row.updatedBy : null,
  }
}

export async function fetchInfluencerContractPayments(): Promise<InfluencerContractPayment[]> {
  const data = await api.get('/api/influencers/contract-payments') as ContractPaymentsResponse
  if (!isPlainObject(data)) return []
  const rows: unknown[] = Array.isArray(data.payments) ? data.payments : []
  return rows
    .filter((row: unknown): row is Record<string, unknown> => isPlainObject(row))
    .map(parsePayment)
}

export async function patchInfluencerContractPayment(
  contractId: string,
  body: InfluencerContractPaymentPatch,
): Promise<InfluencerContractPayment> {
  const data = await api.patch(
    `/api/influencers/contract-payments/${encodeURIComponent(contractId)}`,
    body,
  ) as { payment?: Record<string, unknown> }
  if (!isPlainObject(data?.payment)) {
    throw new Error('Invalid payment update response')
  }
  return parsePayment(data.payment)
}
