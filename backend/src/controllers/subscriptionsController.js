const multer = require('multer')
const svc = require('../services/subscriptionService')
const s3Service = require('../services/s3Service')
const { getDaysLeft, formatDaysRemaining, CATEGORIES, BILLING_CYCLES } = require('../services/subscriptionUtils')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
})

function clean(v) {
  return v == null ? '' : String(v).trim()
}

function normalizePayload(body) {
  const name = clean(body.name)
  const errors = []
  if (!name) errors.push('name is required')

  const category = clean(body.category) || 'Other'
  if (!CATEGORIES.includes(category)) errors.push(`category must be one of: ${CATEGORIES.join(', ')}`)

  const billingCycle = clean(body.billing_cycle ?? body.billingCycle) || 'Monthly'
  if (!BILLING_CYCLES.includes(billingCycle)) {
    errors.push(`billing_cycle must be one of: ${BILLING_CYCLES.join(', ')}`)
  }

  const cost = Number(body.cost ?? 0)
  const currency = clean(body.currency) || 'AED'

  return {
    errors,
    value: {
      name,
      vendor: clean(body.vendor),
      category,
      billing_cycle: billingCycle,
      cost: Number.isFinite(cost) ? cost : 0,
      currency,
      start_date: clean(body.start_date ?? body.startDate) || null,
      expiry_date: clean(body.expiry_date ?? body.expiryDate) || null,
      auto_renew: !!(body.auto_renew ?? body.autoRenew),
      responsible_person: clean(body.responsible_person ?? body.responsiblePerson),
      invoice_required: body.invoice_required ?? body.invoiceRequired ?? true,
      invoice_status: clean(body.invoice_status ?? body.invoiceStatus) || 'Missing',
      payment_status: clean(body.payment_status ?? body.paymentStatus) || 'Unpaid',
      notes: clean(body.notes),
    },
  }
}

function mapInvoice(row) {
  return {
    id: String(row.id),
    subscriptionId: String(row.subscription_id),
    fileName: row.file_name,
    fileUrl: row.file_url,
    s3Key: row.s3_key,
    amount: row.amount != null ? Number(row.amount) : null,
    currency: row.currency,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at,
    notes: row.notes,
  }
}

function mapActivity(row) {
  return {
    id: String(row.id),
    subscriptionId: String(row.subscription_id),
    action: row.action,
    message: row.message,
    metadata: row.metadata_json || {},
    createdBy: row.created_by,
    createdAt: row.created_at,
  }
}

function mapRow(row) {
  return {
    id: String(row.id),
    name: row.name,
    vendor: row.vendor,
    category: row.category,
    status: row.status,
    billingCycle: row.billing_cycle,
    cost: Number(row.cost),
    currency: row.currency,
    startDate: row.start_date || null,
    expiryDate: row.expiry_date || null,
    autoRenew: !!row.auto_renew,
    responsiblePerson: row.responsible_person,
    invoiceRequired: !!row.invoice_required,
    invoiceStatus: row.invoice_status,
    paymentStatus: row.payment_status,
    paymentSentAt: row.payment_sent_at,
    paymentSentBy: row.payment_sent_by,
    notes: row.notes,
    daysRemaining: row.days_remaining,
    daysRemainingLabel: row.days_remaining_label,
    invoiceCount: row.invoice_count ?? 0,
    invoices: Array.isArray(row.invoices) ? row.invoices.map(mapInvoice) : undefined,
    activityLogs: Array.isArray(row.activityLogs) ? row.activityLogs.map(mapActivity) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function userDisplayName(user) {
  return user?.full_name || user?.username || user?.email || 'Unknown'
}

async function list(req, res) {
  try {
    const rows = await svc.findAll()
    res.json(rows.map(mapRow))
  } catch (err) {
    console.error('[subscriptions] list error:', err)
    res.status(500).json({ error: 'Failed to fetch subscriptions' })
  }
}

async function summary(req, res) {
  try {
    const data = await svc.getSummary()
    res.json(data)
  } catch (err) {
    console.error('[subscriptions] summary error:', err)
    res.status(500).json({ error: 'Failed to fetch subscription summary' })
  }
}

async function getOne(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const row = await svc.findById(id)
    if (!row) return res.status(404).json({ error: 'Subscription not found' })
    res.json(mapRow(row))
  } catch (err) {
    console.error('[subscriptions] get error:', err)
    res.status(500).json({ error: 'Failed to fetch subscription' })
  }
}

async function create(req, res) {
  try {
    const payload = normalizePayload(req.body)
    if (payload.errors.length) return res.status(400).json({ error: payload.errors.join('; ') })
    const row = await svc.create(payload.value, req.user?.id)
    res.status(201).json(mapRow(row))
  } catch (err) {
    console.error('[subscriptions] create error:', err)
    res.status(500).json({ error: 'Failed to create subscription' })
  }
}

async function update(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = await svc.findById(id)
    if (!existing) return res.status(404).json({ error: 'Subscription not found' })
    const payload = normalizePayload(req.body)
    if (payload.errors.length) return res.status(400).json({ error: payload.errors.join('; ') })
    const row = await svc.update(id, payload.value, req.user?.id)
    res.json(mapRow(row))
  } catch (err) {
    console.error('[subscriptions] update error:', err)
    res.status(500).json({ error: 'Failed to update subscription' })
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const ok = await svc.softDelete(id, req.user?.id)
    if (!ok) return res.status(404).json({ error: 'Subscription not found' })
    res.status(204).send()
  } catch (err) {
    console.error('[subscriptions] delete error:', err)
    res.status(500).json({ error: 'Failed to delete subscription' })
  }
}

async function listInvoices(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const rows = await svc.findInvoices(id)
    res.json(rows.map(mapInvoice))
  } catch (err) {
    console.error('[subscriptions] list invoices error:', err)
    res.status(500).json({ error: 'Failed to fetch invoices' })
  }
}

async function uploadInvoice(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const file = req.file
    if (!file) return res.status(400).json({ error: 'Invoice file is required' })

    const key = s3Service.createSubscriptionInvoiceKey(id, file.originalname)
    await s3Service.putObjectBuffer({
      key,
      body: file.buffer,
      contentType: file.mimetype || 'application/octet-stream',
    })

    const amount = req.body.amount != null && req.body.amount !== '' ? Number(req.body.amount) : null
    const currency = clean(req.body.currency) || 'AED'
    const notes = clean(req.body.notes)

    const row = await svc.addInvoice(
      id,
      { fileName: file.originalname, s3Key: key, amount, currency, notes },
      req.user?.id
    )
    res.status(201).json(mapInvoice(row))
  } catch (err) {
    console.error('[subscriptions] upload invoice error:', err)
    res.status(500).json({ error: err.message || 'Failed to upload invoice' })
  }
}

async function downloadInvoice(req, res) {
  try {
    const subId = parseInt(req.params.id, 10)
    const invoiceId = parseInt(req.params.invoiceId, 10)
    if (Number.isNaN(subId) || Number.isNaN(invoiceId)) {
      return res.status(400).json({ error: 'Invalid id' })
    }
    const result = await svc.getInvoiceDownloadUrl(subId, invoiceId)
    if (!result) return res.status(404).json({ error: 'Invoice not found' })
    res.json(result)
  } catch (err) {
    console.error('[subscriptions] download invoice error:', err)
    res.status(500).json({ error: 'Failed to get download URL' })
  }
}

async function sendToPaymentGroup(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const sub = await svc.findById(id)
    if (!sub) return res.status(404).json({ error: 'Subscription not found' })

    const invoiceAttached = (sub.invoice_count || 0) > 0 ? 'Attached' : 'Missing'
    const message = [
      'Subscription Payment Request',
      `Subscription: ${sub.name}`,
      `Billing: ${sub.billing_cycle}`,
      `Amount: ${sub.currency} ${Number(sub.cost).toFixed(2)}`,
      `Expiry Date: ${sub.expiry_date || '—'}`,
      `Days Remaining: ${formatDaysRemaining(sub.expiry_date)}`,
      `Invoice: ${invoiceAttached}`,
      `Requested By: ${userDisplayName(req.user)}`,
    ].join('\n')

    if (req.body?.confirm) {
      const updated = await svc.sendToPaymentGroup(id, req.user?.id, userDisplayName(req.user))
      return res.json({ message, subscription: mapRow(updated) })
    }

    res.json({ message, preview: true })
  } catch (err) {
    console.error('[subscriptions] send to payment group error:', err)
    res.status(500).json({ error: 'Failed to send to payment group' })
  }
}

async function markPaid(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const row = await svc.markPaid(id, req.user?.id)
    if (!row) return res.status(404).json({ error: 'Subscription not found' })
    res.json(mapRow(row))
  } catch (err) {
    console.error('[subscriptions] mark paid error:', err)
    res.status(500).json({ error: 'Failed to mark subscription as paid' })
  }
}

async function renew(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const row = await svc.renew(id, req.user?.id)
    if (!row) return res.status(404).json({ error: 'Subscription not found' })
    res.json(mapRow(row))
  } catch (err) {
    console.error('[subscriptions] renew error:', err)
    res.status(500).json({ error: 'Failed to renew subscription' })
  }
}

module.exports = {
  list,
  summary,
  getOne,
  create,
  update,
  remove,
  listInvoices,
  uploadInvoice,
  downloadInvoice,
  sendToPaymentGroup,
  markPaid,
  renew,
  uploadMiddleware: upload.single('file'),
}
