const { query } = require('../db')
const s3Service = require('./s3Service')
const {
  computeStatus,
  getDaysLeft,
  formatDaysRemaining,
  monthlyCost,
  addBillingPeriod,
  CATEGORIES,
  BILLING_CYCLES,
} = require('./subscriptionUtils')

const SUBSCRIPTION_FIELDS = `
  s.id,
  s.name,
  s.vendor,
  s.category,
  s.status,
  s.billing_cycle,
  s.cost,
  s.currency,
  to_char(s.start_date, 'YYYY-MM-DD') AS start_date,
  to_char(s.expiry_date, 'YYYY-MM-DD') AS expiry_date,
  s.auto_renew,
  s.responsible_person,
  s.invoice_required,
  s.invoice_status,
  s.payment_status,
  s.payment_sent_at,
  s.payment_sent_by,
  s.notes,
  s.created_by,
  s.updated_by,
  s.created_at,
  s.updated_at,
  s.deleted_at
`

async function logActivity(subscriptionId, action, message, userId, metadata = {}) {
  await query(
    `INSERT INTO subscription_activity_logs (subscription_id, action, message, metadata_json, created_by)
     VALUES ($1, $2, $3, $4::jsonb, $5)`,
    [subscriptionId, action, message, JSON.stringify(metadata || {}), userId ?? null]
  )
}

async function findInvoices(subscriptionId) {
  const result = await query(
    `SELECT id, subscription_id, file_name, file_url, s3_key, amount, currency,
            uploaded_by, uploaded_at, notes
     FROM subscription_invoices
     WHERE subscription_id = $1
     ORDER BY uploaded_at DESC, id DESC`,
    [subscriptionId]
  )
  return result.rows
}

async function findActivityLogs(subscriptionId) {
  const result = await query(
    `SELECT id, subscription_id, action, message, metadata_json, created_by, created_at
     FROM subscription_activity_logs
     WHERE subscription_id = $1
     ORDER BY created_at DESC, id DESC
     LIMIT 100`,
    [subscriptionId]
  )
  return result.rows
}

async function findAll() {
  const result = await query(
    `SELECT ${SUBSCRIPTION_FIELDS},
            (SELECT COUNT(*)::int FROM subscription_invoices si WHERE si.subscription_id = s.id) AS invoice_count
     FROM subscriptions s
     WHERE s.deleted_at IS NULL
     ORDER BY s.expiry_date ASC NULLS LAST, s.name ASC`
  )
  return result.rows.map(enrichRow)
}

async function findById(id) {
  const result = await query(
    `SELECT ${SUBSCRIPTION_FIELDS},
            (SELECT COUNT(*)::int FROM subscription_invoices si WHERE si.subscription_id = s.id) AS invoice_count
     FROM subscriptions s
     WHERE s.id = $1 AND s.deleted_at IS NULL`,
    [id]
  )
  const row = result.rows[0]
  if (!row) return null
  const enriched = enrichRow(row)
  const [invoices, activityLogs] = await Promise.all([
    findInvoices(id),
    findActivityLogs(id),
  ])
  enriched.invoices = invoices
  enriched.activityLogs = activityLogs
  return enriched
}

function enrichRow(row) {
  const status = computeStatus(row.expiry_date)
  return {
    ...row,
    status,
    days_remaining: getDaysLeft(row.expiry_date),
    days_remaining_label: formatDaysRemaining(row.expiry_date),
    invoice_count: Number(row.invoice_count) || 0,
  }
}

async function create(payload, userId) {
  const status = computeStatus(payload.expiry_date)
  const result = await query(
    `INSERT INTO subscriptions (
      name, vendor, category, status, billing_cycle, cost, currency,
      start_date, expiry_date, auto_renew, responsible_person,
      invoice_required, invoice_status, payment_status, notes,
      created_by, updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
    RETURNING ${SUBSCRIPTION_FIELDS}`,
    [
      payload.name,
      payload.vendor,
      payload.category,
      status,
      payload.billing_cycle,
      payload.cost,
      payload.currency,
      payload.start_date || null,
      payload.expiry_date || null,
      payload.auto_renew,
      payload.responsible_person,
      payload.invoice_required,
      payload.invoice_status,
      payload.payment_status,
      payload.notes,
      userId ?? null,
    ]
  )
  const row = enrichRow(result.rows[0])
  await logActivity(row.id, 'created', `Subscription "${row.name}" created`, userId)
  return row
}

async function update(id, payload, userId) {
  const status = computeStatus(payload.expiry_date)
  const result = await query(
    `UPDATE subscriptions SET
      name = $2, vendor = $3, category = $4, status = $5, billing_cycle = $6,
      cost = $7, currency = $8, start_date = $9, expiry_date = $10,
      auto_renew = $11, responsible_person = $12, invoice_required = $13,
      invoice_status = $14, payment_status = $15, notes = $16,
      updated_by = $17, updated_at = NOW()
     WHERE id = $1 AND deleted_at IS NULL
     RETURNING ${SUBSCRIPTION_FIELDS}`,
    [
      id,
      payload.name,
      payload.vendor,
      payload.category,
      status,
      payload.billing_cycle,
      payload.cost,
      payload.currency,
      payload.start_date || null,
      payload.expiry_date || null,
      payload.auto_renew,
      payload.responsible_person,
      payload.invoice_required,
      payload.invoice_status,
      payload.payment_status,
      payload.notes,
      userId ?? null,
    ]
  )
  const row = result.rows[0]
  if (!row) return null
  const enriched = enrichRow(row)
  await logActivity(id, 'updated', `Subscription "${enriched.name}" updated`, userId)
  return enriched
}

async function softDelete(id, userId) {
  const existing = await findById(id)
  if (!existing) return false
  await query(
    `UPDATE subscriptions SET deleted_at = NOW(), updated_by = $2, updated_at = NOW() WHERE id = $1`,
    [id, userId ?? null]
  )
  await logActivity(id, 'deleted', `Subscription "${existing.name}" deleted`, userId)
  return true
}

async function getSummary() {
  const rows = await findAll()
  let monthlyTotal = 0
  let expiringIn30 = 0
  let expired = 0
  let missingInvoices = 0
  let pendingPayments = 0

  for (const row of rows) {
    monthlyTotal += monthlyCost(row.cost, row.billing_cycle)
    const days = getDaysLeft(row.expiry_date)
    if (days !== null && days < 0) expired++
    else if (days !== null && days <= 30) expiringIn30++
    if (row.invoice_required && row.invoice_count === 0 && row.invoice_status === 'Missing') {
      missingInvoices++
    }
    if (row.payment_status === 'Payment Requested' || row.payment_status === 'Unpaid') {
      if (days !== null && days <= 30) pendingPayments++
    }
  }

  return {
    totalSubscriptions: rows.length,
    monthlyCost: Math.round(monthlyTotal * 100) / 100,
    annualizedCost: Math.round(monthlyTotal * 12 * 100) / 100,
    expiringIn30Days: expiringIn30,
    expired,
    missingInvoices,
    pendingPayments,
  }
}

async function addInvoice(subscriptionId, { fileName, s3Key, amount, currency, notes }, userId) {
  const sub = await findById(subscriptionId)
  if (!sub) return null

  let fileUrl = ''
  try {
    fileUrl = await s3Service.getDownloadUrl({ key: s3Key, expiresIn: 3600 })
  } catch {
    fileUrl = ''
  }

  const result = await query(
    `INSERT INTO subscription_invoices
       (subscription_id, file_name, file_url, s3_key, amount, currency, uploaded_by, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [
      subscriptionId,
      fileName,
      fileUrl,
      s3Key,
      amount != null ? Number(amount) : null,
      currency || sub.currency || 'AED',
      userId ?? null,
      notes || '',
    ]
  )

  await query(
    `UPDATE subscriptions SET invoice_status = 'Uploaded', updated_by = $2, updated_at = NOW() WHERE id = $1`,
    [subscriptionId, userId ?? null]
  )

  await logActivity(
    subscriptionId,
    'invoice_uploaded',
    `Invoice "${fileName}" uploaded`,
    userId,
    { invoiceId: result.rows[0].id, fileName }
  )

  return result.rows[0]
}

async function getInvoiceDownloadUrl(subscriptionId, invoiceId) {
  const result = await query(
    `SELECT s3_key, file_name FROM subscription_invoices
     WHERE id = $1 AND subscription_id = $2`,
    [invoiceId, subscriptionId]
  )
  const row = result.rows[0]
  if (!row?.s3_key) return null
  const url = await s3Service.getDownloadUrl({ key: row.s3_key, expiresIn: 300 })
  return { url, fileName: row.file_name }
}

async function sendToPaymentGroup(subscriptionId, userId, userName) {
  const sub = await findById(subscriptionId)
  if (!sub) return null

  await query(
    `UPDATE subscriptions SET
      invoice_status = 'Sent to Payment Group',
      payment_status = 'Payment Requested',
      payment_sent_at = NOW(),
      payment_sent_by = $2,
      updated_by = $2,
      updated_at = NOW()
     WHERE id = $1`,
    [subscriptionId, userId ?? null]
  )

  await logActivity(
    subscriptionId,
    'sent_to_payment_group',
    `Payment request sent for "${sub.name}"`,
    userId,
    { amount: sub.cost, currency: sub.currency, requestedBy: userName }
  )

  return findById(subscriptionId)
}

async function markPaid(subscriptionId, userId) {
  const sub = await findById(subscriptionId)
  if (!sub) return null

  await query(
    `UPDATE subscriptions SET
      payment_status = 'Paid',
      updated_by = $2,
      updated_at = NOW()
     WHERE id = $1`,
    [subscriptionId, userId ?? null]
  )

  await logActivity(subscriptionId, 'marked_paid', `Subscription "${sub.name}" marked as paid`, userId)
  return findById(subscriptionId)
}

async function renew(subscriptionId, userId) {
  const sub = await findById(subscriptionId)
  if (!sub) return null

  const today = new Date().toISOString().slice(0, 10)
  const baseDate = sub.expiry_date && getDaysLeft(sub.expiry_date) >= 0 ? sub.expiry_date : today
  const newExpiry = addBillingPeriod(baseDate, sub.billing_cycle)
  const status = computeStatus(newExpiry)

  await query(
    `UPDATE subscriptions SET
      expiry_date = $2,
      status = $3,
      payment_status = 'Unpaid',
      invoice_status = CASE WHEN invoice_required THEN 'Missing' ELSE invoice_status END,
      payment_sent_at = NULL,
      payment_sent_by = NULL,
      updated_by = $4,
      updated_at = NOW()
     WHERE id = $1`,
    [subscriptionId, newExpiry, status, userId ?? null]
  )

  await logActivity(
    subscriptionId,
    'renewed',
    `Subscription renewed — new expiry ${newExpiry}`,
    userId,
    { previousExpiry: sub.expiry_date, newExpiry }
  )

  return findById(subscriptionId)
}

module.exports = {
  CATEGORIES,
  BILLING_CYCLES,
  findAll,
  findById,
  create,
  update,
  softDelete,
  getSummary,
  addInvoice,
  getInvoiceDownloadUrl,
  findInvoices,
  findActivityLogs,
  sendToPaymentGroup,
  markPaid,
  renew,
  logActivity,
}
