const { query, ensureInfluencerContractPaymentsTable } = require('../db')

/** @typedef {'Not Due'|'Pending'|'Partially Paid'|'Paid'|'Overdue'|'Disputed'} ContractPaymentStatus */

const PAYMENT_STATUSES = Object.freeze([
  'Not Due',
  'Pending',
  'Partially Paid',
  'Paid',
  'Overdue',
  'Disputed',
])

/**
 * @param {unknown} value
 * @returns {string}
 */
function cleanText(value) {
  return String(value ?? '').trim()
}

/**
 * @param {unknown} value
 * @returns {number}
 */
function coerceAmount(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value)
  if (value == null || value === '') return 0
  const parsed = Number(String(value).replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0
}

/**
 * @param {unknown} value
 * @returns {string|null}
 */
function coerceDate(value) {
  const s = cleanText(value).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/**
 * @param {unknown} value
 * @returns {ContractPaymentStatus}
 */
function coerceStatus(value) {
  const status = cleanText(value)
  return /** @type {ContractPaymentStatus} */ (
    PAYMENT_STATUSES.includes(status) ? status : 'Not Due'
  )
}

/**
 * @param {Record<string, unknown>} row
 */
function mapRow(row) {
  return {
    contractId: String(row.contract_id),
    influencerId: String(row.influencer_id),
    amountPaid: Number(row.amount_paid || 0),
    paymentStatus: coerceStatus(row.payment_status),
    dueDate: row.due_date ? String(row.due_date).slice(0, 10) : null,
    paymentDate: row.payment_date ? String(row.payment_date).slice(0, 10) : null,
    invoiceReference: String(row.invoice_reference || ''),
    notes: String(row.notes || ''),
    zohoVendorBillId: row.zoho_vendor_bill_id ? String(row.zoho_vendor_bill_id) : null,
    zohoPaymentId: row.zoho_payment_id ? String(row.zoho_payment_id) : null,
    zohoLastSyncedAt: row.zoho_last_synced_at ? String(row.zoho_last_synced_at) : null,
    createdAt: row.created_at ? String(row.created_at) : null,
    updatedAt: row.updated_at ? String(row.updated_at) : null,
    updatedBy: row.updated_by ?? null,
  }
}

async function listContractPayments() {
  await ensureInfluencerContractPaymentsTable()
  const { rows } = await query(
    `SELECT contract_id, influencer_id, amount_paid, payment_status, due_date, payment_date,
            invoice_reference, notes, zoho_vendor_bill_id, zoho_payment_id, zoho_last_synced_at,
            created_at, updated_at, updated_by
     FROM influencer_contract_payments
     ORDER BY updated_at DESC`,
  )
  return rows.map(mapRow)
}

/**
 * @param {string} contractId
 */
async function getContractPayment(contractId) {
  await ensureInfluencerContractPaymentsTable()
  const id = cleanText(contractId)
  if (!id) return null
  const { rows } = await query(
    `SELECT contract_id, influencer_id, amount_paid, payment_status, due_date, payment_date,
            invoice_reference, notes, zoho_vendor_bill_id, zoho_payment_id, zoho_last_synced_at,
            created_at, updated_at, updated_by
     FROM influencer_contract_payments
     WHERE contract_id = $1`,
    [id],
  )
  return rows[0] ? mapRow(rows[0]) : null
}

/**
 * @param {{
 *   contractId: string
 *   influencerId: string
 *   amountPaid?: number
 *   paymentStatus?: string
 *   dueDate?: string|null
 *   paymentDate?: string|null
 *   invoiceReference?: string
 *   notes?: string
 * }} payload
 * @param {number|null|undefined} updatedByUserId
 */
async function ensureContractExists(contractId, influencerId) {
  await query(
    `INSERT INTO influencer_performance_contracts (id, influencer_id, platform, campaign_name, video_title, post_url, monitoring_days, body)
     VALUES ($1, $2, '', '', 'Contracted video', '', 5, '{}'::jsonb)
     ON CONFLICT (id) DO NOTHING`,
    [contractId, influencerId],
  )
}

async function upsertContractPayment(payload, updatedByUserId) {
  await ensureInfluencerContractPaymentsTable()
  const contractId = cleanText(payload.contractId)
  const influencerId = cleanText(payload.influencerId)
  if (!contractId || !influencerId) {
    throw new Error('contractId and influencerId are required')
  }

  await ensureContractExists(contractId, influencerId)

  const existing = await getContractPayment(contractId)
  const amountPaid = payload.amountPaid != null ? coerceAmount(payload.amountPaid) : (existing?.amountPaid ?? 0)
  const paymentStatus = payload.paymentStatus != null
    ? coerceStatus(payload.paymentStatus)
    : (existing?.paymentStatus ?? 'Not Due')
  const dueDate = payload.dueDate !== undefined ? coerceDate(payload.dueDate) : (existing?.dueDate ?? null)
  const paymentDate = payload.paymentDate !== undefined ? coerceDate(payload.paymentDate) : (existing?.paymentDate ?? null)
  const invoiceReference = payload.invoiceReference != null
    ? cleanText(payload.invoiceReference)
    : (existing?.invoiceReference ?? '')
  const notes = payload.notes != null ? cleanText(payload.notes) : (existing?.notes ?? '')

  await query(
    `INSERT INTO influencer_contract_payments
       (contract_id, influencer_id, amount_paid, payment_status, due_date, payment_date,
        invoice_reference, notes, updated_at, updated_by)
     VALUES ($1, $2, $3, $4, $5::date, $6::date, $7, $8, NOW(), $9)
     ON CONFLICT (contract_id) DO UPDATE SET
       influencer_id = EXCLUDED.influencer_id,
       amount_paid = EXCLUDED.amount_paid,
       payment_status = EXCLUDED.payment_status,
       due_date = EXCLUDED.due_date,
       payment_date = EXCLUDED.payment_date,
       invoice_reference = EXCLUDED.invoice_reference,
       notes = EXCLUDED.notes,
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by`,
    [contractId, influencerId, amountPaid, paymentStatus, dueDate, paymentDate, invoiceReference, notes, updatedByUserId ?? null],
  )

  return getContractPayment(contractId)
}

module.exports = {
  PAYMENT_STATUSES,
  listContractPayments,
  getContractPayment,
  upsertContractPayment,
}
