/**
 * Future Zoho Books payment reconciliation for influencer contract payments.
 * Not integrated in this phase — structure only.
 */
import type { InfluencerContractPayment } from '../types/influencer'

export type InfluencerPaymentReconciliationResult = {
  contractId: string
  matched: boolean
  zohoVendorBillId?: string | null
  zohoPaymentId?: string | null
  message: string
}

export type InfluencerPaymentReconciliationService = {
  isEnabled: () => boolean
  syncContractPayment: (contractId: string) => Promise<InfluencerPaymentReconciliationResult>
  syncAllOutstanding: () => Promise<InfluencerPaymentReconciliationResult[]>
}

function notConfigured(contractId: string): InfluencerPaymentReconciliationResult {
  return {
    contractId,
    matched: false,
    message: 'Zoho reconciliation is not configured for influencer payments yet.',
  }
}

/** Placeholder implementation — wire to Zoho Books when finance integration is approved. */
export const influencerPaymentReconciliationService: InfluencerPaymentReconciliationService = {
  isEnabled: () => false,
  async syncContractPayment(contractId) {
    return notConfigured(contractId)
  },
  async syncAllOutstanding() {
    return []
  },
}

export function describeZohoPaymentState(payment: InfluencerContractPayment): string | null {
  if (payment.zohoPaymentId) return `Zoho payment ${payment.zohoPaymentId}`
  if (payment.zohoVendorBillId) return `Zoho bill ${payment.zohoVendorBillId}`
  return null
}
