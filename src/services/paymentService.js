/**
 * Company payments — API-ready service layer.
 * `useCompanyPayments` persists rows via `/api/user-preferences`.
 *
 * Example future usage:
 *   import { api } from '../api/client'
 *   export async function listPayments() {
 *     return api.get('/api/company-payments')
 *   }
 */

import { buildAnnualLeavePaymentPayload } from '../utils/paymentUtils'

export { buildAnnualLeavePaymentPayload }

/**
 * @typedef {import('../hooks/useCompanyPayments').CompanyPayment} CompanyPayment
 */

/** Reserved for server UUID when API exists */
export function isLocalPaymentId(id) {
  return String(id).startsWith('h_')
}
