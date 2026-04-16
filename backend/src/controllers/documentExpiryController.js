const svc = require('../services/documentExpiryService')

function clean(v) {
  return v == null ? '' : String(v).trim()
}

function normalizePayload(body) {
  const name = clean(body.name)
  const errors = []
  if (!name) errors.push('name is required')

  const reminderDays = Number(body.reminder_days ?? body.reminderDays ?? 30)

  return {
    errors,
    value: {
      name,
      document_type:     clean(body.document_type    ?? body.documentType),
      company:           clean(body.company),
      expiry_date:       clean(body.expiry_date       ?? body.expiryDate)   || null,
      reminder_days:     Number.isFinite(reminderDays) ? reminderDays : 30,
      renewal_frequency: clean(body.renewal_frequency ?? body.renewalFrequency),
      period_covered:    clean(body.period_covered    ?? body.periodCovered),
      notes:             clean(body.notes),
      workflow_status:   clean(body.workflow_status   ?? body.workflowStatus) || 'Pending',
    },
  }
}

function mapRow(row) {
  return {
    id:               String(row.id),
    name:             row.name,
    documentType:     row.document_type,
    company:          row.company,
    expiryDate:       row.expiry_date ? String(row.expiry_date).slice(0, 10) : null,
    reminderDays:     Number(row.reminder_days),
    renewalFrequency: row.renewal_frequency,
    periodCovered:    row.period_covered,
    notes:            row.notes,
    workflowStatus:   row.workflow_status,
    attachment:       null,
    createdAt:        row.created_at,
    updatedAt:        row.updated_at,
  }
}

async function list(req, res) {
  try {
    const rows = await svc.findAll()
    res.json(rows.map(mapRow))
  } catch (err) {
    console.error('[document-expiry] list error:', err)
    res.status(500).json({ error: 'Failed to fetch document expiry records' })
  }
}

async function create(req, res) {
  try {
    const payload = normalizePayload(req.body)
    if (payload.errors.length) return res.status(400).json({ error: payload.errors.join('; ') })
    const row = await svc.create(payload.value)
    res.status(201).json(mapRow(row))
  } catch (err) {
    console.error('[document-expiry] create error:', err)
    res.status(500).json({ error: 'Failed to create document expiry record' })
  }
}

async function update(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const existing = await svc.findById(id)
    if (!existing) return res.status(404).json({ error: 'Document expiry record not found' })
    const payload = normalizePayload(req.body)
    if (payload.errors.length) return res.status(400).json({ error: payload.errors.join('; ') })
    const row = await svc.update(id, payload.value)
    res.json(mapRow(row))
  } catch (err) {
    console.error('[document-expiry] update error:', err)
    res.status(500).json({ error: 'Failed to update document expiry record' })
  }
}

async function remove(req, res) {
  try {
    const id = parseInt(req.params.id, 10)
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Invalid id' })
    const ok = await svc.remove(id)
    if (!ok) return res.status(404).json({ error: 'Document expiry record not found' })
    res.status(204).send()
  } catch (err) {
    console.error('[document-expiry] delete error:', err)
    res.status(500).json({ error: 'Failed to delete document expiry record' })
  }
}

module.exports = { list, create, update, remove }
